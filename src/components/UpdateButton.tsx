import { useEffect, useState } from "react";
import { desktop, type UpdateState } from "../desktop";
import { APP_VERSION, isNative } from "../platform";

const newer = (a: string, b: string) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

/** Android: GitHub'daki son sürümü denetler, yenisi varsa APK bağlantısı gösterir. */
function MobileUpdate() {
  const [rel, setRel] = useState<{ v: string; url: string } | null>(null);
  useEffect(() => {
    fetch("https://api.github.com/repos/furrmaz/mimar-not/releases/latest")
      .then((r) => r.json())
      .then((d) => {
        const v = String(d.tag_name ?? "").replace(/^v/, "");
        const apk = (d.assets ?? []).find((a: { name: string }) => a.name.endsWith(".apk"));
        if (v && apk && APP_VERSION && newer(v, APP_VERSION)) setRel({ v, url: apk.browser_download_url });
      })
      .catch(() => {});
  }, []);
  if (!rel) return null;
  return <a className="btn small primary" href={rel.url} target="_blank" rel="noreferrer">Sürüm {rel.v} çıktı · İndir</a>;
}

/** Masaüstünde güncelleme denetimi: sürüm + durum + "yeniden başlat" düğmesi. */
export function UpdateButton({ onMessage }: { onMessage: (m: string) => void }) {
  const [version, setVersion] = useState("");
  const [st, setSt] = useState<UpdateState | null>(null);
  const [manual, setManual] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    desktop.version().then(setVersion);
    return desktop.onUpdate((u) => setSt(u));
  }, []);
  useEffect(() => {
    if (!st || !manual) return;
    if (st.state === "none") { onMessage(`En güncel sürümü kullanıyorsunuz (${version}).`); setManual(false); }
    if (st.state === "error") { onMessage(`Güncelleme denetlenemedi: ${st.message ?? ""}`); setManual(false); }
    if (st.state === "unsupported") { onMessage(st.message ?? ""); setManual(false); }
  }, [st, manual, version, onMessage]);
  useEffect(() => desktop?.onMenu((cmd) => cmd === "update" && setManual(true)), []);
  if (!desktop) return isNative() ? <MobileUpdate /> : null;

  if (st?.state === "ready")
    return <button className="btn small primary" onClick={() => desktop!.installUpdate()} title="Uygulama kapanıp yeni sürüm kurulur">Sürüm {st.version} hazır · Yeniden başlat</button>;
  if (st?.state === "available" || st?.state === "downloading")
    return <span className="badge">Sürüm {st.version} indiriliyor{st.percent != null ? ` · %${st.percent}` : "…"}</span>;
  return (
    <button
      className="btn ghost small"
      disabled={st?.state === "checking"}
      onClick={() => { setManual(true); desktop!.checkUpdate(); }}
      title="GitHub Releases'ta yeni sürüm var mı bak"
    >
      {st?.state === "checking" ? "Denetleniyor…" : `v${version} · Güncellemeleri denetle`}
    </button>
  );
}

/** Ayarlar > Güncellemeler: sürüm, durum ve elle denetim (masaüstü, Android ve web). */
export function UpdateSettings() {
  const [version, setVersion] = useState(APP_VERSION);
  const [st, setSt] = useState<UpdateState | null>(null);
  const [mob, setMob] = useState<{ state: "checking" | "none" | "available" | "error"; v?: string; url?: string } | null>(null);
  useEffect(() => {
    if (!desktop) return;
    desktop.version().then(setVersion);
    return desktop.onUpdate((u) => setSt(u));
  }, []);
  const checkMobile = () => {
    setMob({ state: "checking" });
    fetch("https://api.github.com/repos/furrmaz/mimar-not/releases/latest")
      .then((r) => r.json())
      .then((d) => {
        const v = String(d.tag_name ?? "").replace(/^v/, "");
        const apk = (d.assets ?? []).find((a: { name: string }) => a.name.endsWith(".apk"));
        if (v && apk && APP_VERSION && newer(v, APP_VERSION)) setMob({ state: "available", v, url: apk.browser_download_url });
        else setMob({ state: "none" });
      })
      .catch(() => setMob({ state: "error" }));
  };

  let status: React.ReactNode = null, action: React.ReactNode = null;
  if (desktop) {
    const s = st?.state;
    status =
      s === "checking" ? "Yeni sürüm aranıyor…" :
      s === "available" || s === "downloading" ? `Sürüm ${st?.version} indiriliyor${st?.percent != null ? ` · %${st.percent}` : "…"}` :
      s === "ready" ? `Sürüm ${st?.version} indirildi, kurulmaya hazır.` :
      s === "none" ? "En güncel sürümü kullanıyorsunuz." :
      s === "error" ? `Güncelleme denetlenemedi: ${st?.message ?? ""}` :
      s === "unsupported" ? (st?.message ?? "") :
      "Uygulama açılışta güncellemeleri kendisi denetler ve arka planda indirir.";
    action = s === "ready"
      ? <button className="btn primary small" onClick={() => desktop!.installUpdate()}>Yeniden başlat ve kur</button>
      : <button className="btn small" disabled={s === "checking" || s === "downloading" || s === "available"} onClick={() => desktop!.checkUpdate()}>Güncellemeleri denetle</button>;
  } else if (isNative()) {
    status =
      mob?.state === "checking" ? "Yeni sürüm aranıyor…" :
      mob?.state === "available" ? `Sürüm ${mob.v} çıktı. İndirip kurduğunuzda projeleriniz korunur.` :
      mob?.state === "none" ? "En güncel sürümü kullanıyorsunuz." :
      mob?.state === "error" ? "Güncelleme denetlenemedi. İnternet bağlantınızı kontrol edin." :
      "Yeni sürüm çıktığında üst çubukta indirme düğmesi görünür.";
    action = mob?.state === "available"
      ? <a className="btn primary small" href={mob.url} target="_blank" rel="noreferrer">Sürüm {mob.v} · İndir</a>
      : <button className="btn small" disabled={mob?.state === "checking"} onClick={checkMobile}>Güncellemeleri denetle</button>;
  } else {
    status = "Web sürümü her zaman en günceldir; yenilikler sayfayı yenilediğinizde gelir.";
    action = <button className="btn small" onClick={() => location.reload()}>Sayfayı yenile</button>;
  }
  return (
    <>
      <h3 className="settings-sub">Güncellemeler</h3>
      <div className="update-box">
        <div>
          <b>Planhane {version ? `v${version}` : ""}</b>
          <p className="muted small" role="status">{status}</p>
        </div>
        {action}
      </div>
    </>
  );
}
