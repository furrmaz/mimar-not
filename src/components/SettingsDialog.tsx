import { useEffect, useState } from "react";
import { desktop } from "../desktop";

/** Masaüstü ayarları: Claude API anahtarı (Windows'ta şifreli saklanır). */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<{ hasKey: boolean; keyHint: string; outputRoot: string } | null>(null);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { desktop?.getSettings().then(setInfo); }, []);
  if (!desktop) return null;
  const save = async () => {
    const k = key.trim();
    if (k && !k.startsWith("sk-ant-")) { setMsg("Anahtar 'sk-ant-' ile başlamalı. Konsoldan kopyaladığınız anahtarı yapıştırın."); return; }
    const r = await desktop!.setApiKey(k);
    setMsg(r.hasKey ? "Anahtar kaydedildi." : "Anahtar silindi.");
    setKey("");
    setInfo(await desktop!.getSettings());
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="settings-title">
        <h2 id="settings-title">Ayarlar</h2>
        <label className="field">
          <span>Claude API anahtarı</span>
          <input id="api-key" type="password" value={key} placeholder={info?.hasKey ? `Kayıtlı (…${info.keyHint}). Değiştirmek için yenisini yapıştırın` : "sk-ant-…"} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} autoFocus />
        </label>
        <p className="muted small">
          Anahtarı <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">platform.claude.com</a> adresinden alabilirsiniz. Anahtar yalnızca bu bilgisayarda, Windows kullanıcı hesabınıza bağlı olarak şifreli saklanır ve sadece Claude API'ye gönderilir.
        </p>
        {info && <p className="muted small">Çıktılar şuraya kaydedilir: {info.outputRoot}</p>}
        {msg && <div className="note-ok">{msg}</div>}
        <div className="row end">
          <button className="btn ghost" onClick={onClose}>Kapat</button>
          <button className="btn primary" onClick={save} disabled={!key.trim() && !info?.hasKey}>{key.trim() ? "Kaydet" : "Anahtarı sil"}</button>
        </div>
      </div>
    </div>
  );
}
