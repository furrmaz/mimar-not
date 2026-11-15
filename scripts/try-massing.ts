// Geliştirici aracı: örnek villayı verilen kütle özellikleriyle çizip SVG'leri yazar.
// npx tsx scripts/try-massing.ts <klasör> on_konsol ust_kat_teras ...
import fs from "node:fs";
import { buildLayout } from "../src/geometry/layout";
import { elevationSVG, planSVG, sectionSVG } from "../src/geometry/svg";
import { buildDXF } from "../src/geometry/dxf";
import { buildIFC } from "../src/geometry/ifc";
import { SAMPLE_PROGRAM } from "../src/sample";
import { SITE_PROGRAM } from "../src/sample-site";
import { blockView } from "../src/geometry/blocks";
import type { Program } from "../src/shared/schema";
const [dir, ...feats] = process.argv.slice(2);
const p: Program = { ...structuredClone(process.env.SITE ? blockView(SITE_PROGRAM, 0) : SAMPLE_PROGRAM), roof: "duz", massing: { features: feats, cantilever: 1.5, terraceDepth: 2.6, notchDepth: 2.6, rationale: "" } };
if (process.env.SITE) p.floors = p.floors.filter((f) => f.level < 4);
const L = buildLayout(p, { variant: Number(process.env.V ?? 0), slope: Number(process.env.SLOPE ?? 0) });
console.log(JSON.stringify(L.massing), L.W, L.D);
fs.mkdirSync(dir, { recursive: true });
L.floors.forEach((f, i) => fs.writeFileSync(`${dir}/plan${i}.svg`, planSVG(L, f, p)));
fs.writeFileSync(`${dir}/kesit.svg`, sectionSVG(L, p));
for (const fc of ["front", "back", "left", "right"] as const) fs.writeFileSync(`${dir}/cephe-${fc}.svg`, elevationSVG(L, p, fc));
fs.writeFileSync(`${dir}/proje.dxf`, buildDXF(L, p, "cm"));
fs.writeFileSync(`${dir}/proje.ifc`, buildIFC(L, p));
