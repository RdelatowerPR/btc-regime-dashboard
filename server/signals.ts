// ─── SIGNAL COMPUTATION ─────────────────────────────────────────────────────
// Rebuilds the entire `signals` table from the raw source tables. Cheap enough
// (~6k rows) to run in full on every sync, which means methodology changes
// take effect without re-fetching anything.

import { db } from "./db.js";
import {
  ema,
  sma,
  wilderRSI,
  expandingPercentile,
  expandingStdev,
  forwardFill,
  pctToScore,
  meanOf,
  swingLowIndices,
} from "./stats.js";

// ── TUNABLES ───────────────────────────────────────────────────────────────
// Exposed here rather than buried in the code because the relative-strength
// construction is reverse-engineered from a published summary, not a spec.
//
// Blockworks' "Bottom Signals" reports a 14-period RSI on the weekly
// Nasdaq/BTC ratio with a peak of 68.5 in 2022. Log-space Wilder-14 with a
// 5-period EMA on the OUTPUT reproduces that at 68.2. Smoothing the INPUT
// instead inflates every reading (it strips the counter-moves the RSI needs)
// and pushes the 2022 peak to 90+, so it is the wrong construction.
export const CONFIG = {
  rsiPeriod: 14,
  rsiSmoothing: 5, // EMA span applied to the RSI output
  mayerWindow: 200,
  puellWindow: 365,
  minSample: 365, // days before percentile/Z-score readings are trusted
  oiHeatWindows: [7, 14, 30] as const,
  // The overheat ratio is only meaningful while price is advancing — see
  // computeOiHeat below.
  oiHeatMinPriceMove: 0.01,
  // Reversal threshold for the rally-leg detector (see OI_HEAT_SPEC).
  oiLegThreshold: 0.1,
};

/**
 * The 1000x open-interest overheat ratio, transcribed from the source episode
 * ("How To Trade Using Open Interest & Funding Rates", Blockworks 1000x,
 * youtu.be/38M4dwHvlwA). Jonah Van Bourg, verbatim:
 *
 *   "you basically take the number of coins and you divide it by the price
 *    movement. And if that ratio is like two or three, then you're in a
 *    danger zone."
 *
 * His two worked examples pin the units, which the sentence alone does not:
 *
 *   leg 1  price 74,000 → 103,600 (+40%),  OI 170,000 → 185,000 coins (+8.8%)
 *          ratio = 8.8 / 40   = 0.22       "open interest doesn't go crazy"
 *   leg 2  price 102,000 → 111,000 (+8.8%), OI 185,000 → 225,000 coins (+21.6%)
 *          ratio = 21.6 / 8.8 = 2.45       the danger case
 *
 * 2.45 lands squarely in "like two or three", so the ratio is
 * PERCENT change in coin-denominated OI ÷ PERCENT change in price — a
 * dimensionless quantity, which is also the only reading under which a fixed
 * 2-3 threshold can travel across price levels. (Reading it as "thousands of
 * coins per percent" gives 0.38 and 4.53, which fits his wording far worse.)
 *
 * Two further details from the same segment:
 *
 *   - Open interest is counted "in bitcoin terms across all exchanges" —
 *     aggregated and coin-denominated, which is what ingestOpenInterest builds.
 *   - It is measured PER RALLY LEG, not over a fixed lookback. Leg 1 above ran
 *     roughly two months, leg 2 roughly a week. Hence the swing-leg detector;
 *     the fixed 7/14/30-day windows are kept only as supporting context.
 *
 * On funding, from the same episode: "I don't actually use funding at all
 * anymore except to confirm direction of open interest." A funding spike
 * alongside rising OI implies aggressive taker longs rather than balanced
 * two-way flow. It is therefore shown as a confirmation overlay, not scored
 * as an independent signal.
 */
export const OI_HEAT_SPEC = {
  source: "Blockworks 1000x — How To Trade Using Open Interest & Funding Rates",
  url: "https://www.youtube.com/watch?v=38M4dwHvlwA",
  quote:
    "you basically take the number of coins and you divide it by the price movement. " +
    "And if that ratio is like two or three, then you're in a danger zone.",
  formula: "%Δ open interest (coins) ÷ %Δ price, measured over the current rally leg",
  dangerZone: 2,
  severeZone: 3,
  workedExamples: [
    { leg: "Apr→May 2025", priceChange: 0.4, oiChange: 0.088, ratio: 0.22, verdict: "healthy" },
    { leg: "from 18 May 2025", priceChange: 0.088, oiChange: 0.216, ratio: 2.45, verdict: "danger" },
  ],
};

// Historical bear-market lows, as a discount of spot to realized price.
// Each successive cycle has bottomed at a SHALLOWER discount, so a fixed
// "below realized price" trigger would wait for something that may never
// arrive. computeBottomBand fits the decay and extrapolates.
export const CYCLE_LOWS = [
  { date: "2011-10-19", discount: -0.61 },
  { date: "2015-01-14", discount: -0.44 },
  { date: "2018-12-15", discount: -0.31 },
  { date: "2022-11-09", discount: -0.25 },
];

/**
 * Extrapolate the next cycle's expected bottom discount.
 *
 * |discount| decays geometrically (each cycle bottoms at ~0.72, 0.70, 0.81 of
 * the prior cycle's discount), so we fit a line to log|discount| against cycle
 * index and step one cycle forward.
 *
 * The band is a proper OLS PREDICTION interval, not just the residual spread.
 * That matters here: the residuals happen to be tiny (the log-linear fit is
 * almost exact), so a naive ±1σ band comes out about $300 wide, which would
 * imply a precision that four observations cannot possibly support. The
 * prediction interval adds the parameter uncertainty and the leverage penalty
 * for extrapolating one full step beyond the data:
 *
 *     se_pred = s · sqrt(1 + 1/n + (x₀-x̄)² / Σ(x-x̄)²)
 *
 * with s carrying df = n-2. Reported at 2σ (~95%).
 *
 * Even so: this is FOUR data points extrapolated one cycle forward. Treat it
 * as a zone of interest, not a forecast. The UI labels it accordingly.
 */
export function computeBottomBand(realizedPrice: number) {
  const xs = CYCLE_LOWS.map((_, i) => i);
  const ys = CYCLE_LOWS.map((c) => Math.log(Math.abs(c.discount)));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / sxx;
  const intercept = my - slope * mx;

  const x0 = n; // the next cycle
  const fitted = intercept + slope * x0;

  // Residual standard error with regression degrees of freedom.
  const sse = ys.reduce((s, y, i) => s + (y - (intercept + slope * xs[i])) ** 2, 0);
  const s = Math.sqrt(sse / Math.max(1, n - 2));
  const sePred = s * Math.sqrt(1 + 1 / n + (x0 - mx) ** 2 / sxx);
  const halfWidth = 2 * sePred;

  return {
    projectedDiscount: -Math.exp(fitted),
    priceMid: realizedPrice * (1 - Math.exp(fitted)),
    // A LARGER log|discount| means a deeper discount, so it maps to the LOWER
    // price bound.
    priceLow: realizedPrice * (1 - Math.exp(fitted + halfWidth)),
    priceHigh: realizedPrice * (1 - Math.exp(fitted - halfWidth)),
    observations: n,
    caveat: `Extrapolated from ${n} historical cycle lows; 2σ prediction interval.`,
  };
}

// ── ROW TYPES ──────────────────────────────────────────────────────────────

interface BtcRow {
  date: string;
  price: number;
  mcap: number | null;
  mvrv: number | null;
  realized_cap: number | null;
  realized_price: number | null;
  issuance_usd: number | null;
}

/**
 * Weekly log-ratio RSI of `symbol` against BTC, forward-filled back onto the
 * daily grid.
 *
 * Orientation: the ratio is TRADFI / BTC, so a HIGH reading means the
 * traditional asset has outperformed, i.e. BTC is oversold against it. That
 * matches how the source report frames its record readings.
 */
function crossAssetRSI(dates: string[], priceByDate: Map<string, number>, symbol: string) {
  const rows = db
    .prepare("SELECT date, close FROM tradfi_prices WHERE symbol = ? ORDER BY date")
    .all(symbol) as { date: string; close: number }[];

  // Collapse to one observation per ISO week (the last of that week).
  const weekly = new Map<string, { date: string; ratio: number }>();
  for (const r of rows) {
    const btc = priceByDate.get(r.date);
    if (!btc || btc <= 0 || r.close <= 0) continue;
    const d = new Date(r.date + "T00:00:00Z");
    // ISO week key
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const year = t.getUTCFullYear();
    const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
    weekly.set(`${year}-${String(week).padStart(2, "0")}`, { date: r.date, ratio: r.close / btc });
  }

  const keys = [...weekly.keys()].sort();
  if (keys.length < CONFIG.rsiPeriod + 2) return new Map<string, number>();

  const logRatios = keys.map((k) => Math.log(weekly.get(k)!.ratio));
  const raw = wilderRSI(logRatios, CONFIG.rsiPeriod);

  // EMA-smooth the defined portion of the RSI output.
  const firstIdx = raw.findIndex((v) => v != null);
  const defined = raw.slice(firstIdx).map((v) => v as number);
  const smoothed = ema(defined, CONFIG.rsiSmoothing);

  // Attach each weekly reading to the date it was observed, then forward-fill.
  const byWeekDate = new Map<string, number>();
  for (let i = 0; i < smoothed.length; i++) {
    byWeekDate.set(weekly.get(keys[firstIdx + i])!.date, smoothed[i]);
  }

  const out = new Map<string, number>();
  let last: number | null = null;
  for (const d of dates) {
    if (byWeekDate.has(d)) last = byWeekDate.get(d)!;
    if (last != null) out.set(d, last);
  }
  return out;
}

/**
 * The 1000x overheat ratio: how fast coin-denominated open interest is growing
 * relative to price.
 *
 *     heat = %Δ OI(coins) over n days ÷ %Δ price over n days
 *
 * Deliberately only defined while price is ADVANCING by more than
 * oiHeatMinPriceMove. The framing is about leverage building into a rally —
 * during a drawdown the ratio flips sign and stops meaning anything, and near
 * a flat tape the denominator explodes. Undefined is more honest than a
 * spurious number.
 *
 * A reading of 2 means OI grew twice as fast as price: new leverage, not new
 * spot demand, is carrying the move.
 */
function computeOiHeat(
  dates: string[],
  oiCoins: Map<string, number>,
  priceByDate: Map<string, number>,
  window: number
): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = window; i < dates.length; i++) {
    const now = dates[i];
    const then = dates[i - window];
    const oiNow = oiCoins.get(now);
    const oiThen = oiCoins.get(then);
    const pNow = priceByDate.get(now);
    const pThen = priceByDate.get(then);
    if (!oiNow || !oiThen || !pNow || !pThen || oiThen <= 0 || pThen <= 0) continue;

    const priceChange = pNow / pThen - 1;
    if (priceChange <= CONFIG.oiHeatMinPriceMove) continue;

    out.set(now, (oiNow / oiThen - 1) / priceChange);
  }
  return out;
}

/**
 * The canonical 1000x measure: the overheat ratio over the CURRENT rally leg,
 * measured from the most recent confirmed swing low. See OI_HEAT_SPEC.
 */
function computeLegHeat(
  dates: string[],
  prices: number[],
  oiCoins: Map<string, number>,
  threshold: number
) {
  const lowIdx = swingLowIndices(prices, threshold);
  const out = new Map<
    string,
    { ratio: number | null; legStart: string; priceChange: number; oiChange: number }
  >();

  for (let i = 0; i < dates.length; i++) {
    const li = lowIdx[i];
    if (li == null || li >= i) continue;

    const oiNow = oiCoins.get(dates[i]);
    const oiThen = oiCoins.get(dates[li]);
    if (!oiNow || !oiThen || oiThen <= 0) continue;

    const priceChange = prices[i] / prices[li] - 1;
    const oiChange = oiNow / oiThen - 1;

    out.set(dates[i], {
      // Only rank the ratio while the leg is actually advancing; below that the
      // denominator is too small to mean anything.
      ratio: priceChange > CONFIG.oiHeatMinPriceMove ? oiChange / priceChange : null,
      legStart: dates[li],
      priceChange,
      oiChange,
    });
  }
  return out;
}

/** Latest value of a FRED series at or before each date (series are ragged). */
function macroByDate(dates: string[], seriesId: string): Map<string, number> {
  const rows = db
    .prepare("SELECT date, value FROM macro_series WHERE series_id = ? AND value IS NOT NULL ORDER BY date")
    .all(seriesId) as { date: string; value: number }[];

  const out = new Map<string, number>();
  let idx = 0;
  let last: number | null = null;
  for (const d of dates) {
    while (idx < rows.length && rows[idx].date <= d) last = rows[idx++].value;
    if (last != null) out.set(d, last);
  }
  return out;
}

// ── MAIN ───────────────────────────────────────────────────────────────────

export function computeSignals() {
  console.log("=== Computing signals ===");

  const btc = db
    .prepare(
      `SELECT date, price, mcap, mvrv, realized_cap, realized_price, issuance_usd
       FROM btc_metrics WHERE price IS NOT NULL ORDER BY date`
    )
    .all() as BtcRow[];

  if (btc.length === 0) {
    console.log("  No BTC metrics — nothing to compute.");
    return 0;
  }

  const dates = btc.map((r) => r.date);
  const prices = btc.map((r) => r.price);
  const priceByDate = new Map(dates.map((d, i) => [d, prices[i]]));

  // ── Panel 1: cycle & valuation ────────────────────────────────────────────

  // MVRV Z-score, point-in-time: (mcap - realized cap) / expanding σ(mcap).
  const mcaps = btc.map((r) => r.mcap);
  const mcapSigma = expandingStdev(mcaps, CONFIG.minSample);
  const mvrvZ = btc.map((r, i) => {
    const s = mcapSigma[i];
    if (r.mcap == null || r.realized_cap == null || s == null || s <= 0) return null;
    return (r.mcap - r.realized_cap) / s;
  });

  const mvrvSeries = btc.map((r) => r.mvrv);
  const mvrvPct = expandingPercentile(mvrvSeries, CONFIG.minSample);

  const realizedRatio = btc.map((r) =>
    r.realized_price && r.realized_price > 0 ? r.price / r.realized_price : null
  );

  const ndxRsi = crossAssetRSI(dates, priceByDate, "^NDX");
  const goldRsi = crossAssetRSI(dates, priceByDate, "GC=F");

  const ma200 = sma(prices, CONFIG.mayerWindow);
  const mayer = prices.map((p, i) => (ma200[i] ? p / ma200[i]! : null));

  const issuance = btc.map((r) => r.issuance_usd ?? 0);
  const issMa = sma(issuance, CONFIG.puellWindow);
  const puell = btc.map((r, i) =>
    r.issuance_usd != null && issMa[i] && issMa[i]! > 0 ? r.issuance_usd / issMa[i]! : null
  );

  // Drawdown and time since the running-maximum price.
  const drawdown: number[] = [];
  const weeksFromAth: number[] = [];
  let runMax = -Infinity;
  let runMaxDate = dates[0];
  for (let i = 0; i < prices.length; i++) {
    if (prices[i] > runMax) {
      runMax = prices[i];
      runMaxDate = dates[i];
    }
    drawdown.push(prices[i] / runMax - 1);
    weeksFromAth.push((Date.parse(dates[i]) - Date.parse(runMaxDate)) / (7 * 86400000));
  }

  // ── Panel 2: leverage & overheat ──────────────────────────────────────────

  const oiRows = db
    .prepare("SELECT date, oi_usd, oi_coins, funding_rate FROM open_interest ORDER BY date")
    .all() as { date: string; oi_usd: number | null; oi_coins: number | null; funding_rate: number | null }[];

  const oiCoins = new Map<string, number>();
  const oiUsd = new Map<string, number>();
  const funding = new Map<string, number>();
  for (const r of oiRows) {
    if (r.oi_coins != null) oiCoins.set(r.date, r.oi_coins);
    if (r.oi_usd != null) oiUsd.set(r.date, r.oi_usd);
    if (r.funding_rate != null) funding.set(r.date, r.funding_rate);
  }

  const heat = Object.fromEntries(
    CONFIG.oiHeatWindows.map((w) => [w, computeOiHeat(dates, oiCoins, priceByDate, w)])
  ) as Record<number, Map<string, number>>;

  // The canonical per-leg measure, plus the fixed windows for context.
  const legHeat = computeLegHeat(dates, prices, oiCoins, CONFIG.oiLegThreshold);
  const legSeries = dates.map((d) => legHeat.get(d)?.ratio ?? null);

  // Percentile ranks the LEG ratio, since that is the measure with a defined
  // threshold. OI history starts 2022, so the minimum sample is modest.
  const heatPct = expandingPercentile(legSeries, 90);

  const oiMcapRatio = btc.map((r, i) => {
    const oi = oiUsd.get(dates[i]);
    return oi != null && r.mcap ? oi / r.mcap : null;
  });

  // ── Panel 3: risk appetite ────────────────────────────────────────────────

  const termRows = db
    .prepare("SELECT date, term_spread_7dma, regime FROM term_structure ORDER BY date")
    .all() as { date: string; term_spread_7dma: number | null; regime: string | null }[];
  const termByDate = new Map(termRows.map((r) => [r.date, r]));

  // ── Panel 4: macro liquidity ──────────────────────────────────────────────
  // Unit note: WALCL and WTREGEN are reported in MILLIONS, RRPONTSYD in
  // BILLIONS. Net liquidity is expressed in $B.
  const walcl = macroByDate(dates, "WALCL");
  const tga = macroByDate(dates, "WTREGEN");
  const rrp = macroByDate(dates, "RRPONTSYD");
  const hyOas = macroByDate(dates, "BAMLH0A0HYM2");
  const dxy = macroByDate(dates, "DTWEXBGS");
  const real10y = macroByDate(dates, "DFII10");

  const netLiquidity = dates.map((d) => {
    const w = walcl.get(d);
    const t = tga.get(d);
    const r = rrp.get(d);
    if (w == null) return null;
    return w / 1000 - (t ?? 0) / 1000 - (r ?? 0);
  });

  // The level of net liquidity trends forever; its rate of change is the signal.
  const netLiq90d = netLiquidity.map((v, i) => {
    const prev = i >= 90 ? netLiquidity[i - 90] : null;
    return v != null && prev != null && prev !== 0 ? (v / prev - 1) * 100 : null;
  });

  const stableRows = db
    .prepare("SELECT date, total_usd FROM stablecoin_supply ORDER BY date")
    .all() as { date: string; total_usd: number }[];
  const stableMap = new Map(stableRows.map((r) => [r.date, r.total_usd]));
  const stableFilled = forwardFill(dates.map((d) => stableMap.get(d) ?? null));
  const stable30d = stableFilled.map((v, i) => {
    const prev = i >= 30 ? stableFilled[i - 30] : null;
    return v != null && prev != null && prev > 0 ? (v / prev - 1) * 100 : null;
  });

  // ── Panel 0: composite axes ───────────────────────────────────────────────
  // Each component becomes an expanding percentile, then maps to -100..+100.
  // Percentiles make dissimilar units comparable and keep any one component
  // from dominating through sheer scale.

  const pctMvrvZ = expandingPercentile(mvrvZ, CONFIG.minSample);
  const pctRealized = expandingPercentile(realizedRatio, CONFIG.minSample);
  const pctMayer = expandingPercentile(mayer, CONFIG.minSample);
  const ndxSeries = dates.map((d) => ndxRsi.get(d) ?? null);
  const goldSeries = dates.map((d) => goldRsi.get(d) ?? null);
  const pctNdx = expandingPercentile(ndxSeries, CONFIG.minSample);
  const pctGold = expandingPercentile(goldSeries, CONFIG.minSample);

  const pctOiMcap = expandingPercentile(oiMcapRatio, 60);
  const fundingSeries = dates.map((d) => funding.get(d) ?? null);
  const pctFunding = expandingPercentile(fundingSeries, 60);

  const pctNetLiq = expandingPercentile(netLiq90d, CONFIG.minSample);
  const pctHy = expandingPercentile(dates.map((d) => hyOas.get(d) ?? null), CONFIG.minSample);
  const pctDxy = expandingPercentile(dates.map((d) => dxy.get(d) ?? null), CONFIG.minSample);
  const pctReal = expandingPercentile(dates.map((d) => real10y.get(d) ?? null), CONFIG.minSample);
  const pctStable = expandingPercentile(stable30d, CONFIG.minSample);

  const invert = (p: number | null) => (p == null ? null : 100 - p);

  const rows = dates.map((date, i) => {
    // Valuation: negative = cheap.
    //
    // Composition here is driven by the backtest, not by which indicators are
    // best known. Measured on 2018+ data, median 90d forward return, bottom
    // vs top decile:
    //
    //   MVRV Z-score      +28.9% → -17.4%   (-46pp spread — the anchor)
    //   Spot / realized   +28.9% → -17.6%   collinear with MVRV Z by
    //                                        construction; both derive from
    //                                        realized cap, so including both
    //                                        would double-weight one input.
    //                                        Displayed, not scored.
    //   Mayer multiple     -1.0% →  -4.7%   (-4pp — weak, small weight)
    //   Gold/BTC RSI      -11.9% →  +3.7%   (+16pp, and +122% median 180d in
    //                                        its top 2% — kept, inverted)
    //   Nasdaq/BTC RSI    -12.0% → -10.6%   (+1.4pp — no measurable edge, and
    //                                        its top 2% returns -1.1% at 90d
    //                                        with a 47% hit rate. EXCLUDED
    //                                        from scoring despite being the
    //                                        report's headline indicator. It
    //                                        is still shown on Panel 1 with
    //                                        its backtest verdict attached.)
    //
    // The cross-asset RSIs invert because a HIGH tradfi/BTC RSI means BTC has
    // underperformed, i.e. is cheap.
    const valuationScore = meanOf([
      pctToScore(pctMvrvZ[i]),
      pctToScore(pctMvrvZ[i]), // double weight: strongest measured component
      pctToScore(pctMayer[i]),
      pctToScore(invert(pctGold[i])),
    ]);

    // Leverage: positive = crowded and fragile.
    const leverageScore = meanOf([
      pctToScore(heatPct[i]),
      pctToScore(pctOiMcap[i]),
      pctToScore(pctFunding[i]),
    ]);

    // Macro: positive = liquidity tailwind. Wider credit spreads, a stronger
    // dollar and higher real rates are all headwinds, so they invert.
    //
    // Stablecoin float growth is ALSO inverted, which is counterintuitive
    // enough to justify: fast float growth backtests to LOWER forward returns,
    // and does so consistently across every era tested (-25pp modern, -27pp
    // recent, -25pp full). A sign that stable across three independent windows
    // is structure, not noise — the float expands hardest as retail money
    // arrives late in a rally, which makes it a euphoria gauge rather than
    // dry powder. Treated as contrarian.
    const macroScore = meanOf([
      pctToScore(pctNetLiq[i]),
      pctToScore(invert(pctHy[i])),
      pctToScore(invert(pctDxy[i])),
      pctToScore(invert(pctReal[i])),
      pctToScore(invert(pctStable[i])),
    ]);

    const term = termByDate.get(date);

    // Composite is oriented as "expected forward return": cheap, unlevered and
    // liquidity-supported is positive.
    const composite = meanOf([
      valuationScore == null ? null : -valuationScore,
      leverageScore == null ? null : -leverageScore,
      macroScore,
    ]);

    return {
      date,
      price: prices[i],
      realizedPrice: btc[i].realized_price,
      realizedRatio: realizedRatio[i],
      mvrv: btc[i].mvrv,
      mvrvZ: mvrvZ[i],
      mvrvPct: mvrvPct[i],
      ndxBtcRsi: ndxSeries[i],
      goldBtcRsi: goldSeries[i],
      mayer: mayer[i],
      puell: puell[i],
      drawdown: drawdown[i],
      weeksFromAth: weeksFromAth[i],
      oiHeat7d: heat[7].get(date) ?? null,
      oiHeat14d: heat[14].get(date) ?? null,
      oiHeat30d: heat[30].get(date) ?? null,
      oiHeatLeg: legSeries[i],
      oiLegStart: legHeat.get(date)?.legStart ?? null,
      oiLegPriceChg: legHeat.get(date)?.priceChange ?? null,
      oiLegOiChg: legHeat.get(date)?.oiChange ?? null,
      oiHeatPct: heatPct[i],
      oiMcapRatio: oiMcapRatio[i],
      fundingRate: fundingSeries[i],
      termSpread7dma: term?.term_spread_7dma ?? null,
      termRegime: term?.regime ?? null,
      netLiquidity: netLiquidity[i],
      netLiquidity90d: netLiq90d[i],
      hyOas: hyOas.get(date) ?? null,
      dxy: dxy.get(date) ?? null,
      real10y: real10y.get(date) ?? null,
      stablecoin30d: stable30d[i],
      valuationScore,
      leverageScore,
      macroScore,
      composite,
      // Forward returns, NULL where the window runs past the end of history.
      fwd30d: i + 30 < prices.length ? prices[i + 30] / prices[i] - 1 : null,
      fwd90d: i + 90 < prices.length ? prices[i + 90] / prices[i] - 1 : null,
      fwd180d: i + 180 < prices.length ? prices[i + 180] / prices[i] - 1 : null,
    };
  });

  const insert = db.prepare(`
    INSERT INTO signals (
      date, price, realized_price, realized_ratio, mvrv, mvrv_z, mvrv_pct,
      ndx_btc_rsi, gold_btc_rsi, mayer, puell, drawdown, weeks_from_ath,
      oi_heat_leg, oi_leg_start, oi_leg_price_chg, oi_leg_oi_chg,
      oi_heat_7d, oi_heat_14d, oi_heat_30d, oi_heat_pct, oi_mcap_ratio, funding_rate,
      term_spread_7dma, term_regime,
      net_liquidity, net_liquidity_90d, hy_oas, dxy, real_10y, stablecoin_30d,
      valuation_score, leverage_score, macro_score, composite,
      fwd_30d, fwd_90d, fwd_180d
    ) VALUES (
      @date, @price, @realizedPrice, @realizedRatio, @mvrv, @mvrvZ, @mvrvPct,
      @ndxBtcRsi, @goldBtcRsi, @mayer, @puell, @drawdown, @weeksFromAth,
      @oiHeatLeg, @oiLegStart, @oiLegPriceChg, @oiLegOiChg,
      @oiHeat7d, @oiHeat14d, @oiHeat30d, @oiHeatPct, @oiMcapRatio, @fundingRate,
      @termSpread7dma, @termRegime,
      @netLiquidity, @netLiquidity90d, @hyOas, @dxy, @real10y, @stablecoin30d,
      @valuationScore, @leverageScore, @macroScore, @composite,
      @fwd30d, @fwd90d, @fwd180d
    )
    ON CONFLICT(date) DO UPDATE SET
      price=excluded.price, realized_price=excluded.realized_price,
      realized_ratio=excluded.realized_ratio, mvrv=excluded.mvrv,
      mvrv_z=excluded.mvrv_z, mvrv_pct=excluded.mvrv_pct,
      ndx_btc_rsi=excluded.ndx_btc_rsi, gold_btc_rsi=excluded.gold_btc_rsi,
      mayer=excluded.mayer, puell=excluded.puell, drawdown=excluded.drawdown,
      weeks_from_ath=excluded.weeks_from_ath,
      oi_heat_leg=excluded.oi_heat_leg, oi_leg_start=excluded.oi_leg_start,
      oi_leg_price_chg=excluded.oi_leg_price_chg, oi_leg_oi_chg=excluded.oi_leg_oi_chg,
      oi_heat_7d=excluded.oi_heat_7d, oi_heat_14d=excluded.oi_heat_14d,
      oi_heat_30d=excluded.oi_heat_30d, oi_heat_pct=excluded.oi_heat_pct,
      oi_mcap_ratio=excluded.oi_mcap_ratio, funding_rate=excluded.funding_rate,
      term_spread_7dma=excluded.term_spread_7dma, term_regime=excluded.term_regime,
      net_liquidity=excluded.net_liquidity, net_liquidity_90d=excluded.net_liquidity_90d,
      hy_oas=excluded.hy_oas, dxy=excluded.dxy, real_10y=excluded.real_10y,
      stablecoin_30d=excluded.stablecoin_30d,
      valuation_score=excluded.valuation_score, leverage_score=excluded.leverage_score,
      macro_score=excluded.macro_score, composite=excluded.composite,
      fwd_30d=excluded.fwd_30d, fwd_90d=excluded.fwd_90d, fwd_180d=excluded.fwd_180d
  `);

  const insertMany = db.transaction((items: typeof rows) => {
    for (const r of items) insert.run(r);
  });
  insertMany(rows);

  const latest = rows.at(-1)!;
  console.log(`  Computed ${rows.length} rows (${rows[0].date} → ${latest.date}).`);
  console.log(
    `  Latest — valuation ${latest.valuationScore?.toFixed(0) ?? "n/a"}, ` +
      `leverage ${latest.leverageScore?.toFixed(0) ?? "n/a"}, ` +
      `macro ${latest.macroScore?.toFixed(0) ?? "n/a"}, ` +
      `composite ${latest.composite?.toFixed(0) ?? "n/a"}`
  );
  return rows.length;
}
