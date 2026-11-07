import { useEffect, useMemo, useRef, useState } from "react";
import type { Program } from "./shared/schema";
import { buildLayout } from "./geometry/layout";
import { planSVG, sectionSVG, elevationSVG, sitePlanSVG, FACADE_NAMES, type Facade } from "./geometry/svg";
import { buildDXF, type DxfUnit } from "./geometry/dxf";
import { desktop } from "./desktop";
import { SettingsDialog } from "./components/SettingsDialog";
import { ProgramEditor } from "./components/ProgramEditor";
import { ZoningPanel } from "./components/ZoningPanel";
import { ThreeView } from "./components/ThreeView";
import { SvgSheet } from "./components/SvgSheet";
import { generateProgram, loadProjects, newProject, saveOutput, saveProjects, setCurrentProject, type Project } from "./store";
import { SAMPLE_NOTES, SAMPLE_PROGRAM } from "./sample";
import { useDictation } from "./useDictation";

/** Demo derlemesi (VITE_DEMO=1): API ve indirmeler olmadan, örnek projeyle açılır. */
const DEMO = import.meta.env.VITE_DEMO === "1";

type Tab = "program" | "plan" | "section" | "elevation" | "3d" | "zoning";
const TABS: { id: Tab; label: string }[] = [
  { id: "program", label: "Program" },
  { id: "plan", label: "Kat Planları" },
  { id: "section", label: "Kesit" },
  { id: "elevation", label: "Cepheler" },
  { id: "3d", label: "3D Model" },
  { id: "zoning", label: "İmar & Vaziyet" },
];

export default function App() {
  const [projects, setProjects] = useState<Project[]>(() => {
    const list = loadProjects();
    if (list.length) return list;
    if (DEMO) return [{ ...newProject(SAMPLE_PROGRAM.clientName), notes: SAMPLE_NOTES, program: structuredClone(SAMPLE_PROGRAM) }];
    return [newProject("İlk görüşme")];
  });
  const [activeId, setActiveId] = useState(projects[0].id);
  const [tab, setTab] = useState<Tab>(DEMO ? "plan" : "program");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [floorIdx, setFloorIdx] = useState(0);
  const [facade, setFacade] = useState<Facade>("front");
  const [apiInfo, setApiInfo] = useState<{ ok: boolean; hasKey: boolean; model?: string } | null>(null);
  const project = projects.find((p) => p.id === activeId) ?? projects[0];
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [dxfUnit, setDxfUnit] = useState<DxfUnit>(() => {
    try { return (localStorage.getItem("mimar-not.dxfUnit") as DxfUnit) || "cm"; } catch { return "cm"; }
  });
  useEffect(() => { try { localStorage.setItem("mimar-not.dxfUnit", dxfUnit); } catch { /* yoksay */ } }, [dxfUnit]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); } }, [toast]);

  useEffect(() => saveProjects(projects), [projects]);
  useEffect(() => {
    if (DEMO) return;
    refreshHealth();
  }, []);
  function refreshHealth() {
    fetch("api/health")
      .then((r) => r.json())
      .then((d) => {
        setApiInfo({ ok: true, hasKey: d.hasKey, model: d.model });
        if (desktop && !d.hasKey) setShowSettings(true);
      })
      .catch(() => setApiInfo({ ok: false, hasKey: false }));
  }

  const update = (patch: Partial<Project>) =>
    setProjects((list) => list.map((p) => (p.id === project.id ? { ...p, ...patch, updatedAt: Date.now() } : p)));

  const dictation = useDictation((text) => {
    setProjects((list) =>
      list.map((p) => (p.id === project.id ? { ...p, notes: (p.notes ? p.notes.trimEnd() + " " : "") + text, updatedAt: Date.now() } : p)),
    );
  });

  const program = project.program;
  useEffect(() => setCurrentProject(program?.projectName || project.title), [program?.projectName, project.title]);
  const layout = useMemo(() => (program ? buildLayout(program) : null), [program]);
  useEffect(() => {
    if (layout && floorIdx >= layout.floors.length) setFloorIdx(0);
  }, [layout, floorIdx]);

  const run = async (mode: "new" | "update") => {
    if (DEMO) {
      setError("Bu demo sürümünde Claude bağlantısı yok. Notları düzenleyip programı elle değiştirebilirsiniz; tam sürümde bu düğme notlardan yeni program üretir.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const p = await generateProgram(project.notes, mode === "update" ? program : null);
      update({ program: p, title: p.clientName || p.projectName || project.title });
      setTab("program");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loadSample = () => {
    update({ notes: SAMPLE_NOTES, program: structuredClone(SAMPLE_PROGRAM), title: SAMPLE_PROGRAM.clientName });
    setTab("plan");
  };

  const addProject = () => {
    const p = newProject(`Görüşme ${projects.length + 1}`);
    setProjects([p, ...projects]);
    setActiveId(p.id);
    setTab("program");
  };
  const deleteProject = () => {
    if (!confirm(`"${project.title}" silinsin mi?`)) return;
    const rest = projects.filter((p) => p.id !== project.id);
    const next = rest.length ? rest : [newProject()];
    setProjects(next);
    setActiveId(next[0].id);
  };

  const setProgram = (p: Program) => update({ program: p });

  const sendToAutoCAD = async () => {
    if (!program || !layout) return;
    const dxf = buildDXF(layout, program, dxfUnit);
    const name = `${program.projectName} - cizim seti`;
    if (desktop) {
      const r = await desktop.saveAndOpen(program.projectName, name, "dxf", dxf);
      setToast(r.ok ? `Kaydedildi ve açılıyor: ${r.path}` : r.error?.includes("yazılamadı") ? r.error : `Kaydedildi: ${r.path}. DXF dosyalarını açacak program bulunamadı; dosyayı AutoCAD'de elle açın.`);
    } else {
      await saveOutput(name, "dxf", dxf);
    }
  };
  const savePDF = async () => {
    if (!program) return;
    if (desktop) {
      const r = await desktop.savePDF(program.projectName, `${program.projectName} - cizim seti`);
      if (r.saved) setToast(`PDF kaydedildi: ${r.path}`);
    } else window.print();
  };

  return (
    <div className={`app ${DEMO ? "demo" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 21V9l9-6 9 6v12h-6v-7H9v7z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
          </span>
          Mimar Not
        </div>
        <div className="project-picker">
          <select value={project.id} onChange={(e) => setActiveId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
          <button className="btn ghost small" onClick={addProject}>+ Yeni görüşme</button>
          <button className="btn ghost small" onClick={deleteProject}>Sil</button>
        </div>
        {DEMO && <span className="badge">Demo · örnek proje, indirme ve sesli dikte tam sürümde</span>}
        {apiInfo && !apiInfo.ok && <span className="badge warn">API sunucusu yok · örnek proje ve elle düzenleme çalışır</span>}
        {apiInfo?.ok && !apiInfo.hasKey && (
          <button className="badge warn as-button" onClick={() => desktop && setShowSettings(true)}>
            {desktop ? "Claude API anahtarı girilmedi · Ayarlar" : "ANTHROPIC_API_KEY tanımlı değil"}
          </button>
        )}
        {desktop && (
          <>
            <span className="spacer" />
            <button className="btn ghost small" onClick={() => desktop!.openFolder(program?.projectName || project.title)}>Çıktı klasörü</button>
            <button className="btn ghost small" onClick={() => setShowSettings(true)}>Ayarlar</button>
          </>
        )}
      </header>
      {showSettings && <SettingsDialog onClose={() => { setShowSettings(false); refreshHealth(); }} />}
      {toast && <div className="toast" role="status">{toast}</div>}

      <div className="layout">
        <aside className="notes">
          <div className="notes-head">
            <h2>Görüşme notları</h2>
            {desktop ? (
              <span className="muted small" title="Windows'un yerleşik sesli yazması, imleç not alanındayken çalışır">Sesle yazmak için <kbd>Win</kbd> + <kbd>H</kbd></span>
            ) : dictation.supported && (
              <button className={`btn mic ${dictation.listening ? "on" : ""}`} onClick={dictation.toggle} title="Türkçe sesli dikte">
                <span className="dot" /> {dictation.listening ? "Dinleniyor… durdur" : "Sesle yaz"}
              </button>
            )}
          </div>
          <textarea
            value={project.notes + (dictation.interim ? " " + dictation.interim : "")}
            onChange={(e) => update({ notes: e.target.value })}
            placeholder={"Müşterinin anlattıklarını olduğu gibi yazın ya da sesle dikte edin.\n\nÖr: 2 katlı ev, 3 yatak odası, açık mutfak, bahçeye bakan salon, 400 m² arsa, TAKS 0.30…"}
          />
          <div className="actions">
            <button className="btn primary" disabled={busy || project.notes.trim().length < 10} onClick={() => run("new")}>
              {busy ? "Claude programı çıkarıyor…" : "Proje üret"}
            </button>
            {program && (
              <button className="btn" disabled={busy || project.notes.trim().length < 10} onClick={() => run("update")} title="Mevcut programı koruyarak notlardaki değişiklikleri uygula">
                Notlarla güncelle
              </button>
            )}
          </div>
          {busy && <div className="progress"><div /></div>}
          {error && <div className="error">{error}</div>}
          <button className="link" onClick={loadSample}>Örnek görüşmeyi yükle (API gerekmez)</button>
          <div className="muted small how">
            Akış: notlar → Claude yapılandırılmış bina programı çıkarır → plan, kesit, cephe, 3D ve imar kontrolü aynı modelden üretilir. Programı sağdan düzenleyince tüm çizimler anında güncellenir.
          </div>
        </aside>

        <main className="workspace">
          {!program || !layout ? (
            <div className="empty">
              <h1>Görüşme notundan çizim setine, tek tuşla.</h1>
              <p>Soldaki alana müşterinin isteklerini yazın ya da sesle dikte edin, sonra <b>Proje üret</b>'e basın.</p>
              <ol>
                <li>Claude notlardan mekân listesi, alanlar, kat dağılımı, imar değerleri, varsayımlar ve müşteriye sorulacak soruları çıkarır.</li>
                <li>Uygulama bu programdan ölçülü kat planlarını, A-A kesitini, dört cepheyi ve 3D modeli üretir.</li>
                <li>Programı düzenleyin, SVG / PNG / DXF / GLB olarak indirin ya da tüm seti PDF olarak yazdırın.</li>
              </ol>
              <button className="btn" onClick={loadSample}>Örnek projeyi aç</button>
            </div>
          ) : (
            <>
              <nav className="tabs">
                {TABS.map((t) => (
                  <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>{t.label}</button>
                ))}
                <span className="spacer" />
                <div className="export">
                  <select className="unit" value={dxfUnit} onChange={(e) => setDxfUnit(e.target.value as DxfUnit)} title="DXF çizim birimi">
                    <option value="cm">cm</option>
                    <option value="m">m</option>
                    <option value="mm">mm</option>
                  </select>
                  <button className="btn small primary-outline" onClick={sendToAutoCAD} title="Planlar, kesit, 4 cephe ve vaziyet planı tek DXF dosyasında">
                    {desktop ? "AutoCAD'de aç" : "DXF (AutoCAD)"}
                  </button>
                  <button className="btn ghost small" onClick={() => saveOutput(`${program.projectName}-program`, "json", JSON.stringify(program, null, 2))}>JSON</button>
                  <button className="btn small" onClick={savePDF}>Çizim seti (PDF)</button>
                </div>
              </nav>
              <div className="tab-body">
                {tab === "program" && <ProgramEditor program={program} layout={layout} onChange={setProgram} />}
                {tab === "plan" && (
                  <>
                    <div className="subtabs">
                      {layout.floors.map((f, i) => (
                        <button key={f.level} className={floorIdx === i ? "active" : ""} onClick={() => setFloorIdx(i)}>{f.name}</button>
                      ))}
                    </div>
                    <SvgSheet svg={planSVG(layout, layout.floors[floorIdx] ?? layout.floors[0], program)} name={`${program.projectName}-${layout.floors[floorIdx]?.name}`} />
                  </>
                )}
                {tab === "section" && <SvgSheet svg={sectionSVG(layout, program)} name={`${program.projectName}-kesit-AA`} />}
                {tab === "elevation" && (
                  <>
                    <div className="subtabs">
                      {(Object.keys(FACADE_NAMES) as Facade[]).map((f) => (
                        <button key={f} className={facade === f ? "active" : ""} onClick={() => setFacade(f)}>{FACADE_NAMES[f]}</button>
                      ))}
                    </div>
                    <SvgSheet svg={elevationSVG(layout, program, facade)} name={`${program.projectName}-${FACADE_NAMES[facade]}`} />
                  </>
                )}
                {tab === "3d" && <ThreeView layout={layout} program={program} />}
                {tab === "zoning" && <ZoningPanel program={program} layout={layout} onChange={setProgram} />}
              </div>
              <PrintSet program={program} layout={layout} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

/** Yalnızca yazdırırken görünen çizim seti (tarayıcıdan PDF olarak kaydedilir). */
function PrintSet({ program, layout }: { program: Program; layout: ReturnType<typeof buildLayout> }) {
  const sheets = [
    ...layout.floors.map((f) => planSVG(layout, f, program)),
    sectionSVG(layout, program),
    ...(Object.keys(FACADE_NAMES) as Facade[]).map((f) => elevationSVG(layout, program, f)),
    sitePlanSVG(layout, program),
  ];
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="print-set" ref={ref}>
      <div className="print-cover">
        <h1>{program.projectName}</h1>
        <p>{program.buildingType} · {program.clientName}</p>
        <p>{program.summary}</p>
        <h3>Müşteriye sorulacaklar</h3>
        <ul>{program.openQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul>
        <p className="small">Ön tasarım eskizidir; ölçüler program alanlarından otomatik türetilmiştir.</p>
      </div>
      {sheets.map((s, i) => (
        <div className="print-sheet" key={i} dangerouslySetInnerHTML={{ __html: s }} />
      ))}
    </div>
  );
}
