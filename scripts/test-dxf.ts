// DXF dışa aktarma denetimi: npm run test:dxf
// Örnek villa, eğimli arsa, yol altı arsa ve çok bloklu site için DXF üretir; yapısal kuralları denetler
// (AC1024 başlığı, katmanlar, bloklar, gerçek ölçüler, taramalar, kağıt düzenleri, tutamaçların tekilliği).
// Çıktı klasörü verilirse (npx tsx scripts/test-dxf.ts <klasör>) dosyaları oraya da yazar.
import fs from "node:fs";
import { buildLayout } from "../src/geometry/layout";
import { buildDXF, type DxfUnit } from "../src/geometry/dxf";
import { SAMPLE_PROGRAM } from "../src/sample";
import { SITE_PROGRAM } from "../src/sample-site";
import { blockView } from "../src/geometry/blocks";
import type { Program } from "../src/shared/schema";

const dir = process.argv[2];
let failures = 0;
const ok = (c: boolean, msg: string) => { if (!c) { failures++; console.log("  ✗ " + msg); } };

const cases: [string, Program, DxfUnit, number][] = [
  ["villa-m", SAMPLE_PROGRAM, "m", 0],
  ["villa-cm-egimli", SAMPLE_PROGRAM, "cm", 0.08],
  ["villa-mm-duz-cati", { ...structuredClone(SAMPLE_PROGRAM), roof: "duz", massing: { features: ["on_konsol", "ust_kat_teras"], cantilever: 1.5, terraceDepth: 2.6, notchDepth: 2.6, rationale: "" } }, "mm", 0],
  ["site-blok-a", blockView(SITE_PROGRAM, 0), "cm", 0],
];
for (const [name, p, unit, slope] of cases) {
  const L = buildLayout(p, { variant: 0, slope });
  const bytes = buildDXF(L, p, unit, { office: "Örnek Mimarlık", architect: "Ayşe Yılmaz", regNo: "12345", date: "24.11.2026" });
  const txt = new TextDecoder("utf-8").decode(bytes);
  if (dir) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(`${dir}/${name}.dxf`, bytes); }
  const lines = txt.split("\r\n");
  ok(lines.length % 2 === 1 && lines[lines.length - 1] === "", `${name}: kod/değer çiftleri`);
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([lines[i].trim(), lines[i + 1]]);
  const val = (c: string) => pairs.filter(([k]) => k === c).map(([, v]) => v);
  const types = val("0");
  const count = (t: string) => types.filter((x) => x === t).length;
  ok(txt.includes("AC1024"), `${name}: AC1024 başlığı`);
  ok(types[types.length - 1] === "EOF", `${name}: EOF`);
  const body = pairs.slice(pairs.findIndex(([k, v]) => k === "2" && v === "CLASSES"));
  const handles = body.filter(([k]) => k === "5" || k === "105").map(([, v]) => v);
  ok(new Set(handles).size === handles.length, `${name}: tutamaçlar tekil`);
  const seed = parseInt(pairs[pairs.findIndex(([k, v]) => k === "9" && v === "$HANDSEED") + 1][1], 16);
  ok(handles.every((h) => parseInt(h, 16) < seed), `${name}: HANDSEED tüm tutamaçlardan büyük`);
  for (const t of ["LWPOLYLINE", "HATCH", "DIMENSION", "INSERT", "ATTRIB", "VIEWPORT", "LAYOUT"]) ok(count(t) > 0, `${name}: ${t} var`);
  ok(count("LINE") < count("LWPOLYLINE") * 4, `${name}: çizgiler çoğunlukla polyline`);
  ok(count("SOLID") === 0, `${name}: eski SOLID yok`);
  const layouts = count("LAYOUT");
  ok(layouts === L.floors.length + 6 + 1, `${name}: ${layouts - 1} kağıt düzeni (beklenen ${L.floors.length + 6})`);
  const blocks = val("2");
  for (const b of ["MAHAL", "KOT", "KESIT-OKU", "PLANHANE-100", "A-DUVAR", "A-AKS"]) ok(blocks.includes(b), `${name}: ${b} tanımlı`);
  ok(blocks.some((b) => b.startsWith("KAPI-")) && blocks.some((b) => b.startsWith("PENCERE-")) && blocks.some((b) => b.startsWith("MOB-")), `${name}: kapı/pencere/mobilya blokları`);
  ok(txt.includes("Örnek Mimarlık") && txt.includes("İMAR ÖZETİ"), `${name}: Türkçe karakterler UTF-8`);
  // her INSERT'in bloğu tanımlı, her katman tabloda
  const defined = new Set(pairs.flatMap(([k, v], i) => (k === "0" && v === "BLOCK" ? [pairs.slice(i, i + 12).find(([c]) => c === "2")?.[1]] : [])));
  const inserts = pairs.flatMap(([k, v], i) => (k === "0" && v === "INSERT" ? [pairs.slice(i, i + 12).find(([c]) => c === "2")?.[1]] : []));
  ok(inserts.every((n) => n && defined.has(n)), `${name}: INSERT blokları tanımlı`);
  console.log(`${name}: ${types.length} nesne, ${count("INSERT")} blok, ${count("DIMENSION")} ölçü, ${count("HATCH")} tarama, ${layouts - 1} pafta, ${(bytes.length / 1024).toFixed(0)} KB`);
}
console.log(failures ? `\n${failures} hata` : "\nDXF denetimi geçti");
process.exit(failures ? 1 : 0);
