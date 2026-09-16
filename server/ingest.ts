// ─── FULL SYNC ──────────────────────────────────────────────────────────────
// Run directly to seed or refresh: `npm run seed`.

import { db, insertSyncLog } from "./db.js";
import { loadEnv } from "./sources/util.js";
import { ingestCoinMetrics } from "./sources/coinmetrics.js";
import { ingestYahoo } from "./sources/yahoo.js";
import { ingestFred } from "./sources/fred.js";
import { ingestStablecoins } from "./sources/stablecoins.js";
import { ingestOpenInterest } from "./sources/openinterest.js";
import { ingestBitmexFunding } from "./sources/bitmex.js";
import { ingestTermStructure } from "./sources/termstructure.js";
import { computeSignals } from "./signals.js";
import { runBacktest } from "./backtest.js";
import { logVerdict } from "./verdict.js";

export async function fullSync() {
  loadEnv();
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║       BTC Regime Monitor — Data Sync         ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  const t0 = Date.now();

  // Coin Metrics must run first — the OI module needs prices to convert
  // USD open interest into coin terms.
  await ingestCoinMetrics();
  await ingestYahoo();
  await ingestFred();
  await ingestStablecoins();
  await ingestOpenInterest();
  await ingestBitmexFunding(); // long-history funding for calibration and the Evidence tab
  await ingestTermStructure();

  computeSignals();
  runBacktest();

  // Record what the page will say for this as-of date. Once per date, never rewritten.
  const logged = logVerdict();
  if (logged) console.log(`Verdict ${logged.date}: ${logged.inserted ? "logged" : "already logged"}`);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nSync complete in ${elapsed}s.`);

  const stats = {
    btcMetrics: (db.prepare("SELECT COUNT(*) AS c FROM btc_metrics").get() as { c: number }).c,
    tradfiPrices: (db.prepare("SELECT COUNT(*) AS c FROM tradfi_prices").get() as { c: number }).c,
    macroSeries: (db.prepare("SELECT COUNT(*) AS c FROM macro_series").get() as { c: number }).c,
    openInterest: (db.prepare("SELECT COUNT(*) AS c FROM open_interest").get() as { c: number }).c,
    stablecoins: (db.prepare("SELECT COUNT(*) AS c FROM stablecoin_supply").get() as { c: number }).c,
    termStructure: (db.prepare("SELECT COUNT(*) AS c FROM term_structure").get() as { c: number }).c,
    signals: (db.prepare("SELECT COUNT(*) AS c FROM signals").get() as { c: number }).c,
  };
  console.log("Database totals:", stats);
  insertSyncLog.run({ source: "full-sync", records: stats.signals, status: "ok", error: null });
  return stats;
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("ingest.ts") || entry.endsWith("ingest.js")) {
  fullSync()
    .then(() => {
      db.close();
      process.exit(0);
    })
    .catch((err) => {
      console.error("Fatal sync error:", err);
      db.close();
      process.exit(1);
    });
}
