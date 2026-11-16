// Yol kotunun altındaki arsa + bodrum katı regresyon testi: npm run test:site
// Kaynak: mimarın notu (3 katlı müstakil konut, -1 kat yolun altında, 500 m² arsanın tamamı yolun 5 m altında).
// Claude çağrılamadığı için (anahtar yok) iki şeyi denetler:
//  1) Claude'a giden şema ve talimat bu isteği ifade edebiliyor (site.lotBelowRoad, bodrum -1 kuralı, düzeltme talimatı)
//  2) Notun doğru programı plan, kesit, cephe, 3D, DXF ve render talimatında arsayı yolun altında, bodrumu açıkta gösteriyor
import * as THREE from "three";
import { z } from "zod";
import { buildLayout, siteLevels } from "../src/geometry/layout";
import { buildModel } from "../src/geometry/model3d";
import { elevationSVG, sectionSVG } from "../src/geometry/svg";
import { buildDXF } from "../src/geometry/dxf";
import { zoningCheck } from "../src/geometry/zoning";
import { openingOnFacade } from "../src/geometry/massing";
import { ProgramWireSchema, lotBelowRoad, type Program } from "../src/shared/schema";
import { SYSTEM_PROMPT } from "../src/shared/prompt";
import { buildUserContent } from "../src/shared/generate";
import { renderPrompt } from "../src/shared/render";

let failures = 0;
const ok = (cond: unknown, msg: string) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { failures++; console.log(`  ✗ ${msg}`); }
};

export const SUNKEN_NOTES = `3 katlı bir kat kot seviyesinin altında olacak yani -1 kat diğer katlar 0 ve 1 yol seviyesinden başlayacak. 500 metrekare arsa içinde oalcak. binanın tabanı 135 mtre kare oalcak boyu 8 metre ön cephe olacak , 16 metre eni oalak. alt katta sinema odası, spor salonu vb olacak. en üst katta yataklk odası oalcak 1 adet ebeveyn 2 adet çocuk odası. ebeveyn odasında giyinme odası ve banyosu olacak. aynı şekilde çocuk odalrında da banyo olacak. orta katta yani giriş katında ise oturma odası salon mutfak vb oalcak. -1 kat olan kısmın önü açık olacak 500 mtere kare arsanı tamamı  yolun altında kalacak ve burasının içi boş olacak`;

const room = (name: string, type: string, zone: string, area: number, note = "") => ({ name, type, zone, area, note }) as Program["floors"][number]["rooms"][number];

/** Notun beklenen programı (Claude'un üretmesi gereken). */
export const SUNKEN_PROGRAM: Program = {
  projectName: "Üç Katlı Müstakil Konut (Bodrumlu)",
  clientName: "",
  buildingType: "Müstakil konut",
  summary: "Yolun 5 m altındaki 500 m² arsada, biri yol kotunun altında üç katlı müstakil konut.",
  style: "Modern",
  site: { width: 20, depth: 25, orientation: "Ön cephe sokağa bakıyor", slope: 0, lotBelowRoad: 5 },
  zoning: { taks: null, kaks: null, maxFloors: null, hmax: null, frontSetback: null, sideSetback: null, rearSetback: null },
  footprint: { width: 8, depth: 16 },
  floorHeight: 3,
  roof: "besik",
  materials: { wall: "siva_beyaz", accent: "ahsap", roof: "kiremit", glazing: "genis" },
  floors: [
    { level: -1, name: "Bodrum Kat", rooms: [room("Sinema Odası", "diger", "gunduz", 30), room("Spor Salonu", "diger", "gunduz", 30), room("WC", "wc", "servis", 3), room("Teknik Hacim", "teknik", "servis", 6), room("Bodrum Holü", "hol", "sirkulasyon", 10)] },
    { level: 0, name: "Zemin Kat", rooms: [room("Antre", "antre", "sirkulasyon", 5), room("Salon", "salon", "gunduz", 36), room("Oturma Odası", "salon", "gunduz", 18), room("Mutfak", "mutfak", "gunduz", 14), room("Misafir WC", "wc", "servis", 2.5), room("Hol", "hol", "sirkulasyon", 9)] },
    { level: 1, name: "1. Kat", rooms: [room("Ebeveyn Yatak Odası", "ebeveyn", "gece", 16), room("Giyinme", "giyinme", "gece", 5), room("Ebeveyn Banyosu", "banyo", "gece", 6), room("Çocuk Odası 1", "cocuk", "gece", 12), room("Çocuk 1 Banyosu", "banyo", "gece", 4.5), room("Çocuk Odası 2", "cocuk", "gece", 12), room("Çocuk 2 Banyosu", "banyo", "gece", 4.5), room("Kat Holü", "hol", "sirkulasyon", 9)] },
  ],
  adjacencies: [],
  requirements: [],
  assumptions: [],
  openQuestions: [],
};

console.log("Şema ve talimat");
const wire = z.toJSONSchema(ProgramWireSchema) as { properties: { site: { properties: Record<string, unknown> } } };
ok("lotBelowRoad" in wire.properties.site.properties, "Claude'a giden şemada site.lotBelowRoad var");
ok(/lotBelowRoad/.test(SYSTEM_PROMPT) && /level -1/.test(SYSTEM_PROMPT), "Sistem talimatı yol altındaki arsayı ve -1 bodrumu tarif ediyor");
const rev = buildUserContent({ previous: SUNKEN_PROGRAM, revision: "binanın olduğu 500 m² arsanın içi boş, yol seviyesinden 5 metre aşağıda" });
const revText = rev.map((b) => ("text" in b ? b.text : "")).join("");
ok(/site\.lotBelowRoad/.test(revText), "Düzeltme talimatı arsa isteğini şemadaki alana yönlendiriyor");
ok(lotBelowRoad({ site: { lotBelowRoad: 40 } }) === 15 && lotBelowRoad({ site: {} }) === 0 && lotBelowRoad({ site: { lotBelowRoad: 5 }, design: { lotBelowRoad: 2 } }) === 2, "lotBelowRoad sınırları ve mimar ayarı önceliği");

console.log("Yerleşim ve kotlar");
const L = buildLayout(SUNKEN_PROGRAM);
ok(L.floors.map((f) => f.level).join(",") === "-1,0,1", "Üç kat: -1, 0, 1");
ok(L.lotBelowRoad === 5, "Arsa yolun 5 m altında");
const lv = siteLevels(L);
ok(lv.sunken && Math.abs(lv.road + 0.3) < 1e-6 && Math.abs(lv.lot + 5.3) < 1e-6, "Yol −0.30, arsa −5.30");
ok(Math.abs(lv.grade - (L.floors[0].z - 0.3)) < 1e-6, "Bina bodrum kotunda terasa oturuyor (bodrum toprağa gömülü değil)");
const base = L.floors[0];
ok(base.openings.some((o) => o.kind === "window" && openingOnFacade(L, base, o, "front")), "Bodrumun ön cephesinde pencere var (önü açık)");

console.log("Kesit, cephe, DXF");
const sec = sectionSVG(L, SUNKEN_PROGRAM);
ok(sec.includes("istinat duvarı") && sec.includes("köprü") && sec.includes("yolun 5.00 m altında"), "Kesitte yol, istinat duvarı, köprü ve arsa kotu");
const front = elevationSVG(L, SUNKEN_PROGRAM, "front");
const flat = { ...SUNKEN_PROGRAM, site: { ...SUNKEN_PROGRAM.site, lotBelowRoad: 0 } };
const Lflat = buildLayout(flat);
const frontFlat = elevationSVG(Lflat, flat, "front");
const glass = (s: string) => (s.match(/fill="#bcd3e6"/g) ?? []).length;
ok(glass(front) > glass(frontFlat), `Ön cephede bodrum pencereleri görünüyor (${glass(front)} > ${glass(frontFlat)})`);
ok(front.includes("yol kotu"), "Cephede yol kotu çizgisi");
const dxf = new TextDecoder("latin1").decode(buildDXF(L, SUNKEN_PROGRAM));
ok(dxf.includes("ISTINAT DUVARI"), "DXF kesitinde istinat duvarı");

console.log("3D model");
const z0 = zoningCheck(SUNKEN_PROGRAM, L);
const site = { width: SUNKEN_PROGRAM.site.width, depth: SUNKEN_PROGRAM.site.depth, offsetX: z0.building.x, offsetY: z0.building.y };
const model = buildModel(L, { showRoof: true, maxLevel: null, cutaway: false, realistic: false }, site);
const names = new Set<string>();
model.traverse((o) => names.add(o.name));
ok(names.has("İstinat duvarı") && names.has("Köprü") && names.has("Dolgu terası"), "İstinat duvarı, köprü ve dolgu terası modelde");
ok(names.has("Bodrum Kat"), "Bodrum katı modelde");
const arsa = model.getObjectByName("Arsa") as THREE.Mesh;
ok(arsa && Math.abs(arsa.position.y - lv.lot) < 1e-6, "Arsa zemini yolun altında");
const bodrum = new THREE.Box3().setFromObject(model.getObjectByName("Bodrum Kat")!);
ok(bodrum.min.y >= lv.grade - 0.25, "Bodrum katı zeminin üstünde (görünür)");
const flatModel = buildModel(Lflat, { showRoof: true, maxLevel: null, cutaway: false, realistic: false }, site);
ok(!flatModel.getObjectByName("İstinat duvarı") && Math.abs((flatModel.getObjectByName("Arsa") as THREE.Mesh).position.y + 0.3) < 1e-6, "Düz arsada eski davranış değişmedi");

console.log("Render talimatı");
ok(/below the street/.test(renderPrompt(SUNKEN_PROGRAM)) && /3 storeys/.test(renderPrompt(SUNKEN_PROGRAM)), "Render talimatı 3 kat ve yol altındaki arsayı söylüyor");
ok(!/below the street/.test(renderPrompt(flat)), "Düz arsada render talimatı değişmedi");

console.log(failures ? `\n${failures} hata` : "\nTümü geçti");
process.exit(failures ? 1 : 0);
