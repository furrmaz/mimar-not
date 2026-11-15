// Metraj ve yaklaşık maliyet: yerleşimden kaba iş ve ince iş miktarlarını çıkarır.
// Miktarlar avan proje hassasiyetindedir (± %10–15); birim fiyatlar örnek değerdir, ofis kendi fiyatını girer.
import type { BuildingLayout } from "./layout";
import { floorFootprintArea } from "./massing";
import { structurePlan } from "./structure";

export interface TakeoffItem { id: string; group: string; name: string; qty: number; unit: string; price: number; note?: string }

/** Örnek birim fiyatlar (₺, malzeme + işçilik). Güncel piyasa ve Bakanlık birim fiyatlarıyla değiştirin. */
export const DEFAULT_PRICES: Record<string, number> = {
  kazi: 450, temel: 11000, betonarme: 12500, dis_duvar: 1400, ic_duvar: 950, siva_boya: 750, cephe: 2400,
  cati: 3200, dograma: 11000, ic_kapi: 14000, dis_kapi: 45000, zemin: 1900, islak: 60000, mutfak: 180000,
  merdiven: 90000, korkuluk: 4500, tesisat: 6500, asansor: 1400000,
};

const WET = ["banyo", "wc", "camasir"];

export function takeoff(L: BuildingLayout, prices: Record<string, number> = DEFAULT_PRICES): { items: TakeoffItem[]; total: number; groups: { group: string; total: number }[] } {
  const P = (k: string) => prices[k] ?? DEFAULT_PRICES[k] ?? 0;
  const st = structurePlan(L);
  const clear = L.H - L.slab;
  let slabArea = 0, extWall = 0, intWall = 0, glazing = 0, inDoors = 0, outDoors = 0, floorArea = 0, wet = 0, kitchens = 0, rail = 0, stairs = 0;
  for (const f of L.floors) {
    const fp = floorFootprintArea(L, f);
    slabArea += fp + f.outdoor.filter((o) => !o.carved).reduce((s, o) => s + o.rect.w * o.rect.h, 0);
    const below = f.z < 0;
    for (const w of f.wallLines) {
      const len = Math.max(0, w.b - w.a);
      if (w.exterior) extWall += len * clear; else intWall += len * clear;
    }
    for (const o of f.openings) {
      const a = o.width * Math.max(0, o.head - o.sill);
      if (o.kind === "window" || o.kind === "balconyDoor") { glazing += a; extWall -= a; }
      else if (o.kind === "entrance") { outDoors++; extWall -= a; }
      else if (o.kind === "door") { inDoors++; intWall -= a; }
      else intWall -= a;
    }
    for (const r of f.rooms) {
      if (r.void) continue;
      const a = r.rect.w * r.rect.h;
      if (r.type === "merdiven") { stairs++; continue; }
      floorArea += a;
      if (WET.includes(r.type)) wet++;
      if (r.type === "mutfak") kitchens++;
    }
    for (const o of f.outdoor) rail += o.carved === "teras" ? (o.rails ?? []).reduce((s, sd) => s + (sd === "front" || sd === "back" ? o.rect.w : o.rect.h), 0) : o.carved ? 0 : o.rect.w + 2 * o.rect.h;
    for (const r of f.rails ?? []) rail += r.b - r.a;
    void below;
  }
  const above = L.floors.filter((f) => f.z >= 0);
  const top = above[above.length - 1] ?? L.floors[L.floors.length - 1];
  const base = L.floors[0];
  const baseArea = floorFootprintArea(L, base) * 1.1;
  const basement = L.floors.filter((f) => f.z < 0).length;
  const roofArea = (above.reduce((m, f) => Math.max(m, floorFootprintArea(L, f)), 0)) * (L.roof === "duz" ? 1.05 : 1.25);
  void top;
  const colVol = st.columns.reduce((s, c) => s + (c.w / 100) * (c.d / 100) * L.H * L.floors.length, 0);
  const beamVol = st.beams.reduce((s, b) => s + b.span * (st.beam.w / 100) * Math.max(0.1, st.beam.h / 100 - L.slab), 0) * L.floors.length;
  const concrete = slabArea * L.slab + colVol + beamVol + stairs * 2.2 + (basement ? basement * 2 * (L.W + L.D) * L.H * 0.25 : 0);
  const gross = L.floors.reduce((s, f) => s + floorFootprintArea(L, f), 0);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const items: TakeoffItem[] = [
    { id: "kazi", group: "Kaba yapı", name: "Kazı ve hafriyat", qty: r1(baseArea * (basement ? basement * L.H + 0.8 : 1.0)), unit: "m³" },
    { id: "temel", group: "Kaba yapı", name: "Radye temel (50 cm) ve grobeton", qty: r1(baseArea * 0.5), unit: "m³", note: "Zemin etüdüne göre değişir" },
    { id: "betonarme", group: "Kaba yapı", name: "Betonarme karkas (döşeme, kiriş, kolon, merdiven; beton + demir + kalıp)", qty: r1(concrete), unit: "m³", note: `${st.columns.length} kolon, kirişler ${st.beam.w}×${st.beam.h} cm ön boyutla` },
    { id: "dis_duvar", group: "Kaba yapı", name: "Dış duvar (yalıtımlı tuğla / gazbeton)", qty: r1(Math.max(0, extWall)), unit: "m²" },
    { id: "ic_duvar", group: "Kaba yapı", name: "İç bölme duvar", qty: r1(Math.max(0, intWall)), unit: "m²" },
    { id: "cati", group: "Kaba yapı", name: L.roof === "duz" ? "Teras çatı (yalıtım, şap, kaplama)" : "Çatı (konstrüksiyon, yalıtım, örtü)", qty: r1(roofArea), unit: "m²" },
    { id: "cephe", group: "İnce yapı", name: "Dış cephe (mantolama, sıva, boya / kaplama)", qty: r1(Math.max(0, extWall)), unit: "m²" },
    { id: "siva_boya", group: "İnce yapı", name: "İç sıva, alçı ve boya (duvar yüzeyi + tavan)", qty: r1(Math.max(0, extWall) + 2 * Math.max(0, intWall) + floorArea), unit: "m²" },
    { id: "zemin", group: "İnce yapı", name: "Zemin kaplaması ve şap", qty: r1(floorArea), unit: "m²" },
    { id: "dograma", group: "İnce yapı", name: "Pencere ve cam kapı doğraması", qty: r1(glazing), unit: "m²" },
    { id: "ic_kapi", group: "İnce yapı", name: "İç kapı", qty: inDoors, unit: "adet" },
    { id: "dis_kapi", group: "İnce yapı", name: "Dış kapı / daire kapısı", qty: Math.max(1, outDoors), unit: "adet" },
    { id: "islak", group: "İnce yapı", name: "Islak hacim (seramik, vitrifiye, armatür)", qty: wet, unit: "adet" },
    { id: "mutfak", group: "İnce yapı", name: "Mutfak dolabı ve tezgâh", qty: kitchens, unit: "adet" },
    { id: "merdiven", group: "İnce yapı", name: "Merdiven kaplaması ve korkuluğu", qty: stairs, unit: "kat" },
    { id: "korkuluk", group: "İnce yapı", name: "Balkon, teras ve galeri korkuluğu", qty: r1(rail), unit: "m" },
    { id: "tesisat", group: "Tesisat", name: "Elektrik, sıhhi tesisat ve ısıtma", qty: r1(gross), unit: "brüt m²" },
    ...(L.elevator ? [{ id: "asansor", group: "Tesisat", name: "Asansör", qty: 1, unit: "adet" }] : []),
  ].filter((i) => i.qty > 0).map((i) => ({ ...i, price: P(i.id) }));
  const groups = [...new Set(items.map((i) => i.group))].map((g) => ({ group: g, total: items.filter((i) => i.group === g).reduce((s, i) => s + i.qty * i.price, 0) }));
  return { items, total: groups.reduce((s, g) => s + g.total, 0), groups };
}
