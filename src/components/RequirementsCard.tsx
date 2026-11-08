import { useMemo, useState } from "react";
import type { Program, Requirement } from "../shared/schema";
import type { Brief } from "../brief";
import { isMultiBlock, unitCounts } from "../geometry/blocks";

const SRC: Record<Requirement["source"], string> = { not: "Not", form: "Form", gorsel: "Görsel", yonetmelik: "Yönetmelik" };
const ST: Record<Requirement["status"], { icon: string; cls: string; label: string }> = {
  karsilandi: { icon: "✓", cls: "ok", label: "Karşılandı" },
  kismen: { icon: "◐", cls: "part", label: "Kısmen" },
  karsilanmadi: { icon: "✕", cls: "no", label: "Karşılanmadı" },
};

/** Uygulamanın kendi doğruladığı form değerleri (Claude'un beyanına güvenmeden). */
export function briefChecks(p: Program, b: Brief | undefined): Requirement[] {
  if (!b) return [];
  const out: Requirement[] = [];
  const multi = isMultiBlock(p);
  if (b.floors) {
    const levels = multi
      ? Math.max(0, ...(p.blocks ?? []).map((bl) => bl.floors.filter((f) => f.level >= 0).length))
      : p.floors.filter((f) => f.level >= 0).length;
    const dup = multi && (p.unitTypes ?? []).some((u) => u.duplex) ? " (dubleks üst katlar hariç)" : "";
    out.push({ text: `Kat sayısı ${b.floors}`, source: "form", status: levels === b.floors ? "karsilandi" : "karsilanmadi", how: `Programda ${levels} kat${dup}.` });
  }
  if (b.blockCount) {
    const n = p.blocks?.length ?? 0;
    out.push({ text: `${b.blockCount} blok`, source: "form", status: n === b.blockCount ? "karsilandi" : "karsilanmadi", how: `Programda ${n} blok.` });
  }
  if (b.unitsPerFloor && multi) {
    const counts = (p.blocks ?? []).flatMap((bl) => bl.floors.filter((f) => f.level >= 1).map((f) => f.units.length));
    const ok = counts.length > 0 && counts.every((c) => c === b.unitsPerFloor);
    out.push({ text: `Normal katta ${b.unitsPerFloor} daire`, source: "form", status: ok ? "karsilandi" : counts.some((c) => c === b.unitsPerFloor) ? "kismen" : "karsilanmadi", how: counts.length ? `Normal katlarda ${[...new Set(counts)].join(" / ")} daire.` : "Normal kat yok." });
  }
  if (b.roof) out.push({ text: `Çatı: ${b.roof === "duz" ? "düz" : b.roof === "besik" ? "beşik" : "kırma"}`, source: "form", status: p.roof === b.roof ? "karsilandi" : "karsilanmadi", how: "" });
  return out;
}

/** Notlardaki her isteğin programda karşılanıp karşılanmadığı; karşılanmayanlar tek tuşla Claude'a düzelttirilir. */
export function RequirementsCard({ program, brief, busy, onFix }: { program: Program; brief?: Brief; busy: boolean; onFix: (text: string) => void }) {
  const [open, setOpen] = useState(true);
  const items = useMemo(() => [...briefChecks(program, brief), ...(program.requirements ?? [])], [program, brief]);
  const readings = program.imageReadings ?? [];
  if (!items.length && !readings.length) {
    return (
      <section className="card req-card">
        <h3>İstek kontrol listesi</h3>
        <p className="muted small">Bu proje eski bir sürümle üretilmiş; istek listesi yok. "Notlarla güncelle" ile Claude her isteği tek tek kontrol eder.</p>
      </section>
    );
  }
  const miss = items.filter((r) => r.status !== "karsilandi");
  const done = items.length - miss.length;
  const units = isMultiBlock(program) ? unitCounts(program).reduce((s, u) => s + u.count, 0) : 0;
  const fixText = () =>
    `Aşağıdaki istekler programda karşılanmadı ya da kısmen karşılandı. Hepsini eksiksiz karşılayacak şekilde programı düzelt; gerekirse alanları, kat dağılımını ya da oturumu değiştir. Gerçekten mümkün değilse nedenini "how" alanına yaz.\n${miss.map((r) => `- ${r.text}${r.how ? ` (şu an: ${r.how})` : ""}`).join("\n")}`;
  return (
    <section className={`card req-card ${miss.length ? "bad" : "good"}`}>
      <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>
          İstek kontrol listesi <span className="muted small">{done}/{items.length} karşılandı{units ? ` · ${units} daire` : ""}</span>
        </h3>
        <div className="row" style={{ gap: 8 }}>
          {miss.length > 0 && <button className="btn small primary" disabled={busy} onClick={() => onFix(fixText())}>{busy ? "Claude düzeltiyor…" : `Eksikleri tamamla (${miss.length})`}</button>}
          <button className="link small" onClick={() => setOpen(!open)}>{open ? "Gizle" : "Göster"}</button>
        </div>
      </div>
      {open && (
        <>
          <ul className="req-list">
            {[...miss, ...items.filter((r) => r.status === "karsilandi")].map((r, i) => (
              <li key={i} className={ST[r.status].cls}>
                <span className="req-ic" title={ST[r.status].label}>{ST[r.status].icon}</span>
                <span className="req-t">{r.text}{r.how && <span className="muted small"> · {r.how}</span>}</span>
                <span className="req-src">{SRC[r.source] ?? r.source}</span>
              </li>
            ))}
          </ul>
          {readings.length > 0 && (
            <div className="img-read">
              <b className="small">Görsellerden okunanlar</b>
              <ol className="small">{readings.map((t, i) => <li key={i}>{t}</li>)}</ol>
            </div>
          )}
        </>
      )}
    </section>
  );
}
