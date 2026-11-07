import express from "express";
import path from "node:path";
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { ProgramWireSchema, normalizeProgram, type Program, type ProgramWire } from "../src/shared/schema";
import { repairProgram } from "../src/geometry/blocks";

const TOOL_NAME = "bina_programi";
const { $schema: _s, ...WIRE_JSON_SCHEMA } = z.toJSONSchema(ProgramWireSchema) as Record<string, unknown> & { type: "object" };
/** API yapılandırılmış çıktı gramerini bir kez reddederse sonraki isteklerde doğrudan talimatlı moda geçilir */
let strictRejected = false;
import { SYSTEM_PROMPT } from "./prompt";

export interface AppOptions {
  getApiKey: () => string | undefined;
  model?: string;
  /** Derlenmiş arayüz klasörü (varsa sunulur) */
  staticDir?: string;
  desktop?: boolean;
}

export function createApp(opts: AppOptions) {
  const MODEL = opts.model ?? process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
  const app = express();
app.use(express.json({ limit: "25mb" }));


app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: MODEL, hasKey: Boolean(opts.getApiKey()), desktop: Boolean(opts.desktop) });
});

app.post("/api/generate", async (req, res) => {
  const notes: string = String(req.body?.notes ?? "").trim();
  const previous: Program | undefined = req.body?.previous;
  const revision: string = String(req.body?.revision ?? "").trim();
  const brief: Record<string, unknown> | undefined = req.body?.brief;
  const images: { mediaType: string; data: string }[] = Array.isArray(req.body?.images) ? req.body.images.slice(0, 4) : [];
  if (revision && !previous) {
    res.status(400).json({ error: "Düzeltme için önce bir proje üretilmiş olmalı." });
    return;
  }
  if (!revision && notes.length < 10 && !brief) {
    res.status(400).json({ error: "Not çok kısa. Müşterinin isteklerini biraz daha detaylı yazın." });
    return;
  }
  const briefText = brief && Object.keys(brief).length
    ? `\n\nMimarın formda seçtiği kesin değerler (notlarla çelişirse bunlar geçerlidir):\n${Object.entries(brief).map(([k, v]) => `- ${k}: ${v}`).join("\n")}`
    : "";
  const imgText = images.length ? `\n\nEkteki ${images.length} görsel mimarın "bu tarz olsun" dediği referanslar. Cephe dili, malzeme, renk, pencere oranı ve çatı biçimini bunlardan çıkar; style ve materials alanlarına yansıt.` : "";

  let text: string;
  if (revision) {
    text = `Mevcut bina programı (JSON):\n${JSON.stringify(previous)}\n\nMimarın düzeltme isteği:\n<duzeltme>\n${revision}\n</duzeltme>\n\nYalnızca istenen değişikliği uygula. İstekle ilgisi olmayan her şeyi (oda adları, alanlar, katlar, imar değerleri, varsayımlar) aynen koru. Değişikliğin yan etkisi varsa (ör. oturum alanı büyümeli) onu da düzelt ve "assumptions" listesine kısa bir not ekle.`;
  } else if (previous) {
    text = `Mevcut bina programı (JSON):\n${JSON.stringify(previous)}\n\nMimarın yeni/ek notları — programı bunlara göre güncelle:\n<notlar>\n${notes}\n</notlar>${briefText}${imgText}`;
  } else {
    text = `Müşteri görüşmesinde alınan mimar notları:\n<notlar>\n${notes}\n</notlar>${briefText}${imgText}`;
  }
  const userContent: Anthropic.Beta.BetaContentBlockParam[] = [
    ...images
      .filter((im) => /^image\/(jpeg|png|webp|gif)$/.test(im.mediaType) && typeof im.data === "string")
      .map((im) => ({ type: "image" as const, source: { type: "base64" as const, media_type: im.mediaType as "image/jpeg", data: im.data } })),
    { type: "text", text },
  ];

  const apiKey = opts.getApiKey();
  if (!apiKey) {
    res.status(401).json({ error: opts.desktop ? "API anahtarı girilmemiş. Sağ üstteki Ayarlar'dan Claude API anahtarınızı girin." : "ANTHROPIC_API_KEY tanımlı değil (.env dosyasına bakın)." });
    return;
  }
  const client = new Anthropic({ apiKey });
  // Kullanıcı "Durdur"a basarsa (bağlantı kapanırsa) Claude çağrısını da kes
  let aborted = false;
  let current: { abort: () => void } | null = null;
  res.on("close", () => {
    if (!res.writableEnded) { aborted = true; current?.abort(); }
  });
  /** strict: yapılandırılmış çıktı (gramer); değilse şema talimatla verilir, yanıt zod ile doğrulanır */
  /** strict: yapılandırılmış çıktı (gramer). Değilse şema bir aracın girdi şeması olarak verilir; yanıt zod ile doğrulanır. */
  let forceTool = true;
  const call = async (strict: boolean) => {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: strict ? { effort: "medium", format: betaZodOutputFormat(ProgramWireSchema) } : { effort: "medium" },
      system: strict ? SYSTEM_PROMPT : `${SYSTEM_PROMPT}\n\nProgramı ${TOOL_NAME} aracını çağırarak ver; ayrıca metin yazma.`,
      ...(strict
        ? {}
        : {
            tools: [{ name: TOOL_NAME, description: "Çıkardığın bina programını bu araçla ver. Şemadaki tüm alanları doldur.", input_schema: WIRE_JSON_SCHEMA }],
            tool_choice: forceTool ? { type: "tool" as const, name: TOOL_NAME } : { type: "auto" as const },
          }),
      messages: [{ role: "user", content: userContent }],
    });
    current = stream;
    return stream.finalMessage().catch((e) => {
      if (aborted) return null;
      throw e;
    });
  };
  try {
    let strict = !strictRejected;
    const msg = await call(strict).catch((e) => {
      // Gramer sınırı aşılırsa araç şemalı moda geç
      if (strict && e instanceof Anthropic.BadRequestError && /grammar|schema/i.test(e.message)) { strict = false; strictRejected = true; return call(false); }
      throw e;
    }).catch((e) => {
      // Zorunlu araç seçimi kabul edilmezse serbest seçimle tekrar dene
      if (!strict && forceTool && e instanceof Anthropic.BadRequestError && /tool_choice|thinking/i.test(e.message)) { forceTool = false; return call(false); }
      throw e;
    });
    if (!msg) return;

    if (msg.stop_reason === "refusal") {
      res.status(422).json({ error: "Model bu isteği işlemedi. Notları gözden geçirip tekrar deneyin." });
      return;
    }
    if (msg.stop_reason === "max_tokens") {
      res.status(502).json({ error: "Yanıt yarıda kesildi. Notları kısaltıp tekrar deneyin." });
      return;
    }
    let wire: ProgramWire | null = null;
    let raw: unknown = null;
    let parseError = "";
    if (strict) {
      wire = (msg.parsed_output as ProgramWire | null) ?? null;
      raw = wire;
    } else {
      const tu = msg.content.find((c) => c.type === "tool_use");
      raw = tu && "input" in tu ? tu.input : msg.content.map((c) => (c.type === "text" ? c.text : "")).join("");
      if (raw && typeof raw === "object") {
        const r = ProgramWireSchema.safeParse(fillDefaults(structuredClone(raw)));
        if (r.success) wire = r.data;
        else parseError = r.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      }
    }
    if (!wire && parseError) {
      res.status(502).json({ error: `Claude'un yanıtı bina programı şemasına uymadı (${parseError}). Tekrar deneyin.`, raw });
      return;
    }
    const program = wire ? normalizeProgram(wire) : null;
    if (!program) {
      res.status(502).json({ error: "Modelden geçerli bir bina programı alınamadı." });
      return;
    }
    const fixed = sanitize(program);
    const warnings = repairProgram(fixed);
    res.json({ program: fixed, warnings, raw, usage: msg.usage, model: msg.model });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || (err instanceof Anthropic.AnthropicError && /authentication/i.test(err.message))) {
      res.status(401).json({ error: "Claude API anahtarı geçersiz. Anahtarı kontrol edin." });
    } else if (err instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: "API hız sınırına takıldı, biraz sonra tekrar deneyin." });
    } else if (err instanceof Anthropic.APIError) {
      res.status(502).json({ error: `Claude API hatası (${err.status}): ${err.message}` });
    } else {
      console.error(err);
      res.status(500).json({ error: "Sunucu hatası: " + (err as Error).message });
    }
  }
});


  if (opts.staticDir && fs.existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(opts.staticDir!, "index.html")));
  }
  return app;
}

/** Talimatlı modda eksik bırakılabilecek alanları doldurur (şema doğrulamasından önce). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fillDefaults(o: any) {
  if (!o || typeof o !== "object") return o;
  const room = (r: any) => ({ note: "", ...r });
  o.blockSpacing ??= null;
  o.adjacencies ??= [];
  o.assumptions ??= [];
  o.openQuestions ??= [];
  if (Array.isArray(o.floors)) o.floors = o.floors.map((f: any) => ({ ...f, rooms: (f?.rooms ?? []).map(room) }));
  if (Array.isArray(o.unitTypes)) o.unitTypes = o.unitTypes.map((u: any) => ({ duplex: false, ...u, rooms: (u?.rooms ?? []).map((r: any) => ({ upper: false, ...room(r) })) }));
  if (Array.isArray(o.blocks)) o.blocks = o.blocks.map((b: any) => ({ sameAs: "", ...b, floors: (b?.floors ?? []).map((f: any) => ({ units: [], ...f, rooms: (f?.rooms ?? []).map(room) })) }));
  if (Array.isArray(o.adjacencies)) o.adjacencies = o.adjacencies.map((a: any) => ({ reason: "", ...a }));
  return o;
}

// Modelden gelen sayıları makul aralıklara çeker.
function sanitize(p: Program): Program {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
  p.floorHeight = clamp(p.floorHeight, 2.6, 6);
  p.footprint.width = clamp(p.footprint.width, 4, 120);
  p.footprint.depth = clamp(p.footprint.depth, 4, 80);
  p.site.width = Math.max(p.site.width || 0, p.footprint.width + 6);
  p.site.depth = Math.max(p.site.depth || 0, p.footprint.depth + 6);
  p.adjacencies = Array.isArray(p.adjacencies) ? p.adjacencies.slice(0, 12) : [];
  p.unitTypes = Array.isArray(p.unitTypes) ? p.unitTypes.map((u) => ({ ...u, rooms: u.rooms.map((r) => ({ ...r, area: clamp(r.area, 1, 300) })) })) : [];
  p.blocks = Array.isArray(p.blocks) ? p.blocks.slice(0, 12).map((b) => ({
    ...b,
    footprint: { width: clamp(b.footprint.width, 6, 120), depth: clamp(b.footprint.depth, 6, 80) },
    floors: b.floors.map((f) => ({ ...f, level: Math.round(f.level), units: (f.units ?? []).slice(0, 12) })).sort((a, c) => a.level - c.level),
  })) : [];
  if (p.blocks.length) {
    p.footprint = { ...p.blocks[0].footprint };
    p.adjacencies = [];
  }
  p.floors = p.floors
    .filter((f) => f.rooms.length > 0)
    .map((f) => ({ ...f, level: Math.round(f.level), rooms: f.rooms.map((r) => ({ ...r, area: clamp(r.area, 1, 500) })) }))
    .sort((a, b) => a.level - b.level);
  return p;
}


