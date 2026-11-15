import { useEffect, useState } from "react";
import type { Program } from "../shared/schema";
import { CloudError, createShare, deleteShare, fmtDate, listShares, requestAccountDialog, shareComments, shareUrl, signedIn, type ShareComment, type ShareRow } from "../cloud";

/** Müşteriyle paylaş: salt okunur bağlantı oluşturur, yorumları gösterir. */
export function ShareDialog({ program, projectId, onClose }: { program: Program; projectId: string; onClose: () => void }) {
  const [rows, setRows] = useState<ShareRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [comments, setComments] = useState<Record<string, ShareComment[]>>({});
  const mine = rows?.find((r) => r.projectId === projectId) ?? null;

  const load = async () => {
    try {
      const list = await listShares();
      setRows(list);
      const cur = list.find((r) => r.projectId === projectId);
      if (cur?.comments) setComments((c) => ({ ...c }));
      if (cur) setComments({ [cur.token]: await shareComments(cur.token) });
    } catch (e) { setErr((e as Error).message); setRows([]); }
  };
  useEffect(() => { if (signedIn()) void load(); else setRows([]); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const publish = async () => {
    if (!signedIn()) { requestAccountDialog("Müşteriyle paylaşmak için Planhane hesabınıza giriş yapın."); return; }
    setBusy(true); setErr(null);
    try {
      // görüşme notları, görseller ve geçmiş paylaşılmaz; yalnız bina programı gider
      await createShare(program, projectId, program.projectName);
      await load();
    } catch (e) { setErr(e instanceof CloudError ? e.message : "Bağlantı oluşturulamadı."); }
    finally { setBusy(false); }
  };
  const close = async (token: string) => {
    if (!confirm("Bağlantı kapatılsın mı? Müşteriniz artık projeyi açamaz, yorumlar silinir.")) return;
    setBusy(true);
    try { await deleteShare(token); await load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { prompt("Bağlantıyı kopyalayın:", url); }
  };
  const url = mine ? shareUrl(mine.token) : "";
  const wa = mine ? `https://wa.me/?text=${encodeURIComponent(`${program.projectName} ön tasarımı: ${url}`)}` : "";

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal share-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="share-title">
        <h2 id="share-title">Müşteriyle paylaş</h2>
        <p className="muted small" style={{ margin: 0 }}>Müşteriniz bağlantıyı telefonundan ya da bilgisayarından açar; 3D modeli döndürür, planlara ve cephelere bakar, yorum bırakır. Giriş yapması gerekmez. Görüşme notlarınız ve görselleriniz paylaşılmaz.</p>
        {rows === null && <p className="muted">Yükleniyor…</p>}
        {rows !== null && !mine && <button className="btn" disabled={busy} onClick={publish}>{busy ? "Oluşturuluyor…" : "Paylaşım bağlantısı oluştur"}</button>}
        {mine && (
          <>
            <div className="share-link"><input readOnly value={url} onFocus={(e) => e.currentTarget.select()} /><button className="btn small" onClick={() => copy(url)}>{copied ? "Kopyalandı" : "Kopyala"}</button></div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <a className="btn ghost small" href={wa} target="_blank" rel="noreferrer">WhatsApp ile gönder</a>
              <button className="btn ghost small" disabled={busy} onClick={publish} title="Projede yaptığınız son değişiklikleri aynı bağlantıya yansıtır">{busy ? "Güncelleniyor…" : "Bağlantıyı güncelle"}</button>
              <button className="btn ghost small" disabled={busy} onClick={() => close(mine.token)}>Bağlantıyı kapat</button>
            </div>
            <div className="muted small">Son güncelleme {fmtDate(mine.updatedAt)} · {mine.views} görüntülenme. Bağlantı, siz güncelleyene kadar o günkü projeyi gösterir.</div>
            <h3 style={{ margin: "6px 0 0", fontSize: 15 }}>Müşteri yorumları ({comments[mine.token]?.length ?? mine.comments})</h3>
            {(comments[mine.token] ?? []).length === 0 && <p className="muted small" style={{ margin: 0 }}>Henüz yorum yok.</p>}
            <ul className="share-comments">
              {(comments[mine.token] ?? []).slice().reverse().map((c) => (
                <li key={c.id}><b>{c.name || "Müşteri"}</b> <span className="muted small">{new Date(c.at).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span><div>{c.text}</div></li>
              ))}
            </ul>
          </>
        )}
        {err && <p className="error" style={{ margin: 0 }}>{err}</p>}
        {rows && rows.filter((r) => r.projectId !== projectId).length > 0 && (
          <details>
            <summary className="small">Diğer projelerin bağlantıları ({rows.filter((r) => r.projectId !== projectId).length})</summary>
            <ul className="share-comments">
              {rows.filter((r) => r.projectId !== projectId).map((r) => (
                <li key={r.token}><b>{r.title}</b> <span className="muted small">{fmtDate(r.updatedAt)} · {r.comments} yorum · {r.views} görüntülenme</span>
                  <div><button className="link" onClick={() => copy(shareUrl(r.token))}>Bağlantıyı kopyala</button> · <button className="link" onClick={() => close(r.token)}>Kapat</button></div></li>
              ))}
            </ul>
          </details>
        )}
        <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn ghost" onClick={onClose}>Kapat</button></div>
      </div>
    </div>
  );
}
