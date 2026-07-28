// ─── THEME ──────────────────────────────────────────────────────────────────
// Dark terminal aesthetic, matching the sUSDe dashboard so the two read as a
// pair. Colours are semantic: they always mean the same thing across panels.

export const C = {
  bg: "#0a0e14",
  panel: "#111823",
  panelAlt: "#0d141d",
  border: "#1e2936",
  borderBright: "#2a3949",

  text: "#e6edf3",
  textDim: "#8b98a5",
  textFaint: "#5a6774",

  // Semantic: green = cheap / supportive / bullish, red = expensive / fragile.
  good: "#3fb950",
  goodDim: "#1f6f2e",
  bad: "#f85149",
  badDim: "#8b2c28",
  warn: "#d29922",
  info: "#58a6ff",
  accent: "#bc8cff",

  grid: "#1a2430",
} as const;

export const FONT = {
  sans: "'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace",
} as const;

/** Diverging colour for a -100..+100 score where negative is "good/cheap". */
export function scoreColor(v: number | null, invert = false): string {
  if (v == null) return C.textFaint;
  const x = invert ? -v : v;
  if (x <= -50) return C.good;
  if (x <= -15) return "#7bc96f";
  if (x < 15) return C.textDim;
  if (x < 50) return "#e3915a";
  return C.bad;
}

export const fmtUsd = (v: number | null | undefined, digits = 0) =>
  v == null ? "—" : `$${v.toLocaleString("en-US", { maximumFractionDigits: digits })}`;

export const fmtPct = (v: number | null | undefined, digits = 1) =>
  v == null ? "—" : `${(v * 100).toFixed(digits)}%`;

export const fmtNum = (v: number | null | undefined, digits = 2) =>
  v == null ? "—" : v.toFixed(digits);

export const fmtSigned = (v: number | null | undefined, digits = 1) =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
