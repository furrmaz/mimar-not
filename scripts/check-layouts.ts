// Yerleşim motoru denetimi: npm run test:layout
// Örnek projeler ve rastgele üretilmiş konut programları için bütün plan alternatiflerini kurar ve denetler:
//  - mahaller oturumun içinde, birbirinin üstüne binmiyor, kat alanını dolduruyor
//  - her mahale girişten (üst katlarda merdivenden) kapı / geçiş / açık plan üzerinden ulaşılıyor
//  - ıslak hacme yalnız başka bir ıslak hacimden girilmiyor
//  - istenen alanlardan sapma (bilgi amaçlı özet)
import { buildLayout, VARIANTS, type BuildingLayout, type FloorLayout, type PlacedRoom } from "../src/geometry/layout";
import { blockView } from "../src/geometry/blocks";
import { SAMPLE_PROGRAM } from "../src/sample";
import { SITE_PROGRAM } from "../src/sample-site";
import type { Program, Room, RoomType, Zone } from "../src/shared/schema";

let failures = 0;
let checks = 0;
const devs: number[] = [];
const fail = (ctx: string, msg: string) => {
  failures++;
  if (failures <= 40) console.log(`  ✗ ${ctx}: ${msg}`);
};

const EPS = 0.02;
const inter = (a: PlacedRoom["rect"], b: PlacedRoom["rect"]) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** İki mahal arasındaki ortak kenarda duvarla kapanmayan bir nokta var mı (kapı, geçiş, açık plan)? */
function connected(fl: FloorLayout, p: PlacedRoom, q: PlacedRoom) {
  const a = p.rect, b = q.rect;
  let orient: "h" | "v" | null = null, line = 0, lo = 0, hi = 0;
  if (Math.abs(a.x + a.w - b.x) < EPS || Math.abs(b.x + b.w - a.x) < EPS) {
    orient = "v"; line = Math.abs(a.x + a.w - b.x) < EPS ? b.x : a.x;
    lo = Math.max(a.y, b.y); hi = Math.min(a.y + a.h, b.y + b.h);
  } else if (Math.abs(a.y + a.h - b.y) < EPS || Math.abs(b.y + b.h - a.y) < EPS) {
    orient = "h"; line = Math.abs(a.y + a.h - b.y) < EPS ? b.y : a.y;
    lo = Math.max(a.x, b.x); hi = Math.min(a.x + a.w, b.x + b.w);
  }
  if (!orient || hi - lo < 0.7) return false;
  // 0.75 m'lik açık bir aralık ara
  const n = Math.ceil((hi - lo) / 0.05);
  let run = 0;
  for (let i = 0; i <= n; i++) {
    const t = lo + ((hi - lo) * i) / n;
    const covered = fl.walls.some((w) => w.orient === orient && Math.abs(w.line - line) < EPS && t >= w.a - 1e-6 && t <= w.b + 1e-6);
    run = covered ? 0 : run + (hi - lo) / n;
    if (run >= 0.7) return true;
  }
  return false;
}

const connectedRect = (a: PlacedRoom["rect"], b: PlacedRoom["rect"]) => inter({ x: a.x - 0.05, y: a.y - 0.05, w: a.w + 0.1, h: a.h + 0.1 }, b) > 0.05;
const WET = new Set(["banyo", "wc", "camasir"]);

function checkFloor(L: BuildingLayout, fl: FloorLayout, ctx: string, groundLevel: number) {
  checks++;
  const rooms = fl.rooms;
  for (const r of rooms) {
    const { x, y, w, h } = r.rect;
    if (w < 0.6 || h < 0.6) fail(ctx, `${r.name} çok dar (${w.toFixed(2)} × ${h.toFixed(2)})`);
    if (x < -EPS || y < -EPS || x + w > L.W + EPS || y + h > L.D + EPS) fail(ctx, `${r.name} oturumun dışına taşıyor`);
  }
  for (let i = 0; i < rooms.length; i++)
    for (let j = i + 1; j < rooms.length; j++) {
      const o = inter(rooms[i].rect, rooms[j].rect);
      if (o > 0.05) fail(ctx, `${rooms[i].name} ile ${rooms[j].name} üst üste (${o.toFixed(2)} m²)`);
    }
  const cover = rooms.reduce((s, r) => s + r.rect.w * r.rect.h, 0) + (fl.stairs ?? []).reduce((s, r) => s + r.w * r.h, 0);
  if (Math.abs(cover - L.W * L.D) > L.W * L.D * 0.02) fail(ctx, `mahaller kat alanını doldurmuyor (${cover.toFixed(1)} / ${(L.W * L.D).toFixed(1)} m²)`);

  // erişim: zemin katta girişin olduğu mahalden, diğer katlarda merdivenden
  const adj = new Map<PlacedRoom, PlacedRoom[]>();
  for (const p of rooms) adj.set(p, []);
  for (let i = 0; i < rooms.length; i++)
    for (let j = i + 1; j < rooms.length; j++)
      if (connected(fl, rooms[i], rooms[j])) { adj.get(rooms[i])!.push(rooms[j]); adj.get(rooms[j])!.push(rooms[i]); }
  let start: PlacedRoom | undefined;
  if (fl.level === groundLevel) {
    const ent = fl.openings.find((o) => o.kind === "entrance" && o.width < 2);
    if (!ent) { fail(ctx, "giriş kapısı yok"); return; }
    const px = ent.orient === "h" ? ent.center : ent.line, py = ent.orient === "h" ? ent.line : ent.center;
    start = rooms.find((r) => px >= r.rect.x - EPS && px <= r.rect.x + r.rect.w + EPS && py >= r.rect.y - EPS && py <= r.rect.y + r.rect.h + EPS && r.type !== "garaj");
  } else {
    start = rooms.find((r) => r.type === "merdiven") ?? rooms.find((r) => r.type === "hol");
  }
  if (!start) { if (!L.apartment) fail(ctx, "başlangıç mahali bulunamadı"); return; }
  // dubleks üst katı: dairenin iç merdiveninden
  const seeds = [start, ...rooms.filter((r) => (fl.stairs ?? []).some((st) => inter(st, r.rect) > 0.01 || connectedRect(st, r.rect)))];
  const seen = new Set<PlacedRoom>(seeds);
  const queue = [...seeds];
  while (queue.length) {
    const r = queue.shift()!;
    for (const n of adj.get(r)!) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  }
  for (const r of rooms) {
    if (seen.has(r) || r.type === "garaj" || r.name.startsWith("Boş") || r.name === "Asansör") continue;
    fail(ctx, `${r.name} mahaline ulaşılamıyor`);
  }
  // ıslak hacimden geçiş: kuru bir mahale yalnız ıslak hacim üzerinden girilmesin
  for (const r of rooms) {
    if (WET.has(r.type) || r.band === "hall") continue;
    const ns = adj.get(r)!;
    const storeViaLaundry = (r.type === "kiler" || r.type === "depo" || r.type === "teknik") && ns.some((n) => n.type === "camasir");
    if (ns.length && !storeViaLaundry && ns.every((n) => WET.has(n.type))) fail(ctx, `${r.name} mahaline yalnız ıslak hacimden giriliyor`);
  }
  for (const r of rooms) {
    if (r.requestedArea > 0 && r.type !== "hol") devs.push((r.rect.w * r.rect.h) / r.requestedArea - 1);
  }
}

function checkProgram(p: Program, name: string) {
  for (const v of VARIANTS) {
    let L: BuildingLayout;
    try {
      L = buildLayout(p, { variant: v.id });
    } catch (e) {
      fail(`${name} ${v.short}`, `hata: ${(e as Error).message}`);
      continue;
    }
    const ground = L.floors.find((f) => f.level >= 0)?.level ?? L.floors[0].level;
    for (const fl of L.floors) checkFloor(L, fl, `${name} ${v.short} ${fl.name}`, ground);
  }
}

// ---- rastgele konut programları
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const R = (name: string, type: RoomType, zone: Zone, area: number): Room => ({ name, type, zone, area: Math.round(area * 10) / 10, note: "" });

function randomHouse(i: number): Program {
  const floorsN = pick([1, 2, 2, 2, 3]);
  const beds = pick([2, 3, 3, 4]);
  const ground: Room[] = [R("Antre", "antre", "sirkulasyon", 4 + rnd() * 4), R("Salon", "salon", "gunduz", 26 + rnd() * 18), R(pick(["Mutfak", "Açık Mutfak"]), "mutfak", "gunduz", 9 + rnd() * 8), R("Misafir WC", "wc", "servis", 2 + rnd() * 1.5), R("Hol", "hol", "sirkulasyon", 6 + rnd() * 6)];
  if (rnd() < 0.5) ground.push(R("Kiler", "kiler", "servis", 2.5 + rnd() * 2));
  if (rnd() < 0.5) ground.push(R("Çalışma Odası", "calisma", "gunduz", 8 + rnd() * 5));
  if (rnd() < 0.3) ground.push(R("Yemek Odası", "yemek", "gunduz", 12 + rnd() * 6));
  const night: Room[] = [R("Ebeveyn Yatak Odası", "ebeveyn", "gece", 14 + rnd() * 6), R("Ebeveyn Banyosu", "banyo", "gece", 4 + rnd() * 2)];
  if (rnd() < 0.6) night.push(R("Giyinme", "giyinme", "gece", 4 + rnd() * 3));
  for (let k = 1; k < beds; k++) night.push(R(`Yatak Odası ${k}`, pick(["yatak", "cocuk"]) as RoomType, "gece", 10 + rnd() * 4));
  night.push(R("Banyo", "banyo", "gece", 4.5 + rnd() * 2));
  if (rnd() < 0.4) night.push(R("Çamaşır Odası", "camasir", "servis", 3 + rnd() * 2));
  night.push(R("Kat Holü", "hol", "sirkulasyon", 6 + rnd() * 6));
  if (rnd() < 0.5) night.push(R("Balkon", "balkon", "dis", 6 + rnd() * 6));
  let floors: Program["floors"];
  if (floorsN === 1) floors = [{ level: 0, name: "Zemin Kat", rooms: [...ground, ...night.filter((r) => r.type !== "hol")] }];
  else if (floorsN === 2) floors = [{ level: 0, name: "Zemin Kat", rooms: ground }, { level: 1, name: "1. Kat", rooms: night }];
  else floors = [{ level: -1, name: "Bodrum Kat", rooms: [R("Garaj", "garaj", "servis", 30 + rnd() * 10), R("Teknik Hacim", "teknik", "servis", 8), R("Depo", "depo", "servis", 10), R("Hol", "hol", "sirkulasyon", 8)] }, { level: 0, name: "Zemin Kat", rooms: ground }, { level: 1, name: "1. Kat", rooms: night }];
  const biggest = Math.max(...floors.map((f) => f.rooms.filter((r) => r.zone !== "dis").reduce((s, r) => s + r.area, 0)));
  const fp = biggest * (1.08 + rnd() * 0.15);
  const ratio = 1.1 + rnd() * 0.6;
  const W = Math.round(Math.sqrt(fp * ratio) * 10) / 10, D = Math.round((fp / W) * 10) / 10;
  return {
    ...SAMPLE_PROGRAM, projectName: `Rastgele ${i}`, floors, footprint: { width: W, depth: D }, floorHeight: pick([2.8, 3.0, 3.2]),
    adjacencies: [{ a: "Salon", b: ground[2].name, relation: "bitisik", reason: "" }, { a: "Ebeveyn Yatak Odası", b: "Ebeveyn Banyosu", relation: "bitisik", reason: "" }],
    design: {},
  } as Program;
}

console.log("Örnek: villa");
checkProgram(SAMPLE_PROGRAM, "villa");
console.log("Örnek: 4 bloklu site (A blok)");
checkProgram(blockView(SITE_PROGRAM, 0), "site-A");
const N = Number(process.env.N ?? 120);
console.log(`Rastgele ${N} konut programı`);
for (let i = 0; i < N; i++) {
  const p = randomHouse(i);
  if (process.env.SHOW === String(i)) {
    // geliştirici için: bu programın planlarını SVG olarak yaz
    const { planSVG } = await import("../src/geometry/svg");
    const fs = await import("node:fs");
    const L = buildLayout(p, { variant: Number(process.env.V ?? 0) });
    const dir = process.env.OUT ?? ".";
    L.floors.forEach((f, k) => fs.writeFileSync(`${dir}/r${i}-${k}.svg`, planSVG(L, f, p)));
    console.log(JSON.stringify({ W: L.W, D: L.D, floors: p.floors.map((f) => f.rooms.map((r) => `${r.name}:${r.area}`)) }));
  }
  checkProgram(p, `r${i}`);
}

devs.sort((a, b) => a - b);
const q = (k: number) => devs[Math.floor((devs.length - 1) * k)] * 100;
console.log(`\n${checks} kat denetlendi, ${failures} sorun.`);
console.log(`Alan sapması (çizilen / istenen − 1): medyan ${q(0.5).toFixed(0)}%, %10: ${q(0.1).toFixed(0)}%, %90: ${q(0.9).toFixed(0)}%`);
process.exit(failures ? 1 : 0);
