// ─── SHARED UI PRIMITIVES ───────────────────────────────────────────────────

import type { ReactNode, CSSProperties, ComponentProps } from "react";
import { Tooltip } from "recharts";
import { C, FONT } from "../theme";

type RechartsFormatter = ComponentProps<typeof Tooltip>["formatter"];

/**
 * Recharts 3 types tooltip values as `ValueType | undefined`, which every
 * numeric formatter trips over. This adapts a plain (number, string) formatter
 * to that signature in one place instead of casting at each call site.
 */
export function tooltipFormatter(fn: (value: number, name: string) => [string, string]): RechartsFormatter {
  return ((value: unknown, name: unknown) => fn(Number(value), String(name ?? ""))) as RechartsFormatter;
}

export function Panel({
  title,
  subtitle,
  children,
  right,
  style,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  right?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        padding: "20px",
        ...style,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: subtitle ? 8 : 16,
          flexWrap: "wrap",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: FONT.ui,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.14em",
            color: C.textFaint,
            textTransform: "uppercase",
          }}
        >
          {title}
        </h2>
        {right}
      </header>
      {subtitle && (
        <p
          style={{
            margin: "0 0 16px",
            fontFamily: FONT.ui,
            fontSize: 12.5,
            lineHeight: 1.55,
            color: C.textDim,
            maxWidth: 900,
          }}
        >
          {subtitle}
        </p>
      )}
      {children}
    </section>
  );
}

/** A single headline number with a label and optional context line. */
export function Metric({
  label,
  value,
  sub,
  color,
  title,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  color?: string;
  title?: string;
}) {
  return (
    <div style={{ minWidth: 0 }} title={title}>
      <div
        style={{
          fontFamily: FONT.ui,
          fontSize: 11,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: C.textFaint,
          marginBottom: 6,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: FONT.mono,
          fontSize: 26,
          fontWeight: 500,
          letterSpacing: "-0.02em",
          color: color ?? C.text,
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontFamily: FONT.mono, fontSize: 11, color: C.textFaint, marginTop: 6 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

export function MetricGrid({ children, min = 140 }: { children: ReactNode; min?: number }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
        gap: "18px 20px",
      }}
    >
      {children}
    </div>
  );
}

export function Badge({
  children,
  color = C.textDim,
  bg,
}: {
  children: ReactNode;
  color?: string;
  bg?: string;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: FONT.mono,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.02em",
        padding: "2px 7px",
        borderRadius: 6,
        color,
        // Tint chip, no border — the fill alone separates it from the panel.
        background: bg ?? `${color}22`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/**
 * Inline verdict from the backtest. The point of the dashboard is that no
 * number appears without the evidence for it, so this sits next to indicators.
 */
export function Evidence({ children }: { children: ReactNode }) {
  return (
    // Inset well, not a left edge-stripe — the house style separates with
    // hairlines and tint, never a single-side border.
    <div
      style={{
        fontFamily: FONT.ui,
        fontSize: 11.5,
        lineHeight: 1.5,
        color: C.textDim,
        background: C.panelAlt,
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        padding: "10px 12px",
        marginTop: 10,
      }}
    >
      {children}
    </div>
  );
}

export function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  const color = tone === "warn" ? C.warn : C.info;
  return (
    <div
      style={{
        fontFamily: FONT.ui,
        fontSize: 12,
        lineHeight: 1.55,
        color: C.textDim,
        background: `${color}14`,
        border: `1px solid ${color}33`,
        borderRadius: 6,
        padding: "10px 12px",
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  );
}

/** Horizontal -100..+100 score bar with a centre origin. */
export function ScoreBar({ value, color }: { value: number | null; color: string }) {
  const v = value ?? 0;
  const half = Math.min(Math.abs(v), 100) / 2; // percent of full width
  return (
    <div
      style={{
        position: "relative",
        height: 6,
        background: C.panelAlt,
        borderRadius: 3,
        marginTop: 8,
        border: `1px solid ${C.border}`,
      }}
    >
      <div style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: C.borderBright }} />
      {value != null && (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: v >= 0 ? "50%" : `${50 - half}%`,
            width: `${half}%`,
            background: color,
            borderRadius: 3,
          }}
        />
      )}
    </div>
  );
}

export const tooltipStyle = {
  background: C.panelAlt,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  fontFamily: FONT.mono,
  fontSize: 11.5,
  color: C.text,
} as const;

export const axisStyle = {
  stroke: C.textFaint,
  fontSize: 11,
  fontFamily: FONT.mono,
} as const;

/**
 * The dated caption every data view carries. A number without a timestamp and
 * a source is a bug, so this sits under charts and tables.
 */
export function AsOf({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: "12px 0 0",
        fontFamily: FONT.mono,
        fontSize: 11,
        color: C.textFaint,
      }}
    >
      {children}
    </p>
  );
}

// ─── GLANCE PRIMITIVES (added 2026-09-12 for the daily view) ────────────────

/**
 * Inline sparkline. The older part of the window is muted and the last `hi`
 * points are in the accent, so the recent move reads without an axis. Nulls
 * break the line rather than being bridged.
 */
export function Spark({
  values,
  w = 120,
  h = 28,
  zero = false,
  hi = 30,
  pad = 2,
}: {
  values: (number | null | undefined)[];
  w?: number;
  h?: number;
  /** Keep 0 inside the range and draw a hairline there. */
  zero?: boolean;
  /** How many trailing points get the accent colour. */
  hi?: number;
  pad?: number;
}) {
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of values) {
    if (v == null) continue;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  if (zero) {
    mn = Math.min(mn, 0);
    mx = Math.max(mx, 0);
  }
  if (!(mx > mn)) {
    mn -= 1;
    mx += 1;
  }
  const n = values.length;
  const X = (i: number) => pad + (i / Math.max(1, n - 1)) * (w - 2 * pad);
  const Y = (v: number) => pad + ((mx - v) / (mx - mn)) * (h - 2 * pad);
  const seg = (from: number, to: number) => {
    let d = "";
    let pen = false;
    for (let i = from; i <= to; i++) {
      const v = values[i];
      if (v == null) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const cut = Math.max(0, n - 1 - hi);
  let last = n - 1;
  while (last >= 0 && values[last] == null) last--;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true" style={{ display: "block", flex: "none" }}>
      {zero && mn < 0 && mx > 0 && (
        <line x1={pad} x2={w - pad} y1={Y(0).toFixed(1)} y2={Y(0).toFixed(1)} stroke={C.borderBright} shapeRendering="crispEdges" />
      )}
      <path d={seg(0, cut)} fill="none" stroke={C.textFaint} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.75} />
      <path d={seg(cut, n - 1)} fill="none" stroke={C.info} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {last >= 0 && <circle cx={X(last).toFixed(1)} cy={Y(values[last] as number).toFixed(1)} r={2.5} fill={C.info} />}
    </svg>
  );
}

/**
 * Bipolar −100..+100 bar with the meaning written at each end, so nobody has
 * to remember which sign is "good" on which axis. The ghost tick marks where
 * the value stood 30 days ago.
 */
export function AxisBar({
  value,
  ghost,
  color,
  left,
  right,
}: {
  value: number | null;
  ghost?: number | null;
  color: string;
  left: string;
  right: string;
}) {
  const at = (x: number) => 50 + Math.max(-100, Math.min(100, x)) / 2;
  const v = value ?? 0;
  const fillLeft = v >= 0 ? 50 : at(v);
  const fillWidth = Math.min(100, Math.abs(v)) / 2;
  return (
    <div>
      <div
        role="img"
        aria-label={`score ${value == null ? "unavailable" : value.toFixed(0)} on a −100 to +100 scale`}
        style={{
          position: "relative",
          height: 10,
          border: `1px solid ${C.border}`,
          borderRadius: 5,
          background: C.panelAlt,
        }}
      >
        <span style={{ position: "absolute", left: "50%", top: -3, bottom: -3, width: 1, background: C.borderBright }} />
        {value != null && (
          <span
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${fillLeft}%`,
              width: `${fillWidth}%`,
              borderRadius: 4,
              background: color,
            }}
          />
        )}
        {ghost != null && (
          <span
            title="30 days ago"
            style={{
              position: "absolute",
              top: -4,
              bottom: -4,
              left: `${at(ghost)}%`,
              width: 2,
              marginLeft: -1,
              background: C.text,
              opacity: 0.55,
            }}
          />
        )}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: FONT.mono,
          fontSize: 10,
          color: C.textFaint,
          marginTop: 4,
        }}
      >
        <span>{left}</span>
        <span>0</span>
        <span>{right}</span>
      </div>
    </div>
  );
}

/** A compact stat: label, number, one-line context, optional sparkline beside the number. */
export function MiniStat({
  label,
  value,
  sub,
  spark,
  color,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  spark?: ReactNode;
  color?: string;
}) {
  return (
    <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
      <div style={{ fontFamily: FONT.ui, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textFaint }}>
        {label}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 8 }}>
        <span
          style={{
            fontFamily: FONT.mono,
            fontSize: 20,
            fontWeight: 500,
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
            color: color ?? C.text,
          }}
        >
          {value}
        </span>
        {spark}
      </div>
      {sub && <div style={{ fontFamily: FONT.mono, fontSize: 11, color: C.textFaint }}>{sub}</div>}
    </div>
  );
}

/** Closed-by-default prose. The explanations still exist; they no longer sit in the daily view. */
export function Disclosure({ summary, children, open }: { summary: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="disc" open={open}>
      <summary>{summary}</summary>
      <div className="disc-body">{children}</div>
    </details>
  );
}
