import { useEffect, useMemo, useRef, useState } from "react";
import type { Program } from "./shared/schema";
import { buildLayout } from "./geometry/layout";
import { planSVG, sectionSVG, elevationSVG, sitePlanSVG, setAntet, FACADE_NAMES, type Facade } from "./geometry/svg";
import { buildDXF, type DxfUnit } from "./geometry/dxf";
import { desktop } from "./desktop";
import { SettingsDialog } from "./components/SettingsDialog";
import { ProgramEditor } from "./components/ProgramEditor";
import { ZoningPanel } from "./components/ZoningPanel";
import { ThreeView } from "./components/ThreeView";
import { SvgSheet } from "./components/SvgSheet";
import { download, fromProjectFile, generateProgram, lastGen, loadProjects, newProject, saveOutput, saveProjects, setCurrentProject, slug, toProjectFile, type Project } from "./store";
import { SAMPLE_NOTES, SAMPLE_PROGRAM } from "./sample";
import { useDictation } from "./useDictation";
import { AreasPanel, IssueList } from "./components/AreasPanel";
import { AdjacencyCard, VariantPicker } from "./components/Variants";
import { PlanEditOverlay } from "./components/PlanEditor";
import { buildIFC } from "./geometry/ifc";
import { UpdateButton } from "./components/UpdateButton";
import { BriefPanel } from "./components/BriefPanel";
import { RevisionBox } from "./components/RevisionBox";
import { applyBrief, briefForPrompt, dataUrlToImage } from "./brief";
import { loadOffice, todayTR, type OfficeInfo } from "./office";
import { roomChecks } from "./geometry/roomcheck";
import { blockTypeKey, blockView, isMultiBlock, unitCounts } from "./geometry/blocks";
import { BlocksEditor } from "./components/BlocksEditor";
import { SITE_NOTES, SITE_PROGRAM } from "./sample-site";

/** Demo derlemesi (VITE_DEMO=1): API ve indirmeler olmadan, örnek projeyle açılır. */
const DEMO = import.meta.env.VITE_DEMO === "1";

type Tab = "program" | "plan" | "section" | "elevation" | "3d" | "zoning" | "areas";
const TABS: { id: Tab; label: string }[] = [
  { id: "program", label: "Program" },
  { id: "plan", label: "Kat Planları" },
  { id: "section", label: "Kesit" },
  { id: "elevation", label: "Cepheler" },
  { id: "3d", label: "3D Model" },
  { id: "zoning", label: "İmar & Vaziyet" },
  { id: "areas", label: "Alanlar & Maliyet" },
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
  const [editPlan, setEditPlan] = useState(false);
  const [office, setOffice] = useState<OfficeInfo>(loadOffice);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [genInfo, setGenInfo] = useState<{ warnings: string[]; hasRaw: boolean } | null>(null);
  const syncGen = () => setGenInfo({ warnings: lastGen.warnings, hasRaw: lastGen.raw != null });
  const [floorIdx, setFloorIdx] = useState(0);
  const [blockIdx, setBlockIdx] = useState(0);
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
  // Antet bilgileri: çizimler bu render'da üretilmeden önce ayarlanır
  setAntet(office, { name: program?.projectName ?? "", client: program?.clientName ?? "", date: todayTR() });
  useEffect(() => setCurrentProject(program?.projectName || project.title), [program?.projectName, project.title]);
  // Çok bloklu projede çizimler seçili bloğun görünümünden üretilir
  const multi = !!program && isMultiBlock(program);
  const nBlocks = program?.blocks?.length ?? 0;
  const blockSel = Math.min(blockIdx, Math.max(0, nBlocks - 1));
  const view = useMemo(() => (program ? blockView(program, blockSel) : undefined), [program, blockSel]);
  const layout = useMemo(() => (view ? buildLayout(view) : null), [view]);
  const issues = useMemo(() => (layout ? roomChecks(layout) : []), [layout]);
  const flagged = useMemo(() => new Set(issues.filter((i) => !i.soft).map((i) => i.roomId)), [issues]);
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
      const images = (project.refImages ?? []).map(dataUrlToImage).filter(Boolean) as { mediaType: string; data: string }[];
      const raw = await generateProgram(project.notes, mode === "update" ? program : null, { brief: briefForPrompt(project.brief), images }, startCall());
      let p = applyBrief(raw, project.brief);
      if (mode === "update" && program?.design) p = { ...p, design: program.design };
      update({
        program: p,
        title: p.clientName || p.projectName || project.title,
        history: pushHistory(project, mode === "update" ? "Notlarla güncellemeden önce" : "Yeniden üretimden önce"),
      });
      setTab(mode === "update" ? tab : "program");
      syncGen();
    } catch (e) {
      if (!isAbort(e)) { setError((e as Error).message); syncGen(); }
    } finally {
      setBusy(false);
    }
  };

  const abortRef = useRef<AbortController | null>(null);
  const startCall = () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    return abortRef.current.signal;
  };
  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setToast("Üretim durduruldu. Proje değişmedi.");
  };
  const isAbort = (e: unknown) => (e as Error)?.name === "AbortError";

  const pushHistory = (pr: Project, label: string) =>
    pr.program ? [...(pr.history ?? []), { program: pr.program, label, at: Date.now() }].slice(-10) : pr.history;

  const revise = async (text: string) => {
    if (!program) return false;
    if (DEMO) {
      setError("Bu demo sürümünde Claude bağlantısı yok; düzeltmeler tam sürümde Claude ile uygulanır.");
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const raw = await generateProgram(project.notes, program, { revision: text }, startCall());
      const p = { ...raw, design: program.design };
      update({ program: p, history: [...(project.history ?? []), { program, label: `Düzeltme: ${text.slice(0, 80)}`, at: Date.now() }].slice(-10) });
      setToast("Düzeltme uygulandı. Beğenmezseniz 'Geri al'.");
      syncGen();
      return true;
    } catch (e) {
      if (!isAbort(e)) { setError((e as Error).message); syncGen(); }
      return false;
    } finally {
      setBusy(false);
    }
  };
  const undo = () => {
    const h = project.history ?? [];
    const last = h[h.length - 1];
    if (!last) return;
    update({ program: last.program, history: h.slice(0, -1) });
    setToast(`Geri alındı (${last.label}).`);
  };

  const loadSample = () => {
    update({ notes: SAMPLE_NOTES, program: structuredClone(SAMPLE_PROGRAM), title: SAMPLE_PROGRAM.clientName });
    setTab("plan");
  };
  const loadSiteSample = () => {
    update({ notes: SITE_NOTES, program: structuredClone(SITE_PROGRAM), title: SITE_PROGRAM.clientName });
    setBlockIdx(0);
    setFloorIdx(0);
    setTab("plan");
  };

  const addProject = () => {
    const p = newProject(`Görüşme ${projects.length + 1}`);
    setProjects([p, ...projects]);
    setActiveId(p.id);
    setTab("program");
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const saveProjectFile = async (saveAs = false) => {
    const content = toProjectFile(project);
    const name = program?.projectName || project.title;
    if (desktop) {
      const r = await desktop.saveProject(name, content, saveAs ? undefined : project.filePath);
      if (r.saved) {
        update({ filePath: r.path });
        setToast(`Proje kaydedildi: ${r.path}`);
      }
    } else {
      download(`${slug(name)}.mimarnot`, content, "application/json");
    }
  };
  const importProject = (text: string, filePath?: string) => {
    try {
      const p = { ...fromProjectFile(text), filePath };
      setProjects((list) => [p, ...list]);
      setActiveId(p.id);
      setTab(p.program ? "plan" : "program");
      setToast(`Açıldı: ${p.title}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const openProjectFile = async () => {
    if (desktop) {
      const r = await desktop.openProject();
      if (r) importProject(r.content, r.path);
    } else fileInput.current?.click();
  };
  // Menü ve klavye kısayolları (Ctrl+S, Ctrl+O)
  const handlers = useRef({ saveProjectFile, openProjectFile });
  handlers.current = { saveProjectFile, openProjectFile };
  useEffect(() => {
    const off = desktop?.onMenu((cmd) => {
      if (cmd === "save") handlers.current.saveProjectFile();
      if (cmd === "saveAs") handlers.current.saveProjectFile(true);
      if (cmd === "open") handlers.current.openProjectFile();
    });
    const onKey = (e: KeyboardEvent) => {
      if (desktop || !(e.ctrlKey || e.metaKey)) return;
      if (e.key === "s") { e.preventDefault(); handlers.current.saveProjectFile(); }
      if (e.key === "o") { e.preventDefault(); handlers.current.openProjectFile(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { off?.(); window.removeEventListener("keydown", onKey); };
  }, []);

  const deleteProject = () => {
    if (!confirm(`"${project.title}" silinsin mi?`)) return;
    const rest = projects.filter((p) => p.id !== project.id);
    const next = rest.length ? rest : [newProject()];
    setProjects(next);
    setActiveId(next[0].id);
  };

  const setProgram = (p: Program) => update({ program: p });
  /** Blok görünümünde yapılan değişiklikleri (yerleşim tercihi, imar, arsa, malzeme) projeye yaz */
  const setView = (v: Program) => {
    if (!program || !multi) return setProgram(v);
    setProgram({ ...program, design: v.design, zoning: v.zoning, site: v.site, materials: v.materials, floorHeight: v.floorHeight, roof: v.roof });
  };

  const sendToAutoCAD = async () => {
    if (!view || !layout) return;
    const dxf = buildDXF(layout, view, dxfUnit, { ...office, date: todayTR() });
    const name = `${view.projectName} - cizim seti`;
    if (desktop) {
      const r = await desktop.saveAndOpen(view.projectName, name, "dxf", dxf);
      setToast(r.ok ? `Kaydedildi ve açılıyor: ${r.path}` : r.error?.includes("yazılamadı") ? r.error : `Kaydedildi: ${r.path}. DXF dosyalarını açacak view bulunamadı; dosyayı AutoCAD'de elle açın.`);
    } else {
      await saveOutput(name, "dxf", dxf);
    }
  };
  const savePDF = async () => {
    if (!view) return;
    if (desktop) {
      const r = await desktop.savePDF(view.projectName, `${view.projectName} - cizim seti`);
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
          <span className="sep" />
          <button className="btn ghost small" onClick={openProjectFile} title="Ctrl+O">Aç…</button>
          <button className="btn ghost small" onClick={() => saveProjectFile()} title="Ctrl+S">Kaydet</button>
          <input ref={fileInput} type="file" accept=".mimarnot,.json" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) importProject(await f.text());
            e.target.value = "";
          }} />
        </div>
        {DEMO && <span className="badge">Demo · örnek proje, indirme ve sesli dikte tam sürümde</span>}
        {apiInfo && !apiInfo.ok && <span className="badge warn">API sunucusu yok · örnek proje ve elle düzenleme çalışır</span>}
        {apiInfo?.ok && !apiInfo.hasKey && (
          <button className="badge warn as-button" onClick={() => desktop && setShowSettings(true)}>
            {desktop ? "Claude API anahtarı girilmedi · Ayarlar" : "ANTHROPIC_API_KEY tanımlı değil"}
          </button>
        )}
        <span className="spacer" />
        <UpdateButton onMessage={setToast} />
        {desktop && <button className="btn ghost small" onClick={() => desktop!.openFolder(program?.projectName || project.title)}>Çıktı klasörü</button>}
        <button className="btn ghost small" onClick={() => setShowSettings(true)}>Ayarlar</button>
      </header>
      {showSettings && <SettingsDialog onOffice={setOffice} onClose={() => { setShowSettings(false); refreshHealth(); }} />}
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
          <BriefPanel
            brief={project.brief ?? {}}
            images={project.refImages ?? []}
            onBrief={(b) => update({ brief: b })}
            onImages={(imgs) => update({ refImages: imgs })}
            onError={setError}
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
          {busy && (
            <div className="busy-row">
              <div className="progress"><div /></div>
              <button className="btn small stop" onClick={stop} title="Claude çağrısını iptal et">■ Durdur</button>
            </div>
          )}
          {error && <div className="error">{error}</div>}
          {genInfo && genInfo.warnings.length > 0 && (
            <div className="warn-box">
              <b>Claude yanıtında onarılanlar</b>
              <ul>{genInfo.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}
          {genInfo?.hasRaw && (error || genInfo.warnings.length > 0) && (
            <button className="link small" onClick={() => download(`claude-yaniti-${new Date(lastGen.at).toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`, JSON.stringify(lastGen.raw, null, 2), "application/json")}>
              Claude'un ham yanıtını indir (hata bildirimi için)
            </button>
          )}
          {program && <RevisionBox busy={busy} history={project.history ?? []} onRevise={revise} onUndo={undo} />}
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <button className="link" onClick={loadSample}>Örnek görüşme: villa</button>
            <button className="link" onClick={loadSiteSample}>Örnek görüşme: 4 bloklu site</button>
          </div>
          <div className="muted small how">
            Akış: notlar → Claude yapılandırılmış bina programı çıkarır → plan, kesit, cephe, 3D ve imar kontrolü aynı modelden üretilir. Programı sağdan düzenleyince tüm çizimler anında güncellenir.
          </div>
        </aside>

        <main className="workspace">
          {!view || !layout ? (
            <div className="empty">
              <h1>Görüşme notundan çizim setine, tek tuşla.</h1>
              <p>Soldaki alana müşterinin isteklerini yazın ya da sesle dikte edin, sonra <b>Proje üret</b>'e basın.</p>
              <ol>
                <li>Claude notlardan mekân listesi, alanlar, kat dağılımı, imar değerleri, varsayımlar ve müşteriye sorulacak soruları çıkarır.</li>
                <li>Uygulama bu programdan ölçülü kat planlarını, A-A kesitini, dört cepheyi ve 3D modeli üretir.</li>
                <li>Programı düzenleyin, SVG / PNG / DXF / GLB olarak indirin ya da tüm seti PDF olarak yazdırın.</li>
              </ol>
              <div className="row" style={{ gap: 10 }}>
                <button className="btn" onClick={loadSample}>Örnek projeyi aç (villa)</button>
                <button className="btn ghost" onClick={loadSiteSample}>Örnek: 4 bloklu konut sitesi</button>
              </div>
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
                  <button className="btn ghost small" onClick={() => saveOutput(view.projectName, "ifc", buildIFC(layout, view, office.architect))} title="IFC4 BIM modeli: katlar, duvarlar, kapı/pencere, döşeme ve mahaller (Revit, ArchiCAD, BricsCAD)">IFC (BIM)</button>
                  <button className="btn ghost small" onClick={() => saveOutput(`${program!.projectName}-program`, "json", JSON.stringify(program, null, 2))}>JSON</button>
                  <button className="btn small" onClick={savePDF}>Çizim seti (PDF)</button>
                </div>
              </nav>
              <div className="tab-body">
                {multi && (
                  <div className="block-tabs">
                    <span className="muted small">Blok:</span>
                    {program!.blocks!.map((b, i) => (
                      <button key={i} className={blockSel === i ? "active" : ""} onClick={() => { setBlockIdx(i); setFloorIdx(0); }}>{b.name}</button>
                    ))}
                    <span className="muted small">Planlar, kesit, cephe, DXF ve IFC seçili bloğa aittir; vaziyet planı, 3D ve alan tablosu tüm siteyi gösterir.</span>
                  </div>
                )}
                {tab === "program" && (multi ? <BlocksEditor program={program!} blockIndex={blockSel} onChange={setProgram} /> : <ProgramEditor program={view} layout={layout} onChange={setView} />)}
                {tab === "plan" && (
                  <>
                    <VariantPicker program={view} onChange={setView} />
                    <div className="subtabs">
                      {layout.floors.map((f, i) => (
                        <button key={f.level} className={floorIdx === i ? "active" : ""} onClick={() => setFloorIdx(i)}>{f.name}</button>
                      ))}
                      <span className="spacer" />
                      <button className={editPlan ? "active" : ""} onClick={() => setEditPlan(!editPlan)} title="Oda sınırlarını ve hol bandını sürükleyerek değiştir">
                        {editPlan ? "Düzenlemeyi bitir" : "✎ Sınırları düzenle"}
                      </button>
                      {(view.design?.cols || view.design?.frontDepth != null) && (
                        <button onClick={() => setView({ ...view, design: { variant: view.design?.variant } })} title="Elle yapılan sınır değişikliklerini geri al">Otomatiğe dön</button>
                      )}
                    </div>
                    {editPlan && <div className="muted small" style={{ marginBottom: 8 }}>Turuncu kesikli çizgileri sürükleyin: dikey olanlar yan yana odaların sınırı, yatay olan hol bandının yeri (tüm katlarda birlikte kayar). 5 cm adımla oturur.</div>}
                    <SvgSheet
                      svg={planSVG(layout, layout.floors[floorIdx] ?? layout.floors[0], view, { flag: flagged })}
                      name={`${view.projectName}-${layout.floors[floorIdx]?.name}`}
                      overlay={editPlan ? <PlanEditOverlay L={layout} floor={layout.floors[floorIdx] ?? layout.floors[0]} program={view} onChange={setView} /> : undefined}
                    />
                    {(() => {
                      const fl = layout.floors[floorIdx] ?? layout.floors[0];
                      const here = issues.filter((i) => !i.soft && i.floor === fl.name);
                      return here.length > 0 ? (
                        <section className="card bad">
                          <h3>Bu katta asgari ölçü uyarısı ({here.length})</h3>
                          <IssueList items={here} />
                          <button className="link" onClick={() => setTab("areas")}>Tüm uyarılar ve alan tablosu →</button>
                        </section>
                      ) : null;
                    })()}
                    <AdjacencyCard program={view} layout={layout} />
                  </>
                )}
                {tab === "section" && <SvgSheet svg={sectionSVG(layout, view)} name={`${view.projectName}-kesit-AA`} />}
                {tab === "elevation" && (
                  <>
                    <div className="subtabs">
                      {(Object.keys(FACADE_NAMES) as Facade[]).map((f) => (
                        <button key={f} className={facade === f ? "active" : ""} onClick={() => setFacade(f)}>{FACADE_NAMES[f]}</button>
                      ))}
                    </div>
                    <SvgSheet svg={elevationSVG(layout, view, facade)} name={`${view.projectName}-${FACADE_NAMES[facade]}`} />
                  </>
                )}
                {tab === "3d" && <ThreeView layout={layout} program={view} />}
                {tab === "zoning" && <ZoningPanel program={view} layout={layout} onChange={setView} />}
                {tab === "areas" && <AreasPanel program={view} layout={layout} />}
              </div>
              <PrintSet program={view} root={program!} layout={layout} office={office} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

/** Yalnızca yazdırırken görünen çizim seti (tarayıcıdan PDF olarak kaydedilir). */
function PrintSet({ program, root, layout, office }: { program: Program; root: Program; layout: ReturnType<typeof buildLayout>; office: OfficeInfo }) {
  const sheets = useMemo(() => {
    const one = (v: Program, L: ReturnType<typeof buildLayout>) => [
      ...L.floors.map((f) => planSVG(L, f, v)),
      sectionSVG(L, v),
      ...(Object.keys(FACADE_NAMES) as Facade[]).map((f) => elevationSVG(L, v, f)),
    ];
    if (!isMultiBlock(root)) return [...one(program, layout), sitePlanSVG(layout, program)];
    // çok bloklu: vaziyet planı + her blok tipi bir kez (aynı bloklar tekrar edilmez)
    const seen = new Set<string>();
    const out = [sitePlanSVG(layout, program)];
    root.blocks!.forEach((_, i) => {
      const key = blockTypeKey(root, i);
      if (seen.has(key)) return;
      seen.add(key);
      const v = blockView(root, i);
      const same = root.blocks!.filter((_, k) => blockTypeKey(root, k) === key).map((b) => b.name);
      const vv = same.length > 1 ? { ...v, projectName: `${root.projectName} · ${same.join(", ")}` } : v;
      out.push(...one(vv, buildLayout(vv)));
    });
    return out;
  }, [program, root, layout]);
  const units = isMultiBlock(root) ? unitCounts(root) : [];
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="print-set" ref={ref}>
      <div className="print-cover">
        <h1>{root.projectName}</h1>
        <p>{root.buildingType} · {root.clientName}</p>
        {(office.office || office.architect) && <p>{[office.office, office.architect, office.regNo && `Sicil ${office.regNo}`, office.contact].filter(Boolean).join(" · ")}</p>}
        <p className="small">{todayTR()}</p>
        <p>{root.summary}</p>
        {units.length > 0 && (
          <>
            <h3>Daire listesi ({units.reduce((s, u) => s + u.count, 0)} daire, {root.blocks!.length} blok)</h3>
            <ul>{units.map((u) => <li key={u.type}>{u.type}: {u.count} adet · {u.area.toFixed(0)} m² net · {[...u.blocks].join(", ")}</li>)}</ul>
          </>
        )}
        {root.assumptions.length > 0 && (<><h3>Varsayımlar</h3><ul>{root.assumptions.map((q, i) => <li key={i}>{q}</li>)}</ul></>)}
        {root.openQuestions.length > 0 && (<><h3>Müşteriye sorulacaklar</h3><ul>{root.openQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul></>)}
        <p className="small">Ön tasarım eskizidir; ölçüler program alanlarından otomatik türetilmiştir.</p>
      </div>
      {sheets.map((s, i) => (
        <div className="print-sheet" key={i} dangerouslySetInnerHTML={{ __html: s }} />
      ))}
    </div>
  );
}
