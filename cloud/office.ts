// Ofis yönetimi: mimarın kendi müşterileri, işleri (sözleşmeler), tahsilatları, giderleri ve dosyaları.
// Her kayıt bir Planhane hesabına aittir (user_id); başka hesap göremez. Dosyalar DATA_DIR/office-files/<kullanıcı>/ altında.
// KVKK: bu verilerde veri sorumlusu mimardır, Planhane veri işleyendir (bkz. site/kvkk.html). Dışa aktarım: GET /api/office/export.
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DB, UserRow } from "./db";

const MB = 1024 * 1024;

export function openOfficeTables(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS office_clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      tax_no TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS office_clients_user ON office_clients(user_id);
    CREATE TABLE IF NOT EXISTS office_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id INTEGER REFERENCES office_clients(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'devam',
      fee REAL NOT NULL DEFAULT 0,
      start_date TEXT NOT NULL DEFAULT '',
      due_date TEXT NOT NULL DEFAULT '',
      project_id TEXT NOT NULL DEFAULT '',
      project_title TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS office_jobs_user ON office_jobs(user_id);
    CREATE TABLE IF NOT EXISTS office_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      job_id INTEGER NOT NULL REFERENCES office_jobs(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      amount REAL NOT NULL,
      method TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS office_payments_user ON office_payments(user_id);
    CREATE TABLE IF NOT EXISTS office_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      job_id INTEGER REFERENCES office_jobs(id) ON DELETE SET NULL,
      date TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      vendor TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS office_expenses_user ON office_expenses(user_id);
    CREATE TABLE IF NOT EXISTS office_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      job_id INTEGER REFERENCES office_jobs(id) ON DELETE SET NULL,
      client_id INTEGER REFERENCES office_clients(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      mime TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL,
      stored TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS office_files_user ON office_files(user_id);
  `);
}

type Field =
  | { t: "text"; max: number; required?: boolean; options?: string[] }
  | { t: "date"; required?: boolean }
  | { t: "money"; required?: boolean }
  | { t: "ref"; to: "clients" | "jobs"; required?: boolean };

const ENTITIES: Record<string, { table: string; label: string; fields: Record<string, Field> }> = {
  clients: {
    table: "office_clients", label: "Müşteri",
    fields: {
      name: { t: "text", max: 160, required: true }, phone: { t: "text", max: 40 }, email: { t: "text", max: 160 },
      tax_no: { t: "text", max: 40 }, address: { t: "text", max: 400 }, note: { t: "text", max: 4000 },
    },
  },
  jobs: {
    table: "office_jobs", label: "İş",
    fields: {
      client_id: { t: "ref", to: "clients" }, title: { t: "text", max: 200, required: true },
      status: { t: "text", max: 20, options: ["teklif", "devam", "tamam", "iptal"] }, fee: { t: "money" },
      start_date: { t: "date" }, due_date: { t: "date" },
      project_id: { t: "text", max: 40 }, project_title: { t: "text", max: 200 }, note: { t: "text", max: 4000 },
    },
  },
  payments: {
    table: "office_payments", label: "Tahsilat",
    fields: { job_id: { t: "ref", to: "jobs", required: true }, date: { t: "date", required: true }, amount: { t: "money", required: true }, method: { t: "text", max: 40 }, note: { t: "text", max: 1000 } },
  },
  expenses: {
    table: "office_expenses", label: "Gider",
    fields: {
      date: { t: "date", required: true }, amount: { t: "money", required: true }, category: { t: "text", max: 60 },
      vendor: { t: "text", max: 160 }, job_id: { t: "ref", to: "jobs" }, note: { t: "text", max: 1000 },
    },
  },
};

class Bad extends Error {}

export interface OfficeOptions {
  db: DB;
  /** Dosyaların saklandığı klasör (her kullanıcıya alt klasör) */
  filesDir: string;
  /** Kimlik doğrulama ara katmanı (req.user doldurur) */
  auth: (req: Request, res: Response, next: NextFunction) => void;
  /** Kullanıcının toplam dosya kotası (bayt) */
  quotaBytes: (u: UserRow) => number;
  /** Tek dosya üst sınırı (bayt) */
  maxFileBytes: () => number;
}

export function mountOffice(app: Express, o: OfficeOptions) {
  const { db } = o;
  openOfficeTables(db);
  type Authed = Request & { user: UserRow };
  const userOf = (req: Request) => (req as Authed).user;
  const guard = (req: Request, res: Response, next: NextFunction) => {
    if (userOf(req).disabled) { res.status(403).json({ error: "Hesabınız kapatılmış. Bizimle iletişime geçin.", code: "disabled" }); return; }
    next();
  };
  const handle = (fn: (req: Request, res: Response) => void | Promise<void>) => async (req: Request, res: Response) => {
    try { await fn(req, res); } catch (e) {
      if (e instanceof Bad) { res.status(400).json({ error: e.message }); return; }
      console.error("[ofis]", e);
      res.status(500).json({ error: "Kaydedilemedi, tekrar deneyin." });
    }
  };

  const owns = (to: "clients" | "jobs", id: number, userId: number) =>
    Boolean(db.prepare(`SELECT 1 FROM ${ENTITIES[to].table} WHERE id=? AND user_id=?`).get(id, userId));

  const clean = (ent: keyof typeof ENTITIES, body: Record<string, unknown>, userId: number, partial: boolean) => {
    const out: Record<string, string | number | null> = {};
    for (const [k, f] of Object.entries(ENTITIES[ent].fields)) {
      const v = body[k];
      if (v === undefined && partial) continue;
      if (f.t === "text") {
        let s = String(v ?? "").trim().slice(0, f.max);
        if (f.options) s = f.options.includes(s) ? s : f.options[1] ?? f.options[0];
        if (f.required && !s) throw new Bad(`${ENTITIES[ent].label}: zorunlu alan boş (${k === "name" ? "ad" : k === "title" ? "iş adı" : k}).`);
        out[k] = s;
      } else if (f.t === "date") {
        const s = String(v ?? "").trim();
        if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Bad("Tarih biçimi geçersiz (YYYY-AA-GG).");
        if (f.required && !s) throw new Bad("Tarih girin.");
        out[k] = s;
      } else if (f.t === "money") {
        const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
        if (!Number.isFinite(n) || n < 0 || n > 1e12) { if (f.required || (v != null && v !== "")) throw new Bad("Tutar geçersiz."); out[k] = 0; continue; }
        if (f.required && !(n > 0)) throw new Bad("Tutar sıfırdan büyük olmalı.");
        out[k] = Math.round(n * 100) / 100;
      } else {
        const n = v === null || v === "" || v === undefined ? null : Number(v);
        if (n == null) { if (f.required) throw new Bad(f.to === "jobs" ? "Bir iş seçin." : "Bir müşteri seçin."); out[k] = null; continue; }
        if (!Number.isInteger(n) || !owns(f.to, n, userId)) throw new Bad(f.to === "jobs" ? "Seçilen iş bulunamadı." : "Seçilen müşteri bulunamadı.");
        out[k] = n;
      }
    }
    return out;
  };

  const storageUsed = (userId: number) => Number((db.prepare("SELECT COALESCE(SUM(size),0) AS n FROM office_files WHERE user_id=?").get(userId) as { n: number }).n);
  const storage = (u: UserRow) => ({ used: storageUsed(u.id), quota: o.quotaBytes(u), maxFile: o.maxFileBytes() });
  const FILE_COLS = "id,job_id,client_id,name,mime,size,note,created_at,updated_at";
  const all = (u: UserRow) => {
    const rows = (t: string, order: string) => db.prepare(`SELECT * FROM ${t} WHERE user_id=? ORDER BY ${order}`).all(u.id).map((r) => { const { user_id: _u, ...rest } = r as Record<string, unknown>; return rest; });
    return {
      clients: rows("office_clients", "name COLLATE NOCASE"),
      jobs: rows("office_jobs", "id DESC"),
      payments: rows("office_payments", "date DESC, id DESC"),
      expenses: rows("office_expenses", "date DESC, id DESC"),
      files: db.prepare(`SELECT ${FILE_COLS} FROM office_files WHERE user_id=? ORDER BY id DESC`).all(u.id),
      storage: storage(u),
    };
  };

  const base = "/api/office";
  app.get(base, o.auth, guard, handle((req, res) => { res.json(all(userOf(req))); }));

  /** KVKK / yedek: tüm ofis kayıtları tek JSON dosyası (dosyaların kendisi hariç; onlar tek tek indirilir) */
  app.get(`${base}/export`, o.auth, guard, handle((req, res) => {
    const u = userOf(req);
    res.attachment(`planhane-ofis-${new Date().toISOString().slice(0, 10)}.json`);
    res.json({ format: "planhane-ofis", version: 1, exportedAt: new Date().toISOString(), account: u.email, ...all(u) });
  }));

  // Oluştur / güncelle (id varsa) ve sil: müşteri, iş, tahsilat, gider
  for (const ent of Object.keys(ENTITIES)) {
    const { table, label } = ENTITIES[ent];
    app.post(`${base}/${ent}`, o.auth, guard, handle((req, res) => {
      const u = userOf(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = Date.now();
      const id = body.id == null || body.id === "" ? null : Number(body.id);
      if (id != null) {
        if (!db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND user_id=?`).get(id, u.id)) { res.status(404).json({ error: `${label} bulunamadı.` }); return; }
        const v = clean(ent, body, u.id, true);
        const keys = Object.keys(v);
        if (keys.length) db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(",")}, updated_at=? WHERE id=? AND user_id=?`).run(...keys.map((k) => v[k]), now, id, u.id);
        res.json({ id, ...all(u) });
        return;
      }
      const count = Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id=?`).get(u.id) as { n: number }).n);
      if (count >= 20000) throw new Bad("Kayıt sınırına ulaşıldı. Bizimle iletişime geçin.");
      const v = clean(ent, body, u.id, false);
      const keys = Object.keys(v);
      const r = db.prepare(`INSERT INTO ${table} (user_id,${keys.join(",")},created_at,updated_at) VALUES (?,${keys.map(() => "?").join(",")},?,?)`).run(u.id, ...keys.map((k) => v[k]), now, now);
      res.json({ id: Number(r.lastInsertRowid), ...all(u) });
    }));
    app.delete(`${base}/${ent}/:id`, o.auth, guard, handle((req, res) => {
      const u = userOf(req);
      const id = Number(req.params.id);
      if (!db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND user_id=?`).get(id, u.id)) { res.status(404).json({ error: `${label} bulunamadı.` }); return; }
      if (ent === "clients") {
        const n = Number((db.prepare("SELECT COUNT(*) AS n FROM office_jobs WHERE client_id=? AND user_id=?").get(id, u.id) as { n: number }).n);
        if (n > 0) throw new Bad(`Bu müşteriye bağlı ${n} iş var. Önce işleri silin ya da başka müşteriye taşıyın.`);
      }
      db.prepare(`DELETE FROM ${table} WHERE id=? AND user_id=?`).run(id, u.id);
      res.json(all(u));
    }));
  }

  // ---------- dosyalar ----------
  const userDir = (userId: number) => path.join(o.filesDir, String(userId));
  const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/^\.+/, "").trim().slice(0, 180) || "dosya";
  const uploadBody = (req: Request, res: Response, next: NextFunction) =>
    express.raw({ type: () => true, limit: Math.max(MB, o.maxFileBytes()) })(req, res, (err?: unknown) => {
      if (err) { const tooBig = (err as { type?: string }).type === "entity.too.large"; res.status(tooBig ? 413 : 400).json({ error: tooBig ? `Dosya çok büyük (en fazla ${Math.round(o.maxFileBytes() / MB)} MB).` : "Dosya okunamadı." }); return; }
      next();
    });

  /** Yükleme: gövde dosyanın kendisi (application/octet-stream); ad ve bağlantılar sorgu parametresinde */
  app.post(`${base}/files`, o.auth, guard, uploadBody, handle((req, res) => {
    const u = userOf(req);
    const data = req.body;
    if (!Buffer.isBuffer(data) || data.length === 0) throw new Bad("Boş dosya yüklenemez.");
    if (data.length > o.maxFileBytes()) { res.status(413).json({ error: `Dosya çok büyük (en fazla ${Math.round(o.maxFileBytes() / MB)} MB).` }); return; }
    const st = storage(u);
    if (st.used + data.length > st.quota) {
      res.status(413).json({ error: `Dosya alanınız doldu (${(st.used / MB).toFixed(1)} / ${Math.round(st.quota / MB)} MB). Eski dosyaları silin ya da daha yüksek bir plana geçin.`, code: "storage" });
      return;
    }
    const q = req.query as Record<string, string | undefined>;
    const refs = clean("expenses", { date: "2000-01-01", amount: 1, job_id: q.job_id ?? null }, u.id, false);
    let clientId: number | null = q.client_id ? Number(q.client_id) : null;
    if (clientId != null && !(Number.isInteger(clientId) && owns("clients", clientId, u.id))) throw new Bad("Seçilen müşteri bulunamadı.");
    if (clientId == null && refs.job_id != null) clientId = (db.prepare("SELECT client_id FROM office_jobs WHERE id=?").get(refs.job_id) as { client_id: number | null }).client_id;
    const name = safeName(String(q.name ?? "dosya"));
    const mime = String(q.mime ?? "").slice(0, 120);
    const stored = `${crypto.randomBytes(12).toString("hex")}.bin`;
    fs.mkdirSync(userDir(u.id), { recursive: true });
    fs.writeFileSync(path.join(userDir(u.id), stored), data);
    const now = Date.now();
    const r = db.prepare("INSERT INTO office_files (user_id,job_id,client_id,name,mime,size,stored,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(u.id, refs.job_id, clientId, name, mime, data.length, stored, String(q.note ?? "").slice(0, 500), now, now);
    res.json({ id: Number(r.lastInsertRowid), ...all(u) });
  }));

  /** Dosya bilgisi güncelle: ad, not, bağlı iş */
  app.post(`${base}/files/:id`, o.auth, guard, handle((req, res) => {
    const u = userOf(req);
    const id = Number(req.params.id);
    const f = db.prepare("SELECT * FROM office_files WHERE id=? AND user_id=?").get(id, u.id) as { name: string; note: string; job_id: number | null } | undefined;
    if (!f) { res.status(404).json({ error: "Dosya bulunamadı." }); return; }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const jobId = b.job_id === undefined ? f.job_id : clean("expenses", { date: "2000-01-01", amount: 1, job_id: b.job_id }, u.id, false).job_id;
    db.prepare("UPDATE office_files SET name=?, note=?, job_id=?, updated_at=? WHERE id=?")
      .run(b.name != null ? safeName(String(b.name)) : f.name, b.note != null ? String(b.note).slice(0, 500) : f.note, jobId, Date.now(), id);
    res.json(all(u));
  }));

  app.get(`${base}/files/:id`, o.auth, guard, handle((req, res) => {
    const u = userOf(req);
    const f = db.prepare("SELECT * FROM office_files WHERE id=? AND user_id=?").get(Number(req.params.id), u.id) as { name: string; mime: string; stored: string } | undefined;
    const file = f && path.join(userDir(u.id), f.stored);
    if (!f || !file || !fs.existsSync(file)) { res.status(404).json({ error: "Dosya bulunamadı." }); return; }
    res.attachment(f.name);
    res.setHeader("Content-Type", f.mime || "application/octet-stream");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.sendFile(file);
  }));

  app.delete(`${base}/files/:id`, o.auth, guard, handle((req, res) => {
    const u = userOf(req);
    const f = db.prepare("SELECT stored FROM office_files WHERE id=? AND user_id=?").get(Number(req.params.id), u.id) as { stored: string } | undefined;
    if (!f) { res.status(404).json({ error: "Dosya bulunamadı." }); return; }
    db.prepare("DELETE FROM office_files WHERE id=? AND user_id=?").run(Number(req.params.id), u.id);
    fs.rm(path.join(userDir(u.id), f.stored), { force: true }, () => {});
    res.json(all(u));
  }));
}
