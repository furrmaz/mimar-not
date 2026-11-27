// Oda tipine göre mobilya yerleşimi (plan, DXF ve 3D için) ve mimarın elle yaptığı düzenlemeler.
// Mobilyalar odanın hole bakmayan "arka" duvarına yaslanır; kapılar çoğunlukla hol tarafında olduğundan kanatlarla çakışmaz.
import type { FloorLayout, PlacedRoom } from "./layout";

export type FurnitureKind =
  | "bed" | "nightstand" | "wardrobe" | "sofa" | "armchair" | "coffeeTable" | "tvUnit" | "table" | "chair"
  | "counter" | "island" | "fridge" | "hob" | "sink" | "wc" | "basin" | "shower" | "bathtub" | "desk"
  | "washer" | "car" | "shelf" | "rug" | "plant" | "floorLamp" | "dresser" | "bench";

/** facing: mobilyanın sırtının yaslandığı kenar. n: y küçük kenar (+y yönüne bakar), s: y büyük kenar,
 *  w: x küçük kenar (+x yönüne bakar), e: x büyük kenar. x, y, w, h her zaman plandaki (dünya) kutudur. */
export interface Furniture {
  /** Düzenleme için kimlik (otomatik yerleşimde a0, a1…; elle eklenende u…) */
  id?: string;
  kind: FurnitureKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 3D yüksekliği (m) */
  height: number;
  facing: "n" | "s" | "e" | "w";
}

const HEIGHTS: Record<FurnitureKind, number> = {
  bed: 0.5, nightstand: 0.5, wardrobe: 2.2, sofa: 0.8, armchair: 0.8, coffeeTable: 0.4, tvUnit: 0.5, table: 0.75, chair: 0.85,
  counter: 0.9, island: 0.9, fridge: 1.85, hob: 0.9, sink: 0.9, wc: 0.4, basin: 0.85, shower: 0.05, bathtub: 0.55, desk: 0.75,
  washer: 0.85, car: 1.45, shelf: 2.0, rug: 0.01, plant: 1.2, floorLamp: 1.6, dresser: 0.85, bench: 0.45,
};

/** "Ekle" menüsü: Türkçe ad ve varsayılan ölçü (sırt boyunca genişlik × derinlik, m) */
export const FURNITURE_CATALOG: { kind: FurnitureKind; label: string; group: string; w: number; d: number }[] = [
  { kind: "sofa", label: "Kanepe", group: "Oturma", w: 2.2, d: 0.9 },
  { kind: "armchair", label: "Berjer", group: "Oturma", w: 0.8, d: 0.8 },
  { kind: "coffeeTable", label: "Orta sehpa", group: "Oturma", w: 1.1, d: 0.6 },
  { kind: "tvUnit", label: "TV ünitesi", group: "Oturma", w: 1.8, d: 0.45 },
  { kind: "rug", label: "Halı", group: "Oturma", w: 2.0, d: 1.4 },
  { kind: "floorLamp", label: "Lambader", group: "Oturma", w: 0.4, d: 0.4 },
  { kind: "plant", label: "Saksı bitkisi", group: "Oturma", w: 0.5, d: 0.5 },
  { kind: "shelf", label: "Kitaplık", group: "Oturma", w: 1.2, d: 0.35 },
  { kind: "table", label: "Yemek masası", group: "Yemek", w: 1.6, d: 0.9 },
  { kind: "chair", label: "Sandalye", group: "Yemek", w: 0.45, d: 0.45 },
  { kind: "bench", label: "Bank", group: "Yemek", w: 1.2, d: 0.4 },
  { kind: "bed", label: "Çift kişilik yatak", group: "Yatak odası", w: 1.6, d: 2.0 },
  { kind: "nightstand", label: "Komodin", group: "Yatak odası", w: 0.45, d: 0.4 },
  { kind: "wardrobe", label: "Gardırop", group: "Yatak odası", w: 1.8, d: 0.6 },
  { kind: "dresser", label: "Şifonyer", group: "Yatak odası", w: 1.2, d: 0.5 },
  { kind: "desk", label: "Çalışma masası", group: "Çalışma", w: 1.4, d: 0.7 },
  { kind: "counter", label: "Mutfak tezgâhı", group: "Mutfak", w: 2.4, d: 0.6 },
  { kind: "island", label: "Mutfak adası", group: "Mutfak", w: 1.8, d: 0.9 },
  { kind: "fridge", label: "Buzdolabı", group: "Mutfak", w: 0.7, d: 0.7 },
  { kind: "hob", label: "Ocak", group: "Mutfak", w: 0.6, d: 0.5 },
  { kind: "sink", label: "Eviye", group: "Mutfak", w: 0.8, d: 0.45 },
  { kind: "wc", label: "Klozet", group: "Islak hacim", w: 0.4, d: 0.6 },
  { kind: "basin", label: "Lavabo", group: "Islak hacim", w: 0.6, d: 0.45 },
  { kind: "shower", label: "Duş teknesi", group: "Islak hacim", w: 0.9, d: 0.9 },
  { kind: "bathtub", label: "Küvet", group: "Islak hacim", w: 1.7, d: 0.75 },
  { kind: "washer", label: "Çamaşır makinesi", group: "Islak hacim", w: 0.6, d: 0.6 },
  { kind: "car", label: "Otomobil", group: "Diğer", w: 1.9, d: 4.6 },
];
export const furnitureLabel = (k: FurnitureKind) => FURNITURE_CATALOG.find((c) => c.kind === k)?.label ?? k;

/** Döşemede düz duran (çakışma denetimine girmeyen) parçalar */
export const FLAT = new Set<FurnitureKind>(["rug", "shower"]);
/** Gezintide üstünden geçilebilen parçalar */
export const WALKABLE = new Set<FurnitureKind>(["rug", "shower"]);
/** Tezgâh üstü / tezgâh hattındaki parçalar (birbirine geçebilir) */
export const ON_COUNTER = new Set<FurnitureKind>(["hob", "sink", "counter", "fridge"]);
/** Küçük, kolayca yeri değişen parçalar (önündeki kullanım alanını kapattığı sayılmaz) */
export const LIGHT = new Set<FurnitureKind>(["plant", "floorLamp", "chair"]);

/**
 * Önündeki kullanım alanı (m): [en az, önerilen, açıklama]. Neufert, NKBA mutfak-banyo kılavuzları ve TS 9111'den sadeleştirildi.
 * Otomatik yerleşim "en az" değerini boş bırakır; iç mekân denetimi ikisine göre uyarır.
 */
export const FRONT_RULE: Partial<Record<FurnitureKind, [number, number, string]>> = {
  wardrobe: [0.7, 0.9, "kapak açılıp önünde durabilmek için"],
  fridge: [0.8, 1.0, "kapağı açmak için"],
  counter: [0.9, 1.1, "tezgâh önünde çalışma ve geçiş için"],
  island: [0.9, 1.1, "ada çevresinde çalışma ve geçiş için"],
  wc: [0.55, 0.7, "klozet önünde"],
  basin: [0.6, 0.75, "lavabo önünde eğilebilmek için"],
  shower: [0.6, 0.75, "duşa giriş için"],
  bathtub: [0.6, 0.75, "küvete giriş için"],
  washer: [0.7, 0.9, "kapağı açıp çamaşır almak için"],
  desk: [0.75, 0.9, "sandalyeyi geri çekebilmek için"],
  dresser: [0.7, 0.9, "çekmeceleri açmak için"],
  bed: [0.6, 0.75, "yatağın ayak ucunda geçiş için"],
};
/** Klozet ekseninden yan duvara / parçaya en az (m) */
export const WC_SIDE = 0.4;

type Face = "same" | "rev" | "left" | "right";
/** Otomatik yerleşim adayı: ilk konum olmazsa sırayla alternatifler denenir */
type Cand = Furniture & { alts?: Furniture[]; optional?: boolean };
/** Kullanımı için mutlaka konması gereken parçalar: kullanım alanı sığmasa da (uyarıyla) yerleştirilir */
const ESSENTIAL = new Set<FurnitureKind>(["bed", "wc", "basin", "counter", "hob", "sink", "fridge", "sofa", "table", "shower", "desk", "car"]);

export function furnishRoom(r: PlacedRoom): Cand[] {
  if (r.band === "hall" || r.type === "merdiven" || r.void) return [];
  const W = r.rect.w, H = r.rect.h;
  // yerel çerçeve: u = x boyunca (0..W), v = arka duvardan hole doğru (0..H)
  const front = r.band === "front"; // ön bantta arka duvar sokak cephesi (y küçük)
  const out: Cand[] = [];
  const mk = (kind: FurnitureKind, u: number, v: number, w: number, d: number, face: Face = "same"): Furniture | null => {
    if (u < 0.05 - 1e-6 || v < 0.05 - 1e-6 || u + w > W - 0.05 + 1e-6 || v + d > H - 0.05 + 1e-6 || w <= 0 || d <= 0) return null;
    const x = r.rect.x + u;
    const y = front ? r.rect.y + v : r.rect.y + H - v - d;
    const back: Furniture["facing"] = front ? "n" : "s", fwd: Furniture["facing"] = front ? "s" : "n";
    const facing = face === "same" ? back : face === "rev" ? fwd : face === "left" ? "w" : "e";
    return { kind, x, y, w, h: d, height: HEIGHTS[kind], facing };
  };
  /** face: same = sırtı arka duvarda; rev = sırtı hol tarafında; left/right = sırtı u=0 / u=W duvarında */
  const put = (kind: FurnitureKind, u: number, v: number, w: number, d: number, face: Face = "same", alts: Furniture[] = []) => {
    const f = mk(kind, u, v, w, d, face);
    if (f) out.push({ ...f, alts });
    else if (alts.length) out.push({ ...alts[0], alts: alts.slice(1) });
  };
  /** Parçanın dört duvar boyunca olası yerleri (sırtı duvarda, lw: duvar boyunca, ld: derinlik) — ıslak hacim gibi sıkışık odalar için */
  const slots = (kind: FurnitureKind, lw: number, ld: number, order: Face[] = ["same", "left", "right", "rev"]) => {
    const res: Furniture[] = [];
    for (const face of order) {
      const along = face === "same" || face === "rev" ? W : H;
      for (let t = 0.05; t + lw <= along - 0.05 + 1e-6; t += 0.05) {
        const f = face === "same" ? mk(kind, t, 0.05, lw, ld, face)
          : face === "rev" ? mk(kind, t, H - 0.05 - ld, lw, ld, face)
          : face === "left" ? mk(kind, 0.05, t, ld, lw, face)
          : mk(kind, W - 0.05 - ld, t, ld, lw, face);
        if (f) res.push(f);
      }
    }
    return res;
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
      // yatak başı arka duvarda, odanın ortasında; çift kişilikte iki yanda 60 cm, yer yoksa tek kişilik yana yaslanır
      const bu = W >= bw + 1.4 ? cu(bw) : double ? cu(bw) : 0.1;
      put("rug", Math.max(0.1, bu - 0.35), 0.9, Math.min(W - 0.2, bw + 0.7), Math.min(1.6, H - 1.0));
      put("bed", bu, 0.1, bw, bl);
      put("nightstand", bu - 0.5, 0.1, 0.45, 0.4);
      if (double) put("nightstand", bu + bw + 0.05, 0.1, 0.45, 0.4);
      // dolap: hol tarafı duvarında değil, yan duvarda; önünde 70 cm kalacak kadar yer varsa
      const wl = Math.min(2.4, H - 1.4);
      const rightFree = W - (bu + bw), leftFree = bu;
      if (rightFree >= 1.35 && wl > 1) put("wardrobe", W - 0.65, 0.1, 0.6, wl, "right");
      else if (leftFree >= 1.35 && wl > 1) put("wardrobe", 0.05, 0.1, 0.6, wl, "left");
      else if (H - (0.1 + bl) >= 1.4 && W > 1.9) put("wardrobe", cu(Math.min(2.4, W - 0.8)), H - 0.65, Math.min(2.4, W - 0.8), 0.6, "rev");
      if (r.type === "cocuk" && H > 3.2) {
        // çalışma köşesi dolabın karşı yanında
        const du = rightFree >= 1.35 ? 0.1 : W - 1.3;
        put("desk", du, H - 1.6, 1.2, 0.6);
        put("chair", du + 0.35, H - 0.95, 0.45, 0.45, "rev");
      } else if (r.type === "ebeveyn" && H > 3.6 && W > 3.2) put("dresser", cu(1.2), H - 0.6, 1.2, 0.5, "rev");
      if (r.type !== "cocuk" && W > 3) put("plant", 0.12, H - 0.65, 0.5, 0.5);
      break;
    }
    case "salon": {
      const sw = Math.min(2.6, W - 1.2);
      if (sw > 1.6) {
        put("rug", cu(Math.min(2.6, W - 0.6)), 1.15, Math.min(2.6, W - 0.6), Math.min(2.0, H - 1.6));
        put("sofa", cu(sw), 0.4, sw, 0.9);
        // orta sehpa kanepeden 40 cm (diz payı), TV kanepeden en az 2,1 m (55" ekran için 2,1–3,5 m)
        put("coffeeTable", cu(1.1), 1.7, 1.1, 0.6);
        put("tvUnit", cu(1.8), Math.min(H - 0.55, Math.max(3.4, 1.3 + 2.1)), 1.8, 0.45, "rev");
        put("floorLamp", cu(sw) - 0.45, 0.4, 0.4, 0.4);
      }
      if (W > 5 && H > 3) put("armchair", 0.3, 1.3, 0.8, 0.8, "left");
      put("plant", W - 0.6, 0.1, 0.5, 0.5);
      // yemek masası, salon büyükse ve yemek odası yoksa
      if (area > 26 && W > 7) {
        put("table", W - 2.2, 0.6, 1.6, 0.9);
        for (const du of [0.25, 0.95]) {
          put("chair", W - 2.2 + du, 0.15, 0.45, 0.4);
          put("chair", W - 2.2 + du, 1.55, 0.45, 0.4, "rev");
        }
      }
      if (W > 4.2 && H > 4) put("shelf", 0.05, H - 1.6, 0.35, 1.2, "left");
      break;
    }
    case "yemek": {
      // sandalye arkasında 30 cm geri çekme payı: masa kenarından duvara 75 cm
      const tw = Math.min(2.0, W - 1.6);
      if (tw > 1) {
        const tv = Math.max(0.9, Math.min(1.0, (H - 0.9) / 2));
        put("table", cu(tw), tv, tw, 0.9);
        for (let i = 0; i < Math.floor(tw / 0.6); i++) {
          put("chair", cu(tw) + 0.1 + i * 0.6, tv - 0.45, 0.45, 0.4);
          put("chair", cu(tw) + 0.1 + i * 0.6, tv + 0.95, 0.45, 0.4, "rev");
        }
      }
      break;
    }
    case "mutfak": {
      // Arka duvar boyunca tezgâh: [buzdolabı] – eviye – hazırlık (60–90 cm) – ocak – 30+ cm uç tezgâh.
      // Çalışma üçgeni eviye–ocak–buzdolabı; ocak buzdolabının yanına gelmez.
      put("counter", 0.05, 0.05, W - 0.1, 0.6);
      const side = H > 2.6 && W >= 3.2;
      if (side) put("counter", 0.05, 0.7, 0.6, Math.min(1.8, H - 1.6), "left");
      // buzdolabı: arka duvarın sağ ucunda; dar mutfakta sol yan duvarda
      const fridgeBack = W >= (side ? 0.95 : 0.35) + 2.3 + 0.75 + 0.05;
      const s0 = fridgeBack ? (side ? 0.95 : 0.4) : 0.8;
      const end = fridgeBack ? W - 0.8 : W - 0.05;
      // eviye – hazırlık – ocak – uç tezgâh (ocak sağda, 30–40 cm uç)
      const hobU = end - 0.35 - 0.6;
      const sinkU = Math.max(s0, Math.min(hobU - 0.9 - 0.8, hobU - 0.6 - 0.8));
      put("sink", sinkU, 0.1, 0.8, 0.45);
      put("hob", Math.max(sinkU + 0.8 + 0.3, hobU), 0.1, 0.6, 0.5);
      if (fridgeBack) put("fridge", W - 0.75, 0.05, 0.7, 0.7);
      else put("fridge", 0.05, 0.75, 0.7, 0.7, "left", slots("fridge", 0.7, 0.7, ["left", "right"]));
      if (area > 13 && W > 3.2 && H > 3.5) put("island", cu(1.8), 1.55, 1.8, 0.9);
      else if (area > 10 && H > 3.2) {
        put("table", cu(1.2), H - 1.7, 1.2, 0.8);
        put("chair", cu(1.2) + 0.15, H - 2.15, 0.45, 0.4);
        put("chair", cu(1.2) + 0.6, H - 2.15, 0.45, 0.4);
      }
      break;
    }
    case "banyo": {
      // duş köşede; klozet ekseni duvardan / duştan 45 cm; lavabo önünde 60 cm; her parça uygun duvara
      const sw = Math.min(0.9, W - 0.1);
      put("shower", 0.05, 0.05, sw, 0.9);
      if (W > 2.2 && H > 2.2 && area > 6.5) put("bathtub", W - 0.8, 1.1, 0.75, 1.7, "right", slots("bathtub", 1.7, 0.75, ["right", "left", "same"]));
      const wcU = Math.min(W - 0.05 - 0.45 - 0.2, 0.05 + sw + 0.25);
      put("wc", wcU, 0.1, 0.4, 0.6, "same", slots("wc", 0.4, 0.6, ["same", "right", "left"]));
      put("basin", wcU + 0.85, 0.05, 0.6, 0.45, "same", slots("basin", 0.6, 0.45, ["same", "right", "left", "rev"]));
      // çamaşır makinesi yalnız yer kalırsa (zorunlu değil); katta çamaşır odası varsa hiç konmaz
      put("washer", W - 0.65, 0.05, 0.6, 0.6, "same", slots("washer", 0.6, 0.6));
      if (out[out.length - 1]?.kind === "washer") out[out.length - 1].optional = true;
      break;
    }
    case "wc": {
      // geniş WC: klozet ve lavabo yan yana; dar WC: klozet arka duvarda, lavabo yan duvarda
      put("wc", W >= 1.5 ? 0.25 : cu(0.4), 0.1, 0.4, 0.6, "same", slots("wc", 0.4, 0.6, ["same", "left", "right"]));
      put("basin", W >= 1.5 ? W - 0.6 : 0.05, W >= 1.5 ? 0.05 : Math.max(0.75, H - 0.95), W >= 1.5 ? 0.5 : 0.35, W >= 1.5 ? 0.35 : 0.5, W >= 1.5 ? "same" : "left",
        slots("basin", 0.5, 0.35, ["same", "left", "right", "rev"]));
      break;
    }
    case "camasir": {
      put("washer", 0.1, 0.1, 0.6, 0.6, "same", slots("washer", 0.6, 0.6));
      if (W > 1.5) put("washer", 0.75, 0.1, 0.6, 0.6, "same", slots("washer", 0.6, 0.6));
      else if (H > 2.1) put("washer", 0.1, 0.75, 0.6, 0.6, "left", slots("washer", 0.6, 0.6, ["left", "right"]));
      break;
    }
    case "calisma":
    case "ofis": {
      put("desk", cu(1.4), 0.3, 1.4, 0.7);
      put("chair", cu(0.5), 1.1, 0.5, 0.5, "rev");
      if (W > 2.6) put("shelf", 0.05, 0.6, 0.35, Math.min(2.0, H - 1.4), "left");
      if (W > 3) put("plant", W - 0.6, 0.1, 0.5, 0.5);
      break;
    }
    case "giyinme": {
      put("wardrobe", 0.05, 0.05, W - 0.1, 0.6);
      if (W > 1.8 && H > 1.6) put("wardrobe", 0.05, 0.7, 0.6, H - 1.5, "left");
      break;
    }
    case "kiler":
    case "depo": {
      put("shelf", 0.05, 0.05, W - 0.1, 0.45);
      if (W > 1.2 && H > 1.4) put("shelf", 0.05, 0.55, 0.45, H - 1.4, "left");
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

/** Mobilyanın önüne doğru (sırtının tersi) birim yön */
function frontVec(f: Furniture): [number, number] {
  return f.facing === "n" ? [0, 1] : f.facing === "s" ? [0, -1] : f.facing === "w" ? [1, 0] : [-1, 0];
}
/** d yönünde, kutunun o kenarına bitişik dep derinliğinde şerit */
function strip(f: Box, [dx, dy]: [number, number], dep: number): Box {
  if (dy > 0) return { x: f.x, y: f.y + f.h, w: f.w, h: dep };
  if (dy < 0) return { x: f.x, y: f.y - dep, w: f.w, h: dep };
  if (dx > 0) return { x: f.x + f.w, y: f.y, w: dep, h: f.h };
  return { x: f.x - dep, y: f.y, w: dep, h: f.h };
}
/** Kullanım alanları: önde FRONT_RULE derinliği, klozette iki yanda eksenden 40 cm, sandalyede arkada 30 cm */
export function useZones(f: Furniture): Box[] {
  const v = frontVec(f);
  const out: Box[] = [];
  const r = FRONT_RULE[f.kind];
  if (r) out.push(strip(f, v, r[0]));
  if (f.kind === "wc") {
    const side: [number, number] = [v[1], v[0]], half = (v[0] ? f.h : f.w) / 2;
    const dep = Math.max(0, WC_SIDE - half);
    out.push(strip(f, side, dep), strip(f, [-side[0], -side[1]], dep));
  }
  if (f.kind === "chair") out.push(strip(f, [-v[0], -v[1]], 0.3));
  // kanepe önünde 30 cm diz payı (orta sehpa daha yakına gelmez)
  if (f.kind === "sofa" || f.kind === "armchair") out.push(strip(f, v, 0.3));
  // çift kişilik yatakta iki yanda 50 cm geçiş (baş ucundaki 55 cm komodinlere kalır)
  if (f.kind === "bed" && Math.min(f.w, f.h) > 1.2) {
    const side: [number, number] = [v[1], v[0]];
    for (const sg of [side, [-side[0], -side[1]] as [number, number]]) {
      const z = strip(f, sg, 0.5);
      if (v[1] > 0) { z.y += 0.55; z.h -= 0.55; } else if (v[1] < 0) z.h -= 0.55;
      else if (v[0] > 0) { z.x += 0.55; z.w -= 0.55; } else z.w -= 0.55;
      out.push(z);
    }
  }
  return out;
}
/** Kullanım alanında durabilecek parçalar (z: alanın sahibi, g: alana giren) */
const zoneAllows = (z: Furniture, g: Furniture) =>
  FLAT.has(g.kind) || LIGHT.has(g.kind) || (ON_COUNTER.has(z.kind) && ON_COUNTER.has(g.kind)) || (z.kind === "desk" && g.kind === "chair");

/** Otomatik yerleşim (elle düzenleme yok sayılır). Her parçanın önündeki kullanım alanı boş bırakılır;
 *  kapı kanadı / geçiş alanına giren parça önce kaydırılır, sonra alternatif duvarlar denenir, olmazsa (zorunlu değilse) atılır. */
export function autoFurnish(fl: FloorLayout): Furniture[] {
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
    const inside = (b: Box, e = 0.04) => b.x >= R.x + e - 1e-6 && b.y >= R.y + e - 1e-6 && b.x + b.w <= R.x + R.w - e + 1e-6 && b.y + b.h <= R.y + R.h - e + 1e-6;
    for (const c of furnishRoom(r)) {
      const { alts = [], optional: opt, ...f0 } = c;
      const flat = FLAT.has(f0.kind);
      const ok = (g: Furniture, zones: boolean) => {
        if (!inside(g)) return false;
        if (flat) return true;
        if (keep.some((k) => overlap(g, k))) return false;
        if (placed.some((p) => !FLAT.has(p.kind) && overlap(g, p) && !(ON_COUNTER.has(g.kind) && ON_COUNTER.has(p.kind)))) return false;
        if (!zones) return true;
        // kendi kullanım alanı odada ve dolu değil; başkasının kullanım alanına girmiyor
        for (const z of useZones(g)) {
          if (!inside(z, 0.02)) return false;
          if (placed.some((p) => !zoneAllows(g, p) && overlap(z, p))) return false;
        }
        for (const p of placed) if (!zoneAllows(p, g) && useZones(p).some((z) => overlap(z, g))) return false;
        return true;
      };
      const tryAll = (zones: boolean): Furniture | null => {
        for (const axis of ["x", "y"] as const)
          for (const d of shifts) {
            const g = { ...f0, [axis]: f0[axis] + d };
            if (ok(g, zones)) return g;
          }
        for (const a of alts) if (ok(a, zones)) return a;
        return null;
      };
      const optional = opt || (f0.kind === "washer" && fl.rooms.some((q) => q.type === "camasir") && r.type !== "camasir");
      const done = tryAll(true) ?? (ESSENTIAL.has(f0.kind) && !optional ? tryAll(false) : null);
      if (done) placed.push(done);
    }
    out.push(...placed);
  }
  return out.map((f, i) => ({ ...f, id: `a${i}` }));
}

/** Kattaki mobilyalar: mimar düzenlediyse onun listesi, değilse otomatik yerleşim. */
export function furnishFloor(fl: FloorLayout): Furniture[] {
  return fl.furniture ?? autoFurnish(fl);
}

/** Oda düzeninin imzası: odalar değişince (yeniden üretim, sürükleme) elle düzenleme geçersiz sayılır. */
export function roomSig(fl: FloorLayout): string {
  return fl.rooms.map((r) => `${r.name}:${r.rect.x.toFixed(2)},${r.rect.y.toFixed(2)},${r.rect.w.toFixed(2)},${r.rect.h.toFixed(2)}`).join("|");
}

/** Düzenleme kaydının anahtarı (çok bloklu projede blok + kat) */
export const furnitureKey = (blockIndex: number | undefined, level: number) => `${blockIndex ?? 0}:${level}`;

/** Yeni parça: verilen merkezde, varsayılan ölçüde */
export function newFurniture(kind: FurnitureKind, cx: number, cy: number): Furniture {
  const c = FURNITURE_CATALOG.find((k) => k.kind === kind) ?? { w: 1, d: 0.6 };
  return { id: `u${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, kind, x: cx - c.w / 2, y: cy - c.d / 2, w: c.w, h: c.d, height: HEIGHTS[kind], facing: "n" };
}

/** Saat yönünde 90° döndürme (merkez sabit) */
export function rotateFurniture(f: Furniture): Furniture {
  const next = { n: "e", e: "s", s: "w", w: "n" } as const;
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
  return { ...f, facing: next[f.facing], w: f.h, h: f.w, x: cx - f.h / 2, y: cy - f.w / 2 };
}

/** Mobilyanın kendi çerçevesindeki genişliği (lw, sırt boyunca) ve derinliği (ld) */
export function localSize(f: Furniture) {
  const side = f.facing === "e" || f.facing === "w";
  return { lw: side ? f.h : f.w, ld: side ? f.w : f.h };
}

// ---------------------------------------------------------------- SEMBOLLER
export type Prim =
  | { t: "rect"; x: number; y: number; w: number; h: number }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number }
  | { t: "circle"; cx: number; cy: number; r: number };

/** Mobilyanın plan sembolü, dünya koordinatlarında basit ilkellerle (SVG ve DXF ortak kullanır). */
export function furnitureSymbol(f: Furniture): Prim[] {
  // a: sırt boyunca 0..w, b: arka kenardan öne 0..h
  const { lw: w, ld: h } = localSize(f);
  const P = (a: number, b: number): [number, number] => {
    switch (f.facing) {
      case "s": return [f.x + a, f.y + f.h - b];
      case "w": return [f.x + b, f.y + a];
      case "e": return [f.x + f.w - b, f.y + a];
      default: return [f.x + a, f.y + b];
    }
  };
  const R = (a: number, b: number, rw: number, d: number): Prim => {
    const [x1, y1] = P(a, b), [x2, y2] = P(a + rw, b + d);
    return { t: "rect", x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  };
  const Ln = (a1: number, b1: number, a2: number, b2: number): Prim => {
    const [x1, y1] = P(a1, b1), [x2, y2] = P(a2, b2);
    return { t: "line", x1, y1, x2, y2 };
  };
  const C = (a: number, b: number, r: number): Prim => {
    const [cx, cy] = P(a, b);
    return { t: "circle", cx, cy, r };
  };
  const out: Prim[] = f.kind === "plant" || f.kind === "floorLamp" ? [] : [R(0, 0, w, h)];
  switch (f.kind) {
    case "bed": {
      const pw = w > 1.2 ? (w - 0.3) / 2 : w - 0.2;
      out.push(R(0.1, 0.08, pw, 0.35));
      if (w > 1.2) out.push(R(0.2 + pw, 0.08, pw, 0.35));
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
    case "rug":
      out.push(R(0.08, 0.08, w - 0.16, h - 0.16));
      break;
    case "plant":
      out.push(C(w / 2, h / 2, Math.min(w, h) / 2), C(w / 2, h / 2, Math.min(w, h) / 4));
      break;
    case "floorLamp":
      out.push(C(w / 2, h / 2, Math.min(w, h) / 2), C(w / 2, h / 2, 0.03));
      break;
    case "dresser":
      out.push(Ln(w / 2, 0, w / 2, h));
      break;
    case "chair":
      out.push(R(0, 0, w, 0.08));
      break;
    default:
      break;
  }
  return out;
}
