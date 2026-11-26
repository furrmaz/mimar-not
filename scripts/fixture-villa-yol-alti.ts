// Kullanıcının 3B modelinden (Üç Katlı Müstakil Konut, Yol Kotu Altında Arsa) çıkarılan örnek program.
// 8 m cepheli, 18 m derin bina; arsa yolun 3 m altında; bodrumda spor/sinema, zeminde yaşam, 1. katta yatak odaları.
import type { Program } from "../src/shared/schema";

const room = (name: string, type: string, zone: string, area: number, note = "") => ({ name, type, zone, area, note }) as Program["floors"][number]["rooms"][number];

export const VILLA_PROGRAM: Program = {
  projectName: "Üç Katlı Müstakil Konut, Yol Kotu Altında Arsa",
  clientName: "",
  buildingType: "Müstakil konut",
  summary: "Yolun 3 m altındaki arsada üç katlı müstakil konut, havuzlu bahçe.",
  style: "Modern",
  site: { width: 14.5, depth: 45, orientation: "Ön cephe sokağa bakıyor", slope: 0, lotBelowRoad: 3 },
  zoning: { taks: null, kaks: null, maxFloors: null, hmax: null, frontSetback: 5, sideSetback: 3, rearSetback: null },
  footprint: { width: 8, depth: 18 },
  floorHeight: 3,
  roof: "duz",
  materials: { wall: "siva_beyaz", accent: "ahsap", roof: "acik_gri", glazing: "genis" },
  facade: { wallColor: "#f2f2f0", accentColor: "#8a5a3a", frameColor: "#2e3033", roofColor: "#cfcfcf", windowStyle: "kare", accentPlacement: "dikey_serit", balconyRail: "cam", shutters: false, cornice: false, details: ["pergola", "cati_feneri", "giris_cercevesi", "kutu_cerceve"] },
  floors: [
    { level: -1, name: "Bodrum Kat", rooms: [room("Spor Salonu", "diger", "gunduz", 28), room("Duş / WC", "banyo", "servis", 6), room("Çamaşır Odası", "camasir", "servis", 7), room("Teknik Oda", "teknik", "servis", 7), room("Sinema Odası", "diger", "gunduz", 22), room("Oyun / Hobi Odası", "diger", "gunduz", 22), room("Depo", "depo", "servis", 5), room("Bodrum Hol", "hol", "sirkulasyon", 10)] },
    { level: 0, name: "Zemin Kat (Giriş Katı)", rooms: [room("Antre", "antre", "sirkulasyon", 7), room("Misafir WC", "wc", "servis", 3), room("Kiler", "kiler", "servis", 4), room("Mutfak", "mutfak", "gunduz", 16), room("Yemek Alanı", "yemek", "gunduz", 16), room("Salon", "salon", "gunduz", 28), room("Oturma Odası", "salon", "gunduz", 20), room("Zemin Kat Hol", "hol", "sirkulasyon", 10), room("Zemin Kat Balkonu", "balkon", "dis", 10), room("Havuz", "diger", "dis", 32)] },
    { level: 1, name: "1. Kat", rooms: [room("Çocuk Odası 1", "cocuk", "gece", 16), room("Çocuk Banyosu 1", "banyo", "gece", 5), room("Çocuk Odası 2", "cocuk", "gece", 16), room("Çocuk Banyosu 2", "banyo", "gece", 5), room("Ebeveyn Yatak Odası", "ebeveyn", "gece", 22), room("Ebeveyn Giyinme Odası", "giyinme", "gece", 8), room("Ebeveyn Banyosu", "banyo", "gece", 8), room("Üst Kat Hol", "hol", "sirkulasyon", 10), room("Ebeveyn Balkonu", "balkon", "dis", 6)] },
  ],
  adjacencies: [{ a: "Mutfak", b: "Kiler", relation: "bitisik" }],
  requirements: [],
  assumptions: [],
  openQuestions: [],
};
