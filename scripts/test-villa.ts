// Mimari denetim regresyon testi: npm run test:villa
// Kaynak: kullanıcının "Üç Katlı Müstakil Konut, Yol Kotu Altında Arsa" 3B modelinde bulunan hatalar (2026-11-26):
// bahçeye çıkış yok, zemin kat balkonu/verandası havada ve korkuluksuz, arsa dört yanı istinat duvarlı çukur,
// şerit odalar (0.6–0.9 m WC/kiler/depo, 1.2 × 8 m banyolar), 8.5 m merdiven odası, mutfak–yemek arası kapalı,
// 1.00–1.06 m korkuluklar, pencere alanı < 1/8, çatı feneri kapalı döşeme üstünde, havuz suyu deck üstünde, otopark yok.
import * as THREE from "three";
import { buildLayout, siteLevels } from "../src/geometry/layout";
import { buildModel, RAIL_H } from "../src/geometry/model3d";
import { stairCalc } from "../src/geometry/stair";
import { zoningCheck, sitePool } from "../src/geometry/zoning";
import { SAMPLE_PROGRAM } from "../src/sample";
import { VILLA_PROGRAM } from "./fixture-villa-yol-alti";

let failures = 0;
const ok = (cond: unknown, msg: string) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { failures++; console.log(`  ✗ ${msg}`); }
};

const L = buildLayout(VILLA_PROGRAM);
const lv = siteLevels(L);

console.log("Plan");
const SMALL = ["wc", "banyo", "kiler", "depo", "camasir", "teknik", "giyinme"];
const narrow = L.floors.flatMap((f) => f.rooms.filter((r) => SMALL.includes(r.type) && Math.min(r.rect.w, r.rect.h) < 1.2).map((r) => `${f.name}/${r.name} ${r.rect.w}×${r.rect.h}`));
ok(!narrow.length, `Küçük hacimler en az 1.20 m genişlikte ${narrow.join(", ")}`);
const strips = L.floors.flatMap((f) => f.rooms.filter((r) => SMALL.includes(r.type) && Math.max(r.rect.w, r.rect.h) / Math.min(r.rect.w, r.rect.h) > 3.2).map((r) => `${f.name}/${r.name}`));
ok(!strips.length, `Islak / servis hacimleri şerit değil (en/boy ≤ 1:3.2) ${strips.join(", ")}`);
const sc = stairCalc(L.H);
ok(L.stair && L.stair.h <= sc.len + 0.01, `Merdiven yalnız kollar + sahanlık kadar (${L.stair?.h} m ≤ ${sc.len} m)`);
ok(L.stairInfo && L.stairInfo.landing <= 1.3, `Sahanlık derinliği makul (${L.stairInfo?.landing} m)`);
const base = L.floors[0];
ok(base.openings.some((o) => o.exterior && o.kind === "balconyDoor" && Math.abs(o.line - L.D) < 0.01), "Bodrumdan bahçeye kapı var (bahçe ve havuz evden ulaşılabilir)");
const living = ["salon", "yatak", "cocuk", "ebeveyn", "calisma", "mutfak", "yemek", "diger", "misafir"];
const dark: string[] = [];
for (const f of L.floors) for (const r of f.rooms.filter((q) => living.includes(q.type) && !/sinema/i.test(q.name))) {
  const area = r.rect.w * r.rect.h;
  const glass = f.openings.filter((o) => o.exterior && (o.kind === "window" || o.kind === "balconyDoor") && (o.orient === "h" ? o.center > r.rect.x && o.center < r.rect.x + r.rect.w && (Math.abs(o.line - r.rect.y) < 0.01 || Math.abs(o.line - r.rect.y - r.rect.h) < 0.01) : o.center > r.rect.y && o.center < r.rect.y + r.rect.h && (Math.abs(o.line - r.rect.x) < 0.01 || Math.abs(o.line - r.rect.x - r.rect.w) < 0.01))).reduce((t, o) => t + o.width * (o.head - o.sill), 0);
  if (glass > 0 && glass < area / 8 - 0.05) dark.push(`${r.name} ${glass.toFixed(2)}/${(area / 8).toFixed(2)} m²`);
}
ok(!dark.length, `Yaşama mahallerinde pencere ≥ döşemenin 1/8'i ${dark.join(", ")}`);
// mutfak–yemek: örnek projede yan yana
const S = buildLayout(SAMPLE_PROGRAM);
for (const f of S.floors) {
  const k = f.rooms.find((r) => r.type === "mutfak"), y = f.rooms.find((r) => r.type === "yemek");
  if (!k || !y) continue;
  const touch = Math.abs(k.rect.x + k.rect.w - y.rect.x) < 0.01 || Math.abs(y.rect.x + y.rect.w - k.rect.x) < 0.01;
  if (!touch) continue;
  const line = Math.abs(k.rect.x + k.rect.w - y.rect.x) < 0.01 ? y.rect.x : k.rect.x;
  const open = f.openings.some((o) => !o.exterior && o.orient === "v" && Math.abs(o.line - line) < 0.01) || (f.openEdges ?? []).some((e) => e.orient === "v" && Math.abs(e.line - line) < 0.01);
  ok(open, `${f.name}: mutfak ile yemek arasında geçiş var`);
}

console.log("Arsa ve 3D");
const z = zoningCheck(VILLA_PROGRAM, L);
const sp = sitePool(VILLA_PROGRAM, L, z);
const site = { width: VILLA_PROGRAM.site.width, depth: VILLA_PROGRAM.site.depth, offsetX: z.building.x, offsetY: z.building.y };
const pool = sp ? { x: sp.x - z.building.x, y: sp.y - z.building.y, w: sp.w, h: sp.h } : null;
const model = buildModel(L, { showRoof: true, maxLevel: null, cutaway: false, realistic: false, facade: VILLA_PROGRAM.facade, pool }, site);
const named = (n: string) => {
  const out: THREE.Box3[] = [];
  model.updateMatrixWorld(true);
  model.traverse((o) => { if (o.name === n && (o as THREE.Mesh).isMesh) out.push(new THREE.Box3().setFromObject(o)); });
  return out;
};
const walls = named("İstinat duvarı");
ok(walls.length >= 1 && walls.every((b) => b.min.z <= 0.01), `İstinat duvarı yalnız sokak tarafında ve ön bahçe boyunca (${walls.length} parça, hiçbiri bina gerisinde değil)`);
ok(named("Drenaj kanalı").length > 0, "İstinat duvarı dibinde drenaj kanalı var");
const ground = L.floors.find((f) => f.level === 0)!;
ok(ground.z - lv.grade > 0.6, `Zemin kat bahçeden ${(ground.z - lv.grade).toFixed(2)} m yüksekte (balkon havada)`);
ok(named("Balkon taşıyıcısı").length >= 2, "Zemin kat balkonunun altında zemine inen taşıyıcılar var");
ok(named("Veranda taşıyıcısı").length >= 2, "Pergolalı veranda havada değil, taşıyıcıları var");
const rails = named("Korkuluk");
const tooLow = rails.filter((b) => {
  // korkuluk üstü, altındaki bitmiş döşemeden en az 1.10 m (zemin kat, 1. kat, istinat duvarı üstü)
  const top = b.max.y;
  const floors = b.min.z < -0.5 ? [lv.road + 0.03] : L.floors.map((f) => f.z); // bina önünde: istinat duvarı üstü
  const base = floors.filter((y) => y <= top - 0.3).sort((a, c) => c - a)[0];
  return top - base < RAIL_H - 0.01;
});
ok(rails.length > 4 && !tooLow.length, `Korkuluklar ≥ ${RAIL_H.toFixed(2)} m (${rails.length} korkuluk, ${tooLow.length} alçak)`);
const roof = named("Çatı döşemesi");
const st = L.stair!;
const cx = st.x + st.w / 2, cz = st.y + st.h / 2;
ok(roof.length > 1 && !roof.some((b) => b.min.x < cx && b.max.x > cx && b.min.z < cz && b.max.z > cz), "Çatı fenerinin altında döşeme boşluğu var");
const water = named("Su")[0], rim = named("Havuz kenarı");
ok(water && rim.length === 4 && water.max.y < Math.min(...rim.map((b) => b.max.y)), "Havuz suyu kenar taşının altında");
const park = z.checks.find((c) => /Otopark/.test(c.label));
ok(park && park.ok === false, "Programda otopark yoksa imar denetimi uyarıyor");

console.log(failures ? `\n${failures} sorun` : "\nTümü geçti");
process.exit(failures ? 1 : 0);
