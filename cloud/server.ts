// Planhane Bulut sunucusu: hesaplar, abonelik/kota, Claude ve Higgsfield çağrıları (bizim anahtarlarımızla),
// yönetim paneli API'si. Uzun süren işler arka planda çalışır; istemci iş durumunu sorgular
// (barındırma sağlayıcılarının istek zaman aşımına ve mobil bağlantı kopmalarına dayanıklı).
import express, { type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { DB, UserRow } from "./db";
import { claudeCost, entitlement, loadPlans, loadTrial, type Plan } from "./plans";
import { generateWithClaude, GenerateError, DEFAULT_MODEL, type GenerateRequest } from "../src/shared/generate";
import { renderWithHiggsfield, RENDER_MODELS, type RenderRequest } from "../src/shared/render";

export interface CloudOptions {
  db: DB;
  anthropicKey: string;
  model?: string;
  higgsfield?: { keyId: string; secret: string };
  adminToken: string;
  /** Havale/EFT bilgileri ve iletişim (abone ol ekranında gösterilir) */
  payment: { bank: string; holder: string; iban: string; email: string; whatsapp: string; company: string; address: string };
  /** Test için Claude istemcisi üretimi */
  claudeClient?: () => Anthropic;
  renderFetch?: typeof fetch;
  higgsfieldApi?: string;
}

const DAY = 86_400_000;
const SESSION_TTL = 180 * DAY;

// ---------- parola ve oturum ----------
function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}
function checkPassword(pw: string, stored: string): boolean {
  const [alg, s, h] = stored.split("$");
  if (alg !== "scrypt" || !s || !h) return false;
  const want = Buffer.from(h, "base64");
  const got = crypto.scryptSync(pw, Buffer.from(s, "base64"), want.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(want, got);
}
const sha = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
const safeEq = (a: string, b: string) => { const x = Buffer.from(sha(a)), y = Buffer.from(sha(b)); return crypto.timingSafeEqual(x, y); };

/** Basit sabit pencere sayaç (giriş denemesi, kayıt) */
function limiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; t: number }>();
  return (key: string) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now - h.t > windowMs) { hits.set(key, { n: 1, t: now }); return true; }
    h.n++;
    if (hits.size > 10000) hits.clear();
    return h.n <= max;
  };
}

// ---------- işler ----------
interface Job {
  id: string;
  userId: number;
  kind: "generate" | "render";
  status: "running" | "done" | "error";
  stage?: string;
  result?: unknown;
  error?: string;
  errorStatus?: number;
  raw?: unknown;
  ac: AbortController;
  at: number;
}

export function createCloudApp(o: CloudOptions) {
  const { db } = o;
  const plans = (): Plan[] => loadPlans();
  const model = o.model ?? process.env.CLAUDE_MODEL ?? DEFAULT_MODEL;
  const jobs = new Map<string, Job>();
  setInterval(() => { const t = Date.now() - 30 * 60_000; for (const [k, j] of jobs) if (j.status !== "running" && j.at < t) jobs.delete(k); }, 60_000).unref();

  const loginLimit = limiter(8, 15 * 60_000);
  const signupLimit = limiter(5, DAY);

  const app = express();
  app.set("trust proxy", true);
  app.use((req, res, next) => {
    // Uygulamalar farklı adreslerden bağlanır (masaüstü 127.0.0.1, Android, web paneli). Çerez yok, Bearer belirteç var.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Admin-Token");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") { res.status(204).end(); return; }
    next();
  });
  app.use("/api", express.json({ limit: "40mb" }));

  const getUser = (id: number) => db.prepare("SELECT * FROM users WHERE id=?").get(id) as UserRow | undefined;
  const ref = (u: UserRow) => `MN-${String(u.id).padStart(4, "0")}`;
  const me = (u: UserRow) => {
    const e = entitlement(db, u, plans());
    return {
      id: u.id, email: u.email, name: u.name, office: u.office, phone: u.phone, ref: ref(u),
      status: e.status, plan: e.plan ? { id: e.plan.id, label: e.plan.label } : null,
      until: e.until, periodEnd: e.periodEnd, limits: e.limits, used: e.used,
    };
  };

  const newSession = (u: UserRow, device: string) => {
    const token = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    db.prepare("INSERT INTO sessions (token_hash,user_id,created_at,last_seen,device) VALUES (?,?,?,?,?)").run(sha(token), u.id, now, now, device.slice(0, 120));
    return token;
  };

  type Authed = Request & { user: UserRow };
  const auth = (req: Request, res: Response, next: NextFunction) => {
    const t = /^Bearer (.+)$/.exec(req.get("authorization") ?? "")?.[1];
    if (!t) { res.status(401).json({ error: "Oturum açın.", code: "auth" }); return; }
    const s = db.prepare("SELECT * FROM sessions WHERE token_hash=?").get(sha(t)) as { user_id: number; last_seen: number } | undefined;
    const now = Date.now();
    if (!s || now - s.last_seen > SESSION_TTL) { res.status(401).json({ error: "Oturumunuzun süresi doldu, yeniden giriş yapın.", code: "auth" }); return; }
    const u = getUser(s.user_id);
    if (!u) { res.status(401).json({ error: "Hesap bulunamadı.", code: "auth" }); return; }
    if (now - s.last_seen > 3_600_000) {
      db.prepare("UPDATE sessions SET last_seen=? WHERE token_hash=?").run(now, sha(t));
      db.prepare("UPDATE users SET last_seen=? WHERE id=?").run(now, u.id);
    }
    (req as Authed).user = u;
    next();
  };

  // ---------- herkese açık ----------
  app.get("/api/health", (_req, res) => { res.json({ ok: true, cloud: true, hasKey: true, model, hasHiggsfield: Boolean(o.higgsfield) }); });
  app.get("/api/public/config", (_req, res) => {
    res.json({ plans: plans(), trial: loadTrial(), payment: o.payment, renderModels: RENDER_MODELS.map((m) => ({ id: m.id, label: m.label, note: m.note })) });
  });

  // ---------- hesap ----------
  const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 160;
  app.post("/api/auth/register", (req, res) => {
    const b = req.body ?? {};
    const email = String(b.email ?? "").trim().toLowerCase();
    const pw = String(b.password ?? "");
    if (!emailOk(email)) { res.status(400).json({ error: "Geçerli bir e-posta adresi girin." }); return; }
    if (pw.length < 8) { res.status(400).json({ error: "Parola en az 8 karakter olmalı." }); return; }
    if (!b.acceptTerms) { res.status(400).json({ error: "Kullanım koşullarını ve KVKK aydınlatma metnini onaylayın." }); return; }
    if (!signupLimit(req.ip ?? "?")) { res.status(429).json({ error: "Bu bağlantıdan bugün çok fazla hesap açıldı. Yarın tekrar deneyin ya da bize yazın." }); return; }
    if (db.prepare("SELECT id FROM users WHERE email=?").get(email)) { res.status(409).json({ error: "Bu e-posta ile zaten bir hesap var. Giriş yapın." }); return; }
    const now = Date.now();
    const trial = loadTrial();
    const r = db.prepare("INSERT INTO users (email,pass_hash,name,office,phone,created_at,trial_until,signup_ip) VALUES (?,?,?,?,?,?,?,?)")
      .run(email, hashPassword(pw), String(b.name ?? "").trim().slice(0, 120), String(b.office ?? "").trim().slice(0, 160), String(b.phone ?? "").trim().slice(0, 40), now, now + trial.days * DAY, req.ip ?? "");
    const u = getUser(Number(r.lastInsertRowid))!;
    res.json({ token: newSession(u, String(b.device ?? req.get("user-agent") ?? "")), me: me(u) });
  });

  app.post("/api/auth/login", (req, res) => {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const pw = String(req.body?.password ?? "");
    if (!loginLimit(`${req.ip}|${email}`)) { res.status(429).json({ error: "Çok fazla deneme. 15 dakika sonra tekrar deneyin." }); return; }
    const u = db.prepare("SELECT * FROM users WHERE email=?").get(email) as UserRow | undefined;
    if (!u || !checkPassword(pw, u.pass_hash)) { res.status(401).json({ error: "E-posta ya da parola hatalı." }); return; }
    if (u.disabled) { res.status(403).json({ error: "Hesabınız kapatılmış. Bizimle iletişime geçin." }); return; }
    res.json({ token: newSession(u, String(req.body?.device ?? req.get("user-agent") ?? "")), me: me(u) });
  });

  app.post("/api/auth/logout", auth, (req, res) => {
    const t = /^Bearer (.+)$/.exec(req.get("authorization") ?? "")?.[1] ?? "";
    db.prepare("DELETE FROM sessions WHERE token_hash=?").run(sha(t));
    res.json({ ok: true });
  });

  app.get("/api/me", auth, (req, res) => { res.json(me((req as Authed).user)); });

  app.post("/api/me", auth, (req, res) => {
    const u = (req as Authed).user;
    const b = req.body ?? {};
    db.prepare("UPDATE users SET name=?, office=?, phone=? WHERE id=?").run(String(b.name ?? u.name).slice(0, 120), String(b.office ?? u.office).slice(0, 160), String(b.phone ?? u.phone).slice(0, 40), u.id);
    res.json(me(getUser(u.id)!));
  });

  app.post("/api/me/password", auth, (req, res) => {
    const u = (req as Authed).user;
    const { oldPassword, newPassword } = req.body ?? {};
    if (!checkPassword(String(oldPassword ?? ""), u.pass_hash)) { res.status(400).json({ error: "Mevcut parola hatalı." }); return; }
    if (String(newPassword ?? "").length < 8) { res.status(400).json({ error: "Yeni parola en az 8 karakter olmalı." }); return; }
    db.prepare("UPDATE users SET pass_hash=? WHERE id=?").run(hashPassword(String(newPassword)), u.id);
    res.json({ ok: true });
  });

  // ---------- işler (üretim ve render) ----------
  const quotaError = (u: UserRow, kind: "generate" | "render") => {
    const e = entitlement(db, u, plans());
    const running = [...jobs.values()].filter((j) => j.userId === u.id && j.status === "running");
    if (running.some((j) => j.kind === kind)) return { status: 409, error: kind === "generate" ? "Zaten devam eden bir üretiminiz var. Bitmesini bekleyin ya da durdurun." : "Zaten devam eden bir render var." };
    if (e.status === "disabled") return { status: 403, error: "Hesabınız kapatılmış. Bizimle iletişime geçin.", code: "disabled" };
    if (e.status === "expired") return { status: 402, error: e.plan || u.plan_until ? "Aboneliğinizin süresi doldu. Devam etmek için aboneliğinizi yenileyin." : "Deneme süreniz bitti. Devam etmek için abone olun.", code: "expired" };
    if (e.used[kind] >= e.limits[kind]) {
      const what = kind === "generate" ? "üretim" : "render";
      return { status: 402, code: "quota", error: e.status === "trial"
        ? `Deneme sürümündeki ${e.limits[kind]} ${what} hakkınızı kullandınız. Devam etmek için abone olun.`
        : `Bu dönemki ${e.limits[kind]} ${what} hakkınız doldu (${new Date(e.periodEnd).toLocaleDateString("tr-TR")} tarihinde yenilenir). Daha yüksek bir plana geçebilirsiniz.` };
    }
    return null;
  };

  const logUsage = (userId: number, kind: string, ok: boolean, d: { model?: string; input?: number; output?: number; cost?: number; detail?: string } = {}) => {
    db.prepare("INSERT INTO usage (user_id,kind,at,ok,model,input_tokens,output_tokens,cost_usd,detail) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(userId, kind, Date.now(), ok ? 1 : 0, d.model ?? "", d.input ?? 0, d.output ?? 0, d.cost ?? 0, (d.detail ?? "").slice(0, 300));
  };

  const startJob = (u: UserRow, kind: Job["kind"], fn: (job: Job) => Promise<unknown>) => {
    const job: Job = { id: crypto.randomBytes(12).toString("base64url"), userId: u.id, kind, status: "running", ac: new AbortController(), at: Date.now() };
    jobs.set(job.id, job);
    fn(job).then(
      (result) => { job.result = result; job.status = "done"; job.at = Date.now(); },
      (err) => {
        job.status = "error"; job.at = Date.now();
        if (job.ac.signal.aborted) { job.error = "Durduruldu"; job.errorStatus = 499; return; }
        job.error = (err as Error)?.message ?? String(err);
        job.errorStatus = err instanceof GenerateError ? err.status : 502;
        job.raw = err instanceof GenerateError ? err.raw : undefined;
        if (!(err instanceof GenerateError) || err.status >= 500) console.error(`[${kind}] kullanıcı ${u.id}:`, err);
      },
    );
    return job;
  };

  app.post("/api/jobs/generate", auth, (req, res) => {
    const u = (req as Authed).user;
    const q = quotaError(u, "generate");
    if (q) { res.status(q.status).json(q); return; }
    const body = (req.body ?? {}) as GenerateRequest;
    const client = o.claudeClient?.() ?? new Anthropic({ apiKey: o.anthropicKey, maxRetries: 2 });
    const job = startJob(u, "generate", async (job) => {
      job.stage = "Claude programı çıkarıyor…";
      try {
        const out = await generateWithClaude(client, body, { model, signal: job.ac.signal });
        if (!out || job.ac.signal.aborted) throw new DOMException("Durduruldu", "AbortError");
        const usage = out.usage as Parameters<typeof claudeCost>[1];
        logUsage(u.id, "generate", true, { model: out.model ?? model, input: usage?.input_tokens, output: usage?.output_tokens, cost: claudeCost(out.model ?? model, usage), detail: body.revision ? "duzeltme" : body.previous ? "guncelleme" : "yeni" });
        return { program: out.program, warnings: out.warnings, raw: out.raw, model: out.model };
      } catch (e) {
        if (!job.ac.signal.aborted) logUsage(u.id, "generate", false, { model, detail: (e as Error).message });
        throw e;
      }
    });
    res.json({ id: job.id });
  });

  app.post("/api/jobs/render", auth, (req, res) => {
    const u = (req as Authed).user;
    if (!o.higgsfield) { res.status(503).json({ error: "Gerçekçi render şu an kapalı." }); return; }
    const q = quotaError(u, "render");
    if (q) { res.status(q.status).json(q); return; }
    const body = (req.body ?? {}) as RenderRequest;
    // Maliyet denetimi: yalnız listedeki modeller
    if (!RENDER_MODELS.some((m) => m.id === body.modelId)) body.modelId = RENDER_MODELS[0].id;
    const keys = o.higgsfield;
    const job = startJob(u, "render", async (job) => {
      try {
        const out = await renderWithHiggsfield(body, keys, { signal: job.ac.signal, fetch: o.renderFetch, api: o.higgsfieldApi, onStatus: (s) => { job.stage = s; } });
        job.stage = "Görsel indiriliyor…";
        const f = o.renderFetch ?? fetch;
        const img = await f(out.url);
        const buf = Buffer.from(await img.arrayBuffer());
        logUsage(u.id, "render", true, { model: out.model, cost: out.price ?? 0 });
        return { url: out.url, model: out.model, price: null, data: `data:${img.headers.get("content-type") ?? "image/png"};base64,${buf.toString("base64")}` };
      } catch (e) {
        if (!job.ac.signal.aborted) logUsage(u.id, "render", false, { detail: (e as Error).message });
        throw e;
      }
    });
    res.json({ id: job.id });
  });

  app.get("/api/jobs/:id", auth, (req, res) => {
    const j = jobs.get(String(req.params.id));
    if (!j || j.userId !== (req as Authed).user.id) { res.status(404).json({ error: "İş bulunamadı (sunucu yeniden başlamış olabilir). Tekrar deneyin." }); return; }
    if (j.status === "running") { res.json({ status: "running", stage: j.stage, elapsed: Date.now() - j.at }); return; }
    if (j.status === "error") { res.json({ status: "error", error: j.error, errorStatus: j.errorStatus, raw: j.raw }); return; }
    res.json({ status: "done", result: j.result, me: me(getUser(j.userId)!) });
  });

  app.delete("/api/jobs/:id", auth, (req, res) => {
    const j = jobs.get(String(req.params.id));
    if (j && j.userId === (req as Authed).user.id && j.status === "running") j.ac.abort();
    res.json({ ok: true });
  });

  // ---------- yönetim ----------
  const admin = (req: Request, res: Response, next: NextFunction) => {
    const t = req.get("x-admin-token") ?? "";
    if (!o.adminToken || !t || !safeEq(t, o.adminToken)) { res.status(401).json({ error: "Yönetici parolası hatalı." }); return; }
    next();
  };
  const adminUser = (u: UserRow) => {
    const e = entitlement(db, u, plans());
    const cost = db.prepare("SELECT COALESCE(SUM(cost_usd),0) AS c FROM usage WHERE user_id=? AND at>=?").get(u.id, e.periodStart) as { c: number };
    return { ...me(u), createdAt: u.created_at, lastSeen: u.last_seen, disabled: Boolean(u.disabled), note: u.note, planId: u.plan, planStart: u.plan_start, planUntil: u.plan_until, trialUntil: u.trial_until, periodCostUsd: cost.c };
  };

  app.get("/api/admin/stats", admin, (_req, res) => {
    const now = Date.now();
    // Bu ayın başı, İstanbul saatiyle (UTC+3, yaz saati yok)
    const tr = new Date(now + 3 * 3_600_000);
    const ms = Date.UTC(tr.getUTCFullYear(), tr.getUTCMonth(), 1) - 3 * 3_600_000;
    const n = (sql: string, ...a: (number | string)[]) => (db.prepare(sql).get(...a) as { n: number }).n;
    res.json({
      users: n("SELECT COUNT(*) AS n FROM users"),
      active: n("SELECT COUNT(*) AS n FROM users WHERE plan_until>? AND disabled=0", now),
      trials: n("SELECT COUNT(*) AS n FROM users WHERE plan_until IS NULL AND trial_until>? AND disabled=0", now),
      signups30: n("SELECT COUNT(*) AS n FROM users WHERE created_at>?", now - 30 * DAY),
      monthRevenueTry: n("SELECT COALESCE(SUM(amount_try),0) AS n FROM payments WHERE at>=?", ms),
      monthCostUsd: n("SELECT COALESCE(SUM(cost_usd),0) AS n FROM usage WHERE at>=?", ms),
      monthGenerations: n("SELECT COUNT(*) AS n FROM usage WHERE kind='generate' AND ok=1 AND at>=?", ms),
      monthRenders: n("SELECT COUNT(*) AS n FROM usage WHERE kind='render' AND ok=1 AND at>=?", ms),
      monthFailures: n("SELECT COUNT(*) AS n FROM usage WHERE ok=0 AND at>=?", ms),
      avgGenerateCostUsd: n("SELECT COALESCE(AVG(cost_usd),0) AS n FROM usage WHERE kind='generate' AND ok=1 AND at>=?", now - 30 * DAY),
      runningJobs: [...jobs.values()].filter((j) => j.status === "running").length,
      plans: plans(),
    });
  });

  app.get("/api/admin/users", admin, (req, res) => {
    const q = `%${String(req.query.q ?? "").trim().toLowerCase()}%`;
    const rows = db.prepare("SELECT * FROM users WHERE lower(email) LIKE ? OR lower(name) LIKE ? OR lower(office) LIKE ? OR phone LIKE ? OR printf('MN-%04d', id) LIKE upper(?) ORDER BY id DESC LIMIT 300").all(q, q, q, q, q) as unknown as UserRow[];
    res.json(rows.map(adminUser));
  });

  app.get("/api/admin/users/:id", admin, (req, res) => {
    const u = getUser(Number(req.params.id));
    if (!u) { res.status(404).json({ error: "Kullanıcı yok" }); return; }
    res.json({
      user: adminUser(u),
      payments: db.prepare("SELECT * FROM payments WHERE user_id=? ORDER BY at DESC").all(u.id),
      usage: db.prepare("SELECT kind,at,ok,model,input_tokens,output_tokens,cost_usd,detail FROM usage WHERE user_id=? ORDER BY at DESC LIMIT 100").all(u.id),
      sessions: db.prepare("SELECT created_at,last_seen,device FROM sessions WHERE user_id=? ORDER BY last_seen DESC LIMIT 20").all(u.id),
    });
  });

  /** Havale/EFT geldikten sonra aboneliği aç ya da uzat */
  app.post("/api/admin/users/:id/activate", admin, (req, res) => {
    const u = getUser(Number(req.params.id));
    const plan = plans().find((p) => p.id === req.body?.plan);
    const months = Math.round(Number(req.body?.months ?? 1));
    if (!u || !plan || !(months >= 1 && months <= 36)) { res.status(400).json({ error: "Kullanıcı, plan ya da ay sayısı geçersiz." }); return; }
    const now = Date.now();
    // Süresi bitmemiş abonelik uzatılır; plan değişirse dönem şimdi başlar
    const continuing = u.plan_until && u.plan_until > now;
    const base = continuing ? u.plan_until! : now;
    const until = base + months * 30 * DAY;
    const start = continuing && u.plan === plan.id ? u.plan_start ?? now : now;
    db.prepare("UPDATE users SET plan=?, plan_start=?, plan_until=? WHERE id=?").run(plan.id, start, until, u.id);
    const amount = Number(req.body?.amount ?? plan.priceTry * months);
    db.prepare("INSERT INTO payments (user_id,at,plan,months,amount_try,until,note) VALUES (?,?,?,?,?,?,?)").run(u.id, now, plan.id, months, Number.isFinite(amount) ? amount : 0, until, String(req.body?.note ?? "").slice(0, 300));
    res.json(adminUser(getUser(u.id)!));
  });

  app.post("/api/admin/users/:id/update", admin, (req, res) => {
    const u = getUser(Number(req.params.id));
    if (!u) { res.status(404).json({ error: "Kullanıcı yok" }); return; }
    const b = req.body ?? {};
    if (b.disabled != null) {
      db.prepare("UPDATE users SET disabled=? WHERE id=?").run(b.disabled ? 1 : 0, u.id);
      if (b.disabled) db.prepare("DELETE FROM sessions WHERE user_id=?").run(u.id);
    }
    if (b.note != null) db.prepare("UPDATE users SET note=? WHERE id=?").run(String(b.note).slice(0, 1000), u.id);
    if (b.trialDays != null) db.prepare("UPDATE users SET trial_until=? WHERE id=?").run(Date.now() + Number(b.trialDays) * DAY, u.id);
    if (b.cancelPlan) db.prepare("UPDATE users SET plan_until=? WHERE id=?").run(Date.now(), u.id);
    res.json(adminUser(getUser(u.id)!));
  });

  app.post("/api/admin/users/:id/reset-password", admin, (req, res) => {
    const u = getUser(Number(req.params.id));
    if (!u) { res.status(404).json({ error: "Kullanıcı yok" }); return; }
    const pw = crypto.randomBytes(6).toString("base64url");
    db.prepare("UPDATE users SET pass_hash=? WHERE id=?").run(hashPassword(pw), u.id);
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(u.id);
    res.json({ password: pw });
  });

  /** Veritabanı yedeği (tutarlı kopya) */
  app.get("/api/admin/backup", admin, (_req, res) => {
    const file = path.join(os.tmpdir(), `mimarnot-yedek-${Date.now()}.db`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    res.download(file, `mimarnot-yedek-${new Date().toISOString().slice(0, 10)}.db`, () => fs.rm(file, () => {}));
  });

  return app;
}
