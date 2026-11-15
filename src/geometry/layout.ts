// Bina programından deterministik yerleşim üretir.
// Koordinatlar metre. x: sokak cephesi boyunca (0 → W), y: derinlik (0 = ön cephe → D = arka cephe).
// Her katta üç bant vardır: ön bant (gündüz mekânları), orta bant (hol + merdiven), arka bant (gece mekânları).
// Orta bant tüm katlarda aynı yerde olduğu için merdiven katlar arasında üst üste gelir.

import type { Adjacency, DesignOptions, Program, Room, RoomType, Zone } from "../shared/schema";
import type { ApFloor, UnitSlot } from "./blocks";
import { legacyStairInfo, stairCalc, type StairInfo } from "./stair";

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
  /** Apartmanda ait olduğu daire */
  unit?: string;
}

/** passage: kanatsız geçiş (açık plan, salona geniş giriş) */
export type OpeningKind = "door" | "window" | "entrance" | "balconyDoor" | "passage";

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
  /** Dubleks dairelerin iç merdivenleri */
  stairs?: Rect[];
  /** Apartman katında daireler */
  units?: { label: string; type: string; part: UnitSlot["part"]; rect: Rect; area: number }[];
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
  /** Apartman bloğunda asansör kuyusu */
  elevator?: Rect | null;
  apartment?: boolean;
  /** Merdiven hesabı ve yönü (yoksa eski hol bandı merdiveni) */
  stairInfo?: StairInfo;
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
  antre: -1, garaj: -0.5, wc: 0.5, calisma: 1, ofis: 1, misafir: 1.5, magaza: 2, salon: 3, yemek: 4, kiler: 4.5, mutfak: 5,
};
const BACK_ORDER: Partial<Record<RoomType, number>> = {
  ebeveyn: 0, giyinme: 1, banyo: 2, wc: 2.5, yatak: 3, cocuk: 4, camasir: 6, depo: 7, teknik: 8,
};
const MIN_WIDTH: Partial<Record<RoomType, number>> = {
  wc: 1.3, banyo: 1.9, camasir: 1.6, depo: 1.4, kiler: 1.3, teknik: 1.5, giyinme: 1.8, antre: 2.0,
  mutfak: 2.6, salon: 3.6, garaj: 3.0, ebeveyn: 3.2, yatak: 2.8, cocuk: 2.8,
};
const WET: RoomType[] = ["banyo", "wc", "camasir"];
/** Holden değil, komşu mekândan girilebilen küçük hacimler (ikili sütunda cephe tarafına geçebilir) */
const viaNeighbour = (r: Room) => r.type === "giyinme" || (r.type === "banyo" && /ebeveyn/i.test(r.name));
/** İkili sütun: ebeveyn süitinin iki hacmi (giyinme + ebeveyn banyosu) ya da biri süit, öbürü holden girilen küçük hacim (süit cephe tarafında kalır, yatak odasına komşu olmalı) */
const STORE: RoomType[] = ["kiler", "depo", "teknik"];
const canPair = (a: Room, b: Room) => (viaNeighbour(a) && viaNeighbour(b)) || (STORE.includes(a.type) && (STORE.includes(b.type) || b.type === "camasir")) || (STORE.includes(b.type) && a.type === "camasir");
const SMALL_OK: RoomType[] = ["banyo", "wc", "camasir", "depo", "kiler", "teknik", "giyinme"];

export function buildLayout(program: Program, design: DesignOptions = program.design ?? {}): BuildingLayout {
  if (program.floors.some((f) => (f as ApFloor).units?.length)) return apartmentLayout(program, design);
  if (!(design as UnitDesign).unitMode) {
    const L = houseLayout(program, design);
    if (L) return L;
  }
  const L = legacyLayout(program, design);
  if (L.stair) L.stairInfo = legacyStairInfo(L.stair, L.H);
  return L;
}

function legacyLayout(program: Program, design: DesignOptions): BuildingLayout {
  const variant = design.variant ?? 0;
  const W = round2(program.footprint.width);
  const D = round2(program.footprint.depth);
  const H = program.floorHeight;
  const multi = program.floors.length > 1;

  const unitMode = !!(design as UnitDesign).unitMode;
  const hallDepth = multi ? 2.4 : unitMode ? 1.2 : Math.min(1.5, D * 0.18);
  const adj = program.adjacencies ?? [];
  const parking = program.floors.flatMap((f) => f.rooms.filter(isParking)).map((r) => {
    const m = /(\d+)\s*(araç|araba|otomobil)/i.exec(`${r.name} ${r.note}`);
    return { name: r.name, area: r.area, cars: Math.max(1, Math.min(6, m ? +m[1] : Math.round(r.area / 12.5))) };
  });
  const assignments = program.floors.map((f, i) =>
    unitMode
      ? assignUnitBands(f.rooms.filter((r) => !isParking(r)), { reverse: variant === 2, entry: i === 0 })
      : assignBands(f.rooms.filter((r) => !isParking(r)), { flip: variant === 1, reverse: variant === 2, adj: adj.filter((a) => hasRoom(f.rooms, a.a) && hasRoom(f.rooms, a.b)) }),
  );
  if (!unitMode) assignments.forEach(orderSuite);
  // Ön bant derinliği tüm katlarda ortak (merdiven hizası için); katların alan paylarının ortalamasından
  const shares = assignments
    .map((a) => ({ f: sumArea(a.front), b: sumArea(a.back) }))
    .filter((s) => s.f + s.b > 0)
    .map((s) => s.f / (s.f + s.b));
  const share = shares.length ? shares.reduce((s, v) => s + v, 0) / shares.length : 0.5;
  let frontDepth = round2((D - hallDepth) * (unitMode ? Math.min(0.75, Math.max(0.5, share)) : Math.min(0.62, Math.max(0.38, share))));
  if (unitMode) {
    // cephe sırası sığmıyorsa mutfak/yemek/çalışma iç sıraya geçer
    for (const a of assignments) {
      const need = () => a.front.reduce((t, r) => t + (MIN_WIDTH[r.type] ?? 2.6), 0);
      for (const t of ["calisma", "yemek", "mutfak", "misafir"] as RoomType[]) {
        if (need() <= W * 0.98) break;
        const i = a.front.findIndex((r) => r.type === t);
        if (i >= 0 && a.front.length > 1) a.back.unshift(...a.front.splice(i, 1));
      }
    }
    // daire: iç sıra (antre, ıslak hacim) yalnız gerektiği kadar derin, kalanı cepheye bakan odalara
    const inner = Math.max(...assignments.map((a) => sumArea(a.back)), 0);
    const innerDepth = Math.min((D - hallDepth) * 0.45, Math.max(2.1, (inner * 1.15) / W));
    frontDepth = round2(D - hallDepth - innerDepth);
    // iç sıra (antre + ıslak hacimler) gerçek alanından fazla genişliğe yayılmasın: artan kısım antreye bitişik vestiyer/depo
    for (const a of assignments) {
      // cephe sırası sıkışıkken iç sırada yer varsa mutfak iç sıraya (antreye komşu) geçer
      const frontNeed = (sumArea(a.front) * 1.1) / Math.max(1, frontDepth);
      const mi = a.front.findIndex((r) => r.type === "mutfak");
      if (mi >= 0 && a.front.length > 2 && frontNeed > W * 1.05) {
        const mw = (a.front[mi].area * 1.1) / innerDepth;
        if (W - (sumArea(a.back) * 1.1) / innerDepth >= mw) {
          const [m] = a.front.splice(mi, 1);
          a.back.unshift(m);
        }
      }
      const innerW = (sumArea(a.back) * 1.1) / innerDepth;
      const spare = W - innerW;
      if (a.back.length && spare >= 1.4) {
        const ai = a.back.findIndex((r) => r.type === "antre");
        const filler: Room = { name: spare >= 2.6 ? "Depo" : "Vestiyer", type: "depo", zone: "servis", area: round2((spare * innerDepth) / 1.1), note: "" };
        a.back.splice(ai >= 0 ? ai : a.back.length, 0, filler);
      }
    }
  }
  if (design.frontDepth != null) frontDepth = round2(Math.min(D - hallDepth - 2, Math.max(2, design.frontDepth)));
  const hallBand = { y: frontDepth, h: hallDepth };
  const stairW = multi ? Math.min(3.2, W * 0.32) : 0;
  const stair: Rect | null = multi ? { x: 0, y: hallBand.y, w: stairW, h: hallDepth } : null;

  const floors: FloorLayout[] = program.floors.map((f, i) =>
    layoutFloor(f.level, f.name, assignments[i], { W, D, hallBand, stair, isGround: f.level === groundLevelOf(program), H, cols: design.cols ?? {}, windowStyle: program.facade?.windowStyle }),
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
  /** Cephe dili: pencere biçimi */
  windowStyle?: "kare" | "dikey" | "serit" | "boy";
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

export function assignBands(rooms: Room[], opts: { flip?: boolean; reverse?: boolean; adj?: Adjacency[]; modern?: boolean } = {}): Assignment {
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
  if (opts.modern) {
    // giriş (antre/garaj) merdivenin karşısında, bandın başında kalsın
    for (const t of ["antre", "garaj"] as RoomType[]) {
      const i = front.findIndex((r) => r.type === t);
      if (i > 0) front.unshift(...front.splice(i, 1));
    }
    return { front, back, hallRooms, outdoorRooms };
  }
  // Merdivenin önü/arkası holle temas etmez; ilk sütuna küçük oda ya da antre gelmesin
  for (const band of [front, back]) {
    if (band.length > 1 && (SMALL_OK.includes(band[0].type) || band[0].type === "antre")) {
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

  const outdoor = placeOutdoors(outdoorRooms, placed, openings, W, D, id);

  // Duvarlar: hol ve merdiven tek bir bant olarak (aralarında duvar yok)
  const wallRooms: PlacedRoom[] = [
    ...placed.filter((p) => p.band !== "hall"),
    { ...hall, id: "band", rect: { x: 0, y: hallBand.y, w: W, h: hallBand.h } },
  ];
  const wallLines = buildWallLines(wallRooms, W, D);
  const walls = subtractOpenings(wallLines, openings);

  return { level, name, z: level * ctx.H, rooms: placed, openings, walls, wallLines, outdoor, cols };
}

/** Dış mekânlar (balkon/teras): arka cepheye, bir yaşam mekânının önüne çıkma olarak; balkon kapısı ekler. */
function placeOutdoors(outdoorRooms: Room[], placed: PlacedRoom[], openings: Opening[], W: number, D: number, id: (p: string) => string): FloorLayout["outdoor"] {
  const hostPref = (p: PlacedRoom) => {
    const i = ["salon", "ebeveyn", "yemek", "yatak", "cocuk", "misafir", "calisma", "mutfak"].indexOf(p.type);
    return i < 0 ? 99 : i;
  };
  const hosts = placed
    .filter((p) => p.band !== "hall" && near(p.rect.y + p.rect.h, D))
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
  // Balkona açılan kapı: balkonun önünde olduğu mekândan
  if (outdoor.length && host) {
    const o0 = outdoor[0].rect;
    const lo = Math.max(host.rect.x, o0.x), hi = Math.min(host.rect.x + host.rect.w, o0.x + o0.w);
    const cxd = hi - lo > 1.2 ? (lo + hi) / 2 : host.rect.x + host.rect.w / 2;
    // aynı duvardaki pencereyi kaldır, balkon kapısı koy
    for (let i = openings.length - 1; i >= 0; i--) {
      const o = openings[i];
      if (o.orient === "h" && near(o.line, D) && o.center >= host.rect.x && o.center <= host.rect.x + host.rect.w && o.kind === "window") openings.splice(i, 1);
    }
    openings.push({
      id: id("bk"), kind: "balconyDoor", orient: "h", line: D, center: round2(cxd),
      width: round2(Math.min(host.type === "salon" ? 2.4 : 1.8, host.rect.w - 0.6)), sill: 0, head: 2.2, exterior: true, swing: -1,
    });
  }
  return outdoor;
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
  roomsIn: Room[],
  band: Rect,
  bandName: "front" | "back",
  out: PlacedRoom[],
  id: (p: string) => string,
  hallEdgeY: number,
  spec?: { override?: number[]; report: (xs: number[]) => void },
) {
  let rooms = roomsIn;
  const total = rooms.reduce((s, r) => s + r.area, 0);
  const scale = (band.w * band.h) / total;
  type Col = { rooms: Room[]; area: number };
  const cols: Col[] = [];
  const minW = 2.2;
  // Dar kalacak küçük hacimleri ikili sütun olabilecek şekilde yan yana getir (ilkinin yerinde)
  const narrow = (r: Room) => SMALL_OK.includes(r.type) && (r.area * scale) / band.h < minW * 1.4;
  if (band.h >= 2.9) {
    rooms = rooms.slice();
    for (let i = 0; i < rooms.length - 1; i++) {
      const r = rooms[i];
      if (!narrow(r)) continue;
      if (narrow(rooms[i + 1]) && canPair(r, rooms[i + 1])) { i++; continue; }
      const j = rooms.findIndex((q, k) => k > i + 1 && narrow(q) && canPair(r, q));
      if (j > 0) { const [q] = rooms.splice(j, 1); rooms.splice(i + 1, 0, q); i++; }
    }
  }
  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i];
    const w = (r.area * scale) / band.h;
    const next = rooms[i + 1];
    if (w < minW && band.h >= 2.9 && SMALL_OK.includes(r.type) && next && SMALL_OK.includes(next.type) && (next.area * scale) / band.h < minW * 1.4 && canPair(r, next)) {
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
  // Asgari genişliğin altında kalan sütunlar, payı olan sütunlardan payları oranında alır
  const mins = cols.map(minFor);
  for (let iter = 0; iter < 8; iter++) {
    const deficit = widths.reduce((s, w, i) => s + Math.max(0, mins[i] - w), 0);
    if (deficit < 1e-3) break;
    const slack = widths.map((w, i) => Math.max(0, w - mins[i]));
    const slackSum = slack.reduce((s, v) => s + v, 0);
    if (slackSum < 1e-3) break;
    const take = Math.min(deficit, slackSum);
    widths = widths.map((w, i) => (w < mins[i] ? w + (mins[i] - w) * (take / deficit) : w - (slack[i] * take) / slackSum));
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
      const [r0, r1] = c.rooms;
      const [a, b] =
        viaNeighbour(r0) && !viaNeighbour(r1) ? [r1, r0]
        : viaNeighbour(r1) && !viaNeighbour(r0) ? [r0, r1]
        : r0.type === "camasir" ? [r0, r1] : r1.type === "camasir" ? [r1, r0]
        : ensuite(r0) && !ensuite(r1) ? [r1, r0] : [r0, r1];
      const ha = round2(Math.min(band.h - 1.2, Math.max(1.2, (band.h * a.area) / c.area)));
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
  // 1b) Holün ucuna (yan kenarına) dayanan odalar (boydan boya salon): geniş geçiş ya da kapı
  for (const r of banded) {
    if (doored.has(r.id) || r.type === "garaj") continue;
    const e = sharedEdge(r.rect, hall.rect);
    if (!e || e.orient !== "v") continue;
    const open = r.type === "salon" || r.type === "yemek";
    const dw = open ? Math.min(1.4, e.len - 0.25) : doorWidth(r);
    if (e.len < dw + 0.2 || dw < 0.8) continue;
    ops.push({
      id: id("k"), kind: open ? "passage" : "door", orient: "v", line: e.line, center: round2((e.a + e.b) / 2), width: round2(dw), sill: 0, head: open ? 2.2 : 2.1,
      exterior: false, swing: r.rect.x < e.line ? -1 : 1,
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
      const bed = n.type === "ebeveyn" || n.type === "yatak" || n.type === "cocuk" || n.type === "misafir";
      if (r.type === "giyinme" || (r.type === "banyo" && /ebeveyn/i.test(r.name))) return n.type === "ebeveyn" ? 0 : bed ? 1 : doored.has(n.id) ? 2 : 3;
      if (WET.includes(r.type as RoomType)) return WET.includes(n.type as RoomType) ? 5 : bed ? 4 : doored.has(n.id) ? 1 : 2;
      if (STORE.includes(r.type as RoomType)) return n.type === "mutfak" && r.type === "kiler" ? 0 : n.type === "camasir" ? 1 : WET.includes(n.type as RoomType) ? 5 : n.type === "ebeveyn" || n.type === "yatak" || n.type === "cocuk" ? 4 : 2;
      if (r.type === "mutfak" || r.type === "yemek") return n.type === "salon" || n.type === "yemek" ? 0 : 2;
      if (WET.includes(n.type as RoomType)) return 5; // ıslak hacimden geçilmez
      if (n.type === "ebeveyn" || n.type === "yatak" || n.type === "cocuk") return 4;
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
    const ws = ctx.windowStyle ?? "kare";
    const head = Math.min(ctx.H - 0.45, ws === "boy" || ws === "dikey" ? 2.5 : 2.2);
    const winFor = (len: number) =>
      isWet ? { w: Math.min(ws === "serit" ? 1.6 : 0.7, len - 0.4), sill: 1.5, head: 2.1 } :
      ws === "boy" ? { w: Math.min(r.type === "salon" ? 4.2 : 2.4, len * (r.type === "salon" ? 0.75 : 0.6)), sill: 0, head } :
      ws === "dikey" ? { w: Math.min(r.type === "salon" ? 1.6 : 1.0, len * 0.4), sill: r.type === "salon" ? 0 : 0.6, head } :
      ws === "serit" ? { w: Math.min(len - 0.5, len * 0.85), sill: 1.0, head } :
      r.type === "salon" ? { w: Math.min(3.2, len * 0.6), sill: 0.5, head } :
      { w: Math.min(2.0, len * 0.5), sill: 0.9, head };
    const edges: { orient: "h" | "v"; line: number; a: number; b: number; swing: 1 | -1 }[] = [];
    if (near(r.rect.y, 0)) edges.push({ orient: "h", line: 0, a: r.rect.x, b: r.rect.x + r.rect.w, swing: 1 });
    if (near(r.rect.y + r.rect.h, D)) edges.push({ orient: "h", line: D, a: r.rect.x, b: r.rect.x + r.rect.w, swing: -1 });
    const primary = edges.length;
    if (near(r.rect.x, 0)) edges.push({ orient: "v", line: 0, a: r.rect.y, b: r.rect.y + r.rect.h, swing: 1 });
    if (near(r.rect.x + r.rect.w, W)) edges.push({ orient: "v", line: W, a: r.rect.y, b: r.rect.y + r.rect.h, swing: -1 });
    edges.forEach((e, i) => {
      const len = e.b - e.a;
      if (len < (r.type === "antre" ? 1.1 : 1.2)) return;
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
    // hol bandının dış cepheye değen ucundan (salon boydan boya ise sol uç)
    const atRight = near(hall.rect.x + hall.rect.w, W);
    const atLeft = near(hall.rect.x, 0);
    const line = atRight || !atLeft ? W : 0;
    const dw = Math.min(1.0, hallBand.h - 0.2);
    for (let i = ops.length - 1; i >= 0; i--) {
      const o = ops[i];
      if (o.kind === "window" && o.orient === "v" && near(o.line, line) && Math.abs(o.center - (hallBand.y + hallBand.h / 2)) < o.width / 2 + dw / 2) ops.splice(i, 1);
    }
    ops.push({ id: id("gr"), kind: "entrance", orient: "v", line, center: hallBand.y + hallBand.h / 2, width: dw, sill: 0, head: 2.2, exterior: true, swing: line === W ? -1 : 1 });
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

// ---------------------------------------------------------------- APARTMAN BLOĞU
type UnitDesign = DesignOptions & { unitMode?: boolean };

/** Daire içi: cephe sırası (yaşam + yatak odaları, ebeveyn süiti), daire holü, iç sıra (antre, ıslak hacimler). */
function assignUnitBands(rooms: Room[], opts: { reverse?: boolean; entry?: boolean }): Assignment {
  const indoor = rooms.filter((r) => !isOutdoorRoom(r));
  const outdoorRooms = rooms.filter((r) => isOutdoorRoom(r));
  const hallRooms = indoor.filter((r) => r.type === "hol" || r.type === "koridor");
  const banded = indoor.filter((r) => !hallRooms.includes(r));
  const ensuite = (r: Room) => r.type === "giyinme" || (r.type === "banyo" && /ebeveyn/i.test(r.name));
  const OUTER: Partial<Record<RoomType, number>> = { salon: 0, yemek: 1, mutfak: 2, calisma: 3, ofis: 3, magaza: 3, misafir: 4, cocuk: 5, yatak: 6, ebeveyn: 7, giyinme: 8, banyo: 9 };
  const INNER: Partial<Record<RoomType, number>> = { kiler: 0, camasir: 1, depo: 2, teknik: 3, garaj: 3, wc: 4, banyo: 5, antre: 9 };
  const front = banded.filter((r) => (OUTER[r.type] != null && r.type !== "banyo") || ensuite(r));
  const back = banded.filter((r) => !front.includes(r));
  if (opts.entry && !back.some((r) => r.type === "antre")) back.push({ name: "Antre", type: "antre", zone: "sirkulasyon", area: 4, note: "" });
  if (!front.length && back.length > 1) front.push(...back.splice(0, 1));
  front.sort((a, b) => (OUTER[a.type] ?? 5) - (OUTER[b.type] ?? 5));
  back.sort((a, b) => (INNER[a.type] ?? 4) - (INNER[b.type] ?? 4));
  if (opts.reverse) front.reverse();
  return { front, back, hallRooms, outdoorRooms };
}

// Kat ortasında çekirdek bandı (merdiven + asansör + kat holü) boydan boya uzanır.
// Daireler ön ve arka bantlara dizilir; her daire tek konut yerleşimiyle (90° döndürülmüş) çözülür:
// dairenin kendi holü çekirdeğe dik uzanır, daire kapısı kat holüne açılır, yaşam mekânları cepheye bakar.
const CORE_H = 2.6;
const CORE_H_ELEV = 3.0;
const LOBBY = 1.4;
const ELEV_D = 1.6;
const ELEV_W = 1.9;

interface SlotXf { bx: number; by: number; bw: number; bh: number; side: "front" | "back"; mirror: boolean }
interface SlotInfo { unit: UnitSlot; xf: SlotXf; local: FloorLayout[]; localStair: Rect | null; localHall: { y: number; h: number } }

const isOutdoorRoom = (r: Room) => r.zone === "dis" || r.type === "balkon" || r.type === "teras";

function apartmentLayout(program: Program, design: DesignOptions): BuildingLayout {
  const variant = design.variant ?? 0;
  const W = round2(program.footprint.width);
  const D = round2(program.footprint.depth);
  const H = program.floorHeight;
  const floorsIn = program.floors as ApFloor[];
  const parking = floorsIn.flatMap((f) => f.rooms.filter(isParking)).map((r) => {
    const m = /(\d+)\s*(araç|araba|otomobil)/i.exec(`${r.name} ${r.note}`);
    return { name: r.name, area: r.area, cars: Math.max(1, Math.min(6, m ? +m[1] : Math.round(r.area / 12.5))) };
  });
  const stairW = round2(Math.min(4.2, Math.max(3.2, W * 0.16)));
  const elevW = floorsIn.length > 2 ? ELEV_W : 0;
  // Asansörlü çekirdek: merdiven önünde sahanlık, asansör sahanlığa açılır, arkasından geçiş
  const coreH = elevW ? CORE_H_ELEV : CORE_H;
  const coreStart = elevW ? stairW + LOBBY + elevW : stairW;

  // Daireleri ön/arka banda böl (sayı farkı en çok 1, alan dengeli); ortak mekânlar ayrı bir "daire" gibi
  const slotsOf = (f: ApFloor): UnitSlot[] => {
    const units = (f.units ?? []).filter((u) => u.part !== "upper");
    const common = f.rooms.filter((r) => !r.unit && !isParking(r));
    if (units.length && common.filter((r) => !isOutdoorRoom(r) && r.type !== "hol" && r.type !== "koridor").length) {
      units.push({ label: "", type: "Ortak alan", part: "single", rooms: common, area: sumArea(common.filter((r) => !isOutdoorRoom(r))) });
    }
    return units;
  };
  const split = (units: UnitSlot[]) => {
    const f: UnitSlot[] = [], b: UnitSlot[] = [];
    const ar = (a: UnitSlot[]) => a.reduce((s, u) => s + u.area, 0);
    for (const u of [...units].sort((x, y) => y.area - x.area)) {
      if (f.length - b.length >= 1) b.push(u);
      else if (b.length - f.length >= 1) f.push(u);
      else (ar(f) <= ar(b) ? f : b).push(u);
    }
    const order = (a: UnitSlot[]) => units.filter((u) => a.includes(u));
    return { front: order(f), back: order(b), share: ar(f) / Math.max(1, ar(f) + ar(b)) };
  };
  const splits = new Map<number, ReturnType<typeof split>>();
  for (const f of floorsIn) { const s = slotsOf(f); if (s.length) splits.set(f.level, split(s)); }
  const shares = [...splits.values()].filter((s) => s.front.length && s.back.length).map((s) => s.share);
  const share = shares.length ? shares.reduce((a, v) => a + v, 0) / shares.length : 0.5;
  let frontDepth = round2((D - coreH) * Math.min(0.6, Math.max(0.4, share)));
  if (design.frontDepth != null) frontDepth = round2(Math.min(D - coreH - 4, Math.max(4, design.frontDepth)));
  const hallBand = { y: frontDepth, h: coreH };
  const stair: Rect = { x: 0, y: hallBand.y, w: stairW, h: coreH };
  const elevator: Rect | null = elevW ? { x: stairW + LOBBY, y: hallBand.y, w: elevW, h: ELEV_D } : null;
  const groundLevel = floorsIn.find((f) => f.level >= 0)?.level ?? floorsIn[0].level;
  const slotsByLevel = new Map<number, SlotInfo[]>();

  const floors: FloorLayout[] = floorsIn.map((f) => {
    let uid = 0;
    const id = (p: string) => `L${f.level}-${p}${uid++}`;
    const sp = splits.get(f.level);
    const lowerSlots = slotsByLevel.get(f.level - 1);
    const hasUpper = (f.units ?? []).some((u) => u.part === "upper") && lowerSlots;

    // Yalnız ortak mekânlı kat (bodrum, otopark, dükkan katı): tek konut yerleşimi, aynı çekirdek
    if (!sp && !hasUpper) {
      const rooms = f.rooms.filter((r) => !isParking(r));
      const fl = layoutFloor(f.level, f.name, assignBands(rooms, { flip: variant === 1, reverse: variant === 2 }), { W, D, hallBand, stair, isGround: f.level === groundLevel, H, cols: {} });
      if (elevator) addElevator(fl, elevator, id);
      fl.cols = [];
      return fl;
    }

    const placed: PlacedRoom[] = [];
    const wallRooms: PlacedRoom[] = [];
    const openings: Opening[] = [];
    const outdoor: FloorLayout["outdoor"] = [];
    const units: NonNullable<FloorLayout["units"]> = [];
    const stairs: Rect[] = [];
    const infos: SlotInfo[] = [];

    if (sp) {
      for (const side of ["front", "back"] as const) {
        let list = side === "front" ? sp.front : sp.back;
        const by = side === "front" ? 0 : hallBand.y + hallBand.h;
        const bh = side === "front" ? hallBand.y : D - by;
        const tot = list.reduce((s, u) => s + u.area, 0) || 1;
        // Daireler bandı dolduramıyorsa (ör. zemin katta az daire) şişirilmez; artan genişlik ortak alana kalır
        const need = list.map((u) => (u.area * 1.22) / bh);
        const needSum = need.reduce((a, v) => a + v, 0);
        const spare = W - needSum;
        let widths = list.map((u) => (W * u.area) / tot);
        if (spare >= 3) {
          widths = need;
          list = [...list, { label: "", type: "Ortak alan", part: "single", rooms: [{ name: "Ortak Alan / Depo", type: "depo", zone: "servis", area: round2(spare * bh * 0.8), note: "" }], area: round2(spare * bh * 0.8) }];
          widths.push(spare);
        } else if (spare > 0 && needSum > 0) {
          widths = need.map((v) => (v * W) / needSum);
        }
        let x = 0;
        list.forEach((u, k) => {
          const bw = k === list.length - 1 ? round2(W - x) : round2(widths[k]);
          const info = layoutSlot(program, u, { bx: x, by, bw, bh, side, mirror: false }, variant, coreStart, W);
          infos.push(info);
          x = round2(x + bw);
        });
      }
    } else if (lowerSlots) {
      // Dubleks üst katı: alt kattaki daire yerleşimleri
      for (const s of lowerSlots) {
        if (s.unit.part === "lower" && s.local[1]) infos.push({ ...s, unit: { ...s.unit, part: "upper", rooms: s.unit.upperRooms ?? [] } });
        else infos.push({ ...s, local: [], unit: { ...s.unit, part: "upper", label: "" } });
      }
    }
    slotsByLevel.set(f.level, infos);

    for (const info of infos) {
      const { xf, unit } = info;
      const T = slotTransform(xf);
      const slotRect: Rect = { x: xf.bx, y: xf.by, w: xf.bw, h: xf.bh };
      const local = unit.part === "upper" ? info.local[1] : info.local[0];
      if (!local) {
        const filler: PlacedRoom = { id: id("bos"), name: "Çatı Terası", type: "teras", zone: "dis", requestedArea: 0, rect: slotRect, band: xf.side };
        placed.push(filler);
        wallRooms.push(filler);
        continue;
      }
      const pre = unit.label ? `${unit.label}-` : "C-";
      const rooms = local.rooms.map((r) => ({ ...r, id: id(pre + r.type), rect: T.rect(r.rect), unit: unit.label || undefined }));
      placed.push(...rooms.filter((r) => r.type !== "merdiven"));
      // duvar: dairenin holü ile iç merdiveni tek parça
      const lhb = info.localHall;
      const hallRect = T.rect({ x: 0, y: lhb.y, w: xf.bw, h: lhb.h });
      wallRooms.push(...rooms.filter((r) => r.band !== "hall"), { ...rooms[0], id: "uband", band: "hall", rect: hallRect });
      if (info.localStair) stairs.push(T.rect(info.localStair));
      // açıklıklar: yalnız blok dış cephesindeki pencereler, iç kapılar
      for (const o of local.openings) {
        if (o.kind === "entrance" || o.kind === "balconyDoor") continue;
        const t = T.op(o);
        if (o.exterior) {
          const ext = t.orient === "h" ? near(t.line, 0) || near(t.line, D) : near(t.line, 0) || near(t.line, W);
          if (!ext) continue;
        }
        openings.push({ ...t, id: id("o") });
      }
      // daire kapısı: kat holüne
      if (unit.part !== "upper") {
        const target = local.rooms.find((r) => r.type === "antre" && near(r.rect.y + r.rect.h, xf.bh))
          ?? local.rooms.filter((r) => near(r.rect.y + r.rect.h, xf.bh)).sort((a, b) => b.rect.w - a.rect.w)[0];
        if (target) {
          const lc = target.rect.x + target.rect.w / 2;
          const lineY = xf.side === "front" ? hallBand.y : hallBand.y + hallBand.h;
          const cx = Math.min(xf.bx + xf.bw - 0.7, Math.max(xf.bx + 0.7, Math.min(W - 0.7, Math.max(coreStart + 0.7, T.x(lc)))));
          openings.push({ id: id("dk"), kind: "door", orient: "h", line: lineY, center: round2(cx), width: 1.0, sill: 0, head: 2.1, exterior: false, swing: xf.side === "front" ? -1 : 1 });
        }
      }
      // balkonlar: dairenin cephesine çıkma
      const outs = unit.rooms.filter(isOutdoorRoom).filter((r) => !isParking(r));
      const facadeY = xf.side === "front" ? 0 : D;
      const hostPref = (p: PlacedRoom) => ["salon", "ebeveyn", "yatak", "cocuk", "yemek", "mutfak"].indexOf(p.type as string);
      const hosts = rooms
        .filter((r) => r.band !== "hall" && hostPref(r) >= 0 && near(xf.side === "front" ? r.rect.y : r.rect.y + r.rect.h, facadeY))
        .sort((a, b) => hostPref(a) - hostPref(b) || b.rect.w - a.rect.w);
      const taken: [number, number][] = [];
      outs.forEach((o, k) => {
        const host = hosts[k % Math.max(1, hosts.length)];
        const depth = o.type === "teras" || o.area > 10 ? 2.0 : 1.5;
        const w = round2(Math.min(xf.bw - 0.4, Math.max(2, o.area / depth)));
        let x0 = host ? host.rect.x + host.rect.w / 2 - w / 2 : xf.bx + (xf.bw - w) / 2;
        x0 = Math.min(xf.bx + xf.bw - 0.2 - w, Math.max(xf.bx + 0.2, x0));
        for (const [a, b] of taken) if (x0 < b && x0 + w > a) x0 = b;
        if (x0 + w > xf.bx + xf.bw - 0.1) return;
        taken.push([x0, x0 + w]);
        const rect = { x: round2(x0), y: xf.side === "front" ? -depth : D, w, h: depth };
        outdoor.push({ name: unit.label ? `${o.name} (${unit.label})` : o.name, area: o.area, type: o.type, rect });
        if (host) {
          const lo = Math.max(host.rect.x, x0), hi = Math.min(host.rect.x + host.rect.w, x0 + w);
          if (hi - lo > 1.0) {
            for (let i = openings.length - 1; i >= 0; i--) {
              const op = openings[i];
              if (op.orient === "h" && near(op.line, facadeY) && op.kind === "window" && op.center > host.rect.x && op.center < host.rect.x + host.rect.w) openings.splice(i, 1);
            }
            openings.push({ id: id("bk"), kind: "balconyDoor", orient: "h", line: facadeY, center: round2((lo + hi) / 2), width: round2(Math.min(1.8, hi - lo - 0.4)), sill: 0, head: 2.2, exterior: true, swing: xf.side === "front" ? 1 : -1 });
          }
        }
      });
      if (unit.label) units.push({ label: unit.label, type: unit.type, part: unit.part, rect: slotRect, area: unit.area });
    }

    // Çekirdek: merdiven + asansör + kat holü
    const commonHall = f.rooms.find((r) => !r.unit && (r.type === "hol" || r.type === "antre"));
    const isGround = f.level === groundLevel;
    const hall: PlacedRoom = {
      id: id("hol"), name: commonHall?.name ?? (isGround ? "Giriş Holü" : "Kat Holü"), type: "hol", zone: "sirkulasyon",
      requestedArea: commonHall?.area ?? 0, rect: { x: stairW, y: hallBand.y, w: round2(W - stairW), h: coreH }, band: "hall",
    };
    placed.push(hall, { id: id("mrd"), name: "Merdiven", type: "merdiven", zone: "sirkulasyon", requestedArea: 0, rect: { ...stair }, band: "hall" });
    wallRooms.push({ ...hall, id: "band", rect: { x: 0, y: hallBand.y, w: W, h: coreH } });
    openings.push({ id: id("mp"), kind: "window", orient: "v", line: 0, center: stair.y + stair.h / 2, width: 1.2, sill: 1.2, head: 2.2, exterior: true, swing: 1 });
    if (isGround) openings.push({ id: id("gr"), kind: "entrance", orient: "v", line: W, center: hallBand.y + hallBand.h / 2, width: 1.4, sill: 0, head: 2.4, exterior: true, swing: -1 });
    if (elevator) {
      const fl = { rooms: placed, openings, wallLines: [] as WallPiece[], walls: [] as WallPiece[] } as unknown as FloorLayout;
      splitCoreForElevator(fl, elevator, id, hall);
      wallRooms.push({ ...hall, id: "asn-w", rect: elevator });
    }
    const wallLines = buildWallLines(wallRooms, W, D);
    const walls = subtractOpenings(wallLines, openings);
    return { level: f.level, name: f.name, z: f.level * H, rooms: placed, openings, walls, wallLines, outdoor, cols: [], units, stairs };
  });

  const cutX = pickCut(floors, W, coreStart);
  const topFloor = floorsIn[floorsIn.length - 1]?.level ?? 0;
  return {
    W, D, H, slab: SLAB, extWall: EXT, intWall: INT, roof: program.roof, stair, hallBand,
    floors, cutX, totalHeight: (topFloor + 1) * H, roofHeight: program.roof === "duz" ? 0.9 : round2(Math.min(W, D) * 0.5 * 0.4 + 0.3),
    variant, parking, elevator, apartment: true, stairInfo: legacyStairInfo(stair, H),
  };
}

/** Bir daireyi yerel koordinatlarda çözer: yerel y = 0 cephe, y = derinlik çekirdek tarafı. */
function layoutSlot(program: Program, unit: UnitSlot, xf: SlotXf, variant: number, coreStart: number, W: number): SlotInfo {
  const fl: Program["floors"] = [{ level: 0, name: "a", rooms: unit.rooms.filter((r) => !isOutdoorRoom(r) && !isParking(r)) }];
  if (unit.part === "lower" && unit.upperRooms?.length) fl.push({ level: 1, name: "b", rooms: unit.upperRooms.filter((r) => !isOutdoorRoom(r)) });
  if (!fl[0].rooms.length) fl[0].rooms = [{ name: "Boş Alan", type: "diger", zone: "servis", area: xf.bw * xf.bh, note: "" }];
  const mini: Program = { ...program, footprint: { width: xf.bw, depth: xf.bh }, floors: fl, adjacencies: [], blocks: [], unitTypes: [] };
  const L = buildLayout(mini, { variant, unitMode: true } as UnitDesign);
  // Daire kapısı (antre) kat holüne düşecek şekilde aynala; kenar dairede salon köşeye gelsin
  const ant = L.floors[0].rooms.find((r) => r.type === "antre" && near(r.rect.y + r.rect.h, xf.bh));
  const lc = ant ? ant.rect.x + ant.rect.w / 2 : xf.bw / 2;
  const ok = (m: boolean) => { const x = slotTransform({ ...xf, mirror: m }).x(lc); return x > coreStart + 0.7 && x < W - 0.7; };
  let mirror = near(xf.bx + xf.bw, W) && !near(xf.bx, 0);
  if (!ok(mirror) && ok(!mirror)) mirror = !mirror;
  return { unit, xf: { ...xf, mirror }, local: L.floors, localStair: L.stair, localHall: L.hallBand };
}

function slotTransform(xf: SlotXf) {
  const x = (lx: number) => (xf.mirror ? xf.bx + xf.bw - lx : xf.bx + lx);
  const y = (ly: number) => (xf.side === "front" ? xf.by + ly : xf.by + xf.bh - ly);
  const rect = (r: Rect): Rect => {
    const xa = x(r.x), xb = x(r.x + r.w), ya = y(r.y), yb = y(r.y + r.h);
    return { x: round2(Math.min(xa, xb)), y: round2(Math.min(ya, yb)), w: round2(Math.abs(xb - xa)), h: round2(Math.abs(yb - ya)) };
  };
  const op = (o: Opening): Opening =>
    o.orient === "h"
      ? { ...o, line: round2(y(o.line)), center: round2(x(o.center)), swing: (xf.side === "front" ? o.swing : -o.swing) as 1 | -1 }
      : { ...o, line: round2(x(o.line)), center: round2(y(o.center)), swing: (xf.mirror ? -o.swing : o.swing) as 1 | -1 };
  return { x, y, rect, op };
}

/** Kat holünü asansörün çevresinde böler: merdiven sahanlığı, asansör, arkasından geçiş, asıl hol. */
function splitCoreForElevator(fl: FloorLayout, el: Rect, id: (p: string) => string, coreHall?: PlacedRoom) {
  const hall = coreHall ?? fl.rooms.find((r) => r.band === "hall" && r.type === "hol" && !r.unit);
  if (hall) {
    const hb = hall.rect;
    const x1 = el.x + el.w;
    hall.rect = { x: x1, y: hb.y, w: round2(hb.x + hb.w - x1), h: hb.h };
    fl.rooms.push(
      { id: id("shn"), name: "Sahanlık", type: "hol", zone: "sirkulasyon", requestedArea: 0, rect: { x: hb.x, y: hb.y, w: round2(el.x - hb.x), h: hb.h }, band: "hall" },
      { id: id("gcs"), name: "Geçiş", type: "hol", zone: "sirkulasyon", requestedArea: 0, rect: { x: el.x, y: round2(el.y + el.h), w: el.w, h: round2(hb.y + hb.h - el.y - el.h) }, band: "hall" },
    );
  }
  fl.rooms.push({ id: id("asn"), name: "Asansör", type: "diger", zone: "sirkulasyon", requestedArea: 0, rect: { ...el }, band: "hall" });
  fl.openings.push({ id: id("ak"), kind: "door", orient: "v", line: el.x, center: round2(el.y + el.h / 2), width: 0.9, sill: 0, head: 2.1, exterior: false, swing: -1 });
}

function addElevator(fl: FloorLayout, el: Rect, id: (p: string) => string) {
  splitCoreForElevator(fl, el, id);
  const extra = buildWallLines([{ ...fl.rooms[0], rect: el }], 1e9, 1e9).map((w) => ({ ...w, exterior: false, thickness: INT }));
  fl.wallLines = [...fl.wallLines, ...extra];
  fl.walls = subtractOpenings(fl.wallLines, fl.openings);
}

function pickCut(floors: FloorLayout[], W: number, x0: number) {
  const candidates = floors.flatMap((f) => f.openings.filter((o) => o.orient === "h" && o.exterior).map((o) => o.center));
  let cutX = round2(x0 + (W - x0) * 0.5);
  let best = -1;
  for (const c of candidates) {
    if (c < x0 + 0.3) continue;
    const hits = floors.reduce((s, f) => s + f.openings.filter((o) => o.orient === "h" && Math.abs(o.center - c) < o.width / 2 - 0.05).length, 0);
    const score = hits - Math.abs(c - W / 2) / W;
    if (score > best) { best = score; cutX = round2(c); }
  }
  return cutX;
}

// ---------------------------------------------------------------- MÜSTAKİL KONUT (v0.9 yerleşim motoru)
// Ön bant – koridor – arka bant düzeni korunur, ama:
//  * koridor dar (1.20–1.25 m); merdiven koridorda değil, arka (gerekirse ön) bantta kendi hacminde,
//    kollar hole dik, sahanlık cephede; rıht/basamak kat yüksekliğinden hesaplanır
//  * büyük yaşam mekânı (salon) binanın ucunda boydan boya: iki cepheden ışık alır, koridor kısalır
//  * açık mutfak / yemek salonla aynı hacimde (aradaki duvar kalkar)
//  * küçük hacimler (giyinme, ebeveyn banyosu, kiler) ikili sütunlarda gerçek alanına yakın kalır

const CORRIDOR = 1.25;

function houseLayout(program: Program, design: DesignOptions): BuildingLayout | null {
  const variant = design.variant ?? 0;
  const W = round2(program.footprint.width);
  const D = round2(program.footprint.depth);
  const H = program.floorHeight;
  const multi = program.floors.length > 1;
  if (W < 6 || D < 6.5) return null;
  const hallDepth = multi ? CORRIDOR : 1.2;
  const adj = program.adjacencies ?? [];
  const parking = program.floors.flatMap((f) => f.rooms.filter(isParking)).map((r) => {
    const m = /(\d+)\s*(araç|araba|otomobil)/i.exec(`${r.name} ${r.note}`);
    return { name: r.name, area: r.area, cars: Math.max(1, Math.min(6, m ? +m[1] : Math.round(r.area / 12.5))) };
  });
  const flip = variant === 1, reverse = variant === 2;
  const sc = multi ? stairCalc(H) : null;
  const stairArea = sc ? sc.width * sc.len : 0;
  const assignments = program.floors.map((f) => {
    const a = assignBands(f.rooms.filter((r) => !isParking(r)), { flip, reverse, modern: true, adj: adj.filter((x) => hasRoom(f.rooms, x.a) && hasRoom(f.rooms, x.b)) });
    return a;
  });

  // Boydan boya uç mekân (salon): kat alanından payı oranında genişlik
  const ends = assignments.map((a) => {
    const all = [...a.front, ...a.back];
    if (all.length < 4) return null;
    const cand = all.filter((r) => r.type === "salon").sort((p, q) => q.area - p.area)[0];
    if (!cand) return null;
    const tot = sumArea(all) + Math.max(sumArea(a.hallRooms), hallDepth * W * 0.7) + (sc ? sc.width * sc.len : 0);
    const w = round2(Math.min(W * 0.48, Math.max(3.4, (W * D * cand.area) / tot / D)));
    if (W - w < (sc ? sc.width + 2.6 : 5)) return null;
    for (const band of [a.front, a.back]) {
      const i = band.indexOf(cand);
      if (i >= 0) band.splice(i, 1);
    }
    // salonla bağlantılı mekân (mutfak / yemek) bandın sonuna, salona komşu
    for (const band of [a.front, a.back]) {
      const tie = (r: Room) => r.type === "yemek" ? 2 : r.type === "mutfak" ? 1 : 0;
      const k = band.reduce((bi, r, i) => (tie(r) > (bi < 0 ? 0 : tie(band[bi])) ? i : bi), -1);
      if (k >= 0) {
        const [m] = band.splice(k, 1);
        // mutfağa bitişik istenen (kiler) hemen önüne
        const partners = adj.filter((x) => x.relation === "bitisik" && (sameName(x.a, m.name) || sameName(x.b, m.name))).map((x) => (sameName(x.a, m.name) ? x.b : x.a));
        const pi = band.findIndex((r) => partners.some((n) => sameName(n, r.name)) && r.type !== "salon");
        if (pi >= 0) { const [pr] = band.splice(pi, 1); band.push(pr); }
        band.push(m);
      }
    }
    return { room: cand, w };
  });
  // Bantları dengele: arka banda merdiven de yazılır; ağır banttan hafife, en çok iyileştiren odayı taşı
  assignments.forEach((a) => { rebalance(a, sc ? stairArea : 0, adj); orderSuite(a); });

  // Ön bant derinliği: katların alan paylarından (merdiven arka banda yazılır)
  const shares = assignments
    .map((a, i) => ({ f: sumArea(a.front), b: sumArea(a.back) + stairArea, endW: ends[i]?.w ?? 0 }))
    .filter((s) => s.f + s.b > 0)
    .map((s) => s.f / (s.f + s.b));
  const share = shares.length ? shares.reduce((s, v) => s + v, 0) / shares.length : 0.5;
  const avail = D - hallDepth;
  let frontDepth = round2(avail * Math.min(0.62, Math.max(0.38, share)));
  if (design.frontDepth != null) frontDepth = round2(Math.min(avail - 2.4, Math.max(2.4, design.frontDepth)));
  let stairBand: "front" | "back" = "back";
  if (sc) {
    if (avail - frontDepth < sc.len) {
      if (avail - sc.len >= 2.5) frontDepth = round2(avail - sc.len);
      else if (frontDepth >= sc.len && avail - frontDepth >= 2.4) stairBand = "front";
      else if (avail - 2.5 >= sc.len) { frontDepth = round2(sc.len); stairBand = "front"; }
      else return null;
    }
  }
  const hallBand = { y: frontDepth, h: hallDepth };
  let stair: Rect | null = null;
  let stairInfo: StairInfo | undefined;
  if (sc) {
    const by = stairBand === "back" ? hallBand.y + hallBand.h : 0;
    const bh = stairBand === "back" ? round2(D - by) : frontDepth;
    stair = { x: 0, y: by, w: sc.width, h: bh };
    stairInfo = { axis: "y", sign: stairBand === "back" ? 1 : -1, risers: sc.risers, riser: sc.riser, tread: sc.tread, flightW: sc.flightW, landing: round2(bh - sc.run) };
  }

  // Sütunlar asgari genişliklerine sığmıyorsa küçük hacimleri öbür banda taşı
  assignments.forEach((a, i) => {
    const xEnd = W - (ends[i]?.w ?? 0);
    const fw = xEnd - (stair && stairBand === "front" ? stair.w : 0);
    const bw = xEnd - (stair && stairBand === "back" ? stair.w : 0);
    fitWidths(a, fw, bw, frontDepth, D - frontDepth - hallDepth);
  });

  const floors = program.floors.map((f, i) =>
    houseFloor(f.level, f.name, assignments[i], ends[i], {
      W, D, hallBand, stair, stairBand, isGround: f.level === groundLevelOf(program), H, cols: design.cols ?? {}, windowStyle: program.facade?.windowStyle,
      adj: adj.filter((a) => hasRoom(f.rooms, a.a) && hasRoom(f.rooms, a.b)),
    }),
  );

  const sx = stair ? stair.w : 0;
  const cutX = pickCut(floors, W, sx);
  const topFloor = program.floors[program.floors.length - 1]?.level ?? 0;
  return {
    W, D, H, slab: SLAB, extWall: EXT, intWall: INT, roof: program.roof, stair, hallBand,
    floors, cutX, totalHeight: (topFloor + 1) * H, roofHeight: program.roof === "duz" ? 0.9 : round2(Math.min(W, D) * 0.5 * 0.4 + 0.3),
    variant, parking, stairInfo,
  };
}

interface HouseCtx extends Ctx { stairBand: "front" | "back"; adj: Adjacency[] }

function houseFloor(level: number, name: string, asg: Assignment, end: { room: Room; w: number } | null, ctx: HouseCtx): FloorLayout {
  const { W, D, hallBand, stair, stairBand } = ctx;
  const placed: PlacedRoom[] = [];
  const cols: FloorLayout["cols"] = [];
  let uid = 0;
  const id = (p: string) => `L${level}-${p}${uid++}`;
  const colSpec = (band: "front" | "back") => {
    const key = `${level}-${band}`;
    const entry = { band, key, xs: [] as number[] };
    cols.push(entry);
    return { override: ctx.cols[key], report: (xs: number[]) => (entry.xs = xs) };
  };
  const endW = end?.w ?? 0;
  const xEnd = round2(W - endW);
  const sw = stair?.w ?? 0;
  const fx = stair && stairBand === "front" ? sw : 0;
  const bx = stair && stairBand === "back" ? sw : 0;
  const frontRect: Rect = { x: fx, y: 0, w: round2(xEnd - fx), h: hallBand.y };
  const by = hallBand.y + hallBand.h;
  const backRect: Rect = { x: bx, y: by, w: round2(xEnd - bx), h: round2(D - by) };
  const { front, back } = asg;
  if (front.length) placeBand(front, frontRect, "front", placed, id, hallBand.y, colSpec("front"));
  else placed.push(fillerRoom(level < 0 ? "Depo" : "Boş Alan", frontRect, "front", id));
  if (back.length) placeBand(back, backRect, "back", placed, id, by, colSpec("back"));
  else placed.push(fillerRoom(level < 0 ? "Depo" : "Boş Alan", backRect, "back", id));
  if (end) {
    const r = end.room;
    placed.push({ id: id(r.type), name: r.name, type: r.type, zone: r.zone, requestedArea: r.area, rect: { x: xEnd, y: 0, w: endW, h: D }, band: "front" });
  }
  const hallName = asg.hallRooms[0]?.name ?? (ctx.isGround ? "Hol" : "Kat Holü");
  const hall: PlacedRoom = {
    id: id("hol"), name: hallName, type: "hol", zone: "sirkulasyon", requestedArea: sumArea(asg.hallRooms),
    rect: { x: 0, y: hallBand.y, w: xEnd, h: hallBand.h }, band: "hall",
  };
  placed.push(hall);
  if (stair) placed.push({ id: id("mrd"), name: "Merdiven", type: "merdiven", zone: "sirkulasyon", requestedArea: 0, rect: { ...stair }, band: "hall" });

  const openings = makeOpenings(placed, ctx, id);

  // Açık plan: salona komşu açık mutfak / yemek arasında duvar yok
  const openEdges: SharedEdge[] = [];
  if (stair) {
    const e = sharedEdge(stair, hall.rect);
    if (e) openEdges.push(e);
  }
  const salon = placed.find((p) => p.type === "salon" && p.band !== "hall");
  if (salon) {
    for (const p of placed) {
      if (p === salon || p.band === "hall") continue;
      const isOpen = p.type === "yemek" || (p.type === "mutfak" && (/açık|acik|amerikan/i.test(`${p.name}`) || /açık|acik|amerikan/i.test(asg.front.concat(asg.back).find((r) => r.name === p.name)?.note ?? "")
        || ctx.adj.some((a) => a.relation === "bitisik" && ((sameName(a.a, p.name) && sameName(a.b, salon.name)) || (sameName(a.b, p.name) && sameName(a.a, salon.name))))));
      if (!isOpen) continue;
      const e = sharedEdge(p.rect, salon.rect);
      if (e && e.len > 1.5) openEdges.push(e);
    }
  }
  // açık kenarlardaki kapıları kaldır
  for (let i = openings.length - 1; i >= 0; i--) {
    const o = openings[i];
    if (o.exterior) continue;
    if (openEdges.some((e) => e.orient === o.orient && near(e.line, o.line) && o.center > e.a && o.center < e.b)) openings.splice(i, 1);
  }
  // açık mutfağın hole de kapısı yoksa (yalnız salondan giriliyor) sorun değil

  const outdoor = placeOutdoors(asg.outdoorRooms, placed, openings, W, D, id);

  const wallRooms = placed.filter((p) => p !== hall && p.type !== "merdiven").concat([{ ...hall, id: "band" }]);
  if (stair) wallRooms.push({ ...hall, id: "stairwell", rect: stair });
  let wallLines = buildWallLines(wallRooms, W, D);
  wallLines = cutWallLines(wallLines, openEdges);
  const walls = subtractOpenings(wallLines, openings);
  return { level, name, z: level * ctx.H, rooms: placed, openings, walls, wallLines, outdoor, cols };
}

/** İç duvar çizgilerinden verilen kenar parçalarını çıkarır (açık plan). */
function cutWallLines(lines: WallPiece[], cuts: SharedEdge[]): WallPiece[] {
  const out: WallPiece[] = [];
  for (const l of lines) {
    if (l.exterior) { out.push(l); continue; }
    const cs = cuts.filter((c) => c.orient === l.orient && near(c.line, l.line)).map((c) => [c.a + INT / 2, c.b - INT / 2] as [number, number]).sort((p, q) => p[0] - q[0]);
    let start = l.a;
    for (const [c0, c1] of cs) {
      if (c1 <= start || c0 >= l.b) continue;
      if (c0 - start > 0.05) out.push({ ...l, a: start, b: c0 });
      start = Math.max(start, c1);
    }
    if (l.b - start > 0.05) out.push({ ...l, a: start, b: l.b });
  }
  return out;
}

/** Ön/arka bant alanlarını dengeler (giriş ön bantta kalır, süit ve bitişik çiftler birlikte taşınır). */
function rebalance(a: Assignment, backExtra: number, adj: Adjacency[]) {
  const pinned = (r: Room) => r.type === "antre" || r.type === "garaj";
  const partnersOf = (r: Room, band: Room[]) => {
    const names = adj.filter((x) => x.relation === "bitisik" && (sameName(x.a, r.name) || sameName(x.b, r.name))).map((x) => (sameName(x.a, r.name) ? x.b : x.a));
    const suite = /ebeveyn/i.test(r.name) || r.type === "giyinme" || r.type === "ebeveyn";
    return band.filter((q) => q !== r && (names.some((n) => sameName(n, q.name)) || (suite && (/ebeveyn/i.test(q.name) || q.type === "giyinme" || q.type === "ebeveyn"))));
  };
  for (let it = 0; it < 6; it++) {
    const f = sumArea(a.front), b = sumArea(a.back) + backExtra;
    const diff = f - b;
    if (Math.abs(diff) < (f + b) * 0.12) return;
    const [from, to] = diff > 0 ? [a.front, a.back] : [a.back, a.front];
    let best: Room[] | null = null, bestGain = 0;
    for (const r of from) {
      if (pinned(r)) continue;
      const grp = [r, ...partnersOf(r, from)];
      if (grp.some(pinned) || grp.length >= from.length) continue;
      const m = sumArea(grp);
      const nd = Math.abs(Math.abs(diff) - 2 * m);
      // gece/gündüz bölgesini bozmamak için servis odalarına öncelik
      const zonePenalty = grp.some((q) => q.zone === "gunduz" || q.zone === "gece") ? (f + b) * 0.08 : 0;
      const gain = Math.abs(diff) - nd - zonePenalty;
      if (gain > bestGain) { bestGain = gain; best = grp; }
    }
    if (!best) return;
    for (const r of best) from.splice(from.indexOf(r), 1);
    // taşınan oda bandın girişe yakın ucuna değil, sonuna eklenir (salon tarafı)
    const tail = to.length && (to[to.length - 1].type === "mutfak" || to[to.length - 1].type === "yemek") ? to.length - 1 : to.length;
    to.splice(tail, 0, ...best);
  }
}

/** Giriş katı: sıfır ya da üstündeki ilk kat (bodrum varsa onun üstü). */
function groundLevelOf(program: Program) {
  return program.floors.find((f) => f.level >= 0)?.level ?? program.floors[0]?.level ?? 0;
}

/** Ebeveyn süiti: giyinme yatak odasının hemen yanında, ebeveyn banyosu giyinmenin ardında (yatak → giyinme → banyo). */
function orderSuite(a: Assignment) {
  const isEnsuiteBath = (r: Room) => r.type === "banyo" && /ebeveyn/i.test(r.name);
  for (const band of [a.front, a.back]) {
    const bi = band.findIndex((r) => r.type === "ebeveyn");
    if (bi < 0) continue;
    const other = band === a.front ? a.back : a.front;
    // başka banttaki giyinme / ebeveyn banyosu bu banda gelsin
    for (let i = other.length - 1; i >= 0; i--) if (other[i].type === "giyinme" || isEnsuiteBath(other[i])) band.push(...other.splice(i, 1));
    const suite = band.filter((r) => r.type === "giyinme").concat(band.filter(isEnsuiteBath));
    if (!suite.length) continue;
    for (const r of suite) band.splice(band.indexOf(r), 1);
    const e = band.findIndex((r) => r.type === "ebeveyn");
    // ebeveyn bandın sonundaysa süit önüne, değilse ardına
    if (e === band.length - 1 && e > 0) band.splice(e, 0, ...suite.reverse());
    else band.splice(e + 1, 0, ...suite);
  }
}

/** Bant genişliği, odaların asgari genişlikleri toplamından darsa taşınabilir küçük hacimleri öbür banda aktarır. */
function fitWidths(a: Assignment, fw: number, bw: number, fd: number, bd: number) {
  const need = (band: Room[], depth: number) => band.reduce((s, r) => s + Math.max(MIN_WIDTH[r.type] ?? 2.4, (r.area * 0.95) / Math.max(1, depth)), 0);
  const movable = (r: Room) => !(r.type === "antre" || r.type === "garaj" || r.type === "ebeveyn" || viaNeighbour(r) || r.type === "salon");
  for (let it = 0; it < 4; it++) {
    const of = need(a.front, fd) - fw, ob = need(a.back, bd) - bw;
    if (of <= 0.05 && ob <= 0.05) return;
    const [from, to, slack] = of > ob ? [a.front, a.back, bw - need(a.back, bd)] : [a.back, a.front, fw - need(a.front, fd)];
    const cand = from.filter(movable).sort((p, q) => p.area - q.area);
    const r = cand.find((q) => Math.max(MIN_WIDTH[q.type] ?? 2.4, q.area / Math.max(1, to === a.front ? fd : bd)) <= slack + 0.3);
    if (!r) return;
    from.splice(from.indexOf(r), 1);
    // ıslak hacimleri öbür bantta ıslak hacim ya da merdiven yanına koy
    const wi = to.findIndex((q) => WET.includes(q.type));
    to.splice(wi >= 0 ? wi : to.length, 0, r);
  }
}
