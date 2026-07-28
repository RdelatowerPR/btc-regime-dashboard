// ─── COIN METRICS COMMUNITY API ─────────────────────────────────────────────
// The backbone of the cycle/valuation panel. Free, no key, daily BTC data
// back to 2010-07-18 (~5,850 observations).
//
// The community tier paywalls CapRealUSD (realized cap) — but it exposes
// CapMVRVCur, CapMrktCurUSD and SplyCur, and MVRV is *defined* as
// market cap / realized cap. So:
//
//     realized_cap   = mcap / mvrv
//     realized_price = realized_cap / supply
//
// This reconstructs the paywalled series exactly. Cross-checked against the
// ~$53,000 realized price published in Blockworks' "Bottom Signals": this
// yields $52,869 for the same date.

import { db, upsertBtcMetric, insertSyncLog } from "../db.js";
import { fetchJSON, withRetry } from "./util.js";

const BASE = "https://community-api.coinmetrics.io/v4";
const METRICS = ["PriceUSD", "CapMrktCurUSD", "CapMVRVCur", "SplyCur", "IssTotUSD"];
const START = "2010-07-01";

interface CMRow {
  time: string;
  PriceUSD?: string;
  CapMrktCurUSD?: string;
  CapMVRVCur?: string;
  SplyCur?: string;
  IssTotUSD?: string;
}

const num = (v: string | undefined): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function ingestCoinMetrics(): Promise<number> {
  console.log("=== Coin Metrics (BTC price / mcap / MVRV / supply / issuance) ===");

  // Incremental: only re-fetch from a week before our latest row. Cheap enough
  // to always refetch the tail, which repairs any revised observations.
  const latest = (db.prepare("SELECT MAX(date) AS d FROM btc_metrics").get() as { d: string | null }).d;
  let start = START;
  if (latest) {
    const d = new Date(latest);
    d.setUTCDate(d.getUTCDate() - 7);
    start = d.toISOString().slice(0, 10);
  }
  console.log(`  Fetching from ${start}${latest ? " (incremental)" : " (full history)"}...`);

  try {
    const rows: CMRow[] = [];
    let token: string | undefined;
    do {
      const url =
        `${BASE}/timeseries/asset-metrics?assets=btc&metrics=${METRICS.join(",")}` +
        `&frequency=1d&start_time=${start}&page_size=10000` +
        (token ? `&next_page_token=${token}` : "");
      const resp = await withRetry(() => fetchJSON<{ data: CMRow[]; next_page_token?: string }>(url));
      rows.push(...(resp.data ?? []));
      token = resp.next_page_token;
    } while (token);

    const insertMany = db.transaction((items: CMRow[]) => {
      for (const r of items) {
        const price = num(r.PriceUSD);
        if (price == null) continue; // price is the one non-negotiable field
        const mcap = num(r.CapMrktCurUSD);
        const mvrv = num(r.CapMVRVCur);
        const supply = num(r.SplyCur);

        // Derive the paywalled series. Guard against a zero/absent MVRV.
        const realizedCap = mcap != null && mvrv != null && mvrv > 0 ? mcap / mvrv : null;
        const realizedPrice =
          realizedCap != null && supply != null && supply > 0 ? realizedCap / supply : null;

        upsertBtcMetric.run({
          date: r.time.slice(0, 10),
          price,
          mcap,
          mvrv,
          supply,
          issuanceUsd: num(r.IssTotUSD),
          realizedCap,
          realizedPrice,
        });
      }
    });
    insertMany(rows);

    insertSyncLog.run({ source: "coinmetrics", records: rows.length, status: "ok", error: null });
    const total = (db.prepare("SELECT COUNT(*) AS c FROM btc_metrics").get() as { c: number }).c;
    console.log(`  Ingested ${rows.length} rows (${total} total in db).`);
    return rows.length;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    insertSyncLog.run({ source: "coinmetrics", records: 0, status: "error", error: msg });
    console.error(`  Error: ${msg}`);
    return 0;
  }
}
