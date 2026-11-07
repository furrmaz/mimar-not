// İmar kontrolleri: TAKS, KAKS (emsal), kat adedi, Hmax, çekme mesafeleri.
// Not: Ön tasarım kontrolüdür; emsal dışı alanlar (balkon, merdiven evi muafiyetleri vb.) basitleştirilmiştir.
import type { Program } from "../shared/schema";
import { buildLayout, type BuildingLayout } from "./layout";
import { blockTypeKey, blockView, isMultiBlock } from "./blocks";

export interface SiteBlock { name: string; index: number; L: BuildingLayout; x: number; y: number }

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
  /** Çok bloklu projede tüm bloklar (arsa koordinatında) */
  blocks?: SiteBlock[];
}

// Planlı Alanlar İmar Yönetmeliği varsayılanları (plan notu yoksa)
export const DEFAULT_SETBACKS = { front: 5, side: 3, rear: 3 };

const extent = (L: BuildingLayout) => {
  const out = L.floors.flatMap((f) => f.outdoor.map((o) => o.rect));
  return { front: Math.max(0, ...out.map((r) => -r.y)), back: Math.max(0, ...out.map((r) => r.y + r.h - L.D)) };
};

/** Blokları arsaya ızgara halinde yerleştirir (ön sıra sokakta); artan boşluk bloklar arasına dağıtılır. */
export function siteBlocks(p: Program, setbacks: { front: number; side: number; rear: number }) {
  const cache = new Map<string, BuildingLayout>();
  const list = (p.blocks ?? []).map((b, i) => {
    const key = blockTypeKey(p, i);
    if (!cache.has(key)) cache.set(key, buildLayout(blockView(p, i)));
    return { name: b.name, index: i, L: cache.get(key)! };
  });
  const n = list.length;
  const gap = Math.max(p.blockSpacing ?? 0, 2 * setbacks.side);
  const availW = p.site.width - 2 * setbacks.side;
  const availD = p.site.depth - setbacks.front - setbacks.rear;
  let best: { c: number; r: number; colW: number[]; rowD: number[]; score: number } | null = null;
  for (let r = 1; r <= n; r++) {
    const c = Math.ceil(n / r);
    if ((r - 1) * c >= n) continue;
    const colW = Array(c).fill(0), rowD = Array(r).fill(0);
    list.forEach((b, k) => {
      const e = extent(b.L);
      colW[k % c] = Math.max(colW[k % c], b.L.W);
      rowD[Math.floor(k / c)] = Math.max(rowD[Math.floor(k / c)], b.L.D + e.front + e.back);
    });
    const tw = colW.reduce((a, v) => a + v, 0) + gap * (c - 1);
    const td = rowD.reduce((a, v) => a + v, 0) + gap * (r - 1);
    const over = Math.max(0, tw - availW) + Math.max(0, td - availD);
    const score = over > 0 ? -over * 100 : Math.min((availW - tw) / availW, (availD - td) / availD);
    if (!best || score > best.score) best = { c, r, colW, rowD, score };
  }
  const { c, r, colW, rowD } = best!;
  const tw = colW.reduce((a, v) => a + v, 0), td = rowD.reduce((a, v) => a + v, 0);
  const gx = c > 1 ? Math.max(gap, (availW - tw) / (c - 1)) : 0;
  const gy = r > 1 ? Math.max(gap, Math.min((availD - td) / (r - 1), gap * 3)) : 0;
  const x0 = setbacks.side + (c > 1 ? Math.min(0, (availW - tw - gap * (c - 1)) / 2) : Math.max(0, (availW - tw) / 2));
  const blocks: SiteBlock[] = list.map((b, k) => {
    const ci = k % c, ri = Math.floor(k / c);
    const cellX = x0 + colW.slice(0, ci).reduce((a, v) => a + v, 0) + gx * ci;
    const cellY = setbacks.front + rowD.slice(0, ri).reduce((a, v) => a + v, 0) + gy * ri;
    return { ...b, x: cellX + (colW[ci] - b.L.W) / 2, y: cellY + extent(b.L).front };
  });
  // en yakın iki blok arası
  let minGap = Infinity;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = blocks[i], b = blocks[j];
    const dx = Math.max(b.x - (a.x + a.L.W), a.x - (b.x + b.L.W), 0);
    const dy = Math.max(b.y - (a.y + a.L.D), a.y - (b.y + b.L.D), 0);
    minGap = Math.min(minGap, Math.hypot(dx, dy));
  }
  return { blocks, gap, minGap: Number.isFinite(minGap) ? minGap : 0 };
}

function zoningMulti(p: Program, L: BuildingLayout): ZoningResult {
  const z = p.zoning ?? { taks: null, kaks: null, maxFloors: null, hmax: null, frontSetback: null, sideSetback: null, rearSetback: null };
  const setbacks = { front: z.frontSetback ?? DEFAULT_SETBACKS.front, side: z.sideSetback ?? DEFAULT_SETBACKS.side, rear: z.rearSetback ?? DEFAULT_SETBACKS.rear };
  const { blocks, gap, minGap } = siteBlocks(p, setbacks);
  const siteArea = p.site.width * p.site.depth;
  const footprintArea = blocks.reduce((s, b) => s + b.L.W * b.L.D, 0);
  const grossTotal = blocks.reduce((s, b) => {
    const above = b.L.floors.filter((f) => f.z >= 0);
    return s + above.length * b.L.W * b.L.D + above.reduce((a, f) => a + f.outdoor.reduce((q, o) => q + o.area, 0), 0);
  }, 0);
  const actual = {
    front: Math.min(...blocks.map((b) => b.y - extent(b.L).front)),
    side: Math.min(...blocks.map((b) => Math.min(b.x, p.site.width - b.x - b.L.W))),
    rear: Math.min(...blocks.map((b) => p.site.depth - b.y - b.L.D - extent(b.L).back)),
  };
  const height = Math.max(...blocks.map((b) => b.L.totalHeight));
  const floors = Math.max(...blocks.map((b) => b.L.floors.filter((f) => f.z >= 0).length));
  const taks = footprintArea / siteArea, kaks = grossTotal / siteArea;
  const sel = blocks.find((b) => b.index === (p.blockIndex ?? 0)) ?? blocks[0];
  const checks: Check[] = [
    chk("TAKS", taks, z.taks),
    chk("KAKS (emsal)", kaks, z.kaks),
    chk("Kat adedi", floors, z.maxFloors, "", true, 0),
    chk("Bina yüksekliği", height, z.hmax, " m"),
    chk("Ön bahçe mesafesi", actual.front, setbacks.front, " m", false),
    chk("Yan bahçe mesafesi", actual.side, setbacks.side, " m", false),
    chk("Arka bahçe mesafesi", actual.rear, setbacks.rear, " m", false),
    chk("Bloklar arası mesafe", minGap, gap, " m", false),
  ];
  return { siteArea, footprintArea, grossTotal, taks, kaks, setbacks, building: { x: sel?.x ?? 0, y: sel?.y ?? 0 }, actual, height, checks, blocks };
}

const fmt = (v: number, d = 2) => v.toFixed(d);
function chk(label: string, value: number, limit: number | null, unit = "", lessIsOk = true, d = 2): Check {
  return {
    label,
    value: fmt(value, d) + unit,
    limit: limit == null ? "—" : (lessIsOk ? "≤ " : "≥ ") + fmt(limit, d) + unit,
    ok: limit == null ? null : lessIsOk ? value <= limit + 1e-6 : value >= limit - 1e-6,
  };
}

export function zoningCheck(p: Program, L: BuildingLayout): ZoningResult {
  if (isMultiBlock(p)) return zoningMulti(p, L);
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
  const x0 = z.blocks ? Math.max(0.5, z.setbacks.side) : Math.max(0.5, Math.min(sw - total - 0.5, z.building.x + L.W - total));
  const y0 = z.building.y >= Dp + 1 ? Math.max(0.3, (z.building.y - Dp) / 2) : 0.3;
  return Array.from({ length: n }, (_, i) => ({ x: x0 + i * W, y: y0, w: W, h: Dp }));
}
