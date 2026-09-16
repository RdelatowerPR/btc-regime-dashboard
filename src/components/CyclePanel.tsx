// ─── PANEL 1: CYCLE & VALUATION (THE BOTTOM SIGNALS) ────────────────────────
// Implements the indicators from the Blockworks "Bottom Signals" note, each
// shown with what the backtest actually found — including where it disagrees
// with the source.

import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
  Legend,
} from "recharts";
import type { SignalRow, TailRow, BottomBand } from "../services/api";
import { C, FONT, fmtUsd, fmtPct, fmtNum } from "../theme";
import { Panel, Metric, MetricGrid, Evidence, Badge, tooltipStyle, tooltipFormatter } from "./ui";

const yearTick = (d: string) => d.slice(0, 7);

export function CyclePanel({
  series,
  tails,
  band,
}: {
  series: SignalRow[];
  tails: TailRow[];
  band: BottomBand | null;
}) {
  const latest = series.at(-1);
  if (!latest) return null;

  const tail = (signal: string, pctile = 5) => tails.find((t) => t.signal === signal && t.pctile === pctile);
  const mvrvTail = tail("mvrv_z");
  const ndxTail = tail("ndx_btc_rsi");
  const goldTail = tail("gold_btc_rsi");

  return (
    <>
      {/* ── Realized price ── */}
      <Panel
        title="Realized price vs spot"
        subtitle={
          <>
            Realized price is the aggregate on-chain cost basis — what the average coin last moved at.
            Derived from Coin Metrics as market cap ÷ MVRV ÷ supply, which reconstructs the
            subscription-only realized-cap series exactly.
          </>
        }
        right={<Badge color={C.good}>strongest measured signal</Badge>}
      >
        <div style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 6, right: 10, bottom: 4, left: 6 }}>
              <CartesianGrid stroke={C.grid} />
              <XAxis dataKey="date" tickFormatter={yearTick} minTickGap={60} stroke={C.textFaint}
                tick={{ fontSize: 11, fontFamily: FONT.mono, fill: C.textFaint }} />
              <YAxis scale="log" domain={["auto", "auto"]} stroke={C.textFaint}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                tick={{ fontSize: 11, fontFamily: FONT.mono, fill: C.textFaint }} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={{ color: C.textDim }}
                formatter={tooltipFormatter((v, n) => [fmtUsd(v), n])}
              />
              <Legend wrapperStyle={{ fontFamily: FONT.mono, fontSize: 11 }} />
              {band && (
                <ReferenceArea
                  y1={band.priceLow}
                  y2={band.priceHigh}
                  fill={C.warn}
                  fillOpacity={0.14}
                  stroke={C.warn}
                  strokeOpacity={0.4}
                  strokeDasharray="3 3"
                  label={{
                    value: "projected cycle-low zone",
                    position: "insideTopLeft",
                    style: { fontSize: 10, fontFamily: FONT.mono, fill: C.warn },
                  }}
                />
              )}
              <Line type="monotone" dataKey="price" name="BTC spot" stroke={C.info} dot={false} strokeWidth={1.6} />
              <Line type="monotone" dataKey="realized_price" name="Realized price" stroke={C.accent} dot={false} strokeWidth={1.6} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div style={{ marginTop: 16 }}>
          <MetricGrid min={150}>
            <Metric label="Spot" value={fmtUsd(latest.price)} />
            <Metric label="Realized price" value={fmtUsd(latest.realized_price)} color={C.accent} />
            <Metric
              label="Premium to cost basis"
              value={fmtPct((latest.realized_ratio ?? 1) - 1)}
              color={(latest.realized_ratio ?? 1) < 1 ? C.good : C.text}
            />
            <Metric label="MVRV" value={fmtNum(latest.mvrv, 3)} sub={`${fmtNum(latest.mvrv_pct, 0)}th pctile`} />
          </MetricGrid>
        </div>

        {mvrvTail && (
          <Evidence>
            <b style={{ color: C.text }}>Backtest (2018+):</b> the bottom 5% of MVRV Z-score readings
            were followed by a median <b style={{ color: C.good }}>{fmtPct(mvrvTail.med_fwd_90d)}</b> over
            90 days and <b style={{ color: C.good }}>{fmtPct(mvrvTail.med_fwd_180d)}</b> over 180 days,
            hitting positive {fmtPct(mvrvTail.hit_rate_90d, 0)} of the time. That is the strongest
            reading in this entire dashboard — but n={mvrvTail.n} days of overlapping windows is only
            about two independent episodes (March 2020 and November 2022). Suggestive, not proven.
          </Evidence>
        )}
      </Panel>

      {/* ── Cross-asset relative strength ── */}
      <Panel
        title="Cross-asset relative strength"
        subtitle={
          <>
            14-period Wilder RSI on the weekly tradfi/BTC ratio, computed in log space and smoothed
            with a 5-period EMA. Log space is essential: the Nasdaq/BTC ratio spans six orders of
            magnitude, and in raw prices the early years contribute almost no absolute movement.
            A <b>high</b> reading means the traditional asset has outperformed — BTC is oversold
            against it.
          </>
        }
      >
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 6, right: 10, bottom: 4, left: 6 }}>
              <CartesianGrid stroke={C.grid} />
              <XAxis dataKey="date" tickFormatter={yearTick} minTickGap={60} stroke={C.textFaint}
                tick={{ fontSize: 11, fontFamily: FONT.mono, fill: C.textFaint }} />
              <YAxis domain={[0, 100]} ticks={[0, 30, 50, 70, 100]} stroke={C.textFaint}
                tick={{ fontSize: 11, fontFamily: FONT.mono, fill: C.textFaint }} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: C.textDim }}
                formatter={tooltipFormatter((v, n) => [fmtNum(v, 1), n])} />
              <Legend wrapperStyle={{ fontFamily: FONT.mono, fontSize: 11 }} />
              <ReferenceArea y1={70} y2={100} fill={C.good} fillOpacity={0.07} />
              <ReferenceLine y={70} stroke={C.good} strokeDasharray="3 3"
                label={{ value: "BTC oversold", position: "insideTopRight", style: { fontSize: 10, fontFamily: FONT.mono, fill: C.good } }} />
              <ReferenceLine y={30} stroke={C.bad} strokeDasharray="3 3"
                label={{ value: "BTC overbought", position: "insideBottomRight", style: { fontSize: 10, fontFamily: FONT.mono, fill: C.bad } }} />
              <Line type="monotone" dataKey="ndx_btc_rsi" name="Nasdaq/BTC" stroke={C.info} dot={false} strokeWidth={1.6} />
              <Line type="monotone" dataKey="gold_btc_rsi" name="Gold/BTC" stroke={C.warn} dot={false} strokeWidth={1.6} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div style={{ marginTop: 16 }}>
          <MetricGrid min={150}>
            <Metric label="Nasdaq/BTC RSI" value={fmtNum(latest.ndx_btc_rsi, 1)} color={C.info} />
            <Metric label="Gold/BTC RSI" value={fmtNum(latest.gold_btc_rsi, 1)} color={C.warn} />
          </MetricGrid>
        </div>

        {ndxTail && (
          <Evidence>
            <b style={{ color: C.bad }}>This indicator did not validate.</b> The Nasdaq/BTC RSI is the
            headline of the source report, but on 2018+ data its top 5% of readings — the "most
            oversold on record" zone — were followed by a median{" "}
            <b style={{ color: C.bad }}>{fmtPct(ndxTail.med_fwd_90d)}</b> over 90 days and{" "}
            <b style={{ color: C.bad }}>{fmtPct(ndxTail.med_fwd_180d)}</b> over 180 days, positive only{" "}
            {fmtPct(ndxTail.hit_rate_90d, 0)} of the time. Across deciles the spread is 1.4pp, i.e.
            nothing. <b>It is displayed but excluded from the composite score.</b>
          </Evidence>
        )}
        {goldTail && (
          <Evidence>
            <b style={{ color: C.good }}>Gold/BTC did validate</b>, which is a notable asymmetry. Its
            top 5% of readings preceded a median <b style={{ color: C.good }}>{fmtPct(goldTail.med_fwd_180d)}</b>{" "}
            over 180 days ({fmtPct(goldTail.hit_rate_90d, 0)} hit rate at 90d, n={goldTail.n}). Gold
            carries a weight in the composite; Nasdaq does not.
          </Evidence>
        )}
      </Panel>

      {/* ── Cycle clock ── */}
      <Panel
        title="Cycle clock"
        subtitle="Drawdown from the running all-time high, and time elapsed. The source report projects a trough around week 60 from the ATH."
      >
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 6, right: 10, bottom: 4, left: 6 }}>
              <CartesianGrid stroke={C.grid} />
              <XAxis dataKey="date" tickFormatter={yearTick} minTickGap={60} stroke={C.textFaint}
                tick={{ fontSize: 11, fontFamily: FONT.mono, fill: C.textFaint }} />
              <YAxis stroke={C.textFaint} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                tick={{ fontSize: 11, fontFamily: FONT.mono, fill: C.textFaint }} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: C.textDim }}
                formatter={tooltipFormatter((v) => [fmtPct(v), "drawdown"])} />
              <ReferenceLine y={-0.5} stroke={C.warn} strokeDasharray="3 3"
                label={{ value: "-50%", position: "insideTopRight", style: { fontSize: 10, fontFamily: FONT.mono, fill: C.warn } }} />
              <Area type="monotone" dataKey="drawdown" stroke={C.bad} fill={C.bad} fillOpacity={0.15} strokeWidth={1.4} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div style={{ marginTop: 16 }}>
          <MetricGrid min={150}>
            <Metric label="Drawdown from ATH" value={fmtPct(latest.drawdown)} color={C.bad} />
            <Metric label="Weeks since ATH" value={fmtNum(latest.weeks_from_ath, 0)} sub="report projects trough ~wk 60" />
            <Metric label="Mayer multiple" value={fmtNum(latest.mayer)} sub="price / 200dma" />
            <Metric label="Puell multiple" value={fmtNum(latest.puell)} sub="miner revenue vs 365d" />
          </MetricGrid>
        </div>
      </Panel>
    </>
  );
}
