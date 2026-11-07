import type { Program } from "../shared/schema";
import type { BuildingLayout } from "../geometry/layout";
import { zoningCheck, DEFAULT_SETBACKS } from "../geometry/zoning";
import { sitePlanSVG } from "../geometry/svg";
import { SvgSheet } from "./SvgSheet";

type ZKey = keyof Program["zoning"];
const FIELDS: { key: ZKey; label: string; step: number; placeholder?: string }[] = [
  { key: "taks", label: "TAKS", step: 0.01 },
  { key: "kaks", label: "KAKS / Emsal", step: 0.05 },
  { key: "maxFloors", label: "Azami kat adedi", step: 1 },
  { key: "hmax", label: "Hmax (m)", step: 0.5 },
  { key: "frontSetback", label: "Ön bahçe (m)", step: 0.5, placeholder: String(DEFAULT_SETBACKS.front) },
  { key: "sideSetback", label: "Yan bahçe (m)", step: 0.5, placeholder: String(DEFAULT_SETBACKS.side) },
  { key: "rearSetback", label: "Arka bahçe (m)", step: 0.5, placeholder: String(DEFAULT_SETBACKS.rear) },
];

export function ZoningPanel({ program, layout, onChange }: { program: Program; layout: BuildingLayout; onChange: (p: Program) => void }) {
  const zoning = program.zoning ?? { taks: null, kaks: null, maxFloors: null, hmax: null, frontSetback: null, sideSetback: null, rearSetback: null };
  const z = zoningCheck(program, layout);
  const setZ = (k: ZKey, v: string) => onChange({ ...program, zoning: { ...zoning, [k]: v === "" ? null : Number(v) } });
  const failing = z.checks.filter((c) => c.ok === false);
  return (
    <div className="zoning">
      <section className="card">
        <h3>İmar durumu</h3>
        <div className="grid-fields">
          {FIELDS.map((f) => (
            <label className="field" key={f.key}>
              <span>{f.label}</span>
              <input type="number" step={f.step} value={zoning[f.key] ?? ""} placeholder={f.placeholder ?? "girilmedi"} onChange={(e) => setZ(f.key, e.target.value)} />
            </label>
          ))}
        </div>
        <div className="muted small">Boş bırakılan çekme mesafelerinde Planlı Alanlar İmar Yönetmeliği varsayılanları (ön 5 m, yan 3 m, arka 3 m) kullanılır. Ön tasarım kontrolüdür; emsal dışı alanlar sadeleştirilmiştir.</div>
      </section>
      <section className={`card ${failing.length ? "bad" : "good"}`}>
        <h3>{failing.length ? `${failing.length} kontrol sınırı aşıyor` : "Girilen sınırlar içinde"}</h3>
        <table className="checks">
          <thead><tr><th>Kontrol</th><th className="num">Proje</th><th className="num">Sınır</th><th /></tr></thead>
          <tbody>
            {z.checks.map((c) => (
              <tr key={c.label}>
                <td>{c.label}</td>
                <td className="num">{c.value}</td>
                <td className="num">{c.limit}</td>
                <td>{c.ok == null ? <span className="pill">—</span> : c.ok ? <span className="pill ok">Uygun</span> : <span className="pill no">Aşıyor</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="muted small">Arsa {z.siteArea.toFixed(0)} m² · taban oturumu {z.footprintArea.toFixed(0)} m² · emsale giren alan {z.grossTotal.toFixed(0)} m²</div>
      </section>
      <SvgSheet svg={sitePlanSVG(layout, program)} name={`${program.projectName}-vaziyet`} />
    </div>
  );
}
