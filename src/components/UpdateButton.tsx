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
