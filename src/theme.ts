// ─── THEME ──────────────────────────────────────────────────────────────────
// House style, dark mode. Mono-first, deep-navy ground, one blue doing the
// structural work, hairline borders instead of shadows.
// Reference: ~/.claude/skills/house-style/references/tokens.md
//
// Every text colour below clears WCAG AA (>=4.5:1) against BOTH `bg` and
// `panel`. Do not add a colour here without checking it against both.

export const C = {
  bg: "#0C1322",        // ground
  panel: "#141D31",     // surface — cards, panels
  panelAlt: "#101827",  // inset wells, tooltips, table stripes
  border: "#25324A",    // hairline — the default separator
  borderBright: "#33425E", // hairline, emphasised (active tab, axis origin)

  text: "#E9EDF5",      // ink        15.81 / 14.32
  textDim: "#C3CBD9",   // body       11.37 / 10.29
  textFaint: "#98A3B8", // muted       7.30 /  6.61

  // Semantic: green = cheap / supportive / bullish, red = expensive / fragile.
  good: "#3BD489",      //  9.69 / 8.77
  goodMid: "#78C79B",   //  9.22 / 8.35 — mild end of the diverging ramp
  goodDim: "#1B7A4E",   // fills and area shading only, never text
  bad: "#FF7A70",       //  7.31 / 6.62
  badMid: "#E3A06B",    //  8.40 / 7.61 — mild end of the diverging ramp
  badDim: "#7A2E28",    // fills and area shading only, never text
  warn: "#F0B95B",      // 10.42 / 9.44
  info: "#7FA6FF",      //  7.78 / 7.04 — the structural accent
  accent: "#B694F5",    //  7.55 / 6.84 — fourth categorical series

  grid: "#1E2940",      // chart gridlines — dimmer than `border` on purpose
} as const;

/**
 * Mono everywhere — that is the house voice, not an oversight. Both keys
 * resolve to the same stack; `ui` marks chrome, `mono` marks data.
 * No webfont: these are all locally installed, so nothing is fetched and
 * nothing breaks behind a strict CSP.
 */
const STACK =
  "'JetBrains Mono', 'Cascadia Mono', Consolas, 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

export const FONT = {
  ui: STACK,
  mono: STACK,
} as const;

/** Diverging colour for a -100..+100 score where negative is "good/cheap". */
export function scoreColor(v: number | null, invert = false): string {
  if (v == null) return C.textFaint;
  const x = invert ? -v : v;
  if (x <= -50) return C.good;
  if (x <= -15) return C.goodMid;
  if (x < 15) return C.textFaint;
  if (x < 50) return C.badMid;
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
