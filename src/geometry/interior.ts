// İç mekân mimarisi: ergonomi / dolaşım denetimi, iç mekân üslupları (renk-malzeme paletleri) ve aydınlatma ön planı.
// Ölçüler Neufert, NKBA (mutfak-banyo planlama kılavuzları), TS 9111 ve yaygın iç mimarlık uygulamasından sadeleştirilmiştir;
// kesin yönetmelik denetimi değil, mimara erken uyarıdır.
import type { FloorLayout, PlacedRoom } from "./layout";
import { FLAT, FRONT_RULE, LIGHT, ON_COUNTER, WC_SIDE, furnishFloor, furnitureLabel, type Furniture, type FurnitureKind } from "./furniture";

// ---------------------------------------------------------------- ÜSLUPLAR
/** Mobilya malzeme tonları (furniture3d MAT anahtarları) + iç duvar boyası ve döşeme tonu */
export interface InteriorPalette {
  oak: number; walnut: number; lacquer: number; stone: number; metal: number;
  sofa: number; accentFabric: number; cushion: number; duvet: number; rug: number; rugBorder: number; pot: number;
  /** İç duvar boyası */
  wall: number;
  /** Parke tonu (dokunun üstüne çarpılır; beyaz = dokunun kendi rengi) */
  floor: number;
  /** Islak hacim seramiği tonu */
  tile: number;
}
export interface InteriorStyle { id: string; name: string; hint: string; en: string; palette: InteriorPalette }

export const INTERIOR_STYLES: InteriorStyle[] = [
  {
    id: "dogal", name: "Sıcak doğal", hint: "Meşe ve ceviz, kum-gri kumaş, kırık beyaz duvar",
    en: "warm natural contemporary interior: oak and walnut wood, sand and grey fabrics, off-white walls, oak parquet",
    palette: { oak: 0xb88a5a, walnut: 0x6e4a32, lacquer: 0xe9e6e0, stone: 0xdcd7cf, metal: 0x1d1e20, sofa: 0x8b929a, accentFabric: 0x56708a, cushion: 0xc8b9a2, duvet: 0xd9d3e6, rug: 0xb7a184, rugBorder: 0x7d6a55, pot: 0xc0835d, wall: 0xfbfaf7, floor: 0xffffff, tile: 0xffffff },
  },
  {
    id: "modern", name: "Modern minimal", hint: "Beyaz lake, antrasit, açık gri taş, tek vurgu rengi",
    en: "modern minimalist interior: white matte lacquer joinery, anthracite metal, light grey stone worktops, pale oak floor, a single deep blue accent, clean lines, hidden lighting",
    palette: { oak: 0xd2b590, walnut: 0x4a4a4c, lacquer: 0xf6f6f4, stone: 0xe4e4e2, metal: 0x2a2b2e, sofa: 0xa9adb2, accentFabric: 0x2f4a6b, cushion: 0xe8e6e2, duvet: 0xf2f2f0, rug: 0xc9c7c2, rugBorder: 0x8f8d89, pot: 0xe9e7e3, wall: 0xf7f7f5, floor: 0xf4ece2, tile: 0xf2f2f2 },
  },
  {
    id: "japandi", name: "Japandi", hint: "Açık meşe, keten, bej-kil tonları, alçak mobilya, sade",
    en: "japandi interior: light oak and ash wood, natural linen, beige, clay and warm grey tones, low furniture, paper lamps, calm and uncluttered, matte plaster walls",
    palette: { oak: 0xcaa982, walnut: 0x8a6a4f, lacquer: 0xe8e0d4, stone: 0xcfc6b8, metal: 0x3b3833, sofa: 0xd9cfbf, accentFabric: 0x9b7b62, cushion: 0xb9a68e, duvet: 0xefe9df, rug: 0xd8ccb8, rugBorder: 0xa8957b, pot: 0x8c7a68, wall: 0xf1ece3, floor: 0xf6eadb, tile: 0xece6dc },
  },
  {
    id: "iskandinav", name: "İskandinav", hint: "Huş/açık meşe, beyaz, açık gri, pastel mavi-yeşil",
    en: "scandinavian interior: white walls, birch and light oak, light grey textiles, soft pastel blue and sage accents, cosy wool throws, bright and airy",
    palette: { oak: 0xd9bf98, walnut: 0xb8996f, lacquer: 0xfafaf8, stone: 0xf0efeb, metal: 0x2b2b2b, sofa: 0xc4c7c9, accentFabric: 0x9fb3a3, cushion: 0xe6ddd0, duvet: 0xf5f5f3, rug: 0xe7e3dc, rugBorder: 0xb9b4ab, pot: 0xf1efea, wall: 0xfcfcfa, floor: 0xfaf1e4, tile: 0xf6f6f4 },
  },
  {
    id: "klasik", name: "Çağdaş klasik", hint: "Ceviz, krem ve bej, kadife lacivert, pirinç detay",
    en: "contemporary classic (neoclassical) interior: cream and beige walls with moulding panels, walnut wood, navy velvet upholstery, brass details, marble worktops, herringbone parquet",
    palette: { oak: 0x9a6a43, walnut: 0x5a3a26, lacquer: 0xf1eadc, stone: 0xeeeae4, metal: 0xb08d57, sofa: 0x2e3a5c, accentFabric: 0x7a2e3a, cushion: 0xe4d6bd, duvet: 0xf3ecdf, rug: 0x9b7f63, rugBorder: 0x5c4535, pot: 0xd9c9a8, wall: 0xf4eee2, floor: 0xe8d2b8, tile: 0xf1ece4 },
  },
  {
    id: "endustriyel", name: "Endüstriyel", hint: "Brüt beton gri, siyah metal, koyu ahşap, konyak deri",
    en: "industrial loft interior: raw concrete grey surfaces, black steel, dark reclaimed wood, cognac leather sofa, exposed bulbs, dark grey stone worktops",
    palette: { oak: 0x7d5a3c, walnut: 0x3f2c20, lacquer: 0x4a4c4f, stone: 0x6b6d70, metal: 0x151515, sofa: 0x8a4f2b, accentFabric: 0x4b5a46, cushion: 0x9c9690, duvet: 0xb9b6b0, rug: 0x6f6a63, rugBorder: 0x3a3733, pot: 0x5a5c5e, wall: 0xc9c7c3, floor: 0xbfa58a, tile: 0xb0b0ae },
  },
  {
    id: "akdeniz", name: "Akdeniz / Ege", hint: "Kireç beyazı, terrakota, hasır, deniz mavisi",
    en: "mediterranean aegean interior: lime-washed white walls, terracotta and natural rattan, light washed wood, sea blue textiles, linen curtains, handmade ceramics",
    palette: { oak: 0xc9a47a, walnut: 0x9a7350, lacquer: 0xf7f3ea, stone: 0xe9e2d4, metal: 0x3a3a3a, sofa: 0xede6d8, accentFabric: 0x2f6d9a, cushion: 0xc96f45, duvet: 0xf7f4ee, rug: 0xd9c7a5, rugBorder: 0x2f6d9a, pot: 0xc0673f, wall: 0xfbf8f1, floor: 0xf1d9bf, tile: 0xf4efe6 },
  },
  {
    id: "turk", name: "Çağdaş Türk", hint: "Ceviz, kilim desenli halı, bakır, çini mavisi, sıcak krem",
    en: "contemporary Turkish interior: walnut joinery, kilim-pattern rug, copper and brass accents, iznik tile blue and turquoise cushions, warm cream walls, carved wood details",
    palette: { oak: 0x8f5f3c, walnut: 0x5b3a25, lacquer: 0xefe6d6, stone: 0xe6dfd2, metal: 0xa8683d, sofa: 0xb8a589, accentFabric: 0x1f6f8b, cushion: 0xa3342e, duvet: 0xf0e6d6, rug: 0xa3342e, rugBorder: 0x2a4f7a, pot: 0x2a8a9a, wall: 0xf3eadb, floor: 0xe6cba8, tile: 0xe9f1f2 },
  },
];
export const DEFAULT_INTERIOR = "dogal";
export const interiorStyle = (id?: string | null) => INTERIOR_STYLES.find((s) => s.id === id) ?? INTERIOR_STYLES[0];

/** Dış üslup paketinden iç mekân üslubu tahmini (mimar seçmediyse) */
const FROM_PACK: Record<string, string> = { modern: "modern", avlulu: "japandi", akdeniz: "akdeniz", bodrum: "akdeniz", iskandinav: "iskandinav", tas: "turk", endustriyel: "endustriyel" };
export function effectiveInteriorStyle(p: { interiorStyle?: string | null; design?: { interiorStyle?: string; stylePack?: string } | null }): string {
  return p.design?.interiorStyle ?? p.interiorStyle ?? FROM_PACK[p.design?.stylePack ?? ""] ?? DEFAULT_INTERIOR;
}

// ---------------------------------------------------------------- DENETİM
export interface InteriorIssue {
  roomId: string;
  room: string;
  /** İlgili mobilya (seçmek için) */
  itemId?: string;
  /** uyari: kullanımı engeller; oneri: konfor / iyi uygulama */
  level: "uyari" | "oneri";
  message: string;
}

type Box = { x: number; y: number; w: number; h: number };
type Dir = "n" | "s" | "e" | "w";
const cm = (v: number) => `${Math.round(v * 100)} cm`;

const overlap = (a: Box, b: Box, e = 1e-3) => a.x < b.x + b.w - e && a.x + a.w > b.x + e && a.y < b.y + b.h - e && a.y + a.h > b.y + e;
/** Mobilyanın önü (sırtının tersi), düzlemde */
const FRONT: Record<Dir, Dir> = { n: "s", s: "n", w: "e", e: "w" };
/** facing'e göre ön yön: facing n = sırt y küçük kenarda, önü +y (plan "s" tarafı) */
const frontOf = (f: Furniture): Dir => FRONT[f.facing];
const sidesOf = (f: Furniture): [Dir, Dir] => (f.facing === "n" || f.facing === "s" ? ["w", "e"] : ["n", "s"]);
const backOf = (f: Furniture): Dir => f.facing;

/**
 * b kutusunun d yönündeki kenarından, oda duvarına ya da ilk engele kadar boş mesafe.
 * band: kenar boyunca dikkate alınan aralık (verilmezse kutunun tamamı).
 * Uzun parçalarda (≥ 1.2 m) köşedeki 65 cm'lik bir kesinti hoş görülür (L tezgâh / L dolap köşesi):
 * sonuç, kenar boyunca en az (uzunluk − 65 cm) genişliğindeki en iyi açıklığın derinliğidir.
 */
function clearance(b: Box, d: Dir, room: Box, obstacles: Box[], band?: [number, number]): number {
  const alongX = d === "n" || d === "s";
  const [lo, hi] = band ?? (alongX ? [b.x, b.x + b.w] : [b.y, b.y + b.h]);
  const edge = d === "s" ? b.y + b.h : d === "n" ? b.y : d === "e" ? b.x + b.w : b.x;
  const wall = d === "s" ? room.y + room.h - edge : d === "n" ? edge - room.y : d === "e" ? room.x + room.w - edge : edge - room.x;
  const n = Math.max(1, Math.round((hi - lo) / 0.05));
  const prof: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = lo + ((i + 0.5) * (hi - lo)) / n;
    let v = wall;
    for (const o of obstacles) {
      const oLo = alongX ? o.x : o.y, oHi = alongX ? o.x + o.w : o.y + o.h;
      if (t <= oLo + 0.01 || t >= oHi - 0.01) continue;
      const gap = d === "s" ? o.y - edge : d === "n" ? edge - (o.y + o.h) : d === "e" ? o.x - edge : edge - (o.x + o.w);
      if (gap < -0.05) continue; // arkada ya da yanında
      v = Math.min(v, Math.max(0, gap));
    }
    prof.push(v);
  }
  const len = hi - lo;
  const win = len >= 1.2 ? Math.max(0.6, len - 0.65) : len;
  const k = Math.max(1, Math.min(n, Math.round((win / len) * n)));
  let best = 0;
  for (let i = 0; i + k <= n; i++) best = Math.max(best, Math.min(...prof.slice(i, i + k)));
  return Math.max(0, best);
}

/** Kapı kanadı ve kapı önü geçiş alanları (otomatik yerleşim de bunları boş bırakır) */
export function doorZones(fl: FloorLayout): Box[] {
  const keep: Box[] = [];
  for (const o of fl.openings) {
    if (o.kind === "window") continue;
    const a = o.center - o.width / 2 - 0.05, len = o.width + 0.1;
    const swingD = o.kind === "balconyDoor" ? 0.7 : o.width + 0.1;
    const backD = o.kind === "balconyDoor" ? 0.7 : 0.6;
    const lo = o.swing > 0 ? backD : swingD, hi = o.swing > 0 ? swingD : backD;
    keep.push(o.orient === "h" ? { x: a, y: o.line - lo, w: len, h: lo + hi } : { x: o.line - lo, y: a, w: lo + hi, h: len });
  }
  return keep;
}

const roomName = (r: PlacedRoom) => (r.unit ? `${r.unit} · ${r.name}` : r.name);
const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const inRect = (p: { x: number; y: number }, r: Box) => p.x >= r.x - 1e-6 && p.x <= r.x + r.w + 1e-6 && p.y >= r.y - 1e-6 && p.y <= r.y + r.h + 1e-6;
const dist = (a: Box, b: Box) => { const p = center(a), q = center(b); return Math.hypot(p.x - q.x, p.y - q.y); };

/** Kattaki mobilyaları iç mimarlık ölçülerine göre denetler. */
export function interiorChecks(fl: FloorLayout, items: Furniture[] = furnishFloor(fl)): InteriorIssue[] {
  const out: InteriorIssue[] = [];
  const doors = doorZones(fl);
  const rooms = fl.rooms.filter((r) => !r.void && r.type !== "merdiven" && r.band !== "hall");
  const roomOf = (f: Furniture) => fl.rooms.find((r) => !r.void && inRect(center(f), r.rect));
  const byRoom = new Map<string, Furniture[]>();
  for (const f of items) {
    const r = roomOf(f);
    if (r) byRoom.set(r.id, [...(byRoom.get(r.id) ?? []), f]);
  }
  for (const r of fl.rooms) {
    if (r.void) continue;
    const list = byRoom.get(r.id) ?? [];
    const R = r.rect, name = roomName(r);
    const add = (level: InteriorIssue["level"], message: string, f?: Furniture) => out.push({ roomId: r.id, room: name, itemId: f?.id, level, message });
    const solid = list.filter((f) => !FLAT.has(f.kind));
    for (const f of list) {
      const L = furnitureLabel(f.kind);
      // odanın dışına taşma
      if (f.x < R.x - 0.06 || f.y < R.y - 0.06 || f.x + f.w > R.x + R.w + 0.06 || f.y + f.h > R.y + R.h + 0.06) add("uyari", `${L} duvarın içine taşıyor.`, f);
      if (FLAT.has(f.kind)) continue;
      // kapı kanadı
      if (doors.some((d) => overlap(f, d, 0.05)) && f.kind !== "car") add("uyari", `${L} kapı kanadının / kapı önünün önünü kesiyor.`, f);
      // çakışma (tezgâh üstü parçalar birbirine geçebilir)
      for (const g of solid) {
        if (g === f || (g.id ?? "") <= (f.id ?? "")) continue;
        if (ON_COUNTER.has(f.kind) && ON_COUNTER.has(g.kind)) continue;
        if (overlap(f, g, 0.03)) add("uyari", `${L} ile ${furnitureLabel(g.kind)} üst üste biniyor.`, f);
      }
    }
    // ön boşluklar
    for (const f of solid) {
      const rule = FRONT_RULE[f.kind];
      if (!rule) continue;
      const obst = solid.filter((g) => g !== f && !LIGHT.has(g.kind) && !(ON_COUNTER.has(f.kind) && ON_COUNTER.has(g.kind)) && !(f.kind === "desk" && g.kind === "chair"));
      const c = clearance(f, frontOf(f), R, obst);
      const [min, rec, why] = rule;
      if (c < min - 0.01) add("uyari", `${furnitureLabel(f.kind)} önünde ${cm(c)} boşluk var; ${why} en az ${cm(min)} gerekir (önerilen ${cm(rec)}).`, f);
      else if (c < rec - 0.01 && f.kind !== "bed") add("oneri", `${furnitureLabel(f.kind)} önündeki boşluk ${cm(c)}; ${why} ${cm(rec)} önerilir.`, f);
    }
    // yatak: yanlarda geçiş (çift kişilikte iki yan, tek kişilikte bir yan)
    for (const bed of solid.filter((f) => f.kind === "bed")) {
      const [s1, s2] = sidesOf(bed);
      const back = backOf(bed);
      // komodin başucunda: yan geçiş yatağın baş tarafındaki 55 cm'yi saymaz
      const alongY = s1 === "w";
      const band: [number, number] = alongY
        ? back === "n" ? [bed.y + 0.55, bed.y + bed.h] : [bed.y, bed.y + bed.h - 0.55]
        : back === "w" ? [bed.x + 0.55, bed.x + bed.w] : [bed.x, bed.x + bed.w - 0.55];
      const obst = solid.filter((g) => g !== bed && !LIGHT.has(g.kind));
      const c1 = clearance(bed, s1, R, obst, band), c2 = clearance(bed, s2, R, obst, band);
      const double = Math.min(bed.w, bed.h) > 1.2;
      const best = Math.max(c1, c2), worst = Math.min(c1, c2);
      if (best < 0.5) add("uyari", `Yatağın iki yanında da geçiş yok (${cm(best)}); yatağa yandan girmek için en az 60 cm gerekir.`, bed);
      else if (double && worst < 0.45) add("oneri", `Çift kişilik yatağın bir yanı ${cm(worst)}; iki kişinin rahat kalkması için her iki yanda 60–70 cm önerilir.`, bed);
    }
    // yemek masası: sandalye arkası (masa kenarından 75 cm: sandalye 45 + geri çekme 30)
    for (const ch of solid.filter((f) => f.kind === "chair")) {
      const tables = solid.filter((g) => g.kind === "table" || g.kind === "desk" || g.kind === "island");
      if (!tables.length || Math.min(...tables.map((t) => dist(t, ch))) > 1.3) continue;
      const obst = solid.filter((g) => g !== ch && g.kind !== "chair" && !LIGHT.has(g.kind) && !tables.includes(g));
      const c = clearance(ch, backOf(ch), R, obst);
      if (c < 0.2) add("uyari", `Sandalyenin arkasında ${cm(c)} kalıyor; masadan kalkmak için sandalye arkasında en az 30 cm (masa kenarından 75 cm) gerekir.`, ch);
      else if (c < 0.45 && r.type !== "calisma" && r.type !== "ofis") add("oneri", `Sandalye arkası ${cm(c)}; arkasından geçilecekse masa kenarından 90–110 cm önerilir.`, ch);
    }
    // oturma grubu: kanepe – orta sehpa – TV
    for (const so of solid.filter((f) => f.kind === "sofa")) {
      const ct = solid.find((g) => g.kind === "coffeeTable");
      if (ct) {
        const c = clearance(so, frontOf(so), R, [ct]);
        if (c < 0.3) add("oneri", `Kanepe ile orta sehpa arası ${cm(c)}; diz payı için 35–45 cm önerilir.`, so);
        else if (c > 0.6 && c < 5) add("oneri", `Orta sehpa kanepeden ${cm(c)} uzakta; elle uzanılacak mesafe 35–45 cm.`, ct);
      }
      const tv = solid.find((g) => g.kind === "tvUnit");
      if (tv) {
        const d = dist(so, tv) - so.h / 2;
        if (d < 1.8) add("oneri", `Kanepe–TV arası yaklaşık ${cm(d)}; 55" ekran için 2,1–3,5 m izleme mesafesi önerilir.`, tv);
      }
    }
    // klozet ekseninden yan duvara / engele
    for (const wc of solid.filter((f) => f.kind === "wc")) {
      const [s1, s2] = sidesOf(wc);
      const half = (s1 === "w" ? wc.w : wc.h) / 2;
      const obst = solid.filter((g) => g !== wc);
      const m = Math.min(clearance(wc, s1, R, obst), clearance(wc, s2, R, obst)) + half;
      if (m < WC_SIDE - 0.025) add("uyari", `Klozet ekseninden yandaki duvara / parçaya ${cm(m)} var; en az 40 cm gerekir (önerilen 45 cm).`, wc);
      else if (m < 0.44) add("oneri", `Klozet ekseninden yana ${cm(m)}; 45 cm önerilir.`, wc);
    }
    // mutfak çalışma üçgeni ve hazırlık tezgâhı
    if (r.type === "mutfak" || list.some((f) => f.kind === "hob")) {
      const sink = list.find((f) => f.kind === "sink"), hob = list.find((f) => f.kind === "hob"), fridge = list.find((f) => f.kind === "fridge");
      if (sink && hob && fridge) {
        const legs = [dist(sink, hob), dist(hob, fridge), dist(fridge, sink)];
        const sum = legs[0] + legs[1] + legs[2];
        const m = (v: number) => v.toFixed(1).replace(".", ",");
        if (sum > 7.9) add("oneri", `Çalışma üçgeni (eviye–ocak–buzdolabı) ${m(sum)} m; 7,9 m'yi geçince fazla yürünür, 4–7,9 m önerilir.`);
        else if (Math.max(...legs) > 2.7) add("oneri", `Çalışma üçgeninin bir kenarı ${m(Math.max(...legs))} m; her kenar 1,2–2,7 m önerilir.`);
        if (Math.min(...legs) < 0.9) add("oneri", `Çalışma üçgeninin bir kenarı ${m(Math.min(...legs))} m; iki ana nokta çok yakın, arada hazırlık tezgâhı kalmıyor.`);
        // eviye ile ocak arasında en az 60 cm hazırlık tezgâhı, ocak ile buzdolabı arasında 30 cm
        const gap = (a: Box, b: Box) => Math.max(Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w), Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
        if (gap(sink, hob) < 0.55) add("oneri", `Eviye ile ocak arasında ${cm(Math.max(0, gap(sink, hob)))} tezgâh var; hazırlık için en az 60 cm (önerilen 90 cm) bırakın.`, hob);
        if (gap(hob, fridge) < 0.3) add("uyari", `Ocak buzdolabına ${cm(Math.max(0, gap(hob, fridge)))} yakın; ısı ve güvenlik için arada en az 30 cm tezgâh olmalı.`, hob);
      }
      if (r.type === "mutfak") {
        const run = list.filter((f) => f.kind === "counter").reduce((s, f) => s + Math.max(f.w, f.h), 0);
        if (run > 0 && run < 2.4) add("oneri", `Toplam tezgâh uzunluğu ${cm(run)}; eviye, ocak, buzdolabı ve hazırlık için en az 2,4 m (aile mutfağında 3,6 m+) önerilir.`);
      }
    }
    // yatak odasında dolap
    if (["ebeveyn", "yatak", "cocuk", "misafir"].includes(r.type) && !list.some((f) => f.kind === "wardrobe") && !fl.rooms.some((q) => q.type === "giyinme"))
      add("oneri", "Odada gardırop yok; kişi başı 60–90 cm askılı dolap boyu önerilir.");
  }
  // oda içinde mobilyası olmayan yaşam mahalleri (bilgi)
  void rooms;
  return out;
}

// ---------------------------------------------------------------- AYDINLATMA
/** Oda tipine göre genel aydınlatma düzeyi (lüks) ve renk sıcaklığı. Konutta katmanlı aydınlatma: genel ışık burada,
 *  çalışma yüzeyindeki 300–500 lx tezgâh altı / masa lambası / ayna apliğiyle sağlanır (EN 12464-1 ve konut uygulaması, sadeleştirilmiş). */
const LUX: Partial<Record<PlacedRoom["type"], [number, string]>> = {
  salon: [150, "2700–3000 K"], yemek: [200, "2700–3000 K"], mutfak: [200, "3000–4000 K"],
  ebeveyn: [100, "2700 K"], yatak: [100, "2700 K"], misafir: [100, "2700 K"], cocuk: [200, "3000 K"],
  calisma: [300, "4000 K"], ofis: [300, "4000 K"], banyo: [200, "3000–4000 K"], wc: [150, "3000 K"],
  camasir: [300, "4000 K"], giyinme: [300, "3000 K"], hol: [100, "2700–3000 K"], koridor: [100, "2700–3000 K"],
  antre: [150, "2700–3000 K"], merdiven: [150, "3000 K"], kiler: [150, "4000 K"], depo: [100, "4000 K"], garaj: [100, "4000 K"],
};
/** Tipik LED spot / armatür akısı (lm) ve gücü (W) */
const SPOT_LM = 700, SPOT_W = 7;
/** Kullanım × bakım faktörü */
const UF = 0.55;

export interface LightRow { roomId: string; room: string; area: number; lux: number; lumens: number; spots: number; watts: number; cct: string; task?: string }
export interface LightPoint { x: number; y: number; kind: "spot" | "pendant" | "strip"; roomId: string; w?: number; h?: number }

/** Odaya göre aydınlatma ön hesabı ve armatür yerleri (tavanda). */
export function lightingPlan(fl: FloorLayout, items: Furniture[] = furnishFloor(fl)): { rows: LightRow[]; points: LightPoint[] } {
  const rows: LightRow[] = [], points: LightPoint[] = [];
  for (const r of fl.rooms) {
    if (r.void) continue;
    const L = LUX[r.type] ?? [150, "3000 K"];
    const R = r.rect, area = R.w * R.h;
    const lumens = Math.round((L[0] * area) / UF / 50) * 50;
    const spots = Math.max(1, Math.round(lumens / SPOT_LM));
    // ızgara: odanın oranına göre nx × ny
    const nx = Math.max(1, Math.round(Math.sqrt((spots * R.w) / R.h))), ny = Math.max(1, Math.ceil(spots / nx));
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) points.push({ x: R.x + ((i + 0.5) * R.w) / nx, y: R.y + ((j + 0.5) * R.h) / ny, kind: "spot", roomId: r.id });
    const inR = items.filter((f) => inRect(center(f), R));
    let task: string | undefined;
    for (const t of inR.filter((f) => f.kind === "table" || f.kind === "island")) {
      const c = center(t);
      points.push({ x: c.x, y: c.y, kind: "pendant", roomId: r.id, w: Math.max(t.w, t.h) > 1.4 ? 1.0 : 0.4 });
      task = t.kind === "table" ? "Masa üstüne sarkıt (masadan 70–80 cm yukarıda)" : "Ada üstüne sarkıt";
    }
    const counters = inR.filter((f) => f.kind === "counter");
    for (const c of counters) points.push({ x: c.x, y: c.y, kind: "strip", roomId: r.id, w: c.w, h: c.h });
    if (counters.length) task = task ? `${task}; üst dolap altı LED şerit (tezgâhta 500 lx)` : "Üst dolap altı LED şerit (tezgâhta 500 lx)";
    if (r.type === "banyo" || r.type === "wc") task = "Ayna üstü/yanı aplik (yüzde gölge yapmaz); ıslak bölgede IP44+ armatür";
    if (["ebeveyn", "yatak", "misafir"].includes(r.type)) task = "Başucu okuma lambaları, dolap içi LED";
    if (r.type === "calisma" || r.type === "ofis") task = "Masada 500 lx için masa lambası; ekrana yansımasın diye armatürü masanın yanına alın";
    if (r.type === "merdiven") task = "Basamak ya da duvar aydınlatması (gece için düşük seviye)";
    rows.push({ roomId: r.id, room: roomName(r), area, lux: L[0], lumens, spots: nx * ny, watts: nx * ny * SPOT_W, cct: L[1], task });
  }
  return { rows, points };
}

/** Kattaki mobilyaların sayımı (mobilya listesi) */
export function furnitureCounts(items: Furniture[]): { kind: FurnitureKind; label: string; count: number }[] {
  const m = new Map<FurnitureKind, number>();
  for (const f of items) if (f.kind !== "car") m.set(f.kind, (m.get(f.kind) ?? 0) + 1);
  return [...m.entries()].map(([kind, count]) => ({ kind, label: furnitureLabel(kind), count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "tr"));
}
