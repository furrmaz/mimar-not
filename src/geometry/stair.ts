// Merdiven hesabı ve geometrisi (plan, kesit, DXF ve 3D ortak kullanır).
// U dönüşlü (iki kollu, ara sahanlıklı) merdiven. Yerel eksenler:
//   u: koşu yönü — u = 0 holün kenarı (çıkış/varış), u = len sahanlığın dış kenarı
//   v: kollara dik — 1. kol v ∈ [0, fw], 2. kol v ∈ [fw + gap, 2fw + gap]
import type { Rect } from "./layout";

export interface StairInfo {
  /** Koşu ekseni: "x" (eski hol bandı merdiveni) ya da "y" (bant içinde, hole dik) */
  axis: "x" | "y";
  /** u ekseninin dünyadaki yönü (+1 / -1) */
  sign: 1 | -1;
  risers: number;
  riser: number;
  tread: number;
  flightW: number;
  landing: number;
}

const GAP = 0.1;

/** Kat yüksekliğinden rıht/basamak hesabı (2r + b ≈ 63 cm, rıht ≤ 18 cm). */
export function stairCalc(H: number) {
  const risers = Math.max(4, Math.ceil(H / 0.18 - 1e-6));
  const riser = H / risers;
  const tread = Math.round(Math.min(0.3, Math.max(0.26, 0.63 - 2 * riser)) * 100) / 100;
  const n1 = Math.ceil(risers / 2);
  const flightW = 1.0;
  const landing = 1.05;
  const run = (n1 - 1) * tread;
  return { risers, riser, tread, flightW, landing, run, len: Math.round((run + landing) * 100) / 100, width: Math.round((2 * flightW + GAP) * 100) / 100 };
}

export interface StairFlight {
  /** Kolun dünya dikdörtgeni */
  rect: Rect;
  /** Basamak çizgileri: [x1, y1, x2, y2] */
  lines: [number, number, number, number][];
  /** Basamaklar (3D): dünya dikdörtgeni + üst kotu (kat döşemesinden) */
  steps: { rect: Rect; top: number }[];
}

export interface StairGeom {
  flights: [StairFlight, StairFlight];
  landing: Rect;
  landingTop: number;
  well: Rect;
  /** Çıkış yönü oku: dünya noktaları */
  path: [number, number][];
  /** Kesme çizgisi (alt katlarda üst kol görünmez) */
  breakLine: [number, number, number, number];
  label: string;
  /** Etiket yeri (sahanlığın dış yarısı) */
  labelAt: [number, number];
  info: StairInfo;
}

/** Hol bandındaki eski tip merdiven (sahanlık x = st.x tarafında) için bilgi. */
export function legacyStairInfo(st: Rect, H: number): StairInfo {
  const c = stairCalc(H);
  const flightW = (st.h - GAP) / 2;
  const landing = Math.min(1.1, st.w * 0.35);
  const n1 = Math.ceil(c.risers / 2);
  const tread = Math.min(0.32, (st.w - landing) / Math.max(1, n1 - 1));
  return { axis: "x", sign: -1, risers: c.risers, riser: c.riser, tread, flightW, landing };
}

export function stairGeom(st: Rect, info: StairInfo, H: number): StairGeom {
  const { axis, sign, risers, riser, flightW: fw, landing } = info;
  const len = axis === "x" ? st.w : st.h;
  const wid = axis === "x" ? st.h : st.w;
  const gap = Math.max(0.05, wid - 2 * fw);
  // u = 0 hol kenarı
  const u0 = axis === "x" ? (sign === 1 ? st.x : st.x + st.w) : sign === 1 ? st.y : st.y + st.h;
  const v0 = axis === "x" ? st.y : st.x;
  const P = (u: number, v: number): [number, number] => (axis === "x" ? [u0 + sign * u, v0 + v] : [v0 + v, u0 + sign * u]);
  const R = (ua: number, ub: number, va: number, vb: number): Rect => {
    const [x1, y1] = P(ua, va), [x2, y2] = P(ub, vb);
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  };
  const n1 = Math.ceil(risers / 2);
  const n2 = risers - n1;
  const lStart = len - landing; // sahanlığın başladığı u
  const t1 = Math.min(info.tread, lStart / Math.max(1, n1 - 1));
  const t2 = Math.min(info.tread, lStart / Math.max(1, n2 - 1));
  const f1a = lStart - (n1 - 1) * t1;
  const f2a = lStart - (n2 - 1) * t2;
  const mk = (ua: number, t: number, n: number, va: number, vb: number, baseStep: number): StairFlight => {
    const lines: StairFlight["lines"] = [];
    const steps: StairFlight["steps"] = [];
    for (let i = 0; i <= n - 1; i++) {
      const u = ua + i * t;
      const [x1, y1] = P(u, va), [x2, y2] = P(u, vb);
      lines.push([x1, y1, x2, y2]);
    }
    for (let i = 0; i < n - 1; i++) steps.push({ rect: R(ua + i * t, ua + (i + 1) * t, va, vb), top: (baseStep + i + 1) * riser });
    return { rect: R(ua, lStart, va, vb), lines, steps };
  };
  // 1. kol hol kenarından sahanlığa çıkar; basamak üst kotu artan u ile artar
  const fl1 = mk(f1a, t1, n1, 0, fw, 0);
  // 2. kol sahanlıktan hole doğru çıkar: u azalırken kot artar → basamakları ters sırala
  const fl2raw = mk(f2a, t2, n2, fw + gap, 2 * fw + gap, 0);
  const steps2 = fl2raw.steps.map((s, i, arr) => ({ rect: s.rect, top: (n1 + (arr.length - i)) * riser }));
  const fl2: StairFlight = { ...fl2raw, steps: steps2 };
  const turnU = lStart + Math.min(0.5, landing / 2);
  const pathU = [f1a + 0.15, turnU, turnU, f2a + 0.25];
  const path: [number, number][] = [P(pathU[0], fw / 2), P(pathU[1], fw / 2), P(pathU[2], fw + gap + fw / 2), P(pathU[3], fw + gap + fw / 2)];
  const bu = f1a + (lStart - f1a) * 0.55;
  const [bx1, by1] = P(bu, -0.02), [bx2, by2] = P(bu + (lStart - f1a) * 0.25, 2 * fw + gap + 0.02);
  return {
    flights: [fl1, fl2],
    landing: R(lStart, len, 0, 2 * fw + gap),
    landingTop: n1 * riser,
    well: R(Math.min(f1a, f2a), lStart, fw, fw + gap),
    path,
    breakLine: [bx1, by1, bx2, by2],
    label: `${risers} × ${(riser * 100).toFixed(1)}/${Math.round(info.tread * 100)}`,
    labelAt: P(landing > 1.2 ? lStart + (landing + Math.min(0.5, landing / 2)) / 2 + 0.1 : len - 0.25, fw + gap / 2),
    info,
  };
  void H;
}
