// ─── STATISTICAL PRIMITIVES ─────────────────────────────────────────────────
// Kept separate from signals.ts so the backtest can reuse them and so each
// piece is testable in isolation.
//
// House rule: anything that will be backtested uses an EXPANDING window, i.e.
// only data available up to that point in time. Using full-history statistics
// at historical dates is lookahead bias and would flatter every signal. For
// the latest date the two are identical, so live readings are unaffected.

/** Exponential moving average. Seeded with the first observation. */
export function ema(series: number[], span: number): number[] {
  if (series.length === 0) return [];
  const k = 2 / (span + 1);
  const out = [series[0]];
  for (let i = 1; i < series.length; i++) out.push(series[i] * k + out[i - 1] * (1 - k));
  return out;
}

/** Simple trailing mean over `n` periods. NULL until the window is full. */
export function sma(series: number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < series.length; i++) {
    sum += series[i];
    if (i >= n) sum -= series[i - n];
    out.push(i >= n - 1 ? sum / n : null);
  }
  return out;
}

/**
 * Wilder's RSI. `series` should already be in whatever space you want the
 * momentum measured in — for a ratio spanning orders of magnitude (like
 * Nasdaq/BTC, which runs from ~4 to ~500,000) that must be LOG space, or the
 * early years contribute almost no absolute movement and the indicator ends
 * up describing only the recent past.
 */
export function wilderRSI(series: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(series.length).fill(null);
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i < series.length; i++) {
    const change = series[i] - series[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    if (i <= period) {
      avgGain += gain / period;
      avgLoss += loss / period;
      if (i === period) out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return out;
}

/** Population standard deviation. */
export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Expanding-window percentile rank: for each point, what fraction of all
 * PRIOR observations it exceeds, in 0..100. `minSample` suppresses the noisy
 * readings at the very start of history.
 */
export function expandingPercentile(
  series: (number | null)[],
  minSample = 365
): (number | null)[] {
  const out: (number | null)[] = new Array(series.length).fill(null);
  const seen: number[] = []; // kept sorted for binary-search insertion

  for (let i = 0; i < series.length; i++) {
    const v = series[i];
    if (v == null || !Number.isFinite(v)) continue;

    if (seen.length >= minSample) {
      let lo = 0;
      let hi = seen.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (seen[mid] < v) lo = mid + 1;
        else hi = mid;
      }
      out[i] = (lo / seen.length) * 100;
    }

    // Insert v, keeping `seen` sorted.
    let lo = 0;
    let hi = seen.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seen[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    seen.splice(lo, 0, v);
  }
  return out;
}

/** Expanding-window standard deviation, for point-in-time Z-scores. */
export function expandingStdev(series: (number | null)[], minSample = 365): (number | null)[] {
  const out: (number | null)[] = new Array(series.length).fill(null);
  let n = 0;
  let sum = 0;
  let sumSq = 0;

  for (let i = 0; i < series.length; i++) {
    const v = series[i];
    if (v == null || !Number.isFinite(v)) continue;
    n++;
    sum += v;
    sumSq += v * v;
    if (n >= minSample) {
      const variance = sumSq / n - (sum / n) ** 2;
      out[i] = variance > 0 ? Math.sqrt(variance) : null;
    }
  }
  return out;
}

/** Forward-fill nulls with the last non-null value. */
export function forwardFill(series: (number | null)[]): (number | null)[] {
  const out = [...series];
  let last: number | null = null;
  for (let i = 0; i < out.length; i++) {
    if (out[i] != null) last = out[i];
    else out[i] = last;
  }
  return out;
}

/** Map a 0..100 percentile onto a -100..+100 score. */
export function pctToScore(pct: number | null): number | null {
  return pct == null ? null : (pct - 50) * 2;
}

/**
 * ZigZag swing detection. Returns, for each index, the index of the most
 * recent CONFIRMED swing low at or before it.
 *
 * Needed because the 1000x open-interest ratio is measured per rally leg, not
 * over a fixed lookback — in the worked example on air, one leg ran about two
 * months and the next about a week. A fixed 30-day window would have straddled
 * both and reported neither.
 *
 * A low is confirmed once price has risen `threshold` above it; a high is
 * confirmed once price has fallen `threshold` below it. Confirmation is
 * strictly backward-looking, so no future information leaks into a given row.
 */
export function swingLowIndices(prices: number[], threshold = 0.1): (number | null)[] {
  const out: (number | null)[] = new Array(prices.length).fill(null);
  if (prices.length === 0) return out;

  let seekingHigh = true; // start by looking for a high to fall away from
  let extremeIdx = 0;
  let confirmedLow: number | null = null;

  for (let i = 1; i < prices.length; i++) {
    if (seekingHigh) {
      if (prices[i] > prices[extremeIdx]) extremeIdx = i;
      // A drop of `threshold` from the running high starts a down-leg.
      else if (prices[i] <= prices[extremeIdx] * (1 - threshold)) {
        seekingHigh = false;
        extremeIdx = i;
      }
    } else {
      if (prices[i] < prices[extremeIdx]) extremeIdx = i;
      // A rise of `threshold` off the running low confirms that low.
      else if (prices[i] >= prices[extremeIdx] * (1 + threshold)) {
        confirmedLow = extremeIdx;
        seekingHigh = true;
        extremeIdx = i;
      }
    }
    out[i] = confirmedLow;
  }
  return out;
}

/** Mean of the non-null entries, or null if there are none. */
export function meanOf(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
