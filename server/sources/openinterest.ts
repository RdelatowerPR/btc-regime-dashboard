// ─── OPEN INTEREST ──────────────────────────────────────────────────────────
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
//   coinalyze  — free key, daily history to 2022-06-18, aggregated across venues
//   okx        — keyless, 180 days, single venue
//   coingecko  — keyless, today only, but aggregates ALL venues incl. Binance
//
// (Velo, which is the tool the 1000x hosts actually use on air, is no longer
// free, so it is not wired up here.)

import { db, upsertOpenInterest, insertSyncLog } from "../db.js";
import { fetchJSON, withRetry, loadEnv, toDate, sleep } from "./util.js";

type OIRow = { date: string; oiUsd: number; fundingRate: number | null };

// ── PROVIDER: COINALYZE ────────────────────────────────────────────────────

interface CoinalyzeMarket {
  symbol: string;
  base_asset: string;
  is_perpetual: boolean;
}
interface CoinalyzeHistory {
  symbol: string;
  history: { t: number; c: number }[];
}

async function fromCoinalyze(apiKey: string): Promise<OIRow[]> {
  const BASE = "https://api.coinalyze.net/v1";
  // Coinalyze has accepted the key as both a header and a query param across
  // doc revisions — send both so we don't break on whichever they keep.
  const auth = { "api-key": apiKey, api_key: apiKey };
  const q = `api_key=${encodeURIComponent(apiKey)}`;

  const markets = await withRetry(() =>
    fetchJSON<CoinalyzeMarket[]>(`${BASE}/future-markets?${q}`, auth)
  );
  const symbols = markets
    .filter((m) => m.base_asset === "BTC" && m.is_perpetual)
    .map((m) => m.symbol);
  if (symbols.length === 0) throw new Error("coinalyze returned no BTC perpetual markets");
  console.log(`    ${symbols.length} BTC perpetual markets`);

  const to = Math.floor(Date.now() / 1000);
  const from = to - 5 * 365 * 86400;

  // The API caps symbols per request; chunk and sum by date.
  const byDate = new Map<string, number>();
  const CHUNK = 20;
  for (let i = 0; i < symbols.length; i += CHUNK) {
    const chunk = symbols.slice(i, i + CHUNK).join(",");
    const url =
      `${BASE}/open-interest-history?${q}&symbols=${encodeURIComponent(chunk)}` +
      `&interval=daily&from=${from}&to=${to}&convert_to_usd=true`;
    const resp = await withRetry(() => fetchJSON<CoinalyzeHistory[]>(url, auth));
    for (const series of resp) {
      for (const pt of series.history ?? []) {
        const d = toDate(pt.t);
        byDate.set(d, (byDate.get(d) ?? 0) + pt.c);
      }
    }
    await sleep(1600); // free tier is ~40 req/min
  }

  // Funding, from the same provider. Jonah Van Bourg on the source episode:
  // "I don't actually use funding at all anymore except to confirm direction
  // of open interest" — a funding spike alongside rising OI means aggressive
  // taker longs rather than balanced two-way flow. So it is a confirmation
  // overlay, not an independent signal.
  const funding = new Map<string, number[]>();
  try {
    // A handful of the deepest USD/USDT perps is plenty; averaging all 29
    // venues drags in thin markets with erratic prints.
    const majors = symbols.filter((s) => /^BTCUSDT?(_PERP)?\./.test(s)).slice(0, 8);
    for (let i = 0; i < majors.length; i += CHUNK) {
      const url =
        `${BASE}/funding-rate-history?${q}&symbols=${encodeURIComponent(majors.slice(i, i + CHUNK).join(","))}` +
        `&interval=daily&from=${from}&to=${to}`;
      const resp = await withRetry(() => fetchJSON<CoinalyzeHistory[]>(url, auth));
      for (const series of resp) {
        for (const pt of series.history ?? []) {
          const d = toDate(pt.t);
          const bucket = funding.get(d);
          if (bucket) bucket.push(pt.c);
          else funding.set(d, [pt.c]);
        }
      }
      await sleep(1600);
    }
    console.log(`    funding: ${funding.size} days across ${majors.length} venues`);
  } catch (err) {
    console.error(`    funding fetch failed (open interest still usable): ${err instanceof Error ? err.message : err}`);
  }

  return [...byDate.entries()]
    .map(([date, oiUsd]) => {
      const f = funding.get(date);
      return {
        date,
        oiUsd,
        fundingRate: f?.length ? f.reduce((a, b) => a + b, 0) / f.length : null,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
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
  const headers = key ? { "x-cg-pro-api-key": key } : {};

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

  let written = 0;
  for (const provider of providers) {
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
