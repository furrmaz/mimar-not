import type { Program, Room } from "../shared/schema";
import { RoomType, Zone } from "../shared/schema";
import type { BuildingLayout } from "../geometry/layout";

const TYPE_LABELS: Record<string, string> = {
  salon: "Salon", mutfak: "Mutfak", yemek: "Yemek", yatak: "Yatak", ebeveyn: "Ebeveyn", cocuk: "Çocuk", banyo: "Banyo", wc: "WC",
  hol: "Hol", antre: "Antre", koridor: "Koridor", calisma: "Çalışma", misafir: "Misafir", depo: "Depo", kiler: "Kiler",
  camasir: "Çamaşır", giyinme: "Giyinme", garaj: "Garaj", teknik: "Teknik", ofis: "Ofis", magaza: "Mağaza", balkon: "Balkon",
  teras: "Teras", diger: "Diğer",
};
const ZONE_LABELS: Record<string, string> = { gunduz: "Gündüz", gece: "Gece", servis: "Servis", sirkulasyon: "Sirkülasyon", dis: "Dış" };

export function ProgramEditor({ program, layout, onChange }: { program: Program; layout: BuildingLayout; onChange: (p: Program) => void }) {
  const set = (patch: Partial<Program>) => onChange({ ...program, ...patch });
  const setRoom = (fi: number, ri: number, patch: Partial<Room>) => {
    const floors = program.floors.map((f, i) =>
      i !== fi ? f : { ...f, rooms: f.rooms.map((r, j) => (j === ri ? { ...r, ...patch } : r)) },
    );
    set({ floors });
  };
  const removeRoom = (fi: number, ri: number) =>
    set({ floors: program.floors.map((f, i) => (i !== fi ? f : { ...f, rooms: f.rooms.filter((_, j) => j !== ri) })) });
  const addRoom = (fi: number) =>
    set({
      floors: program.floors.map((f, i) =>
        i !== fi ? f : { ...f, rooms: [...f.rooms, { name: "Yeni Oda", type: "yatak", zone: "gece", area: 12, note: "" }] },
      ),
    });
  const addFloor = () => {
    const top = program.floors[program.floors.length - 1]?.level ?? -1;
    set({ floors: [...program.floors, { level: top + 1, name: `${top + 1}. Kat`, rooms: [{ name: "Kat Holü", type: "hol", zone: "sirkulasyon", area: 8, note: "" }] }] });
  };
  const removeFloor = (fi: number) => {
    if (program.floors.length <= 1) return;
    if (!confirm(`${program.floors[fi].name} silinsin mi?`)) return;
    set({ floors: program.floors.filter((_, i) => i !== fi) });
  };

  const totalReq = program.floors.reduce((s, f) => s + f.rooms.filter((r) => r.zone !== "dis").reduce((a, r) => a + r.area, 0), 0);
  const gross = layout.floors.length * layout.W * layout.D;

  return (
    <div className="program">
      <section className="card summary">
        <div className="row-between">
          <div>
            <input className="title-input" value={program.projectName} onChange={(e) => set({ projectName: e.target.value })} />
            <div className="muted">{program.buildingType} · {program.clientName || "Müşteri adı yok"}</div>
          </div>
          <div className="stats">
            <div><b>{totalReq.toFixed(0)} m²</b><span>istenen net</span></div>
            <div><b>{gross.toFixed(0)} m²</b><span>brüt (oturum × kat)</span></div>
            <div><b>{program.floors.length}</b><span>kat</span></div>
          </div>
        </div>
        <p>{program.summary}</p>
        <div className="muted small">Üslup: {program.style} · Yön: {program.site.orientation}</div>
      </section>

      <section className="card">
        <h3>Kütle</h3>
        <div className="grid-fields">
          <NumField label="Oturum genişliği (m)" value={program.footprint.width} onChange={(v) => set({ footprint: { ...program.footprint, width: v } })} />
          <NumField label="Oturum derinliği (m)" value={program.footprint.depth} onChange={(v) => set({ footprint: { ...program.footprint, depth: v } })} />
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
        </div>
        <div className="muted small">Çizimler bu değerlerden anında yeniden üretilir. Oda alanları oturuma orantılı ölçeklenir.</div>
      </section>

      {program.floors.map((f, fi) => {
        const lf = layout.floors[fi];
        return (
          <section className="card" key={fi}>
            <div className="row-between">
              <input className="floor-input" value={f.name} onChange={(e) => set({ floors: program.floors.map((x, i) => (i === fi ? { ...x, name: e.target.value } : x)) })} />
              <div className="row">
                <span className="muted small">Kot {(f.level * program.floorHeight).toFixed(2)}</span>
                <button className="btn ghost small" onClick={() => removeFloor(fi)} disabled={program.floors.length <= 1}>Katı sil</button>
              </div>
            </div>
            <table className="rooms">
              <thead>
                <tr><th>Mekân</th><th>Tip</th><th>Bölge</th><th className="num">İstenen m²</th><th className="num">Planda m²</th><th>Not</th><th /></tr>
              </thead>
              <tbody>
                {f.rooms.map((r, ri) => {
                  const placed = lf?.rooms.find((p) => p.name === r.name && p.type === r.type);
                  const outdoor = lf?.outdoor.find((o) => o.name === r.name);
                  const planArea = placed ? placed.rect.w * placed.rect.h : outdoor ? outdoor.area : null;
                  const diff = planArea != null ? (planArea - r.area) / r.area : 0;
                  return (
                    <tr key={ri}>
                      <td><input value={r.name} onChange={(e) => setRoom(fi, ri, { name: e.target.value })} /></td>
                      <td>
                        <select value={r.type} onChange={(e) => setRoom(fi, ri, { type: e.target.value as Room["type"] })}>
                          {RoomType.options.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={r.zone} onChange={(e) => setRoom(fi, ri, { zone: e.target.value as Room["zone"] })}>
                          {Zone.options.map((z) => <option key={z} value={z}>{ZONE_LABELS[z]}</option>)}
                        </select>
                      </td>
                      <td className="num"><input type="number" step={0.5} min={1} value={r.area} onChange={(e) => setRoom(fi, ri, { area: Math.max(1, Number(e.target.value) || 1) })} /></td>
                      <td className={`num ${Math.abs(diff) > 0.25 ? "warn" : ""}`}>{planArea != null ? planArea.toFixed(1) : "—"}</td>
                      <td><input className="note" value={r.note} placeholder="—" onChange={(e) => setRoom(fi, ri, { note: e.target.value })} /></td>
                      <td><button className="icon" title="Sil" onClick={() => removeRoom(fi, ri)}>×</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button className="btn ghost small" onClick={() => addRoom(fi)}>+ Mekân ekle</button>
          </section>
        );
      })}
      <button className="btn ghost" onClick={addFloor}>+ Kat ekle</button>

      <div className="two-col">
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

function NumField({ label, value, onChange, step = 0.1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" step={step} value={value} onChange={(e) => { const v = Number(e.target.value); if (v > 0) onChange(v); }} />
    </label>
  );
}
