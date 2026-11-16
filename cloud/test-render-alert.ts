// Higgsfield hesabı hatası (geçersiz anahtar) testi: abone ayar mesajı görmez, Claude çağrılmaz, yönetim paneli uyarılır.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDB } from "./db";
import { createCloudApp } from "./server";
import { normalizeHiggsfieldKeys } from "../src/shared/render";
import { SAMPLE_PROGRAM } from "../src/sample";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mn-render-"));
const db = openDB(dir);
let claudeCalls = 0;
let valid = false;
const fake = () => ({
  beta: { messages: { stream: () => { claudeCalls++; return { finalMessage: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "photo of a house" }], usage: { input_tokens: 10, output_tokens: 5 } }) }; } } },
  messages: { create: async () => { claudeCalls++; return { content: [{ type: "text", text: "photo of a house" }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: "end_turn" }; } },
}) as never;
const hfFetch: typeof fetch = async (url) => {
  const u = String(url);
  if (!valid && u.endsWith("/files/generate-upload-url")) return Response.json({ detail: "Invalid credentials" }, { status: 401 });
  if (u.endsWith("/files/generate-upload-url")) return Response.json({ public_url: "https://x/img.png", upload_url: "https://up/x" });
  return new Response("", { status: 200 });
};
const app = createCloudApp({ db, anthropicKey: "x", adminToken: "admin-secret-123", payment: { bank: "", holder: "", iban: "", email: "", whatsapp: "", company: "", address: "" }, claudeClient: fake, higgsfield: { keyId: "k", secret: "s" }, renderFetch: hfFetch });
const srv = app.listen(0);
const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
const call = async (p: string, o: { body?: unknown; tok?: string; admin?: boolean } = {}) => {
  const r = await fetch(base + p, { method: o.body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(o.tok ? { Authorization: `Bearer ${o.tok}` } : {}), ...(o.admin ? { "X-Admin-Token": "admin-secret-123" } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
  return { s: r.status, j: await r.json().catch(() => null) as any };
};
const ok = (c: boolean, m: string) => { console.log(c ? "✓" : "✗", "render:", m); if (!c) process.exitCode = 1; };

(async () => {
  const k = normalizeHiggsfieldKeys;
  ok(JSON.stringify(k(" abc ", " def\n")) === '{"keyId":"abc","secret":"def"}', "anahtar boşlukları temizlenir");
  ok(JSON.stringify(k("abc:def", "")) === '{"keyId":"abc","secret":"def"}', "KeyID:Secret tek parça ayrılır");
  ok(JSON.stringify(k("abc:def", "eski")) === '{"keyId":"abc","secret":"def"}', "tek parça girilince eski gizli anahtar kullanılmaz");
  ok(JSON.stringify(k('Key "abc"', "'def'")) === '{"keyId":"abc","secret":"def"}', "tırnak ve Key öneki temizlenir");
  ok(k("abc", "") === undefined, "eksik anahtar tanımsız sayılır");

  const tok = (await call("/api/auth/register", { body: { email: "r@test.com", password: "parola1234", acceptTerms: true } })).j.token as string;
  const start = await call("/api/jobs/render", { tok, body: { view: "data:image/jpeg;base64,AAAA", prompt: "", modelId: "qwen", autoPrompt: true, program: SAMPLE_PROGRAM } });
  ok(start.s === 200 && start.j.id, "render işi başladı");
  let st: any;
  for (;;) { await new Promise((r) => setTimeout(r, 80)); st = (await call(`/api/jobs/${start.j.id}`, { tok })).j; if (st.status !== "running") break; }
  ok(st.status === "error" && !/Ayarlar|Key ID|Secret|Higgsfield/.test(st.error) && /hakkınız düşmedi/.test(st.error), "abone anahtar / ayar mesajı görmez");
  ok(claudeCalls === 0, "anahtar geçersizken Claude çağrılmaz (ücret doğmaz)");
  const me = (await call("/api/me", { tok })).j;
  ok(me.used.render === 0, "başarısız render haktan düşmez");
  const set = (await call("/api/admin/settings", { admin: true })).j;
  ok(set.renderAlert && /geçersiz/.test(set.renderAlert.message), "yönetim panelinde render uyarısı görünür");
  valid = true;
  ok((await call("/api/admin/settings/test", { admin: true, body: { kind: "higgsfield" } })).j?.ok === true, "anahtar düzelince deneme geçer");
  ok((await call("/api/admin/settings", { admin: true })).j.renderAlert === null, "başarılı denemeden sonra uyarı kalkar");
  srv.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
})();
