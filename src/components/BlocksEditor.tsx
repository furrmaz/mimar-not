// Çok bloklu / apartman projesi düzenleyicisi: bloklar, kat başına daireler, daire tipleri.
import type { Block, Program, Room, UnitType } from "../shared/schema";
import { RoomType } from "../shared/schema";
import { blockTypeKey, unitCounts } from "../geometry/blocks";
import { NumField, TYPE_LABELS } from "./ProgramEditor";

export function BlocksEditor({ program, blockIndex, onChange }: { program: Program; blockIndex: number; onChange: (p: Program) => void }) {
  const blocks = program.blocks ?? [];
  const types = program.unitTypes ?? [];
  const set = (patch: Partial<Program>) => onChange({ ...program, ...patch });
  // Seçili bloğun tanımını taşıyan blok (sameAs zinciri)
  const srcName = blockTypeKey(program, blockIndex);
  const si = Math.max(0, blocks.findIndex((b) => b.name === srcName));
  const src = blocks[si];
  const setBlock = (i: number, patch: Partial<Block>) => set({ blocks: blocks.map((b, k) => (k === i ? { ...b, ...patch } : b)) });
  const setFloor = (fi: number, patch: Partial<Block["floors"][number]>) => setBlock(si, { floors: src.floors.map((f, k) => (k === fi ? { ...f, ...patch } : f)) });
  const setType = (ti: number, patch: Partial<UnitType>) => set({ unitTypes: types.map((t, k) => (k === ti ? { ...t, ...patch } : t)) });
  const setTypeRoom = (ti: number, ri: number, patch: Partial<Room & { upper: boolean }>) =>
    setType(ti, { rooms: types[ti].rooms.map((r, k) => (k === ri ? { ...r, ...patch } : r)) });
  const counts = unitCounts(program);
  const totalUnits = counts.reduce((s, c) => s + c.count, 0);

  return (
    <div className="program">
      <section className="card summary">
        <div className="row-between">
          <div>
            <input className="title-input" value={program.projectName} onChange={(e) => set({ projectName: e.target.value })} />
            <div className="muted">{program.buildingType} · {program.clientName || "Müşteri adı yok"}</div>
          </div>
          <div className="stats">
            <div><b>{blocks.length}</b><span>blok</span></div>
            <div><b>{totalUnits}</b><span>daire</span></div>
            <div><b>{types.length}</b><span>daire tipi</span></div>
          </div>
        </div>
        <p>{program.summary}</p>
        <div className="muted small">Üslup: {program.style} · Yön: {program.site.orientation}</div>
      </section>

      <section className="card">
        <h3>Kütle ve arsa</h3>
        <div className="grid-fields">
          <NumField label={`${src?.name ?? "Blok"} oturum genişliği (m)`} value={src?.footprint.width ?? 20} onChange={(v) => setBlock(si, { footprint: { ...src.footprint, width: v } })} />
          <NumField label={`${src?.name ?? "Blok"} oturum derinliği (m)`} value={src?.footprint.depth ?? 15} onChange={(v) => setBlock(si, { footprint: { ...src.footprint, depth: v } })} />
          <NumField label="Kat yüksekliği (m)" value={program.floorHeight} step={0.05} onChange={(v) => set({ floorHeight: v })} />
          <label className="field">
            <span>Çatı</span>
            <select value={program.roof} onChange={(e) => set({ roof: e.target.value as Program["roof"] })}>
              <option value="duz">Düz çatı / teras</option>
              <option value="besik">Beşik çatı</option>
              <option value="kirma">Kırma çatı</option>
            </select>
          </label>
          <NumField label="Arsa genişliği (m)" value={program.site.width} onChange={(v) => set({ site: { ...program.site, width: v } })} />
          <NumField label="Arsa derinliği (m)" value={program.site.depth} onChange={(v) => set({ site: { ...program.site, depth: v } })} />
          <NumField label="Bloklar arası en az (m)" value={program.blockSpacing ?? 6} step={0.5} onChange={(v) => set({ blockSpacing: v })} />
        </div>
        <div className="muted small">Aynı tipteki bloklar ({blocks.filter((_, i) => blockTypeKey(program, i) === srcName).map((b) => b.name).join(", ")}) birlikte değişir. Bloklar arsaya otomatik yerleşir; vaziyet planı İmar sekmesinde.</div>
      </section>

      <section className="card">
        <h3>Bloklar</h3>
        <table className="rooms">
          <thead><tr><th>Blok</th><th>Tip</th><th /></tr></thead>
          <tbody>
            {blocks.map((b, i) => (
              <tr key={i}>
                <td><input value={b.name} onChange={(e) => setBlock(i, { name: e.target.value })} /></td>
                <td>
                  <select value={b.floors.length ? "" : b.sameAs} onChange={(e) => setBlock(i, e.target.value ? { sameAs: e.target.value, floors: [] } : { sameAs: "", floors: structuredClone(blocks.find((x) => x.name === blockTypeKey(program, i))?.floors ?? []) })}>
                    <option value="">Kendi kat düzeni</option>
                    {blocks.filter((x, k) => k !== i && x.floors.length).map((x) => <option key={x.name} value={x.name}>{x.name} ile aynı</option>)}
                  </select>
                </td>
                <td><button className="icon" title="Bloğu sil" disabled={blocks.length <= 1 || b.floors.length > 0 && blocks.some((x) => x.sameAs === b.name && !x.floors.length)} onClick={() => set({ blocks: blocks.filter((_, k) => k !== i) })}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn ghost small" onClick={() => set({ blocks: [...blocks, { name: `${String.fromCharCode(65 + blocks.length)} Blok`, sameAs: src?.name ?? "", footprint: { ...(src?.footprint ?? { width: 20, depth: 15 }) }, floors: [] }] })}>+ Blok ekle</button>
      </section>

      {src && (
        <section className="card">
          <h3>{src.name} kat düzeni</h3>
          <table className="rooms">
            <thead><tr><th>Kat</th><th>Daireler</th><th>Ortak mekânlar</th></tr></thead>
            <tbody>
              {src.floors.map((f, fi) => (
                <tr key={fi}>
                  <td><input value={f.name} onChange={(e) => setFloor(fi, { name: e.target.value })} /></td>
                  <td>
                    <div className="unit-chips">
                      {f.units.map((u, ui) => (
                        <span className="unit-chip" key={ui}>
                          <select value={u} onChange={(e) => setFloor(fi, { units: f.units.map((x, k) => (k === ui ? e.target.value : x)) })}>
                            {types.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
                            {!types.some((t) => t.name === u) && <option value={u}>{u}</option>}
                          </select>
                          <button className="icon" title="Daireyi kaldır" onClick={() => setFloor(fi, { units: f.units.filter((_, k) => k !== ui) })}>×</button>
                        </span>
                      ))}
                      {types.length > 0 && <button className="btn ghost small" onClick={() => setFloor(fi, { units: [...f.units, types[0].name] })}>+ Daire</button>}
                    </div>
                  </td>
                  <td className="muted small">{f.rooms.map((r) => `${r.name} ${r.area} m²`).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn ghost small" onClick={() => {
            const top = src.floors[src.floors.length - 1];
            setBlock(si, { floors: [...src.floors, { level: (top?.level ?? -1) + 1, name: `${(top?.level ?? -1) + 1}. Kat`, units: [...(top?.units ?? [])], rooms: [] }] });
          }}>+ Kat ekle</button>
          {src.floors.length > 1 && <button className="btn ghost small" onClick={() => setBlock(si, { floors: src.floors.slice(0, -1) })}>En üst katı sil</button>}
        </section>
      )}

      <h3 style={{ margin: "18px 4px 8px" }}>Daire tipleri</h3>
      {types.map((t, ti) => {
        const c = counts.find((x) => x.type === t.name);
        const net = t.rooms.filter((r) => r.zone !== "dis" && r.type !== "balkon" && r.type !== "teras").reduce((s, r) => s + r.area, 0);
        return (
          <section className="card" key={ti}>
            <div className="row-between">
              <input className="floor-input" value={t.name} onChange={(e) => {
                const old = t.name, nn = e.target.value;
                set({
                  unitTypes: types.map((x, k) => (k === ti ? { ...x, name: nn } : x)),
                  blocks: blocks.map((b) => ({ ...b, floors: b.floors.map((f) => ({ ...f, units: f.units.map((u) => (u === old ? nn : u)) })) })),
                });
              }} />
              <div className="row">
                <span className="muted small">{net.toFixed(0)} m² net · {c?.count ?? 0} adet</span>
                <label className="check small"><input type="checkbox" checked={t.duplex} onChange={(e) => setType(ti, { duplex: e.target.checked })} /> Dubleks</label>
              </div>
            </div>
            <table className="rooms">
              <thead><tr><th>Mekân</th><th>Tip</th><th className="num">m²</th>{t.duplex && <th>Üst kat</th>}<th /></tr></thead>
              <tbody>
                {t.rooms.map((r, ri) => (
                  <tr key={ri}>
                    <td><input value={r.name} onChange={(e) => setTypeRoom(ti, ri, { name: e.target.value })} /></td>
                    <td>
                      <select value={r.type} onChange={(e) => {
                        const type = e.target.value as Room["type"];
                        const zone: Room["zone"] = ["balkon", "teras"].includes(type) ? "dis" : ["hol", "antre", "koridor"].includes(type) ? "sirkulasyon" : ["salon", "mutfak", "yemek", "calisma"].includes(type) ? "gunduz" : ["wc", "depo", "kiler", "camasir", "teknik"].includes(type) ? "servis" : "gece";
                        setTypeRoom(ti, ri, { type, zone });
                      }}>
                        {RoomType.options.map((x) => <option key={x} value={x}>{TYPE_LABELS[x]}</option>)}
                      </select>
                    </td>
                    <td className="num"><input type="number" step={0.5} min={1} value={r.area} onChange={(e) => setTypeRoom(ti, ri, { area: Math.max(1, Number(e.target.value) || 1) })} /></td>
                    {t.duplex && <td><input type="checkbox" checked={r.upper} onChange={(e) => setTypeRoom(ti, ri, { upper: e.target.checked })} /></td>}
                    <td><button className="icon" title="Sil" onClick={() => setType(ti, { rooms: t.rooms.filter((_, k) => k !== ri) })}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="btn ghost small" onClick={() => setType(ti, { rooms: [...t.rooms, { name: "Yeni Oda", type: "yatak", zone: "gece", area: 11, note: "", upper: false }] })}>+ Mekân ekle</button>
          </section>
        );
      })}
      <button className="btn ghost" onClick={() => set({ unitTypes: [...types, { name: `Yeni Tip ${types.length + 1}`, duplex: false, rooms: [{ name: "Antre", type: "antre", zone: "sirkulasyon", area: 5, note: "", upper: false }, { name: "Salon", type: "salon", zone: "gunduz", area: 24, note: "", upper: false }, { name: "Mutfak", type: "mutfak", zone: "gunduz", area: 9, note: "", upper: false }, { name: "Yatak Odası", type: "yatak", zone: "gece", area: 12, note: "", upper: false }, { name: "Banyo", type: "banyo", zone: "gece", area: 5, note: "", upper: false }, { name: "Hol", type: "hol", zone: "sirkulasyon", area: 5, note: "", upper: false }] }] })}>+ Daire tipi ekle</button>

      <div className="two-col" style={{ marginTop: 14 }}>
        <section className="card">
          <h3>Varsayımlar</h3>
          <ul>{program.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </section>
        <section className="card questions">
          <h3>Müşteriye sorulacaklar</h3>
          <ul>{program.openQuestions.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </section>
      </div>
    </div>
  );
}
