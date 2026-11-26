// Mobilyaların prosedürel 3D modelleri (dış model dosyası yok; tamamı burada basit geometrilerle üretilir).
// Yerel çerçeve: X sırt boyunca (-lw/2..lw/2), Z arkadan öne (-ld/2 sırt, +ld/2 ön), Y yukarı (0 = döşeme).
import * as THREE from "three";
import { localSize, type Furniture, type FurnitureKind } from "./furniture";
import { interiorStyle, type LightPoint } from "./interior";

const M = (color: number, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const MAT = {
  oak: M(0xb88a5a, 0.7),
  walnut: M(0x6e4a32, 0.65),
  white: M(0xf4f2ee, 0.5),
  lacquer: M(0xe9e6e0, 0.35),
  ceramic: M(0xffffff, 0.15),
  steel: M(0xc9ccd0, 0.3, 0.8),
  black: M(0x1d1e20, 0.4, 0.2),
  screen: M(0x0d0f12, 0.15, 0.3),
  stone: M(0xdcd7cf, 0.35),
  fabricGrey: M(0x8b929a, 0.95),
  fabricSand: M(0xc8b9a2, 0.95),
  fabricBlue: M(0x56708a, 0.95),
  linen: M(0xf1ede6, 0.95),
  duvet: M(0xd9d3e6, 0.95),
  pillow: M(0xfbfaf8, 0.95),
  rug: M(0xb7a184, 1),
  rugBorder: M(0x7d6a55, 1),
  leaf: new THREE.MeshStandardMaterial({ color: 0x4f7a3a, roughness: 0.85, flatShading: true }),
  pot: M(0xc0835d, 0.9),
  lampShade: new THREE.MeshStandardMaterial({ color: 0xf6efdf, roughness: 0.9, emissive: 0xffe2a8, emissiveIntensity: 0.35, side: THREE.DoubleSide }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0xd8e8ee, roughness: 0.05, transparent: true, opacity: 0.28, metalness: 0 }),
  water: M(0xbfd9e2, 0.1),
  carBody: M(0x5d6b7a, 0.35, 0.5),
  tyre: M(0x222222, 0.9),
};
/** İç mekân üslubunun renklerini ortak malzemelere uygular (bütün mobilyalar aynı malzemeleri paylaşır). */
let palId = "";
export function applyInteriorPalette(id?: string | null) {
  const st = interiorStyle(id);
  if (st.id === palId) return;
  palId = st.id;
  const p = st.palette;
  const set: [THREE.MeshStandardMaterial, number][] = [
    [MAT.oak, p.oak], [MAT.walnut, p.walnut], [MAT.lacquer, p.lacquer], [MAT.stone, p.stone], [MAT.black, p.metal],
    [MAT.fabricGrey, p.sofa], [MAT.fabricBlue, p.accentFabric], [MAT.fabricSand, p.cushion], [MAT.duvet, p.duvet],
    [MAT.rug, p.rug], [MAT.rugBorder, p.rugBorder], [MAT.pot, p.pot],
  ];
  for (const [m, c] of set) m.color.setHex(c);
  // metal tonu pirinç/bakırsa parlak metal
  const warmMetal = (p.metal >> 16) > 0x80;
  MAT.black.metalness = warmMetal ? 0.85 : 0.2;
  MAT.black.roughness = warmMetal ? 0.3 : 0.4;
}

const BOOKS = [0x8c3b2e, 0x2f4f6f, 0xc49a3c, 0x3f6b4a, 0x7a5c8c, 0xd8d0c0, 0x444444].map((c) => M(c, 0.9));

class Kit {
  g = new THREE.Group();
  /** Kutu: x, z merkez; y alt yüz */
  box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.005), Math.max(h, 0.005), Math.max(d, 0.005)), m);
    mesh.position.set(x, y + h / 2, z);
    this.g.add(mesh);
    return mesh;
  }
  cyl(r: number, h: number, m: THREE.Material, x: number, y: number, z: number, r2 = r, seg = 16) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r2, h, seg), m);
    mesh.position.set(x, y + h / 2, z);
    this.g.add(mesh);
    return mesh;
  }
  /** Dört ayak */
  legs(w: number, d: number, h: number, m: THREE.Material, inset = 0.05, r = 0.02) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.cyl(r, h, m, sx * (w / 2 - inset), 0, sz * (d / 2 - inset), r, 8);
  }
}

function build(kind: FurnitureKind, w: number, d: number, f: Furniture): THREE.Group {
  const k = new Kit();
  const B = k.box.bind(k), Cy = k.cyl.bind(k);
  const front = d / 2, back = -d / 2;
  switch (kind) {
    case "bed": {
      B(w, 0.28, d, MAT.walnut, 0, 0.04, 0);
      k.legs(w, d, 0.05, MAT.black, 0.08, 0.03);
      B(w - 0.04, 0.22, d - 0.06, MAT.linen, 0, 0.32, 0.02);
      B(w + 0.06, 1.0, 0.07, MAT.walnut, 0, 0, back + 0.035);
      // yorgan ön 2/3, yastıklar başta
      B(w, 0.06, d * 0.66, MAT.duvet, 0, 0.52, front - d * 0.33 + 0.01);
      const n = w > 1.2 ? 2 : 1, pw = (w - 0.3) / n;
      for (let i = 0; i < n; i++) B(pw - 0.05, 0.12, 0.38, MAT.pillow, -w / 2 + 0.15 + pw * i + pw / 2, 0.54, back + 0.3);
      break;
    }
    case "nightstand": {
      B(w, 0.48, d, MAT.oak, 0, 0.02, 0);
      B(w - 0.06, 0.005, 0.005, MAT.walnut, 0, 0.26, front + 0.002);
      Cy(0.06, 0.03, MAT.black, 0, 0.5, -0.02);
      Cy(0.012, 0.22, MAT.steel, 0, 0.53, -0.02, 0.012, 6);
      Cy(0.08, 0.16, MAT.lampShade, 0, 0.68, -0.02, 0.12, 20).material = MAT.lampShade;
      break;
    }
    case "wardrobe": {
      const h = f.height;
      B(w, h, d, MAT.lacquer, 0, 0, 0);
      const n = Math.max(1, Math.round(w / 0.5));
      for (let i = 1; i < n; i++) B(0.006, h - 0.1, 0.004, MAT.walnut, -w / 2 + (w / n) * i, 0.05, front + 0.002);
      for (let i = 0; i < n; i++) B(0.015, 0.3, 0.02, MAT.steel, -w / 2 + (w / n) * (i + (i % 2 ? 0.12 : 0.88)), h * 0.45, front + 0.01);
      break;
    }
    case "sofa":
    case "armchair": {
      const fab = kind === "sofa" ? MAT.fabricGrey : MAT.fabricBlue;
      k.legs(w, d, 0.1, MAT.walnut, 0.08, 0.02);
      B(w, 0.2, d, fab, 0, 0.1, 0);
      B(w, 0.5, 0.2, fab, 0, 0.3, back + 0.1);
      B(0.16, 0.32, d, fab, -w / 2 + 0.08, 0.3, 0);
      B(0.16, 0.32, d, fab, w / 2 - 0.08, 0.3, 0);
      const n = kind === "sofa" ? Math.max(2, Math.round((w - 0.32) / 0.75)) : 1;
      const cw = (w - 0.32) / n;
      for (let i = 0; i < n; i++) {
        B(cw - 0.02, 0.13, d - 0.24, MAT.fabricSand, -w / 2 + 0.16 + cw * i + cw / 2, 0.3, 0.1);
        B(cw - 0.04, 0.36, 0.14, MAT.fabricSand, -w / 2 + 0.16 + cw * i + cw / 2, 0.43, back + 0.27);
      }
      break;
    }
    case "coffeeTable": {
      B(w, 0.04, d, MAT.oak, 0, 0.36, 0);
      B(w - 0.1, 0.02, d - 0.1, MAT.walnut, 0, 0.12, 0);
      k.legs(w, d, 0.36, MAT.black, 0.05, 0.015);
      break;
    }
    case "tvUnit": {
      B(w, 0.42, d, MAT.walnut, 0, 0.06, 0);
      k.legs(w, d, 0.06, MAT.black, 0.06, 0.015);
      const tw = Math.min(1.45, w * 0.85);
      B(tw, tw * 0.57, 0.04, MAT.screen, 0, 0.6, back + 0.08);
      B(0.25, 0.1, 0.18, MAT.black, 0, 0.48, back + 0.12);
      break;
    }
    case "table": {
      B(w, 0.04, d, MAT.oak, 0, 0.71, 0);
      k.legs(w, d, 0.71, MAT.walnut, 0.08, 0.025);
      break;
    }
    case "chair": {
      k.legs(w, d, 0.44, MAT.walnut, 0.04, 0.015);
      B(w, 0.04, d, MAT.oak, 0, 0.44, 0);
      B(w, 0.38, 0.03, MAT.oak, 0, 0.48, back + 0.03);
      break;
    }
    case "bench": {
      B(w, 0.05, d, MAT.oak, 0, 0.4, 0);
      B(0.04, 0.4, d - 0.05, MAT.walnut, -w / 2 + 0.06, 0, 0);
      B(0.04, 0.4, d - 0.05, MAT.walnut, w / 2 - 0.06, 0, 0);
      break;
    }
    case "dresser": {
      B(w, 0.78, d, MAT.oak, 0, 0.07, 0);
      k.legs(w, d, 0.07, MAT.black, 0.05, 0.015);
      for (let i = 1; i < 3; i++) B(w - 0.04, 0.005, 0.004, MAT.walnut, 0, 0.07 + (0.78 / 3) * i, front + 0.002);
      for (let i = 0; i < 3; i++) B(0.18, 0.015, 0.02, MAT.steel, 0, 0.07 + (0.78 / 3) * (i + 0.5), front + 0.01);
      break;
    }
    case "counter":
    case "island":
    case "hob":
    case "sink": {
      B(w, 0.1, d - 0.06, MAT.black, 0, 0, -0.03);
      B(w, 0.76, d, MAT.lacquer, 0, 0.1, 0);
      B(w + (kind === "island" ? 0.1 : 0), 0.04, d + (kind === "island" ? 0.1 : 0.02), MAT.stone, 0, 0.86, kind === "island" ? 0 : 0.01);
      const n = Math.max(1, Math.round(w / 0.6));
      for (let i = 1; i < n; i++) B(0.005, 0.7, 0.004, MAT.walnut, -w / 2 + (w / n) * i, 0.13, front + 0.002);
      if (kind === "counter" && w > 1.2 && f.facing !== "e" && f.facing !== "w") {
        // üst dolaplar
        B(w, 0.7, 0.35, MAT.lacquer, 0, 1.45, back + 0.175);
        for (let i = 1; i < n; i++) B(0.005, 0.66, 0.004, MAT.walnut, -w / 2 + (w / n) * i, 1.47, back + 0.352);
      }
      if (kind === "hob") {
        B(w - 0.04, 0.01, d - 0.08, MAT.screen, 0, 0.9, 0);
        for (const sx of [-0.13, 0.13]) for (const sz of [-0.1, 0.1]) Cy(0.08, 0.004, MAT.black, sx, 0.91, sz, 0.08, 20);
        B(w, 0.06, 0.4, MAT.steel, 0, 1.75, back + 0.2);
      }
      if (kind === "sink") {
        B(w * 0.75, 0.012, d * 0.7, MAT.steel, 0, 0.9, 0.02);
        Cy(0.015, 0.3, MAT.steel, 0, 0.9, back + 0.06, 0.015, 8);
        B(0.03, 0.03, 0.16, MAT.steel, 0, 1.17, back + 0.13);
      }
      break;
    }
    case "fridge": {
      B(w, f.height, d, MAT.steel, 0, 0, 0);
      B(w - 0.01, 0.006, 0.004, MAT.black, 0, f.height * 0.62, front + 0.002);
      B(0.02, 0.5, 0.03, MAT.black, w / 2 - 0.08, f.height * 0.68, front + 0.015);
      B(0.02, 0.35, 0.03, MAT.black, w / 2 - 0.08, f.height * 0.3, front + 0.015);
      break;
    }
    case "wc": {
      B(w * 0.85, 0.36, 0.17, MAT.ceramic, 0, 0.42, back + 0.09);
      const bowl = Cy(w * 0.42, 0.38, MAT.ceramic, 0, 0, back + 0.4, w * 0.32, 20);
      bowl.scale.z = 1.25;
      Cy(w * 0.44, 0.02, MAT.white, 0, 0.38, back + 0.4, w * 0.44, 20).scale.z = 1.25;
      break;
    }
    case "basin": {
      B(w, 0.5, d, MAT.oak, 0, 0.3, 0);
      B(w, 0.06, d, MAT.ceramic, 0, 0.8, 0);
      B(w * 0.7, 0.02, d * 0.6, MAT.white, 0, 0.85, 0.02);
      Cy(0.012, 0.18, MAT.steel, 0, 0.86, back + 0.05, 0.012, 8);
      B(Math.min(w, 0.8), 0.7, 0.02, new THREE.MeshStandardMaterial({ color: 0xcfdbe2, roughness: 0.02, metalness: 0.9 }), 0, 1.15, back + 0.01);
      break;
    }
    case "shower": {
      B(w, 0.05, d, MAT.ceramic, 0, 0, 0);
      B(0.01, 1.95, d, MAT.glass, w / 2 - 0.005, 0.05, 0);
      B(w * 0.6, 1.95, 0.01, MAT.glass, w * 0.2, 0.05, front - 0.005);
      Cy(0.012, 1.1, MAT.steel, -w / 2 + 0.12, 1.0, back + 0.04, 0.012, 8);
      Cy(0.1, 0.02, MAT.steel, -w / 2 + 0.12, 2.05, back + 0.14, 0.1, 16);
      break;
    }
    case "bathtub": {
      B(w, 0.55, d, MAT.ceramic, 0, 0, 0);
      B(w - 0.12, 0.02, d - 0.12, MAT.water, 0, 0.5, 0);
      Cy(0.015, 0.15, MAT.steel, 0, 0.55, back + 0.04, 0.015, 8);
      break;
    }
    case "desk": {
      B(w, 0.035, d, MAT.oak, 0, 0.72, 0);
      B(0.03, 0.72, d - 0.04, MAT.walnut, -w / 2 + 0.03, 0, 0);
      B(0.03, 0.72, d - 0.04, MAT.walnut, w / 2 - 0.03, 0, 0);
      B(0.4, 0.5, d - 0.06, MAT.lacquer, w / 2 - 0.25, 0.2, 0);
      B(0.55, 0.32, 0.025, MAT.screen, 0, 0.88, back + 0.15);
      B(0.04, 0.13, 0.04, MAT.black, 0, 0.755, back + 0.15);
      break;
    }
    case "washer": {
      B(w, f.height, d, MAT.white, 0, 0, 0);
      const door = Cy(Math.min(w, f.height) * 0.28, 0.03, MAT.glass, 0, 0, 0, undefined, 24);
      door.rotation.x = Math.PI / 2;
      door.position.set(0, f.height * 0.45, front + 0.015);
      const ring = Cy(Math.min(w, f.height) * 0.31, 0.02, MAT.steel, 0, 0, 0, undefined, 24);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, f.height * 0.45, front + 0.005);
      break;
    }
    case "shelf": {
      const h = f.height;
      B(w, h, 0.02, MAT.oak, 0, 0, back + 0.01);
      B(0.025, h, d, MAT.oak, -w / 2 + 0.0125, 0, 0);
      B(0.025, h, d, MAT.oak, w / 2 - 0.0125, 0, 0);
      const n = Math.max(3, Math.round(h / 0.38));
      let s = Math.round(f.x * 97 + f.y * 31) || 3;
      const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      for (let i = 0; i <= n; i++) {
        const y = (h / n) * i;
        B(w - 0.05, 0.025, d, MAT.oak, 0, Math.min(y, h - 0.025), 0);
        if (i === n) break;
        for (let x = -w / 2 + 0.05; x < w / 2 - 0.08;) {
          const bw = 0.025 + r() * 0.03, bh = (h / n) * (0.55 + r() * 0.3);
          if (r() < 0.82) B(bw, bh, d * 0.8, BOOKS[Math.floor(r() * BOOKS.length)], x + bw / 2, y + 0.025, 0.01);
          x += bw + 0.004;
        }
      }
      break;
    }
    case "rug": {
      B(w, 0.008, d, MAT.rugBorder, 0, 0.002, 0);
      B(w - 0.12, 0.01, d - 0.12, MAT.rug, 0, 0.002, 0);
      break;
    }
    case "plant": {
      const r = Math.min(w, d) / 2;
      Cy(r * 0.55, 0.38, MAT.pot, 0, 0, 0, r * 0.42, 16);
      for (const [x, y, z, s] of [[0, 0.75, 0, 0.36], [0.1, 0.95, 0.05, 0.26], [-0.08, 0.6, -0.06, 0.28]] as const) {
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r * s * 2, 1), MAT.leaf);
        m.position.set(x * r * 2, y, z * r * 2);
        k.g.add(m);
      }
      break;
    }
    case "floorLamp": {
      Cy(0.15, 0.03, MAT.black, 0, 0, 0, 0.15, 20);
      Cy(0.012, 1.3, MAT.steel, 0, 0.03, 0, 0.012, 8);
      Cy(0.13, 0.3, MAT.lampShade, 0, 1.3, 0, 0.2, 24);
      break;
    }
    case "car": {
      // otomobilin uzun ekseni derinlik (Z); burun öne
      B(w, 0.55, d, MAT.carBody, 0, 0.3, 0);
      B(w * 0.86, 0.5, d * 0.48, MAT.glass, 0, 0.85, -d * 0.04).material = new THREE.MeshStandardMaterial({ color: 0x2c3a44, roughness: 0.1, metalness: 0.5 });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const t = Cy(0.32, 0.22, MAT.tyre, 0, 0, 0, 0.32, 18);
        t.rotation.z = Math.PI / 2;
        t.position.set(sx * (w / 2 - 0.1), 0.32, sz * (d / 2 - 0.8));
      }
      break;
    }
    default:
      B(w, f.height, d, MAT.oak, 0, 0, 0);
  }
  k.g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = kind !== "rug"; o.receiveShadow = true; } });
  return k.g;
}

const ROT: Record<Furniture["facing"], number> = { n: 0, s: Math.PI, w: Math.PI / 2, e: -Math.PI / 2 };

/** Dünya konumunda mobilya grubu. z0: döşeme kotu. maxH verilirse (kesit görünümü) yükseklik ölçeklenir. */
export function furnitureMesh(f: Furniture, z0: number, maxH?: number): THREE.Group {
  const { lw, ld } = localSize(f);
  const inner = build(f.kind, lw, ld, f);
  const g = new THREE.Group();
  g.add(inner);
  inner.rotation.y = ROT[f.facing];
  g.position.set(f.x + f.w / 2, z0, f.y + f.h / 2);
  if (maxH && f.height > maxH) g.scale.y = maxH / f.height;
  g.name = f.kind;
  g.userData.furnId = f.id;
  return g;
}

// ---------------------------------------------------------------- ARMATÜRLER
const LIGHT_MAT = {
  glow: new THREE.MeshStandardMaterial({ color: 0xfff6e6, emissive: 0xffe9c4, emissiveIntensity: 1.4, roughness: 0.4 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xe8e6e2, roughness: 0.5, metalness: 0.3 }),
  cord: new THREE.MeshStandardMaterial({ color: 0x1d1e20, roughness: 0.6 }),
};
/** Tavan armatürü (spot / sarkıt) ya da tezgâh altı LED şerit. ceil: tavan kotu (bitmiş), z0: döşeme kotu */
export function lightMesh(pt: LightPoint, z0: number, ceil: number): THREE.Group {
  const g = new THREE.Group();
  g.name = pt.kind === "pendant" ? "Sarkıt armatür" : pt.kind === "strip" ? "LED şerit" : "Spot armatür";
  if (pt.kind === "spot") {
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 18), LIGHT_MAT.rim);
    rim.position.set(pt.x, ceil - 0.006, pt.y);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.012, 18), LIGHT_MAT.glow);
    lens.position.set(pt.x, ceil - 0.012, pt.y);
    g.add(rim, lens);
  } else if (pt.kind === "pendant") {
    // masadan 75 cm yukarıda; uzun masada çizgisel sarkıt
    const y = Math.min(ceil - 0.3, z0 + 0.75 + 0.75);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, ceil - y, 6), LIGHT_MAT.cord);
    cord.position.set(pt.x, (ceil + y) / 2, pt.y);
    g.add(cord);
    const long = (pt.w ?? 0.4) > 0.6;
    const shade = long
      ? new THREE.Mesh(new THREE.BoxGeometry(pt.w ?? 1, 0.05, 0.08), MAT.black)
      : new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.2, 0.22, 24, 1, true), MAT.black);
    shade.position.set(pt.x, y - (long ? 0.025 : 0.11), pt.y);
    const glow = long ? new THREE.Mesh(new THREE.BoxGeometry((pt.w ?? 1) - 0.04, 0.01, 0.05), LIGHT_MAT.glow) : new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), LIGHT_MAT.glow);
    glow.position.set(pt.x, y - (long ? 0.05 : 0.15), pt.y);
    g.add(shade, glow);
  } else {
    // tezgâh arka kenarı boyunca, 1,45 m'de (üst dolap altı)
    const w = pt.w ?? 1, h = pt.h ?? 0.6;
    const along = w >= h;
    const m = new THREE.Mesh(new THREE.BoxGeometry(along ? w - 0.1 : 0.02, 0.012, along ? 0.02 : h - 0.1), LIGHT_MAT.glow);
    m.position.set(pt.x + w / 2, z0 + 1.45, pt.y + h / 2);
    g.add(m);
  }
  g.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
  return g;
}
