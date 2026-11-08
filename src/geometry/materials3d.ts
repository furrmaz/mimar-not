// Gerçekçi görünüm için tarayıcıda (canvas) üretilen dokular ve malzemeler. Dış dosya gerektirmez.
import * as THREE from "three";
import type { Materials } from "../shared/schema";

type Mat = Materials["wall"];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
function canvas(size = 512) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return { c, g: c.getContext("2d")! };
}
function noise(g: CanvasRenderingContext2D, size: number, amount: number, seed: number, mono = true) {
  const img = g.getImageData(0, 0, size, size);
  const r = rng(seed);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * amount;
    img.data[i] += n;
    img.data[i + 1] += mono ? n : (r() - 0.5) * amount;
    img.data[i + 2] += mono ? n : (r() - 0.5) * amount;
  }
  g.putImageData(img, 0, 0);
}
const shade = (hex: string, k: number) => {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, k);
  return `#${c.getHexString()}`;
};

/** Her doku: dünya ölçüsünde `tile` metrelik bir kare. */
interface Tex { map: THREE.Texture; bump: THREE.Texture; tile: number; rough: number }
const cache = new Map<string, Tex>();

function make(key: string, tile: number, rough: number, draw: (g: CanvasRenderingContext2D, s: number) => void): Tex {
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 512;
  const { c, g } = canvas(S);
  draw(g, S);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  // kabartma: aynı görüntünün gri tonu
  const { c: bc, g: bg } = canvas(S);
  bg.filter = "grayscale(1) contrast(1.4)";
  bg.drawImage(c, 0, 0);
  const bump = new THREE.CanvasTexture(bc);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  const t = { map, bump, tile, rough };
  cache.set(key, t);
  return t;
}

const TEX: Record<Mat | "tile" | "grass" | "paving" | "wood_floor" | "inner", () => Tex> = {
  siva_beyaz: () => make("siva_beyaz", 2, 0.92, (g, s) => { g.fillStyle = "#f3f1ec"; g.fillRect(0, 0, s, s); noise(g, s, 10, 1); }),
  siva_krem: () => make("siva_krem", 2, 0.92, (g, s) => { g.fillStyle = "#ece2cf"; g.fillRect(0, 0, s, s); noise(g, s, 12, 2); }),
  siva_gri: () => make("siva_gri", 2, 0.9, (g, s) => { g.fillStyle = "#b9b8b4"; g.fillRect(0, 0, s, s); noise(g, s, 12, 3); }),
  inner: () => make("inner", 2, 0.95, (g, s) => { g.fillStyle = "#fbfaf6"; g.fillRect(0, 0, s, s); noise(g, s, 5, 4); }),
  beton: () => make("beton", 2.4, 0.85, (g, s) => {
    g.fillStyle = "#a9a7a2"; g.fillRect(0, 0, s, s); noise(g, s, 22, 5);
    g.strokeStyle = "rgba(60,60,60,.35)"; g.lineWidth = 2;
    g.strokeRect(1, 1, s - 2, s / 2 - 2); g.strokeRect(1, s / 2 + 1, s - 2, s / 2 - 2);
    g.fillStyle = "rgba(70,70,70,.45)";
    for (const y of [s / 4, (3 * s) / 4]) for (const x of [s / 6, s / 2, (5 * s) / 6]) { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
  }),
  tas: () => make("tas", 1.6, 0.95, (g, s) => {
    const r = rng(6);
    g.fillStyle = "#6f6558"; g.fillRect(0, 0, s, s);
    let y = 0;
    while (y < s) {
      const h = 40 + r() * 34;
      let x = -r() * 60;
      while (x < s) {
        const w = 60 + r() * 90;
        const base = ["#c9b79a", "#b9a586", "#d5c4a6", "#a8957a", "#c2ab8a"][Math.floor(r() * 5)];
        g.fillStyle = base;
        g.fillRect(x + 3, y + 3, w - 6, h - 6);
        g.fillStyle = shade(base, -0.08);
        g.fillRect(x + 3, y + h - 10, w - 6, 7);
        x += w;
      }
      y += h;
    }
    noise(g, s, 26, 7);
  }),
  tugla: () => make("tugla", 1.2, 0.9, (g, s) => {
    const r = rng(8);
    g.fillStyle = "#d8d0c4"; g.fillRect(0, 0, s, s);
    const bh = s / 16, bw = s / 4;
    for (let row = 0; row < 16; row++) for (let i = -1; i < 5; i++) {
      const x = i * bw + (row % 2 ? bw / 2 : 0);
      g.fillStyle = ["#a4523a", "#9a4a33", "#b05c40", "#8e4430"][Math.floor(r() * 4)];
      g.fillRect(x + 2, row * bh + 2, bw - 4, bh - 4);
    }
    noise(g, s, 20, 9);
  }),
  ahsap: () => make("ahsap", 1.2, 0.75, (g, s) => {
    const r = rng(10);
    const n = 8;
    for (let i = 0; i < n; i++) {
      const base = ["#8b5a35", "#9a673f", "#7f5230", "#a06d44"][Math.floor(r() * 4)];
      g.fillStyle = base;
      g.fillRect((i * s) / n, 0, s / n, s);
      g.strokeStyle = shade(base, -0.06); g.lineWidth = 1;
      for (let k = 0; k < 6; k++) { const x = (i * s) / n + r() * (s / n); g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 6, s / 3, x - 6, (2 * s) / 3, x, s); g.stroke(); }
      g.fillStyle = "rgba(30,20,10,.55)"; g.fillRect(((i + 1) * s) / n - 3, 0, 3, s);
    }
    noise(g, s, 14, 11);
  }),
  tile: () => make("tile", 1.0, 0.8, (g, s) => {
    const r = rng(12);
    g.fillStyle = "#6b3424"; g.fillRect(0, 0, s, s);
    const rows = 8, cols = 6;
    for (let row = 0; row < rows; row++) for (let i = 0; i < cols; i++) {
      const x = (i * s) / cols, y = (row * s) / rows;
      const grd = g.createLinearGradient(x, 0, x + s / cols, 0);
      const base = ["#b5583a", "#a64f34", "#bd6443"][Math.floor(r() * 3)];
      grd.addColorStop(0, shade(base, -0.12)); grd.addColorStop(0.5, shade(base, 0.05)); grd.addColorStop(1, shade(base, -0.12));
      g.fillStyle = grd;
      g.fillRect(x + 1, y + 2, s / cols - 2, s / rows - 3);
    }
    noise(g, s, 18, 13);
  }),
  grass: () => make("grass", 3, 1, (g, s) => {
    g.fillStyle = "#7d9a55"; g.fillRect(0, 0, s, s);
    const r = rng(14);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = ["#6f8c48", "#8aa860", "#7a9850", "#94b06a", "#65803f"][Math.floor(r() * 5)];
      g.fillRect(r() * s, r() * s, 2, 3 + r() * 4);
    }
  }),
  paving: () => make("paving", 1.2, 0.85, (g, s) => {
    const r = rng(15);
    g.fillStyle = "#9b958c"; g.fillRect(0, 0, s, s);
    const n = 4;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.fillStyle = ["#d3cdc2", "#c9c2b6", "#dcd6cb"][Math.floor(r() * 3)];
      g.fillRect((i * s) / n + 3, (j * s) / n + 3, s / n - 6, s / n - 6);
    }
    noise(g, s, 14, 16);
  }),
  wood_floor: () => make("wood_floor", 1.5, 0.6, (g, s) => {
    const r = rng(17);
    const n = 10;
    for (let i = 0; i < n; i++) { g.fillStyle = ["#c79b6d", "#b98c5e", "#d1a678"][Math.floor(r() * 3)]; g.fillRect(0, (i * s) / n, s, s / n - 2); }
    noise(g, s, 12, 18);
  }),
};

const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function texturedMaterial(kind: keyof typeof TEX, opts: { color?: number; side?: THREE.Side } = {}) {
  const key = `${kind}-${opts.side ?? 0}-${opts.color ?? ""}`;
  const hit = matCache.get(key);
  if (hit) return hit;
  const t = TEX[kind]();
  const m = new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bump, bumpScale: 0.6, roughness: t.rough, color: opts.color ?? 0xffffff, ...(opts.side != null ? { side: opts.side } : {}) });
  m.userData.tile = t.tile;
  matCache.set(key, m);
  return m;
}

/** Kutu geometrisine dünya ölçüsünde UV yazar (dokunun bir karesi = tile metre). */
export function worldUV(geo: THREE.BufferGeometry, offset: THREE.Vector3, tile: number) {
  const pos = geo.getAttribute("position");
  const nor = geo.getAttribute("normal");
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + offset.x, y = pos.getY(i) + offset.y, z = pos.getZ(i) + offset.z;
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
    let u: number, v: number;
    if (ny > 0.5) { u = x; v = z; } else if (nx > 0.5) { u = z; v = y; } else { u = x; v = y; }
    uv.setXY(i, u / tile, v / tile);
  }
  uv.needsUpdate = true;
}
