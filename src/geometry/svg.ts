// Plan, kesit, cephe ve vaziyet planı için SVG üreticileri (saf fonksiyonlar → SVG metni).
import type { BuildingLayout, FloorLayout, Opening, Rect } from "./layout";
import { ZONE_COLORS, near } from "./layout";
import type { Program } from "../shared/schema";
import { zoningCheck } from "./zoning";

const S = 50; // px / m
const INK = "#1d1d1f";
const THIN = "#55575c";
const DIM = "#7a4e2d";
const FONT = `font-family="Inter, 'Segoe UI', Arial, sans-serif"`;

const f2 = (v: number) => v.toFixed(2);
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function svgDoc(w: number, h: number, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" ${FONT}><rect width="100%" height="100%" fill="#ffffff"/>${body}</svg>`;
}

function text(x: number, y: number, t: string, size = 12, opts: { anchor?: string; weight?: number; fill?: string; rotate?: number } = {}) {
  const rot = opts.rotate ? ` transform="rotate(${opts.rotate} ${x.toFixed(1)} ${y.toFixed(1)})"` : "";
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" text-anchor="${opts.anchor ?? "middle"}" font-weight="${opts.weight ?? 400}" fill="${opts.fill ?? INK}"${rot}>${esc(t)}</text>`;
}

/** Ölçü çizgisi (px koordinatlarında). */
function dimLine(x1: number, y1: number, x2: number, y2: number, label: string, offsetDir: 1 | -1 = 1) {
  const horiz = Math.abs(y1 - y2) < 0.5;
  const tick = (x: number, y: number) => `<line x1="${x - 4}" y1="${y + 4}" x2="${x + 4}" y2="${y - 4}" stroke="${DIM}" stroke-width="1.2"/>`;
  let s = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${DIM}" stroke-width="0.8"/>` + tick(x1, y1) + tick(x2, y2);
  if (horiz) s += text((x1 + x2) / 2, y1 - 4 * offsetDir, label, 10, { fill: DIM });
  else s += text(x1 - 5 * offsetDir, (y1 + y2) / 2, label, 10, { fill: DIM, rotate: -90 });
  return s;
}

// ---------------------------------------------------------------- KAT PLANI

export function planSVG(L: BuildingLayout, floor: FloorLayout, program: Program): string {
  const M = 2.2; // kenar boşluğu (m)
  const outDepth = floor.outdoor.reduce((s, o) => Math.max(s, o.rect.y + o.rect.h - L.D), 0);
  const Wm = L.W + 2 * M;
  const Dm = L.D + 2 * M + outDepth;
  const titleH = 56;
  // dünya → px (ön cephe altta)
  const X = (x: number) => (x + M) * S;
  const Y = (y: number) => (L.D + outDepth - y + M) * S + titleH;
  const parts: string[] = [];

  parts.push(text(16, 26, `${program.projectName} — ${floor.name}`, 18, { anchor: "start", weight: 600 }));
  parts.push(text(16, 44, `Kat planı · ölçek ≈ 1:${Math.round(100 * (50 / S))} · kot ${floor.z >= 0 ? "+" : ""}${f2(floor.z)}`, 11, { anchor: "start", fill: THIN }));

  // Dış mekânlar
  for (const o of floor.outdoor) {
    const r = o.rect;
    parts.push(`<rect x="${X(r.x)}" y="${Y(r.y + r.h)}" width="${r.w * S}" height="${r.h * S}" fill="${ZONE_COLORS.dis}" stroke="${THIN}" stroke-width="1" stroke-dasharray="6 3"/>`);
    parts.push(`<rect x="${X(r.x) + 3}" y="${Y(r.y + r.h) + 3}" width="${r.w * S - 6}" height="${r.h * S - 6}" fill="none" stroke="${THIN}" stroke-width="0.6"/>`);
    parts.push(text(X(r.x + r.w / 2), Y(r.y + r.h / 2) + 4, `${o.name} · ${o.area.toFixed(1)} m²`, 11));
  }

  // Oda zeminleri
  for (const r of floor.rooms) {
    const fill = r.type === "merdiven" ? "#f4f4f4" : ZONE_COLORS[r.zone] ?? "#f5f5f5";
    parts.push(`<rect x="${X(r.rect.x)}" y="${Y(r.rect.y + r.rect.h)}" width="${r.rect.w * S}" height="${r.rect.h * S}" fill="${fill}"/>`);
  }

  // Merdiven (U dönüşlü)
  if (L.stair) parts.push(stairPlan(L.stair, X, Y, floor.level === L.floors[L.floors.length - 1].level));

  // Duvarlar
  for (const w of floor.walls) parts.push(wallRect(w.orient, w.line, w.a, w.b, w.thickness, X, Y, w.exterior ? INK : "#3b3b3e"));

  // Açıklıklar
  for (const o of floor.openings) parts.push(openingPlan(o, L, X, Y));

  // Oda etiketleri
  for (const r of floor.rooms) {
    if (r.type === "merdiven") continue;
    const cx = X(r.rect.x + r.rect.w / 2);
    const cy = Y(r.rect.y + r.rect.h / 2);
    const area = r.rect.w * r.rect.h;
    const small = r.rect.w < 2.2 || r.rect.h < 1.6;
    const fs = small ? 9 : 12;
    const label = small && r.name.length > 12 ? r.name.split(" ")[0] : r.name;
    parts.push(text(cx, cy - (small ? 2 : 6), label, fs, { weight: 600 }));
    parts.push(text(cx, cy + (small ? 9 : 10), `${area.toFixed(1)} m²`, small ? 8 : 11, { fill: THIN }));
    if (!small) parts.push(text(cx, cy + 24, `${f2(r.rect.w)} × ${f2(r.rect.h)}`, 9, { fill: "#8c8c90" }));
  }

  // Ölçüler: alt toplam + ön bant zinciri, sağ toplam + bant zinciri
  const yb = Y(0) + 1.5 * S;
  parts.push(dimLine(X(0), yb, X(L.W), yb, `${f2(L.W)}`, -1));
  const front = floor.rooms.filter((r) => near(r.rect.y, 0)).sort((a, b) => a.rect.x - b.rect.x);
  const xs = Array.from(new Set([0, ...front.map((r) => r.rect.x + r.rect.w)])).sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) parts.push(dimLine(X(xs[i]), Y(0) + 0.8 * S, X(xs[i + 1]), Y(0) + 0.8 * S, f2(xs[i + 1] - xs[i]), -1));
  const xr = X(L.W) + 1.5 * S;
  parts.push(dimLine(xr, Y(0), xr, Y(L.D), `${f2(L.D)}`, -1));
  const ys = [0, L.hallBand.y, L.hallBand.y + L.hallBand.h, L.D];
  for (let i = 0; i < ys.length - 1; i++) parts.push(dimLine(X(L.W) + 0.8 * S, Y(ys[i]), X(L.W) + 0.8 * S, Y(ys[i + 1]), f2(ys[i + 1] - ys[i]), -1));

  // Kesit hattı A-A
  const ax = X(L.cutX);
  parts.push(`<line x1="${ax}" y1="${Y(L.D + outDepth) - 0.9 * S}" x2="${ax}" y2="${Y(0) + 0.4 * S}" stroke="#c0392b" stroke-width="1.2" stroke-dasharray="14 4 2 4"/>`);
  for (const yy of [Y(L.D + outDepth) - 0.9 * S, Y(0) + 0.4 * S]) {
    parts.push(`<circle cx="${ax}" cy="${yy}" r="10" fill="#fff" stroke="#c0392b" stroke-width="1.2"/>`);
    parts.push(text(ax, yy + 4, "A", 11, { fill: "#c0392b", weight: 700 }));
  }
  // Sokak / bahçe etiketi
  parts.push(text(X(L.W / 2), Y(0) + 2.0 * S, "SOKAK CEPHESİ", 10, { fill: THIN, weight: 600 }));

  return svgDoc(Wm * S, Dm * S + titleH, parts.join(""));
}

function wallRect(orient: "h" | "v", line: number, a: number, b: number, t: number, X: (x: number) => number, Y: (y: number) => number, fill: string) {
  if (orient === "h") {
    return `<rect x="${X(a)}" y="${Y(line + t / 2)}" width="${(b - a) * S}" height="${t * S}" fill="${fill}"/>`;
  }
  return `<rect x="${X(line - t / 2)}" y="${Y(b)}" width="${t * S}" height="${(b - a) * S}" fill="${fill}"/>`;
}

function openingPlan(o: Opening, L: BuildingLayout, X: (x: number) => number, Y: (y: number) => number) {
  const t = o.exterior ? L.extWall : L.intWall;
  const a = o.center - o.width / 2;
  const b = o.center + o.width / 2;
  // dünya koordinatında yardımcı: duvar boyunca u, dik v
  const P = (u: number, v: number) => (o.orient === "h" ? [X(u), Y(v)] : [X(v), Y(u)]);
  const out: string[] = [];
  if (o.kind === "window" || o.kind === "balconyDoor") {
    const [x0, y0] = P(a, o.line - t / 2);
    const [x1, y1] = P(b, o.line + t / 2);
    const rx = Math.min(x0, x1), ry = Math.min(y0, y1), rw = Math.abs(x1 - x0), rh = Math.abs(y1 - y0);
    out.push(`<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="#fff" stroke="${INK}" stroke-width="0.8"/>`);
    // cam çizgileri
    for (const k of [-0.15, 0.15]) {
      const [lx0, ly0] = P(a, o.line + k * t);
      const [lx1, ly1] = P(b, o.line + k * t);
      out.push(`<line x1="${lx0}" y1="${ly0}" x2="${lx1}" y2="${ly1}" stroke="#2f6fb0" stroke-width="0.9"/>`);
    }
    if (o.kind === "balconyDoor") {
      const [hx, hy] = P(a, o.line);
      const [ex, ey] = P(a, o.line + o.swing * o.width * 0.5);
      out.push(`<line x1="${hx}" y1="${hy}" x2="${ex}" y2="${ey}" stroke="${THIN}" stroke-width="0.8"/>`);
    }
    return out.join("");
  }
  // kapı: kanat + yay
  const w = o.width;
  const hinge = a;
  const s = o.swing;
  const [hx, hy] = P(hinge, o.line);
  const [lx, ly] = P(hinge, o.line + s * w);
  const pts: string[] = [];
  for (let i = 0; i <= 16; i++) {
    const ang = (Math.PI / 2) * (i / 16);
    const [px, py] = P(hinge + Math.cos(ang) * w, o.line + s * Math.sin(ang) * w);
    pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
  }
  const strong = o.kind === "entrance";
  out.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${THIN}" stroke-width="0.7" stroke-dasharray="3 2"/>`);
  out.push(`<line x1="${hx}" y1="${hy}" x2="${lx}" y2="${ly}" stroke="${INK}" stroke-width="${strong ? 2.4 : 1.6}"/>`);
  if (strong) {
    const [gx, gy] = P(o.center, o.line + s * (w + 0.35));
    out.push(text(gx, gy + 4, w > 2 ? "GARAJ" : "GİRİŞ ▲", 10, { weight: 700, fill: "#c0392b" }));
  }
  return out.join("");
}

function stairPlan(st: Rect, X: (x: number) => number, Y: (y: number) => number, isTop: boolean) {
  const out: string[] = [];
  const flightW = (st.h - 0.15) / 2;
  const landing = 1.1;
  const run = st.w - landing;
  const tread = 0.28;
  const n = Math.max(3, Math.floor(run / tread));
  // iki kol: alt kol (y düşük) ve üst kol, sahanlık solda (x=0 tarafı)
  for (const [y0, label] of [[st.y, "up"], [st.y + flightW + 0.15, "down"]] as const) {
    out.push(`<rect x="${X(landing)}" y="${Y(y0 + flightW)}" width="${run * S}" height="${flightW * S}" fill="#fafafa" stroke="${THIN}" stroke-width="0.8"/>`);
    for (let i = 1; i < n; i++) {
      const x = landing + (run * i) / n;
      out.push(`<line x1="${X(x)}" y1="${Y(y0)}" x2="${X(x)}" y2="${Y(y0 + flightW)}" stroke="${THIN}" stroke-width="0.6"/>`);
    }
    void label;
  }
  // orta ayırıcı
  out.push(`<rect x="${X(landing)}" y="${Y(st.y + flightW + 0.15)}" width="${run * S}" height="${0.15 * S}" fill="#bbb"/>`);
  // ok: alt koldan sahanlığa, üst koldan geri
  const yA = st.y + flightW / 2, yB = st.y + flightW + 0.15 + flightW / 2;
  out.push(`<polyline points="${X(st.w - 0.2)},${Y(yA)} ${X(0.55)},${Y(yA)} ${X(0.55)},${Y(yB)} ${X(st.w - 0.4)},${Y(yB)}" fill="none" stroke="${INK}" stroke-width="1"/>`);
  out.push(`<polygon points="${X(st.w - 0.4)},${Y(yB) - 4} ${X(st.w - 0.2)},${Y(yB)} ${X(st.w - 0.4)},${Y(yB) + 4}" fill="${INK}"/>`);
  if (!isTop) {
    // kesme çizgisi (üst kat görünmüyor)
    out.push(`<line x1="${X(landing + run * 0.55)}" y1="${Y(st.y)}" x2="${X(landing + run * 0.75)}" y2="${Y(st.y + st.h)}" stroke="${INK}" stroke-width="1"/>`);
  }
  out.push(text(X(st.w / 2 + 0.4), Y(st.y + st.h) - 4, "Merdiven", 9, { fill: THIN }));
  return out.join("");
}

// ---------------------------------------------------------------- KESİT A-A

export function sectionSVG(L: BuildingLayout, program: Program): string {
  const M = 2.4;
  const bottomZ = Math.min(0, ...L.floors.map((f) => f.z)) - 1.2;
  const topZ = L.totalHeight + L.roofHeight + 0.6;
  const outMax = Math.max(0, ...L.floors.flatMap((f) => f.outdoor.map((o) => o.rect.y + o.rect.h - L.D)));
  const widthM = L.D + outMax + 2 * M + 1.6;
  const heightM = topZ - bottomZ + 1.2;
  const titleH = 56;
  const X = (y: number) => (y + M) * S;
  const Z = (z: number) => (topZ - z) * S + titleH;
  const p: string[] = [];
  p.push(text(16, 26, `${program.projectName} — A-A Kesiti`, 18, { anchor: "start", weight: 600 }));
  p.push(text(16, 44, `Kesit hattı x = ${f2(L.cutX)} m · ölçek ≈ 1:100`, 11, { anchor: "start", fill: THIN }));

  const groundZ = -0.3;
  // zemin
  p.push(`<rect x="0" y="${Z(groundZ)}" width="${widthM * S}" height="${(groundZ - bottomZ + 1.2) * S}" fill="url(#earth)"/>`);
  p.push(`<defs><pattern id="earth" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="#f3efe7"/><line x1="0" y1="0" x2="0" y2="10" stroke="#cbbfa8" stroke-width="1"/></pattern></defs>`);
  p.push(`<line x1="0" y1="${Z(groundZ)}" x2="${widthM * S}" y2="${Z(groundZ)}" stroke="${INK}" stroke-width="1.6"/>`);

  const t = L.extWall;
  const floorsSorted = [...L.floors].sort((a, b) => a.z - b.z);
  const lowest = floorsSorted[0];
  // temel
  for (const yy of [0, L.D]) {
    p.push(`<rect x="${X(yy - 0.45)}" y="${Z(lowest.z - L.slab)}" width="${0.9 * S}" height="${0.6 * S}" fill="#9a9a9a" stroke="${INK}" stroke-width="0.8"/>`);
  }

  for (const f of floorsSorted) {
    const z0 = f.z;
    const clear = L.H - L.slab;
    // döşeme (kesilen, koyu)
    p.push(`<rect x="${X(-t / 2)}" y="${Z(z0)}" width="${(L.D + t) * S}" height="${L.slab * S}" fill="${INK}"/>`);
    // kesilen duvarlar
    for (const w of f.wallLines) {
      if (w.orient !== "h" || L.cutX < w.a || L.cutX > w.b) continue;
      const op = f.openings.find((o) => o.orient === "h" && near(o.line, w.line) && Math.abs(o.center - L.cutX) <= o.width / 2);
      const th = w.thickness;
      const seg = (za: number, zb: number) => `<rect x="${X(w.line - th / 2)}" y="${Z(z0 + zb)}" width="${th * S}" height="${(zb - za) * S}" fill="${INK}"/>`;
      if (!op) p.push(seg(0, clear));
      else {
        if (op.sill > 0) p.push(seg(0, op.sill));
        p.push(seg(op.head, clear));
        if (op.kind === "window" || op.kind === "balconyDoor") {
          p.push(`<line x1="${X(w.line)}" y1="${Z(z0 + op.sill)}" x2="${X(w.line)}" y2="${Z(z0 + op.head)}" stroke="#2f6fb0" stroke-width="2"/>`);
        }
      }
    }
    // görünen arka duvar çizgileri (x yönündeki ilk duvar) — ince
    // oda etiketleri
    for (const r of f.rooms) {
      if (L.cutX < r.rect.x || L.cutX > r.rect.x + r.rect.w) continue;
      const cy = r.rect.y + r.rect.h / 2;
      p.push(text(X(cy), Z(z0 + clear / 2), r.name, r.rect.h < 2 ? 9 : 11, { weight: 600 }));
    }
    // balkon çıkması
    for (const o of f.outdoor) {
      p.push(`<rect x="${X(L.D)}" y="${Z(z0)}" width="${(o.rect.y + o.rect.h - L.D) * S}" height="${0.18 * S}" fill="${o.rect.x <= L.cutX && o.rect.x + o.rect.w >= L.cutX ? INK : "#888"}"/>`);
      const ey = o.rect.y + o.rect.h;
      p.push(`<line x1="${X(ey)}" y1="${Z(z0)}" x2="${X(ey)}" y2="${Z(z0 + 1.1)}" stroke="${INK}" stroke-width="1.4"/>`);
      p.push(`<line x1="${X(L.D)}" y1="${Z(z0 + 1.1)}" x2="${X(ey)}" y2="${Z(z0 + 1.1)}" stroke="${INK}" stroke-width="1.4"/>`);
    }
    // kot işareti
    p.push(levelMark(X(L.D + outMax) + 1.0 * S, Z(z0), z0));
  }

  // tavan / çatı döşemesi
  const top = L.totalHeight;
  p.push(`<rect x="${X(-t / 2)}" y="${Z(top)}" width="${(L.D + t) * S}" height="${L.slab * S}" fill="${INK}"/>`);
  if (L.roof === "duz") {
    for (const yy of [0, L.D]) p.push(`<rect x="${X(yy - t / 2)}" y="${Z(top + L.roofHeight)}" width="${t * S}" height="${L.roofHeight * S}" fill="${INK}"/>`);
  } else {
    const oh = 0.6;
    const rise = L.roofHeight;
    const slope = rise / (L.D / 2);
    const pts = [
      [X(-oh), Z(top - oh * slope)],
      [X(L.D / 2), Z(top + rise)],
      [X(L.D + oh), Z(top - oh * slope)],
    ];
    const pts2 = pts.map(([x, z]) => `${x.toFixed(1)},${(z - 0.22 * S).toFixed(1)}`).reverse();
    p.push(`<polygon points="${pts.map(([x, z]) => `${x.toFixed(1)},${z.toFixed(1)}`).join(" ")} ${pts2.join(" ")}" fill="#7b4a36" stroke="${INK}" stroke-width="1"/>`);
  }
  p.push(levelMark(X(L.D + outMax) + 1.0 * S, Z(top), top));

  // yükseklik ölçüleri (sol)
  const xl = X(-1.4);
  for (const f of floorsSorted) p.push(dimLine(xl, Z(f.z), xl, Z(f.z + L.H), f2(L.H)));
  p.push(dimLine(X(-2.0), Z(groundZ), X(-2.0), Z(top + (L.roof === "duz" ? L.roofHeight : L.roofHeight)), `H ${f2(top + L.roofHeight - groundZ)}`));
  // derinlik ölçüsü (alt)
  p.push(dimLine(X(0), Z(bottomZ) - 8, X(L.D), Z(bottomZ) - 8, f2(L.D), -1));
  p.push(text(X(0), Z(groundZ) + 16, "ÖN", 10, { fill: THIN, weight: 700 }));
  p.push(text(X(L.D), Z(groundZ) + 16, "ARKA", 10, { fill: THIN, weight: 700 }));

  return svgDoc(widthM * S, heightM * S + titleH, p.join(""));
}

function levelMark(x: number, y: number, z: number) {
  const lbl = Math.abs(z) < 0.005 ? "±0.00" : `${z > 0 ? "+" : ""}${f2(z)}`;
  return `<polygon points="${x - 6},${y - 10} ${x + 6},${y - 10} ${x},${y}" fill="none" stroke="${INK}" stroke-width="1"/><line x1="${x - 14}" y1="${y}" x2="${x + 40}" y2="${y}" stroke="${INK}" stroke-width="0.7"/>${text(x + 12, y - 4, lbl, 10, { anchor: "start" })}`;
}

// ---------------------------------------------------------------- CEPHE

export type Facade = "front" | "back" | "left" | "right";
export const FACADE_NAMES: Record<Facade, string> = { front: "Ön (Sokak) Cephesi", back: "Arka (Bahçe) Cephesi", left: "Sol Yan Cephe", right: "Sağ Yan Cephe" };

export function elevationSVG(L: BuildingLayout, program: Program, facade: Facade): string {
  const len = facade === "front" || facade === "back" ? L.W : L.D;
  const M = 2.4;
  const groundZ = -0.3;
  const top = L.totalHeight;
  const topZ = top + L.roofHeight + 0.8;
  const titleH = 56;
  const widthM = len + 2 * M + 3;
  const heightM = topZ - groundZ + 1.6;
  const U = (u: number) => (u + M) * S;
  const Z = (z: number) => (topZ - z) * S + titleH;
  // dünya → cephe u koordinatı
  const toU = (x: number, y: number) =>
    facade === "front" ? x : facade === "back" ? L.W - x : facade === "left" ? L.D - y : y;
  const p: string[] = [];
  p.push(text(16, 26, `${program.projectName} — ${FACADE_NAMES[facade]}`, 18, { anchor: "start", weight: 600 }));
  p.push(text(16, 44, `Görünüş · ölçek ≈ 1:100 · ${program.style}`, 11, { anchor: "start", fill: THIN }));

  const aboveGround = L.floors.filter((f) => f.z >= 0);
  const wallBottom = Math.max(groundZ, Math.min(...aboveGround.map((f) => f.z), 0) - 0.3);
  // cephe yüzeyi
  p.push(`<rect x="${U(0)}" y="${Z(top)}" width="${len * S}" height="${(top - wallBottom) * S}" fill="#f4efe6" stroke="${INK}" stroke-width="1.6"/>`);
  // zemin kat taş kaplama bandı
  p.push(`<rect x="${U(0)}" y="${Z(Math.min(L.H, top) - L.slab)}" width="${len * S}" height="${(Math.min(L.H, top) - L.slab - wallBottom) * S}" fill="url(#stone)" opacity="0.55"/>`);
  p.push(`<defs><pattern id="stone" width="36" height="18" patternUnits="userSpaceOnUse"><rect width="36" height="18" fill="#e3dccf"/><path d="M0 9 H36 M12 0 V9 M30 9 V18" stroke="#c9bfae" stroke-width="1" fill="none"/></pattern><pattern id="wood" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#c9a27a"/><line x1="0" y1="0" x2="0" y2="8" stroke="#a9825a" stroke-width="1"/></pattern></defs>`);
  // kat döşeme çizgileri
  for (const f of aboveGround) if (f.z > 0) p.push(`<rect x="${U(0)}" y="${Z(f.z)}" width="${len * S}" height="${L.slab * S}" fill="#d8d0c2"/>`);

  // açıklıklar
  const onFacade = (o: Opening) =>
    facade === "front" ? o.orient === "h" && near(o.line, 0)
      : facade === "back" ? o.orient === "h" && near(o.line, L.D)
        : facade === "left" ? o.orient === "v" && near(o.line, 0)
          : o.orient === "v" && near(o.line, L.W);
  for (const f of aboveGround) {
    for (const o of f.openings.filter(onFacade)) {
      const u = o.orient === "h" ? toU(o.center, o.line) : toU(o.line, o.center);
      const x0 = U(u - o.width / 2);
      const zt = Z(f.z + o.head), zb = Z(f.z + o.sill);
      const w = o.width * S, h = zb - zt;
      if (o.kind === "entrance") {
        const garage = o.width > 2;
        p.push(`<rect x="${x0}" y="${zt}" width="${w}" height="${h}" fill="${garage ? "#9aa0a6" : "url(#wood)"}" stroke="${INK}" stroke-width="1.4"/>`);
        if (garage) for (let i = 1; i < 6; i++) p.push(`<line x1="${x0}" y1="${zt + (h * i) / 6}" x2="${x0 + w}" y2="${zt + (h * i) / 6}" stroke="#6b7177" stroke-width="0.8"/>`);
        else {
          p.push(`<rect x="${x0 - 0.3 * S}" y="${zt - 0.25 * S}" width="${w + 0.6 * S}" height="${0.12 * S}" fill="#5b5b5f"/>`);
          p.push(`<circle cx="${x0 + w - 8}" cy="${zt + h / 2}" r="2.5" fill="${INK}"/>`);
        }
      } else {
        p.push(`<rect x="${x0}" y="${zt}" width="${w}" height="${h}" fill="#bcd3e6" stroke="${INK}" stroke-width="1.3"/>`);
        p.push(`<rect x="${x0 + 3}" y="${zt + 3}" width="${w - 6}" height="${h - 6}" fill="none" stroke="#5b6b78" stroke-width="0.6"/>`);
        if (o.width > 1.2) p.push(`<line x1="${x0 + w / 2}" y1="${zt}" x2="${x0 + w / 2}" y2="${zb}" stroke="${INK}" stroke-width="1"/>`);
        if (o.sill > 0.3) p.push(`<rect x="${x0 - 4}" y="${zb}" width="${w + 8}" height="4" fill="#8d8d90"/>`);
      }
    }
    // balkonlar
    for (const o of f.outdoor) {
      if (facade === "back") {
        const u0 = toU(o.rect.x + o.rect.w, 0), u1 = toU(o.rect.x, 0);
        p.push(`<rect x="${U(u0)}" y="${Z(f.z)}" width="${(u1 - u0) * S}" height="${0.18 * S}" fill="#6d6d70"/>`);
        p.push(`<rect x="${U(u0)}" y="${Z(f.z + 1.1)}" width="${(u1 - u0) * S}" height="${1.1 * S}" fill="rgba(160,190,210,0.35)" stroke="${INK}" stroke-width="1.2"/>`);
      } else if (facade === "left" || facade === "right") {
        const yA = facade === "left" ? L.D - (o.rect.y + o.rect.h) : o.rect.y;
        const dw = o.rect.h;
        p.push(`<rect x="${U(yA)}" y="${Z(f.z)}" width="${dw * S}" height="${0.18 * S}" fill="#6d6d70"/>`);
        p.push(`<rect x="${U(yA)}" y="${Z(f.z + 1.1)}" width="${dw * S}" height="${1.1 * S}" fill="rgba(160,190,210,0.35)" stroke="${INK}" stroke-width="1.2"/>`);
      }
    }
  }

  // çatı
  const rise = L.roofHeight;
  const oh = 0.6;
  const roofFill = "#7b4a36";
  const ridgeAlongFacade = facade === "front" || facade === "back"; // mahya x yönünde
  const zt = top;
  if (L.roof === "duz") {
    p.push(`<rect x="${U(-0.05)}" y="${Z(zt + rise)}" width="${(len + 0.1) * S}" height="${rise * S}" fill="#e9e3d8" stroke="${INK}" stroke-width="1.4"/>`);
    p.push(`<rect x="${U(-0.1)}" y="${Z(zt + rise) - 5}" width="${(len + 0.2) * S}" height="5" fill="#8d8d90"/>`);
  } else if (ridgeAlongFacade) {
    const ridgeInset = L.roof === "kirma" ? Math.min(L.D / 2, L.W / 2) : -oh;
    const pts = [
      [U(-oh), Z(zt - 0.1)], [U(len + oh), Z(zt - 0.1)],
      [U(len - ridgeInset), Z(zt + rise)], [U(ridgeInset), Z(zt + rise)],
    ];
    p.push(`<polygon points="${pts.map((q) => q.map((v) => v.toFixed(1)).join(",")).join(" ")}" fill="${roofFill}" stroke="${INK}" stroke-width="1.4"/>`);
    for (let i = 1; i < 5; i++) {
      const zz = zt - 0.1 + ((rise + 0.1) * i) / 5;
      const k = i / 5;
      const ul = -oh + (ridgeInset + oh) * k, ur = len + oh - (ridgeInset + oh) * k;
      p.push(`<line x1="${U(ul)}" y1="${Z(zz)}" x2="${U(ur)}" y2="${Z(zz)}" stroke="#5e3426" stroke-width="0.7"/>`);
    }
  } else {
    // beşik/kırma çatının yan görünüşü: üçgen (beşikte alınlık duvarı)
    if (L.roof === "besik") {
      p.push(`<polygon points="${U(0)},${Z(zt)} ${U(len / 2)},${Z(zt + rise - 0.25)} ${U(len)},${Z(zt)}" fill="#f4efe6" stroke="${INK}" stroke-width="1.2"/>`);
    }
    const slope = rise / (len / 2);
    p.push(`<polygon points="${U(-oh)},${Z(zt - oh * slope)} ${U(len / 2)},${Z(zt + rise)} ${U(len + oh)},${Z(zt - oh * slope)} ${U(len + oh)},${Z(zt - oh * slope) - 10} ${U(len / 2)},${Z(zt + rise) - 12} ${U(-oh)},${Z(zt - oh * slope) - 10}" fill="${roofFill}" stroke="${INK}" stroke-width="1.2"/>`);
    if (L.roof === "kirma") {
      p.push(`<polygon points="${U(-oh)},${Z(zt - 0.1)} ${U(len / 2)},${Z(zt + rise)} ${U(len + oh)},${Z(zt - 0.1)}" fill="${roofFill}" stroke="${INK}" stroke-width="1.2"/>`);
    }
  }

  // zemin çizgisi, insan figürü (ölçek)
  p.push(`<line x1="0" y1="${Z(groundZ)}" x2="${widthM * S}" y2="${Z(groundZ)}" stroke="${INK}" stroke-width="2"/>`);
  p.push(person(U(len + 1.0), Z(groundZ)));
  p.push(tree(U(len + 2.9), Z(groundZ)));
  // yükseklik ölçüsü
  p.push(dimLine(U(-1.2), Z(groundZ), U(-1.2), Z(zt + rise), `${f2(zt + rise - groundZ)}`, -1));
  p.push(dimLine(U(0), Z(groundZ) + 0.6 * S, U(len), Z(groundZ) + 0.6 * S, f2(len), -1));
  return svgDoc(widthM * S, heightM * S + titleH, p.join(""));
}

function person(x: number, yGround: number) {
  const h = 1.75 * S;
  return `<g stroke="${THIN}" stroke-width="1.4" fill="none"><circle cx="${x}" cy="${yGround - h + 6}" r="6"/><line x1="${x}" y1="${yGround - h + 12}" x2="${x}" y2="${yGround - h * 0.45}"/><line x1="${x}" y1="${yGround - h * 0.45}" x2="${x - 8}" y2="${yGround}"/><line x1="${x}" y1="${yGround - h * 0.45}" x2="${x + 8}" y2="${yGround}"/><line x1="${x - 12}" y1="${yGround - h * 0.7}" x2="${x + 12}" y2="${yGround - h * 0.7}"/></g>`;
}
function tree(x: number, yGround: number) {
  return `<g><line x1="${x}" y1="${yGround}" x2="${x}" y2="${yGround - 2.2 * S}" stroke="#7a6a55" stroke-width="3"/><circle cx="${x}" cy="${yGround - 3.0 * S}" r="${1.1 * S}" fill="#cfe0c4" stroke="#7d9b6e" stroke-width="1.2"/></g>`;
}

// ---------------------------------------------------------------- VAZİYET PLANI

export function sitePlanSVG(L: BuildingLayout, program: Program): string {
  const z = zoningCheck(program, L);
  const sw = program.site.width, sd = program.site.depth;
  const sc = Math.min(22, 700 / Math.max(sw, sd));
  const M = 40;
  const titleH = 56;
  const X = (x: number) => M + x * sc;
  const Y = (y: number) => titleH + M + (sd - y) * sc; // sokak altta
  const p: string[] = [];
  p.push(text(16, 26, `${program.projectName} — Vaziyet Planı`, 18, { anchor: "start", weight: 600 }));
  p.push(text(16, 44, `Arsa ${f2(sw)} × ${f2(sd)} m = ${(sw * sd).toFixed(0)} m²`, 11, { anchor: "start", fill: THIN }));
  p.push(`<rect x="${X(0)}" y="${Y(sd)}" width="${sw * sc}" height="${sd * sc}" fill="#eef4e8" stroke="${INK}" stroke-width="1.6" stroke-dasharray="10 4"/>`);
  // çekme hattı
  const { front, side, rear } = z.setbacks;
  p.push(`<rect x="${X(side)}" y="${Y(sd - rear)}" width="${Math.max(0, sw - 2 * side) * sc}" height="${Math.max(0, sd - front - rear) * sc}" fill="none" stroke="#c0392b" stroke-width="1" stroke-dasharray="4 3"/>`);
  p.push(text(X(side) + 4, Y(sd - rear) + 12, "yapı yaklaşma sınırı", 9, { anchor: "start", fill: "#c0392b" }));
  // bina
  const b = z.building;
  p.push(`<rect x="${X(b.x)}" y="${Y(b.y + L.D)}" width="${L.W * sc}" height="${L.D * sc}" fill="#d9d3c7" stroke="${INK}" stroke-width="2"/>`);
  for (const f of L.floors.slice(-1)) for (const o of f.outdoor) {
    p.push(`<rect x="${X(b.x + o.rect.x)}" y="${Y(b.y + o.rect.y + o.rect.h)}" width="${o.rect.w * sc}" height="${o.rect.h * sc}" fill="none" stroke="${THIN}" stroke-dasharray="4 2"/>`);
  }
  p.push(text(X(b.x + L.W / 2), Y(b.y + L.D / 2) + 4, `${L.floors.filter((f) => f.z >= 0).length} kat · ${(L.W * L.D).toFixed(0)} m²`, 11, { weight: 600 }));
  // ölçüler
  p.push(dimLine(X(0), Y(0) + 18, X(sw), Y(0) + 18, f2(sw), -1));
  p.push(dimLine(X(sw) + 18, Y(0), X(sw) + 18, Y(sd), f2(sd), -1));
  p.push(dimLine(X(b.x + L.W / 2) + 10, Y(0), X(b.x + L.W / 2) + 10, Y(b.y), `ön ${f2(b.y)}`, -1));
  p.push(dimLine(X(0), Y(b.y + L.D / 2), X(b.x), Y(b.y + L.D / 2), `${f2(b.x)}`, 1));
  p.push(text(X(sw / 2), Y(0) + 40, "SOKAK", 11, { weight: 700, fill: THIN }));
  // kuzey oku
  const nx = X(sw) + 50, ny = Y(sd) + 20;
  p.push(`<polygon points="${nx},${ny} ${nx - 8},${ny + 26} ${nx},${ny + 20} ${nx + 8},${ny + 26}" fill="${INK}"/>${text(nx, ny - 4, "K", 11, { weight: 700 })}`);
  return svgDoc(sw * sc + 2 * M + 80, sd * sc + 2 * M + titleH + 30, p.join(""));
}
