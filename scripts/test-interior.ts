// İç mekân denetimi: npm run test:interior
// Örnek projelerin otomatik mobilya yerleşimini ergonomi kurallarıyla (interiorChecks) denetler.
// Otomatik yerleşim "uyarı" düzeyinde hata üretmemeli; öneriler bilgi amaçlı sayılır.
import { buildLayout, VARIANTS } from "../src/geometry/layout";
import { autoFurnish } from "../src/geometry/furniture";
import { interiorChecks, lightingPlan, INTERIOR_STYLES, effectiveInteriorStyle } from "../src/geometry/interior";
import { SAMPLE_PROGRAM } from "../src/sample";
import { SITE_PROGRAM } from "../src/sample-site";
import { VILLA_PROGRAM } from "./fixture-villa-yol-alti";
import type { Program } from "../src/shared/schema";
import { renderPrompt } from "../src/shared/render";

let failures = 0, warns = 0, tips = 0;
const ok = (cond: unknown, msg: string) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { failures++; console.log(`  ✗ ${msg}`); }
};
const tipCount = new Map<string, number>();
for (const [name, p] of [["örnek", SAMPLE_PROGRAM], ["arsa", SITE_PROGRAM], ["villa", VILLA_PROGRAM]] as [string, Program][]) {
  for (const v of VARIANTS) {
    const L = buildLayout(p, { variant: v.id });
    for (const fl of L.floors) {
      const items = autoFurnish(fl);
      const iss = interiorChecks(fl, items);
      const narrow = new Set(fl.rooms.filter((r) => Math.min(r.rect.w, r.rect.h) < 1.2).map((r) => r.id));
      for (const i of iss) {
        // 1.20 m'den dar mahal yerleşim motorunun sorunu (roomChecks uyarır); mobilya denetimine sayılmaz
        if (narrow.has(i.roomId)) continue;
        if (i.level === "uyari") { warns++; if (process.env.V || warns <= 40) console.log(`  ! ${name} v${v.id} ${fl.name} / ${i.room}: ${i.message}`); }
        else { tips++; const k = i.message.replace(/[\d,]+ (cm|m)/g, "#"); tipCount.set(k, (tipCount.get(k) ?? 0) + 1); if (process.env.V) console.log(`  · ${name} v${v.id} ${fl.name} / ${i.room}: ${i.message}`); }
      }
      const lp = lightingPlan(fl, items);
      if (lp.rows.some((r) => r.spots < 1 || !Number.isFinite(r.lumens))) failures++;
    }
  }
}
console.log(`Uyarı: ${warns}, öneri: ${tips}`);
for (const [k, n] of [...tipCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${n}× ${k}`);
ok(warns === 0, "Otomatik yerleşimde kullanımı engelleyen ergonomi uyarısı yok");
ok(INTERIOR_STYLES.every((s) => Object.values(s.palette).every((c) => Number.isInteger(c) && c >= 0 && c <= 0xffffff)), "Üslup paletleri geçerli renk");
ok(effectiveInteriorStyle({ design: { stylePack: "bodrum" } }) === "akdeniz" && effectiveInteriorStyle({ interiorStyle: "japandi", design: { interiorStyle: "turk" } }) === "turk", "Üslup önceliği: mimarın seçimi > notlar > dış üslup");
const cam = { height: 1.6, distance: 0, pitch: 3, focal: 24, buildingHeight: 9, facades: [], frame: { x0: 0, x1: 1, y0: 0, y1: 1 }, interior: { room: "living room", roomType: "salon", style: INTERIOR_STYLES[2].en, furniture: ["sofa", "coffee table"], area: 24 } };
const ip = renderPrompt(SAMPLE_PROGRAM, "akşam ışığı", 0, cam);
ok(ip.includes("interior") && ip.includes("japandi") && ip.includes("sofa") && !ip.includes("landscaped garden"), "İçeriden render talimatı oda, üslup ve mobilyayı söylüyor");
ok(!renderPrompt(SAMPLE_PROGRAM, "", 0, { ...cam, interior: undefined }).includes("interior design photograph"), "Dış render talimatı değişmedi");
if (failures) { console.log(`${failures} hata`); process.exit(1); }
console.log("Tamam");
