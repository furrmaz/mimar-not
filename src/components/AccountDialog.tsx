import { useEffect, useState } from "react";
import {
  cachedMe, changePassword, cloudBase, fmtDate, fmtTry, getPublicConfig, login, logout, refreshMe, register, remaining, signedIn,
  type Me, type PublicConfig,
} from "../cloud";

const STATUS: Record<Me["status"], string> = { trial: "Deneme", active: "Abone", expired: "Süresi doldu", disabled: "Kapalı" };

/** Mimar Not hesabı: giriş / kayıt, abonelik durumu, kalan haklar, havale/EFT ile abone olma. */
export function AccountDialog({ onClose, reason }: { onClose: () => void; reason?: string | null }) {
  const [me, setMe] = useState<Me | null>(signedIn() ? cachedMe() : null);
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const [mode, setMode] = useState<"login" | "register">("register");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ email: "", password: "", name: "", office: "", phone: "", accept: false });
  const [showPlans, setShowPlans] = useState(false);
  const set = (k: keyof typeof f, v: string | boolean) => setF({ ...f, [k]: v });

  useEffect(() => {
    getPublicConfig().then(setCfg).catch(() => {});
    if (signedIn()) refreshMe().then(setMe).catch(() => {});
  }, []);
  useEffect(() => { if (me && (me.status !== "active" || reason)) setShowPlans(true); }, [me?.status]);

  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      const m = mode === "login" ? await login(f.email, f.password) : await register({ email: f.email, password: f.password, name: f.name, office: f.office, phone: f.phone, acceptTerms: f.accept });
      setMe(m);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const base = cloudBase();
  const trial = cfg?.trial;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal account-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="acc-title">
        <h2 id="acc-title">Mimar Not hesabı</h2>
        {reason && <div className="warn-box">{reason}</div>}
        {!me ? (
          <>
            <div className="seg">
              <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Hesap aç{trial ? ` · ${trial.days} gün ücretsiz` : ""}</button>
              <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Giriş yap</button>
            </div>
            {mode === "register" && trial && (
              <p className="muted small">Deneme: {trial.days} gün içinde {trial.generate} proje üretimi ve {trial.render} gerçekçi render. Kart bilgisi istemiyoruz; API anahtarı gerekmez.</p>
            )}
            <form className="grid-fields" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
              {mode === "register" && (
                <>
                  <label className="field"><span>Ad Soyad</span><input value={f.name} onChange={(e) => set("name", e.target.value)} autoComplete="name" /></label>
                  <label className="field"><span>Ofis / firma</span><input value={f.office} onChange={(e) => set("office", e.target.value)} autoComplete="organization" /></label>
                  <label className="field"><span>Telefon</span><input value={f.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="tel" inputMode="tel" /></label>
                </>
              )}
              <label className="field"><span>E-posta</span><input type="email" required value={f.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" /></label>
              <label className="field"><span>Parola{mode === "register" ? " (en az 8 karakter)" : ""}</span><input type="password" required minLength={mode === "register" ? 8 : 1} value={f.password} onChange={(e) => set("password", e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} /></label>
              {mode === "register" && (
                <label className="check full">
                  <input type="checkbox" checked={f.accept} onChange={(e) => set("accept", e.target.checked)} />
                  <span><a href={`${base}/kosullar`} target="_blank" rel="noreferrer">Kullanım koşullarını</a> ve <a href={`${base}/kvkk`} target="_blank" rel="noreferrer">KVKK aydınlatma metnini</a> okudum, kabul ediyorum.</span>
                </label>
              )}
              {err && <div className="error full">{err}</div>}
              <div className="row end full">
                <button className="btn ghost" type="button" onClick={onClose}>Kapat</button>
                <button className="btn primary" type="submit" disabled={busy || (mode === "register" && !f.accept)}>{busy ? "Bekleyin…" : mode === "login" ? "Giriş yap" : "Hesabı aç ve denemeye başla"}</button>
              </div>
              {mode === "login" && <p className="muted small full">Parolanızı unuttuysanız {cfg?.payment.email ? <a href={`mailto:${cfg.payment.email}`}>{cfg.payment.email}</a> : "destek hattına"} yazın; parolanızı sıfırlayalım.</p>}
            </form>
          </>
        ) : (
          <>
            <div className="acc-head">
              <div>
                <b>{me.name || me.email}</b>
                <div className="muted small">{me.email}{me.office ? ` · ${me.office}` : ""} · Müşteri no: <b>{me.ref}</b></div>
              </div>
              <span className={`badge ${me.status === "active" ? "ok" : "warn"}`}>{STATUS[me.status]}{me.plan ? ` · ${me.plan.label}` : ""}</span>
            </div>
            {me.status === "active" || me.status === "trial" ? (
              <>
                <Usage label="Proje üretimi / düzeltme" used={me.used.generate} limit={me.limits.generate} />
                <Usage label="Gerçekçi render" used={me.used.render} limit={me.limits.render} />
                <p className="muted small">
                  {me.status === "trial" ? `Deneme ${fmtDate(me.until)} tarihinde bitiyor.` : `Abonelik ${fmtDate(me.until)} tarihine kadar geçerli. Haklar ${fmtDate(me.periodEnd)} tarihinde yenilenir.`}
                  {" "}Hata veren ya da durdurulan üretimler haktan düşmez.
                </p>
              </>
            ) : (
              <p>{me.status === "expired" ? "Aboneliğiniz ya da deneme süreniz bitti. Projeleriniz bu cihazda duruyor; çizimleri açıp dışa aktarabilirsiniz. Yeni üretim için abone olun." : "Hesabınız kapalı. Bizimle iletişime geçin."}</p>
            )}
            {!showPlans && <button className="link" onClick={() => setShowPlans(true)}>Planlar ve aboneliği uzatma →</button>}
            {showPlans && cfg && <Subscribe cfg={cfg} me={me} />}
            <details className="small" style={{ marginTop: 10 }}>
              <summary>Parola değiştir</summary>
              <PasswordForm />
            </details>
            <div className="row end">
              <button className="btn ghost" onClick={async () => { await logout(); setMe(null); }}>Çıkış yap</button>
              <button className="btn primary" onClick={onClose}>Tamam</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Usage({ label, used, limit }: { label: string; used: number; limit: number }) {
  // kalan hak oranı: dolu çubuk = çok hak var
  const pct = limit ? Math.max(0, Math.min(100, ((limit - used) / limit) * 100)) : 0;
  return (
    <div className="usage">
      <div className="row" style={{ justifyContent: "space-between" }}><span className="small">{label}</span><span className="small"><b>{Math.max(0, limit - used)}</b> / {limit} kaldı</span></div>
      <div className={`bar ${pct <= 15 ? "low" : ""}`}><div style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function Subscribe({ cfg, me }: { cfg: PublicConfig; me: Me }) {
  const [pick, setPick] = useState(cfg.plans.find((p) => p.highlight)?.id ?? cfg.plans[0]?.id);
  const [months, setMonths] = useState(1);
  const [copied, setCopied] = useState(false);
  const plan = cfg.plans.find((p) => p.id === pick);
  const pay = cfg.payment;
  const total = plan ? plan.priceTry * months : 0;
  const msg = `Merhaba, Mimar Not ${plan?.label} planı için ${months} aylık ${fmtTry(total)} ödeme yaptım. Müşteri no: ${me.ref}, e-posta: ${me.email}`;
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* yoksay */ } };
  return (
    <div className="subscribe">
      <h3 className="settings-sub">Abone ol / uzat</h3>
      <div className="plans">
        {cfg.plans.map((p) => (
          <label key={p.id} className={`plan ${pick === p.id ? "on" : ""} ${p.highlight ? "hl" : ""}`}>
            <input type="radio" name="plan" checked={pick === p.id} onChange={() => setPick(p.id)} />
            <b>{p.label}</b>
            <span className="price">{fmtTry(p.priceTry)}<span className="muted small"> / ay</span></span>
            <ul className="small">{p.features.map((x) => <li key={x}>{x}</li>)}</ul>
          </label>
        ))}
      </div>
      <div className="row" style={{ gap: 10, flexWrap: "wrap", margin: "8px 0" }}>
        <label className="small">Süre{" "}
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            {[1, 3, 6, 12].map((m) => <option key={m} value={m}>{m} ay</option>)}
          </select>
        </label>
        <span>Toplam: <b>{fmtTry(total)}</b> <span className="muted small">(KDV dahil)</span></span>
      </div>
      <div className="pay-box">
        <b>Havale / EFT ile ödeme</b>
        {pay.iban ? (
          <ol className="small">
            <li>Aşağıdaki hesaba <b>{fmtTry(total)}</b> gönderin. Açıklamaya mutlaka <b>{me.ref}</b> yazın.</li>
            <li>
              <div className="iban">
                <span>{pay.bank}{pay.holder ? ` · ${pay.holder}` : ""}</span>
                <code>{pay.iban}</code>
                <button className="btn small" onClick={() => copy(pay.iban.replace(/\s/g, ""))}>{copied ? "Kopyalandı" : "IBAN'ı kopyala"}</button>
              </div>
            </li>
            <li>Dekontu gönderin; aboneliğiniz aynı gün (genelde 1 saat içinde) açılır ve bu ekranda görünür.
              <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                {pay.whatsapp && <a className="btn small primary" href={`https://wa.me/${pay.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer">WhatsApp'tan dekont gönder</a>}
                {pay.email && <a className="btn small" href={`mailto:${pay.email}?subject=${encodeURIComponent(`Mimar Not ödeme ${me.ref}`)}&body=${encodeURIComponent(msg)}`}>E-postayla gönder</a>}
              </div>
            </li>
          </ol>
        ) : (
          <p className="small">Ödeme bilgileri için {pay.email ? <a href={`mailto:${pay.email}`}>{pay.email}</a> : "bizimle"} iletişime geçin. Müşteri numaranız: <b>{me.ref}</b></p>
        )}
        <p className="muted small">Fatura bilgileriniz için dekontla birlikte firma unvanı ve vergi numaranızı iletin.</p>
      </div>
    </div>
  );
}

function PasswordForm() {
  const [a, setA] = useState(""), [b, setB] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 6 }} onSubmit={async (e) => {
      e.preventDefault();
      try { await changePassword(a, b); setMsg("Parola değişti."); setA(""); setB(""); } catch (er) { setMsg((er as Error).message); }
    }}>
      <input type="password" placeholder="Mevcut parola" value={a} onChange={(e) => setA(e.target.value)} autoComplete="current-password" />
      <input type="password" placeholder="Yeni parola" value={b} onChange={(e) => setB(e.target.value)} minLength={8} autoComplete="new-password" />
      <button className="btn small" disabled={!a || b.length < 8}>Değiştir</button>
      {msg && <span className="small">{msg}</span>}
    </form>
  );
}

/** Üst çubuktaki hesap düğmesi: durum ve kalan üretim hakkı */
export function AccountChip({ me, onClick }: { me: Me | null; onClick: () => void }) {
  if (!me) return <button className="btn small primary" onClick={onClick}>Giriş yap / Ücretsiz dene</button>;
  const left = remaining(me, "generate");
  const warn = me.status === "expired" || me.status === "disabled" || left === 0;
  return (
    <button className={`badge as-button ${warn ? "warn" : "ok"}`} onClick={onClick} title="Hesap ve abonelik">
      {me.status === "expired" ? "Abonelik bitti · Yenile" : me.status === "disabled" ? "Hesap kapalı" : `${me.status === "trial" ? "Deneme" : me.plan?.label ?? "Abone"} · ${left} üretim kaldı`}
    </button>
  );
}
