// ─── BITMEX FUNDING (long-history calibration series) ───────────────────────
// XBTUSD 8-hour funding prints since 2016-05, public and keyless. BitMEX WAS
// the BTC perpetual market until 2020 and is a sliver of it now (about 0.04%
// of open interest in 2026), so this series is for HISTORY: the fixed funding
// scale in signals.ts was calibrated on it, and the Evidence tab uses it to
// test funding from 2018 instead of 2022. It is never the live reading; that
// is the venue-weighted aggregate from coinalyze in open_interest.
//
// Units: the API returns a fraction (0.0001 = 0.01% per 8h); stored as the
// daily mean of the day's prints in PERCENT per 8h to match coinalyze.
// Incremental: only the last stored day onward is fetched, so the daily sync
// costs one request after the initial ~24-request backfill.

import { db, upsertFundingBitmex, insertSyncLog } from "../db.js";
import { fetchJSON, withRetry, sleep } from "./util.js";

interface BitmexFundingPrint {
  timestamp: string;
  symbol: string;
  fundingRate: number;
}

export async function ingestBitmexFunding(): Promise<number> {
  console.log("=== BitMEX funding (calibration history) ===");
  const last = (db.prepare("SELECT MAX(date) AS d FROM funding_bitmex").get() as { d: string | null }).d;
  let start = last ? `${last}T00:00:00.000Z` : "2016-05-01T00:00:00.000Z";

  const byDay = new Map<string, number[]>();
  const seen = new Set<string>();
  let requests = 0;
  try {
    for (let i = 0; i < 60; i++) {
      const url =
        `https://www.bitmex.com/api/v1/funding?symbol=XBTUSD&count=500&reverse=false` +
        `&startTime=${encodeURIComponent(start)}`;
      const batch = await withRetry(() => fetchJSON<BitmexFundingPrint[]>(url));
      requests++;
      let added = 0;
      for (const p of batch) {
        if (seen.has(p.timestamp) || typeof p.fundingRate !== "number") continue;
        seen.add(p.timestamp);
        const d = p.timestamp.slice(0, 10);
        const arr = byDay.get(d) ?? [];
        arr.push(p.fundingRate * 100);
        byDay.set(d, arr);
        added++;
      }
      if (batch.length < 500 || added === 0) break;
      start = batch[batch.length - 1].timestamp;
      await sleep(2200); // the unauthenticated limit is about 30 requests a minute
    }

    const write = db.transaction((days: [string, number[]][]) => {
      for (const [date, prints] of days) {
        upsertFundingBitmex.run({
          date,
          funding8h: prints.reduce((a, b) => a + b, 0) / prints.length,
          prints: prints.length,
        });
      }
    });
    const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    write(days);

    const total = (db.prepare("SELECT COUNT(*) AS c, MIN(date) AS first FROM funding_bitmex").get() as { c: number; first: string | null });
    console.log(`  ${days.length} days written from ${requests} request(s); table holds ${total.c} days from ${total.first}`);
    insertSyncLog.run({ source: "funding:bitmex", records: days.length, status: "ok", error: null });
    return days.length;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  BitMEX funding failed (calibration history only; the live gauge is unaffected): ${msg}`);
    insertSyncLog.run({ source: "funding:bitmex", records: 0, status: "error", error: msg });
    return 0;
  }
}
