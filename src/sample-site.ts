import type { Program, Room } from "./shared/schema";

export const SITE_NOTES = `Ahmet Bey, Demirtaş İnşaat. Bursa Nilüfer'de 60×85 m köşe parsel, ön cephe güneye bakıyor, 15 m'lik yola cephe. İmar: TAKS 0.30, KAKS 1.50, ayrık nizam, Hmax 15.50, 5 kat. Çekme mesafeleri ön 5 m, yan 3 m, arka 3 m.
4 blok istiyor, A-B blokları yola paralel, C-D arkada; bloklar arası en az 10 m olsun, ortada çocuk parkı ve yeşil alan.
Her blok zemin + 4 kat. Zeminde blok girişi, asansör, merdiven, sığınak ve teknik hacim. Normal katlarda kat başına 4 daire: 2 adet 2+1 (90-95 m² net), 2 adet 3+1 (120-125 m² net). En üst katta her blokta 2 adet 4+1 dubleks (çatı katıyla birlikte 180 m² civarı, teraslı).
Daireler: salon balkonlu, mutfak kapalı ama salona geçişli, 3+1'lerde ebeveyn banyosu, 2+1'lerde tek banyo + wc. Satış hedefi orta-üst segment, modern cephe, sıcak tonlu taş kaplama ve geniş camlar.
Kapalı otopark bodrumda, daire başı 1 araç; ayrıca 10 misafir otoparkı açıkta. Bütçe makul olsun, ilk etap A-B blokları.`;

const r = (name: string, type: Room["type"], zone: Room["zone"], area: number, upper = false) => ({ name, type, zone, area, note: "", upper });

export const SITE_PROGRAM: Program = {
  projectName: "Demirtaş Nilüfer Konutları",
  clientName: "Demirtaş İnşaat",
  buildingType: "Çok bloklu konut sitesi",
  summary: "Nilüfer'de 60×85 m parselde dört bloklu konut sitesi. Her blok zemin + 4 kat; normal katlarda 2 adet 2+1 ve 2 adet 3+1, en üst katta iki 4+1 dubleks. Bodrumda kapalı otopark, ortada çocuk parkı.",
  style: "Modern cephe, sıcak tonlu taş kaplama, geniş camlar",
  site: { width: 60, depth: 85, orientation: "Ön cephe güneye, 15 m yola bakıyor" },
  zoning: { taks: 0.3, kaks: 1.5, maxFloors: 5, hmax: 15.5, frontSetback: 5, sideSetback: 3, rearSetback: 3 },
  footprint: { width: 22, depth: 17 },
  floorHeight: 3,
  roof: "duz",
  materials: { wall: "siva_krem", accent: "tas", roof: "acik_gri", glazing: "genis" },
  floors: [],
  adjacencies: [],
  unitTypes: [
    {
      name: "2+1 Tip A", duplex: false,
      rooms: [r("Antre", "antre", "sirkulasyon", 5), r("Salon", "salon", "gunduz", 27), r("Mutfak", "mutfak", "gunduz", 10), r("Hol", "hol", "sirkulasyon", 6), r("Ebeveyn Yatak Odası", "ebeveyn", "gece", 14), r("Yatak Odası", "yatak", "gece", 11), r("Banyo", "banyo", "gece", 5), r("WC", "wc", "servis", 2), r("Balkon", "balkon", "dis", 7)],
    },
    {
      name: "3+1 Tip B", duplex: false,
      rooms: [r("Antre", "antre", "sirkulasyon", 6), r("Salon", "salon", "gunduz", 32), r("Mutfak", "mutfak", "gunduz", 12), r("Hol", "hol", "sirkulasyon", 8), r("Ebeveyn Yatak Odası", "ebeveyn", "gece", 15), r("Ebeveyn Banyosu", "banyo", "gece", 5), r("Yatak Odası 1", "yatak", "gece", 12), r("Yatak Odası 2", "cocuk", "gece", 11), r("Banyo", "banyo", "gece", 5.5), r("Balkon", "balkon", "dis", 9)],
    },
    {
      name: "4+1 Dubleks", duplex: true,
      rooms: [
        r("Antre", "antre", "sirkulasyon", 6), r("Salon", "salon", "gunduz", 38), r("Mutfak", "mutfak", "gunduz", 14), r("Misafir Odası", "misafir", "gece", 12), r("Banyo", "banyo", "servis", 5), r("Hol", "hol", "sirkulasyon", 8), r("Balkon", "balkon", "dis", 10),
        r("Ebeveyn Yatak Odası", "ebeveyn", "gece", 18, true), r("Giyinme", "giyinme", "gece", 6, true), r("Ebeveyn Banyosu", "banyo", "gece", 6, true), r("Yatak Odası 1", "yatak", "gece", 13, true), r("Yatak Odası 2", "cocuk", "gece", 12, true), r("Banyo", "banyo", "gece", 6, true), r("Üst Hol", "hol", "sirkulasyon", 8, true), r("Teras", "teras", "dis", 30, true),
      ],
    },
  ],
  blocks: [
    {
      name: "A Blok", sameAs: "", footprint: { width: 22, depth: 17 },
      floors: [
        { level: -1, name: "Bodrum Kat", units: [], rooms: [r("Kapalı Otopark", "garaj", "servis", 380), r("Sığınak", "depo", "servis", 40), r("Depolar", "depo", "servis", 30)] },
        { level: 0, name: "Zemin Kat", units: ["2+1 Tip A", "2+1 Tip A"], rooms: [r("Giriş Holü", "hol", "sirkulasyon", 30), r("Teknik Hacim", "teknik", "servis", 14), r("Kapıcı / Yönetim", "ofis", "gunduz", 16)] },
        { level: 1, name: "1. Kat", units: ["2+1 Tip A", "3+1 Tip B", "2+1 Tip A", "3+1 Tip B"], rooms: [] },
        { level: 2, name: "2. Kat", units: ["2+1 Tip A", "3+1 Tip B", "2+1 Tip A", "3+1 Tip B"], rooms: [] },
        { level: 3, name: "3. Kat", units: ["2+1 Tip A", "3+1 Tip B", "2+1 Tip A", "3+1 Tip B"], rooms: [] },
        { level: 4, name: "4. Kat", units: ["4+1 Dubleks", "4+1 Dubleks"], rooms: [] },
      ],
    },
    { name: "B Blok", sameAs: "A Blok", footprint: { width: 22, depth: 17 }, floors: [] },
    { name: "C Blok", sameAs: "A Blok", footprint: { width: 22, depth: 17 }, floors: [] },
    { name: "D Blok", sameAs: "A Blok", footprint: { width: 22, depth: 17 }, floors: [] },
  ],
  blockSpacing: 10,
  assumptions: ["Zemin katta iki adet 2+1 daire varsayıldı.", "Dubleks üst katı (çatı katı) 5. kat olarak çizildi."],
  openQuestions: ["Hmax 15.50 m dubleks çatı katıyla aşılıyor; çatı katı imar planında serbest mi?"],
};
