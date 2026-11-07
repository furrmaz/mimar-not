// Yerleşimden Three.js modeli üretir. Plan (x, y) → sahne (x, -?) eşlemesi:
// sahne X = plan x, sahne Y = yükseklik (z), sahne Z = plan y (ön cephe z=0, arka cephe z=D).
import * as THREE from "three";
import type { BuildingLayout, FloorLayout, Opening } from "./layout";
import { ZONE_COLORS, near } from "./layout";
import { furnishFloor, type FurnitureKind } from "./furniture";
import { DEFAULT_MATERIALS, type Materials } from "../shared/schema";
import { texturedMaterial, worldUV } from "./materials3d";

export interface ModelOptions {
  showRoof: boolean;
  /** Bu kata kadar (dahil) göster; null = hepsi */
  maxLevel: number | null;
  /** Üst katın duvarlarını kesip içini gösterme (maket görünümü) */
  cutaway: boolean;
  /** Dokulu malzemeler, peyzaj (ağaç, yol, yürüme yolu) */
  realistic?: boolean;
  materials?: Materials;
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
let mats: typeof BASE & { gable?: THREE.Material } = { ...BASE };

const REAL_GLASS = new THREE.MeshPhysicalMaterial({ color: 0x5f7684, roughness: 0.03, metalness: 0.0, transparent: true, opacity: 0.55, envMapIntensity: 2.2, clearcoat: 1 });
const REAL_FRAME = new THREE.MeshStandardMaterial({ color: 0x2e3033, roughness: 0.45, metalness: 0.5 });
const REAL_SLAB = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.85 });

function useMaterials(opts: ModelOptions) {
  if (!opts.realistic) { mats = { ...BASE }; return; }
  const m = opts.materials ?? DEFAULT_MATERIALS;
  const roof =
    m.roof === "kiremit" ? texturedMaterial("tile", { side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ color: m.roof === "koyu_metal" ? 0x3a3d40 : 0x9a9d9f, roughness: 0.45, metalness: 0.55, side: THREE.DoubleSide });
  mats = {
    ...BASE,
    wall: texturedMaterial(m.wall),
    wallStone: texturedMaterial(m.accent),
    inner: texturedMaterial("inner"),
    slab: REAL_SLAB,
    glass: REAL_GLASS,
    frame: REAL_FRAME,
    door: texturedMaterial("ahsap"),
    roof,
    ground: texturedMaterial("grass"),
    gable: texturedMaterial(m.wall, { side: THREE.DoubleSide }),
  };
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
    // merdiven boşluğu bırakılmış döşeme
    const st = L.stair, e = L.extWall / 2, y = z0 - L.slab / 2;
    grp.add(box(L.W + 2 * e, L.slab, st.y + e, mats.slab, L.W / 2, y, (st.y - e) / 2, "Döşeme"));
    const yb = st.y + st.h;
    grp.add(box(L.W + 2 * e, L.slab, L.D - yb + e, mats.slab, L.W / 2, y, (yb + L.D + e) / 2, "Döşeme"));
    grp.add(box(L.W - st.w + e, L.slab, st.h, mats.slab, (st.w + L.W + e) / 2, y, st.y + st.h / 2, "Döşeme"));
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
    // cam korkuluk
    const edge = r.y < 0 ? r.y : r.y + r.h; // dış kenar
    grp.add(box(r.w, 1.0, 0.03, mats.glass, r.x + r.w / 2, z0 + 0.5, edge));
    grp.add(box(0.03, 1.0, r.h, mats.glass, r.x, z0 + 0.5, r.y + r.h / 2));
    grp.add(box(0.03, 1.0, r.h, mats.glass, r.x + r.w, z0 + 0.5, r.y + r.h / 2));
    grp.add(box(r.w, 0.05, 0.06, mats.rail, r.x + r.w / 2, z0 + 1.05, edge));
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
  const flightW = (st.h - 0.15) / 2;
  const landing = 1.1;
  const run = st.w - landing;
  const rise = L.H / 2;
  const n = Math.max(6, Math.round(rise / 0.17));
  const tr = run / n;
  const hStep = rise / n;
  // 1. kol: x = st.w → landing, yükselir (alt kol, plan y düşük)
  for (let i = 0; i < n; i++) {
    const x = st.w - (i + 0.5) * tr;
    const top = z0 + (i + 1) * hStep;
    grp.add(box(tr, 0.06, flightW, mats.stair, x, top - 0.03, st.y + flightW / 2));
  }
  // sahanlık
  grp.add(box(landing, 0.15, st.h, mats.stair, landing / 2, z0 + rise - 0.075, st.y + st.h / 2));
  // 2. kol: landing → st.w
  for (let i = 0; i < n; i++) {
    const x = landing + (i + 0.5) * tr;
    const top = z0 + rise + (i + 1) * hStep;
    grp.add(box(tr, 0.06, flightW, mats.stair, x, top - 0.03, st.y + flightW + 0.15 + flightW / 2));
  }
  // orta perde
  grp.add(box(run, L.H * 0.9, 0.1, mats.inner, landing + run / 2, z0 + L.H * 0.45, st.y + flightW + 0.075));
}

function addStairRail(grp: THREE.Group, L: BuildingLayout, z0: number) {
  const st = L.stair!;
  grp.add(box(0.04, 1.0, st.h, mats.glass, st.w, z0 + 0.5, st.y + st.h / 2));
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
