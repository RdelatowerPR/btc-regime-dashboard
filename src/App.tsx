import { useEffect, useState } from "react";
import {
  fetchRegime,
  fetchCycle,
  fetchLeverage,
  fetchTermStructure,
  fetchMacro,
  fetchBacktest,
  fetchStats,
  type RegimeResponse,
  type SignalRow,
  type LeverageResponse,
  type TermStructureResponse,
  type BacktestResponse,
  type StatsResponse,
} from "./services/api";
import { C, FONT } from "./theme";
import { RegimeRouter } from "./components/RegimeRouter";
import { CyclePanel } from "./components/CyclePanel";
import { LeveragePanel } from "./components/LeveragePanel";
import { TermStructurePanel } from "./components/TermStructurePanel";
import { MacroPanel } from "./components/MacroPanel";
import { BacktestPanel } from "./components/BacktestPanel";

const TABS = [
  { key: "regime", label: "Regime" },
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchRegime(90),
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
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    fetchBacktest(era)
      .then(setBacktest)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [era]);

  const shell: React.CSSProperties = {
    minHeight: "100vh",
    background: C.bg,
    color: C.text,
    fontFamily: FONT.sans,
    padding: "26px clamp(14px, 3vw, 40px) 60px",
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
      <header style={{ marginBottom: 22, maxWidth: 1500 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 21, fontWeight: 600, letterSpacing: -0.2 }}>
            BTC Regime Monitor
          </h1>
          <span style={{ fontFamily: FONT.mono, fontSize: 11.5, color: C.textFaint }}>
            {stats?.latestDate ? `data through ${stats.latestDate}` : ""}
          </span>
        </div>
        <p style={{ margin: "8px 0 0", fontSize: 12.5, color: C.textDim, maxWidth: 860, lineHeight: 1.6 }}>
          Cross-source read on crypto risk appetite: on-chain valuation, derivatives leverage, the
          sUSDe term structure and macro liquidity. Every threshold is backtested, and the
          indicators that failed are labelled as failed rather than quietly dropped.
        </p>
      </header>

      <nav style={{ display: "flex", gap: 6, marginBottom: 22, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              background: tab === t.key ? C.panel : "transparent",
              color: tab === t.key ? C.text : C.textDim,
              border: `1px solid ${tab === t.key ? C.borderBright : "transparent"}`,
              borderRadius: 7,
              padding: "7px 14px",
              fontFamily: FONT.sans,
              fontSize: 12.5,
              fontWeight: tab === t.key ? 600 : 400,
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
              tails={backtest.tails}
              leverageReliable={leverage?.hasHistory ?? false}
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
          marginTop: 40,
          paddingTop: 16,
          borderTop: `1px solid ${C.border}`,
          fontFamily: FONT.mono,
          fontSize: 10.5,
          color: C.textFaint,
          lineHeight: 1.7,
          maxWidth: 1500,
        }}
      >
        Sources: Coin Metrics community API (BTC price, market cap, MVRV, supply, issuance) ·
        Yahoo Finance (Nasdaq 100, gold, dollar) · FRED (balance sheet, TGA, RRP, HY OAS, real
        rates) · DefiLlama (stablecoin float) · Pendle (sUSDe term structure) · OKX / CoinGecko
        (open interest). Not investment advice.
      </footer>
    </div>
  );
}
