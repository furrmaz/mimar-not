// Higgsfield ile gerçekçi render: 3D görünümün ekran görüntüsü (+ referans görseller) bir görüntü modeline verilir,
// model geometriyi koruyarak fotoğraf gerçekliğinde bir mimari görsel üretir.
// Masaüstünde yerel sunucu, Android'de yerel HTTP, web panelinde doğrudan tarayıcı çağırır.
import type { Program } from "./schema";

export interface RenderModel {
  id: string;
  label: string;
  /** Higgsfield API yolu, ör. "/xai/grok-imagine-image-2.0" */
  path: string;
  /** Görsel başına ücret (USD, Higgsfield fiyat sayfası) */
  price: number;
  maxRefs: number;
  note: string;
  body: (a: { prompt: string; urls: string[]; aspect: string; hi: boolean }) => Record<string, unknown>;
}

const ratio = (aspect: string, allowed: string[]) => (allowed.includes(aspect) ? aspect : allowed.includes("16:9") ? "16:9" : allowed[0]);

export const RENDER_MODELS: RenderModel[] = [
  {
    id: "qwen", label: "Qwen Image 3 Edit", path: "/alibaba/qwen-image-3/edit", price: 0.04, maxRefs: 3,
    note: "Varsayılan. Bir düzenleme modeli: 3D görüntüyü fotoğrafa çevirir, kamera açısını ve geometriyi en sadık korur; 2 referans görsele kadar.",
    body: ({ prompt, urls, aspect, hi }) => ({ prompt, image_urls: urls.slice(0, 3), resolution: hi ? "2k" : "1k", aspect_ratio: ratio(aspect, ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"]), negative_prompt: "different camera angle, changed perspective, cropped building, extra floors, extra windows, missing windows, cartoon, CGI look, plastic, distorted geometry, text, watermark" }),
  },
  {
    id: "grok", label: "Grok Imagine 2.0", path: "/xai/grok-imagine-image-2.0", price: 0.04, maxRefs: 10,
    note: "Daha serbest ve atmosferik yorum; malzemeyi referanstan iyi taşır ama açı ve pencere düzeni biraz kayabilir.",
    body: ({ prompt, urls, aspect, hi }) => ({ prompt, image_urls: urls, resolution: hi ? "2k" : "1k", aspect_ratio: ratio(aspect, ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"]), quality: "high" }),
  },
  {
    id: "ideogram", label: "Ideogram 4.0", path: "/ideogram/v4.0", price: 0.03, maxRefs: 1,
    note: "En ucuz; yalnız 3D görüntüyü alır (referans görsel kullanmaz).",
    body: ({ prompt, urls, aspect }) => ({ prompt: prompt.slice(0, 2000), image_url: urls[0], image_weight: 85, rendering_speed: "QUALITY", aspect_ratio: ratio(aspect, ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"]) }),
  },
];
/** Modelin desteklediği oranlardan görünüme en yakını (Ideogram/Grok 21:9 desteklemez) */
export const RENDER_ASPECTS: [string, number][] = [["21:9", 21 / 9], ["16:9", 16 / 9], ["3:2", 1.5], ["4:3", 4 / 3], ["1:1", 1], ["3:4", 0.75], ["2:3", 2 / 3], ["9:16", 9 / 16]];
export function nearestAspect(w: number, h: number, modelId?: string) {
  const r = w / Math.max(h, 1);
  const list = RENDER_ASPECTS.filter(([a]) => a !== "21:9" || modelId === "qwen");
  return list.reduce((b, x) => (Math.abs(Math.log(x[1] / r)) < Math.abs(Math.log(b[1] / r)) ? x : b))[0];
}
export const aspectValue = (a: string) => RENDER_ASPECTS.find(([k]) => k === a)?.[1] ?? 16 / 9;

/** 3D görünümün kamera bilgisi (ThreeView ölçer); talimatta açıyı kesin tarif etmek için */
export interface CameraInfo {
  /** Kamera yüksekliği, zeminden m */
  height: number;
  /** Binaya yatay uzaklık, m */
  distance: number;
  /** Bakış doğrultusunun yatayla açısı (aşağı bakış pozitif), derece */
  pitch: number;
  /** 35 mm eşdeğeri odak uzaklığı */
  focal: number;
  /** Bina yüksekliği (çatı dahil), m */
  buildingHeight: number;
  /** Görünen cepheler ve kadrajdaki yerleri */
  facades: { name: "front" | "rear" | "left" | "right"; where: "left" | "centre" | "right" }[];
  /** Binanın kadrajda kapladığı alan (0–1, soldan/üstten) */
  frame: { x0: number; x1: number; y0: number; y1: number };
}

const FACADE_EN = { front: "front (street/entrance) facade", rear: "rear (garden) facade", left: "left side facade", right: "right side facade" };
/** Kamera bilgisini görüntü modelinin anlayacağı cümleye çevirir */
export function cameraText(c: CameraInfo) {
  const kind = c.pitch > 38 ? "high aerial bird's-eye view" : c.height > Math.max(6, c.buildingHeight * 1.15) ? "elevated drone view" : c.height < 3 ? "eye-level street view" : "slightly elevated view";
  const pct = (v: number) => Math.round(v * 100);
  const facades = c.facades.length
    ? c.facades.map((f) => `${FACADE_EN[f.name]} on the ${f.where === "centre" ? "centre" : f.where} of the frame`).join(", ")
    : "";
  const look = c.pitch > 1 ? `looking down ${Math.round(c.pitch)}°` : c.pitch < -1 ? `looking up ${Math.round(-c.pitch)}°` : "looking level";
  return `${kind}, camera about ${c.height.toFixed(1)} m above ground and ${Math.round(c.distance)} m from the building, ${look}, ${Math.round(c.focal)} mm full-frame equivalent lens${c.facades.length > 1 ? ", two-point perspective" : ""}. Visible: ${facades || "the building"}. The building spans ${pct(c.frame.x0)}–${pct(c.frame.x1)}% of the image width and ${pct(c.frame.y0)}–${pct(c.frame.y1)}% of the height (from top-left).`;
}

export const CUSTOM_MODEL_ID = "custom";
export const USD_TRY_HINT = 41; // yaklaşık kur, yalnız bilgi amaçlı

export interface HiggsfieldKeys { keyId: string; secret: string }
export interface RenderRequest {
  /** 3D görünümün PNG/JPEG data URL'i */
  view: string;
  /** Mimarın referans görselleri (data URL) */
  refs?: string[];
  prompt: string;
  modelId: string;
  /** modelId "custom" ise Higgsfield yolu */
  customPath?: string;
  aspect?: string;
  hi?: boolean;
  /** true: talimatı Claude yazar (program, camera, extra kullanılır); prompt yalnız yedek olur */
  autoPrompt?: boolean;
  program?: Program;
  camera?: CameraInfo;
  /** Mimarın ek talimatı */
  extra?: string;
}

const MATERIAL_EN: Record<string, string> = { siva_beyaz: "white smooth render", siva_krem: "warm cream render", siva_gri: "light grey render", tas: "natural stone cladding", tugla: "red brick", ahsap: "warm timber cladding", beton: "fair-faced concrete" };
const WINDOW_EN: Record<string, string> = { kare: "classic punched windows", dikey: "tall narrow vertical windows", serit: "horizontal ribbon windows", boy: "floor-to-ceiling glazing" };
const RAIL_EN: Record<string, string> = { cam: "frameless glass balustrades", metal: "slim metal railings", dolu: "solid parapet balconies" };

/** Programdan İngilizce render talimatı (modeller İngilizcede daha iyi). */
export function renderPrompt(p: Program, extra = "", refCount = 0, camera?: CameraInfo) {
  const f = p.facade;
  const m = p.materials;
  const floors = Math.max(1, ...(p.blocks?.length ? [0] : [p.floors.filter((x) => x.level >= 0).length]));
  const roof = p.roof === "duz" ? "flat roof with parapet" : p.roof === "besik" ? "gable roof" : "hipped roof";
  const parts = [
    "Turn this 3D model render into a photorealistic architectural photograph of exactly the same building, taken from exactly the same camera position, angle, lens and framing as the first image.",
    camera ? `Camera: ${cameraText(camera)}` : "",
    "Keep the exact massing, number of floors, roof shape, window and door positions and counts, balconies and the building's position in the frame; do not add or remove floors, wings or openings, do not change the perspective.",
    `Building: ${p.buildingType || "residential building"}${p.blocks?.length ? `, ${p.blocks.length} apartment blocks` : `, ${floors} storeys`}, ${roof}.`,
    `Facade: main walls ${MATERIAL_EN[m.wall] ?? m.wall}${f ? ` (colour ${f.wallColor})` : ""}, accents in ${MATERIAL_EN[m.accent] ?? m.accent}${f ? ` (colour ${f.accentColor})` : ""}${f ? `, window frames ${f.frameColor}, ${WINDOW_EN[f.windowStyle]}, ${RAIL_EN[f.balconyRail]}${f.shutters ? ", wooden shutters" : ""}${f.cornice ? ", horizontal cornice bands" : ""}, roof colour ${f.roofColor}` : ""}.`,
    p.style && p.style !== "Belirtilmedi" ? `Architectural style (Turkish description): ${p.style}.` : "",
    refCount ? `Match the materials, colours, textures and overall look of the reference photo${refCount > 1 ? "s" : ""} that follow the first image, but keep the geometry of the first image.` : "",
    "Real materials with texture and weathering, real glass reflections, interior depth behind windows, soft natural daylight, realistic shadows, landscaped garden with grass, shrubs and mature trees, paved walkway, clear sky, Mediterranean Turkey context.",
    "Full-frame camera, vertical lines kept straight, high dynamic range, sharp, magazine-quality architectural photography. No text, no watermark, no people in front of the facade.",
    extra ? `Additional instructions from the architect (Turkish): ${extra}` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

type Fetch = typeof fetch;
const API = "https://api.higgsfield.ai";

function dataUrlToBlob(d: string): Blob {
  const m = /^data:([^;]+);base64,(.*)$/.exec(d);
  if (!m) throw new Error("Görsel okunamadı");
  const bin = atob(m[2]);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: m[1] });
}

async function hfJson(f: Fetch, keys: HiggsfieldKeys, url: string, init: RequestInit = {}, api = API) {
  const res = await f(url.startsWith("http") ? url : api + url, {
    ...init,
    headers: { Authorization: `Key ${keys.keyId}:${keys.secret}`, "Content-Type": "application/json", Accept: "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(text); } catch { /* metin */ }
  if (!res.ok) {
    const detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail ?? text).slice(0, 300);
    if (res.status === 401) throw new Error("Higgsfield anahtarı geçersiz. Ayarlar'dan anahtar kimliği (Key ID) ve gizli anahtarı (Secret) kontrol edin.");
    if (res.status === 402) throw new Error("Higgsfield bakiyesi yetersiz. Hesabınıza bakiye yükleyin.");
    if ([404, 423, 503].includes(res.status)) throw new Error(`Bu model hesabınızda şu an kullanılamıyor (${res.status}). Başka bir model seçin.`);
    throw new Error(`Higgsfield hatası (${res.status}): ${detail}`);
  }
  return data;
}

async function upload(f: Fetch, keys: HiggsfieldKeys, dataUrl: string, api = API) {
  const blob = dataUrlToBlob(dataUrl);
  const up = (await hfJson(f, keys, "/files/generate-upload-url", { method: "POST", body: JSON.stringify({ content_type: blob.type }) }, api)) as {
    public_url: string; upload_url: string; upload_headers?: Record<string, string>;
  };
  const put = await f(up.upload_url, { method: "PUT", headers: up.upload_headers ?? { "Content-Type": blob.type }, body: blob });
  if (!put.ok) throw new Error(`Görsel Higgsfield'a yüklenemedi (${put.status})`);
  return up.public_url;
}

/** Render ister, tamamlanınca görsel URL'ini döndürür. onStatus ilerlemeyi bildirir. */
export async function renderWithHiggsfield(
  req: RenderRequest,
  keys: HiggsfieldKeys,
  opts: {
    fetch?: Fetch; signal?: AbortSignal; onStatus?: (s: string) => void; wait?: (ms: number) => Promise<void>; api?: string;
    /** autoPrompt istenmişse talimatı yazar (Claude); yoksa şablon kullanılır */
    writePrompt?: (req: RenderRequest & { program: Program }, refs: string[]) => Promise<{ prompt: string; source: "claude" | "template"; usage?: unknown; model?: string }>;
  } = {},
): Promise<{ url: string; model: string; price: number | null; prompt: string; promptSource: "claude" | "template" | "manual"; promptUsage?: unknown; promptModel?: string }> {
  const f: Fetch = opts.fetch ?? fetch;
  const api = opts.api ?? API;
  const wait = opts.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  if (!keys.keyId || !keys.secret) throw new Error("Higgsfield anahtarı girilmemiş. Ayarlar'dan Key ID ve Secret girin.");
  const model = RENDER_MODELS.find((m) => m.id === req.modelId);
  const path = model?.path ?? (req.customPath || "").trim().replace(/^https?:\/\/[^/]+/, "");
  if (!path.startsWith("/")) throw new Error("Özel model için Higgsfield API yolunu yazın (ör. /xai/grok-imagine-image-2.0).");
  const maxRefs = model?.maxRefs ?? 4;
  const refs = (req.refs ?? []).slice(0, Math.max(0, maxRefs - 1));
  let prompt = String(req.prompt ?? "");
  let promptSource: "claude" | "template" | "manual" = "manual";
  let promptUsage: unknown, promptModel: string | undefined;
  if (req.autoPrompt && req.program) {
    opts.onStatus?.("Claude görsel talimatını yazıyor…");
    const w = opts.writePrompt
      ? await opts.writePrompt({ ...req, program: req.program }, refs)
      : { prompt: renderPrompt(req.program, req.extra ?? "", refs.length, req.camera), source: "template" as const };
    if (opts.signal?.aborted) throw new DOMException("İptal", "AbortError");
    prompt = w.prompt;
    promptSource = w.source;
    promptUsage = w.usage;
    promptModel = w.model;
  }
  if (!prompt.trim()) throw new Error("Render talimatı boş.");
  opts.onStatus?.("Görseller yükleniyor…");
  const urls = [await upload(f, keys, req.view, api)];
  for (const r of refs) urls.push(await upload(f, keys, r, api));
  const aspect = req.aspect ?? "16:9";
  const body = model ? model.body({ prompt, urls, aspect, hi: req.hi ?? true }) : { prompt, image_urls: urls, aspect_ratio: aspect };
  opts.onStatus?.("Render sıraya alındı…");
  const sub = (await hfJson(f, keys, path, { method: "POST", body: JSON.stringify(body) }, api)) as { status_url?: string; request_id?: string };
  const statusUrl = sub.status_url ?? `${api}/requests/${sub.request_id}/status`;
  const t0 = Date.now();
  for (;;) {
    if (opts.signal?.aborted) {
      void hfJson(f, keys, statusUrl.replace(/\/status$/, "/cancel"), { method: "PUT" }).catch(() => {});
      throw new DOMException("İptal", "AbortError");
    }
    await wait(Date.now() - t0 < 20000 ? 2500 : 5000);
    const st = (await hfJson(f, keys, statusUrl)) as { status?: string; images?: { url: string }[]; error?: unknown };
    const s = String(st.status ?? "");
    if (s === "completed" && st.images?.[0]?.url) return { url: st.images[0].url, model: model?.label ?? path, price: model?.price ?? null, prompt, promptSource, promptUsage, promptModel };
    if (s === "failed" || s === "nsfw" || s === "canceled" || s === "cancelled")
      throw new Error(s === "nsfw" ? "Model görseli içerik filtresine takıldı; ek talimatı değiştirip tekrar deneyin." : `Render başarısız oldu${st.error ? `: ${JSON.stringify(st.error).slice(0, 200)}` : ""}.`);
    opts.onStatus?.(s === "in_progress" ? `Render hazırlanıyor… (${Math.round((Date.now() - t0) / 1000)} sn)` : "Sırada bekliyor…");
    if (Date.now() - t0 > 6 * 60 * 1000) throw new Error("Render 6 dakikada tamamlanmadı. Biraz sonra tekrar deneyin.");
  }
}
