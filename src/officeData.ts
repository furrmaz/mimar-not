// Ofis yönetimi istemcisi: müşteriler, işler, tahsilatlar, giderler ve dosyalar Planhane Bulut'ta, hesaba bağlı.
import { CloudError, cloudBase, req, token } from "./cloud";

export interface Client { id: number; name: string; phone: string; email: string; tax_no: string; address: string; note: string; created_at: number; updated_at: number }
export type JobStatus = "teklif" | "devam" | "tamam" | "iptal";
export interface Job { id: number; client_id: number | null; title: string; status: JobStatus; fee: number; start_date: string; due_date: string; project_id: string; project_title: string; note: string; created_at: number; updated_at: number }
export interface Payment { id: number; job_id: number; date: string; amount: number; method: string; note: string; created_at: number }
export interface Expense { id: number; job_id: number | null; date: string; amount: number; category: string; vendor: string; note: string; created_at: number }
export interface OfficeFile { id: number; job_id: number | null; client_id: number | null; name: string; mime: string; size: number; note: string; created_at: number }
export interface OfficeData {
  clients: Client[]; jobs: Job[]; payments: Payment[]; expenses: Expense[]; files: OfficeFile[];
  storage: { used: number; quota: number; maxFile: number };
}
export type Entity = "clients" | "jobs" | "payments" | "expenses";

export const JOB_STATUS: Record<JobStatus, string> = { teklif: "Teklif", devam: "Devam ediyor", tamam: "Tamamlandı", iptal: "İptal" };
export const EXPENSE_CATEGORIES = ["Kira", "Maaş / SGK", "Vergi / harç", "Yazılım / abonelik", "Baskı / plotter", "Ulaşım / yakıt", "Danışman / mühendis", "Fatura (elektrik, internet…)", "Malzeme / maket", "Diğer"];
export const PAYMENT_METHODS = ["Havale / EFT", "Nakit", "Kredi kartı", "Çek / senet"];

export const loadOffice = () => req<OfficeData>("/api/office");
export const saveRow = (ent: Entity, row: Record<string, unknown>) => req<OfficeData & { id: number }>(`/api/office/${ent}`, { method: "POST", json: row });
export const deleteRow = (ent: Entity | "files", id: number) => req<OfficeData>(`/api/office/${ent}/${id}`, { method: "DELETE" });
export const updateFile = (id: number, p: { name?: string; note?: string; job_id?: number | null }) => req<OfficeData>(`/api/office/files/${id}`, { method: "POST", json: p });

async function raw(path: string, init: RequestInit = {}) {
  const base = cloudBase();
  if (!base) throw new CloudError("Sunucu adresi tanımlı değil.");
  let res: Response;
  try {
    res = await fetch(base + path, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token() ?? ""}` } });
  } catch {
    throw new CloudError("Planhane sunucusuna ulaşılamadı. İnternet bağlantınızı kontrol edin.", 0, "network");
  }
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new CloudError(d.error ?? (res.status === 413 ? "Dosya çok büyük." : `Sunucu hatası (${res.status})`), res.status, d.code);
  }
  return res;
}

/** Dosya yükler (gövde ham bayt; JSON ayrıştırıcıya takılmasın diye her zaman octet-stream) */
export async function uploadFile(f: File, link: { job_id?: number | null; client_id?: number | null; note?: string }) {
  const q = new URLSearchParams({ name: f.name, mime: f.type || "" });
  if (link.job_id) q.set("job_id", String(link.job_id));
  if (link.client_id) q.set("client_id", String(link.client_id));
  if (link.note) q.set("note", link.note);
  const res = await raw(`/api/office/files?${q}`, { method: "POST", body: f, headers: { "Content-Type": "application/octet-stream" } });
  return (await res.json()) as OfficeData & { id: number };
}
export async function downloadFile(f: OfficeFile): Promise<Blob> {
  const res = await raw(`/api/office/files/${f.id}`);
  const b = await res.blob();
  return f.mime ? new Blob([b], { type: f.mime }) : b;
}
export async function exportAll(): Promise<Blob> {
  return (await raw("/api/office/export")).blob();
}

// ---------- hesaplar ----------
export const money = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} TL`;
export const fmtDay = (iso: string) => (iso ? iso.split("-").reverse().join(".") : "");
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const fmtSize = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${b ? Math.max(1, Math.round(b / 1024)) : 0} KB`);

export interface JobBalance { paid: number; due: number; expense: number }
export function balances(d: OfficeData) {
  const m = new Map<number, JobBalance>();
  for (const j of d.jobs) m.set(j.id, { paid: 0, due: 0, expense: 0 });
  for (const p of d.payments) { const b = m.get(p.job_id); if (b) b.paid += p.amount; }
  for (const e of d.expenses) { const b = e.job_id != null ? m.get(e.job_id) : undefined; if (b) b.expense += e.amount; }
  for (const j of d.jobs) { const b = m.get(j.id)!; b.due = j.status === "iptal" || j.status === "teklif" ? 0 : Math.max(0, j.fee - b.paid); }
  return m;
}

/** Excel'in Türkçe ayarlarıyla doğrudan açılan CSV (noktalı virgül, ondalık virgül, UTF-8 BOM) */
export function toCsv(head: string[], rows: (string | number)[][]) {
  const cell = (v: string | number) => {
    const s = typeof v === "number" ? String(Math.round(v * 100) / 100).replace(".", ",") : v;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return new Blob(["﻿" + [head, ...rows].map((r) => r.map(cell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
}
