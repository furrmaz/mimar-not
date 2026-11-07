// Bina programından deterministik yerleşim üretir.
// Koordinatlar metre. x: sokak cephesi boyunca (0 → W), y: derinlik (0 = ön cephe → D = arka cephe).
// Her katta üç bant vardır: ön bant (gündüz mekânları), orta bant (hol + merdiven), arka bant (gece mekânları).
// Orta bant tüm katlarda aynı yerde olduğu için merdiven katlar arasında üst üste gelir.

import type { Adjacency, DesignOptions, Program, Room, RoomType, Zone } from "../shared/schema";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedRoom {
  id: string;
  name: string;
  type: RoomType | "merdiven";
  zone: Zone;
  requestedArea: number;
  rect: Rect;
  band: "front" | "hall" | "back";
}

export type OpeningKind = "door" | "window" | "entrance" | "balconyDoor";

export interface Opening {
  id: string;
  kind: OpeningKind;
  orient: "h" | "v"; // h: y sabit olan duvarda, v: x sabit olan duvarda
  line: number; // duvar çizgisinin koordinatı (h → y, v → x)
  center: number; // duvar boyunca merkez (h → x, v → y)
  width: number;
  sill: number; // döşemeden denizlik yüksekliği
  head: number; // döşemeden lento yüksekliği
  exterior: boolean;
  /** Kapı kanadının açıldığı taraf: duvar çizgisine dik eksende +1 ya da -1 */
  swing: 1 | -1;
}

export interface WallPiece {
  orient: "h" | "v";
  line: number;
  a: number; // başlangıç (duvar boyunca)
  b: number; // bitiş
  thickness: number;
  exterior: boolean;
}

export interface FloorLayout {
  level: number;
  name: string;
  z: number; // döşeme üst kotu (m), zemin kat = 0
  rooms: PlacedRoom[];
  openings: Opening[];
  walls: WallPiece[]; // açıklıklar düşülmüş duvar parçaları
  wallLines: WallPiece[]; // açıklıksız tam duvar çizgileri
  outdoor: { name: string; area: number; rect: Rect; type: string }[];
  /** Sürüklenebilir sütun sınırları (iç sınırların x değerleri) */
  cols: { band: "front" | "back"; key: string; xs: number[] }[];
}

export interface BuildingLayout {
  W: number;
  D: number;
  H: number; // kat yüksekliği
  slab: number;
  extWall: number;
  intWall: number;
  roof: Program["roof"];
  stair: Rect | null;
  hallBand: { y: number; h: number };
  floors: FloorLayout[];
  cutX: number; // A-A kesit hattı (x = sabit)
  totalHeight: number; // en üst döşeme üstü + çatı hariç
  roofHeight: number;
  variant: number;
  /** Açık otopark: binaya bağlanmaz, vaziyet planında ön bahçede gösterilir */
  parking: { name: string; area: number; cars: number }[];
}

/** Açık otopark / araç park yeri (bina oturumuna ve kat planına girmez). */
export function isParking(r: Room) {
  return (r.zone === "dis" || r.type === "balkon" || r.type === "teras" || r.type === "diger") && /otopark|park yeri|araç park|carport/i.test(`${r.name} ${r.note}`)
    || (r.type === "garaj" && r.zone === "dis");
}

export const VARIANTS = [
  { id: 0, name: "A · Gündüz sokak tarafında", short: "A" },
  { id: 1, name: "B · Gündüz bahçe tarafında", short: "B" },
  { id: 2, name: "C · Oda sırası ters", short: "C" },
];

const EXT = 0.25;
const INT = 0.12;
const SLAB = 0.2;
const EPS = 1e-6;

const FRONT_ORDER: Partial<Record<RoomType, number>> = {
  antre: 10, salon: 1, yemek: 2, mutfak: 3, kiler: 4, calisma: 5, ofis: 5, misafir: 6, magaza: 1, garaj: 7,
};
const BACK_ORDER: Partial<Record<RoomType, number>> = {
  ebeveyn: 0, giyinme: 1, banyo: 2, yatak: 3, cocuk: 4, wc: 5, camasir: 6, depo: 7, teknik: 8,
};
const MIN_WIDTH: Partial<Record<RoomType, number>> = {
  wc: 1.3, banyo: 1.9, camasir: 1.6, depo: 1.4, kiler: 1.3, teknik: 1.5, giyinme: 1.8, antre: 2.0,
  mutfak: 2.6, salon: 3.6, garaj: 3.0, ebeveyn: 3.2, yatak: 2.8, cocuk: 2.8,
};
const WET: RoomType[] = ["banyo", "wc", "camasir"];
const SMALL_OK: RoomType[] = ["banyo", "wc", "camasir", "depo", "kiler", "teknik", "giyinme"];

export function buildLayout(program: Program, design: DesignOptions = program.design ?? {}): BuildingLayout {
  const variant = design.variant ?? 0;
  const W = round2(program.footprint.width);
  const D = round2(program.footprint.depth);
  const H = program.floorHeight;
  const multi = program.floors.length > 1;

  const hallDepth = multi ? 2.4 : Math.min(1.5, D * 0.18);
  const adj = program.adjacencies ?? [];
  const parking = program.floors.flatMap((f) => f.rooms.filter(isParking)).map((r) => {
    const m = /(\d+)\s*(araç|araba|otomobil)/i.exec(`${r.name} ${r.note}`);
    return { name: r.name, area: r.area, cars: Math.max(1, Math.min(6, m ? +m[1] : Math.round(r.area / 12.5))) };
  });
  const assignments = program.floors.map((f) =>
    assignBands(f.rooms.filter((r) => !isParking(r)), { flip: variant === 1, reverse: variant === 2, adj: adj.filter((a) => hasRoom(f.rooms, a.a) && hasRoom(f.rooms, a.b)) }),
  );
  // Ön bant derinliği tüm katlarda ortak (merdiven hizası için); katların alan paylarının ortalamasından
  const shares = assignments
    .map((a) => ({ f: sumArea(a.front), b: sumArea(a.back) }))
    .filter((s) => s.f + s.b > 0)
    .map((s) => s.f / (s.f + s.b));
  const share = shares.length ? shares.reduce((s, v) => s + v, 0) / shares.length : 0.5;
  let frontDepth = round2((D - hallDepth) * Math.min(0.62, Math.max(0.38, share)));
  if (design.frontDepth != null) frontDepth = round2(Math.min(D - hallDepth - 2, Math.max(2, design.frontDepth)));
  const hallBand = { y: frontDepth, h: hallDepth };
  const stairW = multi ? Math.min(3.2, W * 0.32) : 0;
  const stair: Rect | null = multi ? { x: 0, y: hallBand.y, w: stairW, h: hallDepth } : null;

  const floors: FloorLayout[] = program.floors.map((f, i) =>
    layoutFloor(f.level, f.name, assignments[i], { W, D, hallBand, stair, isGround: f.level === program.floors[0].level, H, cols: design.cols ?? {} }),
  );

  // Kesit hattı: ön ve arka cephedeki pencerelerden en çoğunu kesen x (merdiven dışında)
  const candidates = floors.flatMap((f) => f.openings.filter((o) => o.orient === "h" && o.exterior).map((o) => o.center));
  let cutX = round2(stairW + (W - stairW) * 0.5);
  let best = -1;
  for (const c of candidates) {
    if (c < stairW + 0.3) continue;
    const hits = floors.reduce(
      (s, f) => s + f.openings.filter((o) => o.orient === "h" && Math.abs(o.center - c) < o.width / 2 - 0.05).length,
      0,
    );
    const score = hits - Math.abs(c - W / 2) / W; // eşitlikte ortaya yakın olan
    if (score > best) { best = score; cutX = round2(c); }
  }
  const topFloor = program.floors[program.floors.length - 1]?.level ?? 0;
  const totalHeight = (topFloor + 1) * H;
  const roofHeight = program.roof === "duz" ? 0.9 : round2(Math.min(W, D) * 0.5 * 0.4 + 0.3);

  return {
    W, D, H, slab: SLAB, extWall: EXT, intWall: INT, roof: program.roof, stair, hallBand,
    floors, cutX, totalHeight, roofHeight, variant, parking,
  };
}

interface Ctx {
  W: number;
  D: number;
  H: number;
  hallBand: { y: number; h: number };
  stair: Rect | null;
  isGround: boolean;
  cols: Record<string, number[]>;
}

interface Assignment {
  front: Room[];
  back: Room[];
  hallRooms: Room[];
  outdoorRooms: Room[];
}

const sumArea = (a: Room[]) => a.reduce((s, r) => s + r.area, 0);

/** Odaları ön/arka banda dağıtır. */
export function hasRoom(rooms: { name: string }[], name: string) {
  return rooms.some((r) => sameName(r.name, name));
}
export function sameName(a: string, b: string) {
  return a.trim().toLocaleLowerCase("tr") === b.trim().toLocaleLowerCase("tr");
}

export function assignBands(rooms: Room[], opts: { flip?: boolean; reverse?: boolean; adj?: Adjacency[] } = {}): Assignment {
  const adj = opts.adj ?? [];
  const near2 = adj.filter((a) => a.relation === "bitisik");
  const partners = (r: Room) => near2.flatMap((a) => (sameName(a.a, r.name) ? [a.b] : sameName(a.b, r.name) ? [a.a] : []));
  const indoor = rooms.filter((r) => r.zone !== "dis" && r.type !== "balkon" && r.type !== "teras");
  const outdoorRooms = rooms.filter((r) => !indoor.includes(r));
  const hallRooms = indoor.filter((r) => r.type === "hol" || r.type === "koridor");
  const banded = indoor.filter((r) => !hallRooms.includes(r));

  let front: Room[] = [];
  let back: Room[] = [];
  const flexible: Room[] = [];
  for (const r of banded) {
    const street = r.type === "antre" || r.type === "garaj" || r.type === "magaza";
    if (street) front.push(r);
    else if (r.zone === "gunduz") (opts.flip ? back : front).push(r);
    else if (r.zone === "gece") (opts.flip ? front : back).push(r);
    else flexible.push(r);
  }
  flexible.sort((a, b) => b.area - a.area);
  for (const r of flexible) {
    const ps = partners(r);
    if (ps.some((n) => hasRoom(front, n))) front.push(r);
    else if (ps.some((n) => hasRoom(back, n))) back.push(r);
    else (sumArea(front) <= sumArea(back) ? front : back).push(r);
  }

  // Bantlar çok dengesizse (biri toplamın %30'undan azsa) alana göre yeniden dengele
  const tot = sumArea(front) + sumArea(back);
  if (banded.length >= 2 && Math.min(sumArea(front), sumArea(back)) < tot * 0.3) {
    // Ebeveyn odası, giyinmesi ve banyosu birlikte kalsın
    const all = [...front, ...back];
    // Birlikte kalması gereken gruplar: ebeveyn süiti + "bitişik" istenen odalar
    const isSuite = (r: Room) => /ebeveyn/i.test(r.name) || r.type === "ebeveyn" || r.type === "giyinme";
    const group = new Map<Room, Room[]>();
    const join = (a: Room, b: Room) => {
      const ga = group.get(a) ?? [a], gb = group.get(b) ?? [b];
      if (ga === gb) return;
      const g = [...ga, ...gb.filter((x) => !ga.includes(x))];
      for (const x of g) group.set(x, g);
    };
    const suite = all.filter(isSuite);
    for (let i = 1; i < suite.length; i++) join(suite[0], suite[i]);
    for (const r of all) for (const n of partners(r)) { const o = all.find((x) => sameName(x.name, n)); if (o) join(r, o); }
    const half = sumArea(all) * 0.62;
    const units: Room[][] = [];
    const seen = new Set<Room>();
    for (const r of all) {
      if (seen.has(r)) continue;
      const g = group.get(r) ?? [r];
      g.forEach((x) => seen.add(x));
      if (sumArea(g) > half) units.push(...g.map((x) => [x])); // çok büyük grup bantları bozmasın
      else units.push(g);
    }
    units.sort((a, b) => sumArea(b) - sumArea(a));
    front = [];
    back = [];
    const dayBand = opts.flip ? back : front;
    const nightBand = opts.flip ? front : back;
    const cap = tot * 0.6;
    for (const u of units) {
      const ps = u.flatMap(partners);
      const pref = ps.some((n) => hasRoom(front, n)) ? front : ps.some((n) => hasRoom(back, n)) ? back : null;
      const natural = u.some((r) => r.zone === "gunduz") ? dayBand : u.some((r) => r.zone === "gece") ? nightBand : null;
      const smaller = sumArea(front) <= sumArea(back) ? front : back;
      let target = smaller;
      if (pref && sumArea(pref) + sumArea(u) <= cap) target = pref;
      else if (natural && sumArea(front) === sumArea(back)) target = natural;
      target.push(...u);
    }
    // antre/garaj sokak tarafında olsun
    for (const t of ["antre", "garaj"] as RoomType[]) {
      const i = back.findIndex((r) => r.type === t);
      if (i >= 0) front.push(...back.splice(i, 1));
    }
  }
  const fo = (r: Room) => FRONT_ORDER[r.type] ?? (opts.flip ? BACK_ORDER[r.type] : undefined) ?? 9;
  const bo = (r: Room) => BACK_ORDER[r.type] ?? (opts.flip ? FRONT_ORDER[r.type] : undefined) ?? 9;
  front.sort((a, b) => fo(a) - fo(b));
  back.sort((a, b) => bo(a) - bo(b));
  if (opts.reverse) { front.reverse(); back.reverse(); }
  // Komşuluk istekleri: "bitişik" çiftleri yan yana getir, "uzak" çiftleri ayır
  for (const band of [front, back]) {
    for (const a of adj) {
      const i = band.findIndex((r) => sameName(r.name, a.a));
      const j = band.findIndex((r) => sameName(r.name, a.b));
      if (i < 0 || j < 0) continue;
      if (a.relation === "bitisik" && Math.abs(i - j) > 1) {
        const [b] = band.splice(j, 1);
        const ni = band.findIndex((r) => sameName(r.name, a.a));
        band.splice(ni + 1, 0, b);
      } else if (a.relation === "uzak" && Math.abs(i - j) <= 1 && band.length > 2) {
        const [b] = band.splice(j, 1);
        const ni = band.findIndex((r) => sameName(r.name, a.a));
        if (ni < band.length / 2) band.push(b); else band.unshift(b);
      }
    }
  }
  // Merdivenin önü/arkası holle temas etmez; ilk sütuna küçük oda gelmesin
  for (const band of [front, back]) {
    if (band.length > 1 && SMALL_OK.includes(band[0].type)) {
      let bi = 0;
      band.forEach((r, i) => { if (r.area > band[bi].area) bi = i; });
      band.unshift(...band.splice(bi, 1));
    }
  }
  return { front, back, hallRooms, outdoorRooms };
}

function layoutFloor(level: number, name: string, asg: Assignment, ctx: Ctx): FloorLayout {
  const { W, D, hallBand, stair } = ctx;
  const { front, back, hallRooms, outdoorRooms } = asg;
  const sum = sumArea;

  const placed: PlacedRoom[] = [];
  const cols: FloorLayout["cols"] = [];
  const colSpec = (band: "front" | "back") => {
    const key = `${level}-${band}`;
    const entry = { band, key, xs: [] as number[] };
    cols.push(entry);
    return { override: ctx.cols[key], report: (xs: number[]) => (entry.xs = xs) };
  };
  let uid = 0;
  const id = (p: string) => `L${level}-${p}${uid++}`;

  const frontRect: Rect = { x: 0, y: 0, w: W, h: hallBand.y };
  const backRect: Rect = { x: 0, y: hallBand.y + hallBand.h, w: W, h: D - hallBand.y - hallBand.h };

  // Tek bant doluysa diğer bantı da kullan (ör. tek odalı garaj katı)
  if (front.length && !back.length) {
    placeBand(front, { x: 0, y: 0, w: W, h: hallBand.y }, "front", placed, id, hallBand.y, colSpec("front"));
    placed.push(fillerRoom("Depo / Boş Alan", backRect, "back", id));
  } else if (!front.length && back.length) {
    placeBand(back, backRect, "back", placed, id, backRect.y, colSpec("back"));
    placed.push(fillerRoom("Boş Alan", frontRect, "front", id));
  } else if (front.length && back.length) {
    placeBand(front, frontRect, "front", placed, id, hallBand.y, colSpec("front"));
    placeBand(back, backRect, "back", placed, id, backRect.y, colSpec("back"));
  }

  // Hol + merdiven
  const hallName = hallRooms[0]?.name ?? (ctx.isGround ? "Hol" : "Kat Holü");
  const hallReq = sum(hallRooms);
  const hallX = stair ? stair.w : 0;
  const hall: PlacedRoom = {
    id: id("hol"), name: hallName, type: "hol", zone: "sirkulasyon", requestedArea: hallReq,
    rect: { x: hallX, y: hallBand.y, w: W - hallX, h: hallBand.h }, band: "hall",
  };
  placed.push(hall);
  if (stair) {
    placed.push({
      id: id("mrd"), name: "Merdiven", type: "merdiven", zone: "sirkulasyon", requestedArea: 0,
      rect: { ...stair }, band: "hall",
    });
  }

  // Açıklıklar
  const openings = makeOpenings(placed, ctx, id);

  // Dış mekânlar (balkon/teras): arka cepheye, bir yaşam mekânının önüne çıkma olarak
  const hostPref = (p: PlacedRoom) =>
    ["salon", "ebeveyn", "yatak", "cocuk", "yemek", "misafir", "calisma", "mutfak"].indexOf(p.type) >= 0 ? 0 : 1;
  const hosts = placed
    .filter((p) => p.band === "back" && near(p.rect.y + p.rect.h, D))
    .sort((a, b) => hostPref(a) - hostPref(b) || b.rect.w - a.rect.w);
  const host = outdoorRooms.length ? hosts[0] : undefined;
  // Arka cephe boyunca yan yana; sığmayan bir sonraki sıraya
  let rowY = D, rowX = 0, rowDepth = 0;
  const sized = outdoorRooms.map((r) => {
    const big = r.type === "teras" || r.area > 12;
    const depth = big ? Math.min(3.5, Math.max(2, r.area / W)) : 1.6;
    const w = Math.min(W, Math.max(2, r.area / depth));
    return { r, depth, w: round2(w) };
  });
  const totalW = sized.reduce((s, o) => s + o.w, 0);
  const cx = host ? host.rect.x + host.rect.w / 2 : W / 2;
  const startX = sized.length === 1 ? Math.min(W - sized[0].w, Math.max(0, cx - sized[0].w / 2)) : totalW <= W ? Math.min(W - totalW, Math.max(0, cx - totalW / 2)) : 0;
  rowX = startX;
  const outdoor = sized.map(({ r, depth, w }) => {
    if (rowX + w > W + 0.01) { rowY += rowDepth; rowX = 0; rowDepth = 0; }
    const rect = { x: round2(rowX), y: rowY, w, h: round2(depth) };
    rowX += w;
    rowDepth = Math.max(rowDepth, depth);
    return { name: r.name, area: r.area, type: r.type, rect };
  });
  // Balkona açılan kapı
  if (outdoor.length) {
    if (host) {
      // aynı duvardaki pencereyi kaldır, balkon kapısı koy
      for (let i = openings.length - 1; i >= 0; i--) {
        const o = openings[i];
        if (o.orient === "h" && near(o.line, D) && o.center >= host.rect.x && o.center <= host.rect.x + host.rect.w && o.kind === "window") openings.splice(i, 1);
      }
      openings.push({
        id: id("bk"), kind: "balconyDoor", orient: "h", line: D, center: host.rect.x + host.rect.w / 2,
        width: Math.min(1.8, host.rect.w - 0.6), sill: 0, head: 2.2, exterior: true, swing: -1,
      });
    }
  }

  // Duvarlar: hol ve merdiven tek bir bant olarak (aralarında duvar yok)
  const wallRooms: PlacedRoom[] = [
    ...placed.filter((p) => p.band !== "hall"),
    { ...hall, id: "band", rect: { x: 0, y: hallBand.y, w: W, h: hallBand.h } },
  ];
  const wallLines = buildWallLines(wallRooms, W, D);
  const walls = subtractOpenings(wallLines, openings);

  return { level, name, z: level * ctx.H, rooms: placed, openings, walls, wallLines, outdoor, cols };
}

function fillerRoom(name: string, rect: Rect, band: PlacedRoom["band"], id: (p: string) => string): PlacedRoom {
  return { id: id("bos"), name, type: "diger", zone: "servis", requestedArea: 0, rect, band };
}

/**
 * Odaları bant içinde sütunlar halinde dizer. Sütun genişliği alanla orantılıdır.
 * Çok dar kalacak küçük odalar (wc, banyo, depo...) ikişerli üst üste aynı sütuna konur.
 * hallEdgeY: bantın hole bakan kenarının y koordinatı.
 */
function placeBand(
  rooms: Room[],
  band: Rect,
  bandName: "front" | "back",
  out: PlacedRoom[],
  id: (p: string) => string,
  hallEdgeY: number,
  spec?: { override?: number[]; report: (xs: number[]) => void },
) {
  const total = rooms.reduce((s, r) => s + r.area, 0);
  const scale = (band.w * band.h) / total;
  type Col = { rooms: Room[]; area: number };
  const cols: Col[] = [];
  const minW = 2.2;
  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i];
    const w = (r.area * scale) / band.h;
    const next = rooms[i + 1];
    if (w < minW && SMALL_OK.includes(r.type) && next && SMALL_OK.includes(next.type) && (next.area * scale) / band.h < minW * 1.4) {
      cols.push({ rooms: [r, next], area: r.area + next.area });
      i++;
    } else {
      cols.push({ rooms: [r], area: r.area });
    }
  }
  // Sütun genişlikleri: alanla orantılı, ama oda tipine göre asgari genişlik korunur
  const minFor = (c: Col) =>
    c.rooms.length > 1 ? 1.6 : (MIN_WIDTH[c.rooms[0].type] ?? 2.6);
  let widths = cols.map((c) => (c.area * scale) / band.h);
  for (let iter = 0; iter < 5; iter++) {
    const fixed = widths.map((w, i) => w < minFor(cols[i]));
    const fixedSum = widths.reduce((s, w, i) => s + (fixed[i] ? minFor(cols[i]) : 0), 0);
    const freeSum = widths.reduce((s, w, i) => s + (fixed[i] ? 0 : w), 0);
    if (!fixed.some(Boolean) || freeSum <= 0 || fixedSum >= band.w) break;
    const k = (band.w - fixedSum) / freeSum;
    widths = widths.map((w, i) => (fixed[i] ? minFor(cols[i]) : w * k));
  }
  const wsum = widths.reduce((s, w) => s + w, 0);
  widths = widths.map((w) => (w * band.w) / wsum);
  // Mimarın sürükleyerek verdiği sınırlar (sütun sayısı tutuyorsa)
  const ov = spec?.override;
  if (ov && ov.length === cols.length - 1) {
    const xs = [band.x, ...ov.map((v) => Math.min(band.x + band.w - 0.8, Math.max(band.x + 0.8, v))), band.x + band.w];
    const ok = xs.every((v, i) => i === 0 || v - xs[i - 1] >= 0.8);
    if (ok) widths = xs.slice(1).map((v, i) => v - xs[i]);
  }
  let x = band.x;
  const bounds: number[] = [];
  cols.forEach((c, ci) => {
    const w = ci === cols.length - 1 ? round2(band.x + band.w - x) : round2(widths[ci]);
    if (c.rooms.length === 1) {
      const r = c.rooms[0];
      out.push(mk(r, { x, y: band.y, w, h: band.h }));
    } else {
      // Hole bakan tarafa kendi kapısı holden açılacak oda gelsin; süit odaları (ebeveyn banyosu, giyinme) içeride kalır
      const ensuite = (r: Room) => r.type === "giyinme" || (r.type === "banyo" && /ebeveyn/i.test(r.name));
      const [a, b] = ensuite(c.rooms[0]) && !ensuite(c.rooms[1]) ? [c.rooms[1], c.rooms[0]] : c.rooms;
      const ha = round2((band.h * a.area) / c.area);
      // a hole bakan tarafta
      const hallSideTop = near(hallEdgeY, band.y); // arka bant: hol kenarı üstte (y küçük)
      if (hallSideTop) {
        out.push(mk(a, { x, y: band.y, w, h: ha }));
        out.push(mk(b, { x, y: band.y + ha, w, h: band.h - ha }));
      } else {
        out.push(mk(a, { x, y: band.y + band.h - ha, w, h: ha }));
        out.push(mk(b, { x, y: band.y, w, h: band.h - ha }));
      }
    }
    x = round2(x + w);
    if (ci < cols.length - 1) bounds.push(x);
  });
  spec?.report(bounds);

  function mk(r: Room, rect: Rect): PlacedRoom {
    return { id: id(r.type), name: r.name, type: r.type, zone: r.zone, requestedArea: r.area, rect, band: bandName };
  }
}

function makeOpenings(rooms: PlacedRoom[], ctx: Ctx, id: (p: string) => string): Opening[] {
  const { W, D, stair, hallBand } = ctx;
  const ops: Opening[] = [];
  const hall = rooms.find((r) => r.type === "hol")!;
  const hallSpan: [number, number] = [hall.rect.x, hall.rect.x + hall.rect.w];

  const banded = rooms.filter((r) => r.band !== "hall");
  const doorWidth = (r: PlacedRoom) => (WET.includes(r.type as RoomType) || r.type === "depo" || r.type === "kiler" ? 0.8 : r.type === "garaj" ? 2.6 : 0.9);

  const doored = new Set<string>();
  // 1) Hole komşu odalar: hol kenarına kapı
  for (const r of banded) {
    const edgeY = r.band === "front" ? r.rect.y + r.rect.h : r.rect.y;
    const touchesHall = r.band === "front" ? near(edgeY, hallBand.y) : near(edgeY, hallBand.y + hallBand.h);
    if (!touchesHall) continue;
    const lo = Math.max(r.rect.x, hallSpan[0]);
    const hi = Math.min(r.rect.x + r.rect.w, hallSpan[1]);
    const dw = doorWidth(r);
    if (r.type === "garaj") continue; // garaj kapısı dış cepheden
    if (r.type === "giyinme" || (r.type === "banyo" && /ebeveyn/i.test(r.name))) continue; // ebeveyn odasından girilir
    if (hi - lo < dw + 0.3) continue;
    // Kapıyı odanın köşesine yakın koy (mobilya için duvar bırak)
    const center = hi - lo > dw + 1.2 ? lo + 0.15 + dw / 2 + 0.1 : (lo + hi) / 2;
    ops.push({
      id: id("k"), kind: "door", orient: "h", line: edgeY, center, width: dw, sill: 0, head: 2.1, exterior: false,
      swing: r.band === "front" ? -1 : 1,
    });
    doored.add(r.id);
  }
  // 2) Holle teması olmayan odalar: en uygun komşuya kapı
  for (const r of banded) {
    if (doored.has(r.id) || r.type === "garaj") continue;
    const neighbours = banded
      .filter((n) => n.id !== r.id)
      .map((n) => ({ n, e: sharedEdge(r.rect, n.rect) }))
      .filter((x) => x.e && x.e.len >= doorWidth(r) + 0.2) as { n: PlacedRoom; e: SharedEdge }[];
    if (!neighbours.length) continue;
    const pref = (n: PlacedRoom) => {
      if (WET.includes(r.type as RoomType) || r.type === "giyinme") return n.type === "ebeveyn" || n.type === "yatak" ? 0 : doored.has(n.id) ? 1 : 2;
      if (r.type === "kiler") return n.type === "mutfak" ? 0 : 2;
      if (r.type === "mutfak" || r.type === "yemek") return n.type === "salon" || n.type === "yemek" ? 0 : 2;
      return doored.has(n.id) ? (n.zone === r.zone ? 0 : 1) : 3;
    };
    neighbours.sort((a, b) => pref(a.n) - pref(b.n) || b.e.len - a.e.len);
    const { e } = neighbours[0];
    const dw = doorWidth(r);
    ops.push({
      id: id("k"), kind: "door", orient: e.orient, line: e.line, center: e.a + 0.15 + dw / 2 + 0.05, width: dw, sill: 0, head: 2.1,
      exterior: false, swing: e.orient === "h" ? (r.rect.y < e.line ? -1 : 1) : r.rect.x < e.line ? -1 : 1,
    });
    doored.add(r.id);
  }

  // 3) Pencereler (dış cephe kenarları)
  for (const r of banded) {
    if (r.name.startsWith("Boş") || r.name.startsWith("Depo / Boş")) continue;
    const isWet = WET.includes(r.type as RoomType) || r.type === "depo" || r.type === "kiler" || r.type === "teknik";
    const winFor = (len: number) =>
      isWet ? { w: Math.min(0.7, len - 0.4), sill: 1.5, head: 2.1 } :
      r.type === "salon" ? { w: Math.min(3.2, len * 0.6), sill: 0.5, head: 2.2 } :
      { w: Math.min(2.0, len * 0.5), sill: 0.9, head: 2.2 };
    const edges: { orient: "h" | "v"; line: number; a: number; b: number; swing: 1 | -1 }[] = [];
    if (near(r.rect.y, 0)) edges.push({ orient: "h", line: 0, a: r.rect.x, b: r.rect.x + r.rect.w, swing: 1 });
    if (near(r.rect.y + r.rect.h, D)) edges.push({ orient: "h", line: D, a: r.rect.x, b: r.rect.x + r.rect.w, swing: -1 });
    const primary = edges.length;
    if (near(r.rect.x, 0)) edges.push({ orient: "v", line: 0, a: r.rect.y, b: r.rect.y + r.rect.h, swing: 1 });
    if (near(r.rect.x + r.rect.w, W)) edges.push({ orient: "v", line: W, a: r.rect.y, b: r.rect.y + r.rect.h, swing: -1 });
    edges.forEach((e, i) => {
      const len = e.b - e.a;
      if (len < 1.2) return;
      // yan cephede pencere: sadece cephe kenarı yoksa ya da yaşam mekânıysa
      if (i >= primary && primary > 0 && isWet) return;
      const spec = winFor(len);
      if (spec.w < 0.5) return;
      // garaj ön cephe: garaj kapısı
      if (r.type === "garaj" && e.orient === "h" && e.line === 0) {
        ops.push({ id: id("gk"), kind: "entrance", orient: "h", line: 0, center: (e.a + e.b) / 2, width: Math.min(2.8, len - 0.6), sill: 0, head: 2.3, exterior: true, swing: 1 });
        return;
      }
      // antre ön cephe: giriş kapısı
      if (ctx.isGround && r.type === "antre" && e.orient === "h" && e.line === 0) {
        ops.push({ id: id("gr"), kind: "entrance", orient: "h", line: 0, center: (e.a + e.b) / 2, width: 1.0, sill: 0, head: 2.2, exterior: true, swing: 1 });
        return;
      }
      ops.push({ id: id("p"), kind: "window", orient: e.orient, line: e.line, center: (e.a + e.b) / 2, width: round2(spec.w), sill: spec.sill, head: spec.head, exterior: true, swing: e.swing });
    });
  }

  // 4) Giriş kapısı: antre yoksa hol bandının sağ cephesinden
  if (ctx.isGround && !ops.some((o) => o.kind === "entrance" && o.width < 2)) {
    ops.push({ id: id("gr"), kind: "entrance", orient: "v", line: W, center: hallBand.y + hallBand.h / 2, width: 1.0, sill: 0, head: 2.2, exterior: true, swing: -1 });
  }
  // 5) Merdiven penceresi
  if (stair) {
    ops.push({ id: id("mp"), kind: "window", orient: "v", line: 0, center: stair.y + stair.h / 2, width: Math.min(1.2, stair.h - 0.6), sill: 1.2, head: 2.2, exterior: true, swing: 1 });
  }
  return ops;
}

interface SharedEdge { orient: "h" | "v"; line: number; a: number; b: number; len: number }

function sharedEdge(r: Rect, n: Rect): SharedEdge | null {
  // dikey ortak kenar
  for (const [x1, x2] of [[r.x + r.w, n.x], [r.x, n.x + n.w]]) {
    if (near(x1, x2)) {
      const a = Math.max(r.y, n.y), b = Math.min(r.y + r.h, n.y + n.h);
      if (b - a > EPS) return { orient: "v", line: x1, a, b, len: b - a };
    }
  }
  for (const [y1, y2] of [[r.y + r.h, n.y], [r.y, n.y + n.h]]) {
    if (near(y1, y2)) {
      const a = Math.max(r.x, n.x), b = Math.min(r.x + r.w, n.x + n.w);
      if (b - a > EPS) return { orient: "h", line: y1, a, b, len: b - a };
    }
  }
  return null;
}

/** Oda dikdörtgenlerinin kenarlarından birleşik duvar çizgileri üretir. */
function buildWallLines(rooms: PlacedRoom[], W: number, D: number): WallPiece[] {
  const lines = new Map<string, { orient: "h" | "v"; line: number; iv: [number, number][] }>();
  const add = (orient: "h" | "v", line: number, a: number, b: number) => {
    const key = `${orient}:${line.toFixed(3)}`;
    if (!lines.has(key)) lines.set(key, { orient, line, iv: [] });
    lines.get(key)!.iv.push([Math.min(a, b), Math.max(a, b)]);
  };
  for (const r of rooms) {
    const { x, y, w, h } = r.rect;
    add("h", y, x, x + w);
    add("h", y + h, x, x + w);
    add("v", x, y, y + h);
    add("v", x + w, y, y + h);
  }
  const out: WallPiece[] = [];
  for (const { orient, line, iv } of lines.values()) {
    iv.sort((p, q) => p[0] - q[0]);
    const merged: [number, number][] = [];
    for (const s of iv) {
      const last = merged[merged.length - 1];
      if (last && s[0] <= last[1] + EPS) last[1] = Math.max(last[1], s[1]);
      else merged.push([...s]);
    }
    const exterior = orient === "h" ? near(line, 0) || near(line, D) : near(line, 0) || near(line, W);
    for (const [a, b] of merged) out.push({ orient, line, a, b, thickness: exterior ? EXT : INT, exterior });
  }
  // Dış duvar köşelerini kapatmak için dış duvarları yarım kalınlık uzat
  for (const p of out) if (p.exterior) { p.a -= EXT / 2; p.b += EXT / 2; }
  return out;
}

/** Duvar çizgilerinden kapı/pencere aralıklarını çıkarır. */
export function subtractOpenings(lines: WallPiece[], ops: Opening[]): WallPiece[] {
  const out: WallPiece[] = [];
  for (const l of lines) {
    const cuts = ops
      .filter((o) => o.orient === l.orient && near(o.line, l.line) && o.center > l.a && o.center < l.b)
      .map((o) => [o.center - o.width / 2, o.center + o.width / 2] as [number, number])
      .sort((p, q) => p[0] - q[0]);
    let start = l.a;
    for (const [c0, c1] of cuts) {
      if (c0 - start > EPS) out.push({ ...l, a: start, b: c0 });
      start = Math.max(start, c1);
    }
    if (l.b - start > EPS) out.push({ ...l, a: start, b: l.b });
  }
  return out;
}

export function near(a: number, b: number, tol = 0.01) {
  return Math.abs(a - b) < tol;
}
export function round2(v: number) {
  return Math.round(v * 100) / 100;
}
export function rectArea(r: Rect) {
  return r.w * r.h;
}

export const ZONE_COLORS: Record<string, string> = {
  gunduz: "#f6e7c8",
  gece: "#d9e6f5",
  servis: "#e3eedb",
  sirkulasyon: "#efefef",
  dis: "#e8f3e8",
};
