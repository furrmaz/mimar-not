import { useEffect, useMemo, useState } from "react";
import type { Program } from "../shared/schema";
import { buildLayout } from "../geometry/layout";
import { blockView, isMultiBlock } from "../geometry/blocks";
import { elevationSVG, FACADE_NAMES, planSVG, sectionSVG, sitePlanSVG, type Facade } from "../geometry/svg";
import { areaTable } from "../geometry/roomcheck";
import { getPublicShare, postShareComment, type PublicShare, type ShareComment } from "../cloud";
import { ThreeView } from "./ThreeView";

type Tab = "3d" | "plan" | "cephe" | "vaziyet";
const NAME_KEY = "planhane.share.name";

/** Müşteri görünümü: paylaşım bağlantısıyla açılan salt okunur proje (3D, planlar, cepheler, yorum). */
export function ShareViewer({ token }: { token: string }) {
  const [data, setData] = useState<PublicShare | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("3d");
  const [block, setBlock] = useState(0);
  const [floor, setFloor] = useState(0);
  const [facade, setFacade] = useState<Facade | "kesit">("front");
  const [comments, setComments] = useState<ShareComment[]>([]);
  const [name, setName] = useState(() => { try { return localStorage.getItem(NAME_KEY) ?? ""; } catch { return ""; } });
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    getPublicShare(token).then((d) => { setData(d); setComments(d.comments); document.title = `${d.title} · Planhane`; }, (e) => setErr((e as Error).message));
  }, [token]);

  const root = data?.program as Program | undefined;
  const multi = root ? isMultiBlock(root) : false;
  const view = useMemo(() => (root ? blockView(root, block) : undefined), [root, block]);
  const layout = useMemo(() => { try { return view ? buildLayout(view) : undefined; } catch { return undefined; } }, [view]);

  if (err) return <div className="share-page"><div className="share-empty"><h1>Planhane</h1><p>{err}</p></div></div>;
  if (!data || !view) return <div className="share-page"><div className="share-empty"><p>Proje yükleniyor…</p></div></div>;
  if (!layout) return <div className="share-page"><div className="share-empty"><p>Proje açılamadı. Mimarınızdan bağlantıyı güncellemesini isteyin.</p></div></div>;

  const fl = layout.floors[Math.min(floor, layout.floors.length - 1)];
  const total = areaTable(layout).total;
  const send = async () => {
    if (text.trim().length < 2) return;
    setSending(true); setSent(null);
    try {
      setComments(await postShareComment(token, name.trim(), text.trim()));
      try { localStorage.setItem(NAME_KEY, name.trim()); } catch { /* yok say */ }
      setText(""); setSent("Yorumunuz mimarınıza iletildi.");
    } catch (e) { setSent((e as Error).message); }
    finally { setSending(false); }
  };

  return (
    <div className="share-page">
      <header className="share-head">
        <div>
          <h1>{root!.projectName}</h1>
          <div className="muted">{[root!.buildingType, data.office].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="share-stats">
          <div><b>{layout.floors.length}</b><span>kat</span></div>
          <div><b>{Math.round(total.net)} m²</b><span>net alan</span></div>
          <div><b>{Math.round(total.gross)} m²</b><span>brüt alan</span></div>
        </div>
      </header>
      {root!.summary && <p className="share-summary">{root!.summary}</p>}
      {multi && (
        <div className="subtabs">{root!.blocks!.map((b, i) => <button key={i} className={block === i ? "active" : ""} onClick={() => { setBlock(i); setFloor(0); }}>{b.name}</button>)}</div>
      )}
      <nav className="tabs">
        {([["3d", "3D model"], ["plan", "Kat planları"], ["cephe", "Kesit ve cepheler"], ["vaziyet", "Vaziyet"]] as [Tab, string][]).map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
      <div className="share-body">
        {tab === "3d" && <ThreeView layout={layout} program={view} viewer />}
        {tab === "plan" && (
          <>
            <div className="subtabs">{layout.floors.map((f, i) => <button key={f.level} className={fl === f ? "active" : ""} onClick={() => setFloor(i)}>{f.name}</button>)}</div>
            <div className="share-sheet" dangerouslySetInnerHTML={{ __html: planSVG(layout, fl, view) }} />
          </>
        )}
        {tab === "cephe" && (
          <>
            <div className="subtabs">
              {(Object.keys(FACADE_NAMES) as Facade[]).map((f) => <button key={f} className={facade === f ? "active" : ""} onClick={() => setFacade(f)}>{FACADE_NAMES[f]}</button>)}
              <button className={facade === "kesit" ? "active" : ""} onClick={() => setFacade("kesit")}>Kesit</button>
            </div>
            <div className="share-sheet" dangerouslySetInnerHTML={{ __html: facade === "kesit" ? sectionSVG(layout, view) : elevationSVG(layout, view, facade) }} />
          </>
        )}
        {tab === "vaziyet" && <div className="share-sheet" dangerouslySetInnerHTML={{ __html: sitePlanSVG(layout, view) }} />}
      </div>
      <section className="card share-comment-box">
        <h3>Görüşünüzü yazın</h3>
        <input placeholder="Adınız" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <textarea rows={3} maxLength={2000} placeholder="Beğendiğiniz ya da değişmesini istediğiniz yerleri yazın. Ör: salon daha geniş olsun, mutfak bahçeye açılsın." value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          <button className="btn" disabled={sending || text.trim().length < 2} onClick={send}>{sending ? "Gönderiliyor…" : "Gönder"}</button>
          {sent && <span className="muted small">{sent}</span>}
        </div>
        {comments.length > 0 && (
          <ul className="share-comments">
            {comments.slice().reverse().map((c) => (
              <li key={c.id}><b>{c.name || "Yorum"}</b> <span className="muted small">{new Date(c.at).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span><div>{c.text}</div></li>
            ))}
          </ul>
        )}
      </section>
      <footer className="share-foot muted small">Bu bir ön tasarım eskizidir; ölçüler ve alanlar uygulama projesinde kesinleşir. Son güncelleme {new Date(data.updatedAt).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })} · Planhane ile hazırlandı.</footer>
    </div>
  );
}
