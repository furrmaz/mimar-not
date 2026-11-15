// Uygulamanın çalıştığı ortam: masaüstü (Electron + yerel sunucu), geliştirme sunucusu,
// ya da sunucusuz sürümler (web paneli ve Android). Sunucusuz sürümde Claude ve Higgsfield
// doğrudan cihazdan çağrılır; anahtarlar yalnız bu cihazda (tarayıcı/uygulama deposu) saklanır.
import type { GenerateRequest, GenerateResult } from "./shared/generate";
import type { RenderRequest } from "./shared/render";
import { desktop } from "./desktop";
import { CloudError, cloudConfigured, requestAccountDialog, runJob, signedIn } from "./cloud";

type Cap = { isNativePlatform?: () => boolean; getPlatform?: () => string };
const cap = (): Cap | undefined => (window as unknown as { Capacitor?: Cap }).Capacitor;

/** Web paneli ve Android derlemesi (VITE_STANDALONE=1): sunucu yok */
export const STANDALONE = import.meta.env.VITE_STANDALONE === "1" && !desktop;
export const isNative = () => Boolean(cap()?.isNativePlatform?.());
export const platformName = () => (desktop ? "Masaüstü" : isNative() ? "Android" : STANDALONE ? "Web paneli" : "Tarayıcı");
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? "";

const KEYS = "mimarnot.keys";
export interface LocalKeys { claude?: string; hfId?: string; hfSecret?: string }
export function loadKeys(): LocalKeys {
  try { return JSON.parse(localStorage.getItem(KEYS) ?? "{}"); } catch { return {}; }
}
export function saveKeys(k: LocalKeys) {
  try { localStorage.setItem(KEYS, JSON.stringify(k)); } catch { /* depolama kapalı */ }
}

/** Android'de yerel HTTP katmanı tarafından yamalanmamış (akış destekli) tarayıcı fetch'i */
const webFetch = (): typeof fetch => {
  const w = window as unknown as { CapacitorWebFetch?: typeof fetch };
  return (w.CapacitorWebFetch ?? window.fetch).bind(window);
};

/** Yalnız otomatik testler için: API adresini sahte sunucuya yönlendirir */
const testBase = (k: string) => { try { return localStorage.getItem(`mimarnot.test.${k}`) || undefined; } catch { return undefined; } };

export class ApiError extends Error {
  constructor(message: string, public raw?: unknown, public status = 0) { super(message); }
}

const LOGIN_MSG = "Proje üretmek için Planhane hesabınızla giriş yapın (sağ üstte Hesap).";

/** Bulut hesabıyla iş çalıştırır; hata türlerini uygulamanın ApiError'una çevirir. */
async function viaCloud<T>(kind: "generate" | "render", body: unknown, opts: { signal?: AbortSignal; onStatus?: (s: string) => void }): Promise<T> {
  try {
    return await runJob<T>(kind, body, opts);
  } catch (e) {
    if (e instanceof CloudError) {
      if (e.status === 499) throw new DOMException("Durduruldu", "AbortError");
      throw new ApiError(e.message, e.raw, e.status);
    }
    throw e;
  }
}

export async function callGenerate(body: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult> {
  if (signedIn()) return viaCloud<GenerateResult>("generate", body, { signal });
  if (STANDALONE) {
    const key = loadKeys().claude?.trim();
    if (!key && cloudConfigured()) { requestAccountDialog(); throw new ApiError(LOGIN_MSG, null, 401); }
    if (!key) throw new ApiError("Claude API anahtarı girilmemiş. Sağ üstteki Ayarlar'dan anahtarınızı girin.", null, 401);
    const [{ default: Anthropic }, { generateWithClaude, GenerateError }] = await Promise.all([import("@anthropic-ai/sdk"), import("./shared/generate")]);
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, fetch: webFetch(), maxRetries: 2, baseURL: testBase("claude") });
    try {
      const out = await generateWithClaude(client, body, { signal });
      if (!out) throw new DOMException("Durduruldu", "AbortError");
      return out;
    } catch (e) {
      if (e instanceof GenerateError) throw new ApiError(e.message, e.raw, e.status);
      throw e;
    }
  }
  let res: Response;
  try {
    res = await fetch("api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("Sunucuya ulaşılamadı. 'npm run dev' ile API sunucusunun çalıştığından emin olun.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && cloudConfigured()) { requestAccountDialog(); throw new ApiError(LOGIN_MSG, null, 401); }
  if (!res.ok) throw new ApiError(data.error ?? `Sunucu hatası (${res.status})`, data.raw, res.status);
  return data as GenerateResult;
}

async function toDataUrl(f: typeof fetch, url: string): Promise<string | null> {
  try {
    const r = await f(url);
    if (!r.ok) return null;
    const b = await r.blob();
    return await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.onerror = () => ok(null); fr.readAsDataURL(b); });
  } catch { return null; }
}

export interface RenderResult { url: string; data: string | null; model: string; price: number | null; prompt?: string; promptSource?: "claude" | "template" | "manual" }

export async function callRender(req: RenderRequest, opts: { signal?: AbortSignal; onStatus?: (s: string) => void } = {}): Promise<RenderResult> {
  if (signedIn()) return viaCloud<RenderResult>("render", req, opts);
  if (STANDALONE) {
    const k = loadKeys();
    const [{ renderWithHiggsfield }, { writeRenderPrompt }] = await Promise.all([import("./shared/render"), import("./shared/renderprompt")]);
    // Android: yamalı fetch istekleri yerel katmandan geçirir (CORS yok). Web panelinde tarayıcı fetch'i.
    const f = window.fetch.bind(window);
    try {
      // Talimatı Claude yazar (bu cihazda Claude anahtarı varsa; yoksa şablon)
      const ck = k.claude?.trim();
      const client = ck ? new (await import("@anthropic-ai/sdk")).default({ apiKey: ck, dangerouslyAllowBrowser: true, fetch: webFetch(), maxRetries: 1, baseURL: testBase("claude") }) : null;
      const writePrompt = (r: RenderRequest & { program: NonNullable<RenderRequest["program"]> }, refs: string[]) =>
        writeRenderPrompt(client, { view: r.view, refs, program: r.program, camera: r.camera, extra: r.extra, modelId: r.modelId }, { signal: opts.signal });
      const out = await renderWithHiggsfield(req, { keyId: k.hfId?.trim() ?? "", secret: k.hfSecret?.trim() ?? "" }, { fetch: f, api: testBase("hf"), writePrompt, ...opts });
      return { ...out, data: await toDataUrl(f, out.url) };
    } catch (e) {
      if (e instanceof TypeError && !isNative())
        throw new ApiError("Tarayıcı Higgsfield'a doğrudan bağlanamadı (tarayıcı güvenlik kısıtı, CORS). Gerçekçi render için masaüstü ya da Android sürümünü kullanın.");
      throw e;
    }
  }
  opts.onStatus?.("Render hazırlanıyor… (genelde 20-60 sn)");
  let res: Response;
  try {
    res = await fetch("api/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req), signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("Sunucuya ulaşılamadı.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Sunucu hatası (${res.status})`);
  return data as RenderResult;
}

/** Ayarlarda Higgsfield anahtarı var mı */
export async function hasHiggsfield(): Promise<boolean> {
  if (signedIn()) return true;
  if (desktop) return Boolean((await desktop.getSettings()).hasHiggsfield);
  if (STANDALONE) { const k = loadKeys(); return Boolean(k.hfId && k.hfSecret); }
  const h = await fetch("api/health").then((r) => r.json()).catch(() => ({}));
  return Boolean(h.hasHiggsfield);
}
