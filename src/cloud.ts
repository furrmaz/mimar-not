// Mimar Not Bulut istemcisi: hesap, abonelik durumu ve sunucuda çalışan üretim/render işleri.
// Sunucu adresi derlemede VITE_CLOUD_URL ile verilir ("same-origin": uygulamanın sunulduğu adres);
// Ayarlar > Gelişmiş'ten değiştirilebilir.

const URL_KEY = "mimarnot.cloud.url";
const TOKEN_KEY = "mimarnot.cloud.token";
const ME_KEY = "mimarnot.cloud.me";

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* depolama kapalı */ } },
};

export function cloudBase(): string {
  const v = (ls.get(URL_KEY) || import.meta.env.VITE_CLOUD_URL || "").trim();
  if (!v) return "";
  if (v === "same-origin") return location.origin;
  return v.replace(/\/+$/, "");
}
export const cloudConfigured = () => Boolean(cloudBase());
export function setCloudBase(url: string) { ls.set(URL_KEY, url.trim() || null); }
export const cloudBaseOverride = () => ls.get(URL_KEY) ?? "";

export interface Me {
  id: number;
  email: string;
  name: string;
  office: string;
  phone: string;
  ref: string;
  status: "trial" | "active" | "expired" | "disabled";
  plan: { id: string; label: string } | null;
  until: number;
  periodEnd: number;
  limits: { generate: number; render: number };
  used: { generate: number; render: number };
}
export interface Plan { id: string; label: string; priceTry: number; generate: number; render: number; features: string[]; highlight?: boolean }
export interface PublicConfig {
  plans: Plan[];
  trial: { days: number; generate: number; render: number };
  payment: { bank: string; holder: string; iban: string; email: string; whatsapp: string; company?: string; address?: string };
}

export const token = () => ls.get(TOKEN_KEY);
export const signedIn = () => cloudConfigured() && Boolean(token());
export function cachedMe(): Me | null {
  try { return JSON.parse(ls.get(ME_KEY) ?? "null"); } catch { return null; }
}
function setMe(m: Me | null) {
  ls.set(ME_KEY, m ? JSON.stringify(m) : null);
  window.dispatchEvent(new CustomEvent("mimarnot:account", { detail: m }));
}
/** Hesap durumu değişince (giriş, çıkış, kota) çağrılır */
export function onAccount(cb: (m: Me | null) => void) {
  const h = (e: Event) => cb((e as CustomEvent<Me | null>).detail);
  window.addEventListener("mimarnot:account", h);
  return () => window.removeEventListener("mimarnot:account", h);
}
/** Hesap penceresini açma isteği (ör. kota dolunca) */
export function requestAccountDialog(reason?: string) {
  window.dispatchEvent(new CustomEvent("mimarnot:account-dialog", { detail: reason }));
}

export class CloudError extends Error {
  constructor(message: string, public status = 0, public code?: string, public raw?: unknown) { super(message); }
}

async function req<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const base = cloudBase();
  if (!base) throw new CloudError("Sunucu adresi tanımlı değil.");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;
  let res: Response;
  try {
    res = await fetch(base + path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) }, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new CloudError("Mimar Not sunucusuna ulaşılamadı. İnternet bağlantınızı kontrol edin.", 0, "network");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && data.code === "auth") { ls.set(TOKEN_KEY, null); setMe(null); }
    throw new CloudError(data.error ?? `Sunucu hatası (${res.status})`, res.status, data.code, data.raw);
  }
  return data as T;
}

export const getPublicConfig = () => req<PublicConfig>("/api/public/config");

export async function register(a: { email: string; password: string; name: string; office: string; phone: string; acceptTerms: boolean }) {
  const r = await req<{ token: string; me: Me }>("/api/auth/register", { method: "POST", json: { ...a, device: deviceName() } });
  ls.set(TOKEN_KEY, r.token); setMe(r.me);
  return r.me;
}
export async function login(email: string, password: string) {
  const r = await req<{ token: string; me: Me }>("/api/auth/login", { method: "POST", json: { email, password, device: deviceName() } });
  ls.set(TOKEN_KEY, r.token); setMe(r.me);
  return r.me;
}
export async function logout() {
  await req("/api/auth/logout", { method: "POST", json: {} }).catch(() => {});
  ls.set(TOKEN_KEY, null); setMe(null);
}
export async function refreshMe(): Promise<Me | null> {
  if (!signedIn()) return null;
  const m = await req<Me>("/api/me");
  setMe(m);
  return m;
}
export const updateProfile = async (p: Partial<Pick<Me, "name" | "office" | "phone">>) => { const m = await req<Me>("/api/me", { method: "POST", json: p }); setMe(m); return m; };
export const changePassword = (oldPassword: string, newPassword: string) => req("/api/me/password", { method: "POST", json: { oldPassword, newPassword } });

function deviceName() {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /iPhone|iPad/.test(ua) ? "iOS" : "Diğer";
  return `${os} · ${/Electron/.test(ua) ? "masaüstü" : (window as { Capacitor?: unknown }).Capacitor ? "uygulama" : "tarayıcı"}`;
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((ok, no) => {
  const t = setTimeout(ok, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); no(new DOMException("Durduruldu", "AbortError")); }, { once: true });
});

/** Sunucuda iş başlatır ve bitene kadar durumunu sorgular. Kısa bağlantı kopmalarını tolere eder. */
export async function runJob<T>(kind: "generate" | "render", body: unknown, opts: { signal?: AbortSignal; onStatus?: (s: string) => void } = {}): Promise<T> {
  let id: string;
  try {
    id = (await req<{ id: string }>(`/api/jobs/${kind}`, { method: "POST", json: body, signal: opts.signal })).id;
  } catch (e) {
    if (e instanceof CloudError && (e.status === 402 || e.status === 401 || e.status === 403)) requestAccountDialog(e.message);
    throw e;
  }
  const cancel = () => { void req(`/api/jobs/${id}`, { method: "DELETE" }).catch(() => {}); };
  opts.signal?.addEventListener("abort", cancel, { once: true });
  let misses = 0;
  try {
    for (;;) {
      await sleep(2000, opts.signal);
      let st: { status: string; stage?: string; elapsed?: number; result?: T; error?: string; errorStatus?: number; raw?: unknown; me?: Me };
      try {
        st = await req(`/api/jobs/${id}`, { signal: opts.signal });
        misses = 0;
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        if (e instanceof CloudError && e.code === "network" && ++misses < 30) { opts.onStatus?.("Bağlantı bekleniyor…"); continue; }
        throw e;
      }
      if (st.status === "running") { opts.onStatus?.(`${st.stage ?? "Çalışıyor…"}${st.elapsed ? ` (${Math.round(st.elapsed / 1000)} sn)` : ""}`); continue; }
      if (st.status === "error") throw new CloudError(st.error ?? "İş başarısız oldu.", st.errorStatus ?? 502, undefined, st.raw);
      if (st.me) setMe(st.me);
      return st.result as T;
    }
  } finally {
    opts.signal?.removeEventListener("abort", cancel);
  }
}

export const remaining = (m: Me | null, k: "generate" | "render") => (m ? Math.max(0, m.limits[k] - m.used[k]) : 0);
export const fmtDate = (t: number) => new Date(t).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
export const fmtTry = (n: number) => `${n.toLocaleString("tr-TR")} TL`;
