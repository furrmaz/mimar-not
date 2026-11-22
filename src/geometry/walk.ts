// Birinci şahıs gezinti: kat planından çarpışma dünyası ve başlangıç noktası (plan koordinatı: x, y).
import type { BuildingLayout, FloorLayout, Rect } from "./layout";
import { WALKABLE, type Furniture } from "./furniture";

export interface WalkWorld {
  /** Geçilemeyen kutular: duvar parçaları, pencereler, merdiven boşluğu, mobilya */
  solid: Rect[];
  /** Üst katlarda yürünebilir alan (odalar + balkonlar); zemin katta null (bahçeye çıkılabilir) */
  inside: Rect[] | null;
  floorZ: number;
}

export const WALK_R = 0.22;

export function walkObstacles(L: BuildingLayout, f: FloorLayout, furniture: Furniture[]): WalkWorld {
  const solid: Rect[] = [];
  for (const w of f.walls) {
    const t = w.thickness / 2;
    solid.push(w.orient === "h" ? { x: w.a, y: w.line - t, w: w.b - w.a, h: 2 * t } : { x: w.line - t, y: w.a, w: 2 * t, h: w.b - w.a });
  }
  for (const o of f.openings) {
    // pencereden geçilmez; kapı, balkon kapısı, giriş ve geçitler açık
    if (o.kind !== "window" && o.sill < 0.5) continue;
    const t = (o.exterior ? L.extWall : L.intWall) / 2;
    const a = o.center - o.width / 2;
    solid.push(o.orient === "h" ? { x: a, y: o.line - t, w: o.width, h: 2 * t } : { x: o.line - t, y: a, w: 2 * t, h: o.width });
  }
  if (L.stair) solid.push(L.stair);
  for (const s of f.stairs ?? []) solid.push(s);
  for (const r of f.rooms) if (r.void || r.type === "merdiven") solid.push(r.rect);
  for (const fu of furniture) if (!WALKABLE.has(fu.kind)) solid.push({ x: fu.x, y: fu.y, w: fu.w, h: fu.h });
  const upper = f.z > 0.01;
  const inside = upper ? [...f.rooms.filter((r) => !r.void && r.type !== "merdiven").map((r) => r.rect), ...f.outdoor.map((o) => o.rect)] : null;
  return { solid, inside, floorZ: f.z };
}

const hit = (x: number, y: number, r: Rect, rad: number) => {
  const cx = Math.max(r.x, Math.min(x, r.x + r.w)), cy = Math.max(r.y, Math.min(y, r.y + r.h));
  return (x - cx) ** 2 + (y - cy) ** 2 < rad * rad;
};

export function walkBlocked(w: WalkWorld, x: number, y: number, rad = WALK_R): boolean {
  if (w.solid.some((r) => hit(x, y, r, rad))) return true;
  if (w.inside && !w.inside.some((r) => x >= r.x - 0.15 && x <= r.x + r.w + 0.15 && y >= r.y - 0.15 && y <= r.y + r.h + 0.15)) return true;
  return false;
}

/** Bir noktanın yakınında serbest yer (sarmal arama) */
export function freeNear(w: WalkWorld, x: number, y: number): { x: number; y: number } | null {
  if (!walkBlocked(w, x, y)) return { x, y };
  for (let r = 0.2; r < 3; r += 0.2)
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (!walkBlocked(w, px, py)) return { x: px, y: py };
    }
  return null;
}

/** Başlangıç: zemin katta girişin hemen içi (girişe sırtı dönük), değilse en büyük odanın ortası. yaw: kamera yönü (sahne Y ekseni çevresinde). */
export function walkSpawn(w: WalkWorld, f: FloorLayout): { x: number; y: number; yaw: number } {
  const inRoom = (x: number, y: number) => f.rooms.some((r) => !r.void && x > r.rect.x && x < r.rect.x + r.rect.w && y > r.rect.y && y < r.rect.y + r.rect.h);
  const ent = f.openings.find((o) => o.kind === "entrance" && o.width < 2.2);
  if (ent) {
    for (const s of [1, -1]) {
      const d = 0.9 * s;
      const x = ent.orient === "h" ? ent.center : ent.line + d, y = ent.orient === "h" ? ent.line + d : ent.center;
      const p = inRoom(x, y) && freeNear(w, x, y);
      if (p) {
        // içeri bakış: hareket yönü (dx, dy) → yaw; kamera -Z'ye bakarken yaw=0, plan y = sahne z
        const dx = ent.orient === "h" ? 0 : s, dy = ent.orient === "h" ? s : 0;
        return { ...p, yaw: Math.atan2(-dx, -dy) };
      }
    }
  }
  const rooms = f.rooms.filter((r) => !r.void && r.type !== "merdiven" && r.band !== "hall").sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h);
  for (const r of rooms) {
    const p = freeNear(w, r.rect.x + r.rect.w / 2, r.rect.y + r.rect.h / 2);
    if (p) return { ...p, yaw: 0 };
  }
  return { x: 1, y: 1, yaw: 0 };
}
