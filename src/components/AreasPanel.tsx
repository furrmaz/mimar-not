import { useState } from "react";
import type { Program } from "../shared/schema";
import type { BuildingLayout } from "../geometry/layout";
import { areaTable, roomChecks } from "../geometry/roomcheck";

const COST_KEY = "mimar-not.unitCost";
const tl = (v: number) => v.toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " ₺";
const m2 = (v: number) => v.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function readCost() {
  try {
    const v = Number(localStorage.getItem(COST_KEY));
    return v > 0 ? v : 25000;
  } catch {
    return 25000;
  }
}

export function AreasPanel({ program, layout }: { program: Program; layout: BuildingLayout }) {
  const [unit, setUnit] = useState(readCost);
  const { rows, total } = areaTable(layout);
  const issues = roomChecks(layout);
  const hard = issues.filter((i) => !i.soft);
  const soft = issues.filter((i) => i.soft);
  const costArea = total.gross + total.outdoor * 0.5;
  const setU = (v: number) => {
    setUnit(v);
    try { localStorage.setItem(COST_KEY, String(v)); } catch { /* yok say */ }
  };
  return (
    <div>
      <section className="card">
        <h3>Alan tablosu</h3>
        <table>
          <thead><tr><th>Kat</th><th className="num">Mahal</th><th className="num">Net alan (m²)</th><th className="num">Brüt alan (m²)</th><th className="num">Balkon / teras (m²)</th></tr></thead>
          <tbody>
            {[...rows, total].map((r) => (
              <tr key={r.floor} style={r === total ? { fontWeight: 600 } : undefined}>
                <td>{r.floor}</td><td className="num">{r.rooms}</td><td className="num">{m2(r.net)}</td><td className="num">{m2(r.gross)}</td><td className="num">{m2(r.outdoor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="muted small">Net alan duvar akslarından ölçülen mahal alanlarının toplamıdır (hol ve merdiven dahil). Brüt alan dış duvar dış yüzünden ölçülür. Müşterinin istediği toplam: {m2(program.floors.reduce((s, f) => s + f.rooms.reduce((t, r) => t + r.area, 0), 0))} m² net.</div>
      </section>

      <section className="card">
        <h3>Yaklaşık yapı maliyeti</h3>
        <div className="row" style={{ flexWrap: "wrap", gap: 18 }}>
          <label className="field" style={{ width: 200 }}>
            <span>Birim maliyet (₺ / brüt m²)</span>
            <input type="number" step={500} value={unit} onChange={(e) => setU(Number(e.target.value) || 0)} />
          </label>
          <div className="stats">
            <div><b>{m2(costArea)} m²</b><span>maliyete esas alan</span></div>
            <div><b>{tl(costArea * unit)}</b><span>yaklaşık yapı maliyeti</span></div>
          </div>
        </div>
        <div className="muted small">Balkon ve teraslar yarım alan sayılır. Arsa, proje, harç ve iç donanım dahil değildir. Birim maliyet örnek değerdir; Çevre, Şehircilik ve İklim Değişikliği Bakanlığı'nın yıllık yapı yaklaşık birim maliyetlerini ya da kendi m² fiyatınızı girin.</div>
      </section>

      <section className={`card ${hard.length ? "bad" : "good"}`}>
        <h3>{hard.length ? `Asgari ölçü uyarıları (${hard.length})` : "Mahaller asgari ölçüleri sağlıyor"}</h3>
        {hard.length > 0 && <IssueList items={hard} />}
        <div className="muted small">Planlı Alanlar İmar Yönetmeliği'ndeki konut asgari ölçüleri esas alınan ön kontroldür; yerel imar yönetmeliği farklı değer verebilir.</div>
      </section>
      {soft.length > 0 && (
        <section className="card questions">
          <h3>Programdan küçük kalan mahaller ({soft.length})</h3>
          <IssueList items={soft} />
          <div className="muted small">Oturum alanını büyütmek ya da mahal sayısını azaltmak için Program sekmesini kullanın.</div>
        </section>
      )}
    </div>
  );
}

export function IssueList({ items }: { items: { floor: string; room: string; message: string }[] }) {
  return (
    <ul style={{ margin: "0 0 8px", paddingLeft: 18, lineHeight: 1.6, fontSize: 14 }}>
      {items.map((i, k) => <li key={k}><b>{i.room}</b> <span className="muted">({i.floor})</span>: {i.message}</li>)}
    </ul>
  );
}
