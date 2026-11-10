// Mimar Not Bulut: giriş noktası. Ortam değişkenleri için docs/SATIS-KURULUM.md ve cloud/.env.example.
import "dotenv/config";
import express from "express";
import path from "node:path";
import fs from "node:fs";
import { openDB } from "./db";
import { createCloudApp } from "./server";

const env = (k: string, d = "") => (process.env[k] ?? d).trim();
const anthropicKey = env("ANTHROPIC_API_KEY");
const adminToken = env("ADMIN_TOKEN");
if (!anthropicKey) console.warn("UYARI: ANTHROPIC_API_KEY tanımlı değil; üretimler başarısız olur.");
if (adminToken.length < 12) console.warn("UYARI: ADMIN_TOKEN tanımlı değil ya da çok kısa (en az 12 karakter); yönetim paneli kapalı.");

const db = openDB(env("DATA_DIR", "./data"));
const hfId = env("HF_API_KEY_ID"), hfSecret = env("HF_API_KEY_SECRET");
const api = createCloudApp({
  db,
  anthropicKey,
  model: env("CLAUDE_MODEL") || undefined,
  higgsfield: hfId && hfSecret ? { keyId: hfId, secret: hfSecret } : undefined,
  adminToken: adminToken.length >= 12 ? adminToken : "",
  payment: {
    bank: env("PAY_BANK"), holder: env("PAY_HOLDER"), iban: env("PAY_IBAN"),
    email: env("CONTACT_EMAIL"), whatsapp: env("CONTACT_WHATSAPP"),
    company: env("COMPANY_NAME"), address: env("COMPANY_ADDRESS"),
  },
});

const root = env("STATIC_ROOT", process.cwd());
const app = express();
app.disable("x-powered-by");
app.use(api);
// Yönetim paneli
app.use("/admin", express.static(path.join(root, "cloud/public/admin"), { index: "index.html" }));
// Web uygulaması (VITE_CLOUD_URL=same-origin ile derlenmiş)
const web = path.join(root, "dist-web");
if (fs.existsSync(web)) {
  app.use("/app", express.static(web));
  app.get(/^\/app(\/.*)?$/, (_req, res) => res.sendFile(path.join(web, "index.html")));
}
// Tanıtım sitesi, kullanım koşulları, KVKK
const site = path.join(root, "site");
app.use(express.static(site, { extensions: ["html"] }));
app.use((_req, res) => res.status(404).sendFile(path.join(site, "404.html"), (e) => e && res.end()));

const port = Number(env("PORT", "8080"));
app.listen(port, () => console.log(`Mimar Not Bulut http://localhost:${port} (admin: /admin, uygulama: /app)`));
