// Plan alternatiflerini karşılaştırmak için basit puanlama.
import type { Program } from "../shared/schema";
import { buildLayout, sameName, VARIANTS, type BuildingLayout, type PlacedRoom } from "./layout";
import { roomChecks } from "./roomcheck";

export interface AdjResult { a: string; b: string; relation: "bitisik" | "uzak"; reason: string; ok: boolean | null }
export interface LayoutScore { variant: number; adj: AdjResult[]; adjOk: number; adjTotal: number; hard: number; soft: number; daylight: number; score: number }

function touching(p: PlacedRoom, q: PlacedRoom) {
  const a = p.rect, b = q.rect, e = 0.02;
  const vx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const vy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return (vx > 0.5 && Math.abs(vy) < e) || (vy > 0.5 && Math.abs(vx) < e);
}

export function scoreLayout(program: Program, L: BuildingLayout): LayoutScore {
  const adj: AdjResult[] = (program.adjacencies ?? []).map((a) => {
    for (const fl of L.floors) {
      const p = fl.rooms.find((r) => sameName(r.name, a.a));
      const q = fl.rooms.find((r) => sameName(r.name, a.b));
      if (p && q) {
        const t = touching(p, q);
        return { ...a, ok: a.relation === "bitisik" ? t : !t };
      }
    }
    return { ...a, ok: null };
  });
  const issues = roomChecks(L);
  const hard = issues.filter((i) => !i.soft).length;
  const soft = issues.length - hard;
  // gündüz mekânlarından bahçeye (arka cephe) bakanların oranı
  const day = L.floors.flatMap((f) => f.rooms.filter((r) => r.zone === "gunduz"));
  const daylight = day.length ? day.filter((r) => Math.abs(r.rect.y + r.rect.h - L.D) < 0.02).length / day.length : 0;
  const adjTotal = adj.filter((a) => a.ok != null).length;
  const adjOk = adj.filter((a) => a.ok).length;
  const score = Math.round(100 * (adjTotal ? adjOk / adjTotal : 1) * 0.5 + 30 * Math.max(0, 1 - hard / 4) + 20 * Math.max(0, 1 - soft / 6));
  return { variant: L.variant, adj, adjOk, adjTotal, hard, soft, daylight, score };
}

/** Üç alternatifi üretir (mimarın sürükleme ayarları alternatiflere taşınmaz). */
export function allVariants(program: Program) {
  return VARIANTS.map((v) => {
    const L = buildLayout(program, { variant: v.id });
    return { ...v, layout: L, score: scoreLayout(program, L) };
  });
}
