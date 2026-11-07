// Çok bloklu / apartman projeleri: blok tanımlarını, daire tiplerini katlara açar.
// Her blok, mevcut çizim zincirinin (plan, kesit, cephe, DXF, IFC) kullanabileceği
// sıradan bir "Program" görünümüne çevrilir; daireler katın içinde "units" olarak taşınır.
import type { Block, Floor, Program, Room, UnitType } from "../shared/schema";

export interface UnitSlot {
  /** Daire numarası, ör. "D5" */
  label: string;
  /** Daire tipi adı, ör. "3+1 Tip B" */
  type: string;
  /** single: tek katlı daire, lower/upper: dubleksin alt/üst katı */
  part: "single" | "lower" | "upper";
  rooms: Room[];
  /** Dubleks alt katında üst kat odaları (yerleşim iki katı birlikte çözer) */
  upperRooms?: Room[];
  /** Dairenin toplam kapalı alanı (dubleksin iki katı) */
  area: number;
}
export type ApFloor = Floor & { units?: UnitSlot[] };

export const isMultiBlock = (p: Program) => (p.blocks?.length ?? 0) > 0;

const norm = (s: string) => s.toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();
const isOutdoor = (r: Room) => r.zone === "dis" || r.type === "balkon" || r.type === "teras";

export function findUnitType(p: Program, name: string): UnitType | undefined {
  const list = p.unitTypes ?? [];
  return list.find((u) => norm(u.name) === norm(name)) ?? list.find((u) => norm(u.name).includes(norm(name)) || norm(name).includes(norm(u.name)));
}

/** sameAs zincirini çözer; her blok için tanımı (kat listesi + oturum) döndürür. */
export function resolveBlock(p: Program, i: number): Block {
  const blocks = p.blocks ?? [];
  let b = blocks[i];
  for (let k = 0; k < 4 && b && b.sameAs && !b.floors.length; k++) {
    const t = blocks.find((x) => x !== b && norm(x.name) === norm(b!.sameAs));
    if (!t) break;
    b = { ...t, name: blocks[i].name, sameAs: blocks[i].sameAs };
  }
  return b;
}

/** Blok tiplerini ayırt etmek için anahtar (aynı tanımlı bloklar aynı yerleşimi paylaşır). */
export function blockTypeKey(p: Program, i: number) {
  const blocks = p.blocks ?? [];
  let b = blocks[i];
  for (let k = 0; k < 4 && b && b.sameAs && !b.floors.length; k++) {
    const t = blocks.find((x) => x !== b && norm(x.name) === norm(b!.sameAs));
    if (!t) break;
    b = t;
  }
  return b ? b.name : String(i);
}

/** Bloğun kat listesini dairelere açar. */
export function expandBlock(p: Program, b: Block): ApFloor[] {
  const floors = [...b.floors].sort((a, c) => a.level - c.level);
  const out: ApFloor[] = [];
  let no = 0;
  const byLevel = new Map<number, ApFloor>();
  for (const f of floors) {
    const ap: ApFloor = { level: Math.round(f.level), name: f.name, rooms: (f.rooms ?? []).map((r) => ({ ...r })), units: [] };
    out.push(ap);
    byLevel.set(ap.level, ap);
  }
  for (const f of floors) {
    const ap = byLevel.get(Math.round(f.level))!;
    for (const tname of f.units ?? []) {
      const t = findUnitType(p, tname);
      if (!t) continue;
      const label = `D${++no}`;
      const tag = (r: Room): Room => ({ ...r, unit: label });
      const indoorArea = t.rooms.filter((r) => !isOutdoor(r)).reduce((s, r) => s + r.area, 0);
      const lower = t.rooms.filter((r) => !t.duplex || !r.upper).map(tag);
      const upper = t.duplex ? t.rooms.filter((r) => r.upper).map(tag) : [];
      const above = byLevel.get(ap.level + 1);
      const aboveOrig = floors.find((x) => Math.round(x.level) === ap.level + 1);
      const duplex = upper.length > 0 && !aboveOrig?.units?.length;
      if (!duplex) {
        // dubleksin üstü yoksa (ya da üst katta başka daire varsa) tek katta çöz
        ap.units!.push({ label, type: t.name, part: "single", rooms: [...lower, ...upper], area: indoorArea });
        continue;
      }
      ap.units!.push({ label, type: t.name, part: "lower", rooms: lower, upperRooms: upper, area: indoorArea });
      let up = above;
      if (!up) {
        up = { level: ap.level + 1, name: `${ap.level + 1}. Kat (dubleks üst)`, rooms: [], units: [] };
        byLevel.set(up.level, up);
        out.push(up);
      }
      up.units!.push({ label, type: t.name, part: "upper", rooms: upper, area: indoorArea });
    }
  }
  out.sort((a, c) => a.level - c.level);
  for (const f of out) f.rooms = [...f.rooms, ...(f.units ?? []).flatMap((u) => u.rooms)];
  return out.filter((f) => f.rooms.length > 0);
}

/** i. bloğun çizimler için program görünümü. Tek binalı projede programı aynen döndürür. */
export function blockView(p: Program, i = p.blockIndex ?? 0): Program {
  if (!isMultiBlock(p)) return p;
  const n = p.blocks!.length;
  const idx = Math.min(n - 1, Math.max(0, i));
  const b = resolveBlock(p, idx);
  const floors = expandBlock(p, b);
  return {
    ...p,
    projectName: n > 1 ? `${p.projectName} · ${p.blocks![idx].name}` : p.projectName,
    footprint: { width: b.footprint.width, depth: b.footprint.depth },
    floors,
    adjacencies: [],
    blockIndex: idx,
  };
}

/** Daire sayımı: tip → adet, ortalama alan (tüm bloklar) */
export function unitCounts(p: Program) {
  const rows = new Map<string, { type: string; count: number; area: number; outdoor: number; blocks: Set<string> }>();
  (p.blocks ?? []).forEach((blk, i) => {
    const b = resolveBlock(p, i);
    for (const f of b.floors)
      for (const tname of f.units ?? []) {
        const t = findUnitType(p, tname);
        if (!t) continue;
        const row = rows.get(t.name) ?? { type: t.name, count: 0, area: 0, outdoor: 0, blocks: new Set<string>() };
        row.count++;
        row.area = t.rooms.filter((r) => !isOutdoor(r)).reduce((s, r) => s + r.area, 0);
        row.outdoor = t.rooms.filter(isOutdoor).reduce((s, r) => s + r.area, 0);
        row.blocks.add(blk.name);
        rows.set(t.name, row);
      }
  });
  return [...rows.values()];
}
