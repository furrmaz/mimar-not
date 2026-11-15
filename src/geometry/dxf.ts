// AutoCAD için DXF (AC1009 / R12 ASCII) dışa aktarma.
// Tek dosyada: tüm kat planları, A-A kesiti, 4 cephe ve vaziyet planı; katmanlara ayrılmış.
// Model uzayında çizimler yan yana dizilir; birim seçilebilir (m / cm / mm).
import type { BuildingLayout, Opening, Rect } from "./layout";
import { legacyStairInfo, stairGeom } from "./stair";
import { near } from "./layout";
import type { Program } from "../shared/schema";
import { parkingStalls, zoningCheck } from "./zoning";
import { furnishFloor, furnitureSymbol } from "./furniture";

export type DxfUnit = "m" | "cm" | "mm";
const UNIT_SCALE: Record<DxfUnit, number> = { m: 1, cm: 100, mm: 1000 };
const INSUNITS: Record<DxfUnit, number> = { m: 6, cm: 5, mm: 4 };

// AutoCAD renk indeksleri
const LAYERS: [string, number][] = [
  ["MN-DUVAR", 7],
  ["MN-DUVAR-DOLGU", 8],
  ["MN-PENCERE", 4],
  ["MN-KAPI", 3],
  ["MN-MERDIVEN", 8],
  ["MN-BALKON", 6],
  ["MN-MAHAL", 2],
  ["MN-MOBILYA", 9],
  ["MN-OLCU", 1],
  ["MN-KESIT-HATTI", 1],
  ["MN-DOSEME", 7],
  ["MN-CATI", 30],
  ["MN-ZEMIN", 32],
  ["MN-CEPHE", 7],
  ["MN-ARSA", 3],
  ["MN-CEKME", 1],
  ["MN-BASLIK", 7],
  ["MN-ANTET", 7],
];

class Dxf {
  private out: string[] = [];
  constructor(private k: number) {}
  private add(...v: (string | number)[]) {
    for (const x of v) this.out.push(String(x));
  }
  private n = (v: number) => (v * this.k).toFixed(4);
  line(layer: string, x1: number, y1: number, x2: number, y2: number) {
    this.add(0, "LINE", 8, layer, 10, this.n(x1), 20, this.n(y1), 30, 0, 11, this.n(x2), 21, this.n(y2), 31, 0);
  }
  poly(layer: string, pts: [number, number][], closed = false) {
    for (let i = 0; i < pts.length - 1; i++) this.line(layer, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (closed && pts.length > 2) this.line(layer, pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1]);
  }
  rect(layer: string, x: number, y: number, w: number, h: number) {
    this.poly(layer, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);
  }
  /** Dolu dörtgen (R12 SOLID) — kesilen duvar/döşeme poşesi */
  solid(layer: string, x: number, y: number, w: number, h: number) {
    const a = [x, y], b = [x + w, y], c = [x, y + h], d = [x + w, y + h];
    this.add(0, "SOLID", 8, layer, 10, this.n(a[0]), 20, this.n(a[1]), 30, 0, 11, this.n(b[0]), 21, this.n(b[1]), 31, 0, 12, this.n(c[0]), 22, this.n(c[1]), 32, 0, 13, this.n(d[0]), 23, this.n(d[1]), 33, 0);
  }
  arc(layer: string, cx: number, cy: number, r: number, a0: number, a1: number) {
    this.add(0, "ARC", 8, layer, 10, this.n(cx), 20, this.n(cy), 30, 0, 40, this.n(r), 50, a0.toFixed(3), 51, a1.toFixed(3));
  }
  circle(layer: string, cx: number, cy: number, r: number) {
    this.add(0, "CIRCLE", 8, layer, 10, this.n(cx), 20, this.n(cy), 30, 0, 40, this.n(r));
  }
  /** align: 0 sol, 1 orta, 2 sağ. Metin dosyada Windows-1254 (Türkçe) kod sayfasıyla yazılır. */
  text(layer: string, x: number, y: number, h: number, s: string, align: 0 | 1 | 2 = 1, rot = 0) {
    this.add(0, "TEXT", 8, layer, 10, this.n(x), 20, this.n(y), 30, 0, 40, this.n(h), 1, s, 50, rot.toFixed(2), 72, align, 11, this.n(x), 21, this.n(y), 31, 0);
  }
  /** Basit ölçü: ölçü çizgisi + eğik uç işaretleri + yazı (patlatılmış ölçü) */
  dim(x1: number, y1: number, x2: number, y2: number, off: number, label?: string) {
    const horiz = Math.abs(y1 - y2) < 1e-6;
    const L = "MN-OLCU";
    const t = 0.12;
    if (horiz) {
      const y = y1 + off;
      this.line(L, x1, y1, x1, y + Math.sign(off) * 0.15);
      this.line(L, x2, y2, x2, y + Math.sign(off) * 0.15);
      this.line(L, x1 - 0.1, y, x2 + 0.1, y);
      this.line(L, x1 - t, y - t, x1 + t, y + t);
      this.line(L, x2 - t, y - t, x2 + t, y + t);
      this.text(L, (x1 + x2) / 2, y + 0.08, 0.18, label ?? Math.abs(x2 - x1).toFixed(2));
    } else {
      const x = x1 + off;
      this.line(L, x1, y1, x + Math.sign(off) * 0.15, y1);
      this.line(L, x2, y2, x + Math.sign(off) * 0.15, y2);
      this.line(L, x, y1 - 0.1, x, y2 + 0.1);
      this.line(L, x - t, y1 - t, x + t, y1 + t);
      this.line(L, x - t, y2 - t, x + t, y2 + t);
      this.text(L, x - 0.08, (y1 + y2) / 2, 0.18, label ?? Math.abs(y2 - y1).toFixed(2), 1, 90);
    }
  }
  toBytes(unit: DxfUnit): Uint8Array {
    return encode1254(this.toString(unit));
  }
  toString(unit: DxfUnit) {
    const h: string[] = [];
    const add = (...v: (string | number)[]) => v.forEach((x) => h.push(String(x)));
    add(0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1009", 9, "$INSUNITS", 70, INSUNITS[unit], 9, "$DWGCODEPAGE", 3, "ANSI_1254", 0, "ENDSEC");
    add(0, "SECTION", 2, "TABLES", 0, "TABLE", 2, "LTYPE", 70, 1, 0, "LTYPE", 2, "CONTINUOUS", 70, 0, 3, "Solid line", 72, 65, 73, 0, 40, 0, 0, "ENDTAB");
    add(0, "TABLE", 2, "LAYER", 70, LAYERS.length);
    for (const [n, c] of LAYERS) add(0, "LAYER", 2, n, 70, 0, 62, c, 6, "CONTINUOUS");
    add(0, "ENDTAB", 0, "ENDSEC", 0, "SECTION", 2, "ENTITIES");
    return [...h, ...this.out, "0", "ENDSEC", "0", "EOF"].join("\r\n");
  }
}

const SHEET_GAP = 6; // çizimler arası boşluk (m)

export interface DxfAntet { office: string; architect: string; regNo: string; date: string }

export function buildDXF(L: BuildingLayout, program: Program, unit: DxfUnit = "m", ant?: DxfAntet): Uint8Array {
  const d = new Dxf(UNIT_SCALE[unit]);
  /** Antet kutusu: sol tarafta pafta adı, sağda ofis / tarih / ölçek / pafta no. */
  const title = (x: number, y: number, t: string, sub?: string, opts: { w?: number; no?: string; scale?: string } = {}) => {
    const w = Math.max(opts.w ?? 0, 18);
    const top = y + 0.75, bot = y - 1.45;
    d.rect("MN-ANTET", x, bot, w, top - bot);
    d.text("MN-BASLIK", x + 0.3, y, 0.45, t, 0);
    if (sub) d.text("MN-BASLIK", x + 0.3, y - 0.65, 0.2, sub, 0);
    // sağ bölüm
    const cells: [string, string][] = [
      ["OFİS / MİMAR", [ant?.office, ant?.architect, ant?.regNo && `Sicil ${ant.regNo}`].filter(Boolean).join(" · ") || "—"],
      ["PROJE", program.projectName + (program.clientName ? ` · ${program.clientName}` : "")],
      ["TARİH", ant?.date ?? ""],
      ["ÖLÇEK", opts.scale ?? "1/100"],
      ["PAFTA NO", opts.no ?? ""],
    ];
    const rx = x + w * 0.45, rw = w - w * 0.45;
    d.line("MN-ANTET", rx, bot, rx, top);
    const ch = (top - bot) / 2;
    // üst sıra: ofis, proje; alt sıra: tarih, ölçek, pafta no
    d.line("MN-ANTET", rx, bot + ch, x + w, bot + ch);
    const put = (cx: number, cy: number, cw: number, [label, value]: [string, string]) => {
      d.text("MN-ANTET", cx + 0.15, cy + ch - 0.3, 0.13, label, 0);
      const max = Math.max(4, Math.floor((cw - 0.3) / 0.15));
      d.text("MN-ANTET", cx + 0.15, cy + 0.25, 0.22, value.length > max ? value.slice(0, max - 1) + "…" : value, 0);
    };
    put(rx, bot + ch, rw / 2, cells[0]);
    d.line("MN-ANTET", rx + rw / 2, bot + ch, rx + rw / 2, top);
    put(rx + rw / 2, bot + ch, rw / 2, cells[1]);
    for (let i = 0; i < 3; i++) {
      if (i) d.line("MN-ANTET", rx + (rw * i) / 3, bot, rx + (rw * i) / 3, bot + ch);
      put(rx + (rw * i) / 3, bot, rw / 3, cells[2 + i]);
    }
  };

  // ---------- 1. sıra: kat planları + vaziyet planı
  let ox = 0;
  for (const fl of L.floors) {
    drawPlan(d, L, fl, ox, 0);
    title(ox, -3.4, fl.name.toUpperCase() + " PLANI", `Kot ${fl.z >= 0 ? "+" : ""}${fl.z.toFixed(2)}`, { w: L.W, no: `A-${100 + fl.level}` });
    ox += Math.max(L.W, 18) + SHEET_GAP + 4;
  }
  const siteW = drawSite(d, L, program, ox, -4);
  title(ox, -7.6, "VAZİYET PLANI", `Arsa ${program.site.width} × ${program.site.depth} m`, { w: siteW, no: "A-001", scale: "1/200" });

  // ---------- 2. sıra: kesit + cepheler
  const rowY = -(Math.max(program.site.depth, L.D) + 22);
  let sx = 0;
  drawSection(d, L, sx, rowY);
  title(sx, rowY - 3.4, "A-A KESİTİ", `Kesit hattı x = ${L.cutX.toFixed(2)} m`, { w: L.D, no: "A-300" });
  sx += Math.max(L.D, 18) + SHEET_GAP + 6;
  const facades: [Facade, string][] = [["front", "ÖN (SOKAK) CEPHESİ"], ["back", "ARKA (BAHÇE) CEPHESİ"], ["left", "SOL YAN CEPHE"], ["right", "SAĞ YAN CEPHE"]];
  facades.forEach(([f, name], i) => {
    const len = drawElevation(d, L, f, sx, rowY);
    title(sx, rowY - 3.4, name, undefined, { w: len, no: `A-20${i + 1}` });
    sx += Math.max(len, 18) + SHEET_GAP + 4;
  });
  return d.toBytes(unit);
}

// Windows-1254: Latin-1 ile aynı, Türkçe harfler için 6 farklı konum
const CP1254: Record<string, number> = { "Ğ": 0xd0, "İ": 0xdd, "Ş": 0xde, "ğ": 0xf0, "ı": 0xfd, "ş": 0xfe, "–": 0x96, "—": 0x97, "…": 0x85, "€": 0x80 };
const LATIN1_TAKEN = new Set([0xd0, 0xdd, 0xde, 0xf0, 0xfd, 0xfe]);
export function encode1254(str: string): Uint8Array {
  const out = new Uint8Array(str.length);
  let i = 0;
  for (const ch of str) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out[i++] = c;
    else if (CP1254[ch] != null) out[i++] = CP1254[ch];
    else if (c >= 0xa0 && c <= 0xff && !LATIN1_TAKEN.has(c)) out[i++] = c;
    else out[i++] = 0x3f; // ?
  }
  return out.slice(0, i);
}

// ---------------------------------------------------------------- PLAN
function drawPlan(d: Dxf, L: BuildingLayout, fl: BuildingLayout["floors"][number], ox: number, oy: number) {
  const P = (x: number, y: number): [number, number] => [ox + x, oy + y];
  for (const w of fl.walls) {
    const t = w.thickness / 2;
    const [x, y] = w.orient === "h" ? P(w.a, w.line - t) : P(w.line - t, w.a);
    const ww = w.orient === "h" ? w.b - w.a : w.thickness;
    const hh = w.orient === "h" ? w.thickness : w.b - w.a;
    d.rect("MN-DUVAR", x, y, ww, hh);
    d.solid("MN-DUVAR-DOLGU", x, y, ww, hh);
  }
  for (const o of fl.openings) drawOpeningPlan(d, L, o, P);
  for (const f of furnishFloor(fl))
      for (const p of furnitureSymbol(f)) {
        if (p.t === "rect") { const [x, y] = P(p.x, p.y); d.rect("MN-MOBILYA", x, y, p.w, p.h); }
        else if (p.t === "line") { const [x1, y1] = P(p.x1, p.y1); const [x2, y2] = P(p.x2, p.y2); d.line("MN-MOBILYA", x1, y1, x2, y2); }
        else { const [cx, cy] = P(p.cx, p.cy); d.circle("MN-MOBILYA", cx, cy, p.r); }
      }
  if (L.stair) {
    const g = stairGeom(L.stair, L.stairInfo ?? legacyStairInfo(L.stair, L.H), L.H);
    const rr = (r: Rect) => { const [x, y] = P(r.x, r.y); d.rect("MN-MERDIVEN", x, y, r.w, r.h); };
    rr(g.landing);
    for (const f of g.flights) {
      rr(f.rect);
      for (const [x1, y1, x2, y2] of f.lines) { const [a1, b1] = P(x1, y1); const [a2, b2] = P(x2, y2); d.line("MN-MERDIVEN", a1, b1, a2, b2); }
    }
    d.poly("MN-MERDIVEN", g.path.map(([x, y]) => P(x, y)));
    const [lx, ly] = P(g.labelAt[0], g.labelAt[1]);
    d.text("MN-MERDIVEN", lx, ly, 0.12, g.label);
  }
  for (const st of fl.stairs ?? []) {
    const [x, y] = P(st.x, st.y);
    d.rect("MN-MERDIVEN", x, y, st.w, st.h);
    const n = Math.max(3, Math.floor(st.w / 0.28));
    for (let i = 1; i < n; i++) d.line("MN-MERDIVEN", x + (st.w * i) / n, y, x + (st.w * i) / n, y + st.h);
  }
  for (const r of fl.rooms.filter((q) => q.name === "Asansör")) {
    const [x, y] = P(r.rect.x, r.rect.y);
    d.line("MN-MERDIVEN", x + 0.2, y + 0.2, x + r.rect.w - 0.2, y + r.rect.h - 0.2);
    d.line("MN-MERDIVEN", x + 0.2, y + r.rect.h - 0.2, x + r.rect.w - 0.2, y + 0.2);
  }
  for (const u of fl.units ?? []) {
    const front = u.rect.y < L.hallBand.y;
    const [cx, cy] = P(Math.min(L.W - 2.5, Math.max(L.stair ? L.stair.w + 3 : 2.5, u.rect.x + u.rect.w / 2)), front ? L.hallBand.y + 0.35 : L.hallBand.y + L.hallBand.h - 0.55);
    d.text("MN-MAHAL", cx, cy, 0.22, `${u.label} ${u.type}${u.part === "upper" ? " ÜST KAT" : ""} ${u.area.toFixed(0)} m²`);
  }
  for (const r of fl.rooms) {
    if (r.type === "merdiven") continue;
    const [cx, cy] = P(r.rect.x + r.rect.w / 2, r.rect.y + r.rect.h / 2);
    const small = r.rect.w < 2.2 || r.rect.h < 1.6;
    // yazı yüksekliği oda genişliğine sığacak şekilde küçülür
    const th = Math.max(0.1, Math.min(small ? 0.16 : 0.25, (r.rect.w - 0.3) / (r.name.length * 0.62)));
    d.text("MN-MAHAL", cx, cy + 0.1, th, r.name);
    d.text("MN-MAHAL", cx, cy - 0.3, small ? 0.13 : 0.18, `${(r.rect.w * r.rect.h).toFixed(2)} m²`);
  }
  for (const o of fl.outdoor) {
    const [x, y] = P(o.rect.x, o.rect.y);
    d.rect("MN-BALKON", x, y, o.rect.w, o.rect.h);
    d.rect("MN-BALKON", x + 0.08, y + 0.08, o.rect.w - 0.16, o.rect.h - 0.16);
    d.text("MN-MAHAL", x + o.rect.w / 2, y + o.rect.h / 2, 0.2, `${o.name} ${o.area.toFixed(1)} m²`);
  }
  // ölçüler: alt toplam + ön bant zinciri, sağ toplam + bant zinciri
  d.dim(ox, oy, ox + L.W, oy, -1.6);
  const front = fl.rooms.filter((r) => near(r.rect.y, 0)).sort((a, b) => a.rect.x - b.rect.x);
  const xs = Array.from(new Set([0, ...front.map((r) => +(r.rect.x + r.rect.w).toFixed(3))])).sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) d.dim(ox + xs[i], oy, ox + xs[i + 1], oy, -1.0);
  // pencere/kapı aralık zincirleri (ön ve sağ cephe)
  const opChain = (orient: "h" | "v", line: number, len: number) => {
    const pts = Array.from(new Set([0, len, ...fl.openings.filter((o) => o.exterior && o.orient === orient && near(o.line, line)).flatMap((o) => [o.center - o.width / 2, o.center + o.width / 2])].map((v) => Math.round(v * 1000) / 1000))).sort((a, b) => a - b);
    return pts.length > 2 ? pts : [];
  };
  const fx = opChain("h", 0, L.W);
  for (let i = 0; i < fx.length - 1; i++) if (fx[i + 1] - fx[i] > 0.04) d.dim(ox + fx[i], oy, ox + fx[i + 1], oy, -0.45);
  const ry = opChain("v", L.W, L.D);
  for (let i = 0; i < ry.length - 1; i++) if (ry[i + 1] - ry[i] > 0.04) d.dim(ox + L.W, oy + ry[i], ox + L.W, oy + ry[i + 1], 0.45);
  d.dim(ox + L.W, oy, ox + L.W, oy + L.D, 1.6);
  const ys = [0, L.hallBand.y, L.hallBand.y + L.hallBand.h, L.D];
  for (let i = 0; i < ys.length - 1; i++) d.dim(ox + L.W, oy + ys[i], ox + L.W, oy + ys[i + 1], 1.0);
  // kesit hattı
  const ax = ox + L.cutX;
  const outD = Math.max(0, ...fl.outdoor.map((o) => o.rect.y + o.rect.h - L.D));
  d.line("MN-KESIT-HATTI", ax, oy - 0.6, ax, oy + L.D + outD + 0.8);
  for (const yy of [oy - 0.9, oy + L.D + outD + 1.1]) {
    d.circle("MN-KESIT-HATTI", ax, yy, 0.3);
    d.text("MN-KESIT-HATTI", ax, yy - 0.1, 0.22, "A");
  }
}

function drawOpeningPlan(d: Dxf, L: BuildingLayout, o: Opening, P: (x: number, y: number) => [number, number]) {
  const a = o.center - o.width / 2, b = o.center + o.width / 2;
  const t = (o.exterior ? L.extWall : L.intWall) / 2;
  const Q = (u: number, v: number) => (o.orient === "h" ? P(u, v) : P(v, u));
  if (o.kind === "window" || o.kind === "balconyDoor") {
    for (const v of [-t, -t / 3, t / 3, t]) {
      const [x1, y1] = Q(a, o.line + v);
      const [x2, y2] = Q(b, o.line + v);
      d.line("MN-PENCERE", x1, y1, x2, y2);
    }
    for (const u of [a, b]) {
      const [x1, y1] = Q(u, o.line - t);
      const [x2, y2] = Q(u, o.line + t);
      d.line("MN-PENCERE", x1, y1, x2, y2);
    }
    return;
  }
  if (o.kind === "passage") {
    for (const v of [-t, t]) { const [x1, y1] = Q(a, o.line + v); const [x2, y2] = Q(b, o.line + v); d.line("MN-KAPI", x1, y1, x2, y2); }
    return;
  }
  const [hx, hy] = Q(a, o.line);
  const [lx, ly] = Q(a, o.line + o.swing * o.width);
  d.line("MN-KAPI", hx, hy, lx, ly);
  const ang = (dx: number, dy: number) => (Math.atan2(dy, dx) * 180) / Math.PI;
  const [ex, ey] = Q(b, o.line);
  let a0 = ang(ex - hx, ey - hy), a1 = ang(lx - hx, ly - hy);
  if (((a1 - a0 + 360) % 360) > 180) [a0, a1] = [a1, a0];
  d.arc("MN-KAPI", hx, hy, o.width, a0, a1);
}

// ---------------------------------------------------------------- KESİT
function drawSection(d: Dxf, L: BuildingLayout, ox: number, oy: number) {
  // yatay eksen: derinlik y (ön solda), dikey: kot z
  const X = (y: number) => ox + y;
  const Z = (z: number) => oy + z;
  const groundZ = -0.3;
  const clear = L.H - L.slab;
  d.line("MN-ZEMIN", X(-4), Z(groundZ), X(L.D + 6), Z(groundZ));
  const floors = [...L.floors].sort((a, b) => a.z - b.z);
  // temel
  for (const yy of [0, L.D]) d.rect("MN-DOSEME", X(yy - 0.45), Z(floors[0].z - L.slab - 0.6), 0.9, 0.6);
  for (const f of floors) {
    d.rect("MN-DOSEME", X(-L.extWall / 2), Z(f.z - L.slab), L.D + L.extWall, L.slab);
    d.solid("MN-DUVAR-DOLGU", X(-L.extWall / 2), Z(f.z - L.slab), L.D + L.extWall, L.slab);
    for (const w of f.wallLines) {
      if (w.orient !== "h" || L.cutX < w.a || L.cutX > w.b) continue;
      const op = f.openings.find((o) => o.orient === "h" && near(o.line, w.line) && Math.abs(o.center - L.cutX) <= o.width / 2);
      const seg = (za: number, zb: number) => {
        d.rect("MN-DUVAR", X(w.line - w.thickness / 2), Z(f.z + za), w.thickness, zb - za);
        d.solid("MN-DUVAR-DOLGU", X(w.line - w.thickness / 2), Z(f.z + za), w.thickness, zb - za);
      };
      if (!op) seg(0, clear);
      else {
        if (op.sill > 0) seg(0, op.sill);
        seg(Math.min(op.head, clear), clear);
        if (op.kind === "window" || op.kind === "balconyDoor") d.line("MN-PENCERE", X(w.line), Z(f.z + op.sill), X(w.line), Z(f.z + op.head));
      }
    }
    for (const r of f.rooms) {
      if (L.cutX < r.rect.x || L.cutX > r.rect.x + r.rect.w) continue;
      d.text("MN-MAHAL", X(r.rect.y + r.rect.h / 2), Z(f.z + 1.3), 0.2, r.name);
    }
    for (const o of f.outdoor) {
      const front = o.rect.y < 0;
      const base = front ? 0 : L.D, ey = front ? o.rect.y : o.rect.y + o.rect.h;
      d.rect("MN-BALKON", X(Math.min(base, ey)), Z(f.z - 0.18), Math.abs(ey - base), 0.18);
      d.poly("MN-BALKON", [[X(ey), Z(f.z)], [X(ey), Z(f.z + 1.1)], [X(base), Z(f.z + 1.1)]]);
    }
    levelMark(d, X(L.D + 3), Z(f.z), f.z);
    d.dim(X(0), Z(f.z), X(0), Z(f.z + L.H), -1.2);
  }
  const top = L.totalHeight;
  d.rect("MN-DOSEME", X(-L.extWall / 2), Z(top - L.slab), L.D + L.extWall, L.slab);
  d.solid("MN-DUVAR-DOLGU", X(-L.extWall / 2), Z(top - L.slab), L.D + L.extWall, L.slab);
  if (L.roof === "duz") {
    for (const yy of [0, L.D]) d.rect("MN-DUVAR", X(yy - L.extWall / 2), Z(top), L.extWall, L.roofHeight);
  } else {
    const oh = 0.6, rise = L.roofHeight, slope = rise / (L.D / 2);
    const p1: [number, number] = [X(-oh), Z(top - oh * slope)];
    const p2: [number, number] = [X(L.D / 2), Z(top + rise)];
    const p3: [number, number] = [X(L.D + oh), Z(top - oh * slope)];
    d.poly("MN-CATI", [p1, p2, p3]);
    d.poly("MN-CATI", [[p1[0], p1[1] + 0.22], [p2[0], p2[1] + 0.22], [p3[0], p3[1] + 0.22]]);
  }
  levelMark(d, X(L.D + 3), Z(top), top);
  d.dim(X(0), Z(groundZ), X(0), Z(top + L.roofHeight), -2.2, `H ${(top + L.roofHeight - groundZ).toFixed(2)}`);
  d.dim(X(0), Z(groundZ), X(L.D), Z(groundZ), -1.2);
}

function levelMark(d: Dxf, x: number, y: number, z: number) {
  d.poly("MN-OLCU", [[x - 0.15, y + 0.25], [x + 0.15, y + 0.25], [x, y]], true);
  d.line("MN-OLCU", x - 0.3, y, x + 1.5, y);
  d.text("MN-OLCU", x + 0.3, y + 0.08, 0.2, Math.abs(z) < 0.005 ? "±0.00" : `${z > 0 ? "+" : ""}${z.toFixed(2)}`, 0);
}

// ---------------------------------------------------------------- CEPHE
type Facade = "front" | "back" | "left" | "right";

function drawElevation(d: Dxf, L: BuildingLayout, facade: Facade, ox: number, oy: number): number {
  const len = facade === "front" || facade === "back" ? L.W : L.D;
  const U = (u: number) => ox + u;
  const Z = (z: number) => oy + z;
  const toU = (x: number, y: number) => (facade === "front" ? x : facade === "back" ? L.W - x : facade === "left" ? L.D - y : y);
  const groundZ = -0.3;
  const top = L.totalHeight;
  d.line("MN-ZEMIN", U(-2), Z(groundZ), U(len + 2), Z(groundZ));
  d.rect("MN-CEPHE", U(0), Z(groundZ), len, top - groundZ);
  const above = L.floors.filter((f) => f.z >= 0);
  for (const f of above) if (f.z > 0) d.line("MN-CEPHE", U(0), Z(f.z), U(len), Z(f.z));
  const onFacade = (o: Opening) =>
    facade === "front" ? o.orient === "h" && near(o.line, 0)
      : facade === "back" ? o.orient === "h" && near(o.line, L.D)
        : facade === "left" ? o.orient === "v" && near(o.line, 0)
          : o.orient === "v" && near(o.line, L.W);
  for (const f of above) {
    for (const o of f.openings.filter(onFacade)) {
      const u = o.orient === "h" ? toU(o.center, o.line) : toU(o.line, o.center);
      const layer = o.kind === "entrance" ? "MN-KAPI" : "MN-PENCERE";
      d.rect(layer, U(u - o.width / 2), Z(f.z + o.sill), o.width, o.head - o.sill);
      if (o.kind !== "entrance") d.rect(layer, U(u - o.width / 2 + 0.05), Z(f.z + o.sill + 0.05), o.width - 0.1, o.head - o.sill - 0.1);
      if (o.kind !== "entrance" && o.width > 1.2) d.line(layer, U(u), Z(f.z + o.sill), U(u), Z(f.z + o.head));
    }
    for (const o of f.outdoor) {
      if (f.z <= 0) continue;
      let u0: number, w: number;
      if ((facade === "back" && o.rect.y >= 0) || (facade === "front" && o.rect.y < 0)) { u0 = Math.min(toU(o.rect.x + o.rect.w, 0), toU(o.rect.x, 0)); w = o.rect.w; }
      else if (facade === "left") { u0 = L.D - (o.rect.y + o.rect.h); w = o.rect.h; }
      else if (facade === "right") { u0 = o.rect.y; w = o.rect.h; }
      else continue;
      d.rect("MN-BALKON", U(u0), Z(f.z - 0.18), w, 0.18);
      d.rect("MN-BALKON", U(u0), Z(f.z), w, 1.1);
    }
  }
  // çatı
  const rise = L.roofHeight, oh = 0.6;
  if (L.roof === "duz") {
    d.rect("MN-CEPHE", U(0), Z(top), len, rise);
  } else if (facade === "front" || facade === "back") {
    const inset = L.roof === "kirma" ? Math.min(L.D, L.W) / 2 : -oh;
    d.poly("MN-CATI", [[U(-oh), Z(top - 0.1)], [U(len + oh), Z(top - 0.1)], [U(len - inset), Z(top + rise)], [U(inset), Z(top + rise)]], true);
  } else {
    const slope = rise / (len / 2);
    d.poly("MN-CATI", [[U(-oh), Z(top - oh * slope)], [U(len / 2), Z(top + rise)], [U(len + oh), Z(top - oh * slope)]]);
    if (L.roof === "besik") d.poly("MN-CEPHE", [[U(0), Z(top)], [U(len / 2), Z(top + rise - 0.25)], [U(len), Z(top)]]);
  }
  d.dim(U(0), Z(groundZ), U(len), Z(groundZ), -1.0);
  d.dim(U(len), Z(groundZ), U(len), Z(top + rise), 1.4);
  return len;
}

// ---------------------------------------------------------------- VAZİYET
function drawSite(d: Dxf, L: BuildingLayout, p: Program, ox: number, oy: number) {
  const z = zoningCheck(p, L);
  const sw = p.site.width, sd = p.site.depth;
  d.rect("MN-ARSA", ox, oy, sw, sd);
  const s = z.setbacks;
  d.rect("MN-CEKME", ox + s.side, oy + s.front, Math.max(0, sw - 2 * s.side), Math.max(0, sd - s.front - s.rear));
  // bina (sokak y=0 altta)
  const bl = z.blocks ?? [{ name: "", index: 0, L, x: z.building.x, y: z.building.y }];
  for (const b of bl) {
    d.rect("MN-DUVAR", ox + b.x, oy + b.y, b.L.W, b.L.D);
    for (const f of b.L.floors) for (const o of f.outdoor) d.rect("MN-BALKON", ox + b.x + o.rect.x, oy + b.y + o.rect.y, o.rect.w, o.rect.h);
    if (z.blocks) d.text("MN-MAHAL", ox + b.x + b.L.W / 2, oy + b.y + b.L.D / 2 - 0.8, 0.5, b.name.toUpperCase());
  }
  const stalls = parkingStalls(p, L, z);
  for (const st of stalls) d.rect("MN-ARSA", ox + st.x, oy + st.y, st.w, st.h);
  if (stalls.length) d.text("MN-MAHAL", ox + (stalls[0].x + stalls[stalls.length - 1].x + stalls[0].w) / 2, oy + stalls[0].y + stalls[0].h / 2, 0.25, `OTOPARK ${stalls.length} ARAÇ`);
  d.text("MN-MAHAL", ox + z.building.x + L.W / 2, oy + z.building.y + L.D / 2, 0.35, `${L.floors.filter((f) => f.z >= 0).length} KAT  ${(L.W * L.D).toFixed(0)} m²`);
  d.dim(ox, oy, ox + sw, oy, -1.2);
  d.dim(ox + sw, oy, ox + sw, oy + sd, 1.2);
  d.dim(ox + z.building.x + L.W / 2, oy, ox + z.building.x + L.W / 2, oy + z.building.y, 0.3, `ön ${z.building.y.toFixed(2)}`);
  d.dim(ox, oy + z.building.y + L.D / 2, ox + z.building.x, oy + z.building.y + L.D / 2, 0.3);
  d.text("MN-BASLIK", ox + sw / 2, oy - 2.4, 0.35, "SOKAK");
  d.text("MN-MAHAL", ox + 0.5, oy + sd - 1.0, 0.25, `TAKS ${z.taks.toFixed(2)}  KAKS ${z.kaks.toFixed(2)}`, 0);
  return sw;
}
