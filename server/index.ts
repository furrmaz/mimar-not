import "dotenv/config";
import path from "node:path";
import { createApp } from "./app";

const PORT = Number(process.env.PORT ?? 8787);
const app = createApp({
  getApiKey: () => process.env.ANTHROPIC_API_KEY,
  getHiggsfield: () => (process.env.HF_API_KEY_ID && process.env.HF_API_KEY_SECRET ? { keyId: process.env.HF_API_KEY_ID, secret: process.env.HF_API_KEY_SECRET } : undefined),
  staticDir: path.resolve(import.meta.dirname, "../dist"),
});
app.listen(PORT, () => {
  console.log(`Planhane: http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) console.warn("UYARI: ANTHROPIC_API_KEY tanımlı değil. .env dosyası oluşturun.");
});
