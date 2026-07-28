# BTC Regime Monitor

A cross-source read on crypto risk appetite: on-chain valuation, derivatives leverage, the sUSDe
term structure, and macro liquidity — aggregated into a two-axis regime view.

Every threshold in the dashboard is backtested, and **the indicators that failed are labelled as
failed rather than quietly dropped.**

Companion to the [sUSDe Term Structure Dashboard](../susdeDashboard) (which runs on port 3001;
this one uses 3002 and can read its API).

---

## The core design decision: two axes, not one score

A "bottom signal" and an "overheat signal" do not belong on the same axis. They answer different
questions and are informative at opposite ends of the cycle — averaging them into a single number
destroys the information.

So position is plotted in two dimensions, with a 90-day trail so trajectory is visible:

|                    | **Unlevered**       | **Crowded**       |
| ------------------ | ------------------- | ----------------- |
| **Cheap**          | Accumulation zone   | Falling knife     |
| **Expensive**      | Healthy trend       | Danger zone       |

Macro liquidity is a third, exogenous axis — it moves the whole board rather than sitting on it.

---

## What the backtest found

Run `npm run backtest` to reproduce. Median 90/180-day forward BTC returns, 2018+ era.

### Validated

| Signal | Tail | Median 90d | Median 180d | Hit rate 90d |
| ------ | ---- | ---------: | ----------: | -----------: |
| **MVRV Z-score** | bottom 5% | **+43.8%** | **+125.6%** | 95% |
| **Spot / realized price** | bottom 5% | +43.8% | +125.6% | 96% |
| Mayer multiple | bottom 5% | +1.4% | +90.4% | 56% |
| Gold/BTC RSI | top 5% | +1.0% | +76.1% | 53% |
| Puell multiple | bottom 5% | +10.1% | +67.1% | 59% |
| Composite score | top 5% | +10.6% | +41.4% | 56% |
| Net liquidity 90d chg | decile spread | — | — | +36pp D1→D10 |

Realized price is the strongest signal in the set — which supports the emphasis Blockworks'
"Bottom Signals" places on it, **but only in the tail.** Across deciles it is unremarkable; the
entire edge lives in the bottom few percent of readings.

### Failed

**Nasdaq/BTC RSI** — the headline indicator of the source report. Its top 5% of readings (the "most
oversold on record" zone) were followed by a median **−9.1% at 90 days and −10.7% at 180 days**,
positive only 32% of the time. Across deciles the spread is 1.4pp, i.e. nothing.

It is still displayed on Panel 1, with the failure stated inline, but is **excluded from the
composite score**. Gold/BTC, built identically, does validate — a notable asymmetry.

**sUSDe contango** — the sUSDe term-structure report describes contango as its strongest bullish
signal (positive 90-day skew 80%+ of the time). On the data available here, contango readings were
followed by a median **−20.5%** over 90 days, positive 20% of the time (n=46 days). Steep
backwardation *did* behave as advertised (−10.1%, 15% hit rate).

Caveats before discarding it: small sample, entirely out-of-sample versus the report's window, a
period dominated by one large drawdown, and this repo computes the spread as longest-dated minus
shortest-dated maturity, which may differ from the report's front/back-month definition.

### Surprising

**Stablecoin float growth is contrarian.** Fast 30-day float growth precedes *lower* forward
returns (−25pp decile spread), and the sign is consistent across all three eras tested. That
consistency is what justifies treating it as structure rather than noise: the float expands hardest
as retail money arrives late in a rally. It enters the macro score inverted.

---

## Three rules that keep the numbers honest

**1. Era segmentation.** Over 2010–2013 BTC rose roughly 1000×, which swamps everything. Run the
full history and the lowest Nasdaq/BTC RSI decile shows **+242%** average 90-day forward returns,
and every valuation signal backtests *inverted* — because "expensive" readings in 2011 were still
followed by 10× moves. Those buckets describe a market that no longer exists. Signals are bucketed
per era; the dashboard defaults to `modern` (2018+).

**2. Point-in-time statistics.** Percentiles and Z-scores use expanding windows, so a historical row
only ever sees data that existed on that date. Using full-history statistics at historical dates is
lookahead bias and would flatter every signal. For the latest date the two are identical, so live
readings are unaffected.

**3. Medians lead, and `n` is not what it looks like.** Forward windows overlap heavily, so `n`
counts calendar days rather than independent trials — a 90-day bucket with n=300 is roughly 3
independent episodes. The MVRV bottom-5% result, impressive as it looks, is essentially March 2020
and November 2022. Suggestive, not statistically significant. The UI says so.

---

## Data sources

All free. No paid subscription is required for anything on the dashboard.

| Source | Provides | Key? | Notes |
| ------ | -------- | ---- | ----- |
| **Coin Metrics community** | BTC price, market cap, MVRV, supply, issuance — daily from 2010-07-18 | No | See "realized price" below |
| **Yahoo Finance** | ^NDX, GC=F (gold), DX-Y.NYB (dollar) | No | Needs a browser-ish User-Agent |
| **FRED** | WALCL, WTREGEN, RRPONTSYD, BAMLH0A0HYM2, DTWEXBGS, DFII10, NFCI | No | `fredgraph.csv`; one series per request (multi-id returns a ZIP) |
| **DefiLlama** | Aggregate stablecoin float | No | USD-pegged only |
| **Pendle** | sUSDe term structure | No | Falls back from the sUSDe dashboard's API |
| **Coinalyze / Velo** | Open-interest history | **Yes (free)** | Required for a usable leverage panel |
| **OKX / CoinGecko** | Open interest fallback | No | 180 days / today-only |

### Deriving realized price without a subscription

Coin Metrics paywalls `CapRealUSD`, but exposes `CapMVRVCur`, `CapMrktCurUSD` and `SplyCur` — and
MVRV is *defined* as market cap ÷ realized cap. So:

```
realized_cap   = mcap / mvrv
realized_price = realized_cap / supply
```

This reconstructs the paywalled series exactly. Cross-checked against the ~$53,000 realized price
published in "Bottom Signals": this yields **$52,869** for the same date.

### Regional API blocks

**Binance and Bybit reject direct API calls from this host's region** (HTTP 451 / CloudFront country
block). Never call them directly — reach their data through an aggregator. CoinGecko's
`/derivatives/exchanges` reports Binance's open interest in BTC terms without touching Binance.

### Open interest: the one real gap

The 1000x overheat signal needs **coin-denominated** open interest, because USD open interest rises
mechanically with price. We derive it as `oi_usd / btc_price`, which means any USD source works.

Without a Coinalyze or Velo key the panel falls back to a 180-day OKX window plus daily CoinGecko
snapshots — enough to display, not enough for meaningful percentiles. **Both keys are free and take
about two minutes:**

- Coinalyze — <https://coinalyze.net/> → Account → API → set `COINALYZE_API_KEY` in `.env`
- Velo — <https://velodata.app/> → set `VELO_API_KEY` in `.env`

Then `npm run seed`. The leverage axis stays flagged unreliable in the UI until there are 365+ days.

---

## Quick start

```bash
npm install
cp .env.example .env   # then add keys
npm run seed           # full history — takes ~25s
npm start              # API on 3002, UI on 5173
```

| Script | Does |
| ------ | ---- |
| `npm start` | API + Vite dev server together |
| `npm run seed` | Full ingest → compute signals → backtest |
| `npm run backtest` | Re-run the backtest only (no network) |
| `npm run server` | API alone (port 3002) |
| `npm run build` | Typecheck + production build |
| `npm run prod` | Production server, serves `dist/` + API |

Raw source data and derived signals live in separate tables. Ingestion only writes raw tables;
`signals` is fully recomputed on every sync. A methodology change — retuning the RSI smoothing, say
— never requires re-fetching a single API.

### Environment

```
COINGECKO_API_KEY=      # carried over from the sUSDe dashboard
COINALYZE_API_KEY=      # free — unlocks the leverage panel
VELO_API_KEY=           # free — alternative to Coinalyze
SUSDE_API_URL=http://localhost:3001
API_PORT=3002           # NOT `PORT` — see below
DUNE_API_KEY=           # unused so far; for ETF flows
```

`API_PORT`, not `PORT`: when a supervisor assigns a port it exports `PORT` for Vite, and the API
would otherwise try to bind the same one.

---

## Methodology notes

### Cross-asset RSI

14-period Wilder RSI on the weekly tradfi/BTC ratio, **in log space**, smoothed with a 5-period EMA
on the output.

Log space is not optional: the Nasdaq/BTC ratio spans six orders of magnitude, and in raw prices the
early years contribute almost no absolute movement, so the indicator ends up describing only the
recent past.

Smoothing the *output* is also the right choice. Blockworks reports a 2022 peak of 68.5; this
construction reproduces **68.2**. Smoothing the *input* instead strips out the counter-moves the RSI
needs and pushes the 2022 peak above 90.

Both parameters are exposed in `CONFIG` at the top of `server/signals.ts`.

### The trend-adjusted bottom band

Every prior bear low traded at a discount to realized price, but **the discount has shrunk every
cycle**: −61% (2011), −44% (2015), −31% (2018), −25% (2022). A fixed "below realized price" trigger
would wait for something that may never arrive.

`computeBottomBand` fits the geometric decay in log space and extrapolates one cycle forward, with a
proper OLS **prediction** interval — not just residual spread. That distinction matters: the
residuals are tiny (the fit is nearly exact), so a naive ±1σ band comes out ~$300 wide, implying a
precision four observations cannot support. The prediction interval adds parameter uncertainty and
the leverage penalty for extrapolating a full step beyond the data.

It is still four data points extrapolated forward. A zone of interest, not a forecast.

### The OI heat ratio

```
heat = %Δ OI(coins) over n days ÷ %Δ price over n days
```

A reading of 2.0 means open interest grew twice as fast as price: the move is carried by new
leverage rather than new spot demand.

Only defined while price is **advancing** by more than 1%. During a drawdown the ratio flips sign
and stops meaning anything; near a flat tape the denominator explodes. Undefined is more honest than
a spurious number.

The 2× and 3× reference lines are drawn as discussion reference points, **not validated
thresholds** — there is not yet enough open-interest history to backtest them. The percentile
readout is the honest measure until the history fills in.

---

## Deployment

Mirrors the sUSDe dashboard: Raspberry Pi behind a Cloudflare Tunnel, `protocol: http2` (QUIC fails
on the Pi's small UDP buffer). Use a second hostname pointing at `http://localhost:3002`.

The daily cron runs at **06:30 UTC** — after FRED's overnight publication window, and late enough
that the previous UTC day is closed everywhere.

---

## Not investment advice

Descriptive statistics on a small number of independent historical episodes.
