// Oda tipine göre basit mobilya yerleşimi (plan, DXF ve 3D için).
// Mobilyalar odanın hole bakmayan "arka" duvarına yaslanır; kapılar çoğunlukla hol tarafında olduğundan kanatlarla çakışmaz.
import type { FloorLayout, PlacedRoom } from "./layout";

export type FurnitureKind =
  | "bed" | "nightstand" | "wardrobe" | "sofa" | "armchair" | "coffeeTable" | "tvUnit" | "table" | "chair"
  | "counter" | "island" | "fridge" | "hob" | "sink" | "wc" | "basin" | "shower" | "bathtub" | "desk"
  | "washer" | "car" | "shelf";

export interface Furniture {
  kind: FurnitureKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 3D yüksekliği (m) */
  height: number;
  /** Plan sembolü yönü: bakılan yön (dünya ekseninde +y ya da -y, +x ya da -x) */
  facing: "n" | "s" | "e" | "w";
}

const HEIGHTS: Record<FurnitureKind, number> = {
  bed: 0.5, nightstand: 0.5, wardrobe: 2.2, sofa: 0.8, armchair: 0.8, coffeeTable: 0.4, tvUnit: 0.5, table: 0.75, chair: 0.85,
  counter: 0.9, island: 0.9, fridge: 1.85, hob: 0.9, sink: 0.9, wc: 0.4, basin: 0.85, shower: 0.05, bathtub: 0.55, desk: 0.75,
  washer: 0.85, car: 1.45, shelf: 2.0,
};

export function furnishRoom(r: PlacedRoom): Furniture[] {
  if (r.band === "hall" || r.type === "merdiven") return [];
  const W = r.rect.w, H = r.rect.h;
  // yerel çerçeve: u = x boyunca (0..W), v = arka duvardan hole doğru (0..H)
  const front = r.band === "front"; // ön bantta arka duvar sokak cephesi (y küçük)
  const out: Furniture[] = [];
  const put = (kind: FurnitureKind, u: number, v: number, w: number, d: number) => {
    if (u < 0.05 || v < 0.05 || u + w > W - 0.05 || v + d > H - 0.05 || w <= 0 || d <= 0) return;
    const x = r.rect.x + u;
    const y = front ? r.rect.y + v : r.rect.y + H - v - d;
    out.push({ kind, x, y, w, h: d, height: HEIGHTS[kind], facing: front ? "n" : "s" });
  };
  const cu = (w: number) => (W - w) / 2;
  const area = W * H;

  switch (r.type) {
    case "ebeveyn":
    case "yatak":
    case "cocuk":
    case "misafir": {
      const double = r.type === "ebeveyn" || (r.type !== "cocuk" && area >= 11);
      const bw = double ? 1.6 : 0.9;
      const bl = 2.0;
      // yatak başı arka duvarda, odanın ortasında; yer yoksa yana
      const bu = W >= bw + 1.4 ? cu(bw) : 0.1;
      put("bed", bu, 0.1, bw, bl);
      put("nightstand", bu - 0.5, 0.1, 0.45, 0.4);
      if (double) put("nightstand", bu + bw + 0.05, 0.1, 0.45, 0.4);
      // dolap: hol tarafı duvarında değil, yan duvarda
      const wl = Math.min(2.4, H - 1.4);
      if (W - (bu + bw) > 1.4 && wl > 1) put("wardrobe", W - 0.65, 0.1, 0.6, wl);
      else if (bu > 1.4 && wl > 1) put("wardrobe", 0.05, 0.1, 0.6, wl);
      if (r.type === "cocuk" && H > 3.2) put("desk", W - 1.3, H - 1.6, 1.2, 0.6);
      break;
    }
    case "salon": {
      const sw = Math.min(2.6, W - 1.2);
      if (sw > 1.6) {
        put("sofa", cu(sw), 0.4, sw, 0.9);
        put("coffeeTable", cu(1.1), 1.6, 1.1, 0.6);
        put("tvUnit", cu(1.8), Math.min(H - 0.55, 3.6), 1.8, 0.45);
      }
      if (W > 5 && H > 3) put("armchair", 0.3, 1.3, 0.8, 0.8);
      // yemek masası, salon büyükse ve yemek odası yoksa
      if (area > 26 && W > 7) {
        put("table", W - 2.2, 0.6, 1.6, 0.9);
        for (const du of [0.25, 0.95]) {
          put("chair", W - 2.2 + du, 0.15, 0.45, 0.4);
          put("chair", W - 2.2 + du, 1.55, 0.45, 0.4);
        }
      }
      break;
    }
    case "yemek": {
      const tw = Math.min(2.0, W - 1.4);
      if (tw > 1) {
        put("table", cu(tw), 1.0, tw, 0.9);
        for (let i = 0; i < Math.floor(tw / 0.6); i++) {
          put("chair", cu(tw) + 0.1 + i * 0.6, 0.55, 0.45, 0.4);
          put("chair", cu(tw) + 0.1 + i * 0.6, 1.95, 0.45, 0.4);
        }
      }
      break;
    }
    case "mutfak": {
      // arka duvar boyunca tezgah + bir yan duvar (L)
      put("counter", 0.05, 0.05, W - 0.1, 0.6);
      put("hob", cu(0.6), 0.1, 0.6, 0.5);
      put("sink", Math.min(W - 1.0, cu(0.8) + 1.2), 0.1, 0.8, 0.45);
      if (H > 2.6) put("counter", 0.05, 0.7, 0.6, Math.min(1.8, H - 1.6));
      put("fridge", W - 0.75, 0.05, 0.7, 0.7);
      if (area > 13 && W > 3.2 && H > 3.0) put("island", cu(1.8), 1.7, 1.8, 0.9);
      else if (area > 10 && H > 3.2) put("table", cu(1.2), H - 1.7, 1.2, 0.8);
      break;
    }
    case "banyo": {
      put("shower", 0.05, 0.05, Math.min(0.9, W - 0.1), 0.9);
      if (W > 2.2 && H > 2.2 && area > 6.5) put("bathtub", W - 0.8, 1.1, 0.75, 1.7);
      put("wc", W > 1.6 ? W - 0.5 : cu(0.4), W > 1.6 ? 0.1 : 1.1, 0.4, 0.6);
      put("basin", W > 1.6 ? cu(0.6) + 0.2 : cu(0.6), H > 2.4 ? 1.3 : 1.75, 0.6, 0.45);
      break;
    }
    case "wc": {
      put("wc", cu(0.4), 0.1, 0.4, 0.6);
      if (H > 1.5) put("basin", cu(0.5), 0.9, 0.5, 0.35);
      break;
    }
    case "camasir": {
      put("washer", 0.1, 0.1, 0.6, 0.6);
      if (W > 1.5) put("washer", 0.75, 0.1, 0.6, 0.6);
      else if (H > 1.5) put("washer", 0.1, 0.75, 0.6, 0.6);
      break;
    }
    case "calisma":
    case "ofis": {
      put("desk", cu(1.4), 0.3, 1.4, 0.7);
      put("chair", cu(0.5), 1.1, 0.5, 0.5);
      if (W > 2.6) put("shelf", 0.05, 0.6, 0.35, Math.min(2.0, H - 1.4));
      break;
    }
    case "giyinme": {
      put("wardrobe", 0.05, 0.05, W - 0.1, 0.6);
      if (W > 1.8 && H > 1.6) put("wardrobe", 0.05, 0.7, 0.6, H - 1.5);
      break;
    }
    case "kiler":
    case "depo": {
      put("shelf", 0.05, 0.05, W - 0.1, 0.45);
      if (W > 1.2 && H > 1.4) put("shelf", 0.05, 0.55, 0.45, H - 1.4);
      break;
    }
    case "garaj": {
      const n = Math.max(1, Math.min(3, Math.floor(W / 2.8)));
      const gap = (W - n * 1.9) / (n + 1);
      for (let i = 0; i < n; i++) put("car", gap + i * (1.9 + gap), 0.6, 1.9, Math.min(4.6, H - 0.9));
      break;
    }
    default:
      break;
  }
  return out;
}

type Box = { x: number; y: number; w: number; h: number };
const overlap = (a: Box, b: Box) => a.x < b.x + b.w - 1e-6 && a.x + a.w > b.x + 1e-6 && a.y < b.y + b.h - 1e-6 && a.y + a.h > b.y + 1e-6;
const ON_COUNTER = new Set<FurnitureKind>(["hob", "sink", "counter", "fridge"]);

/** Kattaki tüm mobilyalar. Kapı kanadı / geçiş alanına giren parça önce kaydırılır, olmazsa atılır. */
export function furnishFloor(fl: FloorLayout): Furniture[] {
  const keep: Box[] = [];
  for (const o of fl.openings) {
    if (o.kind === "window") continue;
    const a = o.center - o.width / 2 - 0.05, len = o.width + 0.1;
    const swingD = o.kind === "balconyDoor" ? 0.7 : o.width + 0.1;
    const backD = o.kind === "balconyDoor" ? 0.7 : 0.6;
    const lo = o.swing > 0 ? backD : swingD, hi = o.swing > 0 ? swingD : backD;
    keep.push(o.orient === "h" ? { x: a, y: o.line - lo, w: len, h: lo + hi } : { x: o.line - lo, y: a, w: lo + hi, h: len });
  }
  const shifts = [0];
  for (let k = 1; k <= 25; k++) shifts.push(k * 0.1, -k * 0.1);
  const out: Furniture[] = [];
  for (const r of fl.rooms) {
    const placed: Furniture[] = [];
    const R = r.rect;
    for (const f of furnishRoom(r)) {
      const ok = (g: Furniture) =>
        g.x >= R.x + 0.04 && g.y >= R.y + 0.04 && g.x + g.w <= R.x + R.w - 0.04 && g.y + g.h <= R.y + R.h - 0.04 &&
        !keep.some((k) => overlap(g, k)) &&
        !placed.some((p) => overlap(g, p) && !(ON_COUNTER.has(g.kind) && ON_COUNTER.has(p.kind)));
      let done: Furniture | null = null;
      outer: for (const axis of ["x", "y"] as const)
        for (const d of shifts) {
          const g = { ...f, [axis]: f[axis] + d };
          if (ok(g)) { done = g; break outer; }
        }
      if (done) placed.push(done);
    }
    out.push(...placed);
  }
  return out;
}

// ---------------------------------------------------------------- SEMBOLLER
export type Prim =
  | { t: "rect"; x: number; y: number; w: number; h: number }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number }
  | { t: "circle"; cx: number; cy: number; r: number };

/** Mobilyanın plan sembolü, dünya koordinatlarında basit ilkellerle (SVG ve DXF ortak kullanır). */
export function furnitureSymbol(f: Furniture): Prim[] {
  // a: genişlik boyunca 0..w, b: arka kenardan öne 0..h
  const X = (a: number) => f.x + a;
  const Y = (b: number) => (f.facing === "s" ? f.y + f.h - b : f.y + b);
  const R = (a: number, b: number, w: number, d: number): Prim => {
    const y1 = Y(b), y2 = Y(b + d);
    return { t: "rect", x: X(a), y: Math.min(y1, y2), w, h: Math.abs(y2 - y1) };
  };
  const Ln = (a1: number, b1: number, a2: number, b2: number): Prim => ({ t: "line", x1: X(a1), y1: Y(b1), x2: X(a2), y2: Y(b2) });
  const C = (a: number, b: number, r: number): Prim => ({ t: "circle", cx: X(a), cy: Y(b), r });
  const { w, h } = f;
  const out: Prim[] = [R(0, 0, w, h)];
  switch (f.kind) {
    case "bed": {
      const pw = f.w > 1.2 ? (w - 0.3) / 2 : w - 0.2;
      out.push(R(0.1, 0.08, pw, 0.35));
      if (f.w > 1.2) out.push(R(0.2 + pw, 0.08, pw, 0.35));
      out.push(Ln(0, 0.6, w, 0.6), Ln(0, 0.6, w * 0.35, h));
      break;
    }
    case "sofa":
    case "armchair":
      out.push(R(0, 0, w, 0.22), R(0, 0.22, 0.18, h - 0.22), R(w - 0.18, 0.22, 0.18, h - 0.22));
      break;
    case "wardrobe":
    case "shelf":
      out.push(Ln(0, 0, w, h), Ln(w, 0, 0, h));
      break;
    case "hob":
      for (const a of [0.17, 0.43]) for (const b of [0.14, 0.36]) out.push(C(a, b, 0.09));
      break;
    case "sink":
    case "basin":
      out.push(R(0.08, 0.08, w - 0.16, h - 0.14), C(w / 2, 0.06, 0.025));
      break;
    case "wc":
      out.push(R(0.02, 0, w - 0.04, 0.18), C(w / 2, 0.38, Math.min(w / 2 - 0.02, 0.19)));
      break;
    case "shower":
      out.push(Ln(0, 0, w, h), Ln(w, 0, 0, h), C(w / 2, h / 2, 0.04));
      break;
    case "bathtub":
      out.push(R(0.07, 0.07, w - 0.14, h - 0.14), C(w / 2, 0.22, 0.03));
      break;
    case "fridge":
      out.push(Ln(0.05, h - 0.08, w - 0.05, h - 0.08));
      break;
    case "washer":
      out.push(C(w / 2, h / 2 + 0.03, Math.min(w, h) * 0.32));
      break;
    case "tvUnit":
      out.push(R(w * 0.15, 0.05, w * 0.7, 0.06));
      break;
    case "car":
      out.push(R(0.15, h * 0.28, w - 0.3, h * 0.42), Ln(0.15, h * 0.4, w - 0.15, h * 0.4));
      break;
    case "desk":
    case "table":
    case "coffeeTable":
    case "island":
    case "counter":
    case "nightstand":
    case "chair":
    default:
      break;
  }
  return out;
}
