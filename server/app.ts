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
app.use(express.json({ limit: "2mb" }));


app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: MODEL, hasKey: Boolean(opts.getApiKey()), desktop: Boolean(opts.desktop) });
});

app.post("/api/generate", async (req, res) => {
  const notes: string = String(req.body?.notes ?? "").trim();
  const previous: Program | undefined = req.body?.previous;
  if (notes.length < 10) {
    res.status(400).json({ error: "Not çok kısa. Müşterinin isteklerini biraz daha detaylı yazın." });
    return;
  }

  const userContent = previous
    ? `Mevcut bina programı (JSON):\n${JSON.stringify(previous)}\n\nMimarın yeni/ek notları — programı bunlara göre güncelle:\n<notlar>\n${notes}\n</notlar>`
    : `Müşteri görüşmesinde alınan mimar notları:\n<notlar>\n${notes}\n</notlar>`;

  const apiKey = opts.getApiKey();
  if (!apiKey) {
    res.status(401).json({ error: opts.desktop ? "API anahtarı girilmemiş. Sağ üstteki Ayarlar'dan Claude API anahtarınızı girin." : "ANTHROPIC_API_KEY tanımlı değil (.env dosyasına bakın)." });
    return;
  }
  const client = new Anthropic({ apiKey });
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(ProgramSchema) },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });
    const msg = await stream.finalMessage();

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
  p.footprint.width = clamp(p.footprint.width, 4, 80);
  p.footprint.depth = clamp(p.footprint.depth, 4, 80);
  p.site.width = Math.max(p.site.width || 0, p.footprint.width + 6);
  p.site.depth = Math.max(p.site.depth || 0, p.footprint.depth + 6);
  p.adjacencies = Array.isArray(p.adjacencies) ? p.adjacencies.slice(0, 12) : [];
  p.floors = p.floors
    .filter((f) => f.rooms.length > 0)
    .map((f) => ({ ...f, level: Math.round(f.level), rooms: f.rooms.map((r) => ({ ...r, area: clamp(r.area, 1, 500) })) }))
    .sort((a, b) => a.level - b.level);
  return p;
}


