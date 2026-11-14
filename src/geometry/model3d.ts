// Yerleşimden Three.js modeli üretir. Plan (x, y) → sahne (x, -?) eşlemesi:
// sahne X = plan x, sahne Y = yükseklik (z), sahne Z = plan y (ön cephe z=0, arka cephe z=D).
import * as THREE from "three";
import type { BuildingLayout, FloorLayout, Opening } from "./layout";
import { ZONE_COLORS, near } from "./layout";
import { furnishFloor, type FurnitureKind } from "./furniture";
import { DEFAULT_MATERIALS, normalizeFacade, type Facade, type Materials } from "../shared/schema";
import { texturedMaterial, worldUV } from "./materials3d";
import { legacyStairInfo, stairGeom } from "./stair";

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
  if (fac.accentPlacement === "kose") {
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
  if (fac.cornice) {
    for (const f of visible.slice(1)) {
      g.add(box(L.W + t + 0.16, 0.16, 0.12, mats.slab, L.W / 2, f.z - 0.05, -t / 2 - 0.06));
      g.add(box(L.W + t + 0.16, 0.16, 0.12, mats.slab, L.W / 2, f.z - 0.05, L.D + t / 2 + 0.06));
    }
    g.add(box(L.W + t + 0.3, 0.22, L.D + t + 0.3, mats.slab, L.W / 2, top + 0.02, L.D / 2));
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  root.add(g);
}

const FURN_MATS: Partial<Record<FurnitureKind, THREE.Material>> = {
  bed: new THREE.MeshStandardMaterial({ color: 0xe9e4f2, roughness: 0.9 }),
  sofa: new THREE.MeshStandardMaterial({ color: 0x8a9aa8, roughness: 0.9 }),
  armchair: new THREE.MeshStandardMaterial({ color: 0x8a9aa8, roughness: 0.9 }),
  wc: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }),
  basin: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }),
  bathtub: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }),
  shower: new THREE.MeshStandardMaterial({ color: 0xcfdde6, roughness: 0.3 }),
  car: new THREE.MeshStandardMaterial({ color: 0x5d6b7a, roughness: 0.4, metalness: 0.4 }),
};

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

export function buildModel(L: BuildingLayout, opts: ModelOptions, site?: { width: number; depth: number; offsetX: number; offsetY: number }): THREE.Group {
  useMaterials(opts);
  const root = new THREE.Group();
  root.name = "Bina";
  const visible = L.floors.filter((f) => opts.maxLevel == null || f.level <= opts.maxLevel);
  const topVisible = visible[visible.length - 1];
  const isTopAll = !topVisible || topVisible.level === L.floors[L.floors.length - 1].level;

  // Arsa zemini
  if (site) {
    const pg = new THREE.PlaneGeometry(site.width, site.depth);
    if (opts.realistic) worldUV(pg, new THREE.Vector3(), 3);
    const g = new THREE.Mesh(pg, mats.ground);
    g.rotation.x = -Math.PI / 2;
    g.position.set(site.width / 2 - site.offsetX, -0.3, site.depth / 2 - site.offsetY);
    g.receiveShadow = true;
    g.name = "Arsa";
    root.add(g);
  }

  for (const f of visible) {
    const grp = new THREE.Group();
    grp.name = f.name;
    const cut = opts.cutaway && f === topVisible;
    addFloor(grp, L, f, cut);
    root.add(grp);
  }

  if (opts.realistic) addFacadeAccents(root, L, visible);
  if (site && opts.realistic) root.add(landscape(L, site, opts.entranceX, opts.avoid ?? []));

  // Çatı
  if (opts.showRoof && isTopAll) root.add(buildRoof(L));
  else if (topVisible && !opts.cutaway) {
    // tavan döşemesi
    const top = topVisible.z + L.H;
    root.add(box(L.W + L.extWall, L.slab, L.D + L.extWall, mats.slab, L.W / 2, top - L.slab / 2, L.D / 2, "Tavan"));
  }
  return root;
}

function addFloor(grp: THREE.Group, L: BuildingLayout, f: FloorLayout, cut: boolean) {
  const z0 = f.z;
  const wallH = cut ? 1.2 : L.H - L.slab;
  // Döşeme
  const lowest = f.level === L.floors[0].level;
  if (L.stair && !lowest) {
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
  for (const r of f.rooms) {
    const color = new THREE.Color(r.type === "merdiven" ? "#e6e2db" : ZONE_COLORS[r.zone] ?? "#eeeeee");
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r.rect.w, r.rect.h), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(r.rect.x + r.rect.w / 2, z0 + 0.005, r.rect.y + r.rect.h / 2);
    m.receiveShadow = true;
    m.name = r.name;
    grp.add(m);
  }
  // Mobilya (yalnızca kesik görünümde iç mekân görünür)
  if (cut) {
    for (const fu of furnishFloor(f)) {
      const mat = FURN_MATS[fu.kind] ?? mats.furn;
      const hh = Math.min(fu.height, 1.1); // kesik duvar yüksekliğini aşmasın
      grp.add(box(fu.w, hh, fu.h, mat, fu.x + fu.w / 2, z0 + hh / 2, fu.y + fu.h / 2, fu.kind));
    }
  }
  // Duvarlar
  const outerMat = f.z <= 0 ? mats.wallStone : mats.wall;
  for (const w of f.walls) {
    const len = w.b - w.a;
    const mid = (w.a + w.b) / 2;
    const mat = w.exterior ? outerMat : mats.inner;
    if (w.orient === "h") grp.add(box(len, wallH, w.thickness, mat, mid, z0 + wallH / 2, w.line));
    else grp.add(box(w.thickness, wallH, len, mat, w.line, z0 + wallH / 2, mid));
  }
  // Açıklıkların denizlik altı / lento üstü + cam / kapı kanadı
  for (const o of f.openings) addOpening(grp, L, f, o, wallH);
  // Merdiven
  if (L.stair && f !== L.floors[L.floors.length - 1]) addStair(grp, L, z0);
  else if (L.stair) addStairRail(grp, L, z0);
  // Balkon
  for (const o of f.outdoor) {
    const r = o.rect;
    if (f.z <= 0) {
      grp.add(box(r.w, 0.12, r.h, mats.slab, r.x + r.w / 2, z0 - 0.24, r.y + r.h / 2, o.name));
      continue;
    }
    grp.add(box(r.w, 0.18, r.h, mats.slab, r.x + r.w / 2, z0 - 0.09, r.y + r.h / 2, o.name));
    const edge = r.y < 0 ? r.y : r.y + r.h; // dış kenar
    if (fac.balconyRail === "dolu") {
      // dolu parapet (cephe malzemesi)
      grp.add(box(r.w, 1.05, 0.15, mats.wall, r.x + r.w / 2, z0 + 0.52, edge));
      grp.add(box(0.15, 1.05, r.h, mats.wall, r.x, z0 + 0.52, r.y + r.h / 2));
      grp.add(box(0.15, 1.05, r.h, mats.wall, r.x + r.w, z0 + 0.52, r.y + r.h / 2));
    } else if (fac.balconyRail === "metal") {
      // ince metal dikmeler + küpeşte
      for (let x = r.x + 0.06; x <= r.x + r.w; x += 0.12) grp.add(box(0.018, 1.0, 0.018, mats.rail, x, z0 + 0.5, edge));
      for (const sx of [r.x, r.x + r.w]) for (let y = r.y + 0.12; y < r.y + r.h; y += 0.12) grp.add(box(0.018, 1.0, 0.018, mats.rail, sx, z0 + 0.5, y));
      grp.add(box(r.w, 0.05, 0.05, mats.rail, r.x + r.w / 2, z0 + 1.03, edge));
      grp.add(box(0.05, 0.05, r.h, mats.rail, r.x, z0 + 1.03, r.y + r.h / 2));
      grp.add(box(0.05, 0.05, r.h, mats.rail, r.x + r.w, z0 + 1.03, r.y + r.h / 2));
    } else {
      // cam korkuluk
      grp.add(box(r.w, 1.0, 0.03, mats.glass, r.x + r.w / 2, z0 + 0.5, edge));
      grp.add(box(0.03, 1.0, r.h, mats.glass, r.x, z0 + 0.5, r.y + r.h / 2));
      grp.add(box(0.03, 1.0, r.h, mats.glass, r.x + r.w, z0 + 0.5, r.y + r.h / 2));
      grp.add(box(r.w, 0.05, 0.06, mats.rail, r.x + r.w / 2, z0 + 1.05, edge));
    }
  }
}

function addOpening(grp: THREE.Group, L: BuildingLayout, f: FloorLayout, o: Opening, wallH: number) {
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
  if (o.sill >= wallH) return;
  const h = head - o.sill;
  if (o.kind === "window" || o.kind === "balconyDoor") {
    grp.add(place(o.width, h, 0.03, mats.glass, z0 + o.sill + h / 2));
    // çerçeve
    grp.add(place(o.width, 0.05, t * 0.6, mats.frame, z0 + o.sill + 0.025));
    grp.add(place(o.width, 0.05, t * 0.6, mats.frame, z0 + head - 0.025));
    if (o.width > 1.2) grp.add(place(0.05, h, t * 0.6, mats.frame, z0 + o.sill + h / 2));
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
  if (info.axis === "x") grp.add(box(0.04, 1.0, fw, mats.glass, st.x + (info.sign === -1 ? st.w : 0), z0 + 0.5, st.y + fw / 2));
  else grp.add(box(fw, 1.0, 0.04, mats.glass, st.x + fw / 2, z0 + 0.5, info.sign === 1 ? st.y : st.y + st.h));
}

function buildRoof(L: BuildingLayout): THREE.Group {
  const g = new THREE.Group();
  g.name = "Çatı";
  const top = L.totalHeight;
  g.add(box(L.W + L.extWall, L.slab, L.D + L.extWall, mats.slab, L.W / 2, top - L.slab / 2, L.D / 2, "Çatı döşemesi"));
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

/** Peyzaj: dış zemin, sokak, yürüme yolu, ağaçlar, çit. Deterministik. */
function landscape(L: BuildingLayout, site: { width: number; depth: number; offsetX: number; offsetY: number }, entranceX: number | undefined, avoid: { x: number; y: number; w: number; d: number }[]) {
  const g = new THREE.Group();
  g.name = "Peyzaj";
  const sx0 = -site.offsetX, sz0 = -site.offsetY, sx1 = sx0 + site.width, sz1 = sz0 + site.depth;
  // çevre zemin (arsadan biraz koyu)
  const outer = new THREE.PlaneGeometry(site.width + 700, site.depth + 700);
  worldUV(outer, new THREE.Vector3(), 3);
  const om = new THREE.Mesh(outer, new THREE.MeshStandardMaterial({ map: (mats.ground as THREE.MeshStandardMaterial).map, color: 0xb9c6a8, roughness: 1 }));
  om.rotation.x = -Math.PI / 2;
  om.position.set((sx0 + sx1) / 2, -0.33, (sz0 + sz1) / 2);
  om.receiveShadow = true;
  g.add(om);
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
  const path = box(1.6, 0.06, Math.max(0.5, -sz0), texturedMaterial("paving"), ex, -0.27, sz0 / 2);
  g.add(path);
  // bahçe duvarı / çit (ön)
  const wallMat = mats.wallStone;
  g.add(box(Math.max(0, ex - 1.2 - sx0), 0.6, 0.25, wallMat, (sx0 + ex - 1.2) / 2, 0, sz0 + 0.12));
  g.add(box(Math.max(0, sx1 - ex - 1.2), 0.6, 0.25, wallMat, (ex + 1.2 + sx1) / 2, 0, sz0 + 0.12));
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
    if (Math.abs(x - ex) < 2.2 && z < 0) continue; // yürüme yolu
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
    tree.position.set(x, 0, z);
    tree.name = "Ağaç";
    g.add(tree);
    placed++;
  }
  // bina önüne çalılar
  const shrubM = new THREE.MeshStandardMaterial({ color: 0x5c7a3a, roughness: 0.9, flatShading: true });
  for (let x = 0.8; x < L.W - 0.5; x += 1.6) {
    if (Math.abs(x - ex) < 1.6) continue;
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), shrubM);
    s.position.set(x, -0.05, -0.8);
    s.scale.set(1.2, 0.8, 1);
    s.castShadow = true;
    g.add(s);
  }
  return g;
}

export { near };
