import { useState } from "react";
import type { Project } from "../store";

/** Üretilen projede yazarak düzeltme isteme + geri alma. */
export function RevisionBox({ busy, history, onRevise, onUndo }: {
  busy: boolean;
  history: NonNullable<Project["history"]>;
  onRevise: (text: string) => Promise<boolean>;
  onUndo: () => void;
}) {
  const [text, setText] = useState("");
  const send = async () => {
    if (!text.trim()) return;
    if (await onRevise(text.trim())) setText("");
  };
  const last = history[history.length - 1];
  return (
    <section className="revision">
      <div className="notes-head">
        <h2>Düzeltme iste</h2>
        {last && <button className="link" onClick={onUndo} disabled={busy} title={`Geri al: ${last.label}`}>↶ Geri al</button>}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(); }}
        placeholder={"Üretilen projede neyi değiştirelim?\nÖr: salonu 40 m² yap, mutfak kapalı olsun, çalışma odasını üst kata taşı, ikinci banyo ekle."}
        rows={3}
      />
      <button className="btn" disabled={busy || !text.trim()} onClick={send}>
        {busy ? "Claude düzeltiyor…" : "Düzeltmeyi uygula"} <span className="muted small">Ctrl+Enter</span>
      </button>
      {history.length > 0 && (
        <ul className="rev-list">
          {history.slice(-4).reverse().map((h, i) => (
            <li key={h.at + "-" + i}><span className="muted small">{new Date(h.at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</span> {h.label}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
