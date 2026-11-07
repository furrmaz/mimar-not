import type { Program } from "./shared/schema";

export const SAMPLE_NOTES = `Ayşe - Murat Yılmaz, 2 çocuk (8 ve 12 yaş). Urla'da 22x30 arsa, güney bahçe tarafı. İmar: TAKS 0.25, KAKS 0.50, 2 kat, hmax 6.50.
2 katlı müstakil ev istiyorlar, toplam 180-200 m2 civarı.
Zemin: geniş salon, şömine olsun. Açık mutfak ama ada tezgah, mutfağın yanında kiler. Misafir wc. Murat evden çalışıyor -> küçük çalışma odası zeminde olsun, sessiz.
Üst kat: ebeveyn yatak + giyinme + banyo (küvet istemiyor, duşakabin). 2 çocuk odası, ortak banyo. Bahçeye bakan balkon.
Çamaşır odası ayrı olsun, mümkünse üst katta.
Modern ama sıcak, ahşap + taş. Beşik çatı olabilir.
Otopark: 2 araç, kapalı olması şart değil.
Bütçe orta.`;

export const SAMPLE_PROGRAM: Program = {
  projectName: "Yılmaz Konutu",
  clientName: "Ayşe - Murat Yılmaz",
  buildingType: "Dubleks müstakil konut",
  summary:
    "Dört kişilik aile için Urla'da iki katlı müstakil konut. Zeminde şömineli geniş salon, ada tezgahlı açık mutfak, kiler, misafir wc ve sessiz bir çalışma odası; üst katta giyinme ve banyolu ebeveyn odası, iki çocuk odası, ortak banyo, çamaşır odası ve bahçeye bakan balkon.",
  style: "Modern ama sıcak; ahşap ve taş",
  site: { width: 22, depth: 30, orientation: "Bahçe cephesi güneye bakıyor" },
  zoning: { taks: 0.25, kaks: 0.5, maxFloors: 2, hmax: 6.5, frontSetback: 5, sideSetback: 3, rearSetback: 3 },
  footprint: { width: 12, depth: 9 },
  floorHeight: 3,
  roof: "besik",
  floors: [
    {
      level: 0,
      name: "Zemin Kat",
      rooms: [
        { name: "Salon", type: "salon", zone: "gunduz", area: 34, note: "Şömine" },
        { name: "Açık Mutfak", type: "mutfak", zone: "gunduz", area: 16, note: "Ada tezgah" },
        { name: "Kiler", type: "kiler", zone: "servis", area: 3, note: "" },
        { name: "Çalışma Odası", type: "calisma", zone: "gunduz", area: 10, note: "Sessiz olmalı" },
        { name: "Misafir WC", type: "wc", zone: "servis", area: 2.5, note: "" },
        { name: "Antre", type: "antre", zone: "sirkulasyon", area: 6, note: "" },
        { name: "Hol", type: "hol", zone: "sirkulasyon", area: 12, note: "" },
        { name: "Depo", type: "depo", zone: "servis", area: 4, note: "" },
      ],
    },
    {
      level: 1,
      name: "1. Kat",
      rooms: [
        { name: "Ebeveyn Yatak Odası", type: "ebeveyn", zone: "gece", area: 16, note: "" },
        { name: "Giyinme", type: "giyinme", zone: "gece", area: 5, note: "" },
        { name: "Ebeveyn Banyosu", type: "banyo", zone: "gece", area: 5, note: "Duşakabin, küvet yok" },
        { name: "Çocuk Odası 1", type: "cocuk", zone: "gece", area: 12, note: "" },
        { name: "Çocuk Odası 2", type: "cocuk", zone: "gece", area: 12, note: "" },
        { name: "Ortak Banyo", type: "banyo", zone: "gece", area: 5.5, note: "" },
        { name: "Çamaşır Odası", type: "camasir", zone: "servis", area: 4, note: "" },
        { name: "Kat Holü", type: "hol", zone: "sirkulasyon", area: 10, note: "" },
        { name: "Balkon", type: "balkon", zone: "dis", area: 8, note: "Bahçeye bakıyor" },
      ],
    },
  ],
  assumptions: [
    "Toplam kapalı alan yaklaşık 190 m² olarak alındı (kat başına ~95 m²).",
    "Zemin katta kiler ve depo eklendi.",
    "Kat yüksekliği 3.00 m kabul edildi.",
    "Otopark bina dışında, açık olarak düşünüldü.",
  ],
  openQuestions: [
    "Arsanın sokak cephesi hangi yönde? Giriş hangi taraftan olacak?",
    "Çalışma odasına ayrı bir dış giriş gerekli mi?",
    "Şömine odun mu, gaz mı, biyoetanol mu?",
    "Yaşlı ya da engelli bir aile bireyi için zemin katta yatak odası gerekir mi?",
  ],
};
