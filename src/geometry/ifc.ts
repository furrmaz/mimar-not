// IFC4 (BIM) dışa aktarım: katlar, duvarlar (boşluklarıyla), kapılar, pencereler, döşemeler ve mahaller (IfcSpace).
// Revit, ArchiCAD, BricsCAD BIM ve ücretsiz görüntüleyiciler (BIMvision, xBIM, BlenderBIM) açabilir.
import type { Program } from "../shared/schema";
import type { BuildingLayout, FloorLayout, Opening, WallPiece } from "./layout";
import { near } from "./layout";

const B64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

class Step {
  private lines: string[] = [];
  private seed: number;
  constructor(seedText: string) {
    let h = 2166136261;
    for (const c of seedText) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    this.seed = h >>> 0 || 1;
  }
  add(entity: string) {
    this.lines.push(`#${this.lines.length + 1}=${entity};`);
    return `#${this.lines.length}`;
  }
  guid() {
    let s = B64[(this.rand() * 4) | 0];
    for (let i = 1; i < 22; i++) s += B64[(this.rand() * 64) | 0];
    return `'${s}'`;
  }
  private rand() {
    // xorshift32
    let x = this.seed;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.seed = x;
    return x / 4294967296;
  }
  body() {
    return this.lines.join("\n");
  }
}

/** STEP metni: ' ikilenir, ASCII dışı karakterler \X2\ ile kodlanır. */
function str(s: string | null | undefined) {
  if (s == null || s === "") return "$";
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === "'") out += "''";
    else if (ch === "\\") out += "\\\\";
    else if (c >= 32 && c < 127) out += ch;
    else out += `\\X2\\${c.toString(16).toUpperCase().padStart(4, "0")}\\X0\\`;
  }
  return `'${out}'`;
}
const n = (v: number) => {
  const s = (Math.round(v * 10000) / 10000).toString();
  return /[.eE]/.test(s) ? s : s + ".";
};

export function buildIFC(L: BuildingLayout, program: Program, author = ""): string {
  const f = new Step(program.projectName + JSON.stringify(program.footprint) + L.variant);
  const pt3 = (x: number, y: number, z: number) => f.add(`IFCCARTESIANPOINT((${n(x)},${n(y)},${n(z)}))`);
  const pt2 = (x: number, y: number) => f.add(`IFCCARTESIANPOINT((${n(x)},${n(y)}))`);
  const dir = (x: number, y: number, z: number) => f.add(`IFCDIRECTION((${n(x)},${n(y)},${n(z)}))`);
  const dirZ = dir(0, 0, 1);
  const dirX = dir(1, 0, 0);
  const dirY = dir(0, 1, 0);
  const axis = (x: number, y: number, z: number, xAxis = dirX) => f.add(`IFCAXIS2PLACEMENT3D(${pt3(x, y, z)},${dirZ},${xAxis})`);
  const place = (parent: string | null, x = 0, y = 0, z = 0, xAxis = dirX) => f.add(`IFCLOCALPLACEMENT(${parent ?? "$"},${axis(x, y, z, xAxis)})`);

  // Birimler ve bağlam
  const units = [
    f.add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)"),
    f.add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)"),
    f.add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)"),
    f.add("IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)"),
  ];
  const unitAssign = f.add(`IFCUNITASSIGNMENT((${units.join(",")}))`);
  const ctx = f.add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${axis(0, 0, 0)},${f.add(`IFCDIRECTION((0.,1.))`)})`);
  const body = f.add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`);
  const project = f.add(`IFCPROJECT(${f.guid()},$,${str(program.projectName)},${str(program.summary.slice(0, 250))},$,$,$,(${ctx}),${unitAssign})`);

  // Kutu geometrisi: yerel çerçevede (cx, cy) merkezli w×d dikdörtgen, z0'dan h kadar yukarı
  const box = (cx: number, cy: number, w: number, d: number, h: number, z0 = 0) => {
    const prof = f.add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${f.add(`IFCAXIS2PLACEMENT2D(${pt2(cx, cy)},$)`)},${n(w)},${n(d)})`);
    const solid = f.add(`IFCEXTRUDEDAREASOLID(${prof},${axis(0, 0, z0)},${dirZ},${n(h)})`);
    const rep = f.add(`IFCSHAPEREPRESENTATION(${body},'Body','SweptSolid',(${solid}))`);
    return f.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
  };
  const rel = (kind: string, a: string, list: string[]) => {
    if (list.length) f.add(`${kind}(${f.guid()},$,$,$,${a},(${list.join(",")}))`);
  };

  const sitePl = place(null);
  const site = f.add(`IFCSITE(${f.guid()},$,'Arsa',${str(program.site.orientation)},$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
  const bldgPl = place(sitePl);
  const building = f.add(`IFCBUILDING(${f.guid()},$,${str(program.projectName)},${str(program.buildingType)},$,${bldgPl},$,$,.ELEMENT.,$,$,$)`);
  rel("IFCRELAGGREGATES", project, [site]);
  rel("IFCRELAGGREGATES", site, [building]);

  const wallH = L.H - L.slab;
  const storeys: string[] = [];
  const extProps = f.add(`IFCPROPERTYSET(${f.guid()},$,'Pset_WallCommon',$,(${f.add("IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN(.T.),$)")}))`);
  const intProps = f.add(`IFCPROPERTYSET(${f.guid()},$,'Pset_WallCommon',$,(${f.add("IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN(.F.),$)")}))`);
  const extWalls: string[] = [], intWalls: string[] = [];

  for (const fl of L.floors) {
    const stPl = place(bldgPl, 0, 0, fl.z);
    const storey = f.add(`IFCBUILDINGSTOREY(${f.guid()},$,${str(fl.name)},$,$,${stPl},$,$,.ELEMENT.,${n(fl.z)})`);
    storeys.push(storey);
    const contained: string[] = [];

    // Döşeme
    const slab = f.add(`IFCSLAB(${f.guid()},$,${str(fl.name + " döşemesi")},$,$,${place(stPl)},${box(L.W / 2, L.D / 2, L.W + L.extWall, L.D + L.extWall, L.slab, -L.slab)},$,.FLOOR.)`);
    contained.push(slab);

    // Duvarlar + boşluklar
    for (const w of fl.wallLines) contained.push(...wall(fl, w, stPl));

    // Mahaller
    const spaces: string[] = [];
    for (const r of fl.rooms) {
      const sp = f.add(
        `IFCSPACE(${f.guid()},$,${str(r.type === "merdiven" ? "MRD" : r.id)},$,$,${place(stPl, r.rect.x, r.rect.y, 0)},${box(r.rect.w / 2, r.rect.h / 2, r.rect.w, r.rect.h, wallH)},${str(r.name)},.ELEMENT.,.INTERNAL.,$)`,
      );
      const q = f.add(`IFCQUANTITYAREA('NetFloorArea',$,$,${n(r.rect.w * r.rect.h)},$)`);
      const qto = f.add(`IFCELEMENTQUANTITY(${f.guid()},$,'Qto_SpaceBaseQuantities',$,$,(${q}))`);
      f.add(`IFCRELDEFINESBYPROPERTIES(${f.guid()},$,$,$,(${sp}),${qto})`);
      spaces.push(sp);
    }
    // Balkon / teras: dış mahal + döşeme
    for (const o of fl.outdoor) {
      const pl = place(stPl, o.rect.x, o.rect.y, 0);
      contained.push(f.add(`IFCSLAB(${f.guid()},$,${str(o.name)},$,$,${pl},${box(o.rect.w / 2, o.rect.h / 2, o.rect.w, o.rect.h, L.slab, -L.slab)},$,.FLOOR.)`));
      spaces.push(f.add(`IFCSPACE(${f.guid()},$,${str(o.type)},$,$,${place(stPl, o.rect.x, o.rect.y, 0)},${box(o.rect.w / 2, o.rect.h / 2, o.rect.w, o.rect.h, 1.1)},${str(o.name)},.ELEMENT.,.EXTERNAL.,$)`));
    }
    rel("IFCRELAGGREGATES", storey, spaces);
    f.add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${f.guid()},$,$,$,(${contained.join(",")}),${storey})`);
  }
  rel("IFCRELAGGREGATES", building, storeys);
  if (extWalls.length) f.add(`IFCRELDEFINESBYPROPERTIES(${f.guid()},$,$,$,(${extWalls.join(",")}),${extProps})`);
  if (intWalls.length) f.add(`IFCRELDEFINESBYPROPERTIES(${f.guid()},$,$,$,(${intWalls.join(",")}),${intProps})`);

  function wall(fl: FloorLayout, w: WallPiece, stPl: string): string[] {
    const len = w.b - w.a;
    if (len < 0.05) return [];
    const [x, y, xa] = w.orient === "h" ? [w.a, w.line, dirX] : [w.line, w.a, dirY];
    const wPl = place(stPl, x, y, 0, xa);
    const wallEl = f.add(`IFCWALL(${f.guid()},$,${str(w.exterior ? "Dış duvar" : "İç duvar")},$,$,${wPl},${box(len / 2, 0, len, w.thickness, wallH)},$,.STANDARD.)`);
    (w.exterior ? extWalls : intWalls).push(wallEl);
    const fills: string[] = [];
    const ops = fl.openings.filter((o) => o.orient === w.orient && near(o.line, w.line) && o.center > w.a && o.center < w.b);
    for (const o of ops) fills.push(opening(o, w, wPl, wallEl));
    return [wallEl, ...fills];
  }

  function opening(o: Opening, w: WallPiece, wPl: string, wallEl: string): string {
    const u = o.center - w.a; // duvar boyunca
    const h = Math.min(o.head, wallH) - o.sill;
    const oPl = place(wPl, u, 0, o.sill);
    const op = f.add(`IFCOPENINGELEMENT(${f.guid()},$,'Boşluk',$,$,${oPl},${box(0, 0, o.width, w.thickness + 0.1, h)},$,.OPENING.)`);
    f.add(`IFCRELVOIDSELEMENT(${f.guid()},$,$,$,${wallEl},${op})`);
    const fPl = place(oPl);
    const isDoor = o.kind === "door" || o.kind === "entrance" || o.kind === "balconyDoor";
    const name = o.kind === "entrance" ? "Giriş kapısı" : o.kind === "balconyDoor" ? "Balkon kapısı" : o.kind === "door" ? "Kapı" : "Pencere";
    const geo = box(0, 0, o.width, isDoor ? 0.05 : 0.07, h);
    const el = isDoor
      ? f.add(`IFCDOOR(${f.guid()},$,${str(name)},$,$,${fPl},${geo},$,${n(h)},${n(o.width)},.DOOR.,.SINGLE_SWING_LEFT.,$)`)
      : f.add(`IFCWINDOW(${f.guid()},$,${str(name)},$,$,${fPl},${geo},$,${n(h)},${n(o.width)},.WINDOW.,.SINGLE_PANEL.,$)`);
    f.add(`IFCRELFILLSELEMENT(${f.guid()},$,$,$,${op},${el})`);
    return el;
  }

  const ts = new Date().toISOString().slice(0, 19);
  const header = [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('ViewDefinition [DesignTransferView]'),'2;1');",
    `FILE_NAME(${str(program.projectName + ".ifc")},'${ts}',(${str(author) === "$" ? "''" : str(author)}),(''),'Mimar Not','Mimar Not','');`,
    "FILE_SCHEMA(('IFC4'));",
    "ENDSEC;",
    "DATA;",
  ].join("\n");
  return `${header}\n${f.body()}\nENDSEC;\nEND-ISO-10303-21;\n`;
}
