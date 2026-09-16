// ─── REGIME VERDICT ─────────────────────────────────────────────────────────
// The one rule the front page leads with, and the append-only log of what it
// said each day so the calls can be scored against what BTC did next.
//
// Why smoothing plus a dead zone: the raw daily sign of the leverage axis
// flipped 71 times in the year to 2026-09-11 (the score can move 30 points in
// a day), so a quadrant read off raw signs is noise dressed as a regime. A
// 7-day mean with a ±10 band gave 7 runs over the same year, two of them
// shorter than a week. The raw readings are still shown; only the LABEL is
// smoothed.
//
// Why a log: `signals` is recomputed from the raw tables on every sync, so it
// records what the current method says about the past, never what the page
// actually said on the day. `verdict_log` is written once per as-of date and
// never rewritten. Score it by joining `signals.fwd_*` on the date.

import { db } from "./db.js";
import { computeBottomBand } from "./signals.js";

/** Bump when the regime rule changes, so old log rows are not scored as if they came from the new one. */
// 2026-09-16: funding enters the leverage score on the fixed ten-year scale, from the
// venue-weighted aggregate, instead of a percentile of the equal-weight eight-venue mean;
// and the heat rule's rally legs end on a 15% reversal instead of 10% (CONFIG.oiLegThreshold).
// One version for both: no verdict was logged between the two changes.
export const VERDICT_RULES_VERSION = "2026-09-16";
export const SMOOTH_DAYS = 7;
export const BAND = 10;
/** Strength bands on the smaller of the two smoothed distances from neutral. */
export const STRENGTH = { faint: 15, moderate: 50 } as const;

export type QuadrantKey = "acc" | "knife" | "trend" | "danger";
export type Strength = "faint" | "moderate" | "strong";

export const QUADRANTS: Record<QuadrantKey, { name: string; tag: string; tone: "good" | "warn" | "info" | "bad" }> = {
  acc: { name: "Accumulation zone", tag: "cheap · unlevered", tone: "good" },
  knife: { name: "Falling knife", tag: "cheap · levered", tone: "warn" },
  trend: { name: "Healthy trend", tag: "rich · unlevered", tone: "info" },
  danger: { name: "Danger zone", tag: "rich · levered", tone: "bad" },
};

export interface ScoreRow {
  date: string;
  valuation_score: number | null;
  leverage_score: number | null;
}

export interface QuadrantRow {
  date: string;
  quadrant: QuadrantKey | null;
  valuation_smooth: number | null;
  leverage_smooth: number | null;
}

export interface Verdict {
  date: string;
  quadrant: QuadrantKey;
  name: string;
  tag: string;
  tone: "good" | "warn" | "info" | "bad";
  strength: Strength;
  depth: number;
  valuation_smooth: number;
  leverage_smooth: number;
  runStart: string;
  daysInQuadrant: number;
  enteredFrom: QuadrantKey | null;
  enteredHow: "valuation" | "leverage" | "both" | null;
  rules: { version: string; smoothDays: number; band: number };
}

const quadrantOf = (signV: number, signL: number): QuadrantKey =>
  signV < 0 ? (signL < 0 ? "acc" : "knife") : signL < 0 ? "trend" : "danger";

/** Trailing mean over the non-null values in the window; null when the window is empty. */
function rollingMean(values: (number | null)[], window: number): (number | null)[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1).filter((v): v is number => v != null);
    return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
  });
}

/**
 * Regime per day. Each axis keeps its previous sign until its smoothed score
 * clears the band on the other side (a Schmitt trigger), so the label carries
 * state and must be computed over the whole history, not a window.
 */
export function computeQuadrants(rows: ScoreRow[], smoothDays = SMOOTH_DAYS, band = BAND): QuadrantRow[] {
  const vs = rollingMean(rows.map((r) => r.valuation_score), smoothDays);
  const ls = rollingMean(rows.map((r) => r.leverage_score), smoothDays);
  let signV = 0;
  let signL = 0;
  return rows.map((r, i) => {
    const v = vs[i];
    const l = ls[i];
    if (v != null) {
      if (v > band) signV = 1;
      else if (v < -band) signV = -1;
      else if (signV === 0) signV = v < 0 ? -1 : 1;
    }
    if (l != null) {
      if (l > band) signL = 1;
      else if (l < -band) signL = -1;
      else if (signL === 0) signL = l < 0 ? -1 : 1;
    }
    const quadrant = v == null || l == null || signV === 0 || signL === 0 ? null : quadrantOf(signV, signL);
    return { date: r.date, quadrant, valuation_smooth: v, leverage_smooth: l };
  });
}

function howEntered(from: QuadrantKey, to: QuadrantKey): "valuation" | "leverage" | "both" {
  const cheap = (k: QuadrantKey) => k === "acc" || k === "knife";
  const levered = (k: QuadrantKey) => k === "knife" || k === "danger";
  const v = cheap(from) !== cheap(to);
  const l = levered(from) !== levered(to);
  return v && l ? "both" : v ? "valuation" : "leverage";
}

/** The current regime, how deep it is, and how long it has held. */
export function describeVerdict(qrows: QuadrantRow[]): Verdict | null {
  let last = qrows.length - 1;
  while (last >= 0 && qrows[last].quadrant == null) last--;
  if (last < 0) return null;
  const cur = qrows[last];
  const quadrant = cur.quadrant as QuadrantKey;

  let start = last;
  while (start > 0 && qrows[start - 1].quadrant === quadrant) start--;
  let prev = start - 1;
  while (prev >= 0 && qrows[prev].quadrant == null) prev--;
  const enteredFrom = prev >= 0 ? (qrows[prev].quadrant as QuadrantKey) : null;

  const vSmooth = cur.valuation_smooth as number;
  const lSmooth = cur.leverage_smooth as number;
  const depth = Math.min(Math.abs(vSmooth), Math.abs(lSmooth));
  const strength: Strength = depth < STRENGTH.faint ? "faint" : depth < STRENGTH.moderate ? "moderate" : "strong";
  const meta = QUADRANTS[quadrant];

  return {
    date: cur.date,
    quadrant,
    name: meta.name,
    tag: meta.tag,
    tone: meta.tone,
    strength,
    depth,
    valuation_smooth: vSmooth,
    leverage_smooth: lSmooth,
    runStart: qrows[start].date,
    daysInQuadrant: last - start + 1,
    enteredFrom,
    enteredHow: enteredFrom ? howEntered(enteredFrom, quadrant) : null,
    rules: { version: VERDICT_RULES_VERSION, smoothDays: SMOOTH_DAYS, band: BAND },
  };
}

const selectScores = db.prepare(
  "SELECT date, valuation_score, leverage_score FROM signals ORDER BY date"
);
const selectLatestRow = db.prepare(`
  SELECT price, valuation_score, leverage_score, macro_score, composite, realized_price,
         mvrv_z, drawdown, oi_heat_leg, funding_rate, term_regime
  FROM signals WHERE date = ?
`);
const insertVerdict = db.prepare(`
  INSERT OR IGNORE INTO verdict_log
    (signal_date, rules_version, quadrant, strength, depth, days_in_quadrant, run_start, entered_from,
     price, valuation_score, leverage_score, macro_score, composite, valuation_smooth, leverage_smooth,
     realized_price, mvrv_z, drawdown, oi_heat_leg, funding_rate, term_regime, band_low, band_mid, band_high)
  VALUES
    (@signalDate, @rulesVersion, @quadrant, @strength, @depth, @daysInQuadrant, @runStart, @enteredFrom,
     @price, @valuationScore, @leverageScore, @macroScore, @composite, @valuationSmooth, @leverageSmooth,
     @realizedPrice, @mvrvZ, @drawdown, @oiHeatLeg, @fundingRate, @termRegime, @bandLow, @bandMid, @bandHigh)
`);

/**
 * Write the current verdict once. Keyed by the as-of date of the signals row,
 * so a restart never duplicates a row and a later revision of that day's
 * inputs never rewrites what the page said. Returns null when there is
 * nothing to log.
 */
export function logVerdict(): { date: string; inserted: boolean } | null {
  const verdict = describeVerdict(computeQuadrants(selectScores.all() as ScoreRow[]));
  if (!verdict) return null;
  const row = selectLatestRow.get(verdict.date) as Record<string, number | string | null> | undefined;
  if (!row) return null;
  const realized = Number(row.realized_price ?? 0);
  const band = realized > 0 ? computeBottomBand(realized) : null;
  const info = insertVerdict.run({
    signalDate: verdict.date,
    rulesVersion: verdict.rules.version,
    quadrant: verdict.quadrant,
    strength: verdict.strength,
    depth: verdict.depth,
    daysInQuadrant: verdict.daysInQuadrant,
    runStart: verdict.runStart,
    enteredFrom: verdict.enteredFrom,
    price: row.price,
    valuationScore: row.valuation_score,
    leverageScore: row.leverage_score,
    macroScore: row.macro_score,
    composite: row.composite,
    valuationSmooth: verdict.valuation_smooth,
    leverageSmooth: verdict.leverage_smooth,
    realizedPrice: row.realized_price,
    mvrvZ: row.mvrv_z,
    drawdown: row.drawdown,
    oiHeatLeg: row.oi_heat_leg,
    fundingRate: row.funding_rate,
    termRegime: row.term_regime,
    bandLow: band?.priceLow ?? null,
    bandMid: band?.priceMid ?? null,
    bandHigh: band?.priceHigh ?? null,
  });
  return { date: verdict.date, inserted: info.changes > 0 };
}
