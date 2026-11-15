// Üslup paketleri: tek tıkla çatı, malzeme, cephe dili, cephe ayrıntıları ve kütle biçimini birlikte değiştirir.
// Paketler yaygın üslupların genel özelliklerinden derlenmiştir; belirli bir yapının kopyası değildir.
import type { Facade, FacadeDetail, Materials, Program } from "./shared/schema";
import type { MassFeature } from "./geometry/massing";

export interface StylePack {
  id: string;
  name: string;
  hint: string;
  roof: Program["roof"];
  materials: Materials;
  facade: Omit<Facade, "details"> & { details: FacadeDetail[] };
  massing: MassFeature[];
}

export const STYLE_PACKS: StylePack[] = [
  {
    id: "modern", name: "Modern minimal", hint: "Beyaz kutu, konsol, yerden tavana cam, ahşap lamel",
    roof: "duz", materials: { wall: "siva_beyaz", accent: "ahsap", roof: "koyu_metal", glazing: "genis" },
    facade: { wallColor: "#f4f2ee", accentColor: "#8a5a3a", frameColor: "#2e3033", roofColor: "#3a3d40", windowStyle: "boy", accentPlacement: "dikey_serit", balconyRail: "cam", shutters: false, cornice: false, details: ["kutu_cerceve", "gunes_kirici"] },
    massing: ["on_konsol", "ust_kat_teras"],
  },
  {
    id: "avlulu", name: "Çağdaş avlulu", hint: "L kütle, avlu, taş vurgu, pergola",
    roof: "duz", materials: { wall: "siva_krem", accent: "tas", roof: "acik_gri", glazing: "genis" },
    facade: { wallColor: "#ece4d6", accentColor: "#b9a98c", frameColor: "#3a3530", roofColor: "#9a9d9f", windowStyle: "boy", accentPlacement: "zemin", balconyRail: "cam", shutters: false, cornice: false, details: ["pergola", "giris_cercevesi"] },
    massing: ["kose_oyugu", "arka_konsol"],
  },
  {
    id: "akdeniz", name: "Akdeniz / Ege", hint: "Beyaz sıva, kiremit kırma çatı, mavi panjur, pergola",
    roof: "kirma", materials: { wall: "siva_beyaz", accent: "tas", roof: "kiremit", glazing: "orta" },
    facade: { wallColor: "#f6f3ec", accentColor: "#cbbfa8", frameColor: "#3b6ea5", roofColor: "#a85a3c", windowStyle: "kare", accentPlacement: "zemin", balconyRail: "metal", shutters: true, cornice: false, details: ["pergola"] },
    massing: [],
  },
  {
    id: "bodrum", name: "Bodrum evi", hint: "Beyaz küp, düz çatı teras, dolu parapet, mavi doğrama",
    roof: "duz", materials: { wall: "siva_beyaz", accent: "siva_beyaz", roof: "acik_gri", glazing: "az" },
    facade: { wallColor: "#fbfaf6", accentColor: "#fbfaf6", frameColor: "#2f5d8a", roofColor: "#f1efe9", windowStyle: "kare", accentPlacement: "yok", balconyRail: "dolu", shutters: true, cornice: false, details: ["pergola"] },
    massing: ["ust_kat_teras"],
  },
  {
    id: "iskandinav", name: "İskandinav", hint: "Sade beşik çatı, ahşap kaplama, dar uzun pencere",
    roof: "besik", materials: { wall: "siva_beyaz", accent: "ahsap", roof: "koyu_metal", glazing: "orta" },
    facade: { wallColor: "#f1f0ec", accentColor: "#b08a5e", frameColor: "#1f2123", roofColor: "#2f3235", windowStyle: "dikey", accentPlacement: "dikey_serit", balconyRail: "metal", shutters: false, cornice: false, details: [] },
    massing: [],
  },
  {
    id: "tas", name: "Taş ev (çağdaş yerel)", hint: "Taş duvar, ahşap doğrama, kırma çatı, az cam",
    roof: "kirma", materials: { wall: "tas", accent: "ahsap", roof: "kiremit", glazing: "az" },
    facade: { wallColor: "#c9bca3", accentColor: "#8a5a3a", frameColor: "#6e4a2e", roofColor: "#9a4f35", windowStyle: "kare", accentPlacement: "cerceve", balconyRail: "metal", shutters: true, cornice: true, details: ["pergola"] },
    massing: [],
  },
  {
    id: "endustriyel", name: "Endüstriyel", hint: "Brüt beton, tuğla vurgu, siyah doğrama, bant pencere",
    roof: "duz", materials: { wall: "beton", accent: "tugla", roof: "koyu_metal", glazing: "genis" },
    facade: { wallColor: "#b3b1ac", accentColor: "#9c5a41", frameColor: "#1c1d1f", roofColor: "#2f3235", windowStyle: "serit", accentPlacement: "zemin", balconyRail: "metal", shutters: false, cornice: false, details: ["giris_cercevesi"] },
    massing: ["on_konsol", "yan_konsol"],
  },
];

/** Paketi programa uygular (mimarın yerleşim düzenlemeleri kütle değiştiği için sıfırlanır). */
export function applyStylePack(p: Program, pack: StylePack): Program {
  const prev = p.design?.massing ?? p.massing;
  return {
    ...p,
    style: `${pack.name}: ${pack.hint}`,
    roof: pack.roof,
    materials: { ...pack.materials },
    facade: { ...pack.facade, details: [...pack.facade.details] },
    design: {
      variant: p.design?.variant,
      stylePack: pack.id,
      massing: { features: [...pack.massing], cantilever: prev?.cantilever ?? 1.5, terraceDepth: prev?.terraceDepth ?? 2.6, notchDepth: prev?.notchDepth ?? 2.6, rationale: `${pack.name} üslup paketi` },
    },
  };
}
