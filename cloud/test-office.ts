// Ofis yönetimi API testi: npm run test:cloud (cloud/test.ts'ten sonra çalışır)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDB } from "./db";
import { createCloudApp } from "./server";

process.env.OFFICE_TRIAL_QUOTA_MB = "1";
process.env.OFFICE_MAX_FILE_MB = "1";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mn-ofis-"));
const db = openDB(dir);
const app = createCloudApp({ db, anthropicKey: "x", adminToken: "admin-secret-123", filesDir: path.join(dir, "files"), payment: { bank: "", holder: "", iban: "", email: "", whatsapp: "", company: "", address: "" } });
const srv = app.listen(0);
const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
const call = async (p: string, o: { body?: unknown; tok?: string; method?: string; raw?: Uint8Array } = {}) => {
  const r = await fetch(base + p, {
    method: o.method ?? (o.body || o.raw ? "POST" : "GET"),
    headers: { "Content-Type": o.raw ? "application/octet-stream" : "application/json", ...(o.tok ? { Authorization: `Bearer ${o.tok}` } : {}) },
    body: (o.raw as BodyInit | undefined) ?? (o.body ? JSON.stringify(o.body) : undefined),
  });
  const ct = r.headers.get("content-type") ?? "";
  return { s: r.status, j: ct.includes("json") ? await r.json() as any : null, r };
};
const ok = (c: boolean, m: string) => { console.log(c ? "✓" : "✗", "ofis:", m); if (!c) process.exitCode = 1; };

(async () => {
  const reg = async (email: string) => (await call("/api/auth/register", { body: { email, password: "parola1234", acceptTerms: true } })).j.token as string;
  const a = await reg("a@ofis.com");
  const b = await reg("b@ofis.com");
  ok((await call("/api/office")).s === 401, "girişsiz erişim yok");

  let r = await call("/api/office/clients", { tok: a, body: { name: "" } });
  ok(r.s === 400, "adsız müşteri reddedildi");
  r = await call("/api/office/clients", { tok: a, body: { name: "Ahmet Yılmaz", phone: "0532", tax_no: "123" } });
  ok(r.s === 200 && r.j.clients.length === 1, "müşteri eklendi");
  const cid = r.j.id;
  r = await call("/api/office/jobs", { tok: a, body: { title: "Villa projesi", client_id: cid, fee: "250.000,50", status: "xx" } });
  ok(r.s === 200 && r.j.jobs[0].fee === 250000.5 && r.j.jobs[0].status === "devam", "iş eklendi, tutar ve durum düzeltildi");
  const jid = r.j.id;
  ok((await call("/api/office/jobs", { tok: b, body: { title: "x", client_id: cid } })).s === 400, "başka hesabın müşterisine iş bağlanamaz");
  r = await call("/api/office/payments", { tok: a, body: { job_id: jid, date: "2026-11-01", amount: 100000 } });
  ok(r.s === 200 && r.j.payments.length === 1, "tahsilat eklendi");
  ok((await call("/api/office/payments", { tok: a, body: { job_id: jid, date: "01.11.2026", amount: 5 } })).s === 400, "tarih biçimi denetlendi");
  ok((await call("/api/office/payments", { tok: a, body: { job_id: jid, date: "2026-11-01", amount: 0 } })).s === 400, "sıfır tutar reddedildi");
  r = await call("/api/office/expenses", { tok: a, body: { date: "2026-11-02", amount: 1500, category: "Baskı / plotter", job_id: jid } });
  ok(r.s === 200 && r.j.expenses[0].category === "Baskı / plotter", "gider eklendi");
  r = await call("/api/office/jobs", { tok: a, body: { id: jid, status: "tamam" } });
  ok(r.s === 200 && r.j.jobs[0].status === "tamam" && r.j.jobs[0].fee === 250000.5, "iş kısmen güncellendi");
  ok((await call(`/api/office/jobs`, { tok: b, body: { id: jid, status: "iptal" } })).s === 404, "başka hesabın işi güncellenemez");

  // dosyalar
  const bytes = new TextEncoder().encode("{\"pafta\":1}");
  r = await call(`/api/office/files?name=${encodeURIComponent("Ruhsat/projesi.json")}&mime=application/json&job_id=${jid}`, { tok: a, raw: bytes });
  ok(r.s === 200 && r.j.files[0].name === "Ruhsat_projesi.json" && r.j.files[0].client_id === cid && r.j.storage.used === bytes.length, "dosya yüklendi, müşteriye bağlandı");
  const fid = r.j.id;
  const d = await fetch(`${base}/api/office/files/${fid}`, { headers: { Authorization: `Bearer ${a}` } });
  ok(d.status === 200 && (await d.text()) === "{\"pafta\":1}" && /attachment/.test(d.headers.get("content-disposition") ?? ""), "dosya indirildi");
  ok((await call(`/api/office/files/${fid}`, { tok: b })).s === 404, "başka hesap dosyayı göremez");
  ok((await call(`/api/office/files?name=x`, { tok: a, raw: new Uint8Array(1.5 * 1024 * 1024) })).s === 413, "büyük dosya reddedildi");
  await call(`/api/office/files?name=y`, { tok: a, raw: new Uint8Array(900 * 1024) });
  r = await call(`/api/office/files?name=z`, { tok: a, raw: new Uint8Array(200 * 1024) });
  ok(r.s === 413 && r.j.code === "storage", "kota doldu: " + r.j.error);
  r = await call(`/api/office/files/${fid}`, { tok: a, body: { note: "imzalı" } });
  ok(r.s === 200 && r.j.files.find((f: any) => f.id === fid).note === "imzalı", "dosya notu");

  ok((await call(`/api/office/clients/${cid}`, { tok: a, method: "DELETE" })).s === 400, "işi olan müşteri silinmez");
  ok((await call(`/api/office`, { tok: b })).j.jobs.length === 0, "hesaplar birbirini görmez");
  const ex = await call(`/api/office/export`, { tok: a });
  ok(ex.s === 200 && ex.j.format === "planhane-ofis" && ex.j.payments.length === 1, "dışa aktarım");
  r = await call(`/api/office/jobs/${jid}`, { tok: a, method: "DELETE" });
  ok(r.s === 200 && r.j.payments.length === 0 && r.j.expenses[0].job_id === null && r.j.files.find((f: any) => f.id === fid).job_id === null, "iş silindi: tahsilatlar gitti, gider ve dosya kaldı");
  r = await call(`/api/office/files/${fid}`, { tok: a, method: "DELETE" });
  ok(r.s === 200 && r.j.files.length === 1, "dosya silindi");
  srv.close();
  process.exit();
})();
