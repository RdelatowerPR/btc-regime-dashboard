// ─── BACKTEST HARNESS ───────────────────────────────────────────────────────
// Every threshold shown on the dashboard has to earn its place. This buckets
// each signal's history and measures what BTC actually did over the following
// 30/90/180 days from inside each bucket.
//
// Three rules keep the numbers honest:
//
//   1. Point-in-time inputs. Percentiles and Z-scores come from expanding
//      windows (see stats.ts), so a historical row only ever sees data that
//      existed on that date.
//
//   2. ERA SEGMENTATION. This is the big one. Over 2010-2013 BTC rose roughly
//      1000x, which swamps everything: run the full history and the lowest
//      Nasdaq/BTC RSI decile shows +242% average 90-day forward returns and
//      every valuation signal appears inverted, because "expensive" readings
//      in 2011 were still followed by 10x moves. Those buckets describe a
//      market that no longer exists. Each signal is therefore bucketed
//      separately per era, and the dashboard defaults to `modern`.
//
//   3. MEDIANS LEAD. With fat right tails, a single 2013-style episode drags a
//      bucket mean far above anything a decision-maker should expect. Means
//      are still stored, but the median is the headline.
//
// Sample-size caveat that the UI must carry: forward windows overlap heavily,
// so `n` counts calendar days, not independent trials. A 90-day bucket with
// n=400 is closer to ~4 independent episodes. These are descriptive, not
// statistically significant.

import { db, upsertBacktest, upsertTail } from "./db.js";
import { median } from "./stats.js";

interface Row {
  date: string;
  value: number;
  fwd30: number | null;
  fwd90: number | null;
  fwd180: number | null;
}

export const ERAS = [
  { key: "modern", from: "2018-01-01", label: "2018+ (institutional era)" },
  { key: "recent", from: "2021-01-01", label: "2021+ (post-ETF cycle)" },
  { key: "full", from: "2010-01-01", label: "Full history (early years distort)" },
] as const;

const DECILE_SIGNALS = [
  { key: "mvrv_z", label: "MVRV Z-score" },
  { key: "realized_ratio", label: "Spot / realized price" },
  { key: "ndx_btc_rsi", label: "Nasdaq/BTC RSI" },
  { key: "gold_btc_rsi", label: "Gold/BTC RSI" },
  { key: "mayer", label: "Mayer multiple" },
  { key: "puell", label: "Puell multiple" },
  { key: "term_spread_7dma", label: "sUSDe term spread" },
  { key: "oi_heat_leg", label: "OI heat (rally leg)" },
  { key: "funding_7d", label: "Funding rate 7d (weighted; BitMEX pre-2022)" },
  { key: "net_liquidity_90d", label: "Net liquidity 90d chg" },
  { key: "stablecoin_30d", label: "Stablecoin float 30d chg" },
  { key: "composite", label: "Composite score" },
  { key: "valuation_score", label: "Valuation axis" },
  { key: "leverage_score", label: "Leverage axis" },
  { key: "macro_score", label: "Macro axis" },
];

// Deciles below this many rows are noise; fall back to quintiles, then skip.
const MIN_DECILE_ROWS = 500;
const MIN_QUINTILE_ROWS = 150;

function loadRows(column: string, from: string): Row[] {
  return db
    .prepare(
      `SELECT date, ${column} AS value, fwd_30d AS fwd30, fwd_90d AS fwd90, fwd_180d AS fwd180
       FROM signals
       WHERE ${column} IS NOT NULL AND fwd_90d IS NOT NULL AND date >= ?
       ORDER BY ${column} ASC`
    )
    .all(from) as Row[];
}

function summarise(rows: Row[]) {
  const pick = (k: "fwd30" | "fwd90" | "fwd180") =>
    rows.map((r) => r[k]).filter((v): v is number => v != null);
  const f30 = pick("fwd30");
  const f90 = pick("fwd90");
  const f180 = pick("fwd180");
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const med = (a: number[]) => (a.length ? median(a) : null);
  return {
    avgFwd30d: avg(f30),
    avgFwd90d: avg(f90),
    avgFwd180d: avg(f180),
    medFwd30d: med(f30),
    medFwd90d: med(f90),
    medFwd180d: med(f180),
    hitRate90d: f90.length ? f90.filter((v) => v > 0).length / f90.length : null,
  };
}

function backtestBuckets(key: string, label: string, era: string, from: string, verbose: boolean) {
  const rows = loadRows(key, from);
  const nBuckets =
    rows.length >= MIN_DECILE_ROWS ? 10 : rows.length >= MIN_QUINTILE_ROWS ? 5 : 0;

  if (nBuckets === 0) {
    if (verbose) console.log(`  ${label.padEnd(26)} skipped (${rows.length} rows)`);
    return 0;
  }

  const size = Math.floor(rows.length / nBuckets);
  let written = 0;
  for (let b = 0; b < nBuckets; b++) {
    const slice = b === nBuckets - 1 ? rows.slice(b * size) : rows.slice(b * size, (b + 1) * size);
    if (slice.length === 0) continue;
    upsertBacktest.run({
      signal: key,
      era,
      bucket: `${nBuckets === 10 ? "D" : "Q"}${b + 1}`,
      bucketOrd: b + 1,
      n: slice.length,
      rangeLo: slice[0].value,
      rangeHi: slice.at(-1)!.value,
      ...summarise(slice),
    });
    written++;
  }

  if (verbose) {
    const lo = summarise(rows.slice(0, size));
    const hi = summarise(rows.slice(-size));
    const pct = (v: number | null) => `${((v ?? 0) * 100).toFixed(1)}%`.padStart(7);
    // "Spread" is the monotonicity check: a signal that works should show a
    // clear gap between its bottom and top bucket, in the expected direction.
    const spread = ((hi.medFwd90d ?? 0) - (lo.medFwd90d ?? 0)) * 100;
    console.log(
      `  ${label.padEnd(26)} n=${String(rows.length).padStart(4)}  ` +
        `lo ${pct(lo.medFwd90d)}  hi ${pct(hi.medFwd90d)}  ` +
        `spread ${(spread >= 0 ? "+" : "") + spread.toFixed(1)}pp`
    );
  }
  return written;
}

function backtestTermRegimes(era: string, from: string, verbose: boolean): number {
  const rows = db
    .prepare(
      `SELECT term_regime AS regime, fwd_30d AS fwd30, fwd_90d AS fwd90, fwd_180d AS fwd180
       FROM signals WHERE term_regime IS NOT NULL AND fwd_90d IS NOT NULL AND date >= ?`
    )
    .all(from) as (Row & { regime: string })[];
  if (rows.length === 0) return 0;

  const order = [
    "STEEP_BACKWARDATION",
    "BACKWARDATION",
    "FLAT",
    "CONTANGO",
    "STEEP_CONTANGO",
    "SINGLE_MATURITY",
  ];
  const byRegime = new Map<string, Row[]>();
  for (const r of rows) {
    const bucket = byRegime.get(r.regime);
    if (bucket) bucket.push(r);
    else byRegime.set(r.regime, [r]);
  }

  let written = 0;
  for (const regime of order) {
    const items = byRegime.get(regime);
    if (!items?.length) continue;
    const s = summarise(items);
    upsertBacktest.run({
      signal: "term_regime",
      era,
      bucket: regime,
      bucketOrd: order.indexOf(regime) + 1,
      n: items.length,
      rangeLo: null,
      rangeHi: null,
      ...s,
    });
    written++;
    if (verbose) {
      console.log(
        `  ${("term: " + regime).padEnd(26)} n=${String(items.length).padStart(4)}  ` +
          `med90 ${(((s.medFwd90d ?? 0) * 100).toFixed(1) + "%").padStart(7)}  ` +
          `hit ${((s.hitRate90d ?? 0) * 100).toFixed(0)}%`
      );
    }
  }
  return written;
}

// ── EXTREME-TAIL ANALYSIS ──────────────────────────────────────────────────
// Deciles are the wrong instrument for the bottom-signal claims. "BTC's most
// oversold reading on record marks a generational low" is a statement about
// the top 1-2% of observations; a decile average dilutes that across 10% of
// history and reports nothing. These are the signals whose thesis lives in
// the tail, and the direction the thesis points.
const TAIL_SIGNALS = [
  { key: "mvrv_z", tail: "bot" as const, label: "MVRV Z-score" },
  { key: "realized_ratio", tail: "bot" as const, label: "Spot / realized" },
  { key: "ndx_btc_rsi", tail: "top" as const, label: "Nasdaq/BTC RSI" },
  { key: "gold_btc_rsi", tail: "top" as const, label: "Gold/BTC RSI" },
  { key: "mayer", tail: "bot" as const, label: "Mayer multiple" },
  { key: "puell", tail: "bot" as const, label: "Puell multiple" },
  { key: "oi_heat_leg", tail: "top" as const, label: "OI heat (leg)" },
  { key: "funding_7d", tail: "top" as const, label: "Funding rate 7d" },
  { key: "composite", tail: "top" as const, label: "Composite score" },
];

const TAIL_PCTILES = [10, 5, 2];

function runTails(era: string, from: string, verbose: boolean): number {
  let written = 0;
  for (const { key, tail, label } of TAIL_SIGNALS) {
    const rows = db
      .prepare(
        `SELECT ${key} AS v, fwd_30d AS f30, fwd_90d AS f90, fwd_180d AS f180
         FROM signals WHERE ${key} IS NOT NULL AND fwd_90d IS NOT NULL AND date >= ?`
      )
      .all(from) as { v: number; f30: number | null; f90: number | null; f180: number | null }[];
    if (rows.length < 100) continue;

    const sorted = [...rows].sort((a, b) => (tail === "top" ? b.v - a.v : a.v - b.v));

    for (const pctile of TAIL_PCTILES) {
      const k = Math.floor((sorted.length * pctile) / 100);
      if (k < 20) continue; // too few observations to say anything
      const sub = sorted.slice(0, k);
      const pick = (f: "f30" | "f90" | "f180") =>
        sub.map((r) => r[f]).filter((v): v is number => v != null);
      const f90 = pick("f90");
      const f180 = pick("f180");

      upsertTail.run({
        signal: key,
        era,
        tail,
        pctile,
        n: k,
        threshold: sub.at(-1)!.v,
        medFwd30d: pick("f30").length ? median(pick("f30")) : null,
        medFwd90d: f90.length ? median(f90) : null,
        medFwd180d: f180.length ? median(f180) : null,
        hitRate90d: f90.length ? f90.filter((v) => v > 0).length / f90.length : null,
        hitRate180d: f180.length ? f180.filter((v) => v > 0).length / f180.length : null,
      });
      written++;

      if (verbose && pctile === 2) {
        const m90 = f90.length ? median(f90) : 0;
        const m180 = f180.length ? median(f180) : 0;
        const hit = f90.length ? f90.filter((v) => v > 0).length / f90.length : 0;
        console.log(
          `  ${label.padEnd(20)} ${tail} 2%  n=${String(k).padStart(3)}  ` +
            `med90 ${((m90 * 100).toFixed(1) + "%").padStart(8)}  ` +
            `med180 ${((m180 * 100).toFixed(1) + "%").padStart(8)}  ` +
            `hit90 ${(hit * 100).toFixed(0)}%`
        );
      }
    }
  }
  return written;
}

export function runBacktest() {
  console.log("=== Backtest (median 90d forward return by bucket) ===");
  db.prepare("DELETE FROM backtest_results").run();
  db.prepare("DELETE FROM tail_results").run();

  let total = 0;
  for (const era of ERAS) {
    const verbose = era.key === "modern";
    if (verbose) console.log(`\n  ── deciles, ${era.label} ──`);
    for (const { key, label } of DECILE_SIGNALS) {
      total += backtestBuckets(key, label, era.key, era.from, verbose);
    }
    total += backtestTermRegimes(era.key, era.from, verbose);

    if (verbose) console.log(`\n  ── extreme tails, ${era.label} ──`);
    total += runTails(era.key, era.from, verbose);
  }

  console.log(`\n  Wrote ${total} results across ${ERAS.length} eras.`);
  return total;
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("backtest.ts") || entry.endsWith("backtest.js")) {
  runBacktest();
  db.close();
}
