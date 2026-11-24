// AutoCAD 2010 (AC1024) ASCII DXF yazıcısı.
// R12'den farkı: kapalı polyline, tarama (HATCH), gerçek ölçü (DIMENSION), bloklar ve nitelikler,
// çizgi tipleri, çizgi kalınlıkları, yazı stili ve kağıt uzayı düzenleri (layout + ölçekli görünüm penceresi).
// Metin UTF-8 yazılır (R2007+), Türkçe karakterler doğrudan desteklenir.

export type Pt = [number, number];
type Tag = [number, string | number];

export interface LayerDef { name: string; color: number; lw: number; ltype?: string; plot?: boolean }
export interface LtypeDef { name: string; desc: string; pattern: number[] }
export interface DimStyleDef { name: string; scale: number; lfac: number; txt: number; tsz: number; exe: number; exo: number; dle: number; gap: number; dec: number }

/** Tarama deseni satırı (acadiso.pat biçiminde, mm): açı, taban x/y, öteleme dx/dy, kesik uzunlukları */
export type PatLine = [number, number, number, number, number, number[]];
export const PATTERNS: Record<string, PatLine[]> = {
  ANSI31: [[45, 0, 0, 0, 3.175, []]],
  ANSI37: [[45, 0, 0, 0, 3.175, []], [135, 0, 0, 0, 3.175, []]],
  EARTH: [
    [0, 0, 0, 6.35, 6.35, [6.35, -6.35]],
    [0, 0, 2.38125, 6.35, 6.35, [6.35, -6.35]],
    [0, 0, 4.7625, 6.35, 6.35, [6.35, -6.35]],
    [90, 0.79375, 5.55625, 6.35, 6.35, [6.35, -6.35]],
    [90, 3.175, 5.55625, 6.35, 6.35, [6.35, -6.35]],
    [90, 5.55625, 5.55625, 6.35, 6.35, [6.35, -6.35]],
  ],
  "AR-SAND": [[37.5, 0, 0, 1.123, 1.587, [0, -1.0, 0, -1.5, 0, -0.8]], [7.5, 0, 0, 2.1, 2.3, [0, -1.7, 0, -2.4]], [-32.5, -0.5, 0, 2.03, 2.6, [0, -2.5, 0, -1.8]]],
};

interface Emit { tags: (h: string, owner: string, paper: boolean, doc: DxfDoc) => Tag[]; sub?: (insertH: string, owner: string, paper: boolean, doc: DxfDoc) => Tag[][] }

export interface AttrValue { tag: string; value: string; h?: number; dx?: number; dy?: number; invisible?: boolean }
export interface AttDef { tag: string; prompt: string; h: number; x: number; y: number; align?: 0 | 1 | 2; invisible?: boolean; def?: string }

const f = (v: number) => (Math.abs(v) < 1e-9 ? 0 : +v.toFixed(6)).toString();

/** Bir çizim uzayı: model, blok tanımı ya da kağıt düzeni. Koordinatlar metre (model) veya mm (kağıt) verilir, k ile çarpılır. */
export class Space {
  ents: Emit[] = [];
  min: Pt = [Infinity, Infinity];
  max: Pt = [-Infinity, -Infinity];
  /** Kapsam takibi (görünüm pencereleri için): her çizim kendi kutusunu toplar */
  track: { min: Pt; max: Pt } | null = null;
  constructor(public doc: DxfDoc, public k: number) {}
  private n = (v: number) => f(v * this.k);
  see(x: number, y: number) {
    if (x < this.min[0]) this.min[0] = x;
    if (y < this.min[1]) this.min[1] = y;
    if (x > this.max[0]) this.max[0] = x;
    if (y > this.max[1]) this.max[1] = y;
    const t = this.track;
    if (t) {
      if (x < t.min[0]) t.min[0] = x;
      if (y < t.min[1]) t.min[1] = y;
      if (x > t.max[0]) t.max[0] = x;
      if (y > t.max[1]) t.max[1] = y;
    }
  }
  private head(layer: string, paper: boolean, h: string, owner: string, type: string, extra: Tag[] = []): Tag[] {
    return [[0, type], [5, h], [330, owner], [100, "AcDbEntity"], ...(paper ? [[67, 1] as Tag] : []), [8, layer], ...extra];
  }
  private color(c?: number): Tag[] { return c == null ? [] : [[62, c]]; }

  line(layer: string, x1: number, y1: number, x2: number, y2: number, color?: number) {
    this.see(x1, y1); this.see(x2, y2);
    const v = [this.n(x1), this.n(y1), this.n(x2), this.n(y2)];
    this.ents.push({ tags: (h, o, p) => [...this.head(layer, p, h, o, "LINE", this.color(color)), [100, "AcDbLine"], [10, v[0]], [20, v[1]], [30, 0], [11, v[2]], [21, v[3]], [31, 0]] });
  }
  pline(layer: string, pts: Pt[], closed = false, color?: number) {
    if (pts.length < 2) return;
    pts.forEach(([x, y]) => this.see(x, y));
    const v = pts.map(([x, y]) => [this.n(x), this.n(y)]);
    this.ents.push({ tags: (h, o, p) => [...this.head(layer, p, h, o, "LWPOLYLINE", this.color(color)), [100, "AcDbPolyline"], [90, v.length], [70, closed ? 1 : 0], [43, 0], ...v.flatMap(([x, y]): Tag[] => [[10, x], [20, y]])] });
  }
  rect(layer: string, x: number, y: number, w: number, h: number, color?: number) {
    if (Math.abs(w) < 1e-6 || Math.abs(h) < 1e-6) return;
    this.pline(layer, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true, color);
  }
  arc(layer: string, cx: number, cy: number, r: number, a0: number, a1: number, color?: number) {
    this.see(cx - r, cy - r); this.see(cx + r, cy + r);
    const v = [this.n(cx), this.n(cy), this.n(r)];
    this.ents.push({ tags: (h, o, p) => [...this.head(layer, p, h, o, "ARC", this.color(color)), [100, "AcDbCircle"], [10, v[0]], [20, v[1]], [30, 0], [40, v[2]], [100, "AcDbArc"], [50, f(a0)], [51, f(a1)]] });
  }
  circle(layer: string, cx: number, cy: number, r: number, color?: number) {
    this.see(cx - r, cy - r); this.see(cx + r, cy + r);
    const v = [this.n(cx), this.n(cy), this.n(r)];
    this.ents.push({ tags: (h, o, p) => [...this.head(layer, p, h, o, "CIRCLE", this.color(color)), [100, "AcDbCircle"], [10, v[0]], [20, v[1]], [30, 0], [40, v[2]]] });
  }
  /** align: 0 sol, 1 orta, 2 sağ (taban çizgisi) */
  text(layer: string, x: number, y: number, h: number, s: string, align: 0 | 1 | 2 = 1, rot = 0, color?: number) {
    if (!s) return;
    this.see(x, y); this.see(x + (rot ? 0 : (align === 0 ? 1 : 0.5) * h * 0.7 * s.length), y + h);
    if (align === 1) this.see(x - h * 0.35 * s.length, y);
    const v = [this.n(x), this.n(y), this.n(h)];
    const style = this.doc.textStyle;
    this.ents.push({
      tags: (hd, o, p) => [...this.head(layer, p, hd, o, "TEXT", this.color(color)), [100, "AcDbText"], [10, v[0]], [20, v[1]], [30, 0], [40, v[2]], [1, clean(s)], [50, f(rot)], [7, style], [72, align], [11, v[0]], [21, v[1]], [31, 0], [100, "AcDbText"], [73, 0]],
    });
  }
  /** Tarama: kapalı döngüler (dış + delikler). pattern verilmezse SOLID. */
  hatch(layer: string, loops: Pt[][], pattern?: { name: keyof typeof PATTERNS | string; scale: number; angle?: number }, color?: number) {
    const ls = loops.filter((l) => l.length > 2);
    if (!ls.length) return;
    ls.forEach((l) => l.forEach(([x, y]) => this.see(x, y)));
    const lv = ls.map((l) => l.map(([x, y]) => [this.n(x), this.n(y)]));
    this.ents.push({
      tags: (h, o, p) => {
        const t: Tag[] = [...this.head(layer, p, h, o, "HATCH", this.color(color)), [100, "AcDbHatch"], [10, 0], [20, 0], [30, 0], [210, 0], [220, 0], [230, 1], [2, pattern ? pattern.name : "SOLID"], [70, pattern ? 0 : 1], [71, 0], [91, lv.length]];
        lv.forEach((l, i) => { t.push([92, i === 0 ? 3 : 2], [72, 0], [73, 1], [93, l.length]); for (const [x, y] of l) t.push([10, x], [20, y]); t.push([97, 0]); });
        t.push([75, 0], [76, 1]);
        if (pattern) {
          const def = PATTERNS[pattern.name] ?? PATTERNS.ANSI31;
          const s = pattern.scale, a0 = pattern.angle ?? 0;
          t.push([52, f(a0)], [41, f(s)], [77, 0], [78, def.length]);
          for (const [ang, bx, by, dx, dy, dashes] of def) {
            const a = ((ang + a0) * Math.PI) / 180, r0 = (a0 * Math.PI) / 180;
            const ox = (dx * Math.cos(a) - dy * Math.sin(a)) * s, oy = (dx * Math.sin(a) + dy * Math.cos(a)) * s;
            const px = (bx * Math.cos(r0) - by * Math.sin(r0)) * s, py = (bx * Math.sin(r0) + by * Math.cos(r0)) * s;
            t.push([53, f(ang + a0)], [43, f(px)], [44, f(py)], [45, f(ox)], [46, f(oy)], [79, dashes.length]);
            for (const d of dashes) t.push([49, f(d * s)]);
          }
        }
        t.push([98, 0]);
        return t;
      },
    });
  }
  /** Blok yerleştirme; nitelikler blok tanımındaki ATTDEF konumlarına göre yazılır. */
  insert(layer: string, name: string, x: number, y: number, o: { rot?: number; sx?: number; sy?: number; attrs?: AttrValue[] } = {}) {
    const blk = this.doc.blocks.get(name);
    if (!blk) throw new Error("Blok yok: " + name);
    const rot = o.rot ?? 0, sx = o.sx ?? 1, sy = o.sy ?? 1;
    const ca = Math.cos((rot * Math.PI) / 180), sa = Math.sin((rot * Math.PI) / 180);
    const W = (u: number, v: number): Pt => [x + u * sx * ca - v * sy * sa, y + u * sx * sa + v * sy * ca];
    for (const [u, v] of [blk.space.min, blk.space.max, [blk.space.min[0], blk.space.max[1]] as Pt, [blk.space.max[0], blk.space.min[1]] as Pt]) if (isFinite(u)) this.see(...W(u, v));
    this.see(x, y);
    const attrs = (o.attrs ?? []).map((a) => {
      const d = blk.attdefs.find((q) => q.tag === a.tag);
      const [px, py] = W((d?.x ?? 0) + (a.dx ?? 0), (d?.y ?? 0) + (a.dy ?? 0));
      this.see(px, py);
      return { ...a, px, py, h: a.h ?? d?.h ?? 0.2, align: d?.align ?? 1, invisible: a.invisible ?? d?.invisible };
    });
    const v = [this.n(x), this.n(y)];
    const style = this.doc.textStyle;
    const k = this.k;
    this.ents.push({
      tags: (h, ow, p) => [...this.head(layer, p, h, ow, "INSERT"), [100, "AcDbBlockReference"], ...(attrs.length ? [[66, 1] as Tag] : []), [2, name], [10, v[0]], [20, v[1]], [30, 0], [41, f(sx)], [42, f(sy)], [43, 1], [50, f(rot)]],
      sub: attrs.length
        ? (ih, ow, p, doc) => [
            ...attrs.map((a): Tag[] => {
              const ax = f(a.px * k), ay = f(a.py * k);
              return [[0, "ATTRIB"], [5, doc.handle()], [330, ow], [100, "AcDbEntity"], ...(p ? [[67, 1] as Tag] : []), [8, layer], [100, "AcDbText"], [10, ax], [20, ay], [30, 0], [40, f(a.h * k)], [1, clean(a.value)], [50, f(rot)], [7, style], [72, a.align], [11, ax], [21, ay], [31, 0], [100, "AcDbAttribute"], [280, 0], [2, a.tag], [70, a.invisible ? 1 : 0], [74, 0]];
            }),
            [[0, "SEQEND"], [5, doc.handle()], [330, ih], [100, "AcDbEntity"], ...(p ? [[67, 1] as Tag] : []), [8, layer]],
          ]
        : undefined,
    });
  }
  /** Gerçek AutoCAD ölçüsü (yatay/düşey, döndürülmüş doğrusal). off: ölçü çizgisinin ölçülen noktalara uzaklığı (m).
   *  Görünümü taşıyan anonim *D blok da yazılır; AutoCAD ölçüyü düzenleyince stilden yeniden üretir. */
  dim(layer: string, x1: number, y1: number, x2: number, y2: number, off: number, label?: string) {
    const st = this.doc.dimStyle;
    if (!st) return;
    const horiz = Math.abs(y1 - y2) < 1e-6;
    if (horiz && Math.abs(x2 - x1) < 1e-4) return;
    if (!horiz && Math.abs(y2 - y1) < 1e-4) return;
    const u = st.scale / this.k; // 1 kağıt mm'nin metre karşılığı
    const g = new Space(this.doc, this.k);
    const sg = Math.sign(off) || 1;
    const tsz = st.tsz * u, exe = st.exe * u, dle = st.dle * u, txt = st.txt * u, gap = st.gap * u;
    const meas = horiz ? Math.abs(x2 - x1) : Math.abs(y2 - y1);
    const val = (meas).toFixed(st.dec);
    const shown = label ? label.replace("<>", val) : val;
    let defPt: Pt, mid: Pt;
    if (horiz) {
      const y = y1 + off;
      const a = Math.min(x1, x2), b = Math.max(x1, x2);
      g.line("0", x1, y1, x1, y + sg * exe, 0);
      g.line("0", x2, y2, x2, y + sg * exe, 0);
      g.line("0", a - dle, y, b + dle, y, 0);
      for (const xx of [a, b]) g.line("0", xx - tsz / 2, y - tsz / 2, xx + tsz / 2, y + tsz / 2, 0);
      mid = [(a + b) / 2, y + gap + txt / 2];
      g.text("0", mid[0], y + gap, txt, shown, 1, 0, 0);
      defPt = [x2, y];
    } else {
      const x = x1 + off;
      const a = Math.min(y1, y2), b = Math.max(y1, y2);
      g.line("0", x1, y1, x + sg * exe, y1, 0);
      g.line("0", x2, y2, x + sg * exe, y2, 0);
      g.line("0", x, a - dle, x, b + dle, 0);
      for (const yy of [a, b]) g.line("0", x - tsz / 2, yy - tsz / 2, x + tsz / 2, yy + tsz / 2, 0);
      mid = [x - gap - txt / 2, (a + b) / 2];
      g.text("0", x - gap, mid[1], txt, shown, 1, 90, 0);
      defPt = [x, y2];
    }
    for (const [px, py] of [defPt, [x1, y1], [x2, y2]] as Pt[]) g.point("Defpoints", px, py);
    const name = this.doc.anonBlock(g);
    this.see(g.min[0], g.min[1]); this.see(g.max[0], g.max[1]);
    const n = this.n;
    const over = label ?? "";
    this.ents.push({
      tags: (h, o, p) => [...this.head(layer, p, h, o, "DIMENSION"), [100, "AcDbDimension"], [280, 0], [2, name], [3, st.name], [10, n(defPt[0])], [20, n(defPt[1])], [30, 0], [11, n(mid[0])], [21, n(mid[1])], [31, 0], [70, 32], [71, 5], [42, f(meas * this.k)], [1, clean(over)], [100, "AcDbAlignedDimension"], [13, n(x1)], [23, n(y1)], [33, 0], [14, n(x2)], [24, n(y2)], [34, 0], [50, horiz ? 0 : 90], [100, "AcDbRotatedDimension"]],
    });
  }
  point(layer: string, x: number, y: number) {
    const v = [this.n(x), this.n(y)];
    this.ents.push({ tags: (h, o, p) => [...this.head(layer, p, h, o, "POINT"), [100, "AcDbPoint"], [10, v[0]], [20, v[1]], [30, 0]] });
  }
  /** Kağıt uzayında ölçekli görünüm penceresi. cx..h: kağıt (mm); view: model merkezi (m), viewH: modelde görünen yükseklik (m) */
  viewport(cx: number, cy: number, w: number, h: number, view: Pt, viewH: number, layer = "A-PENCERE-VP") {
    const id = ++this.vpCount + 1;
    this.see(cx - w / 2, cy - h / 2); this.see(cx + w / 2, cy + h / 2);
    const k = this.doc.k;
    this.ents.push({ tags: (hd, o, p) => vpTags(hd, o, p, layer, [cx, cy], w, h, [view[0] * k, view[1] * k], viewH * k, id, 16384) });
  }
  vpCount = 0;
}

function vpTags(h: string, owner: string, paper: boolean, layer: string, c: Pt, w: number, ht: number, view: Pt, viewH: number, id: number, flags: number): Tag[] {
  return [[0, "VIEWPORT"], [5, h], [330, owner], [100, "AcDbEntity"], ...(paper ? [[67, 1] as Tag] : []), [8, layer], [100, "AcDbViewport"],
    [10, f(c[0])], [20, f(c[1])], [30, 0], [40, f(w)], [41, f(ht)], [68, id === 1 ? 1 : id], [69, id], [12, f(view[0])], [22, f(view[1])], [13, 0], [23, 0], [14, 10], [24, 10], [15, 10], [25, 10],
    [16, 0], [26, 0], [36, 1], [17, 0], [27, 0], [37, 0], [42, 50], [43, 0], [44, 0], [45, f(viewH)], [50, 0], [51, 0], [72, 1000], [90, flags], [1, ""], [281, 0], [71, 0], [74, 0],
    [110, 0], [120, 0], [130, 0], [111, 1], [121, 0], [131, 0], [112, 0], [122, 1], [132, 0], [79, 0], [146, 0], [282, 0]];
}

/** DXF metninde satır sonu ve kontrol karakteri olamaz */
const clean = (s: string) => s.replace(/[\r\n\t]+/g, " ").replace(/[\u0000-\u001f]/g, "");

interface Block { name: string; space: Space; attdefs: AttDef[]; anon: boolean }
interface Layout { name: string; space: Space; w: number; h: number; media: string }

export class DxfDoc {
  model: Space;
  blocks = new Map<string, Block>();
  layouts: Layout[] = [];
  layers: LayerDef[] = [];
  ltypes: LtypeDef[] = [];
  textStyle = "PLANHANE";
  dimStyle?: DimStyleDef;
  private anonN = 0;
  private h = 0x30;
  constructor(public k: number, public insunits: number) {
    this.model = new Space(this, k);
  }
  handle() { return (this.h++).toString(16).toUpperCase(); }
  /** Blok tanımı (bir kez); build blok uzayına metre cinsinden çizer. */
  block(name: string, build: (s: Space) => void, attdefs: AttDef[] = []) {
    if (!this.blocks.has(name)) {
      const s = new Space(this, this.k);
      build(s);
      for (const a of attdefs) s.see(a.x, a.y);
      this.blocks.set(name, { name, space: s, attdefs, anon: false });
    }
    return name;
  }
  anonBlock(s: Space) {
    const name = `*D${++this.anonN}`;
    this.blocks.set(name, { name, space: s, attdefs: [], anon: true });
    return name;
  }
  layout(name: string, w: number, h: number, media: string) {
    const l: Layout = { name, space: new Space(this, 1), w, h, media };
    this.layouts.push(l);
    return l.space;
  }

  toString(): string {
    const H = () => this.handle();
    // sabit tablo ve nesne tutamaçları
    const T = { vport: H(), ltype: H(), layer: H(), style: H(), view: H(), ucs: H(), appid: H(), dimstyle: H(), brec: H() };
    const D = { root: H(), group: H(), layout: H(), material: H(), mleader: H(), mline: H(), plotset: H(), plotname: H(), placeholder: H(), scalelist: H(), tablestyle: H(), visual: H(), color: H() };
    const mat = { byblock: H(), bylayer: H(), global: H() };
    const mlineStd = H(), mleaderStd = H();
    const styleH = { std: H(), ph: H() };
    const ms = { rec: H(), blk: H(), end: H(), layout: H() };
    const layouts = (this.layouts.length ? this.layouts : []).map((l, i) => ({ l, i, rec: H(), blk: H(), end: H(), obj: H(), vp: H(), bname: i === 0 ? "*Paper_Space" : `*Paper_Space${i - 1}` }));
    // kağıt uzayı yoksa yine de boş bir *Paper_Space gerekir
    const emptyPs = layouts.length ? null : { rec: H(), blk: H(), end: H(), obj: H() };
    const blocks = [...this.blocks.values()].map((b) => ({ b, rec: H(), blk: H(), end: H() }));

    const out: string[] = [];
    const put = (tags: Tag[]) => { for (const [c, v] of tags) out.push(String(c), typeof v === "number" ? f(v) : v); };
    const entities = (s: Space, owner: string, paper: boolean) => {
      for (const e of s.ents) {
        const h = H();
        put(e.tags(h, owner, paper, this));
        if (e.sub) for (const t of e.sub(h, owner, paper, this)) put(t);
      }
    };
    const blockBegin = (rec: string, blk: string, name: string, flags: number, paper = false) => put([[0, "BLOCK"], [5, blk], [330, rec], [100, "AcDbEntity"], ...(paper ? [[67, 1] as Tag] : []), [8, "0"], [100, "AcDbBlockBegin"], [2, name], [70, flags], [10, 0], [20, 0], [30, 0], [3, name], [1, ""]]);
    const blockEnd = (rec: string, end: string, paper = false) => put([[0, "ENDBLK"], [5, end], [330, rec], [100, "AcDbEntity"], ...(paper ? [[67, 1] as Tag] : []), [8, "0"], [100, "AcDbBlockEnd"]]);

    // ---- CLASSES
    put([[0, "SECTION"], [2, "CLASSES"]]);
    for (const [n, c, app, fl] of [["ACDBDICTIONARYWDFLT", "AcDbDictionaryWithDefault", "ObjectDBX Classes", 0], ["MATERIAL", "AcDbMaterial", "ObjectDBX Classes", 1153], ["MLEADERSTYLE", "AcDbMLeaderStyle", "ACDB_MLEADERSTYLE_CLASS", 4095], ["ACDBPLACEHOLDER", "AcDbPlaceHolder", "ObjectDBX Classes", 0], ["LAYOUT", "AcDbLayout", "ObjectDBX Classes", 0]] as [string, string, string, number][])
      put([[0, "CLASS"], [1, n], [2, c], [3, app], [90, fl], [91, 0], [280, 0], [281, 0]]);
    put([[0, "ENDSEC"]]);

    // ---- TABLES
    put([[0, "SECTION"], [2, "TABLES"]]);
    const table = (name: string, h: string, n: number, extra: Tag[] = []) => put([[0, "TABLE"], [2, name], [5, h], [330, 0], [100, "AcDbSymbolTable"], [70, n], ...extra]);
    const rec = (type: string, h: string, owner: string, sub: string, tags: Tag[], hcode = 5) => put([[0, type], [hcode, h], [330, owner], [100, "AcDbSymbolTableRecord"], [100, sub], ...tags]);
    // VPORT: açılışta model kapsamına yakınlaş
    const mn = this.model.min, mx = this.model.max;
    const ext = isFinite(mn[0]) ? { cx: ((mn[0] + mx[0]) / 2) * this.k, cy: ((mn[1] + mx[1]) / 2) * this.k, h: Math.max(1, (mx[1] - mn[1]) * 1.15) * this.k, w: Math.max(1, (mx[0] - mn[0]) * 1.15) * this.k } : { cx: 0, cy: 0, h: 100, w: 100 };
    table("VPORT", T.vport, 1);
    rec("VPORT", H(), T.vport, "AcDbViewportTableRecord", [[2, "*Active"], [70, 0], [10, 0], [20, 0], [11, 1], [21, 1], [12, f(ext.cx)], [22, f(ext.cy)], [13, 0], [23, 0], [14, 10], [24, 10], [15, 10], [25, 10], [16, 0], [26, 0], [36, 1], [17, 0], [27, 0], [37, 0], [40, f(Math.max(ext.h, ext.w / 1.6))], [41, 1.6], [42, 50], [43, 0], [44, 0], [50, 0], [51, 0], [71, 0], [72, 1000], [73, 1], [74, 3], [75, 0], [76, 0], [77, 0], [78, 0], [281, 0], [65, 1], [110, 0], [120, 0], [130, 0], [111, 1], [121, 0], [131, 0], [112, 0], [122, 1], [132, 0], [79, 0], [146, 0]]);
    put([[0, "ENDTAB"]]);

    const lts: LtypeDef[] = [{ name: "ByBlock", desc: "", pattern: [] }, { name: "ByLayer", desc: "", pattern: [] }, { name: "Continuous", desc: "Solid line", pattern: [] }, ...this.ltypes];
    table("LTYPE", T.ltype, lts.length);
    for (const lt of lts) {
      const pat = lt.pattern.map((v) => v * this.k);
      rec("LTYPE", H(), T.ltype, "AcDbLinetypeTableRecord", [[2, lt.name], [70, 0], [3, lt.desc], [72, 65], [73, pat.length], [40, f(pat.reduce((s, v) => s + Math.abs(v), 0))], ...pat.flatMap((v): Tag[] => [[49, f(v)], [74, 0]])]);
    }
    put([[0, "ENDTAB"]]);

    const lays: LayerDef[] = [{ name: "0", color: 7, lw: -3 }, { name: "Defpoints", color: 7, lw: -3, plot: false }, ...this.layers];
    table("LAYER", T.layer, lays.length);
    for (const l of lays) rec("LAYER", H(), T.layer, "AcDbLayerTableRecord", [[2, l.name], [70, 0], [62, l.color], [6, l.ltype ?? "Continuous"], ...(l.plot === false ? [[290, 0] as Tag] : []), [370, l.lw], [390, D.placeholder]]);
    put([[0, "ENDTAB"]]);

    table("STYLE", T.style, 2);
    rec("STYLE", styleH.std, T.style, "AcDbTextStyleTableRecord", [[2, "Standard"], [70, 0], [40, 0], [41, 1], [50, 0], [71, 0], [42, 2.5], [3, "txt"], [4, ""]]);
    rec("STYLE", styleH.ph, T.style, "AcDbTextStyleTableRecord", [[2, this.textStyle], [70, 0], [40, 0], [41, 1], [50, 0], [71, 0], [42, 2.5], [3, "arial.ttf"], [4, ""]]);
    put([[0, "ENDTAB"]]);
    table("VIEW", T.view, 0); put([[0, "ENDTAB"]]);
    table("UCS", T.ucs, 0); put([[0, "ENDTAB"]]);
    table("APPID", T.appid, 1);
    rec("APPID", H(), T.appid, "AcDbRegAppTableRecord", [[2, "ACAD"], [70, 0]]);
    put([[0, "ENDTAB"]]);

    const dsList: DimStyleDef[] = [{ name: "Standard", scale: 1, lfac: 1, txt: 2.5, tsz: 0, exe: 1.25, exo: 0.625, dle: 0, gap: 0.625, dec: 2 }, ...(this.dimStyle ? [this.dimStyle] : [])];
    table("DIMSTYLE", T.dimstyle, dsList.length, [[100, "AcDbDimStyleTable"]]);
    for (const s of dsList)
      rec("DIMSTYLE", H(), T.dimstyle, "AcDbDimStyleTableRecord", [[2, s.name], [70, 0], [3, ""], [40, f(s.scale)], [41, 2.5], [42, f(s.exo)], [43, 3.75], [44, f(s.exe)], [45, 0], [46, f(s.dle)], [140, f(s.txt)], [141, 2.5], [142, f(s.tsz)], [144, f(s.lfac)], [147, f(s.gap)], [73, 0], [74, 0], [77, 1], [78, 0], [172, 1], [176, 256], [177, 256], [178, 256], [271, s.dec], [277, 2], [278, 46], [279, 2], [289, 3], [340, s.name === "Standard" ? styleH.std : styleH.ph], [371, -2], [372, -2]], 105);
    put([[0, "ENDTAB"]]);

    const brecs: [string, string, string][] = [[ms.rec, "*Model_Space", ms.layout], ...layouts.map((x): [string, string, string] => [x.rec, x.bname, x.obj]), ...(emptyPs ? [[emptyPs.rec, "*Paper_Space", emptyPs.obj] as [string, string, string]] : []), ...blocks.map((x): [string, string, string] => [x.rec, x.b.name, "0"])];
    table("BLOCK_RECORD", T.brec, brecs.length);
    for (const [h, n, lay] of brecs) rec("BLOCK_RECORD", h, T.brec, "AcDbBlockTableRecord", [[2, n], [340, lay], [70, 0], [280, 1], [281, 0]]);
    put([[0, "ENDTAB"], [0, "ENDSEC"]]);

    // ---- BLOCKS
    put([[0, "SECTION"], [2, "BLOCKS"]]);
    blockBegin(ms.rec, ms.blk, "*Model_Space", 0); blockEnd(ms.rec, ms.end);
    for (const x of layouts) {
      blockBegin(x.rec, x.blk, x.bname, 0, x.i > 0);
      if (x.i > 0) { put(vpTags(x.vp, x.rec, true, "0", [x.l.w / 2, x.l.h / 2], x.l.w * 1.1, x.l.h * 1.1, [x.l.w / 2, x.l.h / 2], x.l.h * 1.1, 1, 557088)); entities(x.l.space, x.rec, true); }
      blockEnd(x.rec, x.end, x.i > 0);
    }
    if (emptyPs) { blockBegin(emptyPs.rec, emptyPs.blk, "*Paper_Space", 0); blockEnd(emptyPs.rec, emptyPs.end); }
    for (const x of blocks) {
      const hasAtt = x.b.attdefs.length > 0;
      blockBegin(x.rec, x.blk, x.b.name, (x.b.anon ? 1 : 0) | (hasAtt ? 2 : 0));
      entities(x.b.space, x.rec, false);
      for (const a of x.b.attdefs) {
        const ax = f(a.x * this.k), ay = f(a.y * this.k);
        put([[0, "ATTDEF"], [5, H()], [330, x.rec], [100, "AcDbEntity"], [8, "0"], [100, "AcDbText"], [10, ax], [20, ay], [30, 0], [40, f(a.h * this.k)], [1, clean(a.def ?? "")], [50, 0], [7, this.textStyle], [72, a.align ?? 1], [11, ax], [21, ay], [31, 0], [100, "AcDbAttributeDefinition"], [280, 0], [3, clean(a.prompt)], [2, a.tag], [70, a.invisible ? 1 : 0], [74, 0]]);
      }
      blockEnd(x.rec, x.end);
    }
    put([[0, "ENDSEC"]]);

    // ---- ENTITIES (model + etkin kağıt düzeni)
    put([[0, "SECTION"], [2, "ENTITIES"]]);
    entities(this.model, ms.rec, false);
    const first = layouts[0];
    if (first) { put(vpTags(first.vp, first.rec, true, "0", [first.l.w / 2, first.l.h / 2], first.l.w * 1.1, first.l.h * 1.1, [first.l.w / 2, first.l.h / 2], first.l.h * 1.1, 1, 557088)); entities(first.l.space, first.rec, true); }
    put([[0, "ENDSEC"]]);

    // ---- OBJECTS
    put([[0, "SECTION"], [2, "OBJECTS"]]);
    const dict = (h: string, owner: string, items: [string, string][], hard = false) => put([[0, "DICTIONARY"], [5, h], [330, owner], [100, "AcDbDictionary"], ...(hard ? [[280, 1] as Tag] : []), [281, 1], ...items.flatMap(([n, v]): Tag[] => [[3, n], [350, v]])]);
    dict(D.root, "0", [["ACAD_COLOR", D.color], ["ACAD_GROUP", D.group], ["ACAD_LAYOUT", D.layout], ["ACAD_MATERIAL", D.material], ["ACAD_MLEADERSTYLE", D.mleader], ["ACAD_MLINESTYLE", D.mline], ["ACAD_PLOTSETTINGS", D.plotset], ["ACAD_PLOTSTYLENAME", D.plotname], ["ACAD_SCALELIST", D.scalelist], ["ACAD_TABLESTYLE", D.tablestyle], ["ACAD_VISUALSTYLE", D.visual]]);
    dict(D.color, D.root, []);
    dict(D.group, D.root, []);
    dict(D.layout, D.root, [["Model", ms.layout], ...layouts.map((x): [string, string] => [x.l.name, x.obj]), ...(emptyPs ? [["Layout1", emptyPs.obj] as [string, string]] : [])]);
    dict(D.material, D.root, [["ByBlock", mat.byblock], ["ByLayer", mat.bylayer], ["Global", mat.global]]);
    dict(D.mleader, D.root, [["Standard", mleaderStd]]);
    dict(D.mline, D.root, [["Standard", mlineStd]]);
    dict(D.plotset, D.root, []);
    put([[0, "ACDBDICTIONARYWDFLT"], [5, D.plotname], [330, D.root], [100, "AcDbDictionary"], [281, 1], [3, "Normal"], [350, D.placeholder], [100, "AcDbDictionaryWithDefault"], [340, D.placeholder]]);
    put([[0, "ACDBPLACEHOLDER"], [5, D.placeholder], [330, D.plotname]]);
    dict(D.scalelist, D.root, []);
    dict(D.tablestyle, D.root, []);
    dict(D.visual, D.root, []);
    for (const [h, n] of [[mat.byblock, "ByBlock"], [mat.bylayer, "ByLayer"], [mat.global, "Global"]])
      put([[0, "MATERIAL"], [5, h], [102, "{ACAD_REACTORS"], [330, D.material], [102, "}"], [330, D.material], [100, "AcDbMaterial"], [1, n], [2, ""], [70, 0], [40, 1], [71, 1], [41, 1], [91, -1023410177], [42, 1], [72, 1], [3, ""], [73, 1], [74, 1], [75, 1], [44, 0.5], [73, 0], [45, 1], [46, 1], [77, 1], [4, ""], [78, 1], [79, 1], [170, 1], [48, 1], [171, 1], [6, ""], [172, 1], [173, 1], [174, 1], [140, 1], [141, 1], [175, 1], [7, ""], [176, 1], [177, 1], [178, 1], [143, 1], [179, 1], [8, ""], [270, 1], [271, 1], [272, 1], [145, 1], [146, 1], [273, 1], [9, ""], [274, 1], [275, 1], [276, 1], [42, 1], [72, 1], [3, ""], [73, 1], [74, 1], [75, 1], [94, 63]]);
    put([[0, "MLINESTYLE"], [5, mlineStd], [102, "{ACAD_REACTORS"], [330, D.mline], [102, "}"], [330, D.mline], [100, "AcDbMlineStyle"], [2, "Standard"], [70, 0], [3, ""], [62, 256], [51, 90], [52, 90], [71, 2], [49, 0.5], [62, 256], [6, "BYLAYER"], [49, -0.5], [62, 256], [6, "BYLAYER"]]);
    put([[0, "MLEADERSTYLE"], [5, mleaderStd], [102, "{ACAD_REACTORS"], [330, D.mleader], [102, "}"], [330, D.mleader], [100, "AcDbMLeaderStyle"], [179, 2], [170, 2], [171, 1], [172, 0], [90, 2], [40, 0], [41, 0], [173, 1], [91, -1056964608], [92, -2], [290, 1], [42, 2], [291, 1], [43, 8], [3, "Standard"], [44, 4], [300, ""], [342, styleH.std], [174, 1], [175, 1], [176, 0], [178, 1], [93, -1056964608], [45, 4], [292, 0], [297, 0], [46, 4], [94, -1056964608], [47, 1], [49, 1], [140, 1], [294, 1], [141, 0], [177, 0], [142, 1], [295, 0], [296, 0], [143, 3.75], [271, 0], [272, 9], [273, 9]]);
    const plot = (paper: { w: number; h: number; media: string } | null): Tag[] => [[100, "AcDbPlotSettings"], [1, ""], [2, paper ? "DWG To PDF.pc3" : "none_device"], [4, paper?.media ?? ""], [6, ""], [40, 0], [41, 0], [42, 0], [43, 0], [44, f(paper?.w ?? 420)], [45, f(paper?.h ?? 297)], [46, 0], [47, 0], [48, 0], [49, 0], [140, 0], [141, 0], [142, 1], [143, 1], [70, paper ? 672 : 1024], [72, 1], [73, 0], [74, 5], [7, "monochrome.ctb"], [75, 16], [76, 0], [77, 2], [78, 300], [147, 1], [148, 0], [149, 0]];
    const layoutObj = (h: string, name: string, tab: number, w: number, hh: number, brec: string, vp: string | null, paper: { w: number; h: number; media: string } | null, model = false) =>
      put([[0, "LAYOUT"], [5, h], [102, "{ACAD_REACTORS"], [330, D.layout], [102, "}"], [330, D.layout], ...plot(paper), [100, "AcDbLayout"], [1, name], [70, 1], [71, tab], [10, 0], [20, 0], [11, f(w)], [21, f(hh)], [12, 0], [22, 0], [32, 0], [14, model ? f(mn[0] * this.k) : 0], [24, model ? f(mn[1] * this.k) : 0], [34, 0], [15, model ? f(mx[0] * this.k) : f(w)], [25, model ? f(mx[1] * this.k) : f(hh)], [35, 0], [146, 0], [13, 0], [23, 0], [33, 0], [16, 1], [26, 0], [36, 0], [17, 0], [27, 1], [37, 0], [76, 1], [330, brec], ...(vp ? [[331, vp] as Tag] : [])]);
    layoutObj(ms.layout, "Model", 0, 420, 297, ms.rec, null, null, true);
    for (const x of layouts) layoutObj(x.obj, x.l.name, x.i + 1, x.l.w, x.l.h, x.rec, x.vp, x.l);
    if (emptyPs) layoutObj(emptyPs.obj, "Layout1", 1, 420, 297, emptyPs.rec, null, { w: 420, h: 297, media: "ISO_full_bleed_A3_(420.00_x_297.00_MM)" });
    put([[0, "ENDSEC"], [0, "EOF"]]);

    // ---- HEADER (tutamaç tohumu en sonda bilinir)
    const hd: string[] = [];
    const hv = (name: string, tags: Tag[]) => { hd.push("9", name); for (const [c, v] of tags) hd.push(String(c), typeof v === "number" ? f(v) : v); };
    hd.push("0", "SECTION", "2", "HEADER");
    hv("$ACADVER", [[1, "AC1024"]]);
    hv("$ACADMAINTVER", [[70, 6]]);
    hv("$DWGCODEPAGE", [[3, "ANSI_1254"]]);
    hv("$INSBASE", [[10, 0], [20, 0], [30, 0]]);
    hv("$EXTMIN", [[10, f(mn[0] * this.k)], [20, f(mn[1] * this.k)], [30, 0]]);
    hv("$EXTMAX", [[10, f(mx[0] * this.k)], [20, f(mx[1] * this.k)], [30, 0]]);
    hv("$LIMMIN", [[10, 0], [20, 0]]);
    hv("$LIMMAX", [[10, 420], [20, 297]]);
    hv("$LTSCALE", [[40, 1]]);
    hv("$PSLTSCALE", [[70, 0]]);
    hv("$TEXTSTYLE", [[7, this.textStyle]]);
    hv("$CLAYER", [[8, "0"]]);
    hv("$DIMSTYLE", [[2, this.dimStyle?.name ?? "Standard"]]);
    hv("$DIMSCALE", [[40, f(this.dimStyle?.scale ?? 1)]]);
    hv("$DIMTXSTY", [[7, this.textStyle]]);
    hv("$DIMASSOC", [[280, 1]]);
    hv("$LUNITS", [[70, 2]]);
    hv("$LUPREC", [[70, 2]]);
    hv("$INSUNITS", [[70, this.insunits]]);
    hv("$MEASUREMENT", [[70, 1]]);
    hv("$LWDISPLAY", [[290, 1]]);
    hv("$TILEMODE", [[70, 1]]);
    hv("$HANDSEED", [[5, (this.h + 16).toString(16).toUpperCase()]]);
    hd.push("0", "ENDSEC");
    return [...hd, ...out].join("\r\n") + "\r\n";
  }
  toBytes() { return new TextEncoder().encode(this.toString()); }
}
