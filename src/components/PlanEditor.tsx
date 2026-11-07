import { useRef, useState } from "react";
import type { Program } from "../shared/schema";
import type { BuildingLayout, FloorLayout } from "../geometry/layout";
import { planFrame } from "../geometry/svg";

type Drag =
  | { kind: "col"; key: string; index: number; xs: number[]; y0: number; y1: number; value: number; min: number; max: number }
  | { kind: "band"; value: number; min: number; max: number };

const snap = (v: number) => Math.round(v * 20) / 20;

/** Plan üzerinde sürüklenebilir tutamaklar: oda sütun sınırları ve hol bandı. */
export function PlanEditOverlay({ L, floor, program, onChange }: { L: BuildingLayout; floor: FloorLayout; program: Program; onChange: (p: Program) => void }) {
  const fr = planFrame(L, floor);
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const toWorld = (e: React.PointerEvent) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: fr.invX(p.x), y: fr.invY(p.y) };
  };

  const commit = (d: Drag) => {
    const design = { ...(program.design ?? {}) };
    if (d.kind === "band") design.frontDepth = d.value;
    else {
      const xs = d.xs.slice();
      xs[d.index] = d.value;
      design.cols = { ...(design.cols ?? {}), [d.key]: xs };
    }
    onChange({ ...program, design });
  };

  const start = (d: Drag) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    setDrag(d);
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const w = toWorld(e);
    const v = snap(drag.kind === "band" ? w.y : w.x);
    setDrag({ ...drag, value: Math.min(drag.max, Math.max(drag.min, v)) } as Drag);
  };
  const end = () => {
    if (drag) commit(drag);
    setDrag(null);
  };

  const hb = L.hallBand;
  const handles: Drag[] = [];
  for (const c of floor.cols) {
    const [y0, y1] = c.band === "front" ? [0, hb.y] : [hb.y + hb.h, L.D];
    c.xs.forEach((x, i) =>
      handles.push({ kind: "col", key: c.key, index: i, xs: c.xs, y0, y1, value: x, min: (c.xs[i - 1] ?? 0) + 0.8, max: (c.xs[i + 1] ?? L.W) - 0.8 }),
    );
  }
  const band: Drag = { kind: "band", value: hb.y, min: 2, max: L.D - hb.h - 2 };
  const isActive = (h: Drag) =>
    drag && drag.kind === h.kind && (h.kind === "band" || (drag.kind === "col" && drag.key === h.key && drag.index === h.index));

  const C = "#b5532e";
  return (
    <svg
      ref={svgRef}
      className="plan-overlay"
      viewBox={`0 0 ${fr.width.toFixed(0)} ${fr.height.toFixed(0)}`}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={() => setDrag(null)}
    >
      {handles.map((h) => {
        if (h.kind !== "col") return null;
        const a = isActive(h) && drag?.kind === "col" ? drag : h;
        const x = fr.X(a.value);
        return (
          <g key={`${h.key}-${h.index}`} className="handle" onPointerDown={start(h)} style={{ cursor: "ew-resize" }}>
            <line x1={x} y1={fr.Y(h.y1)} x2={x} y2={fr.Y(h.y0)} stroke="transparent" strokeWidth={18} />
            <line x1={x} y1={fr.Y(h.y1) + 6} x2={x} y2={fr.Y(h.y0) - 6} stroke={C} strokeWidth={isActive(h) ? 3 : 2} strokeDasharray={isActive(h) ? undefined : "6 4"} />
            <circle cx={x} cy={(fr.Y(h.y0) + fr.Y(h.y1)) / 2} r={7} fill="#fff" stroke={C} strokeWidth={2} />
            {isActive(h) && <Label x={x} y={fr.Y(h.y1) - 10} text={`${(a.value - (h.xs[h.index - 1] ?? 0)).toFixed(2)} | ${((h.xs[h.index + 1] ?? L.W) - a.value).toFixed(2)}`} />}
          </g>
        );
      })}
      {(() => {
        const a = drag?.kind === "band" ? drag : band;
        const y = fr.Y(a.value);
        return (
          <g className="handle" onPointerDown={start(band)} style={{ cursor: "ns-resize" }}>
            <line x1={fr.X(0)} y1={y} x2={fr.X(L.W)} y2={y} stroke="transparent" strokeWidth={18} />
            <line x1={fr.X(0)} y1={y} x2={fr.X(L.W)} y2={y} stroke={C} strokeWidth={drag?.kind === "band" ? 3 : 2} strokeDasharray={drag?.kind === "band" ? undefined : "6 4"} />
            <circle cx={fr.X(L.W) - 0.8 * fr.S} cy={y} r={7} fill="#fff" stroke={C} strokeWidth={2} />
            {drag?.kind === "band" && <Label x={fr.X(L.W / 2)} y={y - 10} text={`ön bant ${a.value.toFixed(2)} m (tüm katlar)`} />}
          </g>
        );
      })()}
    </svg>
  );
}

function Label({ x, y, text }: { x: number; y: number; text: string }) {
  const w = text.length * 7 + 14;
  return (
    <g pointerEvents="none">
      <rect x={x - w / 2} y={y - 16} width={w} height={20} rx={5} fill="#1d1d1f" />
      <text x={x} y={y - 2} fontSize={12} fill="#fff" textAnchor="middle">{text}</text>
    </g>
  );
}
