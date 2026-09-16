// ─── PANEL 4: MACRO LIQUIDITY ───────────────────────────────────────────────
// Implements the Capital Flows framing — "price of money" (real rates, credit
// spreads, dollar) and "quantity of money" (central bank balance sheet net of
// the Treasury account and reverse repo) — from free FRED series.

import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";
import type { SignalRow, BucketRow } from "../services/api";
import { C, FONT, fmtNum, fmtPct, fmtUsd } from "../theme";
import { Panel, Metric, MetricGrid, Evidence, tooltipStyle, tooltipFormatter } from "./ui";

const yearTick = (d: string) => d.slice(0, 7);

export function MacroPanel({ series, buckets }: { series: SignalRow[]; buckets: BucketRow[] }) {
  const latest = series.at(-1);
  if (!latest) return null;

  const spread = (signal: string) => {
    const rows = buckets.filter((b) => b.signal === signal).sort((a, b) => a.bucket_ord - b.bucket_ord);
    if (rows.length < 2) return null;
    return {
      lo: rows[0].med_fwd_90d,
      hi: rows.at(-1)!.med_fwd_90d,
      n: rows[0].n,
    };
  };
  const netLiq = spread("net_liquidity_90d");
  const stable = spread("stablecoin_30d");

  return (
    <>
      <Panel
        title="Macro liquidity — quantity of money"
        subtitle={
          <>
            Net liquidity = Fed balance sheet − Treasury General Account − overnight reverse repo.
            The level trends forever, so the 90-day rate of change is what carries the signal.
          </>
        }
      >
        <MetricGrid min={150}>
          <Metric
            label="Net liquidity"
            value={latest.net_liquidity ? `$${(latest.net_liquidity / 1000).toFixed(2)}T` : "—"}
          />
          <Metric
            label="90-day change"
            value={latest.net_liquidity_90d == null ? "—" : `${latest.net_liquidity_90d >= 0 ? "+" : ""}${fmtNum(latest.net_liquidity_90d)}%`}
            color={(latest.net_liquidity_90d ?? 0) >= 0 ? C.good : C.bad}
          />
          <Metric
            label="Stablecoin float 30d"
            value={latest.stablecoin_30d == null ? "—" : `${latest.stablecoin_30d >= 0 ? "+" : ""}${fmtNum(latest.stablecoin_30d)}%`}
            color={(latest.stablecoin_30d ?? 0) >= 0 ? C.warn : C.good}
          />
          <Metric label="Macro score" value={latest.macro_score == null ? "—" : fmtNum(latest.macro_score, 0)}
            color={(latest.macro_score ?? 0) >= 0 ? C.good : C.bad} />
        </MetricGrid>

        <div style={{ height: 280, marginTop: 20 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 6, right: 46, bottom: 4, left: 6 }}>
              <CartesianGrid stroke={C.grid} />
              <XAxis dataKey="date" tickFormatter={yearTick} minTickGap={60} stroke={C.textFaint}
                tick={{ fontSize: 11, fontFamily: FONT.mono, fill: C.textFaint }} />
              <YAxis yAxisId="nl" stroke={C.textFaint}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}T`}
                tick={{ fontSize: 11, fontFamily: FONT.mono, fill: C.textFaint }} />
              <YAxis yAxisId="px" orientation="right" scale="log" domain={["auto", "auto"]} stroke={C.textFaint}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                tick={{ fontSize: 11, fontFamily: FONT.mono, fill: C.textFaint }} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: C.textDim }}
                formatter={tooltipFormatter((v, n) => [n === "BTC" ? fmtUsd(v) : `$${(v / 1000).toFixed(2)}T`, n])} />
              <Legend wrapperStyle={{ fontFamily: FONT.mono, fontSize: 11 }} />
              <Area yAxisId="nl" type="monotone" dataKey="net_liquidity" name="Net liquidity"
                stroke={C.accent} fill={C.accent} fillOpacity={0.12} strokeWidth={1.5} />
              <Line yAxisId="px" type="monotone" dataKey="price" name="BTC" stroke={C.info} dot={false} strokeWidth={1.4} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {netLiq && (
          <Evidence>
            <b style={{ color: C.text }}>Backtest (2018+):</b> the slowest decile of net-liquidity
            growth was followed by a median <b style={{ color: C.bad }}>{fmtPct(netLiq.lo)}</b> over
            90 days, the fastest decile by <b style={{ color: C.good }}>{fmtPct(netLiq.hi)}</b> — a{" "}
            {fmtNum(((netLiq.hi ?? 0) - (netLiq.lo ?? 0)) * 100, 0)}pp spread, the second strongest
            in the dashboard after realized price.
          </Evidence>
        )}
        {stable && (
          <Evidence>
            <b style={{ color: C.warn }}>Stablecoin float is contrarian, not a tailwind.</b> The
            fastest decile of 30-day float growth was followed by a median{" "}
            <b style={{ color: C.bad }}>{fmtPct(stable.hi)}</b> over 90 days, the slowest by{" "}
            <b style={{ color: C.good }}>{fmtPct(stable.lo)}</b>. The sign is consistent across every
            era tested, which makes it structure rather than noise: the float expands hardest as
            retail money arrives late in a rally. It enters the macro score inverted.
          </Evidence>
        )}
      </Panel>

      <Panel
        title="Macro liquidity — price of money"
        subtitle="Credit spreads, the dollar and real rates. All three are headwinds when they rise, so they enter the macro score inverted."
      >
        <MetricGrid min={150}>
          <Metric label="High-yield OAS" value={latest.hy_oas == null ? "—" : `${fmtNum(latest.hy_oas)}%`}
            color={(latest.hy_oas ?? 0) > 4 ? C.bad : C.good} sub="credit stress" />
          <Metric label="Broad dollar index" value={fmtNum(latest.dxy)} sub="trade-weighted" />
          <Metric label="10y real yield" value={latest.real_10y == null ? "—" : `${fmtNum(latest.real_10y)}%`}
            sub="TIPS" />
        </MetricGrid>

        <div style={{ height: 250, marginTop: 20 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 6, right: 46, bottom: 4, left: 6 }}>
              <CartesianGrid stroke={C.grid} />
              <XAxis dataKey="date" tickFormatter={yearTick} minTickGap={60} stroke={C.textFaint}
                tick={{ fontSize: 11, fontFamily: FONT.mono, fill: C.textFaint }} />
              <YAxis yAxisId="pct" stroke={C.textFaint} tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                tick={{ fontSize: 11, fontFamily: FONT.mono, fill: C.textFaint }} />
              <YAxis yAxisId="dxy" orientation="right" stroke={C.textFaint} domain={["auto", "auto"]}
                tick={{ fontSize: 11, fontFamily: FONT.mono, fill: C.textFaint }} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: C.textDim }}
                formatter={tooltipFormatter((v, n) => [fmtNum(v), n])} />
              <Legend wrapperStyle={{ fontFamily: FONT.mono, fontSize: 11 }} />
              <ReferenceLine yAxisId="pct" y={0} stroke={C.borderBright} />
              <Line yAxisId="pct" type="monotone" dataKey="hy_oas" name="HY OAS %" stroke={C.bad} dot={false} strokeWidth={1.4} />
              <Line yAxisId="pct" type="monotone" dataKey="real_10y" name="10y real %" stroke={C.warn} dot={false} strokeWidth={1.4} />
              <Line yAxisId="dxy" type="monotone" dataKey="dxy" name="Dollar" stroke={C.textDim} dot={false} strokeWidth={1.4} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    </>
  );
}
