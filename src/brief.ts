// Notlar ekranındaki "Proje bilgileri" formu: mimarın kesin değerleri. Claude'a iletilir ve üretimden sonra programa aynen uygulanır.
import type { Program } from "./shared/schema";

export interface Brief {
  buildingKind?: string;
  style?: string;
  roof?: "" | "duz" | "besik" | "kirma";
  floors?: number;
  blockCount?: number;
  unitsPerFloor?: number;
  siteWidth?: number;
  siteDepth?: number;
  footprintWidth?: number;
  footprintDepth?: number;
  taks?: number;
  kaks?: number;
  hmax?: number;
  frontSetback?: number;
  sideSetback?: number;
  rearSetback?: number;
}

export const BUILDING_KINDS = ["Müstakil konut", "Dubleks villa", "Apartman", "Site (çok bloklu)", "Ofis / ticari", "Yazlık"];
export const STYLES = ["Claude seçsin", "Modern", "Minimalist", "Çağdaş yerel (taş + ahşap)", "Akdeniz / Ege", "Klasik", "Endüstriyel", "İskandinav"];

const LABELS: Record<keyof Brief, string> = {
  buildingKind: "Yapı türü", style: "Mimari üslup", roof: "Çatı tipi", floors: "Kat sayısı (zemin dahil, bodrum hariç)", blockCount: "Blok sayısı", unitsPerFloor: "Normal katta kat başına daire sayısı",
  siteWidth: "Arsa cephe genişliği (m)", siteDepth: "Arsa derinliği (m)", footprintWidth: "Bina oturum genişliği (m)", footprintDepth: "Bina oturum derinliği (m)",
  taks: "TAKS", kaks: "KAKS / emsal", hmax: "Hmax (m)", frontSetback: "Ön bahçe çekme (m)", sideSetback: "Yan bahçe çekme (m)", rearSetback: "Arka bahçe çekme (m)",
};
const ROOF: Record<string, string> = { duz: "düz çatı", besik: "beşik çatı", kirma: "kırma çatı" };

export function briefForPrompt(b: Brief | undefined): Record<string, string> | undefined {
  if (!b) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(b) as [keyof Brief, unknown][]) {
    if (v === undefined || v === "" || v === null || (k === "style" && v === STYLES[0])) continue;
    out[LABELS[k]] = k === "roof" ? ROOF[v as string] : String(v);
  }
  return Object.keys(out).length ? out : undefined;
}

/** Formdaki kesin değerleri programa yazar (Claude farklı bir değer döndürse bile). */
export function applyBrief(p: Program, b: Brief | undefined): Program {
  if (!b) return p;
  const q: Program = structuredClone(p);
  if (b.siteWidth) q.site.width = b.siteWidth;
  if (b.siteDepth) q.site.depth = b.siteDepth;
  if (b.footprintWidth) q.footprint.width = b.footprintWidth;
  if (b.footprintDepth) q.footprint.depth = b.footprintDepth;
  // çok bloklu: oturum tüm bloklara
  for (const blk of q.blocks ?? []) {
    if (b.footprintWidth) blk.footprint.width = b.footprintWidth;
    if (b.footprintDepth) blk.footprint.depth = b.footprintDepth;
  }
  if (b.roof) q.roof = b.roof;
  const z = q.zoning;
  if (b.taks) z.taks = b.taks;
  if (b.kaks) z.kaks = b.kaks;
  if (b.hmax) z.hmax = b.hmax;
  if (b.frontSetback != null) z.frontSetback = b.frontSetback;
  if (b.sideSetback != null) z.sideSetback = b.sideSetback;
  if (b.rearSetback != null) z.rearSetback = b.rearSetback;
  if (b.buildingKind) q.buildingType = q.buildingType || b.buildingKind;
  return q;
}

/** Görseli küçültüp JPEG data URL'e çevirir (en uzun kenar 1400 px: el yazısı ve eskiz ölçüleri okunabilsin). */
export async function shrinkImage(file: File, max = 1400): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function dataUrlToImage(d: string) {
  const m = /^data:(image\/[a-z]+);base64,(.*)$/.exec(d);
  return m ? { mediaType: m[1], data: m[2] } : null;
}
