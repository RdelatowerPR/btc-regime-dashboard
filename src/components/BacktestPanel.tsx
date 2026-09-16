// ─── BACKTEST PANEL ─────────────────────────────────────────────────────────
// The evidence behind every threshold on the dashboard, including the signals
// that failed. Showing the failures is the point.

import { useState } from "react";
import type { BacktestResponse } from "../services/api";
import { C, FONT, fmtPct, fmtNum } from "../theme";
import { Panel, Note, Badge } from "./ui";

/** Signals whose extreme TOP readings are expected to precede losses, not gains. */
const OVERHEAT = new Set(["oi_heat_leg", "oi_heat_30d", "funding_7d"]);

const LABELS: Record<string, string> = {
  mvrv_z: "MVRV Z-score",
  realized_ratio: "Spot / realized price",
  ndx_btc_rsi: "Nasdaq/BTC RSI",
  gold_btc_rsi: "Gold/BTC RSI",
  mayer: "Mayer multiple",
  puell: "Puell multiple",
  term_spread_7dma: "sUSDe term spread",
  oi_heat_30d: "OI heat (30d)",
  oi_heat_leg: "OI heat (leg)",
  funding_7d: "Funding rate, 7d (BitMEX before 2022)",
  net_liquidity_90d: "Net liquidity 90d",
  stablecoin_30d: "Stablecoin float 30d",
  composite: "Composite score",
  valuation_score: "Valuation axis",
  leverage_score: "Leverage axis",
  macro_score: "Macro axis",
};

export function BacktestPanel({
  data,
  era,
  onEraChange,
}: {
  data: BacktestResponse;
  era: string;
  onEraChange: (era: string) => void;
}) {
  const [view, setView] = useState<"tails" | "deciles">("tails");

  const signals = [...new Set(data.buckets.map((b) => b.signal))].filter((s) => s !== "term_regime");

  return (
    <Panel
      title="Evidence"
      subtitle={
        <>
          What actually followed each signal reading. Every threshold shown elsewhere on this
          dashboard traces back to this table — including the two indicators that failed and were
          demoted as a result.
        </>
      }
      right={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            value={era}
            onChange={(e) => onEraChange(e.target.value)}
            style={{
              background: C.panelAlt,
              color: C.text,
              border: `1px solid ${C.borderBright}`,
              borderRadius: 5,
              padding: "4px 8px",
              fontFamily: FONT.mono,
              fontSize: 11,
            }}
          >
            {data.eras.map((e) => (
              <option key={e.key} value={e.key}>
                {e.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => setView(view === "tails" ? "deciles" : "tails")}
            style={{
              background: C.panelAlt,
              color: C.text,
              border: `1px solid ${C.borderBright}`,
              borderRadius: 5,
              padding: "4px 10px",
              fontFamily: FONT.mono,
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {view === "tails" ? "show deciles" : "show tails"}
          </button>
        </div>
      }
    >
      <Note tone="warn">{data.caveat}</Note>

      {view === "tails" ? (
        <>
          <p style={{ fontFamily: FONT.ui, fontSize: 12, color: C.textDim, lineHeight: 1.55, margin: "0 0 14px" }}>
            Deciles are the wrong test for a claim like "the most oversold reading on record marks a
            generational low" — that lives entirely in the top or bottom few percent, which a decile
            average dilutes away. These rows ask the question the reports actually make. Overheat
            signals are expected to precede losses, so their verdict reads the sign the other way.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: FONT.mono, fontSize: 12 }}>
              <thead>
                <tr style={{ color: C.textFaint, textAlign: "right" }}>
                  <th style={{ textAlign: "left", padding: "6px 10px", fontWeight: 500 }}>Signal</th>
                  <th style={{ padding: "6px 10px", fontWeight: 500 }}>Tail</th>
                  <th style={{ padding: "6px 10px", fontWeight: 500 }}>Days</th>
                  <th style={{ padding: "6px 10px", fontWeight: 500 }}>Median 30d</th>
                  <th style={{ padding: "6px 10px", fontWeight: 500 }}>Median 90d</th>
                  <th style={{ padding: "6px 10px", fontWeight: 500 }}>Median 180d</th>
                  <th style={{ padding: "6px 10px", fontWeight: 500 }}>Hit 90d</th>
                  <th style={{ padding: "6px 10px", fontWeight: 500 }}>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {data.tails
                  .filter((t) => t.pctile === 5)
                  .sort((a, b) => (b.med_fwd_180d ?? 0) - (a.med_fwd_180d ?? 0))
                  .map((t) => {
                    // An overheat signal's TOP tail is supposed to precede losses,
                    // so "works" means negative there and positive everywhere else.
                    const wantNeg = OVERHEAT.has(t.signal) && t.tail === "top";
                    const works = wantNeg
                      ? (t.med_fwd_30d ?? 0) < 0 && (t.med_fwd_90d ?? 0) < 0
                      : (t.med_fwd_90d ?? 0) > 0 && (t.med_fwd_180d ?? 0) > 0;
                    return (
                      <tr key={`${t.signal}-${t.tail}`} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={{ padding: "7px 10px", color: C.text }}>{LABELS[t.signal] ?? t.signal}</td>
                        <td style={{ padding: "7px 10px", textAlign: "right", color: C.textDim }}>
                          {t.tail === "top" ? "top" : "bottom"} 5%
                        </td>
                        <td style={{ padding: "7px 10px", textAlign: "right", color: C.textDim }}>{t.n}</td>
                        <td style={{ padding: "7px 10px", textAlign: "right", color: pnl(t.med_fwd_30d) }}>{fmtPct(t.med_fwd_30d)}</td>
                        <td style={{ padding: "7px 10px", textAlign: "right", color: pnl(t.med_fwd_90d) }}>{fmtPct(t.med_fwd_90d)}</td>
                        <td style={{ padding: "7px 10px", textAlign: "right", color: pnl(t.med_fwd_180d) }}>{fmtPct(t.med_fwd_180d)}</td>
                        <td style={{ padding: "7px 10px", textAlign: "right", color: C.textDim }}>{fmtPct(t.hit_rate_90d, 0)}</td>
                        <td style={{ padding: "7px 10px", textAlign: "right" }}>
                          <Badge color={works ? C.good : C.bad}>{works ? "as expected" : "failed"}</Badge>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div style={{ display: "grid", gap: 18 }}>
          {signals.map((sig) => {
            const rows = data.buckets
              .filter((b) => b.signal === sig)
              .sort((a, b) => a.bucket_ord - b.bucket_ord);
            if (rows.length < 2) return null;
            const lo = rows[0].med_fwd_90d ?? 0;
            const hi = rows.at(-1)!.med_fwd_90d ?? 0;
            const max = Math.max(...rows.map((r) => Math.abs(r.med_fwd_90d ?? 0)), 0.01);
            return (
              <div key={sig}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                  <span style={{ fontFamily: FONT.ui, fontSize: 12.5, color: C.text }}>{LABELS[sig] ?? sig}</span>
                  <span style={{ fontFamily: FONT.mono, fontSize: 11, color: C.textDim }}>
                    spread {fmtNum((hi - lo) * 100, 1)}pp · n={rows.reduce((s, r) => s + r.n, 0)}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 2, height: 40, alignItems: "center" }}>
                  {rows.map((r) => {
                    const v = r.med_fwd_90d ?? 0;
                    const h = (Math.abs(v) / max) * 100;
                    return (
                      <div
                        key={r.bucket}
                        title={`${r.bucket}: range ${fmtNum(r.range_lo)}–${fmtNum(r.range_hi)}, median 90d ${fmtPct(v)}, n=${r.n}`}
                        style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "center" }}
                      >
                        <div style={{ height: "50%", display: "flex", alignItems: "flex-end" }}>
                          {v > 0 && <div style={{ width: "100%", height: `${h}%`, background: C.good, opacity: 0.8, borderRadius: "2px 2px 0 0" }} />}
                        </div>
                        <div style={{ height: "50%" }}>
                          {v < 0 && <div style={{ width: "100%", height: `${h}%`, background: C.bad, opacity: 0.8, borderRadius: "0 0 2px 2px" }} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, marginTop: 2 }}>
                  <span>lowest readings</span>
                  <span>highest readings</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

const pnl = (v: number | null) => (v == null ? C.textFaint : v >= 0 ? C.good : C.bad);
