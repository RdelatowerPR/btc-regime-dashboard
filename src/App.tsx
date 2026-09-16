import { useEffect, useState } from "react";
import {
  fetchRegime,
  fetchCycle,
  fetchLeverage,
  fetchTermStructure,
  fetchMacro,
  fetchBacktest,
  fetchStats,
  fetchVerdicts,
  type RegimeResponse,
  type SignalRow,
  type LeverageResponse,
  type TermStructureResponse,
  type BacktestResponse,
  type StatsResponse,
  type VerdictsResponse,
} from "./services/api";
import { Badge } from "./components/ui";
import { C, FONT } from "./theme";
import { RegimeRouter } from "./components/RegimeRouter";
import { CyclePanel } from "./components/CyclePanel";
import { LeveragePanel } from "./components/LeveragePanel";
import { TermStructurePanel } from "./components/TermStructurePanel";
import { MacroPanel } from "./components/MacroPanel";
import { BacktestPanel } from "./components/BacktestPanel";

const TABS = [
  { key: "regime", label: "Overview" },
  { key: "cycle", label: "Cycle & Valuation" },
  { key: "leverage", label: "Leverage" },
  { key: "term", label: "Risk Appetite" },
  { key: "macro", label: "Macro Liquidity" },
  { key: "evidence", label: "Evidence" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function App() {
  const [tab, setTab] = useState<TabKey>("regime");
  const [era, setEra] = useState("modern");

  const [regime, setRegime] = useState<RegimeResponse | null>(null);
  const [cycle, setCycle] = useState<SignalRow[]>([]);
  const [leverage, setLeverage] = useState<LeverageResponse | null>(null);
  const [term, setTerm] = useState<TermStructureResponse | null>(null);
  const [macro, setMacro] = useState<SignalRow[]>([]);
  const [backtest, setBacktest] = useState<BacktestResponse | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [verdicts, setVerdicts] = useState<VerdictsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let last = 0;
    let initial = true;
    const load = () => {
      last = Date.now();
      const firstLoad = initial;
      initial = false;
      Promise.all([
        fetchRegime(365),
        fetchCycle("2017-01-01"),
        fetchLeverage(),
        fetchTermStructure(),
        fetchMacro("2018-01-01"),
        fetchStats(),
      ])
        .then(([r, c, l, t, m, s]) => {
          setRegime(r);
          setCycle(c.series);
          setLeverage(l);
          setTerm(t);
          setMacro(m.series);
          setStats(s);
        })
        // A failed refetch (the server restarting, say) keeps the last good
        // page on screen; only the first load can show the error state.
        .catch((e) => {
          if (firstLoad) setError(e instanceof Error ? e.message : String(e));
        });
      // The verdict log is additive: if it is unavailable the page still renders.
      fetchVerdicts()
        .then(setVerdicts)
        .catch(() => setVerdicts(null));
    };
    load();
    // The page gets left open on screens. The data changes once a day after
    // the 06:30 UTC sync, so refetch hourly, and on return to the tab when the
    // last fetch is more than ten minutes old, so no manual reload is needed.
    const timer = setInterval(load, 60 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last > 10 * 60 * 1000) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    fetchBacktest(era)
      .then(setBacktest)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [era]);

  const shell: React.CSSProperties = {
    minHeight: "100vh",
    background: C.bg,
    color: C.textDim,
    fontFamily: FONT.ui,
    padding: "32px clamp(16px, 3vw, 40px) 64px",
  };

  if (error) {
    return (
      <div style={shell}>
        <h1 style={{ fontSize: 18, color: C.bad }}>Failed to load</h1>
        <pre style={{ fontFamily: FONT.mono, fontSize: 12, color: C.textDim }}>{error}</pre>
        <p style={{ fontSize: 13, color: C.textDim }}>
          Is the API running? <code>npm run server</code> (port 3002)
        </p>
      </div>
    );
  }

  const loading = !regime || !backtest;

  return (
    <div style={shell}>
      <header style={{ marginBottom: 24, maxWidth: 1500 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: C.textFaint,
            marginBottom: 8,
          }}
        >
          Markets desk
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: "clamp(24px, 4vw, 34px)",
            fontWeight: 400,
            letterSpacing: "-0.01em",
            lineHeight: 1.2,
            color: C.text,
          }}
        >
          BTC Regime Monitor
        </h1>
        <p style={{ margin: "12px 0 0", fontSize: 13, lineHeight: 1.55, color: C.textDim, maxWidth: "70ch" }}>
          A daily read on Bitcoin's market regime: whether it is cheap or expensive against its own
          history, how crowded with leverage the market is, and whether macro liquidity is helping.
          Every rule on the page is tested against what Bitcoin did next.
        </p>
        <p style={{ margin: "10px 0 0", fontFamily: FONT.mono, fontSize: 11, color: C.textFaint }}>
          {stats?.latestDate ? `Data as of ${stats.latestDate}` : "Data as of —"} · refreshed every morning ·
          not investment advice
        </p>
        <FreshnessRow stats={stats} oiSource={leverage?.coverage?.source ?? null} />
      </header>

      <nav style={{ display: "flex", gap: 6, marginBottom: 22, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              background: tab === t.key ? C.panel : "transparent",
              color: tab === t.key ? C.info : C.textFaint,
              border: `1px solid ${tab === t.key ? C.borderBright : "transparent"}`,
              borderRadius: 6,
              padding: "7px 14px",
              fontFamily: FONT.ui,
              fontSize: 12,
              letterSpacing: "0.02em",
              fontWeight: tab === t.key ? 700 : 400,
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {loading ? (
        <p style={{ fontFamily: FONT.mono, fontSize: 13, color: C.textDim }}>Loading…</p>
      ) : (
        <main style={{ display: "grid", gap: 20, maxWidth: 1500 }}>
          {tab === "regime" && regime && (
            <RegimeRouter
              data={regime}
              cycle={cycle}
              tails={backtest.tails}
              caveat={backtest.caveat}
              leverage={leverage}
              term={term}
              verdicts={verdicts}
            />
          )}
          {tab === "cycle" && (
            <CyclePanel series={cycle} tails={backtest.tails} band={regime.bottomBand} />
          )}
          {tab === "leverage" && leverage && <LeveragePanel data={leverage} />}
          {tab === "term" && term && <TermStructurePanel data={term} />}
          {tab === "macro" && <MacroPanel series={macro} buckets={backtest.buckets} />}
          {tab === "evidence" && (
            <BacktestPanel data={backtest} era={era} onEraChange={setEra} />
          )}
        </main>
      )}

      <footer
        style={{
          marginTop: 48,
          paddingTop: 16,
          borderTop: `1px solid ${C.border}`,
          fontFamily: FONT.mono,
          fontSize: 11,
          color: C.textFaint,
          lineHeight: 1.7,
          maxWidth: 1500,
        }}
      >
        Sources: Coin Metrics community API (BTC price, market cap, MVRV, supply, issuance) ·
        Yahoo Finance (Nasdaq 100, gold, dollar) · FRED (balance sheet, TGA, RRP, HY OAS, real
        rates) · DefiLlama (stablecoin float) · Pendle (sUSDe term structure) ·{" "}
        {leverage?.coverage?.source ?? "coinalyze"} (open interest, funding). Not investment advice.
      </footer>
    </div>
  );
}

/**
 * One chip per source, dated by that source's own latest row. Stale means more
 * than three days behind the page's as-of date. Added after the sUSDe curve
 * sat nine days behind a page that said "as of" the newer date (2026-09-11).
 */
function FreshnessRow({ stats, oiSource }: { stats: StatsResponse | null; oiSource: string | null }) {
  const f = stats?.freshness;
  const asOf = stats?.latestDate;
  if (!f || !asOf) return null;
  const items: [string, string, string | null | undefined][] = [
    ["on-chain", "Coin Metrics", f.btc_metrics],
    ["derivatives", oiSource ?? "open interest", f.open_interest],
    ["macro", "FRED", f.macro_series],
    ["tradfi", "Yahoo", f.tradfi_prices],
    ["stablecoins", "DefiLlama", f.stablecoin_supply],
    ["sUSDe curve", "Pendle", f.term_structure],
  ];
  const DAY = 86_400_000;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
      <span style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textFaint }}>
        Data freshness
      </span>
      {items.map(([name, src, date]) => {
        if (!date) {
          return (
            <Badge key={name} color={C.textFaint} bg={C.panelAlt}>
              {name} · none
            </Badge>
          );
        }
        const behind = Math.round((Date.parse(asOf) - Date.parse(date)) / DAY);
        const stale = behind > 3;
        return (
          <Badge key={name} color={stale ? C.warn : C.textDim} bg={stale ? undefined : C.panelAlt}>
            {name} <span style={{ fontWeight: 400, color: C.textFaint }}>{src}</span> {date.slice(5)}
            {stale ? ` · ${behind}d stale` : ""}
          </Badge>
        );
      })}
    </div>
  );
}
