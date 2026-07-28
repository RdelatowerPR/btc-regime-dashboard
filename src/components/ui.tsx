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
        borderRadius: 10,
        padding: "18px 20px 20px",
        ...style,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: subtitle ? 4 : 16,
          flexWrap: "wrap",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: FONT.sans,
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: 0.3,
            color: C.text,
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
            fontFamily: FONT.sans,
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
          fontFamily: FONT.sans,
          fontSize: 10.5,
          letterSpacing: 0.7,
          textTransform: "uppercase",
          color: C.textFaint,
          marginBottom: 5,
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
          fontSize: 21,
          fontWeight: 600,
          color: color ?? C.text,
          lineHeight: 1.15,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontFamily: FONT.mono, fontSize: 11, color: C.textDim, marginTop: 4 }}>
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
        fontSize: 10.5,
        letterSpacing: 0.4,
        padding: "3px 8px",
        borderRadius: 4,
        color,
        background: bg ?? `${color}18`,
        border: `1px solid ${color}44`,
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
    <div
      style={{
        fontFamily: FONT.sans,
        fontSize: 11.5,
        lineHeight: 1.5,
        color: C.textDim,
        borderLeft: `2px solid ${C.borderBright}`,
        paddingLeft: 10,
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
        fontFamily: FONT.sans,
        fontSize: 12,
        lineHeight: 1.55,
        color: C.textDim,
        background: `${color}0f`,
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
  border: `1px solid ${C.borderBright}`,
  borderRadius: 6,
  fontFamily: FONT.mono,
  fontSize: 11.5,
  color: C.text,
} as const;

export const axisStyle = {
  stroke: C.textFaint,
  fontSize: 10.5,
  fontFamily: FONT.mono,
} as const;
