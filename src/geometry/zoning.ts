// İmar kontrolleri: TAKS, KAKS (emsal), kat adedi, Hmax, çekme mesafeleri.
// Not: Ön tasarım kontrolüdür; emsal dışı alanlar (balkon, merdiven evi muafiyetleri vb.) basitleştirilmiştir.
import type { Program } from "../shared/schema";
import type { BuildingLayout } from "./layout";

export interface Check {
  label: string;
  value: string;
  limit: string;
  ok: boolean | null; // null = sınır tanımlı değil
}

export interface ZoningResult {
  siteArea: number;
  footprintArea: number;
  grossTotal: number; // emsale giren brüt alan (bodrum hariç)
  taks: number;
  kaks: number;
  setbacks: { front: number; side: number; rear: number };
  building: { x: number; y: number }; // arsa içindeki konum (sol-ön köşe)
  actual: { front: number; side: number; rear: number };
  height: number;
  checks: Check[];
}

// Planlı Alanlar İmar Yönetmeliği varsayılanları (plan notu yoksa)
export const DEFAULT_SETBACKS = { front: 5, side: 3, rear: 3 };

export function zoningCheck(p: Program, L: BuildingLayout): ZoningResult {
  const z = p.zoning ?? { taks: null, kaks: null, maxFloors: null, hmax: null, frontSetback: null, sideSetback: null, rearSetback: null };
  const siteArea = p.site.width * p.site.depth;
  const footprintArea = L.W * L.D;
  const above = L.floors.filter((f) => f.z >= 0);
  const outdoorArea = above.reduce((s, f) => s + f.outdoor.reduce((a, o) => a + o.area, 0), 0);
  const grossTotal = above.length * footprintArea + outdoorArea;
  const setbacks = {
    front: z.frontSetback ?? DEFAULT_SETBACKS.front,
    side: z.sideSetback ?? DEFAULT_SETBACKS.side,
    rear: z.rearSetback ?? DEFAULT_SETBACKS.rear,
  };
  const x = (p.site.width - L.W) / 2;
  const maxOut = Math.max(0, ...L.floors.flatMap((f) => f.outdoor.map((o) => o.rect.y + o.rect.h - L.D)));
  const fitsFront = p.site.depth - L.D - maxOut - setbacks.front >= setbacks.rear;
  const y = fitsFront ? setbacks.front : Math.max(0, (p.site.depth - L.D) / 2);
  const actual = { front: y, side: x, rear: p.site.depth - y - L.D - maxOut };
  const height = L.totalHeight; // ±0.00'dan saçak/çatı döşemesine
  const taks = footprintArea / siteArea;
  const kaks = grossTotal / siteArea;

  const fmt = (v: number, d = 2) => v.toFixed(d);
  const chk = (label: string, value: number, limit: number | null, unit = "", lessIsOk = true, d = 2): Check => ({
    label,
    value: fmt(value, d) + unit,
    limit: limit == null ? "—" : (lessIsOk ? "≤ " : "≥ ") + fmt(limit, d) + unit,
    ok: limit == null ? null : lessIsOk ? value <= limit + 1e-6 : value >= limit - 1e-6,
  });
  const checks: Check[] = [
    chk("TAKS", taks, z.taks),
    chk("KAKS (emsal)", kaks, z.kaks),
    chk("Kat adedi", above.length, z.maxFloors, "", true, 0),
    chk("Bina yüksekliği", height, z.hmax, " m"),
    chk("Ön bahçe mesafesi", actual.front, setbacks.front, " m", false),
    chk("Yan bahçe mesafesi", actual.side, setbacks.side, " m", false),
    chk("Arka bahçe mesafesi", actual.rear, setbacks.rear, " m", false),
  ];
  return { siteArea, footprintArea, grossTotal, taks, kaks, setbacks, building: { x, y }, actual, height, checks };
}

/** Açık otopark yerleri: ön bahçede, binanın sağ kenarına hizalı 2.5 × 5 m park yerleri (arsa koordinatı, sokak y=0). */
export function parkingStalls(p: Program, L: BuildingLayout, z = zoningCheck(p, L)) {
  const n = L.parking.reduce((s, k) => s + k.cars, 0);
  if (!n) return [];
  const sw = p.site.width;
  const W = 2.5, Dp = 5;
  const total = n * W;
  const x0 = Math.max(0.5, Math.min(sw - total - 0.5, z.building.x + L.W - total));
  const y0 = z.building.y >= Dp + 1 ? Math.max(0.3, (z.building.y - Dp) / 2) : 0.3;
  return Array.from({ length: n }, (_, i) => ({ x: x0 + i * W, y: y0, w: W, h: Dp }));
}
