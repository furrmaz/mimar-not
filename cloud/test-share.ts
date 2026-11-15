// Paylaşım bağlantısı API testi: npm run test:cloud
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDB } from "./db";
import { createCloudApp } from "./server";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mn-paylas-"));
const db = openDB(dir);
const app = createCloudApp({ db, anthropicKey: "x", adminToken: "admin-secret-123", filesDir: path.join(dir, "files"), payment: { bank: "", holder: "", iban: "", email: "", whatsapp: "", company: "", address: "" } });
const srv = app.listen(0);
const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
const call = async (p: string, o: { body?: unknown; tok?: string; method?: string } = {}) => {
  const r = await fetch(base + p, { method: o.method ?? (o.body ? "POST" : "GET"), headers: { "Content-Type": "application/json", ...(o.tok ? { Authorization: `Bearer ${o.tok}` } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
  return { s: r.status, j: await r.json().catch(() => null) as any };
};
const ok = (c: boolean, m: string) => { console.log(c ? "✓" : "✗", "paylaşım:", m); if (!c) process.exitCode = 1; };

(async () => {
  const reg = async (email: string) => (await call("/api/auth/register", { body: { email, password: "parola1234", acceptTerms: true, office: "Deneme Mimarlık" } })).j.token as string;
  const a = await reg("a@paylas.com");
  const b = await reg("b@paylas.com");
  const program = { projectName: "Yılmaz Konutu", floors: [{ level: 0, name: "Zemin", rooms: [] }], footprint: { width: 10, depth: 8 } };
  ok((await call("/api/share", { body: { program } })).s === 401, "girişsiz bağlantı açılamaz");
  ok((await call("/api/share", { body: { program: { x: 1 } }, tok: a })).s === 400, "geçersiz proje reddedilir");
  const c = await call("/api/share", { body: { program, projectId: "p1" }, tok: a });
  ok(c.s === 200 && /^[A-Za-z0-9_-]{20}$/.test(c.j.token), "bağlantı oluşur");
  const t = c.j.token as string;
  const again = await call("/api/share", { body: { program: { ...program, projectName: "Yılmaz Konutu v2" }, projectId: "p1" }, tok: a });
  ok(again.j.token === t && again.j.updated === true, "aynı proje aynı bağlantıyı günceller");
  const pub = await call(`/api/public/share/${t}`);
  ok(pub.s === 200 && pub.j.program.projectName === "Yılmaz Konutu v2" && pub.j.office === "Deneme Mimarlık" && pub.j.comments.length === 0, "bağlantı girişsiz açılır, güncel proje gelir");
  ok((await call("/api/public/share/yanlisyanlisyanlis12")).s === 404, "hatalı bağlantı 404");
  ok((await call(`/api/public/share/${t}/comments`, { body: { name: "Ayşe", text: "" } })).s === 400, "boş yorum reddedilir");
  const cm = await call(`/api/public/share/${t}/comments`, { body: { name: "Ayşe", text: "Salon biraz daha büyük olabilir mi?" } });
  ok(cm.s === 200 && cm.j.comments.length === 1 && cm.j.comments[0].ip === undefined, "yorum eklenir, IP dönmez");
  ok((await call(`/api/share/${t}/comments`, { tok: b })).s === 404, "başka hesap yorumları göremez");
  const list = await call("/api/share", { tok: a });
  ok(list.j.shares.length === 1 && list.j.shares[0].comments === 1 && list.j.shares[0].views >= 1, "mimar listesinde yorum ve görüntülenme sayısı");
  ok((await call("/api/share", { tok: b })).j.shares.length === 0, "başka hesabın listesi boş");
  ok((await call(`/api/share/${t}`, { tok: b, method: "DELETE" })).s === 404, "başka hesap bağlantıyı kapatamaz");
  ok((await call(`/api/share/${t}`, { tok: a, method: "DELETE" })).s === 200, "mimar bağlantıyı kapatır");
  ok((await call(`/api/public/share/${t}`)).s === 404, "kapatılan bağlantı açılmaz");
  let limited = false;
  const c2 = await call("/api/share", { body: { program, projectId: "p2" }, tok: a });
  for (let i = 0; i < 12; i++) if ((await call(`/api/public/share/${c2.j.token}/comments`, { body: { text: `yorum ${i}` } })).s === 429) limited = true;
  ok(limited, "yorumlarda hız sınırı");
  srv.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
})();
