import { useState } from "react";
import type { Program } from "../shared/schema";
import type { BuildingLayout } from "../geometry/layout";
import { areaTable, roomChecks } from "../geometry/roomcheck";
import { isMultiBlock, unitCounts } from "../geometry/blocks";
import { zoningCheck } from "../geometry/zoning";

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
  const multi = isMultiBlock(program);
  const units = multi ? unitCounts(program) : [];
  const site = multi ? (zoningCheck(program, layout).blocks ?? []).map((b) => ({ name: b.name, ...areaTable(b.L).total })) : [];
  const siteTotal = site.reduce((t, b) => ({ gross: t.gross + b.gross, outdoor: t.outdoor + b.outdoor, net: t.net + b.net }), { gross: 0, outdoor: 0, net: 0 });
  const costArea = multi ? siteTotal.gross + siteTotal.outdoor * 0.5 : total.gross + total.outdoor * 0.5;
  const setU = (v: number) => {
    setUnit(v);
    try { localStorage.setItem(COST_KEY, String(v)); } catch { /* yok say */ }
  };
  return (
    <div>
      {multi && (
        <section className="card">
          <h3>Daire listesi · {units.reduce((s, u) => s + u.count, 0)} daire</h3>
          <table>
            <thead><tr><th>Daire tipi</th><th className="num">Adet</th><th className="num">Net alan (m²)</th><th className="num">Balkon / teras (m²)</th><th>Bloklar</th></tr></thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.type}><td>{u.type}</td><td className="num">{u.count}</td><td className="num">{m2(u.area)}</td><td className="num">{m2(u.outdoor)}</td><td>{[...u.blocks].join(", ")}</td></tr>
              ))}
            </tbody>
          </table>
          <h3 style={{ marginTop: 16 }}>Site toplamı</h3>
          <table>
            <thead><tr><th>Blok</th><th className="num">Net alan (m²)</th><th className="num">Brüt alan (m²)</th><th className="num">Balkon / teras (m²)</th></tr></thead>
            <tbody>
              {site.map((b) => <tr key={b.name}><td>{b.name}</td><td className="num">{m2(b.net)}</td><td className="num">{m2(b.gross)}</td><td className="num">{m2(b.outdoor)}</td></tr>)}
              <tr style={{ fontWeight: 600 }}><td>Toplam</td><td className="num">{m2(siteTotal.net)}</td><td className="num">{m2(siteTotal.gross)}</td><td className="num">{m2(siteTotal.outdoor)}</td></tr>
            </tbody>
          </table>
          <div className="muted small">Daire net alanı, daire tipindeki odaların program alanlarının toplamıdır. Aşağıdaki kat tablosu seçili bloğa aittir; maliyet tüm siteyi kapsar.</div>
        </section>
      )}
      <section className="card">
        <h3>Alan tablosu{multi ? ` · ${program.blocks![program.blockIndex ?? 0]?.name}` : ""}</h3>
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
        <div className="muted small">Net alan duvar akslarından ölçülen mahal alanlarının toplamıdır (hol ve merdiven dahil). Brüt alan dış duvar dış yüzünden ölçülür. {multi ? "" : "Müşterinin istediği toplam: "}{multi ? "" : m2(program.floors.reduce((s, f) => s + f.rooms.reduce((t, r) => t + r.area, 0), 0)) + " m² net."}</div>
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
