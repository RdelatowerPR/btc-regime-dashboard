// ─── YAHOO FINANCE ──────────────────────────────────────────────────────────
// Daily closes for the cross-asset relative-strength ratios in the Bottom
// Signals panel. Free, keyless, and deep enough to cover BTC's whole history:
//   ^NDX      Nasdaq 100      (first trade 1985)
//   GC=F      Gold futures    (first trade 2000)
//   DX-Y.NYB  Dollar index    (first trade 1971)

import { db, upsertTradfi, insertSyncLog } from "../db.js";
import { fetchJSON, withRetry, sleep, toDate } from "./util.js";

export const SYMBOLS = [
  { symbol: "^NDX", label: "Nasdaq 100" },
  { symbol: "GC=F", label: "Gold" },
  { symbol: "DX-Y.NYB", label: "Dollar Index" },
] as const;

interface YahooChart {
  chart: {
    result: Array<{
      timestamp: number[];
      indicators: { quote: Array<{ close: (number | null)[] }> };
    }> | null;
    error: unknown;
  };
}

async function ingestSymbol(symbol: string): Promise<number> {
  // period1=0 would work but Yahoo is happier with an explicit early epoch.
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=1262304000&period2=9999999999&interval=1d`;

  const resp = await withRetry(() =>
    fetchJSON<YahooChart>(url, {
      // Yahoo 429s aggressively without a browser-ish UA.
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    })
  );

  const result = resp.chart?.result?.[0];
  if (!result) throw new Error(`no chart data for ${symbol}`);

  const closes = result.indicators.quote[0]?.close ?? [];
  const rows: { date: string; symbol: string; close: number }[] = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    const c = closes[i];
    if (c == null || !Number.isFinite(c)) continue;
    rows.push({ date: toDate(result.timestamp[i]), symbol, close: c });
  }

  const insertMany = db.transaction((items: typeof rows) => {
    for (const r of items) upsertTradfi.run(r);
  });
  insertMany(rows);

  console.log(`  ${symbol.padEnd(9)} ${rows.length} closes  (${rows[0]?.date} → ${rows.at(-1)?.date})`);
  return rows.length;
}

export async function ingestYahoo(): Promise<number> {
  console.log("=== Yahoo Finance (Nasdaq / Gold / Dollar) ===");
  let total = 0;
  for (const { symbol } of SYMBOLS) {
    try {
      total += await ingestSymbol(symbol);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ${symbol}: ${msg}`);
      insertSyncLog.run({ source: `yahoo:${symbol}`, records: 0, status: "error", error: msg });
    }
    await sleep(400);
  }
  insertSyncLog.run({ source: "yahoo", records: total, status: "ok", error: null });
  return total;
}
