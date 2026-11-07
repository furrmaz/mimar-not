import { useEffect, useRef, useState } from "react";

// Tarayıcının yerleşik konuşma tanıma özelliğiyle Türkçe dikte (Chrome, Edge, Safari).
/* eslint-disable @typescript-eslint/no-explicit-any */
export function useDictation(onFinal: (text: string) => void) {
  const SR: any = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const rec = useRef<any>(null);
  const cb = useRef(onFinal);
  cb.current = onFinal;
  const wanted = useRef(false);

  useEffect(() => () => rec.current?.stop(), []);

  const start = () => {
    if (!SR) return;
    const r = new SR();
    r.lang = "tr-TR";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e: any) => {
      let inter = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) cb.current(res[0].transcript.trim());
        else inter += res[0].transcript;
      }
      setInterim(inter);
    };
    r.onend = () => {
      // uzun görüşmelerde tarayıcı kendiliğinden durabilir; kullanıcı durdurmadıysa devam et
      if (wanted.current) {
        try { r.start(); } catch { /* yoksay */ }
      } else {
        setListening(false);
        setInterim("");
      }
    };
    r.onerror = (e: any) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wanted.current = false;
        alert("Mikrofon izni verilmedi.");
      }
    };
    rec.current = r;
    wanted.current = true;
    r.start();
    setListening(true);
  };
  const stop = () => {
    wanted.current = false;
    rec.current?.stop();
  };
  return { supported: Boolean(SR), listening, interim, toggle: () => (listening ? stop() : start()) };
}
