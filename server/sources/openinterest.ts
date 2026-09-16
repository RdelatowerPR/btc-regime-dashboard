// ─── OPEN INTEREST, FUNDING AND POSITIONING ─────────────────────────────────
// Feeds the leverage/overheat panel (the 1000x signal).
//
// The signal needs COIN-denominated OI, because USD-denominated OI rises
// mechanically with price and so can't distinguish "more leverage" from
// "same leverage, higher price". We derive it:
//
//     oi_coins = oi_usd / btc_price
//
// which means any USD open-interest source works and we can chain providers
// by quality. Two constraints shaped this module:
//
//   1. Binance and Bybit block direct API access from this host's region
//      (HTTP 451 / CloudFront country block). Never call them directly —
//      reach their data through an aggregator instead.
//   2. Only the keyed aggregators carry real history. Without a key the
//      panel starts empty and accumulates one row per day.
//
// Provider chain, best first:
//   coinalyze  — free key, daily history to 2022-06-18, every venue it lists
//   okx        — keyless, 180 days, single venue
//   coingecko  — keyless, today only, but aggregates ALL venues incl. Binance
//
// (Velo, which is the tool the 1000x hosts actually use on air, is no longer
// free, so it is not wired up here.)
//
// FUNDING ACROSS VENUES (2026-09-16). The aggregate funding rate used to be an
// equal-weight mean of eight symbols' last daily print. Two things were wrong
// with that: Huobi's $20M coin-margined book and Bitfinex weighed the same as
// Binance's $8bn, and Hyperliquid — the third-largest book — was left out.
// Three facts about the raw data drive the replacement:
//
//   - coinalyze reports each venue's NATIVE funding interval. Hyperliquid,
//     dYdX, Kraken, Lighter and Coinbase quote per hour; the big exchanges per
//     8 hours; Deribit quotes premium only. Hourly venues are multiplied by 8.
//   - Volume units follow the contract: COIN-margined contracts report dollar
//     notional, STABLE-margined ones report BTC. Both are converted to dollars.
//   - Volume can be printed and, as Huobi shows (9% of OI against 0.6% of
//     volume), so can open interest. Each venue therefore counts at the
//     SMALLER of its OI share and its volume share, so a book that reports
//     volume its OI cannot support, or OI its volume cannot support, is
//     discounted either way. Venues under $50M of open interest get no weight.
//
// The weighted series correlates 0.96 with the old mean day to day; the old
// mean is kept in `funding_simple` for continuity. Per-venue rows go to
// `funding_venues`, and the OI-weighted account long share (the venues that
// report it: Binance, Bybit) goes to `positioning`.

import {
  db,
  upsertOpenInterest,
  upsertFundingVenue,
  upsertPositioning,
  insertSyncLog,
} from "../db.js";
import { fetchJSON, withRetry, loadEnv, toDate, sleep } from "./util.js";

type OIRow = {
  date: string;
  oiUsd: number;
  fundingRate: number | null;
  fundingSimple?: number | null;
  volumeUsd?: number | null;
  takerBuy?: number | null;
  nVenues?: number | null;
};

// ── PROVIDER: COINALYZE ────────────────────────────────────────────────────

interface CoinalyzeMarket {
  symbol: string;
  exchange: string;
  base_asset: string;
  quote_asset?: string;
  is_perpetual: boolean;
  margined?: string; // "COIN" (inverse) | "STABLE" (linear)
}
interface CoinalyzeHistory<T> {
  symbol: string;
  history: T[];
}
type OhlcvPoint = { t: number; o?: number; h?: number; l?: number; c?: number; v?: number; bv?: number };
type ClosePoint = { t: number; c: number };
type LongShortPoint = { t: number; r?: number; l?: number; s?: number };

/** Venues whose funding is quoted per hour; multiplied by 8 to the exchanges' convention. */
const HOURLY_EXCHANGE_CODES = new Set(["H", "8", "K", "T", "C"]); // Hyperliquid, dYdX, Kraken, Lighter, Coinbase
const EXCLUDED_EXCHANGE_CODES = new Set(["O"]); // Polymarket is not a perpetual market in this sense
/** Minimum open interest for a venue-day to carry weight in the aggregate. */
const MIN_VENUE_OI = 50e6;
/** Minimum open interest for a venue-day to be stored at all. */
const MIN_STORE_OI = 20e6;
/** The old equal-weight set, kept as `funding_simple` for continuity. */
const LEGACY_MAJORS = [
  "BTCUSDT.6", "BTCUSD.6", "BTCUSDT_PERP.A", "BTCUSD_PERP.A",
  "BTCUSD_PERP.3", "BTCUSDT_PERP.3", "BTCUSDT_PERP.4", "BTCUSDT_PERP.F",
];
const EXCHANGE_NAMES: Record<string, string> = {
  A: "Binance", "6": "Bybit", "3": "OKX", "4": "Huobi", F: "Bitfinex", "0": "BitMEX", "2": "Deribit",
  Y: "Gate.io", "7": "Phemex", W: "WOO X", "8": "dYdX", H: "Hyperliquid", T: "Lighter", S: "Aster",
  K: "Kraken", C: "Coinbase", O: "Polymarket", P: "Poloniex",
};

/**
 * coinalyze's rate limit: 40 calls per minute per key, where every symbol in a
 * history request counts as one call. Tracks the last minute's spend and waits
 * for the oldest entry to expire before a request that would exceed the budget.
 */
class CallBudget {
  private spent: { t: number; n: number }[] = [];
  constructor(private readonly perMinute: number) {}
  async take(n: number): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.spent = this.spent.filter((e) => now - e.t < 60_000);
      const used = this.spent.reduce((s, e) => s + e.n, 0);
      if (used + n <= this.perMinute || this.spent.length === 0) break;
      await sleep(this.spent[0].t + 60_000 - now + 1_000);
    }
    this.spent.push({ t: Date.now(), n });
  }
}

interface VenueDay {
  symbol: string;
  exchange: string;
  f8h: number | null;
  oi: number | null;
  vol: number | null;
  buy: number | null;
  longShare: number | null;
}

async function fromCoinalyze(apiKey: string): Promise<OIRow[]> {
  const BASE = "https://api.coinalyze.net/v1";
  // Coinalyze has accepted the key as both a header and a query param across
  // doc revisions — send both so we don't break on whichever they keep.
  const auth = { "api-key": apiKey, api_key: apiKey };
  const q = `api_key=${encodeURIComponent(apiKey)}`;
  // coinalyze's limit is 40 calls per minute per key, and every symbol in a history
  // request counts as one call, so a 20-symbol request spends half the budget. The
  // budget paces by symbol count; withRetry's Retry-After handling is the backstop.
  const budget = new CallBudget(36);

  const names = { ...EXCHANGE_NAMES };
  try {
    await budget.take(1);
    const ex = await withRetry(() => fetchJSON<{ code: string; name: string }[]>(`${BASE}/exchanges?${q}`, auth));
    for (const e of ex) names[e.code] = e.name;
  } catch {
    // names are cosmetic; the hard-coded map covers the venues that matter
  }

  await budget.take(1);
  const markets = await withRetry(() => fetchJSON<CoinalyzeMarket[]>(`${BASE}/future-markets?${q}`, auth));
  const perps = markets.filter(
    (m) => m.base_asset === "BTC" && m.is_perpetual && !EXCLUDED_EXCHANGE_CODES.has(m.exchange)
  );
  if (perps.length === 0) throw new Error("coinalyze returned no BTC perpetual markets");
  const meta = new Map(perps.map((m) => [m.symbol, m]));
  const symbols = perps.map((m) => m.symbol);
  console.log(`    ${symbols.length} BTC perpetual markets across ${new Set(perps.map((m) => m.exchange)).size} exchanges`);

  const to = Math.floor(Date.now() / 1000);
  const from = to - 5 * 365 * 86400;
  const hist = <T>(endpoint: string, chunk: string[], extra = "") =>
    withRetry(() =>
      fetchJSON<CoinalyzeHistory<T>[]>(
        `${BASE}/${endpoint}?${q}&symbols=${encodeURIComponent(chunk.join(","))}&interval=daily&from=${from}&to=${to}${extra}`,
        auth
      )
    );
  const byDate = new Map<string, Map<string, VenueDay>>();
  const cell = (date: string, symbol: string): VenueDay => {
    let day = byDate.get(date);
    if (!day) {
      day = new Map();
      byDate.set(date, day);
    }
    let v = day.get(symbol);
    if (!v) {
      const code = meta.get(symbol)?.exchange ?? "";
      v = { symbol, exchange: names[code] ?? code, f8h: null, oi: null, vol: null, buy: null, longShare: null };
      day.set(symbol, v);
    }
    return v;
  };

  // Open interest first, for every market: it decides which markets are worth the
  // other three series. A market that never carried $20M of open interest is never
  // stored or weighted, so its funding, volume and long/short history is not fetched.
  const CHUNK = 20; // the API's maximum per request
  const chunks = (list: string[]) =>
    Array.from({ length: Math.ceil(list.length / CHUNK) }, (_, i) => list.slice(i * CHUNK, (i + 1) * CHUNK));
  const peakOi = new Map<string, number>();
  for (const chunk of chunks(symbols)) {
    await budget.take(chunk.length);
    const oi = await hist<ClosePoint>("open-interest-history", chunk, "&convert_to_usd=true");
    for (const s of oi) {
      for (const p of s.history ?? []) {
        if (p.c == null) continue;
        cell(toDate(p.t), s.symbol).oi = p.c;
        if (p.c > (peakOi.get(s.symbol) ?? 0)) peakOi.set(s.symbol, p.c);
      }
    }
  }
  const active = symbols.filter((s) => (peakOi.get(s) ?? 0) >= MIN_STORE_OI);
  console.log(
    `    ${active.length} of ${symbols.length} markets have carried $${MIN_STORE_OI / 1e6}M of open interest; ` +
      `fetching funding, volume and positioning for those`
  );

  for (const chunk of chunks(active)) {
    await budget.take(chunk.length);
    const funding = await hist<ClosePoint>("funding-rate-history", chunk);
    for (const s of funding) {
      const k = HOURLY_EXCHANGE_CODES.has(meta.get(s.symbol)?.exchange ?? "") ? 8 : 1;
      for (const p of s.history ?? []) if (p.c != null) cell(toDate(p.t), s.symbol).f8h = p.c * k;
    }

    await budget.take(chunk.length);
    const ohlcv = await hist<OhlcvPoint>("ohlcv-history", chunk);
    for (const s of ohlcv) {
      const inverse = meta.get(s.symbol)?.margined === "COIN";
      for (const p of s.history ?? []) {
        if (p.v == null || p.c == null) continue;
        const mult = inverse ? 1 : p.c; // COIN contracts report dollar notional, STABLE ones BTC
        const v = cell(toDate(p.t), s.symbol);
        v.vol = p.v * mult;
        if (p.bv != null) v.buy = p.bv * mult;
      }
    }

    try {
      await budget.take(chunk.length);
      const ls = await hist<LongShortPoint>("long-short-ratio-history", chunk);
      for (const s of ls) for (const p of s.history ?? []) if (p.l != null) cell(toDate(p.t), s.symbol).longShare = p.l;
    } catch (err) {
      console.error(`    long/short fetch failed (positioning labels only): ${err instanceof Error ? err.message : err}`);
    }
  }

  // ── daily aggregates ──
  const rows: OIRow[] = [];
  const venueRows: Record<string, unknown>[] = [];
  const positioningRows: Record<string, unknown>[] = [];
  for (const [date, day] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const venues = [...day.values()];
    const withOi = venues.filter((v) => v.oi != null && v.oi > 0);
    if (withOi.length === 0) continue;
    const totalOi = withOi.reduce((s, v) => s + (v.oi as number), 0);

    const eligible = withOi.filter((v) => (v.oi as number) >= MIN_VENUE_OI && v.f8h != null);
    const eligibleOi = eligible.reduce((s, v) => s + (v.oi as number), 0);
    const withVol = eligible.filter((v) => v.vol != null && v.vol > 0);
    const eligibleVol = withVol.reduce((s, v) => s + (v.vol as number), 0);
    const weights = new Map<string, number>();
    for (const v of eligible) {
      const oiShare = (v.oi as number) / eligibleOi;
      const volShare = eligibleVol > 0 && v.vol ? v.vol / eligibleVol : 0;
      // No volume data at all that day: fall back to open-interest shares.
      weights.set(v.symbol, eligibleVol > 0 ? Math.min(oiShare, volShare) : oiShare);
    }
    const wSum = [...weights.values()].reduce((a, b) => a + b, 0);
    const fundingRate =
      wSum > 0
        ? eligible.reduce((s, v) => s + (v.f8h as number) * (weights.get(v.symbol) as number), 0) / wSum
        : null;
    const legacy = LEGACY_MAJORS.map((s) => day.get(s)?.f8h).filter((x): x is number => x != null);
    const fundingSimple = legacy.length ? legacy.reduce((a, b) => a + b, 0) / legacy.length : null;
    const withBuy = withVol.filter((v) => v.buy != null);
    const buyVol = withBuy.reduce((s, v) => s + (v.vol as number), 0);
    const takerBuy = buyVol > 0 ? withBuy.reduce((s, v) => s + (v.buy as number), 0) / buyVol : null;

    rows.push({
      date,
      oiUsd: totalOi,
      fundingRate,
      fundingSimple,
      volumeUsd: eligibleVol > 0 ? eligibleVol : null,
      takerBuy,
      nVenues: eligible.length,
    });

    for (const v of withOi) {
      if ((v.oi as number) < MIN_STORE_OI) continue;
      const w = weights.get(v.symbol) ?? 0;
      venueRows.push({
        date,
        symbol: v.symbol,
        exchange: v.exchange,
        funding8h: v.f8h,
        oiUsd: v.oi,
        volumeUsd: v.vol,
        buyVolumeUsd: v.buy,
        oiShare: eligibleOi > 0 ? (v.oi as number) / eligibleOi : null,
        volShare: eligibleVol > 0 && v.vol ? v.vol / eligibleVol : null,
        weight: wSum > 0 ? w / wSum : null,
      });
    }

    const reporting = withOi.filter((v) => v.longShare != null && (v.oi as number) >= MIN_VENUE_OI);
    if (reporting.length) {
      const oiR = reporting.reduce((s, v) => s + (v.oi as number), 0);
      positioningRows.push({
        date,
        longShare: reporting.reduce((s, v) => s + (v.longShare as number) * (v.oi as number), 0) / oiR,
        nVenues: reporting.length,
      });
    }
  }

  db.transaction(() => {
    for (const r of venueRows) upsertFundingVenue.run(r);
    for (const r of positioningRows) upsertPositioning.run(r);
  })();
  const last = rows.at(-1);
  console.log(
    `    funding: ${rows.filter((r) => r.fundingRate != null).length} days weighted across venues, ` +
      `${venueRows.length} venue-day rows, ${positioningRows.length} positioning days` +
      (last
        ? `; latest ${last.date}: weighted ${last.fundingRate?.toFixed(4)} vs old mean ${last.fundingSimple?.toFixed(4)}, ${last.nVenues} venues`
        : "")
  );
  return rows;
}

// ── PROVIDER: OKX (keyless, 180 days, single venue) ────────────────────────

async function fromOkx(): Promise<OIRow[]> {
  const resp = await withRetry(() =>
    fetchJSON<{ data: [string, string, string][] }>(
      "https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-volume?ccy=BTC&period=1D"
    )
  );
  return (resp.data ?? [])
    .map(([ts, oi]) => ({ date: toDate(Number(ts)), oiUsd: Number(oi), fundingRate: null }))
    .filter((r) => Number.isFinite(r.oiUsd))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── PROVIDER: COINGECKO (keyless, today only, ALL venues) ──────────────────

async function fromCoinGecko(): Promise<OIRow[]> {
  const key = process.env.COINGECKO_API_KEY;
  const base = key ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
  const headers: Record<string, string> = key ? { "x-cg-pro-api-key": key } : {};

  // open_interest_btc is already coin-denominated and spans every venue the
  // aggregator tracks, including the ones blocked from this region.
  const exchanges = await withRetry(() =>
    fetchJSON<{ open_interest_btc: number | null }[]>(
      `${base}/derivatives/exchanges?order=open_interest_btc_desc&per_page=100`,
      headers
    )
  );
  const oiCoins = exchanges.reduce((sum, e) => sum + (e.open_interest_btc ?? 0), 0);
  if (oiCoins <= 0) throw new Error("coingecko returned zero aggregate open interest");
  // BTC open interest has never exceeded ~0.8M coins across every venue. This sum
  // came back near 3M on 2026-09-16, which is double counting, not leverage.
  if (oiCoins > 1.5e6) throw new Error(`coingecko aggregate of ${Math.round(oiCoins)} BTC is implausible; refusing to write it`);

  const price = (
    db.prepare("SELECT price FROM btc_metrics ORDER BY date DESC LIMIT 1").get() as
      | { price: number }
      | undefined
  )?.price;
  if (!price) throw new Error("no BTC price in db — run Coin Metrics ingestion first");

  return [{ date: new Date().toISOString().slice(0, 10), oiUsd: oiCoins * price, fundingRate: null }];
}

// ── ORCHESTRATION ──────────────────────────────────────────────────────────

export async function ingestOpenInterest(): Promise<number> {
  loadEnv();
  console.log("=== Open interest (leverage panel) ===");

  const coinalyze = process.env.COINALYZE_API_KEY;

  const providers: { name: string; run: () => Promise<OIRow[]> }[] = [];
  if (coinalyze) providers.push({ name: "coinalyze", run: () => fromCoinalyze(coinalyze) });
  providers.push({ name: "okx", run: fromOkx });
  providers.push({ name: "coingecko", run: fromCoinGecko });

  if (!coinalyze) {
    console.log(
      "  NOTE: no COINALYZE_API_KEY set — falling back to a 180-day OKX window\n" +
        "        plus daily CoinGecko snapshots. The overheat percentiles need\n" +
        "        ~1 year of history to be meaningful. A Coinalyze key is free."
    );
  }

  // Prices, for the USD → coin conversion.
  const priceRows = db.prepare("SELECT date, price FROM btc_metrics").all() as {
    date: string;
    price: number;
  }[];
  const priceByDate = new Map(priceRows.map((r) => [r.date, r.price]));
  const latestPrice = priceRows.at(-1)?.price;

  // The keyless providers exist for an install without a key. Once a keyed provider
  // has populated the table they must not write: OKX is one venue and CoinGecko one
  // snapshot, and either overwrites the aggregate history with partial data. On
  // 2026-09-16 a rate-limited coinalyze call let OKX replace 180 days of open
  // interest with its own book (about a twentieth of the total), and the signals
  // were recomputed from that. A failed keyed sync now leaves the history as it is.
  const keyedRows = (
    db.prepare("SELECT COUNT(*) AS c FROM open_interest WHERE source = 'coinalyze'").get() as { c: number }
  ).c;

  let written = 0;
  for (const provider of providers) {
    if (provider.name !== "coinalyze" && keyedRows > 0) {
      console.log(`  Skipping ${provider.name}: ${keyedRows} days of keyed history in db; a failed keyed sync leaves them as they are.`);
      continue;
    }
    try {
      console.log(`  Trying ${provider.name}...`);
      const rows = await provider.run();
      if (rows.length === 0) throw new Error("no rows returned");

      const insertMany = db.transaction((items: OIRow[]) => {
        for (const r of items) {
          const price = priceByDate.get(r.date) ?? latestPrice;
          if (!price) continue;
          upsertOpenInterest.run({
            date: r.date,
            oiUsd: r.oiUsd,
            oiCoins: r.oiUsd / price,
            fundingRate: r.fundingRate,
            source: provider.name,
            fundingSimple: r.fundingSimple ?? null,
            volumeUsd: r.volumeUsd ?? null,
            takerBuy: r.takerBuy ?? null,
            nVenues: r.nVenues ?? null,
          });
        }
      });
      insertMany(rows);

      written = rows.length;
      console.log(`    OK — ${rows.length} rows from ${provider.name} (${rows[0].date} → ${rows.at(-1)!.date})`);
      insertSyncLog.run({ source: `oi:${provider.name}`, records: rows.length, status: "ok", error: null });

      // A keyed provider gives full history; stop. The keyless ones are
      // partial, so keep going to layer OKX's window under today's snapshot.
      if (provider.name === "coinalyze") break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`    ${provider.name} failed: ${msg}`);
      insertSyncLog.run({ source: `oi:${provider.name}`, records: 0, status: "error", error: msg });
    }
  }

  const total = (db.prepare("SELECT COUNT(*) AS c FROM open_interest").get() as { c: number }).c;
  console.log(`  Open interest rows in db: ${total}`);
  return written;
}
