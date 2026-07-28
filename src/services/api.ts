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
}

export interface BottomBand {
  projectedDiscount: number;
  priceMid: number;
  priceLow: number;
  priceHigh: number;
  observations: number;
  caveat: string;
}

export interface RegimeResponse {
  latest: SignalRow | null;
  trail: { date: string; valuation_score: number; leverage_score: number; price: number }[];
  bottomBand: BottomBand | null;
  cycleLows: { date: string; discount: number }[];
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

export interface LeverageResponse {
  series: (SignalRow & { oi_usd: number; oi_coins: number; source: string })[];
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
  latestDate: string | null;
  config: Record<string, unknown>;
  recentSyncs: { ts: string; source: string; records: number; status: string; error: string | null }[];
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${path}`);
  return res.json() as Promise<T>;
}

export const fetchRegime = (trail = 90) => get<RegimeResponse>(`/api/regime?trail=${trail}`);
export const fetchCycle = (from = "2017-01-01") =>
  get<{ series: SignalRow[] }>(`/api/cycle?from=${from}`);
export const fetchLeverage = () => get<LeverageResponse>("/api/leverage");
export const fetchTermStructure = () => get<TermStructureResponse>("/api/term-structure");
export const fetchMacro = (from = "2018-01-01") =>
  get<{ series: SignalRow[] }>(`/api/macro?from=${from}`);
export const fetchBacktest = (era = "modern") => get<BacktestResponse>(`/api/backtest?era=${era}`);
export const fetchStats = () => get<StatsResponse>("/api/stats");
