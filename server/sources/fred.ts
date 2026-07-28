// ─── FRED (ST. LOUIS FED) ───────────────────────────────────────────────────
// Macro liquidity panel, implementing the Capital Flows framework:
// "price of money" (real rates, credit spreads, dollar) and "quantity of
// money" (central bank balance sheet net of the Treasury account and RRP).
//
// Uses the fredgraph.csv endpoint, which needs NO API key. Note: requesting
// multiple ids in one call returns a ZIP archive, so each series is fetched
// individually as plain CSV.

import { db, upsertMacro, insertSyncLog } from "../db.js";
import { fetchText, withRetry, sleep } from "./util.js";

export const SERIES = [
  { id: "WALCL", label: "Fed balance sheet", freq: "weekly" },
  { id: "WTREGEN", label: "Treasury General Account", freq: "weekly" },
  { id: "RRPONTSYD", label: "Overnight reverse repo", freq: "daily" },
  { id: "BAMLH0A0HYM2", label: "High-yield OAS", freq: "daily" },
  { id: "DTWEXBGS", label: "Broad dollar index", freq: "daily" },
  { id: "DFII10", label: "10y real yield (TIPS)", freq: "daily" },
  { id: "NFCI", label: "Chicago Fed financial conditions", freq: "weekly" },
] as const;

const START = "2010-01-01";

async function ingestSeries(id: string): Promise<number> {
  const csv = await withRetry(() =>
    fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${START}`)
  );

  const lines = csv.trim().split("\n");
  if (lines.length < 2) throw new Error(`empty CSV for ${id}`);

  const rows: { date: string; seriesId: string; value: number }[] = [];
  for (const line of lines.slice(1)) {
    const [date, raw] = line.split(",");
    // FRED writes "." for missing observations (holidays, unreported weeks).
    if (!date || !raw || raw.trim() === "." || raw.trim() === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    rows.push({ date: date.trim(), seriesId: id, value });
  }

  const insertMany = db.transaction((items: typeof rows) => {
    for (const r of items) upsertMacro.run(r);
  });
  insertMany(rows);

  console.log(`  ${id.padEnd(13)} ${String(rows.length).padStart(5)} obs  (${rows[0]?.date} → ${rows.at(-1)?.date})`);
  return rows.length;
}

export async function ingestFred(): Promise<number> {
  console.log("=== FRED (macro liquidity) ===");
  let total = 0;
  for (const { id } of SERIES) {
    try {
      total += await ingestSeries(id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ${id}: ${msg}`);
      insertSyncLog.run({ source: `fred:${id}`, records: 0, status: "error", error: msg });
    }
    await sleep(300);
  }
  insertSyncLog.run({ source: "fred", records: total, status: "ok", error: null });
  return total;
}
