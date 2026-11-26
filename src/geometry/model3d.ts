// Yerleşimden Three.js modeli üretir. Plan (x, y) → sahne (x, -?) eşlemesi:
// sahne X = plan x, sahne Y = yükseklik (z), sahne Z = plan y (ön cephe z=0, arka cephe z=D).
import * as THREE from "three";
import type { BuildingLayout, FloorLayout, Opening } from "./layout";
import { ZONE_COLORS, near, siteLevels } from "./layout";
import { furnishFloor } from "./furniture";
import { furnitureMesh } from "./furniture3d";
import { DEFAULT_MATERIALS, normalizeFacade, type Facade, type Materials } from "../shared/schema";
import { texturedMaterial, worldUV } from "./materials3d";
import { legacyStairInfo, stairGeom } from "./stair";
import { floorRects, openingFacing, slabCells, unionCells } from "./massing";
import type { Rect } from "./layout";

/** Hücreleri dış kenarlarında yarım duvar kalınlığı kadar genişletir (döşeme duvar dış yüzüne kadar). */
function grow(cells: Rect[], e: number): Rect[] {
  const inAny = (x: number, y: number) => cells.some((c) => x > c.x + 1e-6 && x < c.x + c.w - 1e-6 && y > c.y + 1e-6 && y < c.y + c.h - 1e-6);
  return cells.map((c) => {
    const l = inAny(c.x - 0.02, c.y + c.h / 2) ? 0 : e, r = inAny(c.x + c.w + 0.02, c.y + c.h / 2) ? 0 : e;
    const f = inAny(c.x + c.w / 2, c.y - 0.02) ? 0 : e, b = inAny(c.x + c.w / 2, c.y + c.h + 0.02) ? 0 : e;
    return { x: c.x - l, y: c.y - f, w: c.w + l + r, h: c.h + f + b };
  });
}

export interface ModelOptions {
  showRoof: boolean;
  /** Bu kata kadar (dahil) göster; null = hepsi */
  maxLevel: number | null;
  /** Üst katın duvarlarını kesip içini gösterme (maket görünümü) */
  cutaway: boolean;
  /** Dokulu malzemeler, peyzaj (ağaç, yol, yürüme yolu) */
  realistic?: boolean;
  materials?: Materials;
  /** Cephe dili (renkler, vurgu yeri, korkuluk); referans görselden okunur */
  facade?: Facade;
  /** Giriş kapısının arsadaki yerine giden yürüme yolu için */
  entranceX?: number;
  /** Diğer blokların (yerel koordinatta) alanları: ağaç konmaz */
  avoid?: { x: number; y: number; w: number; d: number }[];
  /** Havuz (bina yerel koordinatında) */
  pool?: { x: number; y: number; w: number; h: number } | null;
  /** Tüm görünen katlarda mobilya (iç mekân gezintisi / düzenleme); kesik görünümde her zaman gösterilir */
  furniture?: boolean;
}

const BASE = {
  wall: new THREE.MeshStandardMaterial({ color: 0xf2ece2, roughness: 0.9 }),
  wallStone: new THREE.MeshStandardMaterial({ color: 0xd9cfbd, roughness: 0.95 }),
  inner: new THREE.MeshStandardMaterial({ color: 0xfbfaf7, roughness: 0.9 }),
  slab: new THREE.MeshStandardMaterial({ color: 0xbdb7ad, roughness: 0.8 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x9cc3de, roughness: 0.05, transmission: 0.6, transparent: true, opacity: 0.45, metalness: 0.1 }),
  frame: new THREE.MeshStandardMaterial({ color: 0x3c3c40, roughness: 0.6 }),
  door: new THREE.MeshStandardMaterial({ color: 0xa47448, roughness: 0.7 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x7b4a36, roughness: 0.85, side: THREE.DoubleSide }),
  ground: new THREE.MeshStandardMaterial({ color: 0xc9d8b6, roughness: 1 }),
  stair: new THREE.MeshStandardMaterial({ color: 0xd6d1c8, roughness: 0.8 }),
  furn: new THREE.MeshStandardMaterial({ color: 0xb08a63, roughness: 0.8 }),
  rail: new THREE.MeshStandardMaterial({ color: 0x2f3033, roughness: 0.4, metalness: 0.6 }),
};
/** Korkuluk yüksekliği: Planlı Alanlar İmar Yönetmeliği balkon, teras, galeri ve merdiven boşluğu korkulukları için en az 1.10 m */
export const RAIL_H = 1.1;
/** Bitmiş döşeme dış zeminden bu kadar yüksekse düşme tehlikesi var: korkuluk ve taşıyıcı gerekir */
const DROP = 0.6;
/** Katın dışındaki bitmiş zemin (yol altı arsada arsa / teras kotu, düz arsada yol kotu) */
function outsideGround(L: BuildingLayout) {
  return siteLevels(L).grade;
}
let mats: typeof BASE & { gable?: THREE.Material; accent?: THREE.Material } = { ...BASE };
let fac: Facade = normalizeFacade(undefined);

const REAL_GLASS = new THREE.MeshPhysicalMaterial({ color: 0x5f7684, roughness: 0.03, metalness: 0.0, transparent: true, opacity: 0.55, envMapIntensity: 2.2, clearcoat: 1 });
const REAL_FRAME = new THREE.MeshStandardMaterial({ color: 0x2e3033, roughness: 0.45, metalness: 0.5 });
const REAL_SLAB = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.85 });

const hexNum = (h: string) => parseInt(h.slice(1), 16);
/** Sıva türü malzemelerde beyaz doku cephe rengiyle boyanır; diğerlerinde (taş, tuğla, ahşap, beton) doku rengi korunur, hafifçe tonlanır. */
function facadeMat(kind: Materials["wall"], color: string, side?: THREE.Side) {
  if (kind.startsWith("siva")) return texturedMaterial("siva_beyaz", { color: hexNum(color), side });
  const c = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  // açık bir ton: dokunun deseni kalır, rengi görsele yaklaşır
  const tint = new THREE.Color().setHSL(hsl.h, Math.min(0.35, hsl.s), Math.max(0.78, hsl.l));
  return texturedMaterial(kind, { color: tint.getHex(), side });
}

function useMaterials(opts: ModelOptions) {
  fac = normalizeFacade(opts.facade, opts.materials ?? DEFAULT_MATERIALS);
  if (!opts.realistic) { mats = { ...BASE, accent: BASE.wallStone }; return; }
  const m = opts.materials ?? DEFAULT_MATERIALS;
  const roof =
    m.roof === "kiremit" ? texturedMaterial("tile", { side: THREE.DoubleSide, color: opts.facade ? new THREE.Color(fac.roofColor).lerp(new THREE.Color(0xffffff), 0.55).getHex() : undefined })
    : new THREE.MeshStandardMaterial({ color: opts.facade ? hexNum(fac.roofColor) : m.roof === "koyu_metal" ? 0x3a3d40 : 0x9a9d9f, roughness: 0.45, metalness: 0.55, side: THREE.DoubleSide });
  const wall = opts.facade ? facadeMat(m.wall, fac.wallColor) : texturedMaterial(m.wall);
  const accent = opts.facade ? facadeMat(m.accent, fac.accentColor) : texturedMaterial(m.accent);
  const frame = opts.facade ? new THREE.MeshStandardMaterial({ color: hexNum(fac.frameColor), roughness: 0.45, metalness: 0.4 }) : REAL_FRAME;
  mats = {
    ...BASE,
    wall,
    // zemin kat duvarı: vurgu yeri "zemin" ise vurgu malzemesi
    wallStone: fac.accentPlacement === "zemin" ? accent : wall,
    accent,
    inner: texturedMaterial("inner"),
    slab: REAL_SLAB,
    glass: REAL_GLASS,
    frame,
    rail: opts.facade ? frame : BASE.rail,
    door: texturedMaterial("ahsap"),
    roof,
    ground: texturedMaterial("grass"),
    gable: opts.facade ? facadeMat(m.wall, fac.wallColor, THREE.DoubleSide) : texturedMaterial(m.wall, { side: THREE.DoubleSide }),
  };
}

/** Vurgu malzemesinin köşe, dikey şerit ya da pencere çerçevesi olarak eklenmesi; saçak/silme bantları */
function addFacadeAccents(root: THREE.Group, L: BuildingLayout, visible: FloorLayout[]) {
  if (!visible.length) return;
  const acc = mats.accent ?? mats.wallStone;
  const z0 = visible[0].z;
  const top = visible[visible.length - 1].z + L.H;
  const h = top - z0;
  const t = L.extWall;
  const g = new THREE.Group();
  g.name = "Cephe vurguları";
  if (fac.accentPlacement === "kose" && !L.massing) {
    const w = Math.min(1.2, L.W * 0.08);
    for (const [x, z] of [[0, 0], [L.W, 0], [0, L.D], [L.W, L.D]] as const) {
      g.add(box(w, h, 0.06, acc, x + (x === 0 ? w / 2 - t / 2 : -w / 2 + t / 2), z0 + h / 2, z + (z === 0 ? -t / 2 - 0.03 : t / 2 + 0.03)));
      g.add(box(0.06, h, w, acc, x + (x === 0 ? -t / 2 - 0.03 : t / 2 + 0.03), z0 + h / 2, z + (z === 0 ? w / 2 - t / 2 : -w / 2 + t / 2)));
    }
  } else if (fac.accentPlacement === "dikey_serit") {
    // ön cephede giriş aksında (yoksa ortada) tam yükseklik vurgu şeridi
    const ent = L.floors[0]?.openings.find((o) => o.kind === "entrance" && o.orient === "h" && o.line <= 0.01);
    const cx = ent?.center ?? L.W / 2;
    const w = Math.min(2.4, L.W * 0.18);
    g.add(box(w, h + 0.3, 0.12, acc, Math.min(L.W - w / 2, Math.max(w / 2, cx)), z0 + (h + 0.3) / 2, -t / 2 - 0.06));
  }
  if (fac.accentPlacement === "cerceve" || fac.shutters) {
    for (const f of visible)
      for (const o of f.openings) {
        if (!o.exterior || o.kind !== "window") continue;
        const off = o.line <= 0.01 || (o.orient === "v" && o.line <= 0.01) ? -t / 2 - 0.04 : t / 2 + 0.04;
        const hh = o.head - o.sill;
        const zc = f.z + o.sill + hh / 2;
        const put = (len: number, hgt: number, d: number, m: THREE.Material, c: number, z: number, out: number) =>
          o.orient === "h" ? box(len, hgt, d, m, c, z, o.line + out) : box(d, hgt, len, m, o.line + out, z, c);
        if (fac.accentPlacement === "cerceve") {
          const fw = 0.14;
          g.add(put(o.width + 2 * fw, fw, 0.08, acc, o.center, f.z + o.head + fw / 2, off));
          g.add(put(o.width + 2 * fw, fw, 0.1, acc, o.center, f.z + o.sill - fw / 2, off));
          g.add(put(fw, hh, 0.08, acc, o.center - o.width / 2 - fw / 2, zc, off));
          g.add(put(fw, hh, 0.08, acc, o.center + o.width / 2 + fw / 2, zc, off));
        }
        if (fac.shutters && o.width <= 2.2) {
          const sw = o.width / 2;
          const sm = mats.door;
          g.add(put(sw, hh, 0.04, sm, o.center - o.width / 2 - sw / 2 - 0.05, zc, off * 1.3));
          g.add(put(sw, hh, 0.04, sm, o.center + o.width / 2 + sw / 2 + 0.05, zc, off * 1.3));
        }
      }
  }
  if (fac.cornice && !L.massing) {
    for (const f of visible.slice(1)) {
      g.add(box(L.W + t + 0.16, 0.16, 0.12, mats.slab, L.W / 2, f.z - 0.05, -t / 2 - 0.06));
      g.add(box(L.W + t + 0.16, 0.16, 0.12, mats.slab, L.W / 2, f.z - 0.05, L.D + t / 2 + 0.06));
    }
    g.add(box(L.W + t + 0.3, 0.22, L.D + t + 0.3, mats.slab, L.W / 2, top + 0.02, L.D / 2));
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  root.add(g);
}

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, name?: string) {
  const geo = new THREE.BoxGeometry(Math.max(w, 0.001), Math.max(h, 0.001), Math.max(d, 0.001));
  const tile = (mat as THREE.Material).userData?.tile as number | undefined;
  if (tile) worldUV(geo, new THREE.Vector3(x, y, z), tile);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  if (name) m.name = name;
  return m;
}

/** Cephe ayrıntıları: pergola, güneş kırıcı lameller, giriş çerçevesi, üst kat kutu çerçevesi, çatı feneri. */
function addFacadeDetails(root: THREE.Group, L: BuildingLayout, visible: FloorLayout[], withRoof: boolean) {
  const det = new Set(fac.details ?? []);
  if (!det.size || !visible.length) return;
  const g = new THREE.Group();
  g.name = "Cephe ayrıntıları";
  const wood = mats.door;
  const acc = mats.accent ?? mats.wallStone;
  const above = visible.filter((f) => f.z >= 0);
  const ground = above[0];
  const out = (side: string): [number, number] => (side === "front" ? [0, -1] : side === "back" ? [0, 1] : side === "left" ? [-1, 0] : [1, 0]);

  if (det.has("gunes_kirici")) {
    for (const f of above)
      for (const o of f.openings) {
        if (!o.exterior || o.kind !== "window" || o.width < 1.8 || o.sill > 0.6) continue;
        const side = openingFacing(f, L, o);
        if (!side) continue;
        const [dx, dz] = out(side);
        const h = o.head - o.sill + 0.3, zc = f.z + o.sill + h / 2 - 0.1;
        // pencerenin yarısını örten lamel dizisi (manzara açık kalır)
        const span = o.width * 0.5, start = o.center - o.width / 2;
        for (let u = start + 0.08; u <= start + span; u += 0.22) {
          if (o.orient === "h") g.add(box(0.05, h, 0.16, wood, u, zc, o.line + dz * 0.28));
          else g.add(box(0.16, h, 0.05, wood, o.line + dx * 0.28, zc, u));
        }
      }
  }
  if (det.has("giris_cercevesi") && ground) {
    const e = ground.openings.find((o) => o.kind === "entrance" && o.width < 2);
    const side = e && openingFacing(ground, L, e);
    if (e && side) {
      const [dx, dz] = out(side);
      const d = 0.7, w = e.width + 0.9, h = e.head + 0.35, t = 0.2;
      const put = (len: number, hh: number, c: number, y: number) =>
        e.orient === "h" ? box(len, hh, d, acc, c, y, e.line + dz * (d / 2 + 0.1)) : box(d, hh, len, acc, e.line + dx * (d / 2 + 0.1), y, c);
      g.add(put(t, h, e.center - w / 2, ground.z + h / 2));
      g.add(put(t, h, e.center + w / 2, ground.z + h / 2));
      g.add(put(w + t, t, e.center, ground.z + h));
    }
  }
  if (det.has("kutu_cerceve") && above.length > 1) {
    // en üst katın sokak cephesini saran ince çerçeve
    const f = above[above.length - 1];
    const xs = floorRects(f, L).filter((r) => r.y < 0.02);
    if (xs.length) {
      const x0 = Math.min(...xs.map((r) => r.x)) - L.extWall / 2, x1 = Math.max(...xs.map((r) => r.x + r.w)) + L.extWall / 2;
      const d = 0.45, t = 0.16, zf = -L.extWall / 2 - d / 2, h = L.H + (withRoof && L.roof === "duz" ? L.roofHeight : 0);
      g.add(box(x1 - x0, t, d, mats.slab, (x0 + x1) / 2, f.z + t / 2 - L.slab, zf));
      g.add(box(x1 - x0, t, d, mats.slab, (x0 + x1) / 2, f.z + h - t / 2, zf));
      g.add(box(t, h + L.slab, d, mats.slab, x0 + t / 2, f.z + h / 2 - L.slab / 2, zf));
      g.add(box(t, h + L.slab, d, mats.slab, x1 - t / 2, f.z + h / 2 - L.slab / 2, zf));
    }
  }
  if (det.has("pergola") && ground) {
    // bahçe cephesinde, en büyük yaşam mekânının önünde
    const hosts = ground.rooms.filter((r) => ["salon", "yemek", "mutfak"].includes(r.type)).sort((a, b) => b.rect.y + b.rect.h - (a.rect.y + a.rect.h) || b.rect.w - a.rect.w);
    const host = hosts[0];
    if (host) {
      const y0 = Math.max(host.rect.y + host.rect.h, ...ground.outdoor.filter((o) => o.carved === "sundurma" && o.rect.x < host.rect.x + host.rect.w && o.rect.x + o.rect.w > host.rect.x).map((o) => o.rect.y + o.rect.h)) + L.extWall / 2;
      const w = Math.min(Math.max(3, host.rect.w), 5.5), dp = 3, x0 = Math.min(L.W - w, Math.max(0, host.rect.x + host.rect.w / 2 - w / 2));
      const top = ground.z + 2.5;
      for (const x of [x0 + 0.08, x0 + w - 0.08]) g.add(box(0.14, 2.5 + 0.3, 0.14, wood, x, ground.z + 1.1, y0 + dp - 0.08));
      g.add(box(w, 0.18, 0.1, wood, x0 + w / 2, top, y0 + dp - 0.08));
      g.add(box(w, 0.18, 0.1, wood, x0 + w / 2, top, y0 + 0.06));
      for (let x = x0 + 0.15; x <= x0 + w - 0.1; x += 0.45) g.add(box(0.07, 0.14, dp + 0.4, wood, x, top + 0.16, y0 + dp / 2));
      const gy = outsideGround(L);
      if (ground.z - gy > DROP) {
        // dış zemin aşağıda (yol altı arsa): veranda havada bir teras olur; döşeme, korkuluk ve zemine inen dikmeler
        g.add(box(w, 0.18, dp, mats.slab, x0 + w / 2, ground.z - 0.1, y0 + dp / 2, "Veranda"));
        const ph = RAIL_H - 0.05, z1 = y0 + dp;
        g.add(box(w, ph, 0.03, mats.glass, x0 + w / 2, ground.z + ph / 2, z1));
        g.add(box(w, 0.05, 0.06, mats.rail, x0 + w / 2, ground.z + RAIL_H - 0.025, z1, "Korkuluk"));
        for (const x of [x0, x0 + w]) {
          g.add(box(0.03, ph, dp, mats.glass, x, ground.z + ph / 2, y0 + dp / 2));
          g.add(box(0.06, 0.05, dp, mats.rail, x, ground.z + RAIL_H - 0.025, y0 + dp / 2));
        }
        const ch = ground.z - 0.19 - gy;
        for (const x of [x0 + 0.08, x0 + w - 0.08]) g.add(box(0.25, ch, 0.25, mats.slab, x, gy + ch / 2, z1 - 0.15, "Veranda taşıyıcısı"));
      } else g.add(box(w, 0.06, dp, mats.slab, x0 + w / 2, ground.z - L.slab + 0.03, y0 + dp / 2, "Veranda"));
    }
  }
  if (det.has("cati_feneri") && withRoof && L.roof === "duz" && L.stair) {
    const st = L.stair, top = L.totalHeight;
    const w = Math.min(st.w, 1.8), d = Math.min(st.h, 2.4);
    // döşemede boşluk bırakılır (buildRoof), çevresinde 15 cm su basmanı
    for (const [cw, cd, cx, cz] of [[w + 0.3, 0.15, st.x + st.w / 2, st.y + st.h / 2 - d / 2 - 0.075], [w + 0.3, 0.15, st.x + st.w / 2, st.y + st.h / 2 + d / 2 + 0.075], [0.15, d, st.x + st.w / 2 - w / 2 - 0.075, st.y + st.h / 2], [0.15, d, st.x + st.w / 2 + w / 2 + 0.075, st.y + st.h / 2]] as const)
      g.add(box(cw, 0.15, cd, mats.slab, cx, top + 0.075, cz));
    g.add(box(w, 0.7, d, mats.glass, st.x + st.w / 2, top + 0.35, st.y + st.h / 2, "Çatı feneri"));
    g.add(box(w + 0.1, 0.06, d + 0.1, mats.frame, st.x + st.w / 2, top + 0.73, st.y + st.h / 2));
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  root.add(g);
}

export function buildModel(L: BuildingLayout, opts: ModelOptions, site?: { width: number; depth: number; offsetX: number; offsetY: number }): THREE.Group {
  useMaterials(opts);
  const root = new THREE.Group();
  root.name = "Bina";
  const visible = L.floors.filter((f) => opts.maxLevel == null || f.level <= opts.maxLevel);
  const topVisible = visible[visible.length - 1];
  const isTopAll = !topVisible || topVisible.level === L.floors[L.floors.length - 1].level;

  // Arsa zemini
  if (site) {
    const slope = L.siteSlope ?? 0;
    const pg = slope ? new THREE.PlaneGeometry(site.width, site.depth, Math.ceil(site.width / 0.75), Math.ceil(site.depth / 0.75)) : new THREE.PlaneGeometry(site.width, site.depth);
    if (slope) {
      // eğimli arsa: bina ve çevresi düz platform, platformun dışında doğal zemin eğimle sürer (şev / istinat)
      const pos = pg.attributes.position, cx = site.width / 2 - site.offsetX, cz = site.depth / 2 - site.offsetY;
      for (let i = 0; i < pos.count; i++) {
        const wx = cx + pos.getX(i), wy = cz - pos.getY(i);
        const flat = wy <= 0 || (wy < L.D + 1.5 && wx > -1.5 && wx < L.W + 1.5);
        pos.setZ(i, flat ? 0 : slope * wy);
      }
      pg.computeVertexNormals();
    }
    if (opts.realistic) worldUV(pg, new THREE.Vector3(), 3);
    const g = new THREE.Mesh(pg, mats.ground);
    g.rotation.x = -Math.PI / 2;
    g.position.set(site.width / 2 - site.offsetX, siteLevels(L).lot, site.depth / 2 - site.offsetY);
    g.receiveShadow = true;
    g.name = "Arsa";
    root.add(g);
  }

  for (const f of visible) {
    const grp = new THREE.Group();
    grp.name = f.name;
    const cut = opts.cutaway && f === topVisible;
    addFloor(grp, L, f, cut, !!opts.furniture, !!(opts.realistic || opts.furniture));
    root.add(grp);
  }

  if (opts.realistic) addFacadeAccents(root, L, visible);
  if (!opts.cutaway) addFacadeDetails(root, L, visible, isTopAll && opts.showRoof);
  if (site && siteLevels(L).sunken) root.add(sunkenSite(L, site, opts.entranceX, !!opts.realistic));
  if (site && opts.realistic) root.add(landscape(L, site, opts.entranceX, (opts.avoid ?? []).concat(opts.pool ? [{ x: opts.pool.x, y: opts.pool.y, w: opts.pool.w, d: opts.pool.h }] : [])));
  if (site && opts.pool) {
    const q = opts.pool, dk = 1.2;
    const dy = groundAt(L, site, q.x + q.w / 2, q.y + q.h / 2) + 0.3;
    const pg = new THREE.Group();
    pg.name = "Havuz";
    const deck = opts.realistic ? texturedMaterial("paving") : mats.slab;
    const gy = dy - 0.3; // havuzun çevresindeki bitmiş zemin
    // havuz başı (deck) çerçeve olarak: ortası boş, su yüzeyi kenar taşının altında (eskiden su deck'in üstünde kalıyordu)
    const cx = q.x + q.w / 2, cz = q.y + q.h / 2;
    for (const [w, d, x, z] of [[q.w + 2 * dk, dk, cx, q.y - dk / 2], [q.w + 2 * dk, dk, cx, q.y + q.h + dk / 2], [dk, q.h, q.x - dk / 2, cz], [dk, q.h, q.x + q.w + dk / 2, cz]] as const)
      pg.add(box(w, 0.08, d, deck, x, gy + 0.04, z, "Veranda"));
    // havuz kenar taşı (30 cm) ve iç yüzeyler
    const rim = 0.3;
    for (const [w, d, x, z] of [[q.w, rim, cx, q.y + rim / 2], [q.w, rim, cx, q.y + q.h - rim / 2], [rim, q.h - 2 * rim, q.x + rim / 2, cz], [rim, q.h - 2 * rim, q.x + q.w - rim / 2, cz]] as const)
      pg.add(box(w, 0.12, d, mats.slab, x, gy + 0.06, z, "Havuz kenarı"));
    pg.add(box(q.w - 2 * rim, 0.02, q.h - 2 * rim, new THREE.MeshPhysicalMaterial({ color: 0x3fa7cf, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.88 }), cx, gy + 0.03, cz, "Su"));
    root.add(pg);
  }

  // Çatı
  if (opts.showRoof && isTopAll) root.add(buildRoof(L));
  else if (topVisible && !opts.cutaway) {
    // tavan döşemesi
    const top = topVisible.z + L.H;
    if (L.massing) for (const c of grow(unionCells(floorRects(topVisible, L)), L.extWall / 2)) root.add(box(c.w, L.slab, c.h, mats.slab, c.x + c.w / 2, top - L.slab / 2, c.y + c.h / 2, "Tavan"));
    else root.add(box(L.W + L.extWall, L.slab, L.D + L.extWall, mats.slab, L.W / 2, top - L.slab / 2, L.D / 2, "Tavan"));
  }
  return root;
}

function addFloor(grp: THREE.Group, L: BuildingLayout, f: FloorLayout, cut: boolean, furnish = false, texturedFloors = false) {
  const z0 = f.z;
  const wallH = cut ? 1.2 : L.H - L.slab;
  // Döşeme
  const lowest = f.level === L.floors[0].level;
  if (L.massing) {
    for (const c of grow(slabCells(L, f, !lowest), L.extWall / 2)) grp.add(box(c.w, L.slab, c.h, mats.slab, c.x + c.w / 2, z0 - L.slab / 2, c.y + c.h / 2, "Döşeme"));
  } else if (L.stair && !lowest) {
    // merdiven boşluğu bırakılmış döşeme (boşluğun çevresinde dört parça)
    const st = L.stair, e = L.extWall / 2, y = z0 - L.slab / 2;
    const x0 = -e, x1 = L.W + e, y0 = -e, y1 = L.D + e;
    const part = (ax: number, bx: number, ay: number, by: number) => {
      if (bx - ax > 0.01 && by - ay > 0.01) grp.add(box(bx - ax, L.slab, by - ay, mats.slab, (ax + bx) / 2, y, (ay + by) / 2, "Döşeme"));
    };
    part(x0, x1, y0, Math.max(y0, st.y));
    part(x0, x1, Math.min(y1, st.y + st.h), y1);
    part(x0, Math.max(x0, st.x), st.y, st.y + st.h);
    part(Math.min(x1, st.x + st.w), x1, st.y, st.y + st.h);
  } else {
    grp.add(box(L.W + L.extWall, L.slab, L.D + L.extWall, mats.slab, L.W / 2, z0 - L.slab / 2, L.D / 2, "Döşeme"));
  }
  // Oda zemin renkleri
  // Galeri boşluğu: döşeme yok; dış duvar halkası döşeme kotunda sürer, hole bakan kenarda cam korkuluk
  for (const r of f.rooms.filter((q) => q.void)) {
    const a = r.rect;
    for (const w of f.wallLines) {
      if (!w.exterior) continue;
      const onEdge = w.orient === "h" ? near(w.line, a.y) || near(w.line, a.y + a.h) : near(w.line, a.x) || near(w.line, a.x + a.w);
      if (!onEdge) continue;
      const lo = Math.max(w.a, (w.orient === "h" ? a.x : a.y) - L.extWall / 2), hi = Math.min(w.b, (w.orient === "h" ? a.x + a.w : a.y + a.h) + L.extWall / 2);
      if (hi - lo < 0.05) continue;
      const mat = f.z <= 0 ? mats.wallStone : mats.wall;
      grp.add(w.orient === "h" ? box(hi - lo, L.slab, w.thickness, mat, (lo + hi) / 2, z0 - L.slab / 2, w.line) : box(w.thickness, L.slab, hi - lo, mat, w.line, z0 - L.slab / 2, (lo + hi) / 2));
    }
  }
  for (const rl of f.rails ?? []) {
    const len = rl.b - rl.a, mid = (rl.a + rl.b) / 2;
    grp.add(rl.orient === "h" ? box(len, RAIL_H - 0.05, 0.03, mats.glass, mid, z0 + (RAIL_H - 0.05) / 2, rl.line) : box(0.03, RAIL_H - 0.05, len, mats.glass, rl.line, z0 + (RAIL_H - 0.05) / 2, mid));
    grp.add(rl.orient === "h" ? box(len, 0.05, 0.06, mats.rail, mid, z0 + RAIL_H - 0.025, rl.line) : box(0.06, 0.05, len, mats.rail, rl.line, z0 + RAIL_H - 0.025, mid));
  }
  for (const r of f.rooms) {
    if (r.void) continue;
    const color = new THREE.Color(r.type === "merdiven" ? "#e6e2db" : ZONE_COLORS[r.zone] ?? "#eeeeee");
    const pg = new THREE.PlaneGeometry(r.rect.w, r.rect.h);
    let fm: THREE.Material = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
    if (texturedFloors) {
      // iç mekân kaplaması: ıslak hacim / servis seramik, yaşam ve yatak mekânları ahşap parke
      const wet = ["banyo", "wc", "camasir", "mutfak", "garaj", "teknik", "kiler", "depo", "merdiven"].includes(r.type);
      fm = texturedMaterial(wet ? "seramik" : "wood_floor");
      const uv = pg.getAttribute("uv") as THREE.BufferAttribute, pos = pg.getAttribute("position");
      const tile = (fm.userData.tile as number) ?? 1;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + r.rect.x + r.rect.w / 2) / tile, (pos.getY(i) - r.rect.y - r.rect.h / 2) / tile);
    }
    const m = new THREE.Mesh(pg, fm);
    m.rotation.x = -Math.PI / 2;
    m.position.set(r.rect.x + r.rect.w / 2, z0 + 0.005, r.rect.y + r.rect.h / 2);
    m.receiveShadow = true;
    m.name = r.name;
    grp.add(m);
  }
  // Mobilya (kesik görünümde ve iç mekân modunda)
  if (cut || furnish) {
    const fg = new THREE.Group();
    fg.name = "Mobilya";
    fg.userData.level = f.level;
    for (const fu of furnishFloor(f)) fg.add(furnitureMesh(fu, z0 + 0.006));
    grp.add(fg);
  }
  // Duvarlar
  const outerMat = f.z <= 0 ? mats.wallStone : mats.wall;
  for (const w of f.walls) {
    const len = w.b - w.a;
    const mid = (w.a + w.b) / 2;
    const mat = w.exterior ? outerMat : mats.inner;
    if (w.orient === "h") grp.add(box(len, wallH, w.thickness, mat, mid, z0 + wallH / 2, w.line));
    else grp.add(box(w.thickness, wallH, len, mat, w.line, z0 + wallH / 2, mid));
    // iç mekân modunda dış duvarın oda tarafına sıva yüzü (taş/tuğla doku içeride görünmesin)
    if (furnish && w.exterior) {
      const inRoom = (x: number, y: number) => f.rooms.some((r) => x > r.rect.x && x < r.rect.x + r.rect.w && y > r.rect.y && y < r.rect.y + r.rect.h);
      const off = w.thickness / 2 + 0.006;
      for (const s of [1, -1]) {
        const px = w.orient === "h" ? mid : w.line + s * (off + 0.05), py = w.orient === "h" ? w.line + s * (off + 0.05) : mid;
        if (!inRoom(px, py)) continue;
        if (w.orient === "h") grp.add(box(len, wallH, 0.01, mats.inner, mid, z0 + wallH / 2, w.line + s * off));
        else grp.add(box(0.01, wallH, len, mats.inner, w.line + s * off, z0 + wallH / 2, mid));
      }
    }
  }
  // Açıklıkların denizlik altı / lento üstü + cam / kapı kanadı
  for (const o of f.openings) addOpening(grp, L, f, o, wallH, furnish);
  // Merdiven
  if (L.stair && f !== L.floors[L.floors.length - 1]) addStair(grp, L, z0);
  else if (L.stair) addStairRail(grp, L, z0);
  // Balkon
  for (const o of f.outdoor) {
    const r = o.rect;
    if (o.carved === "teras") {
      // alt katın çatısı teras: döşeme zaten var; açık kenarlara korkuluk
      for (const sd of o.rails ?? []) {
        const hz = sd === "front" || sd === "back";
        const at = sd === "front" ? r.y : sd === "back" ? r.y + r.h : sd === "left" ? r.x : r.x + r.w;
        const len = hz ? r.w : r.h, mid = hz ? r.x + r.w / 2 : r.y + r.h / 2;
        const put = (l: number, h: number, d: number, m: THREE.Material, y: number) => (hz ? box(l, h, d, m, mid, y, at) : box(d, h, l, m, at, y, mid));
        if (fac.balconyRail === "dolu") grp.add(put(len, RAIL_H, 0.15, mats.wall, z0 + RAIL_H / 2));
        else {
          grp.add(put(len, RAIL_H - 0.05, 0.03, mats.glass, z0 + (RAIL_H - 0.05) / 2));
          grp.add(put(len, 0.05, 0.06, mats.rail, z0 + RAIL_H - 0.025));
        }
      }
      continue;
    }
    if (o.carved) {
      // sundurma / avlu döşemesi (zemin kaplaması)
      grp.add(box(r.w, 0.04, r.h, mats.slab, r.x + r.w / 2, z0 + 0.02 - L.slab, r.y + r.h / 2, o.name));
      continue;
    }
    // zemin kat balkonu ancak dış zemine oturuyorsa teras döşemesidir; yol altı arsada olduğu gibi zemin
    // aşağıdaysa havada kalan bir balkondur: döşeme + korkuluk + zemine inen taşıyıcılar
    const fall = z0 - outsideGround(L);
    if (f.z <= 0 && fall <= DROP) {
      grp.add(box(r.w, 0.12, r.h, mats.slab, r.x + r.w / 2, z0 - 0.24, r.y + r.h / 2, o.name));
      continue;
    }
    grp.add(box(r.w, 0.18, r.h, mats.slab, r.x + r.w / 2, z0 - 0.09, r.y + r.h / 2, o.name));
    const edge = r.y < 0 ? r.y : r.y + r.h; // dış kenar
    if (f.z <= 0) {
      const gy = outsideGround(L), ch = z0 - 0.18 - gy;
      for (const x of [r.x + 0.15, r.x + r.w - 0.15]) grp.add(box(0.25, ch, 0.25, mats.slab, x, gy + ch / 2, edge - Math.sign(edge - r.y - r.h / 2) * 0.15, "Balkon taşıyıcısı"));
    }
    if (fac.balconyRail === "dolu") {
      // dolu parapet (cephe malzemesi)
      grp.add(box(r.w, RAIL_H, 0.15, mats.wall, r.x + r.w / 2, z0 + RAIL_H / 2, edge, "Korkuluk"));
      grp.add(box(0.15, RAIL_H, r.h, mats.wall, r.x, z0 + RAIL_H / 2, r.y + r.h / 2));
      grp.add(box(0.15, RAIL_H, r.h, mats.wall, r.x + r.w, z0 + RAIL_H / 2, r.y + r.h / 2));
    } else if (fac.balconyRail === "metal") {
      // ince metal dikmeler + küpeşte
      const ph = RAIL_H - 0.05;
      for (let x = r.x + 0.06; x <= r.x + r.w; x += 0.12) grp.add(box(0.018, ph, 0.018, mats.rail, x, z0 + ph / 2, edge));
      for (const sx of [r.x, r.x + r.w]) for (let y = r.y + 0.12; y < r.y + r.h; y += 0.12) grp.add(box(0.018, ph, 0.018, mats.rail, sx, z0 + ph / 2, y));
      grp.add(box(r.w, 0.05, 0.05, mats.rail, r.x + r.w / 2, z0 + RAIL_H - 0.025, edge, "Korkuluk"));
      grp.add(box(0.05, 0.05, r.h, mats.rail, r.x, z0 + RAIL_H - 0.025, r.y + r.h / 2));
      grp.add(box(0.05, 0.05, r.h, mats.rail, r.x + r.w, z0 + RAIL_H - 0.025, r.y + r.h / 2));
    } else {
      // cam korkuluk
      const ph = RAIL_H - 0.05;
      grp.add(box(r.w, ph, 0.03, mats.glass, r.x + r.w / 2, z0 + ph / 2, edge));
      grp.add(box(0.03, ph, r.h, mats.glass, r.x, z0 + ph / 2, r.y + r.h / 2));
      grp.add(box(0.03, ph, r.h, mats.glass, r.x + r.w, z0 + ph / 2, r.y + r.h / 2));
      grp.add(box(r.w, 0.05, 0.06, mats.rail, r.x + r.w / 2, z0 + RAIL_H - 0.025, edge, "Korkuluk"));
    }
  }
}

function addOpening(grp: THREE.Group, L: BuildingLayout, f: FloorLayout, o: Opening, wallH: number, lining = false) {
  const t = o.exterior ? L.extWall : L.intWall;
  const z0 = f.z;
  const mat = o.exterior ? (f.z <= 0 ? mats.wallStone : mats.wall) : mats.inner;
  const place = (len: number, h: number, depth: number, m: THREE.Material, zc: number, offset = 0) =>
    o.orient === "h"
      ? box(len, h, depth, m, o.center, zc, o.line + offset)
      : box(depth, h, len, m, o.line + offset, zc, o.center);
  const head = Math.min(o.head, wallH);
  if (o.sill > 0 && o.sill < wallH) grp.add(place(o.width, o.sill, t, mat, z0 + o.sill / 2));
  if (wallH - head > 0.01) grp.add(place(o.width, wallH - head, t, mat, z0 + head + (wallH - head) / 2));
  if (lining && o.exterior) {
    // iç mekân: denizlik altı ve lento üstünün oda yüzü sıva
    const inRoom = (x: number, y: number) => f.rooms.some((r) => x > r.rect.x && x < r.rect.x + r.rect.w && y > r.rect.y && y < r.rect.y + r.rect.h);
    const off = t / 2 + 0.006;
    for (const s of [1, -1]) {
      const px = o.orient === "h" ? o.center : o.line + s * (off + 0.05), py = o.orient === "h" ? o.line + s * (off + 0.05) : o.center;
      if (!inRoom(px, py)) continue;
      if (o.sill > 0 && o.sill < wallH) grp.add(place(o.width, o.sill, 0.01, mats.inner, z0 + o.sill / 2, s * off));
      if (wallH - head > 0.01) grp.add(place(o.width, wallH - head, 0.01, mats.inner, z0 + head + (wallH - head) / 2, s * off));
    }
  }
  if (o.sill >= wallH) return;
  const h = head - o.sill;
  if (o.kind === "window" || o.kind === "balconyDoor") {
    grp.add(place(o.width, h, 0.03, mats.glass, z0 + o.sill + h / 2));
    // çerçeve
    grp.add(place(o.width, 0.05, t * 0.6, mats.frame, z0 + o.sill + 0.025));
    grp.add(place(o.width, 0.05, t * 0.6, mats.frame, z0 + head - 0.025));
    if (o.width > 1.2) grp.add(place(0.05, h, t * 0.6, mats.frame, z0 + o.sill + h / 2));
    // alçak denizlikli / yere kadar pencere düşme yüksekliğindeyse önünde 1.10 m cam korkuluk (Fransız balkon)
    if (o.kind === "window" && o.exterior && o.sill < RAIL_H - 0.2 && z0 - outsideGround(L) > DROP) {
      const out = o.orient === "h" ? (o.line < L.D / 2 ? -1 : 1) : o.line < L.W / 2 ? -1 : 1;
      const off = out * (t / 2 + 0.04);
      grp.add(place(o.width, RAIL_H - 0.05, 0.02, mats.glass, z0 + (RAIL_H - 0.05) / 2, off));
      grp.add(place(o.width, 0.05, 0.05, mats.rail, z0 + RAIL_H - 0.025, off));
    }
  } else if (o.kind === "entrance") {
    const m = place(o.width, h, 0.06, o.width > 2 ? mats.frame : mats.door, z0 + h / 2);
    grp.add(m);
  }
}

function addStair(grp: THREE.Group, L: BuildingLayout, z0: number) {
  const st = L.stair!;
  const g = stairGeom(st, L.stairInfo ?? legacyStairInfo(st, L.H), L.H);
  const T = 0.06;
  for (const f of g.flights) for (const s of f.steps) grp.add(box(s.rect.w, T, s.rect.h, mats.stair, s.rect.x + s.rect.w / 2, z0 + s.top - T / 2, s.rect.y + s.rect.h / 2));
  // sahanlık
  grp.add(box(g.landing.w, 0.15, g.landing.h, mats.stair, g.landing.x + g.landing.w / 2, z0 + g.landingTop - 0.075, g.landing.y + g.landing.h / 2));
  // kollar arası perde
  grp.add(box(Math.max(0.08, g.well.w), L.H * 0.9, Math.max(0.08, g.well.h), mats.inner, g.well.x + g.well.w / 2, z0 + L.H * 0.45, g.well.y + g.well.h / 2));
}

function addStairRail(grp: THREE.Group, L: BuildingLayout, z0: number) {
  const st = L.stair!;
  const info = L.stairInfo ?? legacyStairInfo(st, L.H);
  // en üst katta merdiven boşluğunun hole bakan kenarında cam korkuluk
  // yalnız 1. kolun (aşağı inen boşluğun) önünde; 2. koldan kata çıkılır
  const fw = info.flightW;
  if (info.axis === "x") grp.add(box(0.04, RAIL_H, fw, mats.glass, st.x + (info.sign === -1 ? st.w : 0), z0 + RAIL_H / 2, st.y + fw / 2, "Korkuluk"));
  else grp.add(box(fw, RAIL_H, 0.04, mats.glass, st.x + fw / 2, z0 + RAIL_H / 2, info.sign === 1 ? st.y : st.y + st.h, "Korkuluk"));
}

/** Düz çatıda merdiven üstündeki ışıklığın (çatı feneri) döşeme boşluğu */
function skylightHole(L: BuildingLayout): { x: number; y: number; w: number; h: number } | null {
  if (L.roof !== "duz" || !L.stair || !(fac.details ?? []).includes("cati_feneri")) return null;
  const st = L.stair, w = Math.min(st.w, 1.8), d = Math.min(st.h, 2.4);
  return { x: st.x + st.w / 2 - w / 2, y: st.y + st.h / 2 - d / 2, w, h: d };
}
/** Dikdörtgenden boşluğu çıkarır (en çok dört parça) */
function minusRect(c: { x: number; y: number; w: number; h: number }, h: { x: number; y: number; w: number; h: number } | null) {
  if (!h) return [c];
  const x0 = Math.max(c.x, h.x), x1 = Math.min(c.x + c.w, h.x + h.w), y0 = Math.max(c.y, h.y), y1 = Math.min(c.y + c.h, h.y + h.h);
  if (x1 - x0 < 0.01 || y1 - y0 < 0.01) return [c];
  const out = [
    { x: c.x, y: c.y, w: c.w, h: y0 - c.y },
    { x: c.x, y: y1, w: c.w, h: c.y + c.h - y1 },
    { x: c.x, y: y0, w: x0 - c.x, h: y1 - y0 },
    { x: x1, y: y0, w: c.x + c.w - x1, h: y1 - y0 },
  ];
  return out.filter((r) => r.w > 0.01 && r.h > 0.01);
}

function buildRoof(L: BuildingLayout): THREE.Group {
  const g = new THREE.Group();
  g.name = "Çatı";
  const top = L.totalHeight;
  const hole = skylightHole(L);
  if (L.massing && L.roof === "duz") {
    const tf = L.floors[L.floors.length - 1];
    for (const c0 of grow(unionCells(floorRects(tf, L)), L.extWall / 2)) for (const c of minusRect(c0, hole)) g.add(box(c.w, L.slab, c.h, mats.slab, c.x + c.w / 2, top - L.slab / 2, c.y + c.h / 2, "Çatı döşemesi"));
    const ph = L.roofHeight;
    for (const w of tf.wallLines) {
      if (!w.exterior) continue;
      const len = w.b - w.a, mid = (w.a + w.b) / 2;
      g.add(w.orient === "h" ? box(len, ph, w.thickness, mats.wall, mid, top + ph / 2, w.line) : box(w.thickness, ph, len, mats.wall, w.line, top + ph / 2, mid));
    }
    return g;
  }
  for (const c of minusRect({ x: -L.extWall / 2, y: -L.extWall / 2, w: L.W + L.extWall, h: L.D + L.extWall }, hole))
    g.add(box(c.w, L.slab, c.h, mats.slab, c.x + c.w / 2, top - L.slab / 2, c.y + c.h / 2, "Çatı döşemesi"));
  if (L.roof === "duz") {
    const ph = L.roofHeight;
    const t = L.extWall;
    g.add(box(L.W + t, ph, t, mats.wall, L.W / 2, top + ph / 2, 0));
    g.add(box(L.W + t, ph, t, mats.wall, L.W / 2, top + ph / 2, L.D));
    g.add(box(t, ph, L.D, mats.wall, 0, top + ph / 2, L.D / 2));
    g.add(box(t, ph, L.D, mats.wall, L.W, top + ph / 2, L.D / 2));
    return g;
  }
  const oh = 0.6;
  const rise = L.roofHeight;
  const x0 = -oh, x1 = L.W + oh, z0 = -oh, z1 = L.D + oh;
  const zm = L.D / 2;
  const slope = rise / (L.D / 2);
  const y0 = top - oh * slope;
  const yR = top + rise;
  const geo = new THREE.BufferGeometry();
  let verts: number[];
  if (L.roof === "besik") {
    verts = [
      // ön yüz
      x0, y0, z0, x1, y0, z0, x1, yR, zm,
      x0, y0, z0, x1, yR, zm, x0, yR, zm,
      // arka yüz
      x0, y0, z1, x0, yR, zm, x1, yR, zm,
      x0, y0, z1, x1, yR, zm, x1, y0, z1,
    ];
    // alınlık duvarları
    for (const xx of [0, L.W]) {
      const tri = new THREE.BufferGeometry();
      tri.setAttribute("position", new THREE.Float32BufferAttribute([xx, top, 0, xx, top, L.D, xx, yR - 0.2, zm], 3));
      tri.computeVertexNormals();
      if (mats.gable) {
        const uv: number[] = [];
        const pa = tri.getAttribute("position");
        for (let i = 0; i < pa.count; i++) uv.push(pa.getZ(i) / 2, pa.getY(i) / 2);
        tri.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      }
      const m = new THREE.Mesh(tri, mats.gable ?? new THREE.MeshStandardMaterial({ color: 0xf2ece2, side: THREE.DoubleSide }));
      m.castShadow = true;
      g.add(m);
    }
  } else {
    const inset = Math.min(L.W, L.D) / 2 + oh;
    const rx0 = x0 + inset, rx1 = Math.max(rx0, x1 - inset);
    verts = [
      x0, y0, z0, x1, y0, z0, rx1, yR, zm,
      x0, y0, z0, rx1, yR, zm, rx0, yR, zm,
      x0, y0, z1, rx0, yR, zm, rx1, yR, zm,
      x0, y0, z1, rx1, yR, zm, x1, y0, z1,
      x0, y0, z0, rx0, yR, zm, x0, y0, z1,
      x1, y0, z0, x1, y0, z1, rx1, yR, zm,
    ];
  }
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  {
    // çatı dokusu: plan (x, z) üzerinden, eğim yönünde uzatılmış
    const uv: number[] = [];
    const k = Math.sqrt(1 + slope * slope);
    for (let i = 0; i < verts.length; i += 3) uv.push(verts[i] / 1.0, (verts[i + 2] * k) / 1.0);
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  }
  const roof = new THREE.Mesh(geo, mats.roof);
  roof.castShadow = true;
  roof.name = "Çatı örtüsü";
  g.add(roof);
  return g;
}

/** Çukur arsada binanın oturduğu dolgu terasının sınırları (arsa koordinatına kırpılmış). */
function platformRect(L: BuildingLayout, site: { width: number; depth: number; offsetX: number; offsetY: number }) {
  const sx0 = -site.offsetX, sz0 = -site.offsetY, sx1 = sx0 + site.width, sz1 = sz0 + site.depth;
  const x0 = Math.max(sx0 + 0.3, -2.5), x1 = Math.min(sx1 - 0.3, L.W + 2.5);
  const z0 = Math.max(sz0 + 0.3, -4), z1 = Math.min(sz1 - 0.3, L.D + 5);
  return { x0, x1, z0, z1 };
}

/** Sahnedeki (x, z) noktasında bitmiş zemin kotu: yol kotunun altındaki arsada teras ya da arsa zemini. */
function groundAt(L: BuildingLayout, site: { width: number; depth: number; offsetX: number; offsetY: number }, x: number, z: number) {
  const lv = siteLevels(L);
  if (!lv.sunken) return lv.road;
  const p = platformRect(L, site);
  return x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1 ? lv.grade : lv.lot;
}

/** Yol kotunun altındaki (çukur / kazılmış) arsa: çevre istinat duvarları, sokaktan girişe köprü,
 *  arsa en alt kattan da aşağıdaysa binanın oturduğu dolgu terası. Bodrum cepheleri böylece açıkta kalır. */
function sunkenSite(L: BuildingLayout, site: { width: number; depth: number; offsetX: number; offsetY: number }, entranceX: number | undefined, realistic: boolean) {
  const lv = siteLevels(L);
  const g = new THREE.Group();
  g.name = "Çukur arsa";
  const sx0 = -site.offsetX, sz0 = -site.offsetY, sx1 = sx0 + site.width, sz1 = sz0 + site.depth;
  const concrete = realistic ? texturedMaterial("beton") : mats.slab;
  const t = 0.35, top = lv.road + 0.03, h = top - lv.lot, yc = (top + lv.lot) / 2;
  // İstinat duvarı yalnız sokak cephesinde ve ön bahçe boyunca iki yanda: yol altı arsa arkaya doğru alçalan
  // bir arazidir; komşular binanın gerisinde arsa kotuna şevle iner (dört yanı duvarla çevrili çukur değil).
  const zw = Math.min(sz1, Math.max(sz0 + 1, 0)); // yan duvarların bittiği yer: bina ön cephesi
  const sideLen = zw - sz0;
  g.add(box(site.width + 2 * t, h, t, concrete, (sx0 + sx1) / 2, yc, sz0 - t / 2, "İstinat duvarı"));
  g.add(box(t, h, sideLen, concrete, sx0 - t / 2, yc, sz0 + sideLen / 2, "İstinat duvarı"));
  g.add(box(t, h, sideLen, concrete, sx1 + t / 2, yc, sz0 + sideLen / 2, "İstinat duvarı"));
  // duvar dibinde drenaj kanalı (ızgaralı) — çukurda yağmur suyu birikmesin
  g.add(box(site.width, 0.04, 0.3, mats.frame, (sx0 + sx1) / 2, lv.lot + 0.02, sz0 + 0.15, "Drenaj kanalı"));
  for (const sx of [sx0 + 0.15, sx1 - 0.15]) g.add(box(0.3, 0.04, sideLen - 0.3, mats.frame, sx, lv.lot + 0.02, sz0 + 0.3 + (sideLen - 0.3) / 2, "Drenaj kanalı"));
  // duvarların üstünde korkuluk (1.10 m): sokak tarafında köprü aralığı dışında, yanlarda ön bahçe boyunca
  const railM = mats.rail ?? mats.frame;
  const ex = entranceX ?? L.W - 1, bw = 1.8;
  const ph = RAIL_H - 0.05;
  for (const [a, b] of [[sx0, ex - bw / 2], [ex + bw / 2, sx1]] as const) {
    if (b - a < 0.2) continue;
    g.add(box(b - a, 0.05, 0.05, railM, (a + b) / 2, top + RAIL_H - 0.025, sz0 - t / 2, "Korkuluk"));
    for (let x = a + 0.05; x <= b; x += 1.5) g.add(box(0.04, ph, 0.04, railM, x, top + ph / 2, sz0 - t / 2));
  }
  for (const x of [sx0 - t / 2, sx1 + t / 2]) {
    g.add(box(0.05, 0.05, sideLen, railM, x, top + RAIL_H - 0.025, sz0 + sideLen / 2, "Korkuluk"));
    for (let z = sz0 + 1.5; z <= zw; z += 1.5) g.add(box(0.04, ph, 0.04, railM, x, top + ph / 2, z));
  }
  // dolgu terası (bina en alt kat kotunda; altında arsa)
  if (lv.grade - lv.lot > 0.05) {
    const p = platformRect(L, site);
    const ph = lv.grade - lv.lot;
    g.add(box(p.x1 - p.x0, ph, p.z1 - p.z0, realistic ? texturedMaterial("tas") : mats.wallStone, (p.x0 + p.x1) / 2, lv.lot + ph / 2 - 0.01, (p.z0 + p.z1) / 2, "Dolgu terası"));
    g.add(box(p.x1 - p.x0, 0.04, p.z1 - p.z0, mats.ground, (p.x0 + p.x1) / 2, lv.grade + 0.01, (p.z0 + p.z1) / 2, "Teras bahçesi"));
    // terastan arsaya basamaklar (bahçe tarafı)
    const steps = Math.ceil(ph / 0.17), run = 0.3, sw = 1.4, sx = (p.x0 + p.x1) / 2;
    if (p.z1 + steps * run < sz1 - 0.3)
      for (let i = 0; i < steps; i++) {
        const sh = ph - i * (ph / steps);
        g.add(box(sw, sh, run, concrete, sx, lv.lot + sh / 2, p.z1 + run * (i + 0.5)));
      }
  }
  // köprü: kaldırımdan zemin kat girişine (yol kotunda)
  const len = Math.max(0.5, -sz0 + 0.3);
  const deckY = lv.road + 0.2;
  g.add(box(bw, 0.25, len, concrete, ex, deckY - 0.125, (sz0 - 0.3) / 2, "Köprü"));
  g.add(box(bw - 0.1, 0.03, len, realistic ? texturedMaterial("paving") : mats.slab, ex, deckY + 0.015, (sz0 - 0.3) / 2));
  for (const sx of [-1, 1]) {
    g.add(box(0.05, 0.05, len, railM, ex + sx * (bw / 2 - 0.03), deckY + 0.03 + RAIL_H - 0.025, (sz0 - 0.3) / 2, "Köprü korkuluğu"));
    g.add(box(0.02, RAIL_H - 0.05, len, mats.glass, ex + sx * (bw / 2 - 0.03), deckY + 0.03 + (RAIL_H - 0.05) / 2, (sz0 - 0.3) / 2));
  }
  // ara ayaklar
  for (let z = sz0 + 3; z < -0.8; z += 3.5) {
    const gy = groundAt(L, site, ex, z);
    g.add(box(0.3, deckY - 0.25 - gy, 0.3, concrete, ex, (deckY - 0.25 + gy) / 2, z, "Köprü ayağı"));
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/** Peyzaj: dış zemin, sokak, yürüme yolu, ağaçlar, çit. Deterministik. */
function landscape(L: BuildingLayout, site: { width: number; depth: number; offsetX: number; offsetY: number }, entranceX: number | undefined, avoid: { x: number; y: number; w: number; d: number }[]) {
  const g = new THREE.Group();
  g.name = "Peyzaj";
  const sx0 = -site.offsetX, sz0 = -site.offsetY, sx1 = sx0 + site.width, sz1 = sz0 + site.depth;
  const lv = siteLevels(L);
  // çevre zemin (arsadan biraz koyu); çukur arsada arsanın üstü açık kalır
  const outerMat = new THREE.MeshStandardMaterial({ map: (mats.ground as THREE.MeshStandardMaterial).map, color: 0xb9c6a8, roughness: 1 });
  // yol altı arsada: sokak ve ön bahçe hizasında komşular yol kotunda, bina gerisinde arsa kotuna şevle iner
  const zw = Math.min(sz1, Math.max(sz0 + 1, 0)), slopeLen = Math.min(5, Math.max(1.5, (lv.road - lv.lot) * 1.5));
  const outerRects: [number, number, number, number, number][] = lv.sunken
    ? [[sx0 - 350, sz0 - 350, site.width + 700, 350, -0.33], [sx0 - 350, sz0, 350, zw - sz0, -0.33], [sx1, sz0, 350, zw - sz0, -0.33],
      [sx0 - 350, zw + slopeLen, 350, Math.max(0.5, sz1 - zw - slopeLen), lv.lot - 0.03], [sx1, zw + slopeLen, 350, Math.max(0.5, sz1 - zw - slopeLen), lv.lot - 0.03],
      [sx0 - 350, sz1, site.width + 700, 350, lv.lot - 0.03]]
    : [[sx0 - 350, sz0 - 350, site.width + 700, site.depth + 700, -0.33]];
  for (const [x, z, w, d, y] of outerRects) {
    const outer = new THREE.PlaneGeometry(w, d);
    worldUV(outer, new THREE.Vector3(), 3);
    const om = new THREE.Mesh(outer, outerMat);
    om.rotation.x = -Math.PI / 2;
    om.position.set(x + w / 2, y, z + d / 2);
    om.receiveShadow = true;
    g.add(om);
  }
  if (lv.sunken) {
    // yan komşulardaki şev: yan istinat duvarının bittiği yerden arsa kotuna
    for (const [xa, xb] of [[sx0 - 350, sx0], [sx1, sx1 + 350]] as const) {
      const geo = new THREE.BufferGeometry();
      const y0 = -0.33, y1 = lv.lot - 0.03, z0 = zw, z1 = zw + slopeLen;
      geo.setAttribute("position", new THREE.Float32BufferAttribute([xa, y0, z0, xb, y0, z0, xb, y1, z1, xa, y0, z0, xb, y1, z1, xa, y1, z1], 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Array(12).fill(0), 2));
      geo.computeVertexNormals();
      worldUV(geo, new THREE.Vector3(), 3);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: outerMat.map, color: 0xb9c6a8, roughness: 1, side: THREE.DoubleSide }));
      m.name = "Şev";
      m.receiveShadow = true;
      g.add(m);
    }
  }
  // sokak (asfalt) + kaldırım
  const road = new THREE.Mesh(new THREE.PlaneGeometry(site.width + 700, 9), new THREE.MeshStandardMaterial({ color: 0x45474a, roughness: 0.95 }));
  road.rotation.x = -Math.PI / 2;
  road.position.set((sx0 + sx1) / 2, -0.31, sz0 - 6.5);
  road.receiveShadow = true;
  g.add(road);
  const walk = box(site.width + 700, 0.15, 2, texturedMaterial("paving"), (sx0 + sx1) / 2, -0.25, sz0 - 1);
  g.add(walk);
  // yürüme yolu: sokaktan girişe
  const ex = entranceX ?? L.W - 1;
  if (!lv.sunken) {
    const path = box(1.6, 0.06, Math.max(0.5, -sz0), texturedMaterial("paving"), ex, -0.27, sz0 / 2);
    g.add(path);
    // bahçe duvarı / çit (ön)
    const wallMat = mats.wallStone;
    g.add(box(Math.max(0, ex - 1.2 - sx0), 0.6, 0.25, wallMat, (sx0 + ex - 1.2) / 2, 0, sz0 + 0.12));
    g.add(box(Math.max(0, sx1 - ex - 1.2), 0.6, 0.25, wallMat, (ex + 1.2 + sx1) / 2, 0, sz0 + 0.12));
  }
  // ağaçlar
  const r = (() => { let s = Math.round(site.width * 131 + site.depth * 17) || 7; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; })();
  const trunkM = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 });
  const leaves = [0x5e7f3c, 0x6b8f45, 0x4f7034, 0x7a9a4e].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, flatShading: true }));
  const n = Math.min(22, Math.max(5, Math.round((site.width * site.depth) / 70)));
  let placed = 0;
  for (let tries = 0; tries < 400 && placed < n; tries++) {
    const x = sx0 + 1.5 + r() * (site.width - 3);
    const z = sz0 + 2 + r() * (site.depth - 3.5);
    if (x > -3 && x < L.W + 3 && z > -3 && z < L.D + 5) continue; // binadan ve terastan uzak
    if (avoid.some((a) => x > a.x - 3 && x < a.x + a.w + 3 && z > a.y - 3.5 && z < a.y + a.d + 3.5)) continue;
    if (Math.abs(x - ex) < 2.2 && z < 0) continue; // yürüme yolu / köprü
    if (lv.sunken && (x < sx0 + 1.2 || x > sx1 - 1.2 || z < sz0 + 1.5 || z > sz1 - 1.2)) continue; // istinat duvarına yapışmasın
    const h = 3 + r() * 4;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, h * 0.45, 7), trunkM);
    trunk.position.y = h * 0.225 - 0.3;
    trunk.castShadow = true;
    tree.add(trunk);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(h * 0.32, 1), leaves[Math.floor(r() * leaves.length)]);
    crown.position.y = h * 0.62 - 0.3;
    crown.scale.set(1, 0.85 + r() * 0.3, 1);
    crown.castShadow = true;
    crown.receiveShadow = true;
    tree.add(crown);
    tree.position.set(x, groundAt(L, site, x, z) + 0.3, z);
    tree.name = "Ağaç";
    g.add(tree);
    placed++;
  }
  // bina önüne çalılar
  const shrubM = new THREE.MeshStandardMaterial({ color: 0x5c7a3a, roughness: 0.9, flatShading: true });
  for (let x = 0.8; x < L.W - 0.5; x += 1.6) {
    if (Math.abs(x - ex) < 1.6) continue;
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), shrubM);
    s.position.set(x, lv.grade + 0.25, -0.8);
    s.scale.set(1.2, 0.8, 1);
    s.castShadow = true;
    g.add(s);
  }
  return g;
}

export { near };
