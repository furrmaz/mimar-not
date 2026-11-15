// Taşıyıcı sistem ön önerisi: plandan aks düzeni, kolon yerleri ve ön boyutlar çıkarır.
//
// Bu bir statik hesap değildir. Mimarın avan projede taşıyıcıyı düşünerek ilerlemesi için yaygın ön boyutlandırma
// kurallarını uygular: aks aralığı 3–6,5 m, kiriş yüksekliği ≈ açıklık / 10–12, döşeme kalınlığı ≈ açıklık / 30,
// kolon alanı ≈ eksenel yük / (0,4 · fck), en küçük kolon kenarı 30 cm (TBDY 2018'in ön boyut sınırlarıyla uyumlu).
// Kesin boyutlar ve donatı inşaat mühendisinin statik projesinde belirlenir.
import type { BuildingLayout, FloorLayout, Rect } from "./layout";
import { floorRects } from "./massing";

export interface StructColumn { x: number; y: number; ax: string; ay: string; w: number; d: number; trib: number; inRoom: boolean }
export interface StructBeam { orient: "h" | "v"; line: number; a: number; b: number; span: number }
export interface StructurePlan {
  xs: number[];
  ys: number[];
  columns: StructColumn[];
  beams: StructBeam[];
  maxSpan: number;
  beam: { w: number; h: number };
  slab: number;
  storeys: number;
  cantilever: number;
  shearWalls: boolean;
  notes: string[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const up5 = (cm: number) => Math.ceil(cm / 5 - 1e-9) * 5;
const MIN_SPAN = 2.8, MAX_SPAN = 6.2, TARGET = 5.0;
const inRect = (r: Rect, x: number, y: number, t = 0.02) => x > r.x - t && x < r.x + r.w + t && y > r.y - t && y < r.y + r.h + t;

/** 0…len arasında aksları seçer; önce duvar çizgilerine oturtur, uygun çizgi yoksa açıklığı eşit böler. */
function pickAxes(len: number, cand: { v: number; w: number }[]): number[] {
  const out = [0];
  let cur = 0;
  let guard = 0;
  while (len - cur > MAX_SPAN + 1e-6 && guard++ < 40) {
    const rest = len - cur;
    const opts = cand.filter((c) => c.v - cur >= MIN_SPAN - 1e-6 && c.v - cur <= MAX_SPAN + 1e-6 && (len - c.v >= MIN_SPAN - 1e-6));
    let next: number;
    if (opts.length) {
      // uzun duvar çizgisi ve hedef açıklığa yakınlık
      next = opts.sort((p, q) => q.w - Math.abs(q.v - cur - TARGET) * 1.5 - (p.w - Math.abs(p.v - cur - TARGET) * 1.5))[0].v;
    } else next = cur + rest / Math.ceil(rest / TARGET);
    out.push(r2(next));
    cur = next;
  }
  out.push(r2(len));
  return out;
}

export function structurePlan(L: BuildingLayout): StructurePlan {
  const above = L.floors.filter((f) => f.z >= 0);
  const base = above[0] ?? L.floors[0];
  const storeys = L.floors.length;
  // duvar çizgisi adayları: bütün katlarda yinelenen çizgiler daha ağır basar
  const collect = (orient: "h" | "v", len: number) => {
    const m = new Map<number, number>();
    for (const f of L.floors) for (const w of f.wallLines) {
      if (w.orient !== orient || w.line < 0.5 || w.line > len - 0.5) continue;
      const k = Math.round(w.line * 20) / 20;
      m.set(k, (m.get(k) ?? 0) + (w.b - w.a));
    }
    return [...m.entries()].map(([v, w]) => ({ v, w: w / Math.max(1, L.floors.length) }));
  };
  const xs = pickAxes(L.W, collect("v", L.D));
  const ys = pickAxes(L.D, collect("h", L.W));
  const letters = "ABCDEFGHJKLMNPRSTUVYZ";
  const rectsOf = (f: FloorLayout) => floorRects(f, L);
  const baseRects = rectsOf(base);
  const allRects = L.floors.map(rectsOf);
  const inside = (rs: Rect[], x: number, y: number) => rs.some((r) => inRect(r, x, y));
  const columns: StructColumn[] = [];
  const has = new Set<string>();
  const trib = (arr: number[], i: number) => ((arr[i + 1] ?? arr[i]) - (arr[i - 1] ?? arr[i])) / 2;
  xs.forEach((x, i) => ys.forEach((y, j) => {
    // kolon bütün katlarda sürmeli: zemin kat oturumunun içinde olmalı
    if (!inside(baseRects, x, y)) return;
    const strictlyIn = base.rooms.some((r) => r.type !== "merdiven" && x > r.rect.x + 0.3 && x < r.rect.x + r.rect.w - 0.3 && y > r.rect.y + 0.3 && y < r.rect.y + r.rect.h - 0.3);
    const t = trib(xs, i) * trib(ys, j);
    columns.push({ x, y, ax: letters[i] ?? `X${i}`, ay: String(j + 1), w: 30, d: 30, trib: r2(t), inRoom: strictlyIn });
    has.add(`${i}:${j}`);
  }));
  // kiriş: komşu iki kolon arasında, en az bir katta döşeme varsa
  const beams: StructBeam[] = [];
  xs.forEach((x, i) => ys.forEach((y, j) => {
    if (!has.has(`${i}:${j}`)) return;
    if (has.has(`${i + 1}:${j}`)) beams.push({ orient: "h", line: y, a: x, b: xs[i + 1], span: r2(xs[i + 1] - x) });
    if (has.has(`${i}:${j + 1}`)) beams.push({ orient: "v", line: x, a: y, b: ys[j + 1], span: r2(ys[j + 1] - y) });
  }));
  const maxSpan = Math.max(0, ...beams.map((b) => b.span));
  // konsol: üst katlarda zemin oturumunun dışına taşan en büyük derinlik
  let cantilever = 0;
  for (const rs of allRects) for (const r of rs) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    for (const [px, py, d] of [[cx, r.y + 0.05, 0], [cx, r.y + r.h - 0.05, 1], [r.x + 0.05, cy, 2], [r.x + r.w - 0.05, cy, 3]] as [number, number, number][]) {
      if (inside(baseRects, px, py)) continue;
      // taşan şeridin derinliği: zemin oturumuna olan uzaklık
      let dist = 0;
      const step = 0.1;
      let qx = px, qy = py;
      while (!inside(baseRects, qx, qy) && dist < 4) { dist += step; if (d === 0) qy += step; else if (d === 1) qy -= step; else if (d === 2) qx += step; else qx -= step; }
      cantilever = Math.max(cantilever, dist);
    }
  }
  cantilever = r2(Math.min(4, cantilever));
  // ön boyutlar
  const beamH = Math.max(50, up5((maxSpan * 100) / 11), cantilever ? up5((cantilever * 100) / 4.5) : 0);
  const beam = { w: maxSpan > 5.5 || storeys > 3 ? 30 : 25, h: Math.min(80, beamH) };
  const slab = Math.max(12, Math.ceil((Math.min(maxSpan, 6) * 100) / 30));
  // kolon: N ≈ etki alanı × kat sayısı × 15 kN/m²; Ac ≥ N / (0,4·fck), C30
  const fck = 30000;
  for (const c of columns) {
    const N = c.trib * storeys * 15;
    const need = Math.max(900, (N / (0.4 * fck)) * 1e4 * 1.3); // cm², deprem için %30 pay
    c.w = storeys > 4 ? 40 : 30;
    c.d = Math.max(c.w, up5(need / c.w));
    if (c.d < 50 && storeys >= 2) c.d = 50;
    if (c.d > 3 * c.w) { c.w = up5(Math.sqrt(need / 2)); c.d = up5(need / c.w); }
  }
  const shearWalls = storeys >= 4;
  const notes: string[] = [];
  notes.push(`Aks aralıkları ${xs.slice(1).map((v, i) => (v - xs[i]).toFixed(2)).join(" / ")} m (sokak boyunca) ve ${ys.slice(1).map((v, i) => (v - ys[i]).toFixed(2)).join(" / ")} m (derinlik).`);
  if (maxSpan > 6.5) notes.push(`En büyük açıklık ${maxSpan.toFixed(2)} m: kiriş yüksekliği artar; ara aks eklemeyi ya da asmolen / kirişsiz döşemeyi değerlendirin.`);
  const loose = columns.filter((c) => c.inRoom);
  if (loose.length) notes.push(`${loose.map((c) => c.ax + c.ay).join(", ")} kolonu bir mahallin içine düşüyor; duvara ya da köşeye kaydırmak için oda sınırını aksa hizalayın.`);
  if (cantilever > 0.2) notes.push(`${cantilever.toFixed(2)} m konsol: konsol kirişleri içerideki açıklığa en az konsol boyunun 1,5 katı kadar sürmeli; kiriş yüksekliği buna göre ${beam.h} cm alındı.`);
  if (L.floors.some((f) => f.rooms.some((r) => r.void))) notes.push("Galeri boşluğu çevresinde döşeme kenar kirişi gerekir; boşluk kenarındaki kolonlar iki kat boyunca yanal tutulmaz.");
  if (L.slab * 100 + 0.5 < slab) notes.push(`Plak döşeme için ön kalınlık ${slab} cm; çizimlerdeki ${Math.round(L.slab * 100)} cm döşeme kaplamayla birlikte yeniden değerlendirilmeli.`);
  if (shearWalls) notes.push("4 kat ve üzeri: merdiven ve asansör çekirdeğinin çevresinde betonarme perde (her iki yönde) önerilir.");
  else notes.push("Az katlı yapı: betonarme çerçeve yeterli olur; deprem bölgesine göre merdiven çevresinde perde eklenebilir.");
  notes.push("Bu ön öneridir; kesin boyut, donatı ve temel sistemi zemin etüdüne göre inşaat mühendisinin statik projesinde belirlenir.");
  return { xs, ys, columns, beams, maxSpan: r2(maxSpan), beam, slab, storeys, cantilever, shearWalls, notes };
}

/** Aks ve kolon şeması (zemin kat oturumu üzerinde). */
export function structureSVG(L: BuildingLayout, st: StructurePlan = structurePlan(L)): string {
  const S = 34, M = 2.0;
  const base = L.floors.filter((f) => f.z >= 0)[0] ?? L.floors[0];
  const X = (x: number) => (x + M) * S, Y = (y: number) => (L.D - y + M) * S; // sokak altta
  const wpx = (L.W + 2 * M) * S, hpx = (L.D + 2 * M) * S;
  const p: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${wpx} ${hpx}" width="${wpx}" height="${hpx}" font-family="Inter, system-ui, sans-serif">`, `<rect width="100%" height="100%" fill="#fff"/>`];
  for (const r of base.rooms) {
    const q = r.rect;
    p.push(`<rect x="${X(q.x)}" y="${Y(q.y + q.h)}" width="${q.w * S}" height="${q.h * S}" fill="${r.type === "merdiven" ? "#eee" : "#f7f5f0"}" stroke="#c9c2b4" stroke-width="1"/>`);
    if (q.w > 2 && q.h > 1.2) p.push(`<text x="${X(q.x + q.w / 2)}" y="${Y(q.y + q.h / 2) + 4}" font-size="10" fill="#9a9284" text-anchor="middle">${r.name}</text>`);
  }
  // üst katların oturumu (konsol / çekilme) kesikli
  for (const f of L.floors.filter((q) => q.z > base.z)) for (const r of floorRects(f, L)) p.push(`<rect x="${X(r.x)}" y="${Y(r.y + r.h)}" width="${r.w * S}" height="${r.h * S}" fill="none" stroke="#b9722f" stroke-width="0.8" stroke-dasharray="5 4" opacity="0.5"/>`);
  for (const b of st.beams) {
    const [x1, y1, x2, y2] = b.orient === "h" ? [X(b.a), Y(b.line), X(b.b), Y(b.line)] : [X(b.line), Y(b.a), X(b.line), Y(b.b)];
    p.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#3b6ea5" stroke-width="5" opacity="0.55"/>`);
  }
  const bubble = (cx: number, cy: number, t: string) => `<circle cx="${cx}" cy="${cy}" r="11" fill="#fff" stroke="#c0392b" stroke-width="1.2"/><text x="${cx}" y="${cy + 4}" font-size="11" font-weight="600" fill="#c0392b" text-anchor="middle">${t}</text>`;
  const letters = "ABCDEFGHJKLMNPRSTUVYZ";
  st.xs.forEach((x, i) => {
    p.push(`<line x1="${X(x)}" y1="${Y(L.D) - 22}" x2="${X(x)}" y2="${Y(0) + 22}" stroke="#c0392b" stroke-width="0.8" stroke-dasharray="14 4 2 4"/>`, bubble(X(x), Y(0) + 34, letters[i] ?? String(i)));
    if (i) p.push(`<text x="${(X(x) + X(st.xs[i - 1])) / 2}" y="${Y(L.D) - 28}" font-size="10" fill="#555" text-anchor="middle">${(x - st.xs[i - 1]).toFixed(2)}</text>`);
  });
  st.ys.forEach((y, j) => {
    p.push(`<line x1="${X(0) - 22}" y1="${Y(y)}" x2="${X(L.W) + 22}" y2="${Y(y)}" stroke="#c0392b" stroke-width="0.8" stroke-dasharray="14 4 2 4"/>`, bubble(X(0) - 34, Y(y), String(j + 1)));
    if (j) p.push(`<text x="${X(L.W) + 30}" y="${(Y(y) + Y(st.ys[j - 1])) / 2 + 4}" font-size="10" fill="#555" text-anchor="start">${(y - st.ys[j - 1]).toFixed(2)}</text>`);
  });
  for (const c of st.columns) {
    // uzun kenar, daha uzun kirişe paralel değil: dış akslarda cepheye dik
    const horiz = c.x < 0.01 || c.x > L.W - 0.01 ? true : !(c.y < 0.01 || c.y > L.D - 0.01);
    const w = (horiz ? c.d : c.w) / 100, d = (horiz ? c.w : c.d) / 100;
    const cx = Math.min(L.W - w / 2, Math.max(w / 2, c.x)), cy = Math.min(L.D - d / 2, Math.max(d / 2, c.y));
    p.push(`<rect x="${X(cx - w / 2)}" y="${Y(cy + d / 2)}" width="${w * S}" height="${d * S}" fill="${c.inRoom ? "#c0392b" : "#222"}"/>`);
  }
  p.push(`<text x="${wpx / 2}" y="${hpx - 6}" font-size="10" fill="#777" text-anchor="middle">SOKAK CEPHESİ · kolonlar ${st.columns[0] ? `${st.columns[0].w}×${Math.max(...st.columns.map((c) => c.d))}` : ""} cm, kirişler ${st.beam.w}×${st.beam.h} cm (ön boyut)</text>`, "</svg>");
  return p.join("");
}
