import { useEffect, useState } from "react";
import { desktop } from "../desktop";
import { loadOffice, saveOffice, type OfficeInfo } from "../office";

/** Ayarlar: antet (ofis) bilgileri; masaüstünde ayrıca Claude API anahtarı (Windows'ta şifreli saklanır). */
export function SettingsDialog({ onClose, onOffice }: { onClose: () => void; onOffice?: (o: OfficeInfo) => void }) {
  const [office, setOffice] = useState<OfficeInfo>(loadOffice);
  const setO = (k: keyof OfficeInfo, v: string) => {
    const o = { ...office, [k]: v };
    setOffice(o);
    saveOffice(o);
    onOffice?.(o);
  };
  const [info, setInfo] = useState<{ hasKey: boolean; keyHint: string; outputRoot: string } | null>(null);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { desktop?.getSettings().then(setInfo); }, []);
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
        <h3 className="settings-sub">Pafta anteti</h3>
        <div className="grid-fields">
          <label className="field"><span>Ofis adı</span><input value={office.office} onChange={(e) => setO("office", e.target.value)} placeholder="ör. Atölye Mimarlık" /></label>
          <label className="field"><span>Mimar</span><input value={office.architect} onChange={(e) => setO("architect", e.target.value)} placeholder="Ad Soyad" /></label>
          <label className="field"><span>Oda sicil no</span><input value={office.regNo} onChange={(e) => setO("regNo", e.target.value)} /></label>
          <label className="field"><span>İletişim</span><input value={office.contact} onChange={(e) => setO("contact", e.target.value)} placeholder="telefon / e-posta" /></label>
        </div>
        <p className="muted small">Bu bilgiler tüm paftaların (SVG, PNG, PDF, DXF) antet kutusuna yazılır; değişiklik hemen kaydedilir.</p>
        {desktop && (
          <>
            <h3 className="settings-sub">Claude bağlantısı</h3>
            <label className="field">
              <span>Claude API anahtarı</span>
              <input id="api-key" type="password" value={key} placeholder={info?.hasKey ? `Kayıtlı (…${info.keyHint}). Değiştirmek için yenisini yapıştırın` : "sk-ant-…"} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
            </label>
            <p className="muted small">
              Anahtarı <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">platform.claude.com</a> adresinden alabilirsiniz. Anahtar yalnızca bu bilgisayarda, Windows kullanıcı hesabınıza bağlı olarak şifreli saklanır ve sadece Claude API'ye gönderilir.
            </p>
            {info && <p className="muted small">Çıktılar şuraya kaydedilir: {info.outputRoot}</p>}
            {msg && <div className="note-ok">{msg}</div>}

          </>
        )}
        <div className="row end">
          <button className="btn ghost" onClick={onClose}>Kapat</button>
          {desktop && <button className="btn primary" onClick={save} disabled={!key.trim() && !info?.hasKey}>{key.trim() ? "Kaydet" : "Anahtarı sil"}</button>}
        </div>
      </div>
    </div>
  );
}
