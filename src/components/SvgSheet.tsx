import { useRef } from "react";
import { saveOutput } from "../store";

/** Bir SVG çizimini gösterir; SVG ve PNG olarak indirme düğmeleriyle. */
export function SvgSheet({ svg, name }: { svg: string; name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const toPNG = async () => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth * 2;
    c.height = img.naturalHeight * 2;
    const g = c.getContext("2d")!;
    g.scale(2, 2);
    g.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    c.toBlob((b) => b && saveOutput(name, "png", b));
  };
  return (
    <div className="sheet">
      <div className="sheet-actions">
        <button className="btn ghost small" onClick={() => saveOutput(name, "svg", svg)}>SVG</button>
        <button className="btn ghost small" onClick={toPNG}>PNG</button>
      </div>
      <div className="sheet-body" ref={ref} dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}
