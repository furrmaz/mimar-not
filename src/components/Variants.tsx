import { useMemo } from "react";
import type { Adjacency, Program } from "../shared/schema";
import type { BuildingLayout } from "../geometry/layout";
import { planSVG } from "../geometry/svg";
import { allVariants, scoreLayout } from "../geometry/score";
import { MASS_FEATURES, MASS_LABELS, effectiveMassing, type MassFeature } from "../geometry/massing";
import { FACADE_DETAILS, normalizeFacade, type FacadeDetail } from "../shared/schema";
import { STYLE_PACKS, applyStylePack } from "../stylepacks";

const DETAIL_LABELS: Record<FacadeDetail, string> = {
  pergola: "Pergola", gunes_kirici: "Ahşap güneş kırıcı", giris_cercevesi: "Giriş çerçevesi", kutu_cerceve: "Üst kat kutu çerçevesi", cati_feneri: "Çatı feneri",
};

/** Üslup paketleri ve cephe ayrıntıları: tek tıkla çatı, malzeme, cephe ve kütle birlikte değişir. */
export function StylePicker({ program, apartment, onChange }: { program: Program; apartment?: boolean; onChange: (p: Program) => void }) {
  const fac = normalizeFacade(program.facade, program.materials);
  const details = fac.details as FacadeDetail[];
  const toggle = (d: FacadeDetail) => onChange({ ...program, facade: { ...fac, details: details.includes(d) ? details.filter((x) => x !== d) : [...details, d] } });
  return (
    <section className="card">
      <h3>Üslup paketi</h3>
      <div className="style-packs">
        {STYLE_PACKS.map((s) => (
          <button key={s.id} className={`style-pack ${program.design?.stylePack === s.id ? "active" : ""}`} title={s.hint} onClick={() => onChange(applyStylePack(program, s))}>
            <span className="swatches"><i style={{ background: s.facade.wallColor }} /><i style={{ background: s.facade.accentColor }} /><i style={{ background: s.facade.roofColor }} /></span>
            <b>{s.name}</b>
            <span className="muted small">{s.hint}</span>
          </button>
        ))}
      </div>
      <div className="massing-nums">
        <span className="small"><b>Cephe ayrıntıları</b></span>
        {FACADE_DETAILS.map((d) => (
          <label key={d} className="check"><input type="checkbox" checked={details.includes(d)} onChange={() => toggle(d)} /> {DETAIL_LABELS[d]}</label>
        ))}
        {!apartment && <label className="check" title="Arka bahçeye (sığmazsa yan bahçeye) havuz ve veranda; vaziyet planında, 3D'de ve DXF'te görünür"><input type="checkbox" checked={!!program.design?.pool} onChange={(e) => onChange({ ...program, design: { ...(program.design ?? {}), pool: e.target.checked } })} /> Havuz</label>}
        <label className="small" title="Sokaktan arkaya doğru arsa eğimi: arka taraf yükseliyorsa artı, alçalıyorsa eksi. Kesitte, yan cephelerde, 3D'de ve DXF'te zemin buna göre çizilir">Arsa eğimi %
          <input type="number" min={-30} max={30} step={1} value={program.design?.slope ?? program.site.slope ?? 0} onChange={(e) => onChange({ ...program, design: { ...(program.design ?? {}), slope: Math.max(-30, Math.min(30, Number(e.target.value) || 0)) } })} />
        </label>
      </div>
      <div className="muted small">Paket çatıyı, malzemeleri, renkleri, pencere biçimini{apartment ? "" : ", kütle biçimini"} ve cephe ayrıntılarını birlikte ayarlar; odalar değişmez. Ayrıntılar 3D modelde görünür.</div>
    </section>
  );
}

/** Üç plan alternatifi: küçük önizleme + puan; tıklanınca seçilir. */
export function VariantPicker({ program, onChange }: { program: Program; onChange: (p: Program) => void }) {
  const variants = useMemo(() => allVariants(program), [program.floors, program.adjacencies, program.footprint, program.floorHeight, program.massing, program.design?.massing, program.roof]);
  const current = program.design?.variant ?? 0;
  const edited = !!(program.design?.cols && Object.keys(program.design.cols).length) || program.design?.frontDepth != null;
  const best = Math.max(...variants.map((v) => v.score.score));
  return (
    <section className="variants">
      {variants.map((v) => (
        <button
          key={v.id}
          className={`variant ${current === v.id ? "active" : ""}`}
          onClick={() => current !== v.id && onChange({ ...program, design: { variant: v.id, massing: program.design?.massing } })}
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

/** Kütle biçimi: konsol, kademeli teras, köşe oyuğu. Claude'un önerisi varsayılan; mimar açıp kapatabilir. */
export function MassingPicker({ program, layout, onChange }: { program: Program; layout: BuildingLayout; onChange: (p: Program) => void }) {
  const spec = effectiveMassing(program);
  const base = program.design?.massing ?? program.massing ?? { features: [], cantilever: 1.5, terraceDepth: 2.6, notchDepth: 2.6, rationale: "" };
  const set = (patch: Partial<typeof base>) =>
    onChange({ ...program, design: { ...(program.design ?? {}), cols: undefined, frontDepth: undefined, massing: { ...base, ...patch } } });
  const toggle = (f: MassFeature) => set({ features: spec.features.includes(f) ? spec.features.filter((x) => x !== f) : [...spec.features, f] });
  const applied = layout.massing?.features ?? [];
  const needsFlat = (f: MassFeature) => (f === "ust_kat_teras" || f === "kose_oyugu") && program.roof !== "duz";
  return (
    <section className="card">
      <h3>Kütle biçimi</h3>
      <div className="massing-list">
        {MASS_FEATURES.map((f) => (
          <label key={f} className="massing-item" title={MASS_LABELS[f].hint}>
            <input type="checkbox" checked={spec.features.includes(f)} onChange={() => toggle(f)} />{" "}
            <b>{MASS_LABELS[f].name}</b>
            {spec.features.includes(f) && (applied.includes(f) ? <span className="pill ok">uygulandı</span> : <span className="pill no">uygulanamadı</span>)}
            {needsFlat(f) && <span className="muted small"> · düz çatı ister</span>}
            <div className="muted small">{MASS_LABELS[f].hint}</div>
          </label>
        ))}
      </div>
      <div className="massing-nums">
        <label>Konsol (m) <input type="number" step={0.1} min={1} max={3} value={base.cantilever} onChange={(e) => set({ cantilever: +e.target.value })} /></label>
        <label>Teras genişliği (m) <input type="number" step={0.1} min={1.8} max={4.5} value={base.terraceDepth} onChange={(e) => set({ terraceDepth: +e.target.value })} /></label>
        <label>Avlu genişliği (m) <input type="number" step={0.1} min={1.8} max={4.5} value={base.notchDepth} onChange={(e) => set({ notchDepth: +e.target.value })} /></label>
        {program.roof !== "duz" && <button className="btn ghost small" onClick={() => onChange({ ...program, roof: "duz" })}>Çatıyı düz yap</button>}
      </div>
      {base.rationale && <div className="muted small">Öneri gerekçesi: {base.rationale}</div>}
      {(layout.massing?.notes ?? []).map((n, i) => <div key={i} className="muted small">⚠ {n}</div>)}
      <div className="muted small">Kapalı çıkma yönetmelikte en fazla 1,50 m, çıkma altı en az 2,40 m (PAİY md. 41). Konsollar statik projede kiriş/perde ile çözülmelidir.</div>
    </section>
  );
}
