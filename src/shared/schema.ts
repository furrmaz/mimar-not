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

export const RoomSchema = z.object({
  name: z.string().describe("Odanın Türkçe adı, ör. 'Ebeveyn Yatak Odası'"),
  type: RoomType,
  zone: Zone.describe(
    "gunduz: salon/mutfak/yemek/çalışma; gece: yatak odaları ve onlara ait banyolar; servis: wc, depo, kiler, çamaşır, teknik, garaj; sirkulasyon: hol/koridor/antre; dis: balkon/teras",
  ),
  area: z.number().describe("Net alan, metrekare"),
  note: z.string().describe("Müşterinin bu odayla ilgili isteği; yoksa boş metin"),
});
export type Room = z.infer<typeof RoomSchema>;

export const FloorSchema = z.object({
  level: z.number().describe("0 = zemin kat, 1 = birinci kat, -1 = bodrum"),
  name: z.string().describe("ör. 'Zemin Kat'"),
  rooms: z.array(RoomSchema),
});
export type Floor = z.infer<typeof FloorSchema>;

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
export type Program = z.infer<typeof ProgramSchema> & { design?: DesignOptions };
export type Adjacency = z.infer<typeof ProgramSchema>["adjacencies"][number];
