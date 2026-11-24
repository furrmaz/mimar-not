// AutoCAD için DXF (AutoCAD 2010 / AC1024 ASCII, UTF-8) dışa aktarma.
// Tek dosyada: tüm kat planları, A-A kesiti, 4 cephe ve vaziyet planı.
// - Katmanlar Türk ofis düzenine göre (A-DUVAR, A-KAPI, A-AKS…), her biri renk, çizgi kalınlığı ve çizgi tipiyle
// - Duvar, mahal, kolon, balkon kapalı polyline; poşeler ve toprak/beton taramaları gerçek HATCH
// - Ölçüler gerçek DIMENSION (PLANHANE-100 ölçü stili), kotlar/kesit okları/kuzey oku/kapı/pencere/mobilya blok
// - Mahal etiketleri nitelikli blok (AD, ALAN, KAT): AutoCAD'de veri çıkarma ile alan tablosu alınabilir
// - Her çizim kendi kağıt düzeninde (A3…A0), ölçekli ve kilitli görünüm penceresi ve antetle; plot'a hazır
// Model uzayında çizimler yan yana dizilir; birim seçilebilir (m / cm / mm).
import { structurePlan } from "./structure";
import type { BuildingLayout, Opening, Rect } from "./layout";
import { legacyStairInfo, stairGeom } from "./stair";
import { near, siteLevels } from "./layout";
import { facadeFaces, floorRects, openingOnFacade, slabSpansAtX, spansAtX } from "./massing";
import type { Program } from "../shared/schema";
import { parkingStalls, sitePool, zoningCheck } from "./zoning";
import { furnishFloor, furnitureLabel, furnitureSymbol, localSize, type Furniture } from "./furniture";
import { DxfDoc, type LayerDef, type LtypeDef, type Pt, type Space } from "./dxfwriter";

export type DxfUnit = "m" | "cm" | "mm";
const UNIT_SCALE: Record<DxfUnit, number> = { m: 1, cm: 100, mm: 1000 };
const INSUNITS: Record<DxfUnit, number> = { m: 6, cm: 5, mm: 4 };

// Çizgi tipleri (uzunluklar metre, 1/100 çıktıda: 1 m = 10 mm)
const LTYPES: LtypeDef[] = [
  { name: "AKS", desc: "Aks ____ . ____ . ____", pattern: [1.0, -0.15, 0, -0.15] },
  { name: "KESIK", desc: "Kesik __ __ __ __", pattern: [0.3, -0.15] },
  { name: "KESIT", desc: "Kesit hatti ______ __ ______", pattern: [1.5, -0.2, 0.3, -0.2] },
];

// Katman, AutoCAD renk indeksi, çizgi kalınlığı (1/100 mm), çizgi tipi
const LAYERS: LayerDef[] = [
  { name: "A-DUVAR", color: 7, lw: 50 },
  { name: "A-DUVAR-POSE", color: 8, lw: 9 },
  { name: "A-PENCERE", color: 4, lw: 18 },
  { name: "A-KAPI", color: 3, lw: 18 },
  { name: "A-MERDIVEN", color: 8, lw: 18 },
  { name: "A-AKS", color: 1, lw: 13, ltype: "AKS" },
  { name: "A-KOLON", color: 5, lw: 50 },
  { name: "A-KOLON-POSE", color: 5, lw: 9 },
  { name: "A-BALKON", color: 6, lw: 25 },
  { name: "A-MAHAL", color: 2, lw: 18 },
  { name: "A-MOBILYA", color: 9, lw: 13 },
  { name: "A-OLCU", color: 1, lw: 13 },
  { name: "A-KOT", color: 1, lw: 18 },
  { name: "A-KESIT-HATTI", color: 1, lw: 35, ltype: "KESIT" },
  { name: "A-KESIT-POSE", color: 8, lw: 9 },
  { name: "A-DOSEME", color: 7, lw: 35 },
  { name: "A-DOSEME-BOSLUK", color: 8, lw: 13, ltype: "KESIK" },
  { name: "A-TEMEL", color: 7, lw: 35 },
  { name: "A-TEMEL-TARAMA", color: 8, lw: 9 },
  { name: "A-CATI", color: 30, lw: 35 },
  { name: "A-ZEMIN", color: 32, lw: 50 },
  { name: "A-ZEMIN-TARAMA", color: 32, lw: 9 },
  { name: "A-CEPHE", color: 7, lw: 35 },
  { name: "A-CEPHE-GERI", color: 8, lw: 18 },
  { name: "A-ARSA", color: 3, lw: 35 },
  { name: "A-CEKME", color: 1, lw: 18, ltype: "KESIK" },
  { name: "A-OTOPARK", color: 8, lw: 13 },
  { name: "A-HAVUZ", color: 4, lw: 25 },
  { name: "A-KUZEY", color: 7, lw: 18 },
  { name: "A-BASLIK", color: 7, lw: 35 },
  { name: "A-PAFTA", color: 7, lw: 50 },
  { name: "A-ANTET", color: 7, lw: 25 },
  { name: "A-GORUNUM", color: 8, lw: 9, plot: false },
];

const SHEET_GAP = 6; // çizimler arası boşluk (m)

export interface DxfAntet { office: string; architect: string; regNo: string; date: string }

// ---------------------------------------------------------------- BLOKLAR
/** Türkçe harfleri blok adlarında ASCII'ye çevirir (eski AutoCAD sürümleri ve LISP ile uyum için) */
const ascii = (s: string) => s.toLocaleUpperCase("tr").replace(/[ÇĞİÖŞÜ]/g, (c) => ({ Ç: "C", Ğ: "G", İ: "I", Ö: "O", Ş: "S", Ü: "U" })[c] ?? c).replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
const cm = (v: number) => Math.round(v * 100);

function defineStaticBlocks(doc: DxfDoc) {
  doc.block("MAHAL", () => {}, [
    { tag: "AD", prompt: "Mahal adı", h: 0.25, x: 0, y: 0.1 },
    { tag: "ALAN", prompt: "Alan (m²)", h: 0.18, x: 0, y: -0.3 },
    { tag: "KAT", prompt: "Kat", h: 0.15, x: 0, y: -0.6, invisible: true },
  ]);
  doc.block("KOT", (s) => {
    s.pline("0", [[-0.15, 0.25], [0.15, 0.25], [0, 0]], true);
    s.line("0", -0.3, 0, 1.5, 0);
  }, [{ tag: "KOT", prompt: "Kot", h: 0.2, x: 0.3, y: 0.08, align: 0 }]);
  doc.block("KESIT-OKU", (s) => { s.circle("0", 0, 0, 0.3); }, [{ tag: "AD", prompt: "Kesit adı", h: 0.22, x: 0, y: -0.1 }]);
  doc.block("KUZEY", (s) => {
    s.circle("0", 0, 0, 1.0);
    const tri: Pt[] = [[0, 0.9], [-0.35, -0.7], [0, -0.45], [0.35, -0.7]];
    s.pline("0", tri, true);
    s.hatch("0", [tri]);
  });
}

/** Kapı bloğu: menteşe orijinde, kapalı kanat +x, açık kanat +y boyunca */
function doorBlock(doc: DxfDoc, w: number) {
  return doc.block(`KAPI-${cm(w)}`, (s) => {
    s.line("0", 0, 0, 0, w);
    s.arc("0", 0, 0, w, 0, 90);
  });
}
/** Pencere / balkon kapısı bloğu: x boyunca 0..w, duvar ekseni y=0, kalınlık t */
function windowBlock(doc: DxfDoc, kind: "window" | "balconyDoor", w: number, t: number) {
  return doc.block(`${kind === "window" ? "PENCERE" : "BALKON-KAPISI"}-${cm(w)}x${cm(t)}`, (s) => {
    const h = t / 2;
    for (const v of [-h, -h / 3, h / 3, h]) s.line("0", 0, v, w, v);
    for (const u of [0, w]) s.line("0", u, -h, u, h);
  });
}
/** Mobilya bloğu: sırt y=0 kenarında (facing "n"), yerel boyut lw × ld */
function furnitureBlock(doc: DxfDoc, f: Furniture) {
  const { lw, ld } = localSize(f);
  const local: Furniture = { ...f, x: 0, y: 0, w: lw, h: ld, facing: "n" };
  return doc.block(`MOB-${ascii(furnitureLabel(f.kind))}-${cm(lw)}x${cm(ld)}`, (s) => {
    for (const p of furnitureSymbol(local)) {
      if (p.t === "rect") s.rect("0", p.x, p.y, p.w, p.h);
      else if (p.t === "line") s.line("0", p.x1, p.y1, p.x2, p.y2);
      else s.circle("0", p.cx, p.cy, p.r);
    }
  });
}

// ---------------------------------------------------------------- PAFTALAR
interface Sheet { no: string; title: string; sub?: string; den: number; min: Pt; max: Pt }
const PAPERS: { name: string; w: number; h: number; media: string }[] = [
  { name: "A3", w: 420, h: 297, media: "ISO_full_bleed_A3_(420.00_x_297.00_MM)" },
  { name: "A2", w: 594, h: 420, media: "ISO_full_bleed_A2_(594.00_x_420.00_MM)" },
  { name: "A1", w: 841, h: 594, media: "ISO_full_bleed_A1_(841.00_x_594.00_MM)" },
  { name: "A0", w: 1189, h: 841, media: "ISO_full_bleed_A0_(1189.00_x_841.00_MM)" },
];
const ANTET_W = 180, ANTET_H = 45;

// Pafta çerçevesi: solda 20 mm cilt payı, diğer kenarlarda 10 mm; çizim alanı çerçeveden 5 mm içeride
const frameOf = (p: { w: number; h: number }) => ({ x0: 20, y0: 10, x1: p.w - 10, y1: p.h - 10 });
/** Görünüm penceresi antetin üstüne mi, soluna mı sığıyor? */
function placement(p: { w: number; h: number }, vw: number, vh: number): "above" | "left" | null {
  const { x0, y0, x1, y1 } = frameOf(p);
  const iw = x1 - x0 - 10, ih = y1 - y0 - 10;
  if (vw <= iw && vh <= ih - ANTET_H - 5) return "above";
  if (vw <= iw - ANTET_W - 5 && vh <= ih) return "left";
  return null;
}
const vpSize = (sh: Sheet, den: number) => [((sh.max[0] - sh.min[0]) * 1000) / den + 10, ((sh.max[1] - sh.min[1]) * 1000) / den + 10];

function pickPaper(sh: Sheet) {
  for (const den of [sh.den, 200, 500, 1000].filter((v, i, a) => v >= sh.den && a.indexOf(v) === i)) {
    const [w, h] = vpSize(sh, den);
    for (const p of PAPERS) if (placement(p, w, h)) return { paper: p, den };
  }
  return { paper: PAPERS[3], den: 2000 };
}

/** Kağıt uzayında pafta çerçevesi + antet + ölçekli görünüm penceresi */
function drawSheet(doc: DxfDoc, sh: Sheet, program: Program, ant?: DxfAntet) {
  const { paper: P, den } = pickPaper(sh);
  const name = `${sh.no} ${sh.title}`.replace(/[<>/\\":;?*|,=`]/g, " ").replace(/\s+/g, " ").trim();
  const s = doc.layout(name, P.w, P.h, P.media);
  const { x0, y0, x1, y1 } = frameOf(P);
  s.rect("A-PAFTA", x0, y0, x1 - x0, y1 - y0);
  // antet (sağ alt)
  const ax = x1 - ANTET_W, ay = y0, rh = ANTET_H / 3;
  s.rect("A-ANTET", ax, ay, ANTET_W, ANTET_H);
  s.line("A-ANTET", ax, ay + rh, x1, ay + rh);
  s.line("A-ANTET", ax, ay + 2 * rh, x1, ay + 2 * rh);
  s.line("A-ANTET", ax + ANTET_W / 2, ay + rh, ax + ANTET_W / 2, ay + 2 * rh);
  for (const i of [1, 2]) s.line("A-ANTET", ax + (ANTET_W * i) / 3, ay, ax + (ANTET_W * i) / 3, ay + rh);
  const fit = (v: string, w: number, h: number) => { const max = Math.max(4, Math.floor((w - 4) / (h * 0.62))); return v.length > max ? v.slice(0, max - 1) + "…" : v; };
  const cell = (cx: number, cy: number, cw: number, label: string, value: string) => {
    s.text("A-ANTET", cx + 2, cy + rh - 4, 2, label, 0);
    s.text("A-BASLIK", cx + 2, cy + 3, 3, fit(value, cw, 3), 0);
  };
  s.text("A-BASLIK", ax + 3, ay + 2 * rh + 7, 5, fit(sh.title, ANTET_W, 5), 0);
  if (sh.sub) s.text("A-ANTET", ax + 3, ay + 2 * rh + 2.5, 2.5, fit(sh.sub, ANTET_W, 2.5), 0);
  cell(ax, ay + rh, ANTET_W / 2, "OFİS / MİMAR", [ant?.office, ant?.architect, ant?.regNo && `Sicil ${ant.regNo}`].filter(Boolean).join(" · ") || "—");
  cell(ax + ANTET_W / 2, ay + rh, ANTET_W / 2, "PROJE / İŞVEREN", program.projectName + (program.clientName ? ` · ${program.clientName}` : ""));
  cell(ax, ay, ANTET_W / 3, "TARİH", ant?.date ?? "");
  cell(ax + ANTET_W / 3, ay, ANTET_W / 3, "ÖLÇEK", `1/${den}`);
  cell(ax + (2 * ANTET_W) / 3, ay, ANTET_W / 3, "PAFTA NO", sh.no);
  // görünüm penceresi: çizim antetin üstüne sığarsa ortada, sığmazsa antetin solunda
  const [vw, vh] = vpSize(sh, den);
  const above = placement(P, vw, vh) !== "left";
  const areaX0 = x0 + 5, areaX1 = above ? x1 - 5 : ax - 5, areaY0 = above ? ay + ANTET_H + 5 : y0 + 5, areaY1 = y1 - 5;
  const cx = (areaX0 + areaX1) / 2, cy = (areaY0 + areaY1) / 2;
  s.viewport(cx, cy, vw, vh, [(sh.min[0] + sh.max[0]) / 2, (sh.min[1] + sh.max[1]) / 2], (vh * den) / 1000, "A-GORUNUM");
  s.text("A-BASLIK", cx - vw / 2, cy - vh / 2 - 6, 3.5, `${sh.title}  ·  1/${den}`, 0);
}

export function buildDXF(L: BuildingLayout, program: Program, unit: DxfUnit = "m", ant?: DxfAntet): Uint8Array {
  const k = UNIT_SCALE[unit];
  const doc = new DxfDoc(k, INSUNITS[unit]);
  doc.layers = LAYERS;
  doc.ltypes = LTYPES;
  // 1/100 ölçü stili: yazı 1.8 mm, eğik uç 1.2 mm; ölçü değerleri metre, iki ondalık
  doc.dimStyle = { name: "PLANHANE-100", scale: 0.1 * k, lfac: 1 / k, txt: 1.8, tsz: 1.2, exe: 1.5, exo: 0, dle: 1.0, gap: 0.8, dec: 2 };
  defineStaticBlocks(doc);
  const d = doc.model;
  const sheets: Sheet[] = [];
  /** Bir çizimi çizer, kapsamını kaydeder ve altına model uzayında başlık yazar */
  const sheet = (no: string, title: string, sub: string | undefined, den: number, x: number, y: number, draw: () => void) => {
    d.track = { min: [Infinity, Infinity], max: [-Infinity, -Infinity] };
    draw();
    const t = d.track;
    d.track = null;
    sheets.push({ no, title, sub, den, min: t.min, max: t.max });
    // başlık, paftadaki görünüm penceresine girmesin diye çizim kapsamının altında
    const ty = Math.min(y, t.min[1] - (5 * den) / 1000 - 0.8);
    d.text("A-BASLIK", x, ty, 0.45, `${title}  1/${den}`, 0);
    if (sub) d.text("A-BASLIK", x, ty - 0.65, 0.2, `${no} · ${sub}`, 0);
  };

  // ---------- 1. sıra: kat planları + vaziyet planı
  let ox = 0;
  for (const fl of L.floors) {
    sheet(`A-${100 + fl.level}`, fl.name.toLocaleUpperCase("tr") + " PLANI", `Kot ${fl.z >= 0 ? "+" : ""}${fl.z.toFixed(2)}`, 100, ox, -3.4, () => drawPlan(d, L, fl, ox, 0, program));
    ox += Math.max(L.W, 18) + SHEET_GAP + 4;
  }
  const siteX = ox;
  let siteW = 0;
  sheet("A-001", "VAZİYET PLANI", `Arsa ${program.site.width} × ${program.site.depth} m`, 200, siteX, -7.6, () => { siteW = drawSite(d, L, program, siteX, -4); });
  void siteW;

  // ---------- 2. sıra: kesit + cepheler
  const rowY = -(Math.max(program.site.depth, L.D) + 22);
  let sx = 0;
  const secX = sx;
  sheet("A-300", "A-A KESİTİ", `Kesit hattı x = ${L.cutX.toFixed(2)} m`, 100, secX, rowY - 3.4, () => drawSection(d, L, secX, rowY));
  sx += Math.max(L.D, 18) + SHEET_GAP + 6;
  const facades: [Facade, string][] = [["front", "ÖN (SOKAK) CEPHESİ"], ["back", "ARKA (BAHÇE) CEPHESİ"], ["left", "SOL YAN CEPHE"], ["right", "SAĞ YAN CEPHE"]];
  facades.forEach(([f, name], i) => {
    const ex = sx;
    let len = 0;
    sheet(`A-20${i + 1}`, name, undefined, 100, ex, rowY - 3.4, () => { len = drawElevation(d, L, f, ex, rowY); });
    sx += Math.max(len, 18) + SHEET_GAP + 4;
  });

  // ---------- kağıt düzenleri (pafta numarası sırasıyla)
  for (const sh of [...sheets].sort((a, b) => a.no.localeCompare(b.no, "tr", { numeric: true }))) drawSheet(doc, sh, program, ant);
  return doc.toBytes();
}

/** Yön bilgisinden kuzey: +1 kuzey sokak tarafında (plan altı), -1 bahçe tarafında (plan üstü), 0 bilinmiyor */
function northDir(program: Program) {
  const o = program.site?.orientation ?? "";
  if (/bahçe[^.]*güney|güney[^.]*bahçe|arka[^.]*güney/i.test(o)) return 1;
  if (/bahçe[^.]*kuzey|kuzey[^.]*bahçe|arka[^.]*kuzey/i.test(o)) return -1;
  return 0;
}

/** Kuzey oku bloğu + "K" harfi (yazı dönmesin diye blok dışında) */
function northArrow(d: Space, x: number, y: number, dir: number, s: number) {
  d.insert("A-KUZEY", "KUZEY", x, y, { rot: dir > 0 ? 180 : 0, sx: s, sy: s });
  d.text("A-KUZEY", x, dir > 0 ? y - 1.6 * s : y + 1.15 * s, 0.45 * s, "K");
}

/** Toprak taraması: üst kenarı zemin çizgisini izleyen şerit */
function earth(d: Space, top: Pt[], depth: number) {
  if (top.length < 2) return;
  const bot = Math.min(...top.map((p) => p[1])) - depth;
  const poly: Pt[] = [...top, [top[top.length - 1][0], bot], [top[0][0], bot]];
  d.hatch("A-ZEMIN-TARAMA", [poly], { name: "EARTH", scale: 0.05 * d.k });
}

// ---------------------------------------------------------------- PLAN
function drawPlan(d: Space, L: BuildingLayout, fl: BuildingLayout["floors"][number], ox: number, oy: number, program: Program) {
  const P = (x: number, y: number): [number, number] => [ox + x, oy + y];
  for (const w of fl.walls) {
    const t = w.thickness / 2;
    const [x, y] = w.orient === "h" ? P(w.a, w.line - t) : P(w.line - t, w.a);
    const ww = w.orient === "h" ? w.b - w.a : w.thickness;
    const hh = w.orient === "h" ? w.thickness : w.b - w.a;
    d.rect("A-DUVAR", x, y, ww, hh);
    d.hatch("A-DUVAR-POSE", [box(x, y, ww, hh)]);
  }
  for (const o of fl.openings) drawOpeningPlan(d, L, o, P);
  // taşıyıcı sistem ön önerisi: akslar ve kolonlar (ayrı katmanlarda, istenirse kapatılır)
  const st = structurePlan(L);
  for (const x of st.xs) d.line("A-AKS", ...P(x, -1.2), ...P(x, L.D + 1.2));
  for (const y of st.ys) d.line("A-AKS", ...P(-1.2, y), ...P(L.W + 1.2, y));
  for (const c of st.columns) {
    const horiz = c.x < 0.01 || c.x > L.W - 0.01 ? true : !(c.y < 0.01 || c.y > L.D - 0.01);
    const w = (horiz ? c.d : c.w) / 100, h = (horiz ? c.w : c.d) / 100;
    const cx = Math.min(L.W - w / 2, Math.max(w / 2, c.x)), cy = Math.min(L.D - h / 2, Math.max(h / 2, c.y));
    d.rect("A-KOLON", ...P(cx - w / 2, cy - h / 2), w, h);
    d.hatch("A-KOLON-POSE", [box(...P(cx - w / 2, cy - h / 2), w, h)]);
  }
  for (const r of fl.rooms.filter((q) => q.void)) {
    const a = r.rect;
    d.line("A-DOSEME-BOSLUK", ...P(a.x, a.y), ...P(a.x + a.w, a.y + a.h));
    d.line("A-DOSEME-BOSLUK", ...P(a.x, a.y + a.h), ...P(a.x + a.w, a.y));
  }
  for (const rl of fl.rails ?? []) d.line("A-BALKON", ...(rl.orient === "h" ? P(rl.a, rl.line) : P(rl.line, rl.a)), ...(rl.orient === "h" ? P(rl.b, rl.line) : P(rl.line, rl.b)));
  // mobilyalar blok: sırt kenarına göre döndürülür / aynalanır
  for (const f of furnishFloor(fl)) {
    const name = furnitureBlock(d.doc, f);
    const at: Record<Furniture["facing"], [number, number, number, number]> = { n: [f.x, f.y, 0, 1], s: [f.x, f.y + f.h, 0, -1], w: [f.x, f.y, 90, -1], e: [f.x + f.w, f.y, 90, 1] };
    const [x, y, rot, sy] = at[f.facing];
    d.insert("A-MOBILYA", name, ...P(x, y), { rot, sy });
  }
  if (L.stair) {
    const g = stairGeom(L.stair, L.stairInfo ?? legacyStairInfo(L.stair, L.H), L.H);
    const rr = (r: Rect) => { const [x, y] = P(r.x, r.y); d.rect("A-MERDIVEN", x, y, r.w, r.h); };
    rr(g.landing);
    for (const f of g.flights) {
      rr(f.rect);
      for (const [x1, y1, x2, y2] of f.lines) { const [a1, b1] = P(x1, y1); const [a2, b2] = P(x2, y2); d.line("A-MERDIVEN", a1, b1, a2, b2); }
    }
    d.pline("A-MERDIVEN", g.path.map(([x, y]) => P(x, y)));
    const [lx, ly] = P(g.labelAt[0], g.labelAt[1]);
    d.text("A-MERDIVEN", lx, ly, 0.12, g.label);
  }
  for (const st of fl.stairs ?? []) {
    const [x, y] = P(st.x, st.y);
    d.rect("A-MERDIVEN", x, y, st.w, st.h);
    const n = Math.max(3, Math.floor(st.w / 0.28));
    for (let i = 1; i < n; i++) d.line("A-MERDIVEN", x + (st.w * i) / n, y, x + (st.w * i) / n, y + st.h);
  }
  for (const r of fl.rooms.filter((q) => q.name === "Asansör")) {
    const [x, y] = P(r.rect.x, r.rect.y);
    d.line("A-MERDIVEN", x + 0.2, y + 0.2, x + r.rect.w - 0.2, y + r.rect.h - 0.2);
    d.line("A-MERDIVEN", x + 0.2, y + r.rect.h - 0.2, x + r.rect.w - 0.2, y + 0.2);
  }
  for (const u of fl.units ?? []) {
    const front = u.rect.y < L.hallBand.y;
    const [cx, cy] = P(Math.min(L.W - 2.5, Math.max(L.stair ? L.stair.w + 3 : 2.5, u.rect.x + u.rect.w / 2)), front ? L.hallBand.y + 0.35 : L.hallBand.y + L.hallBand.h - 0.55);
    d.text("A-MAHAL", cx, cy, 0.22, `${u.label} ${u.type}${u.part === "upper" ? " ÜST KAT" : ""} ${u.area.toFixed(0)} m²`);
  }
  for (const r of fl.rooms) {
    if (r.type === "merdiven") continue;
    const [x, y] = P(r.rect.x, r.rect.y);
    // mahal sınırı kapalı polyline (AREA / LIST ile alan okunur)
    d.rect("A-MAHAL", x, y, r.rect.w, r.rect.h);
    const [cx, cy] = P(r.rect.x + r.rect.w / 2, r.rect.y + r.rect.h / 2);
    const small = r.rect.w < 2.2 || r.rect.h < 1.6;
    // yazı yüksekliği oda genişliğine sığacak şekilde küçülür
    const th = Math.max(0.1, Math.min(small ? 0.16 : 0.25, (r.rect.w - 0.3) / (r.name.length * 0.62)));
    d.insert("A-MAHAL", "MAHAL", cx, cy, { attrs: [{ tag: "AD", value: r.name, h: th }, { tag: "ALAN", value: `${(r.rect.w * r.rect.h).toFixed(2)} m²`, h: small ? 0.13 : 0.18 }, { tag: "KAT", value: fl.name }] });
  }
  for (const o of fl.outdoor) {
    const [x, y] = P(o.rect.x, o.rect.y);
    d.rect("A-BALKON", x, y, o.rect.w, o.rect.h);
    d.rect("A-BALKON", x + 0.08, y + 0.08, o.rect.w - 0.16, o.rect.h - 0.16);
    d.text("A-MAHAL", x + o.rect.w / 2, y + o.rect.h / 2, 0.2, `${o.name} ${o.area.toFixed(1)} m²`);
  }
  // ölçüler: alt toplam + ön bant zinciri, sağ toplam + bant zinciri
  d.dim("A-OLCU", ox, oy, ox + L.W, oy, -1.6);
  const front = fl.rooms.filter((r) => near(r.rect.y, 0)).sort((a, b) => a.rect.x - b.rect.x);
  const xs = Array.from(new Set([0, ...front.map((r) => +(r.rect.x + r.rect.w).toFixed(3))])).sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) d.dim("A-OLCU", ox + xs[i], oy, ox + xs[i + 1], oy, -1.0);
  // pencere/kapı aralık zincirleri (ön ve sağ cephe)
  const opChain = (orient: "h" | "v", line: number, len: number) => {
    const pts = Array.from(new Set([0, len, ...fl.openings.filter((o) => o.exterior && o.orient === orient && near(o.line, line)).flatMap((o) => [o.center - o.width / 2, o.center + o.width / 2])].map((v) => Math.round(v * 1000) / 1000))).sort((a, b) => a - b);
    return pts.length > 2 ? pts : [];
  };
  const fx = opChain("h", 0, L.W);
  for (let i = 0; i < fx.length - 1; i++) if (fx[i + 1] - fx[i] > 0.04) d.dim("A-OLCU", ox + fx[i], oy, ox + fx[i + 1], oy, -0.45);
  const ry = opChain("v", L.W, L.D);
  for (let i = 0; i < ry.length - 1; i++) if (ry[i + 1] - ry[i] > 0.04) d.dim("A-OLCU", ox + L.W, oy + ry[i], ox + L.W, oy + ry[i + 1], 0.45);
  d.dim("A-OLCU", ox + L.W, oy, ox + L.W, oy + L.D, 1.6);
  const ys = [0, L.hallBand.y, L.hallBand.y + L.hallBand.h, L.D];
  for (let i = 0; i < ys.length - 1; i++) d.dim("A-OLCU", ox + L.W, oy + ys[i], ox + L.W, oy + ys[i + 1], 1.0);
  // kesit hattı
  const ax = ox + L.cutX;
  const outD = Math.max(0, ...fl.outdoor.map((o) => o.rect.y + o.rect.h - L.D));
  d.line("A-KESIT-HATTI", ax, oy - 0.6, ax, oy + L.D + outD + 0.8);
  for (const yy of [oy - 0.9, oy + L.D + outD + 1.1]) d.insert("A-KESIT-HATTI", "KESIT-OKU", ax, yy, { attrs: [{ tag: "AD", value: "A" }] });
  const nd = northDir(program);
  if (nd) northArrow(d, ox + L.W + 3.2, oy + L.D - 1.6, nd, 1);
}

function drawOpeningPlan(d: Space, L: BuildingLayout, o: Opening, P: (x: number, y: number) => [number, number]) {
  const a = o.center - o.width / 2, b = o.center + o.width / 2;
  const t = (o.exterior ? L.extWall : L.intWall) / 2;
  const Q = (u: number, v: number) => (o.orient === "h" ? P(u, v) : P(v, u));
  if (o.kind === "window" || o.kind === "balconyDoor") {
    // blok x ekseni açıklık boyunca; düşey duvarda 90° döner (kesit simetrik olduğundan ayna gerekmez)
    const name = windowBlock(d.doc, o.kind, b - a, 2 * t);
    d.insert("A-PENCERE", name, ...Q(a, o.line), { rot: o.orient === "h" ? 0 : 90 });
    return;
  }
  if (o.kind === "passage") {
    for (const v of [-t, t]) { const [x1, y1] = Q(a, o.line + v); const [x2, y2] = Q(b, o.line + v); d.line("A-KAPI", x1, y1, x2, y2); }
    return;
  }
  // kapı bloğu: menteşe noktası, kapalı kanat yönü (x) ve açık kanat yönü (y); sol el açılışta y aynalanır
  const [hx, hy] = Q(a, o.line);
  const [ex, ey] = Q(b, o.line);
  const [lx, ly] = Q(a, o.line + o.swing * o.width);
  const ux = ex - hx, uy = ey - hy, vx = lx - hx, vy = ly - hy;
  const rot = (Math.atan2(uy, ux) * 180) / Math.PI;
  const sy = ux * vy - uy * vx >= 0 ? 1 : -1;
  d.insert("A-KAPI", doorBlock(d.doc, o.width), hx, hy, { rot, sy });
}

// ---------------------------------------------------------------- KESİT
function drawSection(d: Space, L: BuildingLayout, ox: number, oy: number) {
  // yatay eksen: derinlik y (ön solda), dikey: kot z
  const X = (y: number) => ox + y;
  const Z = (z: number) => oy + z;
  const lv = siteLevels(L);
  const groundZ = lv.grade;
  const clear = L.H - L.slab;
  const slope = lv.sunken ? 0 : L.siteSlope ?? 0;
  if (lv.sunken) {
    // yol kotunun altındaki arsa: yol, istinat duvarı, arsa zemini, teras, köprü
    const yW = -6, yP0 = -4, yP1 = L.D + 5;
    d.line("A-ZEMIN", X(-10), Z(lv.road), X(yW), Z(lv.road));
    d.rect("A-ZEMIN", X(yW - 0.35), Z(lv.lot - 0.5), 0.35, lv.road - lv.lot + 0.5);
    d.line("A-ZEMIN", X(yW), Z(lv.lot), X(yP0), Z(lv.lot));
    if (lv.grade > lv.lot + 0.05) { d.line("A-ZEMIN", X(yP0), Z(lv.lot), X(yP0), Z(lv.grade)); d.line("A-ZEMIN", X(yP1), Z(lv.grade), X(yP1), Z(lv.lot)); }
    d.line("A-ZEMIN", X(yP0), Z(lv.grade), X(yP1), Z(lv.grade));
    d.line("A-ZEMIN", X(yP1), Z(lv.lot), X(yP1 + 4), Z(lv.lot));
    d.rect("A-ZEMIN", X(yW), Z(lv.road - 0.05), -yW, 0.25);
    d.text("A-ZEMIN", X(yW + 0.3), Z(lv.road + 1.2), 0.25, "KOPRU", 0);
    d.text("A-ZEMIN", X(yW + 0.3), Z((lv.road + lv.lot) / 2), 0.25, `ISTINAT DUVARI - ARSA YOLUN ${(L.lotBelowRoad ?? 0).toFixed(2)} m ALTINDA`, 0);
  } else d.line("A-ZEMIN", X(-4), Z(groundZ), X(slope ? L.D : L.D + 6), Z(groundZ));
  if (slope) {
    d.line("A-ZEMIN", X(L.D), Z(groundZ), X(L.D), Z(groundZ + slope * L.D));
    d.line("A-ZEMIN", X(L.D), Z(groundZ + slope * L.D), X(L.D + 6), Z(groundZ + slope * (L.D + 6)));
    d.line("A-ZEMIN", X(0), Z(groundZ), X(L.D), Z(groundZ + slope * L.D));
  }
  if (!lv.sunken) {
    // toprak taraması: bina dışında, zeminden temel altına kadar
    const deep = Math.max(0.6, groundZ - (Math.min(...L.floors.map((q) => q.z)) - L.slab - 0.6));
    const e0 = L.extWall / 2;
    earth(d, [[X(-4), Z(groundZ)], [X(-e0), Z(groundZ)]], deep);
    earth(d, slope ? [[X(L.D + e0), Z(groundZ + slope * (L.D + e0))], [X(L.D + 6), Z(groundZ + slope * (L.D + 6))]] : [[X(L.D + e0), Z(groundZ)], [X(L.D + 6), Z(groundZ)]], deep);
  }
  const floors = [...L.floors].sort((a, b) => a.z - b.z);
  const spans = (fs: typeof floors): [number, number][] => (L.massing ? spansAtX(fs.flatMap((q) => floorRects(q, L)), L.cutX) : [[0, L.D]]);
  const e = L.extWall / 2;
  // temel
  for (const yy of spans([floors[0]]).flatMap(([a, b]) => [a, b])) {
    d.rect("A-TEMEL", X(yy - 0.45), Z(floors[0].z - L.slab - 0.6), 0.9, 0.6);
    d.hatch("A-TEMEL-TARAMA", [box(X(yy - 0.45), Z(floors[0].z - L.slab - 0.6), 0.9, 0.6)], { name: "ANSI31", scale: 0.05 * d.k });
  }
  for (const f of floors) {
    const fi = floors.indexOf(f);
    for (const [a, b] of L.massing ? slabSpansAtX(L, f, L.cutX) : spans(fi > 0 ? [f, floors[fi - 1]] : [f])) {
      d.rect("A-DOSEME", X(a - e), Z(f.z - L.slab), b - a + 2 * e, L.slab);
      d.hatch("A-KESIT-POSE", [box(X(a - e), Z(f.z - L.slab), b - a + 2 * e, L.slab)]);
    }
    for (const o of f.outdoor) {
      if (o.carved !== "teras" || L.cutX < o.rect.x || L.cutX > o.rect.x + o.rect.w) continue;
      for (const sd of o.rails ?? []) if (sd === "front" || sd === "back") {
        const yy = sd === "front" ? o.rect.y : o.rect.y + o.rect.h;
        d.line("A-BALKON", X(yy), Z(f.z), X(yy), Z(f.z + 1.1));
      }
    }
    for (const w of f.wallLines) {
      if (w.orient !== "h" || L.cutX < w.a || L.cutX > w.b) continue;
      const op = f.openings.find((o) => o.orient === "h" && near(o.line, w.line) && Math.abs(o.center - L.cutX) <= o.width / 2);
      const seg = (za: number, zb: number) => {
        d.rect("A-DUVAR", X(w.line - w.thickness / 2), Z(f.z + za), w.thickness, zb - za);
        d.hatch("A-KESIT-POSE", [box(X(w.line - w.thickness / 2), Z(f.z + za), w.thickness, zb - za)]);
      };
      if (!op) seg(0, clear);
      else {
        if (op.sill > 0) seg(0, op.sill);
        seg(Math.min(op.head, clear), clear);
        if (op.kind === "window" || op.kind === "balconyDoor") d.line("A-PENCERE", X(w.line), Z(f.z + op.sill), X(w.line), Z(f.z + op.head));
      }
    }
    for (const r of f.rooms) {
      if (L.cutX < r.rect.x || L.cutX > r.rect.x + r.rect.w) continue;
      d.text("A-MAHAL", X(r.rect.y + r.rect.h / 2), Z(f.z + 1.3), 0.2, r.name);
    }
    for (const o of f.outdoor) {
      if (o.carved) continue;
      const front = o.rect.y < 0;
      const base = front ? 0 : L.D, ey = front ? o.rect.y : o.rect.y + o.rect.h;
      d.rect("A-BALKON", X(Math.min(base, ey)), Z(f.z - 0.18), Math.abs(ey - base), 0.18);
      d.pline("A-BALKON", [[X(ey), Z(f.z)], [X(ey), Z(f.z + 1.1)], [X(base), Z(f.z + 1.1)]]);
    }
    levelMark(d, X(L.D + 3), Z(f.z), f.z);
    d.dim("A-OLCU", X(0), Z(f.z), X(0), Z(f.z + L.H), -1.2);
  }
  const top = L.totalHeight;
  const topSpans = spans([floors[floors.length - 1]]);
  for (const [a, b] of topSpans) {
    d.rect("A-DOSEME", X(a - e), Z(top - L.slab), b - a + 2 * e, L.slab);
    d.hatch("A-KESIT-POSE", [box(X(a - e), Z(top - L.slab), b - a + 2 * e, L.slab)]);
  }
  if (L.roof === "duz") {
    for (const yy of topSpans.flatMap(([a, b]) => [a, b])) d.rect("A-DUVAR", X(yy - L.extWall / 2), Z(top), L.extWall, L.roofHeight);
  } else {
    const oh = 0.6, rise = L.roofHeight, slope = rise / (L.D / 2);
    const p1: [number, number] = [X(-oh), Z(top - oh * slope)];
    const p2: [number, number] = [X(L.D / 2), Z(top + rise)];
    const p3: [number, number] = [X(L.D + oh), Z(top - oh * slope)];
    d.pline("A-CATI", [p1, p2, p3]);
    d.pline("A-CATI", [[p1[0], p1[1] + 0.22], [p2[0], p2[1] + 0.22], [p3[0], p3[1] + 0.22]]);
  }
  levelMark(d, X(L.D + 3), Z(top), top);
  d.dim("A-OLCU", X(0), Z(groundZ), X(0), Z(top + L.roofHeight), -2.2, "H <>");
  d.dim("A-OLCU", X(0), Z(groundZ), X(L.D), Z(groundZ), -1.2);
}

function levelMark(d: Space, x: number, y: number, z: number) {
  d.insert("A-KOT", "KOT", x, y, { attrs: [{ tag: "KOT", value: Math.abs(z) < 0.005 ? "±0.00" : `${z > 0 ? "+" : ""}${z.toFixed(2)}` }] });
}

// ---------------------------------------------------------------- CEPHE
type Facade = "front" | "back" | "left" | "right";

function drawElevation(d: Space, L: BuildingLayout, facade: Facade, ox: number, oy: number): number {
  const len = facade === "front" || facade === "back" ? L.W : L.D;
  const U = (u: number) => ox + u;
  const Z = (z: number) => oy + z;
  const toU = (x: number, y: number) => (facade === "front" ? x : facade === "back" ? L.W - x : facade === "left" ? L.D - y : y);
  const lv = siteLevels(L);
  const groundZ = lv.grade;
  const top = L.totalHeight;
  const slope = L.siteSlope ?? 0;
  const gAt = (u: number) => groundZ + slope * (facade === "front" ? 0 : facade === "back" ? L.D : Math.max(0, Math.min(L.D, facade === "left" ? L.D - u : u)));
  if (slope && (facade === "left" || facade === "right")) { d.line("A-ZEMIN", U(-2), Z(gAt(-2)), U(0), Z(gAt(0))); d.line("A-ZEMIN", U(0), Z(gAt(0)), U(len), Z(gAt(len))); d.line("A-ZEMIN", U(len), Z(gAt(len)), U(len + 2), Z(gAt(len + 2))); }
  else d.line("A-ZEMIN", U(-2), Z(gAt(0)), U(len + 2), Z(gAt(0)));
  earth(d, slope && (facade === "left" || facade === "right") ? [[U(-2), Z(gAt(-2))], [U(0), Z(gAt(0))], [U(len), Z(gAt(len))], [U(len + 2), Z(gAt(len + 2))]] : [[U(-2), Z(gAt(0))], [U(len + 2), Z(gAt(0))]], 0.5);
  const above = L.floors.filter((f) => f.z >= 0 || (lv.sunken && f.z + L.H > groundZ + 0.6));
  if (lv.sunken) d.line("A-ZEMIN", U(-2), Z(lv.road), U(len + 2), Z(lv.road));
  if (!L.massing) {
    d.rect("A-CEPHE", U(0), Z(groundZ), len, top - groundZ);
    for (const f of above) if (f.z > groundZ + 0.5) d.line("A-CEPHE", U(0), Z(f.z), U(len), Z(f.z));
  } else {
    // girintili kütle: her katın bu cepheye bakan yüzleri; geri çekilen yüzler ayrı katmanda
    above.forEach((f, i) => {
      const zb = i === 0 ? groundZ : f.z;
      for (const fc of facadeFaces(L, f, facade)) d.rect(fc.depth > 0.05 ? "A-CEPHE-GERI" : "A-CEPHE", U(fc.u0), Z(zb), fc.u1 - fc.u0, f.z + L.H - zb);
    });
  }
  const onFacade = (f: (typeof above)[number]) => (o: Opening) => openingOnFacade(L, f, o, facade);
  for (const f of above) {
    for (const o of f.openings.filter(onFacade(f))) {
      const u = o.orient === "h" ? toU(o.center, o.line) : toU(o.line, o.center);
      const layer = o.kind === "entrance" ? "A-KAPI" : "A-PENCERE";
      d.rect(layer, U(u - o.width / 2), Z(f.z + o.sill), o.width, o.head - o.sill);
      if (o.kind !== "entrance") d.rect(layer, U(u - o.width / 2 + 0.05), Z(f.z + o.sill + 0.05), o.width - 0.1, o.head - o.sill - 0.1);
      if (o.kind !== "entrance" && o.width > 1.2) d.line(layer, U(u), Z(f.z + o.sill), U(u), Z(f.z + o.head));
    }
    for (const o of f.outdoor) {
      if (f.z <= 0) continue;
      if (o.carved) {
        if (o.carved !== "teras" || !o.rails?.includes(facade)) continue;
        const r = o.rect, hz = facade === "front" || facade === "back";
        const ua = hz ? toU(r.x, 0) : toU(0, r.y), ub = hz ? toU(r.x + r.w, 0) : toU(0, r.y + r.h);
        d.rect("A-BALKON", U(Math.min(ua, ub)), Z(f.z), Math.abs(ub - ua), 1.1);
        continue;
      }
      let u0: number, w: number;
      if ((facade === "back" && o.rect.y >= 0) || (facade === "front" && o.rect.y < 0)) { u0 = Math.min(toU(o.rect.x + o.rect.w, 0), toU(o.rect.x, 0)); w = o.rect.w; }
      else if (facade === "left") { u0 = L.D - (o.rect.y + o.rect.h); w = o.rect.h; }
      else if (facade === "right") { u0 = o.rect.y; w = o.rect.h; }
      else continue;
      d.rect("A-BALKON", U(u0), Z(f.z - 0.18), w, 0.18);
      d.rect("A-BALKON", U(u0), Z(f.z), w, 1.1);
    }
  }
  // çatı
  const rise = L.roofHeight, oh = 0.6;
  if (L.roof === "duz" && L.massing && above.length) {
    for (const fc of facadeFaces(L, above[above.length - 1], facade)) d.rect("A-CEPHE", U(fc.u0), Z(top), fc.u1 - fc.u0, rise);
  } else if (L.roof === "duz") {
    d.rect("A-CEPHE", U(0), Z(top), len, rise);
  } else if (facade === "front" || facade === "back") {
    const inset = L.roof === "kirma" ? Math.min(L.D, L.W) / 2 : -oh;
    d.pline("A-CATI", [[U(-oh), Z(top - 0.1)], [U(len + oh), Z(top - 0.1)], [U(len - inset), Z(top + rise)], [U(inset), Z(top + rise)]], true);
  } else {
    const slope = rise / (len / 2);
    d.pline("A-CATI", [[U(-oh), Z(top - oh * slope)], [U(len / 2), Z(top + rise)], [U(len + oh), Z(top - oh * slope)]]);
    if (L.roof === "besik") d.pline("A-CEPHE", [[U(0), Z(top)], [U(len / 2), Z(top + rise - 0.25)], [U(len), Z(top)]]);
  }
  d.dim("A-OLCU", U(0), Z(groundZ), U(len), Z(groundZ), -1.0);
  d.dim("A-OLCU", U(len), Z(groundZ), U(len), Z(top + rise), 1.4);
  return len;
}

// ---------------------------------------------------------------- VAZİYET
function drawSite(d: Space, L: BuildingLayout, p: Program, ox: number, oy: number) {
  const z = zoningCheck(p, L);
  const sw = p.site.width, sd = p.site.depth;
  d.rect("A-ARSA", ox, oy, sw, sd);
  const s = z.setbacks;
  d.rect("A-CEKME", ox + s.side, oy + s.front, Math.max(0, sw - 2 * s.side), Math.max(0, sd - s.front - s.rear));
  // bina (sokak y=0 altta)
  const bl = z.blocks ?? [{ name: "", index: 0, L, x: z.building.x, y: z.building.y }];
  for (const b of bl) {
    d.rect("A-DUVAR", ox + b.x, oy + b.y, b.L.W, b.L.D);
    for (const f of b.L.floors) for (const o of f.outdoor) d.rect("A-BALKON", ox + b.x + o.rect.x, oy + b.y + o.rect.y, o.rect.w, o.rect.h);
    if (z.blocks) d.text("A-MAHAL", ox + b.x + b.L.W / 2, oy + b.y + b.L.D / 2 - 0.8, 0.5, b.name.toUpperCase());
  }
  const pool = sitePool(p, L, z);
  if (pool) {
    d.rect("A-HAVUZ", ox + pool.x - 1.2, oy + pool.y - 1.2, pool.w + 2.4, pool.h + 2.4);
    d.rect("A-HAVUZ", ox + pool.x, oy + pool.y, pool.w, pool.h);
    d.text("A-MAHAL", ox + pool.x + pool.w / 2, oy + pool.y + pool.h / 2, 0.3, `${pool.name.toUpperCase()} ${pool.w.toFixed(1)}x${pool.h.toFixed(1)}`);
  }
  const stalls = parkingStalls(p, L, z);
  for (const st of stalls) d.rect("A-OTOPARK", ox + st.x, oy + st.y, st.w, st.h);
  if (stalls.length) d.text("A-MAHAL", ox + (stalls[0].x + stalls[stalls.length - 1].x + stalls[0].w) / 2, oy + stalls[0].y + stalls[0].h / 2, 0.25, `OTOPARK ${stalls.length} ARAÇ`);
  d.text("A-MAHAL", ox + z.building.x + L.W / 2, oy + z.building.y + L.D / 2, 0.35, `${L.floors.filter((f) => f.z >= 0).length} KAT  ${(L.W * L.D).toFixed(0)} m²`);
  d.dim("A-OLCU", ox, oy, ox + sw, oy, -1.2);
  d.dim("A-OLCU", ox + sw, oy, ox + sw, oy + sd, 1.2);
  d.dim("A-OLCU", ox + z.building.x + L.W / 2, oy, ox + z.building.x + L.W / 2, oy + z.building.y, 0.3, "ön <>");
  d.dim("A-OLCU", ox, oy + z.building.y + L.D / 2, ox + z.building.x, oy + z.building.y + L.D / 2, 0.3);
  d.text("A-BASLIK", ox + sw / 2, oy - 2.4, 0.35, "SOKAK");
  const nd = northDir(p);
  if (nd) northArrow(d, ox + sw + 1.8, oy + sd + 1.5, nd, 1.5);
  d.text("A-MAHAL", ox + 0.5, oy + sd - 1.0, 0.25, `TAKS ${z.taks.toFixed(2)}  KAKS ${z.kaks.toFixed(2)}`, 0);
  // İmar özeti tablosu (vaziyet planının sağında)
  const tx = ox + sw + 3, rowH = 0.7, cols = [0, 7.5, 10.5, 13.5, 16];
  const rows: string[][] = [["KONTROL", "PROJE", "SINIR", "DURUM"], ...z.checks.map((c) => [c.label, c.value, c.limit, c.ok == null ? "-" : c.ok ? "UYGUN" : "AŞIYOR"])];
  const ty = oy + sd - 1.2;
  d.text("A-BASLIK", tx, ty + 0.5, 0.35, "İMAR ÖZETİ", 0);
  rows.forEach((r, i) => {
    const y = ty - (i + 1) * rowH;
    d.rect("A-ANTET", tx, y, cols[4], rowH);
    r.forEach((t, k) => d.text(i === 0 ? "A-BASLIK" : "A-MAHAL", tx + cols[k] + 0.2, y + 0.22, 0.22, t, 0));
  });
  for (const cx of cols.slice(1, 4)) d.line("A-ANTET", tx + cx, ty, tx + cx, ty - rows.length * rowH);
  d.text("A-MAHAL", tx, ty - (rows.length + 1) * rowH, 0.2, `Arsa ${z.siteArea.toFixed(0)} m2 · taban ${z.footprintArea.toFixed(0)} m2 · emsale giren ${z.grossTotal.toFixed(0)} m2. Ön tasarım kontrolüdür; imar durumu belgesi esastır.`, 0);
  return sw + 3 + cols[4];
}

const box = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
