// Abonelik planları ve kota hesabı. Fiyat ve haklar PLANS_JSON ortam değişkeniyle değiştirilebilir.
import type { DB, UserRow } from "./db";

export interface Plan {
  id: string;
  label: string;
  /** Aylık fiyat (TL, KDV dahil gösterilir) */
  priceTry: number;
  /** Dönem başına Claude üretimi (yeni proje, notlarla güncelleme, düzeltme) */
  generate: number;
  /** Dönem başına gerçekçi render */
  render: number;
  features: string[];
  highlight?: boolean;
}

export const DEFAULT_PLANS: Plan[] = [
  { id: "baslangic", label: "Başlangıç", priceTry: 990, generate: 25, render: 10, features: ["Ayda 25 proje üretimi / düzeltme", "Ayda 10 gerçekçi render", "Tüm çizimler, DXF, IFC, PDF", "Windows, Android ve web"] },
  { id: "profesyonel", label: "Profesyonel", priceTry: 1990, generate: 80, render: 40, highlight: true, features: ["Ayda 80 proje üretimi / düzeltme", "Ayda 40 gerçekçi render", "Çok bloklu site projeleri", "Öncelikli destek"] },
  { id: "ofis", label: "Ofis", priceTry: 4490, generate: 250, render: 120, features: ["Ayda 250 proje üretimi / düzeltme", "Ayda 120 gerçekçi render", "Aynı hesapla birden çok cihaz", "Telefonla destek"] },
];

export const TRIAL = { days: 7, generate: 3, render: 2 };

export function loadPlans(): Plan[] {
  const raw = process.env.PLANS_JSON;
  if (!raw) return DEFAULT_PLANS;
  try {
    const list = JSON.parse(raw) as Plan[];
    if (Array.isArray(list) && list.every((p) => p.id && p.label && Number.isFinite(p.generate))) return list;
  } catch { /* yoksay */ }
  console.warn("PLANS_JSON okunamadı, varsayılan planlar kullanılıyor");
  return DEFAULT_PLANS;
}

export function loadTrial() {
  return {
    days: Number(process.env.TRIAL_DAYS ?? TRIAL.days),
    generate: Number(process.env.TRIAL_GENERATE ?? TRIAL.generate),
    render: Number(process.env.TRIAL_RENDER ?? TRIAL.render),
  };
}

const DAY = 86_400_000;
const PERIOD = 30 * DAY;

export type Status = "trial" | "active" | "expired" | "disabled";

export interface Entitlement {
  status: Status;
  plan: Plan | null;
  /** Kotanın sayıldığı dönemin başı / sonu */
  periodStart: number;
  periodEnd: number;
  /** Abonelik ya da deneme bitişi */
  until: number;
  limits: { generate: number; render: number };
  used: { generate: number; render: number };
}

export function entitlement(db: DB, u: UserRow, plans: Plan[], now = Date.now()): Entitlement {
  const trial = loadTrial();
  const plan = u.plan ? plans.find((p) => p.id === u.plan) ?? null : null;
  let status: Status;
  let periodStart: number, periodEnd: number, until: number;
  let limits = { generate: 0, render: 0 };
  if (u.disabled) {
    status = "disabled"; periodStart = now; periodEnd = now; until = now;
  } else if (plan && u.plan_until && u.plan_until > now) {
    status = "active";
    const start = u.plan_start ?? now;
    const n = Math.max(0, Math.floor((now - start) / PERIOD));
    periodStart = start + n * PERIOD;
    periodEnd = Math.min(periodStart + PERIOD, u.plan_until);
    until = u.plan_until;
    limits = { generate: plan.generate, render: plan.render };
  } else if (u.trial_until > now && !u.plan_until) {
    status = "trial";
    periodStart = u.created_at; periodEnd = u.trial_until; until = u.trial_until;
    limits = { generate: trial.generate, render: trial.render };
  } else {
    status = "expired"; periodStart = now; periodEnd = now; until = u.plan_until ?? u.trial_until;
  }
  const row = db
    .prepare("SELECT SUM(kind='generate') AS g, SUM(kind='render') AS r FROM usage WHERE user_id=? AND ok=1 AND at>=? AND at<?")
    .get(u.id, periodStart, Math.max(periodEnd, now + 1)) as { g: number | null; r: number | null };
  return { status, plan, periodStart, periodEnd, until, limits, used: { generate: row.g ?? 0, render: row.r ?? 0 } };
}

/** Claude fiyatları (USD / 1M token), maliyet kaydı için. */
const PRICES: [RegExp, number, number][] = [
  [/opus-5-5/, 4, 20],
  [/opus/, 5, 25],
  [/sonnet-5-5|sonnet-5/, 2, 10],
  [/sonnet/, 3, 15],
  [/haiku-5-5/, 0.1, 0.5],
  [/haiku/, 1, 5],
  [/fable|mythos/, 8, 40],
];
export function claudeCost(model: string, usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | undefined) {
  if (!usage) return 0;
  const [, pin, pout] = PRICES.find(([re]) => re.test(model)) ?? [null, 5, 25];
  const input = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) * 1.25 + (usage.cache_read_input_tokens ?? 0) * 0.1;
  return (input * pin + (usage.output_tokens ?? 0) * pout) / 1e6;
}
