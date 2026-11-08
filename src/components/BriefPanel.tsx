import { useRef } from "react";
import { BUILDING_KINDS, STYLES, shrinkImage, type Brief } from "../brief";

type NumKey = "siteWidth" | "siteDepth" | "footprintWidth" | "footprintDepth" | "floors" | "blockCount" | "unitsPerFloor" | "taks" | "kaks" | "hmax" | "frontSetback" | "sideSetback" | "rearSetback";
const NUMS: { k: NumKey; label: string; step: number; ph?: string }[] = [
  { k: "siteWidth", label: "Arsa eni (m)", step: 0.5 },
  { k: "siteDepth", label: "Arsa boyu (m)", step: 0.5 },
  { k: "footprintWidth", label: "Bina eni (m)", step: 0.5, ph: "Claude" },
  { k: "footprintDepth", label: "Bina boyu (m)", step: 0.5, ph: "Claude" },
  { k: "floors", label: "Kat sayısı", step: 1, ph: "Claude" },
  { k: "blockCount", label: "Blok sayısı", step: 1, ph: "1" },
  { k: "unitsPerFloor", label: "Kat başı daire", step: 1, ph: "Claude" },
  { k: "taks", label: "TAKS", step: 0.05 },
  { k: "kaks", label: "KAKS / emsal", step: 0.05 },
  { k: "hmax", label: "Hmax (m)", step: 0.5 },
  { k: "frontSetback", label: "Ön çekme (m)", step: 0.5, ph: "5" },
  { k: "sideSetback", label: "Yan çekme (m)", step: 0.5, ph: "3" },
  { k: "rearSetback", label: "Arka çekme (m)", step: 0.5, ph: "3" },
];

/** Notlar ekranındaki seçim alanları: arsa, bina, imar, üslup, çatı ve referans görseller. */
const MAX_IMG = 5;

export function BriefPanel({ brief, images, onBrief, onImages, onError }: {
  brief: Brief;
  images: string[];
  onBrief: (b: Brief) => void;
  onImages: (imgs: string[]) => void;
  onError: (m: string) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Brief>(k: K, v: Brief[K]) => onBrief({ ...brief, [k]: v });
  const filled = Object.values(brief).filter((v) => v !== undefined && v !== "" && v !== STYLES[0]).length;
  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const list = [...images];
    for (const f of Array.from(files)) {
      if (list.length >= MAX_IMG) { onError(`En fazla ${MAX_IMG} görsel eklenebilir.`); break; }
      if (!f.type.startsWith("image/")) continue;
      try { list.push(await shrinkImage(f)); } catch { onError(`${f.name} okunamadı.`); }
    }
    onImages(list);
  };
  return (
    <>
    <div className="refs refs-top">
      <div className="small"><b>Görseller</b> <span className="muted">(en fazla {MAX_IMG})</span></div>
      <div className="muted small">Referans cephe fotoğrafı, el eskizi / kroki, el yazısı not ya da imar durumu ekleyebilirsiniz. Claude her görselin ne olduğunu anlar: cepheyi renk ve biçimiyle aynen alır, eskizden odaları ve ölçüleri, imar belgesinden değerleri okur. Görselle tek başına da proje üretebilirsiniz.</div>
      <div className="ref-list">
        {images.map((src, i) => (
          <div className="ref" key={i}>
            <img src={src} alt={`Görsel ${i + 1}`} />
            <span className="ref-n">{i + 1}</span>
            <button className="ref-x" title="Kaldır" onClick={() => onImages(images.filter((_, k) => k !== i))}>×</button>
          </div>
        ))}
        {images.length < MAX_IMG && (
          <button className="ref add" onClick={() => file.current?.click()} title="Görsel ekle ya da fotoğraf çek">+ Görsel</button>
        )}
      </div>
      <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
    </div>
    <details className="brief" open={filled > 0 ? true : undefined}>
      <summary>Proje bilgileri ve üslup {filled > 0 && <span className="pill ok">{filled} seçim</span>}</summary>
      <div className="brief-grid">
        <label className="field wide">
          <span>Yapı türü</span>
          <select value={brief.buildingKind ?? ""} onChange={(e) => set("buildingKind", e.target.value || undefined)}>
            <option value="">Notlardan çıkarılsın</option>
            {BUILDING_KINDS.map((k) => <option key={k}>{k}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Mimari üslup</span>
          <select value={brief.style ?? STYLES[0]} onChange={(e) => set("style", e.target.value)}>
            {STYLES.map((k) => <option key={k}>{k}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Çatı</span>
          <select value={brief.roof ?? ""} onChange={(e) => set("roof", e.target.value as Brief["roof"])}>
            <option value="">Claude seçsin</option>
            <option value="duz">Düz / teras</option>
            <option value="besik">Beşik</option>
            <option value="kirma">Kırma</option>
          </select>
        </label>
        {NUMS.map((n) => (
          <label className="field" key={n.k}>
            <span>{n.label}</span>
            <input type="number" min={0} step={n.step} placeholder={n.ph ?? "—"} value={brief[n.k] ?? ""}
              onChange={(e) => set(n.k, e.target.value === "" ? undefined : Number(e.target.value))} />
          </label>
        ))}
      </div>
      <div className="muted small">Boş bıraktıklarınızı Claude notlardan çıkarır. Doldurduklarınız aynen kullanılır.</div>
    </details>
    </>
  );
}
