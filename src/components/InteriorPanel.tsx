// İç mekân paneli: ergonomi / dolaşım denetimi, aydınlatma ön hesabı ve mobilya listesi (seçili kat).
import { useMemo, useState } from "react";
import type { FloorLayout } from "../geometry/layout";
import type { Furniture } from "../geometry/furniture";
import { furnitureCounts, interiorChecks, lightingPlan } from "../geometry/interior";

type Tab = "denetim" | "isik" | "liste";
const nf = (v: number, d = 0) => v.toLocaleString("tr-TR", { maximumFractionDigits: d, minimumFractionDigits: d });

export function InteriorPanel({ floor, items, onPick, onClose }: { floor: FloorLayout; items: Furniture[]; onPick: (itemId: string | undefined) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("denetim");
  const issues = useMemo(() => interiorChecks(floor, items), [floor, items]);
  const light = useMemo(() => lightingPlan(floor, items), [floor, items]);
  const counts = useMemo(() => furnitureCounts(items), [items]);
  const warn = issues.filter((i) => i.level === "uyari").length;
  const total = light.rows.reduce((s, r) => ({ lm: s.lm + r.lumens, w: s.w + r.watts, n: s.n + r.spots }), { lm: 0, w: 0, n: 0 });
  return (
    <div className="interior-panel" role="dialog" aria-label="İç mekân denetimi">
      <div className="ip-head">
        <div className="seg small" role="tablist">
          <button role="tab" aria-selected={tab === "denetim"} className={`seg-btn ${tab === "denetim" ? "on" : ""}`} onClick={() => setTab("denetim")}>
            Denetim {issues.length ? <span className={`badge ip-count ${warn ? "warn" : ""}`}>{issues.length}</span> : "✓"}
          </button>
          <button role="tab" aria-selected={tab === "isik"} className={`seg-btn ${tab === "isik" ? "on" : ""}`} onClick={() => setTab("isik")}>Aydınlatma</button>
          <button role="tab" aria-selected={tab === "liste"} className={`seg-btn ${tab === "liste" ? "on" : ""}`} onClick={() => setTab("liste")}>Mobilya listesi</button>
        </div>
        <button className="btn ghost small" onClick={onClose} aria-label="Paneli kapat">✕</button>
      </div>
      <div className="ip-body">
        {tab === "denetim" && (
          issues.length === 0 ? (
            <p className="muted small">Bu kattaki yerleşim ergonomi ölçülerine uyuyor: kapak ve kapı önleri, yatak yanları, sandalye arkaları, tezgâh ve klozet önleri yeterli.</p>
          ) : (
            <ul className="ip-list">
              {issues.map((i, k) => (
                <li key={k} className={i.level}>
                  <button className="linkish" onClick={() => onPick(i.itemId)} disabled={!i.itemId} title={i.itemId ? "Mobilyayı seç" : undefined}>
                    <span className="ip-tag">{i.level === "uyari" ? "Uyarı" : "Öneri"}</span>
                    <b>{i.room}:</b> {i.message}
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
        {tab === "isik" && (
          <>
            <p className="muted small">Genel aydınlatma ön hesabı (EN 12464-1 konut değerleri, kullanım × bakım faktörü 0,55, 700 lm / 7 W LED spot). Gezintide armatürler tavanda görünür.</p>
            <table className="ip-table">
              <thead><tr><th>Mahal</th><th>m²</th><th>lx</th><th>lm</th><th>Spot</th><th>K</th></tr></thead>
              <tbody>
                {light.rows.map((r) => (
                  <tr key={r.roomId} title={r.task}>
                    <td>{r.room}{r.task && <div className="muted tiny">{r.task}</div>}</td>
                    <td>{nf(r.area, 1)}</td><td>{r.lux}</td><td>{nf(r.lumens)}</td><td>{r.spots}</td><td className="nowrap">{r.cct}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td>Toplam</td><td /><td /><td>{nf(total.lm)}</td><td>{total.n}</td><td className="nowrap">≈ {total.w} W</td></tr></tfoot>
            </table>
          </>
        )}
        {tab === "liste" && (
          counts.length ? (
            <table className="ip-table">
              <thead><tr><th>Mobilya / donatı</th><th>Adet</th></tr></thead>
              <tbody>{counts.map((c) => <tr key={c.kind}><td>{c.label}</td><td>{c.count}</td></tr>)}</tbody>
            </table>
          ) : <p className="muted small">Bu katta mobilya yok.</p>
        )}
      </div>
    </div>
  );
}
