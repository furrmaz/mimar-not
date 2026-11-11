// Bulut sunucusu uçtan uca testi (sahte Claude ve Higgsfield ile): npm run test:cloud
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDB } from "./db";
import { writeRenderPrompt } from "../src/shared/renderprompt";
import { createCloudApp } from "./server";
import { SAMPLE_PROGRAM } from "../src/sample";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mn-"));
const db = openDB(dir);
let delay = 300;
const fake = () => ({
  beta: { messages: { stream: () => ({ finalMessage: async () => { await new Promise((r) => setTimeout(r, delay)); return { stop_reason: "end_turn", parsed_output: { ...structuredClone(SAMPLE_PROGRAM), facade: { wallColor: "#fff", accentColor: "#ccc", frameColor: "#333", roofColor: "#a33", windowStyle: "kare", accentPlacement: "zemin", balconyRail: "metal", shutters: false, cornice: false }, unitTypes: [], blocks: [], blockSpacing: 0, requirements: [], imageReadings: [] }, content: [], usage: { input_tokens: 9000, output_tokens: 15000 }, model: "claude-opus-5-5" }; } }) } },
}) as never;
const hfFetch: typeof fetch = async (url, init) => {
  const u = String(url);
  if (u.endsWith("/files/generate-upload-url")) return Response.json({ public_url: "https://x/img.png", upload_url: "https://up/x" });
  if (u.startsWith("https://up/")) return new Response("", { status: 200 });
  if (u.includes("/xai/") || u.includes("/alibaba/")) return Response.json({ status_url: "https://hf/requests/1/status" });
  if (u.endsWith("/status")) return Response.json({ status: "completed", images: [{ url: "https://img/out.png" }] });
  if (u === "https://img/out.png") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
  return new Response("nf " + u + " " + init?.method, { status: 404 });
};
const app = createCloudApp({ db, anthropicKey: "x", adminToken: "admin-secret-123", payment: { bank: "B", holder: "H", iban: "TR00", email: "a@b.c", whatsapp: "905", company: "", address: "" }, claudeClient: fake, higgsfield: { keyId: "k", secret: "s" }, renderFetch: hfFetch });
const srv = app.listen(0);
const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
const call = async (p: string, o: { body?: unknown; tok?: string; admin?: boolean; method?: string } = {}) => {
  const r = await fetch(base + p, { method: o.method ?? (o.body ? "POST" : "GET"), headers: { "Content-Type": "application/json", ...(o.tok ? { Authorization: `Bearer ${o.tok}` } : {}), ...(o.admin ? { "X-Admin-Token": "admin-secret-123" } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
  return { s: r.status, j: await r.json().catch(() => null) as any };
};
const ok = (c: boolean, m: string) => { console.log(c ? "✓" : "✗", m); if (!c) process.exitCode = 1; };
const wait = async (tok: string, id: string) => { for (;;) { await new Promise((r) => setTimeout(r, 100)); const r = await call(`/api/jobs/${id}`, { tok }); if (r.j.status !== "running") return r; } };

(async () => {
  let r = await call("/api/auth/register", { body: { email: "Mimar@Ofis.com", password: "short", acceptTerms: true } });
  ok(r.s === 400, "kısa parola reddedildi");
  r = await call("/api/auth/register", { body: { email: "mimar@ofis.com", password: "parola1234", name: "Ayşe", acceptTerms: false } });
  ok(r.s === 400, "koşul onayı zorunlu");
  r = await call("/api/auth/register", { body: { email: "Mimar@Ofis.com", password: "parola1234", name: "Ayşe", office: "Atölye", acceptTerms: true } });
  ok(r.s === 200 && r.j.me.status === "trial" && r.j.me.limits.generate === 3, "kayıt + deneme");
  const tok = r.j.token;
  r = await call("/api/auth/register", { body: { email: "mimar@ofis.com", password: "parola1234", acceptTerms: true } });
  ok(r.s === 409, "aynı e-posta reddedildi");
  r = await call("/api/auth/login", { body: { email: "mimar@ofis.com", password: "yanlis" } });
  ok(r.s === 401, "yanlış parola");
  r = await call("/api/auth/login", { body: { email: "MIMAR@ofis.com", password: "parola1234" } });
  ok(r.s === 200, "giriş");
  ok((await call("/api/me")).s === 401, "belirteçsiz /me 401");
  // 3 üretim
  for (let i = 0; i < 3; i++) {
    r = await call("/api/jobs/generate", { tok, body: { notes: "2 katlı villa, 3 yatak odası, bahçe" } });
    ok(r.s === 200 && r.j.id, `iş ${i + 1} başladı`);
    if (i === 0) { const c = await call("/api/jobs/generate", { tok, body: { notes: "2 katlı villa, 3 yatak odası" } }); ok(c.s === 409, "eşzamanlı ikinci üretim reddedildi"); }
    const w = await wait(tok, r.j.id);
    ok(w.j.status === "done" && w.j.result.program?.floors?.length > 0 && w.j.me.used.generate === i + 1, `iş ${i + 1} bitti, sayaç ${w.j.me?.used.generate}`);
    if (w.j.status !== "done") console.log(w.j);
  }
  r = await call("/api/jobs/generate", { tok, body: { notes: "2 katlı villa, 3 yatak odası" } });
  ok(r.s === 402 && r.j.code === "quota", "deneme kotası doldu: " + r.j.error);
  // iptal edilen iş haktan düşmez
  // admin
  ok((await call("/api/admin/stats")).s === 401, "admin parolasız 401");
  const st = await call("/api/admin/stats", { admin: true });
  ok(st.s === 200 && st.j.users === 1 && st.j.monthGenerations === 3 && st.j.monthCostUsd > 0.9, `istatistik maliyet $${st.j.monthCostUsd}`);
  const us = await call("/api/admin/users?q=mn-0001", { admin: true });
  ok(us.j.length === 1, "MN-0001 araması");
  const uid = us.j[0].id;
  r = await call(`/api/admin/users/${uid}/activate`, { admin: true, body: { plan: "profesyonel", months: 3, note: "dekont 123" } });
  ok(r.s === 200 && r.j.status === "active" && r.j.limits.generate === 80 && r.j.used.generate === 0, "abonelik açıldı, dönem sıfırlandı");
  r = await call(`/api/admin/users/${uid}`, { admin: true });
  ok(r.j.payments[0].amount_try === 5970, "ödeme kaydı 3×1990");
  // abone iken üretim + iptal
  delay = 3000;
  r = await call("/api/jobs/generate", { tok, body: { notes: "2 katlı villa, 3 yatak odası" } });
  await call(`/api/jobs/${r.j.id}`, { tok, method: "DELETE" });
  const w = await wait(tok, r.j.id);
  ok(w.j.status === "error" && w.j.errorStatus === 499, "iptal edildi");
  ok((await call("/api/me", { tok })).j.used.generate === 0, "iptal haktan düşmedi");
  delay = 10;
  // render
  r = await call("/api/jobs/render", { tok, body: { view: "data:image/png;base64,AAAA", prompt: "x", modelId: "custom", customPath: "/pahali/model" } });
  const rw = await wait(tok, r.j.id);
  ok(rw.j.status === "done" && rw.j.result.data.startsWith("data:image/png;base64,") && rw.j.me.used.render === 1, "render bitti (özel model listedekine çevrildi)");
  {
    // Claude talimatı: sahte istemci metin döndürmezse şablona düşer, render yine çalışır
    const camera = { height: 1.6, distance: 25, pitch: 2, focal: 32, buildingHeight: 9, facades: [{ name: "front", where: "left" }, { name: "right", where: "right" }], frame: { x0: 0.2, x1: 0.8, y0: 0.25, y1: 0.85 } };
    const r2 = await call("/api/jobs/render", { tok, body: { view: "data:image/jpeg;base64,AAAA", prompt: "", modelId: "qwen", autoPrompt: true, program: SAMPLE_PROGRAM, camera, extra: "gün batımı" } });
    const w2 = await wait(tok, r2.j.id);
    ok(w2.j.status === "done" && (w2.j.result.promptSource === "template" && /eye-level street view/.test(w2.j.result.prompt) && /gün batımı/.test(w2.j.result.prompt)), "otomatik talimat: Claude yanıtsızsa kamera bilgili şablon");
    const fakeText = { beta: { messages: { stream: () => ({ finalMessage: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "Turn this 3D model render into a photorealistic photograph from the identical eye-level camera viewpoint, two storeys, white render walls, timber accents, sunset light." }], usage: { input_tokens: 3000, output_tokens: 300 }, model: "claude-opus-5-5" }) }) } } } as never;
    const wp = await writeRenderPrompt(fakeText, { view: "data:image/jpeg;base64,AAAA", program: SAMPLE_PROGRAM, camera: camera as never });
    ok(wp.source === "claude" && wp.prompt.startsWith("Turn this 3D model"), "Claude talimatı kullanıldı");
  }
  if (rw.j.status !== "done") console.log(rw.j);
  // başka kullanıcı işi göremez
  const other = await call("/api/auth/register", { body: { email: "b@c.de", password: "parola1234", acceptTerms: true } });
  ok((await call(`/api/jobs/${r.j.id}`, { tok: other.j.token })).s === 404, "başkasının işi görünmez");
  // parola sıfırlama
  r = await call(`/api/admin/users/${uid}/reset-password`, { admin: true, body: {} });
  ok((await call("/api/me", { tok })).s === 401, "sıfırlamada oturum kapandı");
  ok((await call("/api/auth/login", { body: { email: "mimar@ofis.com", password: r.j.password } })).s === 200, "yeni parolayla giriş");
  // kapatma
  await call(`/api/admin/users/${uid}/update`, { admin: true, body: { disabled: true } });
  ok((await call("/api/auth/login", { body: { email: "mimar@ofis.com", password: r.j.password } })).s === 403, "kapalı hesap giremez");
  srv.close();
  process.exit();
})();
