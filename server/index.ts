// ─── EXPRESS API SERVER ─────────────────────────────────────────────────────
// Serves the dashboard's data and, in production, the built frontend.
// Port 3002 — 3001 belongs to the sUSDe term-structure dashboard.

import express from "express";
import cron from "node-cron";
import { existsSync } from "fs";
import { resolve } from "path";
import { db } from "./db.js";
import { fullSync } from "./ingest.js";
import { computeBottomBand, CONFIG, CYCLE_LOWS, OI_HEAT_SPEC } from "./signals.js";
import { ERAS } from "./backtest.js";
import { loadEnv } from "./sources/util.js";
import {
  PUBLIC_CACHE_CONTROL,
  installPublicSecurity,
  isTrustedLocalAdminRequest,
} from "./security.js";

loadEnv();

const app = express();
// Deliberately NOT `PORT`: when the frontend dev server is launched by a
// supervisor that assigns a port, it exports PORT for Vite, and the API would
// otherwise try to bind the same one. Vite proxies /api here (see vite.config).
const PORT = Number(process.env.API_PORT ?? 3002);
const PUBLIC_ORIGIN = "https://btc.raulantonio.xyz";

installPublicSecurity(app, PUBLIC_ORIGIN);
app.use(express.json());

// ── HELPERS ────────────────────────────────────────────────────────────────

const q = <T,>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...params) as T[];
const q1 = <T,>(sql: string, ...params: unknown[]) => db.prepare(sql).get(...params) as T | undefined;

/** Wrap a handler so a thrown error becomes a 500 with a JSON body. */
const route =
  (fn: (req: express.Request, res: express.Response) => void) =>
  (req: express.Request, res: express.Response) => {
    try {
      fn(req, res);
    } catch (err) {
      console.error(`${req.method} ${req.path}:`, err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  };

const SIGNAL_COLUMNS = `
  date, price, realized_price, realized_ratio, mvrv, mvrv_z, mvrv_pct,
  ndx_btc_rsi, gold_btc_rsi, mayer, puell, drawdown, weeks_from_ath,
  oi_heat_leg, oi_leg_start, oi_leg_price_chg, oi_leg_oi_chg,
  oi_heat_7d, oi_heat_14d, oi_heat_30d, oi_heat_pct, oi_mcap_ratio, funding_rate,
  term_spread_7dma, term_regime,
  net_liquidity, net_liquidity_90d, hy_oas, dxy, real_10y, stablecoin_30d,
  valuation_score, leverage_score, macro_score, composite,
  fwd_30d, fwd_90d, fwd_180d
`;

// ── PANEL 0: REGIME ROUTER ─────────────────────────────────────────────────

app.get(
  "/api/regime",
  route((req, res) => {
    const trailDays = Number(req.query.trail ?? 90);

    const latest = q1<Record<string, number | string | null>>(
      `SELECT ${SIGNAL_COLUMNS} FROM signals ORDER BY date DESC LIMIT 1`
    );
    if (!latest) return res.json({ latest: null, trail: [], bottomBand: null });

    // The quadrant trail: valuation on x, leverage on y, most recent last.
    const trail = q<{ date: string; valuation_score: number; leverage_score: number; price: number }>(
      `SELECT date, valuation_score, leverage_score, price
       FROM signals
       WHERE valuation_score IS NOT NULL
       ORDER BY date DESC LIMIT ?`,
      trailDays
    ).reverse();

    const realizedPrice = Number(latest.realized_price ?? 0);
    const bottomBand = realizedPrice > 0 ? computeBottomBand(realizedPrice) : null;

    res.json({ latest, trail, bottomBand, cycleLows: CYCLE_LOWS });
  })
);

// ── PANEL 1: CYCLE & VALUATION ─────────────────────────────────────────────

app.get(
  "/api/cycle",
  route((req, res) => {
    const from = String(req.query.from ?? "2017-01-01");
    const series = q(
      `SELECT date, price, realized_price, realized_ratio, mvrv, mvrv_z, mvrv_pct,
              ndx_btc_rsi, gold_btc_rsi, mayer, puell, drawdown, weeks_from_ath
       FROM signals WHERE date >= ? ORDER BY date`,
      from
    );
    res.json({ series });
  })
);

// ── PANEL 2: LEVERAGE & OVERHEAT ───────────────────────────────────────────

app.get(
  "/api/leverage",
  route((_req, res) => {
    const series = q(
      `SELECT s.date, s.price, s.oi_heat_leg, s.oi_leg_start, s.oi_leg_price_chg, s.oi_leg_oi_chg,
              s.oi_heat_7d, s.oi_heat_14d, s.oi_heat_30d,
              s.oi_heat_pct, s.oi_mcap_ratio, s.funding_rate, s.leverage_score,
              o.oi_usd, o.oi_coins, o.source
       FROM signals s JOIN open_interest o ON o.date = s.date
       ORDER BY s.date`
    );
    const coverage = q1<{ n: number; first: string; last: string; source: string }>(
      `SELECT COUNT(*) AS n, MIN(date) AS first, MAX(date) AS last,
              (SELECT source FROM open_interest ORDER BY date DESC LIMIT 1) AS source
       FROM open_interest`
    );
    // Test the podcast's own stated thresholds directly, rather than only
    // ranking percentiles. The horizon matters: this is a tactical signal
    // ("maybe lighten up"), and it shows up at 30 days and washes out by 90.
    const thresholds = [1, 2, 3].map((t) => {
      const rows = q<{ f30: number | null; f90: number | null }>(
        `SELECT fwd_30d AS f30, fwd_90d AS f90 FROM signals
         WHERE oi_heat_leg IS NOT NULL AND date >= '2018-01-01' AND oi_heat_leg >= ?`,
        t
      );
      const below = q<{ f30: number | null; f90: number | null }>(
        `SELECT fwd_30d AS f30, fwd_90d AS f90 FROM signals
         WHERE oi_heat_leg IS NOT NULL AND date >= '2018-01-01' AND oi_heat_leg < ?`,
        t
      );
      const med = (arr: (number | null)[]) => {
        const s = arr.filter((v): v is number => v != null).sort((a, b) => a - b);
        return s.length ? s[s.length >> 1] : null;
      };
      return {
        threshold: t,
        n: rows.length,
        aboveMed30d: med(rows.map((r) => r.f30)),
        aboveMed90d: med(rows.map((r) => r.f90)),
        belowMed30d: med(below.map((r) => r.f30)),
        belowMed90d: med(below.map((r) => r.f90)),
      };
    });

    // The UI needs to know when the panel is under-powered rather than silent.
    res.json({
      series,
      coverage,
      spec: OI_HEAT_SPEC,
      thresholds,
      hasHistory: (coverage?.n ?? 0) >= 365,
      note:
        (coverage?.n ?? 0) >= 365
          ? null
          : "Open-interest history is too short for reliable percentiles. Set COINALYZE_API_KEY (free) for multi-year history.",
    });
  })
);

// ── PANEL 3: RISK APPETITE (sUSDe TERM STRUCTURE) ──────────────────────────

app.get(
  "/api/term-structure",
  route((_req, res) => {
    const series = q(
      `SELECT t.date, t.term_spread, t.term_spread_7dma, t.regime, t.btc_outlook,
              t.num_maturities, t.source, s.price
       FROM term_structure t LEFT JOIN signals s ON s.date = t.date
       ORDER BY t.date`
    );
    const regimeStats = q(
      `SELECT bucket AS regime, n, med_fwd_90d, avg_fwd_90d, hit_rate_90d
       FROM backtest_results WHERE signal='term_regime' AND era='modern'
       ORDER BY bucket_ord`
    );
    res.json({ series, regimeStats });
  })
);

// ── PANEL 4: MACRO LIQUIDITY ───────────────────────────────────────────────

app.get(
  "/api/macro",
  route((req, res) => {
    const from = String(req.query.from ?? "2018-01-01");
    const series = q(
      `SELECT date, price, net_liquidity, net_liquidity_90d, hy_oas, dxy, real_10y,
              stablecoin_30d, macro_score
       FROM signals WHERE date >= ? ORDER BY date`,
      from
    );
    res.json({ series });
  })
);

// ── BACKTEST ───────────────────────────────────────────────────────────────

app.get(
  "/api/backtest",
  route((req, res) => {
    const era = String(req.query.era ?? "modern");
    const buckets = q(
      `SELECT signal, bucket, bucket_ord, n, range_lo, range_hi,
              avg_fwd_30d, avg_fwd_90d, avg_fwd_180d,
              med_fwd_30d, med_fwd_90d, med_fwd_180d, hit_rate_90d
       FROM backtest_results WHERE era = ? ORDER BY signal, bucket_ord`,
      era
    );
    const tails = q(
      `SELECT signal, tail, pctile, n, threshold,
              med_fwd_30d, med_fwd_90d, med_fwd_180d, hit_rate_90d, hit_rate_180d
       FROM tail_results WHERE era = ? ORDER BY signal, pctile DESC`,
      era
    );
    res.json({
      era,
      eras: ERAS,
      buckets,
      tails,
      caveat:
        "Forward windows overlap, so n counts calendar days rather than independent trials. " +
        "A 90-day bucket with n=300 represents roughly 3 independent episodes. Descriptive, not significant.",
    });
  })
);

// ── META ───────────────────────────────────────────────────────────────────

app.get(
  "/api/stats",
  route((_req, res) => {
    const counts = Object.fromEntries(
      [
        "btc_metrics",
        "tradfi_prices",
        "macro_series",
        "open_interest",
        "stablecoin_supply",
        "term_structure",
        "signals",
      ].map((t) => [t, (q1<{ c: number }>(`SELECT COUNT(*) AS c FROM ${t}`)?.c ?? 0)])
    );
    res.json({
      counts,
      latestDate: q1<{ d: string }>("SELECT MAX(date) AS d FROM signals")?.d ?? null,
      config: CONFIG,
      recentSyncs: q(
        "SELECT ts, source, records, status, error FROM sync_log ORDER BY id DESC LIMIT 25"
      ),
    });
  })
);

let syncing = false;
app.post("/api/sync", async (req, res) => {
  if (!isTrustedLocalAdminRequest(req)) return res.sendStatus(404);
  if (syncing) return res.status(409).json({ error: "sync already in progress" });
  syncing = true;
  try {
    const stats = await fullSync();
    res.json({ ok: true, stats });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    syncing = false;
  }
});

// ── STATIC (PRODUCTION) ────────────────────────────────────────────────────

const distDir = resolve(import.meta.dirname ?? ".", "../dist");
if (process.env.NODE_ENV === "production" && existsSync(distDir)) {
  app.use(express.static(distDir, {
    setHeaders: (res) => res.setHeader("Cache-Control", PUBLIC_CACHE_CONTROL),
  }));
  // SPA fallback for anything that isn't an API route.
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.setHeader("Cache-Control", PUBLIC_CACHE_CONTROL);
    res.sendFile(resolve(distDir, "index.html"));
  });
}

// ── CRON ───────────────────────────────────────────────────────────────────
// 06:30 UTC daily — after FRED's overnight publication window and late enough
// that the previous UTC day is closed everywhere.
cron.schedule("30 6 * * *", async () => {
  if (syncing) return;
  syncing = true;
  console.log(`[cron] Daily sync starting at ${new Date().toISOString()}`);
  try {
    await fullSync();
  } catch (err) {
    console.error("[cron] Sync failed:", err);
  } finally {
    syncing = false;
  }
}, { timezone: "UTC" });

// Bind loopback only. Public access is served by the Cloudflare tunnel,
// which connects from this same host to localhost:3002. This removes direct
// LAN exposure; it does not claim to isolate the service from local processes.
app.listen(PORT, "127.0.0.1", () => {
  console.log(`BTC Regime Monitor API on http://localhost:${PORT}`);
  console.log(`  Daily sync scheduled for 06:30 UTC.`);
});
