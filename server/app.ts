import express from "express";
import path from "node:path";
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { generateWithClaude, GenerateError, DEFAULT_MODEL } from "../src/shared/generate";
import { renderWithHiggsfield, type HiggsfieldKeys } from "../src/shared/render";
import { writeRenderPrompt } from "../src/shared/renderprompt";

export interface AppOptions {
  getApiKey: () => string | undefined;
  /** Higgsfield anahtarları (gerçekçi render) */
  getHiggsfield?: () => HiggsfieldKeys | undefined;
  model?: string;
  /** Derlenmiş arayüz klasörü (varsa sunulur) */
  staticDir?: string;
  desktop?: boolean;
}

export function createApp(opts: AppOptions) {
  const MODEL = opts.model ?? process.env.CLAUDE_MODEL ?? DEFAULT_MODEL;
  const app = express();
  app.use(express.json({ limit: "40mb" }));

  app.get("/api/health", (_req, res) => {
    const hf = opts.getHiggsfield?.();
    res.json({ ok: true, model: MODEL, hasKey: Boolean(opts.getApiKey()), hasHiggsfield: Boolean(hf?.keyId && hf?.secret), desktop: Boolean(opts.desktop) });
  });

  app.post("/api/generate", async (req, res) => {
    const apiKey = opts.getApiKey();
    if (!apiKey) {
      res.status(401).json({ error: opts.desktop ? "API anahtarı girilmemiş. Sağ üstteki Ayarlar'dan Claude API anahtarınızı girin." : "ANTHROPIC_API_KEY tanımlı değil (.env dosyasına bakın)." });
      return;
    }
    // Kullanıcı "Durdur"a basarsa (bağlantı kapanırsa) Claude çağrısını da kes
    const ac = new AbortController();
    res.on("close", () => { if (!res.writableEnded) ac.abort(); });
    try {
      const out = await generateWithClaude(new Anthropic({ apiKey }), req.body ?? {}, { model: MODEL, signal: ac.signal });
      if (out) res.json(out);
    } catch (err) {
      if (ac.signal.aborted) return;
      const e = err instanceof GenerateError ? err : new GenerateError(500, "Sunucu hatası: " + (err as Error).message);
      if (e.status >= 500) console.error(err);
      res.status(e.status).json({ error: e.message, raw: e.raw });
    }
  });

  app.post("/api/render", async (req, res) => {
    const keys = opts.getHiggsfield?.() ?? { keyId: process.env.HF_API_KEY_ID ?? "", secret: process.env.HF_API_KEY_SECRET ?? "" };
    const ac = new AbortController();
    res.on("close", () => { if (!res.writableEnded) ac.abort(); });
    try {
      // Talimatı Claude yazar (Claude anahtarı yoksa şablon talimat)
      const apiKey = opts.getApiKey();
      const client = apiKey ? new Anthropic({ apiKey, maxRetries: 1 }) : null;
      const out = await renderWithHiggsfield(req.body, keys, {
        signal: ac.signal,
        writePrompt: (r, refs) => writeRenderPrompt(client, { view: r.view, refs, program: r.program, camera: r.camera, extra: r.extra, modelId: r.modelId }, { model: MODEL, signal: ac.signal }),
      });
      // Görseli sunucuda indirip data URL olarak döndür (tarayıcı CORS'a takılmasın, kaydedilebilsin)
      const img = await fetch(out.url);
      const buf = Buffer.from(await img.arrayBuffer());
      res.json({ ...out, data: `data:${img.headers.get("content-type") ?? "image/png"};base64,${buf.toString("base64")}` });
    } catch (err) {
      if (ac.signal.aborted) return;
      res.status(502).json({ error: (err as Error).message });
    }
  });

  if (opts.staticDir && fs.existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(opts.staticDir!, "index.html")));
  }
  return app;
}
