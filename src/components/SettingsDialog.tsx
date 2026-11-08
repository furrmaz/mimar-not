import { useEffect, useState } from "react";
import { desktop } from "../desktop";
import { loadOffice, saveOffice, type OfficeInfo } from "../office";
import { STANDALONE, loadKeys, saveKeys, platformName, APP_VERSION } from "../platform";

/** Ayarlar: antet (ofis) bilgileri; masaüstünde ayrıca Claude API anahtarı (Windows'ta şifreli saklanır). */
export function SettingsDialog({ onClose, onOffice }: { onClose: () => void; onOffice?: (o: OfficeInfo) => void }) {
  const [office, setOffice] = useState<OfficeInfo>(loadOffice);
  const setO = (k: keyof OfficeInfo, v: string) => {
    const o = { ...office, [k]: v };
    setOffice(o);
    saveOffice(o);
    onOffice?.(o);
  };
  const [info, setInfo] = useState<{ hasKey: boolean; keyHint: string; hasHiggsfield?: boolean; hfHint?: string; outputRoot: string } | null>(null);
  const [hfId, setHfId] = useState("");
  const [hfSecret, setHfSecret] = useState("");
  const [hfMsg, setHfMsg] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = async () => {
    if (desktop) setInfo(await desktop.getSettings());
    else if (STANDALONE) {
      const k = loadKeys();
      setInfo({ hasKey: Boolean(k.claude), keyHint: (k.claude ?? "").slice(-4), hasHiggsfield: Boolean(k.hfId && k.hfSecret), hfHint: (k.hfId ?? "").slice(0, 6), outputRoot: "" });
    }
  };
  useEffect(() => { refresh(); }, []);
  const save = async () => {
    const k = key.trim();
    if (k && !k.startsWith("sk-ant-")) { setMsg("Anahtar 'sk-ant-' ile başlamalı. Konsoldan kopyaladığınız anahtarı yapıştırın."); return; }
    if (desktop) await desktop.setApiKey(k);
    else saveKeys({ ...loadKeys(), claude: k || undefined });
    setMsg(k ? "Anahtar kaydedildi." : "Anahtar silindi.");
    setKey("");
    await refresh();
  };
  const saveHf = async () => {
    const id = hfId.trim(), sec = hfSecret.trim();
    if ((id && !sec) || (!id && sec)) { setHfMsg("Key ID ve Secret ikisi birlikte girilmeli."); return; }
    if (desktop?.setHiggsfield) await desktop.setHiggsfield(id, sec);
    else saveKeys({ ...loadKeys(), hfId: id || undefined, hfSecret: sec || undefined });
    setHfMsg(id ? "Higgsfield anahtarı kaydedildi." : "Higgsfield anahtarı silindi.");
    setHfId(""); setHfSecret("");
    await refresh();
  };
  const canKeys = Boolean(desktop || STANDALONE);
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
        {canKeys && (
          <>
            <h3 className="settings-sub">Claude bağlantısı</h3>
            <label className="field">
              <span>Claude API anahtarı</span>
              <input id="api-key" type="password" autoFocus={Boolean(info && !info.hasKey)} value={key} placeholder={info?.hasKey ? `Kayıtlı (…${info.keyHint}). Değiştirmek için yenisini yapıştırın` : "sk-ant-…"} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
            </label>
            <p className="muted small">
              Anahtarı <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">platform.claude.com</a> adresinden alabilirsiniz. {desktop ? "Anahtar yalnızca bu bilgisayarda, Windows kullanıcı hesabınıza bağlı olarak şifreli saklanır ve sadece Claude API'ye gönderilir." : "Anahtar yalnızca bu cihazda (uygulama/tarayıcı deposunda) saklanır ve doğrudan Claude API'ye gönderilir; başka bir sunucuya gitmez. Ortak kullanılan bir bilgisayarda işiniz bitince silin."}
            </p>
            {info?.outputRoot && <p className="muted small">Çıktılar şuraya kaydedilir: {info.outputRoot}</p>}
            {msg && <div className="note-ok">{msg}</div>}
            <div className="row end"><button className="btn primary small" onClick={save} disabled={!key.trim() && !info?.hasKey}>{key.trim() ? "Claude anahtarını kaydet" : "Claude anahtarını sil"}</button></div>
          </>
        )}
        <h3 className="settings-sub">Higgsfield (gerçekçi render)</h3>
        {canKeys ? (
            <>
              <div className="grid-fields">
                <label className="field"><span>Key ID</span><input value={hfId} onChange={(e) => setHfId(e.target.value)} placeholder={info?.hasHiggsfield ? `Kayıtlı (${info.hfHint}…)` : "Key ID"} /></label>
                <label className="field"><span>Secret</span><input type="password" value={hfSecret} onChange={(e) => setHfSecret(e.target.value)} placeholder={info?.hasHiggsfield ? "Kayıtlı" : "Secret"} /></label>
              </div>
              <p className="muted small">3D görünümdeki "Gerçekçi render" için. Anahtarı <a href="https://cloud.higgsfield.ai" target="_blank" rel="noreferrer">Higgsfield</a> hesabınızda API Keys bölümünden oluşturun; render ücreti Higgsfield bakiyenizden düşer.</p>
              {hfMsg && <div className="note-ok">{hfMsg}</div>}
              <div className="row end"><button className="btn primary small" onClick={saveHf} disabled={!hfId.trim() && !hfSecret.trim() && !info?.hasHiggsfield}>{hfId.trim() || hfSecret.trim() ? "Higgsfield anahtarını kaydet" : "Higgsfield anahtarını sil"}</button></div>
            </>
        ) : (
            <p className="muted small">Sunucu sürümünde .env dosyasına HF_API_KEY_ID ve HF_API_KEY_SECRET yazın.</p>
        )}
        {(desktop || STANDALONE) && <p className="muted small">Sürüm {APP_VERSION || "?"} · {platformName()}</p>}
        <div className="row end">
          <button className="btn ghost" onClick={onClose}>Kapat</button>
        </div>
      </div>
    </div>
  );
}
