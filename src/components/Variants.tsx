import { useMemo } from "react";
import type { Adjacency, Program } from "../shared/schema";
import type { BuildingLayout } from "../geometry/layout";
import { planSVG } from "../geometry/svg";
import { allVariants, scoreLayout } from "../geometry/score";

/** Üç plan alternatifi: küçük önizleme + puan; tıklanınca seçilir. */
export function VariantPicker({ program, onChange }: { program: Program; onChange: (p: Program) => void }) {
  const variants = useMemo(() => allVariants(program), [program.floors, program.adjacencies, program.footprint, program.floorHeight]);
  const current = program.design?.variant ?? 0;
  const edited = !!(program.design?.cols && Object.keys(program.design.cols).length) || program.design?.frontDepth != null;
  const best = Math.max(...variants.map((v) => v.score.score));
  return (
    <section className="variants">
      {variants.map((v) => (
        <button
          key={v.id}
          className={`variant ${current === v.id ? "active" : ""}`}
          onClick={() => current !== v.id && onChange({ ...program, design: { variant: v.id } })}
          title={current === v.id ? "Seçili alternatif" : "Bu alternatife geç"}
        >
          <div className="variant-head">
            <b>{v.name}</b>
            {v.score.score === best && <span className="pill ok">önerilen</span>}
          </div>
          <div className="variant-thumbs">
            {v.layout.floors.map((f) => (
              <div key={f.level} className="thumb" dangerouslySetInnerHTML={{ __html: planSVG(v.layout, f, program, { thumb: true }) }} />
            ))}
          </div>
          <div className="variant-stats">
            <span>Komşuluk {v.score.adjTotal ? `${v.score.adjOk}/${v.score.adjTotal}` : "—"}</span>
            <span className={v.score.hard ? "bad-text" : ""}>Ölçü uyarısı {v.score.hard}</span>
            <span>Bahçeye bakan gündüz mekânı %{Math.round(v.score.daylight * 100)}</span>
          </div>
          {current === v.id && edited && <div className="muted small">Elle düzenlendi; başka alternatife geçince düzenleme sıfırlanır.</div>}
        </button>
      ))}
    </section>
  );
}

export function AdjacencyCard({ program, layout }: { program: Program; layout: BuildingLayout }) {
  const s = scoreLayout(program, layout);
  if (!s.adj.length) return null;
  return (
    <section className="card">
      <h3>Komşuluk istekleri ({s.adjOk}/{s.adjTotal} sağlanıyor)</h3>
      <ul className="adj-list">
        {s.adj.map((a, i) => (
          <li key={i}>
            <span className={a.ok == null ? "pill" : a.ok ? "pill ok" : "pill no"}>{a.ok == null ? "oda yok" : a.ok ? "sağlanıyor" : "sağlanmıyor"}</span>{" "}
            <b>{a.a}</b> {a.relation === "bitisik" ? "↔ bitişik" : "⇹ uzak"} <b>{a.b}</b> <span className="muted">· {a.reason}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Program sekmesinde komşulukları düzenleme. */
export function AdjacencyEditor({ program, onChange }: { program: Program; onChange: (p: Program) => void }) {
  const list = program.adjacencies ?? [];
  const names = Array.from(new Set(program.floors.flatMap((f) => f.rooms.filter((r) => r.zone !== "dis" && r.type !== "hol" && r.type !== "koridor").map((r) => r.name))));
  const set = (next: Adjacency[]) => onChange({ ...program, adjacencies: next });
  const patch = (i: number, p: Partial<Adjacency>) => set(list.map((a, k) => (k === i ? { ...a, ...p } : a)));
  return (
    <section className="card">
      <h3>Komşuluk ilişkileri</h3>
      <table>
        <thead><tr><th>Oda</th><th>İlişki</th><th>Oda</th><th>Gerekçe</th><th /></tr></thead>
        <tbody>
          {list.map((a, i) => (
            <tr key={i}>
              <td><select value={a.a} onChange={(e) => patch(i, { a: e.target.value })}>{[a.a, ...names.filter((n) => n !== a.a)].map((n) => <option key={n}>{n}</option>)}</select></td>
              <td>
                <select value={a.relation} onChange={(e) => patch(i, { relation: e.target.value as Adjacency["relation"] })}>
                  <option value="bitisik">bitişik olsun</option>
                  <option value="uzak">uzak olsun</option>
                </select>
              </td>
              <td><select value={a.b} onChange={(e) => patch(i, { b: e.target.value })}>{[a.b, ...names.filter((n) => n !== a.b)].map((n) => <option key={n}>{n}</option>)}</select></td>
              <td><input value={a.reason} onChange={(e) => patch(i, { reason: e.target.value })} /></td>
              <td><button className="icon" title="Sil" onClick={() => set(list.filter((_, k) => k !== i))}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {names.length >= 2 && (
        <button className="btn ghost small" onClick={() => set([...list, { a: names[0], b: names[1], relation: "bitisik", reason: "" }])}>+ İlişki ekle</button>
      )}
      <div className="muted small">Yerleşim aynı kattaki odaları bu isteklere göre sıralar. Hol üzerinden karşılıklı gelen odalar bitişik sayılmaz.</div>
    </section>
  );
}
