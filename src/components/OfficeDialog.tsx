import { useEffect, useMemo, useRef, useState } from "react";
import { signedIn } from "../cloud";
import { desktop } from "../desktop";
import { saveNamedFile } from "../store";
import {
  EXPENSE_CATEGORIES, JOB_STATUS, PAYMENT_METHODS, balances, deleteRow, downloadFile, exportAll, fmtDay, fmtSize, loadOffice, money,
  saveRow, toCsv, todayIso, updateFile, uploadFile,
  type Client, type Entity, type Expense, type Job, type JobStatus, type OfficeData, type OfficeFile, type Payment,
} from "../officeData";

type Tab = "summary" | "clients" | "jobs" | "payments" | "expenses" | "files";
const TABS: { id: Tab; label: string }[] = [
  { id: "summary", label: "Özet" },
  { id: "clients", label: "Müşteriler" },
  { id: "jobs", label: "İşler" },
  { id: "payments", label: "Tahsilatlar" },
  { id: "expenses", label: "Giderler" },
  { id: "files", label: "Dosyalar" },
];
const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

type Draft = Record<string, string | number | null>;
interface Edit { ent: Entity; row: Draft }

/**
 * Ofis yönetimi: mimarın müşterileri, işleri (sözleşme bedeli), tahsilatları, giderleri ve dosyaları.
 * Veriler Planhane hesabında saklanır; aynı hesapla giriş yapılan her cihazda görünür.
 */
export function OfficeDialog({ onClose, onAccount, projects, onOpenProject }: {
  onClose: () => void;
  onAccount: () => void;
  projects: { id: string; title: string }[];
  onOpenProject: (id: string) => void;
}) {
  const [data, setData] = useState<OfficeData | null>(null);
  const [tab, setTab] = useState<Tab>("summary");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [jobFilter, setJobFilter] = useState<number | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [q, setQ] = useState("");

  const load = () => loadOffice().then(setData).catch((e) => setErr((e as Error).message));
  useEffect(() => { if (signedIn()) void load(); }, []);
  useEffect(() => { setQ(""); setEdit(null); }, [tab]);

  const run = async (fn: () => Promise<OfficeData | void>) => {
    setErr(null); setBusy(true);
    try { const d = await fn(); if (d) setData(d); return true; } catch (e) { setErr((e as Error).message); return false; } finally { setBusy(false); }
  };
  const save = async () => { if (edit && (await run(() => saveRow(edit.ent, edit.row)))) setEdit(null); };
  const remove = (ent: Entity | "files", id: number, what: string) => {
    if (!confirm(`${what} silinsin mi? Bu işlem geri alınamaz.`)) return;
    void run(() => deleteRow(ent, id));
    if (edit?.row.id === id) setEdit(null);
  };

  const bal = useMemo(() => (data ? balances(data) : new Map()), [data]);
  const clientName = (id: number | null) => data?.clients.find((c) => c.id === id)?.name ?? "";
  const job = (id: number | null) => data?.jobs.find((j) => j.id === id);
  const jobLabel = (id: number | null) => { const j = job(id); return j ? `${j.title}${j.client_id ? ` · ${clientName(j.client_id)}` : ""}` : ""; };
  const match = (...s: (string | number | null | undefined)[]) => !q || s.join(" ").toLocaleLowerCase("tr").includes(q.toLocaleLowerCase("tr"));

  const newRow = (ent: Entity, extra: Draft = {}): Edit => ({
    ent,
    row: ent === "clients" ? { name: "", phone: "", email: "", tax_no: "", address: "", note: "", ...extra }
      : ent === "jobs" ? { title: "", client_id: null, status: "devam", fee: "", start_date: todayIso(), due_date: "", project_id: "", project_title: "", note: "", ...extra }
      : ent === "payments" ? { job_id: jobFilter ?? (data?.jobs.find((j) => j.status === "devam") ?? data?.jobs.find((j) => j.status !== "iptal"))?.id ?? null, date: todayIso(), amount: "", method: PAYMENT_METHODS[0], note: "", ...extra }
      : { date: todayIso(), amount: "", category: EXPENSE_CATEGORIES[0], vendor: "", job_id: null, note: "", ...extra },
  });
  const set = (k: string, v: string | number | null) => setEdit((e) => e && { ...e, row: { ...e.row, [k]: v } });

  const saveFile = async (name: string, blob: Blob) => {
    try { await saveNamedFile(name, blob); } catch (e) { setErr((e as Error).message); }
  };

  if (!signedIn()) {
    return (
      <Shell onClose={onClose}>
        <p>Ofis yönetimi (müşteriler, tahsilatlar, giderler, dosyalar) Planhane hesabınızda saklanır; böylece bilgisayarda, telefonda ve web panelinde aynı kayıtları görürsünüz.</p>
        <div className="row end"><button className="btn ghost" onClick={onClose}>Kapat</button><button className="btn primary" onClick={onAccount}>Giriş yap / hesap aç</button></div>
      </Shell>
    );
  }

  const years = data ? [...new Set([new Date().getFullYear(), ...data.payments.map((p) => +p.date.slice(0, 4)), ...data.expenses.map((e) => +e.date.slice(0, 4))])].filter(Boolean).sort((a, b) => b - a) : [year];
  const yearSel = <select value={year} onChange={(e) => setYear(+e.target.value)}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>;
  const search = <input className="office-search" placeholder="Ara…" value={q} onChange={(e) => setQ(e.target.value)} />;
  const jobOptions = (allowEmpty: string | null) => (
    <>
      {allowEmpty != null && <option value="">{allowEmpty}</option>}
      {data?.jobs.map((j) => <option key={j.id} value={j.id}>{jobLabel(j.id)}{j.status === "iptal" ? " (iptal)" : ""}</option>)}
    </>
  );

  return (
    <Shell onClose={onClose}>
      <div className="seg office-tabs">
        {TABS.map((t) => <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => { setTab(t.id); setJobFilter(null); }}>{t.label}</button>)}
      </div>
      {err && <div className="error">{err}</div>}
      {!data ? <p className="muted">{err ? "" : "Yükleniyor…"}</p> : (
        <>
          {edit && (
            <EditForm edit={edit} set={set} busy={busy} data={data} projects={projects} jobOptions={jobOptions}
              onCancel={() => setEdit(null)} onSave={save} />
          )}

          {tab === "summary" && (
            <Summary data={data} bal={bal} year={year} yearSel={yearSel} jobLabel={jobLabel}
              onJob={(id) => { setJobFilter(id); setTab("payments"); }}
              onExport={async () => { if (await run(async () => { await saveFile(`planhane-ofis-${todayIso()}.json`, await exportAll()); })) { /* tamam */ } }} />
          )}

          {tab === "clients" && (
            <>
              <div className="office-bar">
                {search}
                <span className="spacer" />
                <button className="btn primary small" onClick={() => setEdit(newRow("clients"))}>+ Müşteri</button>
              </div>
              {data.clients.length === 0 ? <Empty text="Henüz müşteri yok. Görüştüğünüz müşterileri burada tutun; işleri, tahsilatları ve dosyaları müşteriye bağlayın." /> : (
                <table className="office-table">
                  <thead><tr><th>Ad / firma</th><th>İletişim</th><th className="num">İş</th><th className="num">Kalan alacak</th><th /></tr></thead>
                  <tbody>
                    {data.clients.filter((c) => match(c.name, c.phone, c.email, c.tax_no, c.address, c.note)).map((c) => {
                      const jobs = data.jobs.filter((j) => j.client_id === c.id);
                      const due = jobs.reduce((s, j) => s + (bal.get(j.id)?.due ?? 0), 0);
                      return (
                        <tr key={c.id}>
                          <td><b>{c.name}</b>{c.note && <div className="muted small clamp">{c.note}</div>}</td>
                          <td className="small">{[c.phone, c.email].filter(Boolean).join(" · ")}{c.tax_no && <div className="muted">VKN/TCKN {c.tax_no}</div>}</td>
                          <td className="num">{jobs.length}</td>
                          <td className={`num ${due > 0 ? "due" : ""}`}>{due > 0 ? money(due) : "—"}</td>
                          <td className="row-acts">
                            <button className="link small" onClick={() => setEdit(newRow("jobs", { client_id: c.id }))}>+ İş</button>
                            <button className="link small" onClick={() => setEdit({ ent: "clients", row: { ...c } })}>Düzenle</button>
                            <button className="link small danger" onClick={() => remove("clients", c.id, `“${c.name}”`)}>Sil</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}

          {tab === "jobs" && (
            <>
              <div className="office-bar">
                {search}
                <span className="spacer" />
                <button className="btn primary small" onClick={() => setEdit(newRow("jobs"))}>+ İş</button>
              </div>
              {data.jobs.length === 0 ? <Empty text="Henüz iş yok. Her proje / sözleşme için bir iş açın; sözleşme bedelini girin, tahsilatlar düştükçe kalan alacak burada görünür." /> : (
                <table className="office-table">
                  <thead><tr><th>İş</th><th>Durum</th><th className="num">Bedel</th><th className="num">Tahsil</th><th className="num">Kalan</th><th /></tr></thead>
                  <tbody>
                    {data.jobs.filter((j) => match(j.title, clientName(j.client_id), j.note, j.project_title)).map((j) => {
                      const b = bal.get(j.id)!;
                      return (
                        <tr key={j.id} className={j.status === "iptal" ? "dim" : ""}>
                          <td>
                            <b>{j.title}</b>
                            <div className="muted small">{[clientName(j.client_id), j.due_date && `Teslim ${fmtDay(j.due_date)}`].filter(Boolean).join(" · ")}</div>
                            {j.project_id && projects.some((p) => p.id === j.project_id) && (
                              <button className="link small" onClick={() => { onOpenProject(j.project_id); onClose(); }}>Tasarımı aç: {j.project_title || "proje"} →</button>
                            )}
                          </td>
                          <td><span className={`pill st-${j.status}`}>{JOB_STATUS[j.status]}</span></td>
                          <td className="num">{money(j.fee)}</td>
                          <td className="num">{money(b.paid)}</td>
                          <td className={`num ${b.due > 0 ? "due" : ""}`}>{b.due > 0 ? money(b.due) : "—"}</td>
                          <td className="row-acts">
                            <button className="link small" onClick={() => setEdit(newRow("payments", { job_id: j.id }))}>+ Tahsilat</button>
                            <button className="link small" onClick={() => { setJobFilter(j.id); setTab("files"); }}>Dosyalar</button>
                            <button className="link small" onClick={() => setEdit({ ent: "jobs", row: { ...j } })}>Düzenle</button>
                            <button className="link small danger" onClick={() => remove("jobs", j.id, `“${j.title}” işi ve tahsilat kayıtları`)}>Sil</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}

          {tab === "payments" && (
            <Ledger kind="payments" data={data} year={year} yearSel={yearSel} search={search} match={match}
              jobFilter={jobFilter} setJobFilter={setJobFilter} jobOptions={jobOptions} jobLabel={jobLabel}
              onAdd={() => setEdit(newRow("payments"))} onEdit={(r) => setEdit({ ent: "payments", row: { ...r } })}
              onDelete={(r) => remove("payments", r.id, `${fmtDay(r.date)} tarihli ${money(r.amount)} tahsilat`)}
              onCsv={(rows) => saveFile(`tahsilatlar-${year}.csv`, toCsv(["Tarih", "İş", "Müşteri", "Tutar (TL)", "Ödeme şekli", "Not"],
                (rows as Payment[]).map((p) => [fmtDay(p.date), job(p.job_id)?.title ?? "", clientName(job(p.job_id)?.client_id ?? null), p.amount, p.method, p.note])))} />
          )}

          {tab === "expenses" && (
            <Ledger kind="expenses" data={data} year={year} yearSel={yearSel} search={search} match={match}
              jobFilter={jobFilter} setJobFilter={setJobFilter} jobOptions={jobOptions} jobLabel={jobLabel}
              onAdd={() => setEdit(newRow("expenses", jobFilter ? { job_id: jobFilter } : {}))} onEdit={(r) => setEdit({ ent: "expenses", row: { ...r } })}
              onDelete={(r) => remove("expenses", r.id, `${fmtDay(r.date)} tarihli ${money(r.amount)} gider`)}
              onCsv={(rows) => saveFile(`giderler-${year}.csv`, toCsv(["Tarih", "Kategori", "Kime / nereden", "İş", "Tutar (TL)", "Not"],
                (rows as Expense[]).map((e) => [fmtDay(e.date), e.category, e.vendor, job(e.job_id)?.title ?? "", e.amount, e.note])))} />
          )}

          {tab === "files" && (
            <Files data={data} busy={busy} run={run} jobFilter={jobFilter} setJobFilter={setJobFilter} jobOptions={jobOptions}
              jobLabel={jobLabel} clientName={clientName} search={search} match={match} saveFile={saveFile}
              onDelete={(f) => remove("files", f.id, `“${f.name}”`)} setErr={setErr} />
          )}
        </>
      )}
    </Shell>
  );
}

function Shell({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal office-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="office-title">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 id="office-title">Ofis yönetimi</h2>
          <button className="btn ghost small" onClick={onClose}>Kapat</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const Empty = ({ text }: { text: string }) => <p className="muted office-empty">{text}</p>;

function Summary({ data, bal, year, yearSel, jobLabel, onJob, onExport }: {
  data: OfficeData; bal: Map<number, { paid: number; due: number; expense: number }>; year: number; yearSel: React.ReactNode;
  jobLabel: (id: number) => string; onJob: (id: number) => void; onExport: () => void;
}) {
  const inYear = (d: string) => d.startsWith(`${year}-`);
  const income = data.payments.filter((p) => inYear(p.date)).reduce((s, p) => s + p.amount, 0);
  const expense = data.expenses.filter((e) => inYear(e.date)).reduce((s, e) => s + e.amount, 0);
  const due = [...bal.values()].reduce((s, b) => s + b.due, 0);
  const active = data.jobs.filter((j) => j.status === "devam").length;
  const monthly = MONTHS.map((_, i) => {
    const m = `${year}-${String(i + 1).padStart(2, "0")}`;
    return {
      inc: data.payments.filter((p) => p.date.startsWith(m)).reduce((s, p) => s + p.amount, 0),
      exp: data.expenses.filter((e) => e.date.startsWith(m)).reduce((s, e) => s + e.amount, 0),
    };
  });
  const peak = Math.max(1, ...monthly.flatMap((m) => [m.inc, m.exp]));
  const cats = new Map<string, number>();
  for (const e of data.expenses) if (inYear(e.date)) cats.set(e.category || "Diğer", (cats.get(e.category || "Diğer") ?? 0) + e.amount);
  const pending = data.jobs.filter((j) => (bal.get(j.id)?.due ?? 0) > 0).sort((a, b) => bal.get(b.id)!.due - bal.get(a.id)!.due);
  const st = data.storage;
  const pct = Math.min(100, (st.used / Math.max(1, st.quota)) * 100);

  return (
    <div className="office-summary">
      <div className="office-bar"><span className="muted small">Yıl</span>{yearSel}</div>
      <div className="kpis">
        <div className="kpi"><span>Tahsil edilen ({year})</span><b>{money(income)}</b></div>
        <div className="kpi"><span>Gider ({year})</span><b>{money(expense)}</b></div>
        <div className={`kpi ${income - expense < 0 ? "neg" : ""}`}><span>Net ({year})</span><b>{money(income - expense)}</b></div>
        <div className="kpi due" title="Teklif ve iptal durumundaki işler hariç"><span>Bekleyen alacak</span><b>{money(due)}</b></div>
        <div className="kpi"><span>Devam eden iş</span><b>{active}</b></div>
      </div>
      <div className="office-cols">
        <section>
          <h3 className="settings-sub">Aylık tahsilat ve gider</h3>
          <div className="month-chart" role="img" aria-label={`${year} aylık tahsilat ve gider`}>
            {monthly.map((m, i) => (
              <div key={i} className="mc-col" title={`${MONTHS[i]}: tahsilat ${money(m.inc)}, gider ${money(m.exp)}`}>
                <div className="mc-bars">
                  <div className="mc-inc" style={{ height: `${(m.inc / peak) * 100}%` }} />
                  <div className="mc-exp" style={{ height: `${(m.exp / peak) * 100}%` }} />
                </div>
                <span>{MONTHS[i]}</span>
              </div>
            ))}
          </div>
          <div className="legend small"><i className="mc-inc" /> Tahsilat <i className="mc-exp" /> Gider</div>
          {cats.size > 0 && (
            <>
              <h3 className="settings-sub">Gider kalemleri ({year})</h3>
              <table className="office-table compact">
                <tbody>{[...cats].sort((a, b) => b[1] - a[1]).map(([c, v]) => <tr key={c}><td>{c}</td><td className="num">{money(v)}</td><td className="num muted small">%{Math.round((v / expense) * 100)}</td></tr>)}</tbody>
              </table>
            </>
          )}
        </section>
        <section>
          <h3 className="settings-sub">Bekleyen ödemeler</h3>
          {pending.length === 0 ? <p className="muted small">Bekleyen alacak yok.</p> : (
            <table className="office-table compact">
              <tbody>
                {pending.slice(0, 12).map((j) => (
                  <tr key={j.id}><td><button className="link" onClick={() => onJob(j.id)}>{jobLabel(j.id)}</button></td><td className="num due">{money(bal.get(j.id)!.due)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <h3 className="settings-sub">Dosya alanı</h3>
          <div className="usage">
            <div className="row" style={{ justifyContent: "space-between" }}><span className="small">{data.files.length} dosya</span><span className="small"><b>{fmtSize(st.used)}</b> / {fmtSize(st.quota)}</span></div>
            <div className={`bar ${pct >= 85 ? "low" : ""}`}><div style={{ width: `${pct}%` }} /></div>
          </div>
          <h3 className="settings-sub">Verileriniz</h3>
          <p className="muted small">
            Müşterilerinizin kişisel verileri (ad, telefon, adres, vergi no) sizin sorumluluğunuzdadır; Planhane bu kayıtları yalnız sizin hesabınız için saklar,
            başka kimseyle paylaşmaz. Gerekirse müşterinize KVKK aydınlatması yapın ve gereksiz veriyi silin.
          </p>
          <button className="btn ghost small" onClick={onExport}>Tüm ofis kayıtlarını indir (JSON)</button>
        </section>
      </div>
    </div>
  );
}

function Ledger({ kind, data, year, yearSel, search, match, jobFilter, setJobFilter, jobOptions, jobLabel, onAdd, onEdit, onDelete, onCsv }: {
  kind: "payments" | "expenses"; data: OfficeData; year: number; yearSel: React.ReactNode; search: React.ReactNode;
  match: (...s: (string | number | null | undefined)[]) => boolean;
  jobFilter: number | null; setJobFilter: (id: number | null) => void; jobOptions: (e: string | null) => React.ReactNode; jobLabel: (id: number | null) => string;
  onAdd: () => void; onEdit: (r: Payment | Expense) => void; onDelete: (r: Payment | Expense) => void; onCsv: (rows: (Payment | Expense)[]) => void;
}) {
  const [cat, setCat] = useState("");
  const all: (Payment | Expense)[] = kind === "payments" ? data.payments : data.expenses;
  const rows = all.filter((r) => r.date.startsWith(`${year}-`) && (jobFilter == null || r.job_id === jobFilter)
    && (kind === "payments" || !cat || (r as Expense).category === cat)
    && match(jobLabel(r.job_id), r.note, kind === "payments" ? (r as Payment).method : `${(r as Expense).category} ${(r as Expense).vendor}`));
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const isPay = kind === "payments";
  return (
    <>
      <div className="office-bar">
        {yearSel}
        <select value={jobFilter ?? ""} onChange={(e) => setJobFilter(e.target.value ? +e.target.value : null)}>{jobOptions("Tüm işler")}</select>
        {!isPay && <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Tüm kalemler</option>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>}
        {search}
        <span className="spacer" />
        <button className="btn ghost small" disabled={!rows.length} onClick={() => onCsv(rows)} title="Muhasebeciniz için Excel'de açılır">Excel (CSV)</button>
        <button className="btn primary small" disabled={isPay && data.jobs.length === 0} onClick={onAdd}>{isPay ? "+ Tahsilat" : "+ Gider"}</button>
      </div>
      {isPay && data.jobs.length === 0 && <Empty text="Tahsilat girmek için önce İşler sekmesinden bir iş (sözleşme) açın." />}
      {rows.length === 0 ? (all.length > 0 || !isPay) && <Empty text={isPay ? "Bu seçimde tahsilat yok." : "Bu seçimde gider yok. Kira, maaş, yazılım, baskı gibi ofis giderlerinizi girin; isterseniz bir işe bağlayın."} /> : (
        <table className="office-table">
          <thead><tr><th>Tarih</th><th>{isPay ? "İş" : "Kalem"}</th><th>{isPay ? "Ödeme şekli" : "Kime / iş"}</th><th className="num">Tutar</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="nowrap">{fmtDay(r.date)}</td>
                <td>{isPay ? jobLabel(r.job_id) : (r as Expense).category}{r.note && <div className="muted small clamp">{r.note}</div>}</td>
                <td className="small">{isPay ? (r as Payment).method : [(r as Expense).vendor, jobLabel(r.job_id)].filter(Boolean).join(" · ")}</td>
                <td className="num">{money(r.amount)}</td>
                <td className="row-acts">
                  <button className="link small" onClick={() => onEdit(r)}>Düzenle</button>
                  <button className="link small danger" onClick={() => onDelete(r)}>Sil</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={3}>Toplam ({rows.length} kayıt)</td><td className="num"><b>{money(total)}</b></td><td /></tr></tfoot>
        </table>
      )}
    </>
  );
}

function Files({ data, busy, run, jobFilter, setJobFilter, jobOptions, jobLabel, clientName, search, match, saveFile, onDelete, setErr }: {
  data: OfficeData; busy: boolean; run: (fn: () => Promise<OfficeData | void>) => Promise<boolean>;
  jobFilter: number | null; setJobFilter: (id: number | null) => void; jobOptions: (e: string | null) => React.ReactNode;
  jobLabel: (id: number | null) => string; clientName: (id: number | null) => string; search: React.ReactNode;
  match: (...s: (string | number | null | undefined)[]) => boolean; saveFile: (name: string, b: Blob) => Promise<void>;
  onDelete: (f: OfficeFile) => void; setErr: (e: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const st = data.storage;
  const upload = async (list: FileList | File[]) => {
    const files = [...list];
    const big = files.find((f) => f.size > st.maxFile);
    if (big) { setErr(`“${big.name}” çok büyük (en fazla ${fmtSize(st.maxFile)}).`); return; }
    for (let i = 0; i < files.length; i++) {
      setProgress(`Yükleniyor ${i + 1}/${files.length}: ${files[i].name}`);
      if (!(await run(() => uploadFile(files[i], { job_id: jobFilter })))) break;
    }
    setProgress(null);
  };
  const open = async (f: OfficeFile) => {
    await run(async () => {
      const blob = await downloadFile(f);
      if (desktop) {
        const dot = f.name.lastIndexOf(".");
        const r = await desktop.saveAndOpen("Ofis", dot > 0 ? f.name.slice(0, dot) : f.name, dot > 0 ? f.name.slice(dot + 1) : "bin", await blob.arrayBuffer());
        if (!r.ok) throw new Error(r.error ?? "Dosya açılamadı.");
      } else await saveFile(f.name, blob);
    });
  };
  const rows = data.files.filter((f) => (jobFilter == null || f.job_id === jobFilter) && match(f.name, f.note, jobLabel(f.job_id), clientName(f.client_id)));
  const pct = Math.min(100, (st.used / Math.max(1, st.quota)) * 100);
  return (
    <>
      <div className="office-bar">
        <select value={jobFilter ?? ""} onChange={(e) => setJobFilter(e.target.value ? +e.target.value : null)}>{jobOptions("Tüm dosyalar")}</select>
        {search}
        <span className="spacer" />
        <span className="muted small">{fmtSize(st.used)} / {fmtSize(st.quota)}</span>
      </div>
      <div className={`drop ${drag ? "on" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) void upload(e.dataTransfer.files); }}>
        <div className={`bar ${pct >= 85 ? "low" : ""}`}><div style={{ width: `${pct}%` }} /></div>
        <p className="small">
          {progress ?? <>DWG, PDF, fotoğraf, sözleşme, ruhsat… Dosyaları buraya bırakın ya da <button className="link" disabled={busy} onClick={() => input.current?.click()}>dosya seçin</button>.
            {jobFilter ? <> Yüklenenler <b>{jobLabel(jobFilter)}</b> işine bağlanır.</> : " Bir işe bağlamak için üstten iş seçin."} Tek dosya en fazla {fmtSize(st.maxFile)}.</>}
        </p>
        <input ref={input} type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = ""; }} />
      </div>
      {rows.length === 0 ? <Empty text={data.files.length ? "Bu seçimde dosya yok." : "Henüz dosya yok."} /> : (
        <table className="office-table">
          <thead><tr><th>Dosya</th><th>İş / müşteri</th><th className="num">Boyut</th><th>Tarih</th><th /></tr></thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id}>
                <td><b className="break">{f.name}</b>{f.note && <div className="muted small clamp">{f.note}</div>}</td>
                <td className="small">
                  <select className="inline" value={f.job_id ?? ""} onChange={(e) => void run(() => updateFile(f.id, { job_id: e.target.value ? +e.target.value : null }))}>{jobOptions("— işe bağlı değil")}</select>
                  {!f.job_id && f.client_id ? <div className="muted">{clientName(f.client_id)}</div> : null}
                </td>
                <td className="num small">{fmtSize(f.size)}</td>
                <td className="small nowrap">{new Date(f.created_at).toLocaleDateString("tr-TR")}</td>
                <td className="row-acts">
                  <button className="link small" onClick={() => void open(f)}>{desktop ? "Aç" : "İndir"}</button>
                  <button className="link small" onClick={() => { const n = prompt("Not", f.note); if (n != null) void run(() => updateFile(f.id, { note: n })); }}>Not</button>
                  <button className="link small danger" onClick={() => onDelete(f)}>Sil</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function EditForm({ edit, set, busy, data, projects, jobOptions, onCancel, onSave }: {
  edit: Edit; set: (k: string, v: string | number | null) => void; busy: boolean; data: OfficeData;
  projects: { id: string; title: string }[]; jobOptions: (e: string | null) => React.ReactNode; onCancel: () => void; onSave: () => void;
}) {
  const r = edit.row;
  const s = (k: string) => (r[k] == null ? "" : String(r[k]));
  const text = (k: string, label: string, p: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <label className="field"><span>{label}</span><input value={s(k)} onChange={(e) => set(k, e.target.value)} {...p} /></label>
  );
  const amount = (k: string, label: string) => text(k, label, { inputMode: "decimal", placeholder: "0", required: true });
  const date = (k: string, label: string, required = false) => text(k, label, { type: "date", required });
  const note = <label className="field full"><span>Not</span><textarea rows={2} value={s("note")} onChange={(e) => set("note", e.target.value)} /></label>;
  const isNew = r.id == null;
  const title = { clients: "Müşteri", jobs: "İş", payments: "Tahsilat", expenses: "Gider" }[edit.ent];
  return (
    <form className="office-edit grid-fields" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
      <h3 className="settings-sub full">{isNew ? `Yeni ${title.toLocaleLowerCase("tr")}` : `${title} düzenle`}</h3>
      {edit.ent === "clients" && (
        <>
          {text("name", "Ad soyad / firma", { required: true, autoFocus: true })}
          {text("phone", "Telefon", { inputMode: "tel" })}
          {text("email", "E-posta", { type: "email" })}
          {text("tax_no", "VKN / TCKN (fatura için)")}
          <label className="field full"><span>Adres</span><input value={s("address")} onChange={(e) => set("address", e.target.value)} /></label>
          {note}
        </>
      )}
      {edit.ent === "jobs" && (
        <>
          {text("title", "İş adı (ör. Yılmaz villası, avan + uygulama)", { required: true, autoFocus: true })}
          <label className="field"><span>Müşteri</span>
            <select value={s("client_id")} onChange={(e) => set("client_id", e.target.value ? +e.target.value : null)}>
              <option value="">— seçin</option>
              {data.clients.map((c: Client) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {text("fee", "Sözleşme / teklif bedeli (TL)", { inputMode: "decimal", placeholder: "0" })}
          <label className="field"><span>Durum</span>
            <select value={s("status")} onChange={(e) => set("status", e.target.value as JobStatus)}>
              {(Object.keys(JOB_STATUS) as JobStatus[]).map((k) => <option key={k} value={k}>{JOB_STATUS[k]}</option>)}
            </select>
          </label>
          {date("start_date", "Başlangıç")}
          {date("due_date", "Teslim")}
          {projects.length > 0 && (
            <label className="field full"><span>Planhane tasarımı (isteğe bağlı)</span>
              <select value={s("project_id")} onChange={(e) => { const p = projects.find((x) => x.id === e.target.value); set("project_id", p?.id ?? ""); set("project_title", p?.title ?? ""); }}>
                <option value="">— bağlı değil</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </label>
          )}
          {note}
        </>
      )}
      {edit.ent === "payments" && (
        <>
          <label className="field full"><span>İş</span>
            <select required value={s("job_id")} onChange={(e) => set("job_id", e.target.value ? +e.target.value : null)}>{jobOptions("— seçin")}</select>
          </label>
          {amount("amount", "Tutar (TL)")}
          {date("date", "Tarih", true)}
          <label className="field"><span>Ödeme şekli</span>
            <select value={s("method")} onChange={(e) => set("method", e.target.value)}>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select>
          </label>
          {note}
        </>
      )}
      {edit.ent === "expenses" && (
        <>
          {amount("amount", "Tutar (TL, KDV dahil)")}
          {date("date", "Tarih", true)}
          <label className="field"><span>Kalem</span>
            <select value={s("category")} onChange={(e) => set("category", e.target.value)}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          </label>
          {text("vendor", "Kime / nereden")}
          <label className="field full"><span>İş (isteğe bağlı)</span>
            <select value={s("job_id")} onChange={(e) => set("job_id", e.target.value ? +e.target.value : null)}>{jobOptions("— genel ofis gideri")}</select>
          </label>
          {note}
        </>
      )}
      <div className="row end full">
        <button type="button" className="btn ghost" onClick={onCancel}>Vazgeç</button>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? "Kaydediliyor…" : "Kaydet"}</button>
      </div>
    </form>
  );
}
