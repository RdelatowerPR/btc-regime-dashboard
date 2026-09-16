# BTC Regime Monitor

A cross-source read on crypto risk appetite: on-chain valuation, derivatives leverage, the sUSDe
term structure, and macro liquidity — aggregated into a two-axis regime view.

Every threshold in the dashboard is backtested, and **the indicators that failed are labelled as
failed rather than quietly dropped.**

**Operators and coding agents:** read `AGENTS.md` before changing runtime, security, deployment,
or data behavior. `CLAUDE.md` imports that same authority for Claude Code.

Companion to the [sUSDe Term Structure Dashboard](https://github.com/RdelatowerPR/susde-term-structure-dashboard)
(which runs on port 3001; this one uses 3002 and can read its API).

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
| **Leverage axis** | decile spread | — | — | **−21pp** D1→D10 |
| **OI heat ≥ 2× / 3×** | see below | −4.7% / −12.5% **at 30d** | — | — |

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
| **Coinalyze** | Open-interest + funding history, daily from 2022-06-18 | **Yes (free)** | Required for a usable leverage panel |
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

### Open interest

The 1000x overheat signal needs **coin-denominated** open interest, because USD open interest rises
mechanically with price. We derive it as `oi_usd / btc_price`, which means any USD source works.

Without a Coinalyze key the panel falls back to a 180-day OKX window plus daily CoinGecko
snapshots — enough to display, not enough for meaningful percentiles. A Coinalyze key is free
(<https://coinalyze.net/> → Account → API → set `COINALYZE_API_KEY` in `.env`, then `npm run seed`)
and yields 1,500 days of aggregated open interest plus funding across 8 venues.

Velo is the tool the 1000x hosts actually use on air, but it is no longer free, so it is not wired up.

The leverage axis stays flagged unreliable in the UI until there are 365+ days of history.

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

Transcribed from the source episode rather than reconstructed —
[1000x, "How To Trade Using Open Interest & Funding Rates"](https://www.youtube.com/watch?v=38M4dwHvlwA).
Jonah Van Bourg, verbatim:

> you basically take the number of coins and you divide it by the price movement. And if that ratio
> is like two or three, then you're in a danger zone.

The sentence leaves the units ambiguous; his two worked examples pin them down:

| Leg | Price | OI (coins) | Ratio | His read |
| --- | ----- | ---------- | ----: | -------- |
| Apr→May 2025 | +40% | 170k → 185k (+8.8%) | **0.22** | "open interest doesn't go crazy" |
| from 18 May | +8.8% | 185k → 225k (+21.6%) | **2.45** | the danger case |

2.45 lands squarely in "like two or three", so the ratio is **% change in coin-denominated OI ÷ %
change in price** — dimensionless, which is also the only reading under which a fixed 2–3 threshold
travels across price levels. (Reading it as "thousands of coins per percent" gives 0.38 and 4.53,
which fits his wording far worse.)

Two further details from the same segment:

- Open interest is counted *"in bitcoin terms across all exchanges"* — aggregated and
  coin-denominated.
- It is measured **per rally leg**, not over a fixed lookback: his legs ran about two months and
  about one week. Hence the ZigZag swing detector in `stats.ts`; the fixed 7/14/30-day windows are
  kept only as supporting context.

Only defined while price is **advancing** by more than 1%. During a drawdown the ratio flips sign
and stops meaning anything; near a flat tape the denominator explodes.

**His thresholds validate — at ~30 days, not 90:**

| OI heat (rally leg) | Median 30d forward | Median 90d | n |
| ------------------- | -----------------: | ---------: | -: |
| below 2× | **+2.0%** | +5.8% | 1,313 |
| ≥ 2× (his danger zone) | **−4.7%** | +3.6% | 37 |
| ≥ 3× | **−12.5%** | +5.3% | 24 |

Monotonic in the right direction, and the effect washes out entirely by 90 days — exactly
consistent with how it is framed on air ("maybe lighten up", "wait a little bit for it to come
off"). It is a tactical positioning signal with a horizon of weeks, not a directional call. An
earlier 90-day-only backtest made it look useless, which is what prompted testing the shorter
horizon.

On funding, same episode: *"I don't actually use funding at all anymore except to confirm direction
of open interest."* A funding spike alongside rising OI implies aggressive taker longs rather than
balanced two-way flow, so it is shown as a confirmation overlay rather than scored independently.

---

## Deployment

Runs on Windows, started at logon by the `CryptoDashboards` scheduled task alongside the sUSDe
dashboard and checked again hourly. The production origin binds only to `127.0.0.1:3002`; do not
widen it to `0.0.0.0` or `::`. The automatic `cloudflared` Windows service is the only public path
and maps `btc.raulantonio.xyz` to that loopback origin. Research and Pons are not tunnel-published.

Control scripts, the desktop toggle, the active-tunnel description, and exact recovery/security
checks live in `../dashboards-control`; use its `OPERATIONS.md` rather than restarting unrelated
services. Manual sync is an operator action and must be sent directly from this host:

```powershell
Invoke-WebRequest -Method Post -Uri http://127.0.0.1:3002/api/sync `
  -Headers @{ 'X-Local-Admin' = '1' }
```

Public, proxied, LAN, and unmarked sync requests are rejected.

The daily cron runs at **06:30 UTC** — after FRED's overnight publication window, and late enough
that the previous UTC day is closed everywhere.

Note that `npm run prod` is bash syntax (`NODE_ENV=production tsx ...`) and fails on Windows. The
control scripts set the variable properly and call `node --import tsx server/index.ts` instead.

---

## Not investment advice

Descriptive statistics on a small number of independent historical episodes.

---

## The daily view and the verdict log (2026-09-12)

The Regime tab was rebuilt to be read at a glance rather than studied. The regime verdict leads
at display size, every number carries its own motion (7/30/90-day deltas, a 30-day ghost marker
on each axis bar, sparklines), the sign convention of each axis is written at the ends of its
bar, each data source is dated on its own, and the method and evidence sit behind three closed
disclosures at the foot of the view. The other tabs are unchanged apart from solid gridlines.

**Regime rule** (`server/verdict.ts`): the signs of the 7-day means of the valuation and
leverage scores, where a sign only changes once its mean moves beyond a ±10 dead zone. Raw daily
signs flipped 71 times in the year to 2026-09-11; this rule changed 7 times. Strength is the
smaller of the two means' distances from neutral (faint < 15, moderate < 50, strong beyond).
Bump `VERDICT_RULES_VERSION` whenever the rule changes.

**Verdict log** (`verdict_log` table): what the page said, written once per as-of date by
`logVerdict()` after every sync and at server start, and never rewritten. It records the regime,
strength, run length, price, the raw and smoothed scores, the cycle readings and the projected
cycle-low zone as printed that day. `signals` cannot serve as this record because it is
recomputed on every sync. `GET /api/verdicts` joins each row to `signals.fwd_30d/90d/180d` and
summarises forward returns per regime once the windows close; the Track record disclosure on the
Regime tab shows the same. To score the calls by hand:

```sql
SELECT v.quadrant, COUNT(*) AS days, AVG(s.fwd_90d) AS avg_fwd_90d
FROM verdict_log v JOIN signals s ON s.date = v.signal_date
WHERE s.fwd_90d IS NOT NULL GROUP BY v.quadrant;
```

`GET /api/stats` now also returns `freshness`, the latest row per raw table, which drives the
per-source chips under the title. On the Evidence tab an overheat signal's top tail is judged
by the sign it is supposed to have (losses), and the Leverage tab's threshold sentence is
written from the live numbers instead of a fixed claim.

---

## Funding across venues, positioning and BitMEX history (2026-09-16)

The funding rate in `open_interest.funding_rate` is now a **weighted aggregate across every BTC
perpetual coinalyze lists** (17 exchanges), normalised to the 8-hour convention (Hyperliquid, dYdX,
Kraken, Lighter and Coinbase quote per hour and are multiplied by 8; Deribit quotes premium only).
Each venue counts at the **smaller of its open-interest share and its volume share**, so a book that
prints volume its open interest cannot support, or open interest its volume cannot support (Huobi
reports 9% of OI against 0.6% of volume), is discounted either way; books under $50M of open
interest get no weight. Volume is converted to dollars by contract type (`margined` = `COIN` reports
dollar notional, `STABLE` reports BTC). The old equal-weight eight-venue mean is kept as
`funding_simple`; the two correlate 0.96. Per-venue rows live in `funding_venues`, the taker buy
share of weighted volume in `open_interest.taker_buy`, and the OI-weighted account long share
(Binance, Bybit) in `positioning`.

**Funding enters the leverage score on a fixed ten-year scale** (`fundingLevelScore` in
`server/signals.ts`): neutral at or under 0.01% per 8 hours, +25 at 0.02, +60 at 0.04, +100 at
0.08, −50 at −0.02, linear between. It replaced an expanding percentile of the 2022+ history, which
had the wrong sign because that window never saw a real extreme. Funding *change* is not scored:
over ten years of BitMEX prints every definition of it sat within ±0.04 rank correlation of zero.

**BitMEX XBTUSD funding since 2016** (`funding_bitmex`, `server/sources/bitmex.ts`, public API,
incremental after a ~24-request backfill) is the calibration history behind that scale and gives
the Evidence tab a 2018+ funding test (`signals.funding_7d` is the weighted aggregate where it
exists and BitMEX before it). BitMEX is about 0.04% of open interest today; it is never the live
reading.

**Collected, not shown.** The per-venue rows, the taker buy share and the account long share are
ingested and kept in `signals` for research, but the dashboard displays only what it scores: the
Leverage tab shows the weighted funding reading in percent per 8 hours with its annualised
equivalent, and the Evidence tab tests `funding_7d` alongside the older inputs (an overheat signal's
top tail is judged by the sign it should have). A venue table and a positioning block were on the tab
for a few hours on 2026-09-16 and came off at Raul's request: the dashboard carries the signal, the
research note carries the analysis. Everything needed to put them back is in `/api/leverage`
(`venues`, `positioning`, `fundingHistory`).

The research behind all of this, including the ten-year funding test, the cross-venue check and the
market-share-weighted retest with bootstrap intervals, is the artifact "Funding Rate Signal Test"
(2026-09-16). The leg-based OI heat rule was re-examined rather than changed; see the same note.

**The heat rule test, in short:** a stand-alone port replicates `oi_heat_leg` exactly. At the live 10%
swing threshold its rank correlation with 90-day returns is −0.12 with an interval spanning zero and
opposite signs in the two halves of the sample; at 15% it is −0.38 (90% interval −0.57 to −0.15) with
both halves negative, and at 20% −0.49. The 2× trigger has fired on seven days since mid-2024 at 15%
and those were followed by gains, so the information is in the continuous ratio, not the danger line.
Applied later on 2026-09-16 at Raul's request: `CONFIG.oiLegThreshold` is 0.15. The rules version stays
"2026-09-16" because no verdict had been logged under it between the funding change and this one.

**Provider fallbacks no longer overwrite keyed history (2026-09-16).** The first sync after the
venue-weighted ingest hit a coinalyze rate limit (the ingest makes about ten calls instead of three),
fell through to OKX, and OKX's single book replaced 180 days of the aggregate before the signals were
recomputed. Three guards followed: `withRetry` waits for `Retry-After` or at least 20 s on a 429
instead of retrying inside three seconds; `ingestOpenInterest` skips the keyless providers once
coinalyze has ever populated the table, so a failed keyed sync leaves yesterday's history in place and
logs the error; and the CoinGecko snapshot is refused above 1.5M BTC (it returned 2.98M, which is
double counting). The 180 rows were repaired by re-running the sync. The ingest also paces itself by
coinalyze's actual rule (40 calls a minute, each symbol in a history request counting as one) and fetches
funding, volume and positioning only for markets that have ever carried $20M of open interest, so a daily
sync spends about two minutes on coinalyze and never depends on a retry.
