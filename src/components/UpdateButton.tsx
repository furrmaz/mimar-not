import { useEffect, useState } from "react";
import { desktop, type UpdateState } from "../desktop";

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
  if (!desktop) return null;

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
