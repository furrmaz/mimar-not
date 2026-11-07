import { z } from "zod";

// Claude'un mimarın notlarından çıkardığı "bina programı".
// Çizimler (plan, kesit, cephe, 3D) bu veriden deterministik olarak üretilir.

export const RoomType = z.enum([
  "salon",
  "mutfak",
  "yemek",
  "yatak",
  "ebeveyn",
  "cocuk",
  "banyo",
  "wc",
  "hol",
  "antre",
  "koridor",
  "calisma",
  "misafir",
  "depo",
  "kiler",
  "camasir",
  "giyinme",
  "garaj",
  "teknik",
  "ofis",
  "magaza",
  "balkon",
  "teras",
  "diger",
]);
export type RoomType = z.infer<typeof RoomType>;

export const Zone = z.enum(["gunduz", "gece", "servis", "sirkulasyon", "dis"]);
export type Zone = z.infer<typeof Zone>;

export const Material = z.enum(["siva_beyaz", "siva_krem", "siva_gri", "tas", "tugla", "ahsap", "beton"]);
export type Material = z.infer<typeof Material>;

export const RoomSchema = z.object({
  name: z.string().describe("Odanın Türkçe adı, ör. 'Ebeveyn Yatak Odası'"),
  type: RoomType,
  zone: Zone.describe(
    "gunduz: salon/mutfak/yemek/çalışma; gece: yatak odaları ve onlara ait banyolar; servis: wc, depo, kiler, çamaşır, teknik, garaj; sirkulasyon: hol/koridor/antre; dis: balkon/teras",
  ),
  area: z.number().describe("Net alan, metrekare"),
  note: z.string().describe("Müşterinin bu odayla ilgili isteği; yoksa boş metin"),
});
export type Room = z.infer<typeof RoomSchema> & { /** Apartmanda odanın ait olduğu daire (uygulama doldurur) */ unit?: string };

export const FloorSchema = z.object({
  level: z.number().describe("0 = zemin kat, 1 = birinci kat, -1 = bodrum"),
  name: z.string().describe("ör. 'Zemin Kat'"),
  rooms: z.array(RoomSchema),
});
export type Floor = Omit<z.infer<typeof FloorSchema>, "rooms"> & { rooms: Room[] };

export const UnitTypeSchema = z.object({
  name: z.string().describe("Daire tipinin adı, ör. '2+1 Tip A' ya da '4+1 Dubleks'"),
  duplex: z.boolean().describe("İki katlı (dubleks) daire ise true"),
  rooms: z
    .array(RoomSchema.extend({ upper: z.boolean().describe("Yalnız dubleks dairede, üst kattaki oda ise true; aksi halde false") }))
    .describe("Dairenin odaları: antre/hol, salon, mutfak, yatak odaları, banyo, wc, balkon. Kat holü, merdiven ve asansörü yazma"),
});
export type UnitType = z.infer<typeof UnitTypeSchema>;

export const BlockSchema = z.object({
  name: z.string().describe("Blok adı, ör. 'A Blok'"),
  sameAs: z.string().describe("Bu blok daha önce listelenen bir blokla birebir aynıysa onun adı (o zaman floors boş liste); değilse boş metin"),
  footprint: z.object({
    width: z.number().describe("Blok oturum genişliği, sokak cephesi boyunca (m)"),
    depth: z.number().describe("Blok oturum derinliği (m)"),
  }),
  floors: z.array(
    z.object({
      level: z.number().describe("-1 bodrum, 0 zemin, 1, 2..."),
      name: z.string().describe("ör. 'Normal Kat (1-3)' değil, her kat ayrı: '1. Kat'"),
      units: z.array(z.string()).describe("Bu kattaki her daire için daire tipinin adı (unitTypes.name), daire sayısı kadar; ör. ['2+1 Tip A','2+1 Tip A','3+1 Tip B','3+1 Tip B']. Dubleksin üst katı için ayrıca kat yazma"),
      rooms: z.array(RoomSchema).describe("Kattaki ortak/ticari mekânlar: giriş holü, dükkan, sığınak, kapalı otopark, teknik oda, depolar. Daire odalarını, kat holünü, merdiveni ve asansörü yazma; yoksa boş liste"),
    }),
  ),
});
export type Block = z.infer<typeof BlockSchema>;

export const ProgramSchema = z.object({
  projectName: z.string(),
  clientName: z.string().describe("Müşteri adı; notlarda yoksa boş metin"),
  buildingType: z.string().describe("ör. 'Müstakil konut', 'Dubleks villa', 'Ofis'"),
  summary: z.string().describe("Müşteri isteklerinin 2-4 cümlelik Türkçe özeti"),
  style: z.string().describe("Mimari üslup / malzeme tercihi; yoksa 'Belirtilmedi'"),
  site: z.object({
    width: z.number().describe("Arsa cephe genişliği (m)"),
    depth: z.number().describe("Arsa derinliği (m)"),
    orientation: z.string().describe("Cephe yönü / manzara, ör. 'Güney cephe bahçeye bakıyor'"),
  }),
  zoning: z.object({
    taks: z.number().nullable().describe("İmar durumundaki TAKS (taban alanı katsayısı); notlarda yoksa null"),
    kaks: z.number().nullable().describe("KAKS / emsal; notlarda yoksa null"),
    maxFloors: z.number().nullable().describe("İzin verilen azami kat adedi; yoksa null"),
    hmax: z.number().nullable().describe("Azami bina yüksekliği (m); yoksa null"),
    frontSetback: z.number().nullable().describe("Ön bahçe çekme mesafesi (m); yoksa null"),
    sideSetback: z.number().nullable().describe("Yan bahçe çekme mesafesi (m); yoksa null"),
    rearSetback: z.number().nullable().describe("Arka bahçe çekme mesafesi (m); yoksa null"),
  }),
  footprint: z.object({
    width: z.number().describe("Bina oturum genişliği, sokak cephesi boyunca (m)"),
    depth: z.number().describe("Bina oturum derinliği (m)"),
  }),
  floorHeight: z.number().describe("Döşemeden döşemeye kat yüksekliği (m), tipik 3.0"),
  roof: z.enum(["duz", "besik", "kirma"]).describe("duz: düz çatı/teras, besik: beşik çatı, kırma: kırma çatı"),
  materials: z
    .object({
      wall: Material.describe("Ana cephe malzemesi"),
      accent: Material.describe("İkinci cephe malzemesi: zemin kat, vurgu duvarı ya da baca"),
      roof: z.enum(["kiremit", "koyu_metal", "acik_gri"]).describe("Çatı örtüsü (düz çatıda parapet/teras rengi)"),
      glazing: z.enum(["az", "orta", "genis"]).describe("Cephede cam oranı: modern/minimal üslupta genis, geleneksel taş evde az"),
    })
    .describe("Üsluptan (ve varsa referans görsellerden) çıkarılan cephe malzemeleri; 3D ve cephe çizimleri bunu kullanır"),
  floors: z.array(FloorSchema),
  adjacencies: z
    .array(
      z.object({
        a: z.string().describe("Birinci odanın adı (floors içindeki name ile birebir aynı)"),
        b: z.string().describe("İkinci odanın adı (aynı katta)"),
        relation: z.enum(["bitisik", "uzak"]).describe("bitisik: duvar komşusu olsun; uzak: yan yana gelmesin"),
        reason: z.string().describe("Kısa gerekçe, ör. 'Mutfaktan kilere doğrudan geçiş'"),
      }),
    )
    .describe("Notlardan çıkan ya da işlev gereği önemli oda komşulukları (aynı kattaki odalar arasında)"),
  unitTypes: z.array(UnitTypeSchema).describe("Apartman, site ya da çok bloklu projede daire tipleri. Müstakil konut/villa/ofiste boş liste"),
  blocks: z
    .array(BlockSchema)
    .describe("Apartman ya da çok bloklu projede bloklar (tek apartman da bir bloktur). Müstakil konutta boş liste. Bloklar varsa üstteki floors boş liste olur, footprint ilk bloğun oturumudur"),
  blockSpacing: z.number().nullable().describe("Bloklar arası istenen asgari mesafe (m); notlarda yoksa null"),
  assumptions: z.array(z.string()).describe("Notlarda olmayan, senin yaptığın varsayımlar"),
  openQuestions: z.array(z.string()).describe("Mimarın müşteriye sorması gereken netleşmemiş konular"),
});
/** Mimarın uygulamada yaptığı yerleşim tercihleri (Claude üretmez, proje dosyasında saklanır). */
export interface DesignOptions {
  /** 0: gündüz sokak tarafında, 1: gündüz bahçe tarafında, 2: oda sırası ters */
  variant?: number;
  /** Ön bant derinliği (m), sürükleyerek ayarlanır */
  frontDepth?: number;
  /** "<kat>-<bant>" → sütun sınırlarının x koordinatları */
  cols?: Record<string, number[]>;
}
export type Program = Omit<z.infer<typeof ProgramSchema>, "floors" | "unitTypes" | "blocks" | "blockSpacing"> & {
  blockSpacing?: number | null;
  floors: Floor[];
  /** Eski proje dosyalarında yoktur */
  unitTypes?: UnitType[];
  blocks?: Block[];
  design?: DesignOptions;
  /** Çok bloklu projede bu görünümün ait olduğu blok (uygulama doldurur) */
  blockIndex?: number;
};
export type Materials = z.infer<typeof ProgramSchema>["materials"];
export const DEFAULT_MATERIALS: Materials = { wall: "siva_krem", accent: "tas", roof: "kiremit", glazing: "orta" };
export type Adjacency = z.infer<typeof ProgramSchema>["adjacencies"][number];

// ---------------------------------------------------------------- API ŞEMASI
// Yapılandırılmış çıktı grameri büyük enum'larla (oda tipi × 3 oda listesi) API sınırını aşıyor.
// Claude'a giden şemada oda tipi ve bölgesi serbest metindir; yanıt normalizeProgram ile doğrulanır.
const ROOM_TYPE_TEXT = `Oda tipi; yalnız şunlardan biri: ${RoomType.options.join(", ")}`;
const ZONE_TEXT = "Bölge; yalnız şunlardan biri: gunduz (salon/mutfak/yemek/çalışma), gece (yatak odaları ve banyoları), servis (wc, depo, kiler, çamaşır, teknik, garaj), sirkulasyon (hol/koridor/antre), dis (balkon/teras)";
const RoomWire = RoomSchema.extend({ type: z.string().describe(ROOM_TYPE_TEXT), zone: z.string().describe(ZONE_TEXT) });
const blockFloor = BlockSchema.shape.floors.element;
export const ProgramWireSchema = ProgramSchema.extend({
  floors: z.array(FloorSchema.extend({ rooms: z.array(RoomWire) })),
  unitTypes: z.array(UnitTypeSchema.extend({ rooms: z.array(RoomWire.extend({ upper: z.boolean().describe("Dubleks dairede üst kattaki oda ise true; aksi halde false") })) })).describe(ProgramSchema.shape.unitTypes.description ?? ""),
  blocks: z.array(BlockSchema.extend({ floors: z.array(blockFloor.extend({ rooms: z.array(RoomWire).describe(blockFloor.shape.rooms.description ?? "") })) })).describe(ProgramSchema.shape.blocks.description ?? ""),
});
export type ProgramWire = z.infer<typeof ProgramWireSchema>;

const TYPE_ZONE: Partial<Record<RoomType, Zone>> = {
  salon: "gunduz", mutfak: "gunduz", yemek: "gunduz", calisma: "gunduz", ofis: "gunduz", magaza: "gunduz",
  yatak: "gece", ebeveyn: "gece", cocuk: "gece", misafir: "gece", banyo: "gece", giyinme: "gece",
  wc: "servis", depo: "servis", kiler: "servis", camasir: "servis", garaj: "servis", teknik: "servis", diger: "servis",
  hol: "sirkulasyon", antre: "sirkulasyon", koridor: "sirkulasyon", balkon: "dis", teras: "dis",
};
function fixRoom<T extends { name: string; type: string; zone: string }>(r: T): T & { type: RoomType; zone: Zone } {
  const t = String(r.type ?? "").toLocaleLowerCase("tr").replace(/ı/g, "i").replace(/ç/g, "c").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o").trim();
  const type = (RoomType.options as string[]).includes(t) ? (t as RoomType) : "diger";
  const zone = (Zone.options as string[]).includes(String(r.zone)) ? (r.zone as Zone) : TYPE_ZONE[type] ?? "servis";
  return { ...r, type, zone };
}
/** Claude'un serbest metin oda tiplerini şemadaki değerlere çevirir. */
export function normalizeProgram(w: ProgramWire): Program {
  return {
    ...w,
    floors: w.floors.map((f) => ({ ...f, rooms: f.rooms.map(fixRoom) })),
    unitTypes: w.unitTypes.map((u) => ({ ...u, rooms: u.rooms.map(fixRoom) })),
    blocks: w.blocks.map((b) => ({ ...b, floors: b.floors.map((f) => ({ ...f, rooms: f.rooms.map(fixRoom) })) })),
  };
}
