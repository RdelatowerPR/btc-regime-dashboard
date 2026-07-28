// ─── DATABASE ───────────────────────────────────────────────────────────────
// SQLite schema for the BTC regime monitor.
//
// Design note: raw source data and derived signals live in separate tables.
// Ingestion only ever writes to the raw tables; `signals` is fully recomputed
// from them on every sync. That means a methodology change (e.g. retuning the
// RSI smoothing constant) never requires re-fetching a single API.

import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";

const DB_PATH = resolve(import.meta.dirname ?? ".", "../data/regime.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
-- ── RAW SOURCES ───────────────────────────────────────────────────────────

-- Coin Metrics community API. Daily, back to 2010-07-18.
-- realized_cap / realized_price are DERIVED here (CapRealUSD is paywalled):
--   realized_cap   = mcap / mvrv
--   realized_price = realized_cap / supply
-- Verified against Blockworks' published $53K figure to within $131.
CREATE TABLE IF NOT EXISTS btc_metrics (
  date           TEXT PRIMARY KEY,
  price          REAL NOT NULL,
  mcap           REAL,
  mvrv           REAL,
  supply         REAL,
  issuance_usd   REAL,
  realized_cap   REAL,
  realized_price REAL
);

-- Yahoo Finance daily closes for cross-asset ratios (^NDX, GC=F, DX-Y.NYB).
CREATE TABLE IF NOT EXISTS tradfi_prices (
  date   TEXT NOT NULL,
  symbol TEXT NOT NULL,
  close  REAL NOT NULL,
  PRIMARY KEY (date, symbol)
);

-- FRED series (keyless CSV endpoint). Mixed frequency — weekly series like
-- WALCL are forward-filled at read time, never at write time.
CREATE TABLE IF NOT EXISTS macro_series (
  date      TEXT NOT NULL,
  series_id TEXT NOT NULL,
  value     REAL,
  PRIMARY KEY (date, series_id)
);

-- Aggregate crypto open interest. oi_coins is the one that matters for the
-- 1000x overheat signal; USD-denominated OI conflates leverage with price.
CREATE TABLE IF NOT EXISTS open_interest (
  date         TEXT PRIMARY KEY,
  oi_usd       REAL,
  oi_coins     REAL,
  funding_rate REAL,
  source       TEXT
);

-- DefiLlama aggregate stablecoin float — crypto-native dry powder.
CREATE TABLE IF NOT EXISTS stablecoin_supply (
  date      TEXT PRIMARY KEY,
  total_usd REAL NOT NULL
);

-- sUSDe Pendle term structure. Sourced from the existing dashboard's API when
-- reachable, else computed directly from Pendle.
CREATE TABLE IF NOT EXISTS term_structure (
  date             TEXT PRIMARY KEY,
  term_spread      REAL,
  term_spread_7dma REAL,
  regime           TEXT,
  btc_outlook      TEXT,
  num_maturities   INTEGER,
  source           TEXT
);

-- ── DERIVED ───────────────────────────────────────────────────────────────

-- One row per date. Fully recomputed by signals.ts on every sync.
CREATE TABLE IF NOT EXISTS signals (
  date                 TEXT PRIMARY KEY,
  price                REAL,

  -- Panel 1: cycle & valuation
  realized_price       REAL,
  realized_ratio       REAL,   -- spot / realized  (1.0 = at cost basis)
  mvrv                 REAL,
  mvrv_z               REAL,
  mvrv_pct             REAL,   -- percentile rank vs full history
  ndx_btc_rsi          REAL,   -- log-space Wilder-14 RSI, EMA-smoothed
  gold_btc_rsi         REAL,
  mayer                REAL,
  puell                REAL,
  drawdown             REAL,
  weeks_from_ath       REAL,

  -- Panel 2: leverage & overheat
  -- oi_heat_leg is the canonical 1000x measure: %ΔOI(coins) ÷ %Δprice over the
  -- CURRENT RALLY LEG (from the last confirmed swing low), which is how it is
  -- defined on air. 2+ is the stated danger zone. The fixed-window variants
  -- are supporting context only.
  oi_heat_leg          REAL,
  oi_leg_start         TEXT,   -- date the current leg began
  oi_leg_price_chg     REAL,
  oi_leg_oi_chg        REAL,
  oi_heat_7d           REAL,   -- %ΔOI(coins) ÷ %Δprice over 7d
  oi_heat_14d          REAL,
  oi_heat_30d          REAL,
  oi_heat_pct          REAL,   -- percentile of oi_heat_leg vs its own history
  oi_mcap_ratio        REAL,
  funding_rate         REAL,

  -- Panel 3: risk appetite
  term_spread_7dma     REAL,
  term_regime          TEXT,

  -- Panel 4: macro liquidity
  net_liquidity        REAL,   -- WALCL - WTREGEN - RRPONTSYD
  net_liquidity_90d    REAL,   -- 90d change, the part that actually signals
  hy_oas               REAL,
  dxy                  REAL,
  real_10y             REAL,
  stablecoin_30d       REAL,   -- 30d % change in aggregate stablecoin float

  -- Panel 0: composite axes, each normalised to -100..+100
  valuation_score      REAL,   -- negative = cheap
  leverage_score       REAL,   -- positive = crowded/fragile
  macro_score          REAL,   -- positive = liquidity tailwind
  composite            REAL,

  -- Forward returns (NULL where the window is incomplete)
  fwd_30d              REAL,
  fwd_90d              REAL,
  fwd_180d             REAL
);

-- Backtest output: how each signal bucket actually performed.
--
-- The era column matters more than anything else here. Over 2010-2013 BTC rose
-- ~1000x, so ANY bucket sampled from that period shows enormous forward returns
-- and every valuation signal backtests inverted. Buckets are therefore computed
-- separately per era and the UI defaults to the modern one.
CREATE TABLE IF NOT EXISTS backtest_results (
  signal      TEXT NOT NULL,
  era         TEXT NOT NULL,
  bucket      TEXT NOT NULL,
  bucket_ord  INTEGER,
  n           INTEGER,
  range_lo    REAL,
  range_hi    REAL,
  avg_fwd_30d REAL,
  avg_fwd_90d REAL,
  avg_fwd_180d REAL,
  hit_rate_90d REAL,
  med_fwd_30d REAL,
  med_fwd_90d REAL,
  med_fwd_180d REAL,
  PRIMARY KEY (signal, era, bucket)
);

-- Extreme-tail results. Deciles are the wrong test for a signal whose thesis
-- is "record readings mark generational lows" — that claim lives entirely in
-- the top/bottom few percent, which a decile average dilutes away. This table
-- asks the question the reports actually make.
CREATE TABLE IF NOT EXISTS tail_results (
  signal       TEXT NOT NULL,
  era          TEXT NOT NULL,
  tail         TEXT NOT NULL,  -- 'top' | 'bot'
  pctile       INTEGER NOT NULL,
  n            INTEGER,
  threshold    REAL,           -- the value at the tail boundary
  med_fwd_30d  REAL,
  med_fwd_90d  REAL,
  med_fwd_180d REAL,
  hit_rate_90d REAL,
  hit_rate_180d REAL,
  PRIMARY KEY (signal, era, tail, pctile)
);

CREATE TABLE IF NOT EXISTS sync_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT DEFAULT CURRENT_TIMESTAMP,
  source  TEXT,
  records INTEGER,
  status  TEXT,
  error   TEXT
);

CREATE INDEX IF NOT EXISTS idx_tradfi_symbol ON tradfi_prices(symbol, date);
CREATE INDEX IF NOT EXISTS idx_macro_series  ON macro_series(series_id, date);
`);

// ── PREPARED STATEMENTS ─────────────────────────────────────────────────────

export const upsertBtcMetric = db.prepare(`
  INSERT INTO btc_metrics (date, price, mcap, mvrv, supply, issuance_usd, realized_cap, realized_price)
  VALUES (@date, @price, @mcap, @mvrv, @supply, @issuanceUsd, @realizedCap, @realizedPrice)
  ON CONFLICT(date) DO UPDATE SET
    price=excluded.price, mcap=excluded.mcap, mvrv=excluded.mvrv,
    supply=excluded.supply, issuance_usd=excluded.issuance_usd,
    realized_cap=excluded.realized_cap, realized_price=excluded.realized_price
`);

export const upsertTradfi = db.prepare(`
  INSERT INTO tradfi_prices (date, symbol, close) VALUES (@date, @symbol, @close)
  ON CONFLICT(date, symbol) DO UPDATE SET close=excluded.close
`);

export const upsertMacro = db.prepare(`
  INSERT INTO macro_series (date, series_id, value) VALUES (@date, @seriesId, @value)
  ON CONFLICT(date, series_id) DO UPDATE SET value=excluded.value
`);

export const upsertOpenInterest = db.prepare(`
  INSERT INTO open_interest (date, oi_usd, oi_coins, funding_rate, source)
  VALUES (@date, @oiUsd, @oiCoins, @fundingRate, @source)
  ON CONFLICT(date) DO UPDATE SET
    oi_usd=excluded.oi_usd, oi_coins=excluded.oi_coins,
    funding_rate=COALESCE(excluded.funding_rate, open_interest.funding_rate),
    source=excluded.source
`);

export const upsertStablecoin = db.prepare(`
  INSERT INTO stablecoin_supply (date, total_usd) VALUES (@date, @totalUsd)
  ON CONFLICT(date) DO UPDATE SET total_usd=excluded.total_usd
`);

export const upsertTermStructure = db.prepare(`
  INSERT INTO term_structure (date, term_spread, term_spread_7dma, regime, btc_outlook, num_maturities, source)
  VALUES (@date, @termSpread, @termSpread7dma, @regime, @btcOutlook, @numMaturities, @source)
  ON CONFLICT(date) DO UPDATE SET
    term_spread=excluded.term_spread, term_spread_7dma=excluded.term_spread_7dma,
    regime=excluded.regime, btc_outlook=excluded.btc_outlook,
    num_maturities=excluded.num_maturities, source=excluded.source
`);

export const upsertTail = db.prepare(`
  INSERT INTO tail_results
    (signal, era, tail, pctile, n, threshold, med_fwd_30d, med_fwd_90d, med_fwd_180d,
     hit_rate_90d, hit_rate_180d)
  VALUES
    (@signal, @era, @tail, @pctile, @n, @threshold, @medFwd30d, @medFwd90d, @medFwd180d,
     @hitRate90d, @hitRate180d)
  ON CONFLICT(signal, era, tail, pctile) DO UPDATE SET
    n=excluded.n, threshold=excluded.threshold,
    med_fwd_30d=excluded.med_fwd_30d, med_fwd_90d=excluded.med_fwd_90d,
    med_fwd_180d=excluded.med_fwd_180d,
    hit_rate_90d=excluded.hit_rate_90d, hit_rate_180d=excluded.hit_rate_180d
`);

export const insertSyncLog = db.prepare(`
  INSERT INTO sync_log (source, records, status, error)
  VALUES (@source, @records, @status, @error)
`);

export const upsertBacktest = db.prepare(`
  INSERT INTO backtest_results
    (signal, era, bucket, bucket_ord, n, range_lo, range_hi,
     avg_fwd_30d, avg_fwd_90d, avg_fwd_180d, hit_rate_90d,
     med_fwd_30d, med_fwd_90d, med_fwd_180d)
  VALUES
    (@signal, @era, @bucket, @bucketOrd, @n, @rangeLo, @rangeHi,
     @avgFwd30d, @avgFwd90d, @avgFwd180d, @hitRate90d,
     @medFwd30d, @medFwd90d, @medFwd180d)
  ON CONFLICT(signal, era, bucket) DO UPDATE SET
    bucket_ord=excluded.bucket_ord, n=excluded.n,
    range_lo=excluded.range_lo, range_hi=excluded.range_hi,
    avg_fwd_30d=excluded.avg_fwd_30d, avg_fwd_90d=excluded.avg_fwd_90d,
    avg_fwd_180d=excluded.avg_fwd_180d, hit_rate_90d=excluded.hit_rate_90d,
    med_fwd_30d=excluded.med_fwd_30d, med_fwd_90d=excluded.med_fwd_90d,
    med_fwd_180d=excluded.med_fwd_180d
`);
