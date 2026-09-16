// ─── API CLIENT ─────────────────────────────────────────────────────────────

export interface SignalRow {
  date: string;
  price: number;
  realized_price: number | null;
  realized_ratio: number | null;
  mvrv: number | null;
  mvrv_z: number | null;
  mvrv_pct: number | null;
  ndx_btc_rsi: number | null;
  gold_btc_rsi: number | null;
  mayer: number | null;
  puell: number | null;
  drawdown: number | null;
  weeks_from_ath: number | null;
  oi_heat_leg: number | null;
  oi_leg_start: string | null;
  oi_leg_price_chg: number | null;
  oi_leg_oi_chg: number | null;
  oi_heat_7d: number | null;
  oi_heat_14d: number | null;
  oi_heat_30d: number | null;
  oi_heat_pct: number | null;
  oi_mcap_ratio: number | null;
  funding_rate: number | null;
  term_spread_7dma: number | null;
  term_regime: string | null;
  net_liquidity: number | null;
  net_liquidity_90d: number | null;
  hy_oas: number | null;
  dxy: number | null;
  real_10y: number | null;
  stablecoin_30d: number | null;
  valuation_score: number | null;
  leverage_score: number | null;
  macro_score: number | null;
  composite: number | null;
  funding_7d?: number | null;
  taker_buy_7d?: number | null;
  long_share_7d?: number | null;
  long_share_chg30?: number | null;
}

export interface BottomBand {
  projectedDiscount: number;
  priceMid: number;
  priceLow: number;
  priceHigh: number;
  observations: number;
  caveat: string;
}

export type QuadrantKey = "acc" | "knife" | "trend" | "danger";

export interface TrailRow {
  date: string;
  valuation_score: number;
  leverage_score: number;
  macro_score: number | null;
  composite: number | null;
  price: number;
  /** Regime label with its dead zone applied (server/verdict.ts); null before enough history. */
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
  strength: "faint" | "moderate" | "strong";
  depth: number;
  valuation_smooth: number;
  leverage_smooth: number;
  runStart: string;
  daysInQuadrant: number;
  enteredFrom: QuadrantKey | null;
  enteredHow: "valuation" | "leverage" | "both" | null;
  rules: { version: string; smoothDays: number; band: number };
}

export interface RegimeResponse {
  latest: SignalRow | null;
  trail: TrailRow[];
  bottomBand: BottomBand | null;
  cycleLows: { date: string; discount: number }[];
  verdict: Verdict | null;
}

/** One row per as-of date, written once and never rewritten. Forward returns join from `signals`. */
export interface VerdictLogRow {
  signal_date: string;
  logged_at: string;
  rules_version: string;
  quadrant: QuadrantKey;
  strength: "faint" | "moderate" | "strong";
  depth: number;
  days_in_quadrant: number;
  run_start: string;
  entered_from: QuadrantKey | null;
  price: number;
  valuation_score: number | null;
  leverage_score: number | null;
  macro_score: number | null;
  composite: number | null;
  valuation_smooth: number | null;
  leverage_smooth: number | null;
  realized_price: number | null;
  mvrv_z: number | null;
  drawdown: number | null;
  oi_heat_leg: number | null;
  funding_rate: number | null;
  term_regime: string | null;
  band_low: number | null;
  band_mid: number | null;
  band_high: number | null;
  fwd_30d: number | null;
  fwd_90d: number | null;
  fwd_180d: number | null;
}

export interface VerdictsResponse {
  rows: VerdictLogRow[];
  count: number;
  since: string | null;
  latestDate: string | null;
  latestPrice: number | null;
  summary: {
    quadrant: QuadrantKey;
    n: number;
    n_90d: number;
    med_fwd_30d: number | null;
    med_fwd_90d: number | null;
    med_fwd_180d: number | null;
    hit_rate_90d: number | null;
  }[];
}

export interface BucketRow {
  signal: string;
  bucket: string;
  bucket_ord: number;
  n: number;
  range_lo: number | null;
  range_hi: number | null;
  avg_fwd_90d: number | null;
  med_fwd_30d: number | null;
  med_fwd_90d: number | null;
  med_fwd_180d: number | null;
  hit_rate_90d: number | null;
}

export interface TailRow {
  signal: string;
  tail: "top" | "bot";
  pctile: number;
  n: number;
  threshold: number | null;
  med_fwd_30d: number | null;
  med_fwd_90d: number | null;
  med_fwd_180d: number | null;
  hit_rate_90d: number | null;
  hit_rate_180d: number | null;
}

export interface BacktestResponse {
  era: string;
  eras: { key: string; from: string; label: string }[];
  buckets: BucketRow[];
  tails: TailRow[];
  caveat: string;
}

export interface OiHeatSpec {
  source: string;
  url: string;
  quote: string;
  formula: string;
  dangerZone: number;
  severeZone: number;
  workedExamples: { leg: string; priceChange: number; oiChange: number; ratio: number; verdict: string }[];
}

export interface OiThreshold {
  threshold: number;
  n: number;
  aboveMed30d: number | null;
  aboveMed90d: number | null;
  belowMed30d: number | null;
  belowMed90d: number | null;
}

export interface VenueRow {
  symbol: string;
  exchange: string;
  funding_8h: number | null;
  oi_usd: number | null;
  volume_usd: number | null;
  oi_share: number | null;
  vol_share: number | null;
  weight: number | null;
}

export interface LeverageResponse {
  series: (SignalRow & {
    oi_usd: number;
    oi_coins: number;
    source: string;
    funding_simple?: number | null;
    taker_buy?: number | null;
    volume_usd?: number | null;
    n_venues?: number | null;
  })[];
  /** Per-venue funding, open interest and volume shares on the latest day. */
  venues: VenueRow[];
  venuesDate: string | null;
  /** OI-weighted account long share (Binance, Bybit), 7-day mean and 30-day change. Labels, not scored. */
  positioning: { date: string; long_share_7d: number | null; long_share_chg30: number | null } | null;
  fundingHistory: { first: string | null; n: number } | null;
  coverage: { n: number; first: string; last: string; source: string } | null;
  spec: OiHeatSpec | null;
  thresholds: OiThreshold[];
  hasHistory: boolean;
  note: string | null;
}

export interface TermStructureResponse {
  series: {
    date: string;
    term_spread: number | null;
    term_spread_7dma: number | null;
    regime: string | null;
    btc_outlook: string | null;
    num_maturities: number | null;
    source: string | null;
    price: number | null;
  }[];
  regimeStats: {
    regime: string;
    n: number;
    med_fwd_90d: number | null;
    avg_fwd_90d: number | null;
    hit_rate_90d: number | null;
  }[];
}

export interface StatsResponse {
  counts: Record<string, number>;
  /** MAX(date) per raw table, so each source can be dated on its own. */
  freshness: Record<string, string | null>;
  latestDate: string | null;
  config: Record<string, unknown>;
  recentSyncs: { ts: string; source: string; records: number; status: string; error: string | null }[];
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${path}`);
  return res.json() as Promise<T>;
}

export const fetchRegime = (trail = 365) => get<RegimeResponse>(`/api/regime?trail=${trail}`);
export const fetchVerdicts = () => get<VerdictsResponse>("/api/verdicts");
export const fetchCycle = (from = "2017-01-01") =>
  get<{ series: SignalRow[] }>(`/api/cycle?from=${from}`);
export const fetchLeverage = () => get<LeverageResponse>("/api/leverage");
export const fetchTermStructure = () => get<TermStructureResponse>("/api/term-structure");
export const fetchMacro = (from = "2018-01-01") =>
  get<{ series: SignalRow[] }>(`/api/macro?from=${from}`);
export const fetchBacktest = (era = "modern") => get<BacktestResponse>(`/api/backtest?era=${era}`);
export const fetchStats = () => get<StatsResponse>("/api/stats");
