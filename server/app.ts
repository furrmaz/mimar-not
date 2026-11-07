import express from "express";
import path from "node:path";
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ProgramSchema, type Program } from "../src/shared/schema";
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
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(ProgramSchema) },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });
    // Kullanıcı "Durdur"a basarsa (bağlantı kapanırsa) Claude çağrısını da kes
    let aborted = false;
    res.on("close", () => {
      if (!res.writableEnded) { aborted = true; stream.abort(); }
    });
    const msg = await stream.finalMessage().catch((e) => {
      if (aborted) return null;
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
    const program = msg.parsed_output;
    if (!program) {
      res.status(502).json({ error: "Modelden geçerli bir bina programı alınamadı." });
      return;
    }
    res.json({ program: sanitize(program), usage: msg.usage, model: msg.model });
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


