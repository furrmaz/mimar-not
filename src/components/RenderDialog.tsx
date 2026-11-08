import { useEffect, useRef, useState } from "react";
import type { Program } from "../shared/schema";
import { CUSTOM_MODEL_ID, RENDER_MODELS, USD_TRY_HINT, renderPrompt } from "../shared/render";
import { callRender, hasHiggsfield, type RenderResult } from "../platform";
import { saveOutput } from "../store";

const PREF = "mimarnot.render";
interface Pref { modelId: string; customPath: string; hi: boolean; useRefs: boolean; aspect: string }
const loadPref = (): Pref => {
  const d: Pref = { modelId: RENDER_MODELS[0].id, customPath: "", hi: true, useRefs: true, aspect: "16:9" };
  try { return { ...d, ...JSON.parse(localStorage.getItem(PREF) ?? "{}") }; } catch { return d; }
};

/** 3D görünümden Higgsfield ile fotoğraf gerçekliğinde render. */
export function RenderDialog({ program, refImages, capture, onClose, onSettings }: {
  program: Program;
  refImages: string[];
  capture: () => string | null;
  onClose: () => void;
  onSettings: () => void;
}) {
  const [pref, setPref] = useState<Pref>(loadPref);
  const set = (p: Partial<Pref>) => { const n = { ...pref, ...p }; setPref(n); try { localStorage.setItem(PREF, JSON.stringify(n)); } catch { /* yok say */ } };
  const [view, setView] = useState<string | null>(null);
  const [extra, setExtra] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<(RenderResult & { at: number })[]>([]);
  const [keyOk, setKeyOk] = useState<boolean | null>(null);
  const ac = useRef<AbortController | null>(null);
  useEffect(() => { setView(capture()); hasHiggsfield().then(setKeyOk).catch(() => setKeyOk(false)); }, []);
  useEffect(() => () => ac.current?.abort(), []);

  const model = RENDER_MODELS.find((m) => m.id === pref.modelId);
  const refs = pref.useRefs && model?.maxRefs !== 1 ? refImages.slice(0, Math.max(0, (model?.maxRefs ?? 4) - 1)) : [];
  const run = async () => {
    if (!view) return;
    setError(null);
    ac.current = new AbortController();
    setStatus("Başlıyor…");
    try {
      const out = await callRender(
        { view, refs, prompt: renderPrompt(program, extra.trim(), refs.length), modelId: pref.modelId, customPath: pref.customPath, aspect: pref.aspect, hi: pref.hi },
        { signal: ac.current.signal, onStatus: setStatus },
      );
      setResults((r) => [{ ...out, at: Date.now() }, ...r]);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setStatus(null);
    }
  };
  const save = async (r: RenderResult) => {
    if (r.data) {
      const blob = await (await fetch(r.data)).blob();
      await saveOutput(`${program.projectName}-render`, "png", blob);
    } else window.open(r.url, "_blank");
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal render-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="render-title">
        <h2 id="render-title">Gerçekçi render (Higgsfield)</h2>
        {keyOk === false && (
          <div className="warn-box">
            Higgsfield anahtarı girilmemiş. <button className="link" onClick={onSettings}>Ayarlar'dan</button> Key ID ve Secret girin (anahtarı <a href="https://cloud.higgsfield.ai" target="_blank" rel="noreferrer">cloud.higgsfield.ai</a> → API Keys bölümünden alırsınız).
          </div>
        )}
        <div className="render-grid">
          <div>
            <div className="muted small">Kullanılacak görüntü (3D görünümün şu anki açısı)</div>
            {view ? <img className="render-src" src={view} alt="3D görünüm" /> : <div className="muted">Görüntü alınamadı</div>}
            <button className="link small" onClick={() => setView(capture())}>Açıyı değiştirdim, yeniden al</button>
          </div>
          <div>
            <div className="field"><span>Model</span></div>
            <div className="model-list" role="radiogroup">
              {RENDER_MODELS.map((m) => (
                <label key={m.id} className={`model-opt ${pref.modelId === m.id ? "on" : ""}`}>
                  <input type="radio" name="rmodel" checked={pref.modelId === m.id} onChange={() => set({ modelId: m.id })} />
                  <span className="model-name">{m.label}</span>
                  <span className="model-price">${m.price} / görsel <span className="muted">≈ {(m.price * USD_TRY_HINT).toFixed(2).replace(".", ",")} TL</span></span>
                  <span className="muted small model-note">{m.note}</span>
                </label>
              ))}
              <label className={`model-opt ${pref.modelId === CUSTOM_MODEL_ID ? "on" : ""}`}>
                <input type="radio" name="rmodel" checked={pref.modelId === CUSTOM_MODEL_ID} onChange={() => set({ modelId: CUSTOM_MODEL_ID })} />
                <span className="model-name">Diğer model (API yolu)</span>
                <span className="model-price muted">ücret Higgsfield'da</span>
                <span className="muted small model-note">Hesabınızda açık başka bir model (ör. FLUX) için Higgsfield konsolundaki API yolunu yazın.</span>
                {pref.modelId === CUSTOM_MODEL_ID && <input className="custom-path" value={pref.customPath} placeholder="/saglayici/model-adi" onChange={(e) => set({ customPath: e.target.value })} />}
              </label>
            </div>
            <div className="row" style={{ gap: 12, flexWrap: "wrap", marginTop: 8 }}>
              <label className="check"><input type="checkbox" checked={pref.hi} onChange={(e) => set({ hi: e.target.checked })} /> 2K çözünürlük</label>
              {refImages.length > 0 && model?.maxRefs !== 1 && (
                <label className="check"><input type="checkbox" checked={pref.useRefs} onChange={(e) => set({ useRefs: e.target.checked })} /> Referans görselleri kullan ({Math.min(refImages.length, Math.max(0, (model?.maxRefs ?? 4) - 1))})</label>
              )}
              <label>Oran{" "}
                <select value={pref.aspect} onChange={(e) => set({ aspect: e.target.value })}>
                  {["16:9", "4:3", "3:2", "1:1", "3:4", "9:16"].map((a) => <option key={a}>{a}</option>)}
                </select>
              </label>
            </div>
            <label className="field" style={{ marginTop: 8 }}>
              <span>Ek talimat (isteğe bağlı)</span>
              <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="ör. gün batımı, havuz başı, yağmur sonrası ıslak zemin, kış" />
            </label>
            <p className="muted small">Ücret Higgsfield hesabınızdan düşer; fiyatlar Higgsfield'ın kendi sayfasındandır (Kasım 2026), TL karşılığı yaklaşıktır. Görüntü ve referanslar yalnızca Higgsfield'a gönderilir.</p>
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        {status && (
          <div className="busy-row">
            <div className="progress"><div /></div>
            <span className="small">{status}</span>
            <button className="btn small stop" onClick={() => ac.current?.abort()}>■ Durdur</button>
          </div>
        )}
        {results.map((r) => (
          <figure key={r.at} className="render-out">
            <img src={r.data ?? r.url} alt="Gerçekçi render" />
            <figcaption className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted small">{r.model}{r.price != null ? ` · $${r.price}` : ""}</span>
              <button className="btn small" onClick={() => save(r)}>Kaydet</button>
            </figcaption>
          </figure>
        ))}
        <div className="row end">
          <button className="btn ghost" onClick={onClose}>Kapat</button>
          <button className="btn primary" disabled={!view || !!status || keyOk === false || (pref.modelId === CUSTOM_MODEL_ID && !pref.customPath.trim())} onClick={run}>
            {results.length ? "Yeniden render" : "Render al"}
            {model ? ` · $${model.price}` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
