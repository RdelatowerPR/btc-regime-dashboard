// ─── REGIME MAP ─────────────────────────────────────────────────────────────
// Valuation on x, leverage on y, with the trail of recent days. Hand-drawn
// SVG rather than Recharts so the quadrant names sit inside the plot, the
// dead zone can be drawn, and the markers for 30/90/180 days ago are plain
// elements instead of a fight with a charting library.

import { useRef, useState } from "react";
import type { QuadrantKey, TrailRow } from "../services/api";
import { QUADRANT_META } from "../regime";
import { C, FONT, fmtUsd } from "../theme";

const W = 520;
const H = 420;
const ML = 46;
const MR = 14;
const MT = 14;
const MB = 42;
const PW = W - ML - MR;
const PH = H - MT - MB;
const sx = (v: number) => ML + ((v + 100) / 200) * PW;
const sy = (v: number) => MT + ((100 - v) / 200) * PH;

const sgn = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "");
const signed = (v: number) => {
  const mag = Math.abs(v).toFixed(0);
  return `${Number(mag) === 0 ? "" : sgn(v)}${mag}`;
};

interface Pt {
  i: number;
  date: string;
  v: number;
  l: number;
  x: number;
  y: number;
  price: number;
  quadrant: QuadrantKey | null;
}

export function RegimeMap({ trail, days, band }: { trail: TrailRow[]; days: number; band: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ pt: Pt; left: number; top: number } | null>(null);

  const rows = trail.slice(-days);
  const L = trail.length - 1;
  const pts: Pt[] = rows.map((r, k) => ({
    i: L - rows.length + 1 + k,
    date: r.date,
    v: r.valuation_score,
    l: r.leverage_score,
    x: sx(r.valuation_score),
    y: sy(r.leverage_score),
    price: r.price,
    quadrant: r.quadrant,
  }));
  const today = pts[pts.length - 1];
  const marker = (back: number) => pts.find((p) => p.i === L - back);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const kx = W / r.width;
    const ky = H / r.height;
    const x = (e.clientX - r.left) * kx;
    const y = (e.clientY - r.top) * ky;
    let best: Pt | null = null;
    let bd = 24 * 24;
    for (const p of pts) {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (!best) {
      setHover(null);
      return;
    }
    const left = Math.min(best.x / kx + 12, r.width - 190);
    const top = Math.max(0, best.y / ky - 70);
    setHover({ pt: best, left, top });
  };

  const tick = { fontSize: 10, fill: C.textFaint, fontFamily: FONT.mono } as const;
  const axisWord = { ...tick, letterSpacing: 0.6 } as const;
  const quadLabel = { ...tick, letterSpacing: 0.8 } as const;

  return (
    <div style={{ position: "relative" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        role="img"
        aria-label="Valuation versus leverage, with the trail of recent days"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* Quadrant washes */}
        {(
          [
            ["acc", -100, 0, -100, 0],
            ["knife", -100, 0, 0, 100],
            ["trend", 0, 100, -100, 0],
            ["danger", 0, 100, 0, 100],
          ] as [QuadrantKey, number, number, number, number][]
        ).map(([k, x1, x2, y1, y2]) => (
          <rect
            key={k}
            x={sx(x1)}
            y={sy(y2)}
            width={sx(x2) - sx(x1)}
            height={sy(y1) - sy(y2)}
            fill={QUADRANT_META[k].color}
            opacity={0.06}
          />
        ))}
        {/* Dead zone: inside it the regime label does not change */}
        <rect x={sx(-band)} y={MT} width={sx(band) - sx(-band)} height={PH} fill={C.textFaint} opacity={0.07} />
        <rect x={ML} y={sy(band)} width={PW} height={sy(-band) - sy(band)} fill={C.textFaint} opacity={0.07} />
        {/* Grid: solid hairlines, the origin emphasised */}
        {[-50, 50].map((t) => (
          <g key={t}>
            <line x1={sx(t)} x2={sx(t)} y1={MT} y2={MT + PH} stroke={C.grid} shapeRendering="crispEdges" />
            <line x1={ML} x2={ML + PW} y1={sy(t)} y2={sy(t)} stroke={C.grid} shapeRendering="crispEdges" />
          </g>
        ))}
        <line x1={sx(0)} x2={sx(0)} y1={MT} y2={MT + PH} stroke={C.borderBright} shapeRendering="crispEdges" />
        <line x1={ML} x2={ML + PW} y1={sy(0)} y2={sy(0)} stroke={C.borderBright} shapeRendering="crispEdges" />
        {[-100, -50, 0, 50, 100].map((t) => (
          <g key={t}>
            <text x={sx(t)} y={MT + PH + 13} style={tick} textAnchor="middle">
              {t}
            </text>
            <text x={ML - 6} y={sy(t) + 3.5} style={tick} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        <text x={ML} y={H - 6} style={axisWord}>
          ← cheap
        </text>
        <text x={ML + PW / 2} y={H - 6} style={axisWord} textAnchor="middle">
          VALUATION
        </text>
        <text x={ML + PW} y={H - 6} style={axisWord} textAnchor="end">
          expensive →
        </text>
        <g transform={`translate(11 ${MT + PH / 2}) rotate(-90)`}>
          <text x={-PH / 2} y={0} style={axisWord}>
            ← light leverage
          </text>
          <text x={0} y={0} style={axisWord} textAnchor="middle">
            LEVERAGE
          </text>
          <text x={PH / 2} y={0} style={axisWord} textAnchor="end">
            crowded →
          </text>
        </g>
        {/* Quadrant names inside the plot */}
        {(
          [
            ["acc", ML + 8, MT + PH - 8, "start"],
            ["knife", ML + 8, MT + 14, "start"],
            ["trend", ML + PW - 8, MT + PH - 8, "end"],
            ["danger", ML + PW - 8, MT + 14, "end"],
          ] as [QuadrantKey, number, number, "start" | "end"][]
        ).map(([k, x, y, anchor]) => (
          <text key={k} x={x} y={y} style={quadLabel} textAnchor={anchor}>
            <tspan fill={QUADRANT_META[k].color}>■</tspan> {QUADRANT_META[k].name.toUpperCase()}
          </text>
        ))}
        {/* Trail */}
        <polyline
          points={pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
          fill="none"
          stroke={C.textFaint}
          strokeWidth={1}
          opacity={0.4}
          strokeLinejoin="round"
        />
        {pts.slice(0, -1).map((p, k) => (
          <circle
            key={p.date}
            cx={p.x.toFixed(1)}
            cy={p.y.toFixed(1)}
            r={2.6}
            fill={C.info}
            opacity={0.12 + (0.55 * k) / Math.max(1, pts.length - 1)}
          />
        ))}
        {(
          [
            [30, "30d ago"],
            [90, "90d ago"],
            [180, "180d ago"],
          ] as [number, string][]
        )
          .filter(([back]) => back < days)
          .map(([back, label]) => {
            const p = marker(back);
            if (!p) return null;
            return (
              <g key={label}>
                <circle cx={p.x} cy={p.y} r={4.5} fill={C.panel} stroke={C.text} strokeWidth={1.2} />
                <text x={p.x + 7} y={p.y + 3.5} style={tick}>
                  {label}
                </text>
              </g>
            );
          })}
        {today && (
          <g>
            <circle cx={today.x} cy={today.y} r={8} fill={C.panel} />
            <circle cx={today.x} cy={today.y} r={5.5} fill={C.info} />
            <text x={today.x + 11} y={today.y + 3.5} style={{ ...tick, fill: C.text }}>
              today
            </text>
          </g>
        )}
      </svg>
      {hover && (
        <div
          style={{
            position: "absolute",
            left: hover.left,
            top: hover.top,
            pointerEvents: "none",
            background: C.panelAlt,
            border: `1px solid ${C.borderBright}`,
            borderRadius: 6,
            padding: "6px 9px",
            fontFamily: FONT.mono,
            fontSize: 11,
            color: C.text,
            whiteSpace: "nowrap",
            zIndex: 2,
          }}
        >
          <div>
            <b>{fmtUsd(hover.pt.price)}</b>
          </div>
          <div style={{ color: C.textDim }}>
            {hover.pt.date}
            {hover.pt.quadrant ? ` · ${QUADRANT_META[hover.pt.quadrant].name}` : ""}
          </div>
          <div style={{ color: C.textDim }}>
            valuation {signed(hover.pt.v)} · leverage {signed(hover.pt.l)}
          </div>
        </div>
      )}
    </div>
  );
}
