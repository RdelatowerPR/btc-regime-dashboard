// ─── PANEL 3: RISK APPETITE (sUSDe TERM STRUCTURE) ──────────────────────────

import {
  ComposedChart,
  Line,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";
import type { TermStructureResponse } from "../services/api";
import { C, FONT, fmtPct, fmtNum, fmtUsd } from "../theme";
import { Panel, Metric, MetricGrid, Evidence, Badge, tooltipStyle, tooltipFormatter } from "./ui";

const REGIME_COLOR: Record<string, string> = {
  STEEP_CONTANGO: C.good,
  CONTANGO: C.goodMid,
  FLAT: C.textDim,
  BACKWARDATION: C.badMid,
  STEEP_BACKWARDATION: C.bad,
  SINGLE_MATURITY: C.textFaint,
};

export function TermStructurePanel({ data }: { data: TermStructureResponse }) {
  const latest = data.series.at(-1);
  const withSpread = data.series.filter((d) => d.term_spread_7dma != null);

  // Does the source report's central claim survive on the data we have?
  const contango = data.regimeStats.find((r) => r.regime === "CONTANGO");
  const steepBack = data.regimeStats.find((r) => r.regime === "STEEP_BACKWARDATION");
  const contangoBearish = (contango?.med_fwd_90d ?? 0) < 0;

  return (
    <Panel
      title="Risk appetite — sUSDe term structure"
      subtitle={
        <>
          Pendle splits sUSDe into principal and yield tokens across maturities, producing a forward
          curve on Ethena's basis-trade yield. <b>Contango</b> (back month above front) means the
          market expects funding to persist — risk-on. <b>Backwardation</b> means it expects funding
          to decay — risk-off. Shown as the 7-day moving average, per the source methodology.
        </>
      }
      right={
        latest?.regime && (
          <Badge color={REGIME_COLOR[latest.regime] ?? C.textDim}>{latest.regime.replace(/_/g, " ")}</Badge>
        )
      }
    >
      {latest && (
        <MetricGrid min={150}>
          <Metric
            label="Term spread (7dma)"
            value={fmtPct(latest.term_spread_7dma, 2)}
            color={(latest.term_spread_7dma ?? 0) >= 0 ? C.good : C.bad}
          />
          <Metric label="Raw spread" value={fmtPct(latest.term_spread, 2)} />
          <Metric label="Active maturities" value={fmtNum(latest.num_maturities, 0)} />
          <Metric label="Source" value={latest.source ?? "—"} sub={latest.date} />
        </MetricGrid>
      )}

      <div style={{ height: 300, marginTop: 20 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={withSpread} margin={{ top: 6, right: 46, bottom: 4, left: 6 }}>
            <CartesianGrid stroke={C.grid} />
            <XAxis dataKey="date" minTickGap={60} stroke={C.textFaint}
              tick={{ fontSize: 11, fontFamily: FONT.mono, fill: C.textFaint }} />
            <YAxis yAxisId="sp" stroke={C.textFaint}
              tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
              tick={{ fontSize: 11, fontFamily: FONT.mono, fill: C.textFaint }} />
            <YAxis yAxisId="px" orientation="right" stroke={C.textFaint}
              tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
              tick={{ fontSize: 11, fontFamily: FONT.mono, fill: C.textFaint }} />
            <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: C.textDim }}
              formatter={tooltipFormatter((v, n) => [n === "BTC" ? fmtUsd(v) : fmtPct(v, 2), n])} />
            <Legend wrapperStyle={{ fontFamily: FONT.mono, fontSize: 11 }} />
            <ReferenceLine yAxisId="sp" y={0} stroke={C.borderBright} />
            <Bar yAxisId="sp" dataKey="term_spread_7dma" name="Term spread 7dma">
              {withSpread.map((d) => (
                <Cell key={d.date} fill={(d.term_spread_7dma ?? 0) >= 0 ? C.good : C.bad} fillOpacity={0.7} />
              ))}
            </Bar>
            <Line yAxisId="px" type="monotone" dataKey="price" name="BTC" stroke={C.info} dot={false} strokeWidth={1.5} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Regime backtest table */}
      <div style={{ marginTop: 22, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: FONT.mono, fontSize: 12 }}>
          <thead>
            <tr style={{ color: C.textFaint, textAlign: "right" }}>
              <th style={{ textAlign: "left", padding: "6px 10px", fontWeight: 500 }}>Regime</th>
              <th style={{ padding: "6px 10px", fontWeight: 500 }}>Days</th>
              <th style={{ padding: "6px 10px", fontWeight: 500 }}>Median 90d</th>
              <th style={{ padding: "6px 10px", fontWeight: 500 }}>Hit rate</th>
            </tr>
          </thead>
          <tbody>
            {data.regimeStats.map((r) => (
              <tr key={r.regime} style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={{ padding: "7px 10px", color: REGIME_COLOR[r.regime] ?? C.textDim }}>
                  {r.regime.replace(/_/g, " ")}
                </td>
                <td style={{ padding: "7px 10px", textAlign: "right", color: C.textDim }}>{r.n}</td>
                <td style={{
                  padding: "7px 10px", textAlign: "right",
                  color: (r.med_fwd_90d ?? 0) >= 0 ? C.good : C.bad,
                }}>
                  {fmtPct(r.med_fwd_90d)}
                </td>
                <td style={{ padding: "7px 10px", textAlign: "right", color: C.textDim }}>
                  {fmtPct(r.hit_rate_90d, 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {contangoBearish && contango && (
        <Evidence>
          <b style={{ color: C.warn }}>This does not replicate the source report.</b> The sUSDe note
          reports contango as the strongest bullish signal, preceding positive 90-day skew over 80% of
          the time. On all the data available here, contango readings were followed by a median{" "}
          <b style={{ color: C.bad }}>{fmtPct(contango.med_fwd_90d)}</b> over 90 days, positive only{" "}
          {fmtPct(contango.hit_rate_90d, 0)} of the time (n={contango.n} days).
          {steepBack && (
            <>
              {" "}Steep backwardation did behave as advertised ({fmtPct(steepBack.med_fwd_90d)} median,{" "}
              {fmtPct(steepBack.hit_rate_90d, 0)} hit rate).
            </>
          )}{" "}
          Three caveats before discarding the signal: the sample is small and entirely out-of-sample
          versus the report's window; it covers a period dominated by one large drawdown; and the
          spread here is computed as longest-dated minus shortest-dated maturity, which may differ
          from the report's front/back-month definition. Treat the contango leg as unproven.
        </Evidence>
      )}
    </Panel>
  );
}
