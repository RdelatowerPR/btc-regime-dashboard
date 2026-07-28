// ─── sUSDe TERM STRUCTURE (RISK APPETITE PANEL) ─────────────────────────────
// The Pendle PT term spread from the Blockworks "Forecasting Market Regimes
// with the sUSDe Term Structure" methodology: back-month implied yield minus
// front-month. Contango = the market expects funding to persist (risk-on);
// backwardation = it expects funding to decay (risk-off).
//
// Preferred source is the existing sUSDe dashboard, which already ingests
// Pendle, computes spreads across overlapping maturities and applies the
// report's 7-day smoothing. But that service lives behind a Cloudflare Tunnel
// on a Pi and is not always up (it was returning error 1033 when this was
// written), so we fall back to computing the spread directly from Pendle.

import { db, upsertTermStructure, insertSyncLog } from "../db.js";
import { fetchJSON, withRetry, loadEnv, sleep } from "./util.js";

const PENDLE_BASE = "https://api-v2.pendle.finance/core";

// ── PREFERRED: the existing sUSDe dashboard's API ──────────────────────────

interface SusdeRow {
  date: string;
  term_spread: number;
  term_spread_7dma: number | null;
  regime: string | null;
  btc_outlook: string | null;
  num_maturities: number;
}

async function fromSusdeDashboard(baseUrl: string) {
  const rows = await fetchJSON<SusdeRow[]>(`${baseUrl}/api/term-spreads`);
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("no rows from sUSDe API");
  return rows.map((r) => ({
    date: r.date,
    termSpread: r.term_spread,
    termSpread7dma: r.term_spread_7dma,
    regime: r.regime,
    btcOutlook: r.btc_outlook,
    numMaturities: r.num_maturities,
  }));
}

// ── FALLBACK: compute from Pendle directly ─────────────────────────────────

interface PendleMarket {
  address: string;
  expiry: string;
  underlyingAsset?: { symbol: string };
}
interface PendleHist {
  timestamp: string;
  impliedApy: number;
}

async function discoverMarkets(): Promise<{ address: string; expiry: string; chainId: number }[]> {
  const out: { address: string; expiry: string; chainId: number }[] = [];
  for (const chainId of [1, 9745]) {
    try {
      const resp = await withRetry(() =>
        fetchJSON<{ results: PendleMarket[] }>(`${PENDLE_BASE}/v1/${chainId}/markets?q=sUSDe&limit=100`)
      );
      for (const m of resp.results ?? []) {
        // The q= search is fuzzy and also matches srUSDe / jrUSDe.
        if (m.underlyingAsset?.symbol !== "sUSDe") continue;
        out.push({ address: m.address, expiry: m.expiry.slice(0, 10), chainId });
      }
    } catch (err) {
      console.error(`    chain ${chainId} discovery failed: ${err instanceof Error ? err.message : err}`);
    }
    await sleep(250);
  }
  return out;
}

async function fromPendle() {
  const markets = await discoverMarkets();
  if (markets.length === 0) throw new Error("no sUSDe markets discovered on Pendle");
  console.log(`    ${markets.length} sUSDe markets discovered`);

  // date → expiry → implied APY
  const byDate = new Map<string, Map<string, number>>();
  for (const m of markets) {
    try {
      const resp = await withRetry(() =>
        fetchJSON<{ results: PendleHist[] }>(
          `${PENDLE_BASE}/v2/${m.chainId}/markets/${m.address}/historical-data?time_frame=day`
        )
      );
      let entries = resp.results ?? [];
      // Blockworks trims the first and last observations: implied yields at
      // market inception and expiry are distorted by thin liquidity.
      if (entries.length > 2) entries = entries.slice(1, -1);
      for (const e of entries) {
        const date = e.timestamp.slice(0, 10);
        if (date >= m.expiry) continue; // expired legs carry no forward signal
        if (!byDate.has(date)) byDate.set(date, new Map());
        byDate.get(date)!.set(m.expiry, e.impliedApy);
      }
    } catch (err) {
      console.error(`    ${m.address}: ${err instanceof Error ? err.message : err}`);
    }
    await sleep(200);
  }

  // Spread = longest-dated implied APY − shortest-dated, on days with 2+ legs.
  const rows = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, legs]) => {
      const expiries = [...legs.keys()].sort();
      const termSpread =
        expiries.length >= 2 ? legs.get(expiries.at(-1)!)! - legs.get(expiries[0])! : 0;
      return {
        date,
        termSpread,
        termSpread7dma: null as number | null,
        regime: null as string | null,
        btcOutlook: null as string | null,
        numMaturities: expiries.length,
      };
    });

  // 7-day trailing mean, then the report's regime thresholds.
  for (let i = 0; i < rows.length; i++) {
    const win = rows.slice(Math.max(0, i - 6), i + 1);
    rows[i].termSpread7dma = win.reduce((s, r) => s + r.termSpread, 0) / win.length;

    if (rows[i].numMaturities < 2) {
      rows[i].regime = "SINGLE_MATURITY";
      rows[i].btcOutlook = "NO_SIGNAL";
      continue;
    }
    const pct = rows[i].termSpread7dma! * 100;
    if (pct > 2) [rows[i].regime, rows[i].btcOutlook] = ["STEEP_CONTANGO", "STRONGLY_BULLISH"];
    else if (pct > 0.5) [rows[i].regime, rows[i].btcOutlook] = ["CONTANGO", "BULLISH"];
    else if (pct > -0.5) [rows[i].regime, rows[i].btcOutlook] = ["FLAT", "NEUTRAL"];
    else if (pct > -5) [rows[i].regime, rows[i].btcOutlook] = ["BACKWARDATION", "MILDLY_BEARISH"];
    else [rows[i].regime, rows[i].btcOutlook] = ["STEEP_BACKWARDATION", "BEARISH"];
  }

  return rows;
}

// ── ORCHESTRATION ──────────────────────────────────────────────────────────

export async function ingestTermStructure(): Promise<number> {
  loadEnv();
  console.log("=== sUSDe term structure (risk appetite) ===");

  const susdeUrl = process.env.SUSDE_API_URL;
  const attempts: { name: string; run: () => Promise<Awaited<ReturnType<typeof fromPendle>>> }[] = [];
  if (susdeUrl) attempts.push({ name: `susde-api`, run: () => fromSusdeDashboard(susdeUrl) });
  attempts.push({ name: "pendle-direct", run: fromPendle });

  for (const attempt of attempts) {
    try {
      console.log(`  Trying ${attempt.name}...`);
      const rows = await attempt.run();
      const insertMany = db.transaction((items: typeof rows) => {
        for (const r of items) upsertTermStructure.run({ ...r, source: attempt.name });
      });
      insertMany(rows);
      insertSyncLog.run({ source: `term:${attempt.name}`, records: rows.length, status: "ok", error: null });
      console.log(`    OK — ${rows.length} rows (${rows[0]?.date} → ${rows.at(-1)?.date})`);
      return rows.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`    ${attempt.name} failed: ${msg}`);
      insertSyncLog.run({ source: `term:${attempt.name}`, records: 0, status: "error", error: msg });
    }
  }

  console.error("  All term-structure sources failed — risk appetite panel will be empty.");
  return 0;
}
