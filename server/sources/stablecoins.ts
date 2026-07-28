// ─── DEFILLAMA STABLECOINS ──────────────────────────────────────────────────
// Aggregate stablecoin float is the crypto-native half of the liquidity panel:
// the dry powder sitting on exchanges and in DeFi. Its 30-day rate of change
// leads risk appetite more reliably than its level.
//
// Only USD-pegged supply is counted — the EUR/JPY/etc. pegs are rounding error
// and add noise from FX moves.

import { db, upsertStablecoin, insertSyncLog } from "../db.js";
import { fetchJSON, withRetry, toDate } from "./util.js";

interface LlamaPoint {
  date: string;
  totalCirculatingUSD?: Record<string, number>;
}

export async function ingestStablecoins(): Promise<number> {
  console.log("=== DefiLlama (aggregate stablecoin float) ===");
  try {
    const data = await withRetry(() =>
      fetchJSON<LlamaPoint[]>("https://stablecoins.llama.fi/stablecoincharts/all")
    );

    const rows: { date: string; totalUsd: number }[] = [];
    for (const pt of data) {
      const usd = pt.totalCirculatingUSD?.peggedUSD;
      if (usd == null || !Number.isFinite(usd) || usd <= 0) continue;
      rows.push({ date: toDate(Number(pt.date)), totalUsd: usd });
    }

    const insertMany = db.transaction((items: typeof rows) => {
      for (const r of items) upsertStablecoin.run(r);
    });
    insertMany(rows);

    insertSyncLog.run({ source: "defillama", records: rows.length, status: "ok", error: null });
    const last = rows.at(-1);
    console.log(
      `  ${rows.length} days (${rows[0]?.date} → ${last?.date}), latest $${((last?.totalUsd ?? 0) / 1e9).toFixed(1)}B`
    );
    return rows.length;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    insertSyncLog.run({ source: "defillama", records: 0, status: "error", error: msg });
    console.error(`  Error: ${msg}`);
    return 0;
  }
}
