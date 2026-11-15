// Kütle artikülasyonu: dikdörtgen yerleşimi modern, girintili-çıkıntılı bir kütleye çevirir.
//
// Yerleşim motoru her katı W × D dikdörtgenine dizer. Bu modül katların bazı kenar şeritlerini "oyar":
//  - zemin katta ön/arka/yan şerit geri çekilirse üst kat konsol (kapalı çıkma) olarak taşar, altı sundurma olur;
//  - üst katta arka şerit geri çekilirse alt katın döşemesi çatı terası olur (kademeli kütle);
//  - bütün katlarda bir köşe oyulursa L biçimli oturum ve bahçe avlusu oluşur.
// Oyma işlemi yalnız odanın dış cepheye değen kenarından, odayı dikdörtgen bırakarak yapılır; böylece
// planın bütün kuralları (erişim, ıslak hacim, asgari ölçü) korunur. Asgari ölçünün altına düşecek oda oyulmaz.
//
// Örüntüler, çağdaş konut mimarisinde yaygın kütle stratejilerinden ve Planlı Alanlar İmar Yönetmeliği md. 41'den
// (kapalı çıkma ≤ 1,50 m, çıkma altı ≥ 2,40 m) damıtılmıştır; belirli bir yayımlanmış proje kopyalanmaz.

import type { Program, Room, RoomType } from "../shared/schema";
import type { BuildingLayout, FloorLayout, Opening, PlacedRoom, Rect, WallPiece } from "./layout";

export const MASS_FEATURES = ["on_konsol", "arka_konsol", "yan_konsol", "ust_kat_teras", "kose_oyugu"] as const;
export type MassFeature = (typeof MASS_FEATURES)[number];

export interface MassingSpec {
  features: MassFeature[];
  /** Konsol / çıkma derinliği (m). Yönetmelik kapalı çıkmada 1,50 m'ye izin verir. */
  cantilever?: number;
  /** Üst kat teras derinliği (m) */
  terraceDepth?: number;
  /** Köşe oyuğu derinliği (m) */
  notchDepth?: number;
  /** Claude'un kısa gerekçesi */
  rationale?: string;
}

export const MASS_LABELS: Record<MassFeature, { name: string; hint: string }> = {
  on_konsol: { name: "Ön konsol", hint: "Zemin kat sokak cephesinde geri çekilir, üst kat konsol olarak taşar; altı kapalı giriş / sundurma olur" },
  arka_konsol: { name: "Arka konsol", hint: "Zemin kat bahçe cephesinde geri çekilir; üst katın altı gölgeli kapalı teras olur" },
  yan_konsol: { name: "Yan konsol", hint: "Zemin kat bir yandan geri çekilir; üst kat yana taşar (araç sundurması, gölgeli yol)" },
  ust_kat_teras: { name: "Kademeli teras", hint: "En üst kat bahçe tarafında geri çekilir; alt katın çatısı teras olur (düz çatı)" },
  kose_oyugu: { name: "Köşe oyuğu (L kütle)", hint: "Bahçe köşesi bütün katlarda oyulur; L biçimli kütle ve korunaklı avlu (düz çatı)" },
};

/** Hiçbir artikülasyon istemeyen sade kutu. */
export const NO_MASSING: MassingSpec = { features: [] };

export type CarvedKind = "sundurma" | "teras" | "avlu";
export type Side = "front" | "back" | "left" | "right";

const EPS = 0.01;
const near = (a: number, b: number, t = EPS) => Math.abs(a - b) < t;
const r2 = (v: number) => Math.round(v * 100) / 100;
const inRect = (r: Rect, x: number, y: number) => x > r.x - 1e-6 && x < r.x + r.w + 1e-6 && y > r.y - 1e-6 && y < r.y + r.h + 1e-6;

/** Programdaki ve mimarın seçtiği kütle tercihlerinden geçerli olanı. */
export function effectiveMassing(program: Program, design = program.design): MassingSpec {
  const m = (design?.massing ?? program.massing ?? NO_MASSING) as MassingSpec;
  const features = (Array.isArray(m.features) ? m.features : []).filter((f): f is MassFeature => (MASS_FEATURES as readonly string[]).includes(f));
  return { ...m, features: Array.from(new Set(features)) };
}

// ---------------------------------------------------------------- asgari ölçüler (oyulduktan sonra kalan)

const KEEP_SIDE: Partial<Record<RoomType | "merdiven", number>> = {
  salon: 3.4, ebeveyn: 3.0, yatak: 2.8, cocuk: 2.8, misafir: 2.8, calisma: 2.4, ofis: 2.6, yemek: 2.6, mutfak: 2.2,
  banyo: 1.6, wc: 1.0, antre: 1.4, hol: 1.0, koridor: 1.0, garaj: 2.9, giyinme: 1.4, camasir: 1.4, depo: 1.2, kiler: 1.1, teknik: 1.2, magaza: 3.0,
};
const KEEP_AREA: Partial<Record<RoomType | "merdiven", number>> = {
  salon: 14, ebeveyn: 10.5, yatak: 9, cocuk: 9, misafir: 9, calisma: 7, mutfak: 5.5, banyo: 3.5, wc: 1.3, garaj: 14,
};

function canTrim(r: PlacedRoom, side: Side, d: number) {
  if (r.type === "merdiven") return false;
  const len = side === "front" || side === "back" ? r.rect.h : r.rect.w;
  const other = side === "front" || side === "back" ? r.rect.w : r.rect.h;
  const left = len - d;
  const keepSide = KEEP_SIDE[r.type] ?? 1.8;
  if (left < keepSide - 1e-6) return false;
  if (Math.min(left, other) < Math.min(keepSide, other) - 1e-6) return false;
  const area = left * other;
  if (area < (KEEP_AREA[r.type] ?? 0) - 1e-6) return false;
  // istenen alanın büyük kısmı korunmalı (asgari ölçü kontrolü %80'in altını uyarır)
  if (r.requestedArea > 0 && area < r.requestedArea * 0.82 && !(r.type === "antre" || r.type === "hol" || r.type === "koridor")) return false;
  return true;
}

function trimmedRect(r: Rect, side: Side, d: number): Rect {
  if (side === "front") return { x: r.x, y: r2(r.y + d), w: r.w, h: r2(r.h - d) };
  if (side === "back") return { x: r.x, y: r.y, w: r.w, h: r2(r.h - d) };
  if (side === "left") return { x: r2(r.x + d), y: r.y, w: r2(r.w - d), h: r.h };
  return { x: r.x, y: r.y, w: r2(r.w - d), h: r.h };
}

function removedStrip(r: Rect, side: Side, d: number): Rect {
  if (side === "front") return { x: r.x, y: r.y, w: r.w, h: d };
  if (side === "back") return { x: r.x, y: r2(r.y + r.h - d), w: r.w, h: d };
  if (side === "left") return { x: r.x, y: r.y, w: d, h: r.h };
  return { x: r2(r.x + r.w - d), y: r.y, w: d, h: r.h };
}

const touches = (r: Rect, side: Side, W: number, D: number) =>
  side === "front" ? near(r.y, 0) : side === "back" ? near(r.y + r.h, D) : side === "left" ? near(r.x, 0) : near(r.x + r.w, W);

// ---------------------------------------------------------------- yardımcılar (çizimler de kullanır)

/** Katın kapalı hacimlerinin dikdörtgenleri (odalar + merdiven). */
export function floorRects(f: FloorLayout, L: BuildingLayout): Rect[] {
  const out = f.rooms.map((r) => r.rect);
  if (L.stair && !f.rooms.some((r) => r.type === "merdiven")) out.push(L.stair);
  return out;
}

/** Dikdörtgenler birleşimini çakışmasız hücrelere böler (aynı satırdaki bitişik hücreler birleşir). */
export function unionCells(rects: Rect[], hole?: Rect | null): Rect[] {
  if (!rects.length) return [];
  const xs = uniq(rects.flatMap((r) => [r.x, r.x + r.w]).concat(hole ? [hole.x, hole.x + hole.w] : []));
  const ys = uniq(rects.flatMap((r) => [r.y, r.y + r.h]).concat(hole ? [hole.y, hole.y + hole.h] : []));
  const out: Rect[] = [];
  for (let j = 0; j < ys.length - 1; j++) {
    const cy = (ys[j] + ys[j + 1]) / 2;
    let run: Rect | null = null;
    for (let i = 0; i < xs.length - 1; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const on = rects.some((r) => inRect(r, cx, cy)) && !(hole && inRect(hole, cx, cy));
      if (on) {
        if (run && near(run.x + run.w, xs[i], 1e-4)) run.w = xs[i + 1] - run.x;
        else { run = { x: xs[i], y: ys[j], w: xs[i + 1] - xs[i], h: ys[j + 1] - ys[j] }; out.push(run); }
      } else run = null;
    }
  }
  return out;
}
function uniq(v: number[]) {
  const s = [...v].sort((a, b) => a - b);
  const out: number[] = [];
  for (const x of s) if (!out.length || x - out[out.length - 1] > 1e-4) out.push(x);
  return out;
}

/** Bir katın döşemesi: o katın ve altındaki katın kapalı hacimleri (konsol altı ve teras döşemesi dahil). */
export function slabCells(L: BuildingLayout, f: FloorLayout, withHole = true): Rect[] {
  if (!L.massing) return withHole && L.stair && f !== L.floors[0] ? unionCells([{ x: 0, y: 0, w: L.W, h: L.D }], L.stair) : [{ x: 0, y: 0, w: L.W, h: L.D }];
  const i = L.floors.indexOf(f);
  const rects = floorRects(f, L).concat(i > 0 ? floorRects(L.floors[i - 1], L) : []);
  return unionCells(rects, withHole && i > 0 ? L.stair : null);
}

/** Katın kapalı oturum alanı (m²). */
export function floorFootprintArea(L: BuildingLayout, f: FloorLayout) {
  if (!L.massing) return L.W * L.D;
  return unionCells(floorRects(f, L)).reduce((s, r) => s + r.w * r.h, 0);
}

/** x = sabit hattında kapalı hacmin y aralıkları (kesit için). */
export function spansAtX(rects: Rect[], x: number): [number, number][] {
  const iv = rects.filter((r) => x >= r.x - 1e-6 && x <= r.x + r.w + 1e-6).map((r) => [r.y, r.y + r.h] as [number, number]).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const s of iv) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1] + 1e-4) last[1] = Math.max(last[1], s[1]);
    else out.push([...s]);
  }
  return out;
}

/** Dış açıklığın dışarıya baktığı yön. */
export function openingFacing(f: FloorLayout, L: BuildingLayout, o: Opening): Side | null {
  if (!o.exterior) return null;
  const rects = floorRects(f, L);
  const inside = (x: number, y: number) => rects.some((r) => inRect(r, x, y));
  if (o.orient === "h") {
    const plus = inside(o.center, o.line + 0.06), minus = inside(o.center, o.line - 0.06);
    if (plus && !minus) return "front";
    if (minus && !plus) return "back";
  } else {
    const plus = inside(o.line + 0.06, o.center), minus = inside(o.line - 0.06, o.center);
    if (plus && !minus) return "left";
    if (minus && !plus) return "right";
  }
  return null;
}

/** Dış duvar parçasının dışarıya baktığı yön. */
export function wallFacing(f: FloorLayout, L: BuildingLayout, w: WallPiece): Side | null {
  const rects = floorRects(f, L);
  const inside = (x: number, y: number) => rects.some((r) => inRect(r, x, y));
  const m = (Math.max(w.a, Math.min(w.b, (w.a + w.b) / 2)));
  if (w.orient === "h") {
    const plus = inside(m, w.line + 0.06), minus = inside(m, w.line - 0.06);
    return plus && !minus ? "front" : minus && !plus ? "back" : null;
  }
  const plus = inside(w.line + 0.06, m), minus = inside(w.line - 0.06, m);
  return plus && !minus ? "left" : minus && !plus ? "right" : null;
}

/** Cephe yüzleri: bir katın, verilen cepheye bakan dış duvar parçaları; u: cephe boyunca koordinat, depth: cephe düzleminden geri çekilme. */
export function facadeFaces(L: BuildingLayout, f: FloorLayout, facade: Side): { u0: number; u1: number; depth: number }[] {
  const toU = (x: number, y: number) => (facade === "front" ? x : facade === "back" ? L.W - x : facade === "left" ? L.D - y : y);
  const t = L.extWall / 2;
  const out: { u0: number; u1: number; depth: number }[] = [];
  for (const w of f.wallLines) {
    if (!w.exterior) continue;
    if ((facade === "front" || facade === "back") !== (w.orient === "h")) continue;
    if (wallFacing(f, L, w) !== facade) continue;
    const a = w.orient === "h" ? toU(w.a, w.line) : toU(w.line, w.a);
    const b = w.orient === "h" ? toU(w.b, w.line) : toU(w.line, w.b);
    const depth = facade === "front" ? w.line : facade === "back" ? L.D - w.line : facade === "left" ? w.line : L.W - w.line;
    // dış duvar uçları zaten yarım kalınlık uzatılmış; görünüşte bina köşesine kadar
    out.push({ u0: Math.max(-t, Math.min(a, b)), u1: Math.min((facade === "front" || facade === "back" ? L.W : L.D) + t, Math.max(a, b)), depth: r2(depth) });
  }
  return out.sort((p, q) => q.depth - p.depth);
}

/** Açıklık bu cephede görünür mü (yönü cepheye dönük). */
export function openingOnFacade(L: BuildingLayout, f: FloorLayout, o: Opening, facade: Side) {
  if (!L.massing) {
    return facade === "front" ? o.orient === "h" && near(o.line, 0)
      : facade === "back" ? o.orient === "h" && near(o.line, L.D)
        : facade === "left" ? o.orient === "v" && near(o.line, 0)
          : o.orient === "v" && near(o.line, L.W);
  }
  return openingFacing(f, L, o) === facade;
}

export function openingDepth(L: BuildingLayout, o: Opening, facade: Side) {
  return facade === "front" ? o.line : facade === "back" ? L.D - o.line : facade === "left" ? o.line : L.W - o.line;
}

// ---------------------------------------------------------------- duvarlar

/** Oda dikdörtgenlerinden duvar çizgileri; bir tarafında hacim olmayan parçalar dış duvardır (girintili kütle). */
export function buildFreeWalls(rects: Rect[], EXT: number, INT: number): WallPiece[] {
  const lines = new Map<string, { orient: "h" | "v"; line: number; iv: [number, number][] }>();
  const add = (orient: "h" | "v", line: number, a: number, b: number) => {
    const key = `${orient}:${line.toFixed(3)}`;
    if (!lines.has(key)) lines.set(key, { orient, line, iv: [] });
    lines.get(key)!.iv.push([Math.min(a, b), Math.max(a, b)]);
  };
  for (const { x, y, w, h } of rects) {
    add("h", y, x, x + w); add("h", y + h, x, x + w);
    add("v", x, y, y + h); add("v", x + w, y, y + h);
  }
  const inside = (px: number, py: number) => rects.some((r) => px > r.x + 1e-6 && px < r.x + r.w - 1e-6 && py > r.y + 1e-6 && py < r.y + r.h - 1e-6);
  const out: WallPiece[] = [];
  for (const { orient, line, iv } of lines.values()) {
    iv.sort((p, q) => p[0] - q[0]);
    const merged: [number, number][] = [];
    for (const s of iv) {
      const last = merged[merged.length - 1];
      if (last && s[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], s[1]);
      else merged.push([...s]);
    }
    const cuts = uniq(rects.flatMap((r) => (orient === "h" ? [r.x, r.x + r.w] : [r.y, r.y + r.h])));
    for (const [a, b] of merged) {
      const pts = uniq([a, b, ...cuts.filter((c) => c > a + 1e-6 && c < b - 1e-6)]);
      let cur: WallPiece | null = null;
      for (let i = 0; i < pts.length - 1; i++) {
        const m = (pts[i] + pts[i + 1]) / 2;
        const s1 = orient === "h" ? inside(m, line + 0.03) : inside(line + 0.03, m);
        const s2 = orient === "h" ? inside(m, line - 0.03) : inside(line - 0.03, m);
        const exterior = !(s1 && s2);
        if (cur && cur.exterior === exterior && near(cur.b, pts[i], 1e-4)) cur.b = pts[i + 1];
        else { cur = { orient, line, a: pts[i], b: pts[i + 1], thickness: exterior ? EXT : INT, exterior }; out.push(cur); }
      }
    }
  }
  for (const p of out) if (p.exterior) { p.a -= EXT / 2; p.b += EXT / 2; }
  return out;
}

// ---------------------------------------------------------------- uygulama

interface Hooks {
  ext: number;
  int: number;
  groundLevel: number;
  cutWalls: (lines: WallPiece[], cuts: OpenEdge[]) => WallPiece[];
  subtract: (lines: WallPiece[], ops: Opening[]) => WallPiece[];
}
export interface OpenEdge { orient: "h" | "v"; line: number; a: number; b: number; len: number }

type Strip = { rect: Rect; side: Side; host?: PlacedRoom };

/**
 * Yerleşime kütle artikülasyonunu uygular (yerinde değiştirir). Uygulanan özellikleri ve notları döndürür.
 * Yalnız müstakil konut yerleşiminde (apartman değil) çalışır.
 */
export function applyMassing(L: BuildingLayout, program: Program, spec: MassingSpec, hooks: Hooks): { applied: MassFeature[]; notes: string[] } {
  const notes: string[] = [];
  const applied: MassFeature[] = [];
  if (!spec.features.length || L.apartment) return { applied, notes };
  const { W, D } = L;
  const above = L.floors.filter((f) => f.level >= hooks.groundLevel);
  if (!above.length) return { applied, notes };
  const ground = above[0];
  const top = above[above.length - 1];
  const multi = above.length > 1;
  const flat = program.roof === "duz";
  const cant = clampNum(spec.cantilever, 1.0, 3.0, 1.5);
  const terr = clampNum(spec.terraceDepth, 1.8, 4.5, 2.6);
  const notch = clampNum(spec.notchDepth, 1.8, 4.5, 2.6);
  const strips = new Map<FloorLayout, Strip[]>();
  const push = (f: FloorLayout, s: Strip) => { if (!strips.has(f)) strips.set(f, []); strips.get(f)!.push(s); };

  /**
   * Kattaki, kenara değen ve oyulabilen odalardan kesintisiz en uzun diziyi oyar (girişi içeren dizi önceliklidir);
   * tek tek dişli bir cephe yerine temiz bir konsol hattı oluşur. Oyulan kenar uzunluğu payını döndürür.
   */
  const carveSide = (f: FloorLayout, side: Side, d: number) => {
    const horiz = side === "front" || side === "back";
    const edgeLen = horiz ? W : D;
    const list = f.rooms.filter((r) => !r.name.startsWith("__") && touches(r.rect, side, W, D))
      .sort((a, b) => (horiz ? a.rect.x - b.rect.x : a.rect.y - b.rect.y));
    const a0 = (r: PlacedRoom) => (horiz ? r.rect.x : r.rect.y), a1 = (r: PlacedRoom) => (horiz ? r.rect.x + r.rect.w : r.rect.y + r.rect.h);
    const runs: PlacedRoom[][] = [];
    let cur: PlacedRoom[] = [];
    for (const r of list) {
      const ok = canTrim(r, side, d);
      if (ok && cur.length && near(a1(cur[cur.length - 1]), a0(r), 0.05)) cur.push(r);
      else if (ok) { if (cur.length) runs.push(cur); cur = [r]; }
      else { if (cur.length) runs.push(cur); cur = []; }
    }
    if (cur.length) runs.push(cur);
    const len = (run: PlacedRoom[]) => a1(run[run.length - 1]) - a0(run[0]);
    const hasEntrance = (run: PlacedRoom[]) => run.some((r) => f.openings.some((o) => o.kind === "entrance" && o.width < 2 && (o.orient === "h") === horiz
      && near(o.line, horiz ? (side === "front" ? r.rect.y : r.rect.y + r.rect.h) : side === "left" ? r.rect.x : r.rect.x + r.rect.w)
      && o.center > a0(r) && o.center < a1(r)));
    const best = runs.filter((r) => len(r) >= Math.max(3, edgeLen * 0.3))
      .sort((p, q) => Number(hasEntrance(q)) - Number(hasEntrance(p)) || len(q) - len(p))[0];
    if (!best) return 0;
    for (const r of best) {
      push(f, { rect: removedStrip(r.rect, side, d), side, host: r });
      shiftOpenings(f, r, side, d);
      r.rect = trimmedRect(r.rect, side, d);
    }
    return len(best) / edgeLen;
  };

  // Yer tutucu oyuklar (köşe avlusu, üst kat terası): odadan çıkar, dış mekân şeridine çevir
  for (const f of L.floors) {
    for (const r of f.rooms.filter((q) => q.name.startsWith("__"))) {
      push(f, { rect: { ...r.rect }, side: "back", host: r });
      f.rooms.splice(f.rooms.indexOf(r), 1);
      const R = r.rect;
      const onEdge = (o: Opening) => (o.orient === "h" ? (near(o.line, R.y) || near(o.line, R.y + R.h)) && o.center > R.x && o.center < R.x + R.w
        : (near(o.line, R.x) || near(o.line, R.x + R.w)) && o.center > R.y && o.center < R.y + R.h);
      f.openings = f.openings.filter((o) => {
        if (!onEdge(o)) return true;
        // holden oyuğa açılan kapı: dış kapı olur (türü dış mekân belli olunca ayarlanır)
        if (o.kind === "door" && o.orient === "h" && near(o.line, R.y)) { Object.assign(o, { exterior: true, pocket: true }); return true; }
        return false;
      });
    }
  }
  if (strips.size) {
    if (L.floors.some((f) => strips.get(f)?.some((s) => s.host?.name === "__avlu__"))) applied.push("kose_oyugu");
    if (L.floors.some((f) => strips.get(f)?.some((s) => s.host?.name === "__teras__"))) applied.push("ust_kat_teras");
  }

  const want = new Set(spec.features);
  if ((want.has("ust_kat_teras") || want.has("kose_oyugu")) && !flat) {
    notes.push("Kademeli teras ve köşe oyuğu düz çatı ister; eğimli çatıda uygulanmadı.");
    want.delete("ust_kat_teras");
    want.delete("kose_oyugu");
  }
  if (!multi) for (const k of ["on_konsol", "arka_konsol", "yan_konsol", "ust_kat_teras"] as MassFeature[]) {
    if (want.delete(k)) notes.push(`${MASS_LABELS[k].name} için en az iki kat gerekir.`);
  }

  const konsol: [MassFeature, Side, number][] = [["on_konsol", "front", cant], ["arka_konsol", "back", cant], ["yan_konsol", "right", Math.min(cant + 0.5, 3)]];
  for (const [k, side, d] of konsol) {
    if (!want.has(k)) continue;
    if (carveSide(ground, side, d) > 0) applied.push(k);
    else notes.push(`${MASS_LABELS[k].name}: zemin kattaki odalar ${d.toFixed(1).replace(".", ",")} m geri çekilince asgari ölçünün ya da istenen alanın altına düşüyor; oturumu büyütün ya da konsolu kısaltın.`);
  }
  if (spec.features.includes("ust_kat_teras") && flat && multi && !applied.includes("ust_kat_teras")) notes.push("Kademeli teras: üst kat bandında teras için yer kalmadı.");
  if (spec.features.includes("kose_oyugu") && flat && !applied.includes("kose_oyugu")) notes.push("Köşe oyuğu: arka bantta avlu için yer kalmadı.");
  if (!strips.size) return { applied, notes };

  // katları yeniden kur: duvarlar, açıklıklar, dış mekânlar
  for (const f of L.floors) {
    const st = strips.get(f);
    if (!st) continue;
    const i = L.floors.indexOf(f);
    const upper = L.floors[i + 1];
    const lower = i > 0 ? L.floors[i - 1] : undefined;
    const covers = (fl: FloorLayout | undefined, r: Rect) => !!fl && floorRects(fl, L).some((q) => inRect(q, r.x + r.w / 2, r.y + r.h / 2));
    for (const s of mergeStrips(st)) {
      const r = s.rect;
      const area = r2(r.w * r.h);
      if (area < 0.5) continue;
      const isLow = f === ground || f.level < hooks.groundLevel;
      if (isLow) {
        const covered = covers(upper, r);
        const kind: CarvedKind = covered ? "sundurma" : "avlu";
        const name = covered ? (s.side === "front" ? "Giriş Sundurması" : s.side === "right" ? "Araç Sundurması" : "Kapalı Teras") : "Avlu";
        f.outdoor.push({ name, area, rect: r, type: covered ? "teras" : "avlu", carved: kind, rails: [] });
      } else if (covers(lower, r)) {
        f.outdoor.push({ name: "Teras", area, rect: r, type: "teras", carved: "teras", rails: [] });
      } else {
        (f.voids ??= []).push(r);
      }
    }
    // oyuğa açılan hol kapısı: teras/avluya cam kapı, boşluğa pencere
    for (const o of f.openings.filter((q) => (q as Opening & { pocket?: boolean }).pocket)) {
      const pt = { x: o.center, y: o.line + 0.1 };
      const out = f.outdoor.find((q) => q.carved && inRect(q.rect, pt.x, pt.y));
      delete (o as Opening & { pocket?: boolean }).pocket;
      if (out) Object.assign(o, { kind: "balconyDoor", width: Math.max(o.width, 1.0), sill: 0, head: 2.2, swing: -1 });
      else Object.assign(o, { kind: "window", sill: 0.9, head: Math.min(L.H - 0.45, 2.2) });
    }
    rebuildFloor(L, f, hooks);
    // teras: en büyük yaşam mekânının teras cephesindeki penceresi kapı olsun
    for (const o of f.outdoor.filter((q) => q.carved === "teras")) {
      const host = f.rooms
        .filter((p) => p.type !== "merdiven" && sharesEdge(p.rect, o.rect))
        .sort((a, b) => livingRank(a) - livingRank(b) || b.rect.w * b.rect.h - a.rect.w * a.rect.h)[0];
      if (!host) continue;
      const e = edgeBetween(host.rect, o.rect);
      if (!e) continue;
      const win = f.openings.find((q) => q.kind === "window" && q.orient === e.orient && near(q.line, e.line) && q.center > e.a && q.center < e.b);
      const width = r2(Math.min(host.type === "salon" ? 2.4 : 1.6, e.b - e.a - 0.5));
      if (width < 0.8) continue;
      if (win) Object.assign(win, { kind: "balconyDoor", sill: 0, head: 2.2, width: Math.max(win.width, width) });
      else f.openings.push({ id: `${f.level}-tk${o.rect.x}`, kind: "balconyDoor", orient: e.orient, line: e.line, center: r2((e.a + e.b) / 2), width, sill: 0, head: 2.2, exterior: true, swing: 1 });
      f.walls = hooks.subtract(f.wallLines, f.openings);
    }
    for (const o of f.outdoor) if (o.carved) o.rails = o.carved === "teras" ? openSides(f, L, o.rect) : [];
  }
  L.massing = { features: applied, notes };
  return { applied, notes };
}

function clampNum(v: number | undefined, lo: number, hi: number, d: number) {
  return Number.isFinite(v) && (v as number) > 0 ? Math.min(hi, Math.max(lo, v as number)) : d;
}

const livingRank = (p: PlacedRoom) => ["salon", "yemek", "ebeveyn", "calisma", "yatak", "cocuk", "misafir", "mutfak"].indexOf(p.type) + 1 || 99;

function sharesEdge(a: Rect, b: Rect) { return !!edgeBetween(a, b); }
function edgeBetween(a: Rect, b: Rect): { orient: "h" | "v"; line: number; a: number; b: number } | null {
  if (near(a.y + a.h, b.y) || near(b.y + b.h, a.y)) {
    const lo = Math.max(a.x, b.x), hi = Math.min(a.x + a.w, b.x + b.w);
    if (hi - lo > 0.6) return { orient: "h", line: near(a.y + a.h, b.y) ? b.y : a.y, a: lo, b: hi };
  }
  if (near(a.x + a.w, b.x) || near(b.x + b.w, a.x)) {
    const lo = Math.max(a.y, b.y), hi = Math.min(a.y + a.h, b.y + b.h);
    if (hi - lo > 0.6) return { orient: "v", line: near(a.x + a.w, b.x) ? b.x : a.x, a: lo, b: hi };
  }
  return null;
}

/** Aynı kenardaki, aynı derinlikteki bitişik şeritleri birleştirir. */
function mergeStrips(st: Strip[]): Strip[] {
  const out: Strip[] = [];
  const list = [...st].sort((a, b) => a.side.localeCompare(b.side) || a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  for (const s of list) {
    const last = out[out.length - 1];
    const r = s.rect, q = last?.rect;
    if (last && last.side === s.side && q) {
      if ((s.side === "front" || s.side === "back") && near(q.y, r.y) && near(q.h, r.h) && near(q.x + q.w, r.x)) { q.w = r2(q.w + r.w); continue; }
      if ((s.side === "left" || s.side === "right") && near(q.x, r.x) && near(q.w, r.w) && near(q.y + q.h, r.y)) { q.h = r2(q.h + r.h); continue; }
    }
    out.push({ ...s, rect: { ...r } });
  }
  return out;
}

/** Oyulan odanın dış kenarındaki açıklıkları yeni kenara taşır; dik kenarlarda oyulan bölgeye düşenleri içeri kaydırır. */
function shiftOpenings(f: FloorLayout, r: PlacedRoom, side: Side, d: number) {
  const R = r.rect;
  const nr = trimmedRect(R, side, d);
  const horiz = side === "front" || side === "back";
  const oldLine = side === "front" ? R.y : side === "back" ? R.y + R.h : side === "left" ? R.x : R.x + R.w;
  const newLine = side === "front" ? nr.y : side === "back" ? nr.y + nr.h : side === "left" ? nr.x : nr.x + nr.w;
  for (const o of f.openings) {
    const onEdge = (horiz ? o.orient === "h" : o.orient === "v") && near(o.line, oldLine)
      && (horiz ? o.center >= R.x - EPS && o.center <= R.x + R.w + EPS : o.center >= R.y - EPS && o.center <= R.y + R.h + EPS);
    if (onEdge) { o.line = r2(newLine); continue; }
    // odanın dik kenarlarındaki (yan) açıklıklar: oyulan bölgeye düşüyorsa kalan kenara sığdır
    const perp = horiz ? o.orient === "v" && (near(o.line, R.x) || near(o.line, R.x + R.w)) && o.center > R.y - EPS && o.center < R.y + R.h + EPS
      : o.orient === "h" && (near(o.line, R.y) || near(o.line, R.y + R.h)) && o.center > R.x - EPS && o.center < R.x + R.w + EPS;
    if (!perp) continue;
    const lo = horiz ? nr.y : nr.x, hi = horiz ? nr.y + nr.h : nr.x + nr.w;
    const half = o.width / 2;
    if (o.center - half < lo + 0.1 || o.center + half > hi - 0.1) {
      const span = hi - lo - 0.2;
      if (span < 0.7) { o.width = 0; continue; }
      o.width = r2(Math.min(o.width, span));
      o.center = r2(Math.min(hi - 0.1 - o.width / 2, Math.max(lo + 0.1 + o.width / 2, o.center)));
    }
  }
  f.openings = f.openings.filter((o) => o.width > 0);
}

/** Duvarları yeni oda dikdörtgenlerinden kurar; açıklıkları duvara oturtur; açıkta kalan yan duvarlara pencere ekler. */
function rebuildFloor(L: BuildingLayout, f: FloorLayout, h: Hooks) {
  const rects = f.rooms.filter((r) => r.type !== "merdiven").map((r) => r.rect);
  const stairRect = f.rooms.find((r) => r.type === "merdiven")?.rect ?? null;
  if (stairRect) rects.push(stairRect);
  let lines = buildFreeWalls(rects, h.ext, h.int);
  lines = h.cutWalls(lines, f.openEdges ?? []);
  // açıklıklar: duvar çizgisine oturmayan ya da dış/iç niteliği değişenleri düzelt
  for (const o of f.openings) {
    // aynı nitelikte (dış/iç) duvar parçası: merkezi içeren, yoksa en yakın
    const cands = lines.filter((w) => w.orient === o.orient && near(w.line, o.line) && w.exterior === o.exterior && w.b - w.a > 0.9);
    const dist = (w: WallPiece) => (o.center >= w.a && o.center <= w.b ? 0 : Math.min(Math.abs(o.center - w.a), Math.abs(o.center - w.b)));
    const host = cands.sort((p, q) => dist(p) - dist(q))[0];
    if (!host || dist(host) > 1.5) { o.width = 0; continue; }
    const a = host.a + (host.exterior ? h.ext / 2 : 0) + 0.1, b = host.b - (host.exterior ? h.ext / 2 : 0) - 0.1;
    if (b - a < 0.7) { o.width = 0; continue; }
    o.width = r2(Math.min(o.width, b - a));
    o.center = r2(Math.min(b - o.width / 2, Math.max(a + o.width / 2, o.center)));
  }
  f.openings = f.openings.filter((o) => o.width > 0);
  // yeni açığa çıkan dış duvarlara pencere (yaşam mekânlarında)
  let k = 0;
  for (const w of lines) {
    if (!w.exterior) continue;
    // yalnız oyma ile açığa çıkan duvarlar (eski cephe çizgileri değil)
    if (w.orient === "h" ? near(w.line, 0) || near(w.line, L.D) : near(w.line, 0) || near(w.line, L.W)) continue;
    const len = w.b - w.a - h.ext;
    if (len < 1.2) continue;
    if (f.openings.some((o) => o.orient === w.orient && near(o.line, w.line) && o.center > w.a && o.center < w.b)) continue;
    const mid = (w.a + w.b) / 2;
    const room = f.rooms.find((r) => r.type !== "merdiven" && (w.orient === "h"
      ? (near(r.rect.y, w.line) || near(r.rect.y + r.rect.h, w.line)) && mid > r.rect.x && mid < r.rect.x + r.rect.w
      : (near(r.rect.x, w.line) || near(r.rect.x + r.rect.w, w.line)) && mid > r.rect.y && mid < r.rect.y + r.rect.h));
    if (!room || livingRank(room) === 99) continue;
    const facing = wallFacing(f, L, w);
    if (!facing) continue;
    const width = r2(Math.min(room.type === "salon" ? 1.8 : 1.2, len - 0.4));
    if (width < 0.6) continue;
    f.openings.push({
      id: `L${f.level}-mp${k++}`, kind: "window", orient: w.orient, line: w.line, center: r2(mid), width,
      sill: room.type === "salon" ? 0.4 : 0.9, head: Math.min(L.H - 0.45, 2.2), exterior: true,
      swing: facing === "front" || facing === "left" ? 1 : -1,
    });
  }
  f.wallLines = lines;
  f.walls = h.subtract(lines, f.openings);
}

/** Terasın korkuluk gereken kenarları (kapalı hacme değmeyen). */
function openSides(f: FloorLayout, L: BuildingLayout, r: Rect): Side[] {
  const rects = floorRects(f, L);
  const inside = (x: number, y: number) => rects.some((q) => inRect(q, x, y));
  const out: Side[] = [];
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  if (!inside(cx, r.y - 0.06)) out.push("front");
  if (!inside(cx, r.y + r.h + 0.06)) out.push("back");
  if (!inside(r.x - 0.06, cy)) out.push("left");
  if (!inside(r.x + r.w + 0.06, cy)) out.push("right");
  return out;
}
