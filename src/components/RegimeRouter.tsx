// ─── PANEL 0: REGIME ROUTER ─────────────────────────────────────────────────
// The one screen worth checking daily.
//
// Design rationale: a "bottom signal" and an "overheat signal" do not belong on
// the same axis — they answer different questions and are informative at
// opposite ends of the cycle. Averaging them into a single number destroys the
// information. So the position is plotted in two dimensions instead, with a
// 90-day trail so trajectory is visible rather than just the current point.

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  Cell,
} from "recharts";
import type { RegimeResponse, TailRow } from "../services/api";
import { C, FONT, fmtUsd, fmtPct, fmtNum, scoreColor, fmtSigned } from "../theme";
import { Panel, Metric, MetricGrid, Badge, ScoreBar, Evidence } from "./ui";

const QUADRANTS = [
  { x1: -100, x2: 0, y1: -100, y2: 0, label: "CHEAP · UNLEVERED", tone: C.good, verdict: "Accumulation zone" },
  { x1: -100, x2: 0, y1: 0, y2: 100, label: "CHEAP · LEVERED", tone: C.warn, verdict: "Falling knife" },
  { x1: 0, x2: 100, y1: -100, y2: 0, label: "RICH · UNLEVERED", tone: C.info, verdict: "Healthy trend" },
  { x1: 0, x2: 100, y1: 0, y2: 100, label: "RICH · LEVERED", tone: C.bad, verdict: "Danger zone" },
];

function quadrantOf(valuation: number | null, leverage: number | null) {
  if (valuation == null || leverage == null) return null;
  return QUADRANTS.find(
    (qd) => valuation >= qd.x1 && valuation < qd.x2 && leverage >= qd.y1 && leverage < qd.y2
  );
}

export function RegimeRouter({
  data,
  tails,
  leverageReliable,
}: {
  data: RegimeResponse;
  tails: TailRow[];
  leverageReliable: boolean;
}) {
  const l = data.latest;
  if (!l) return null;

  const quad = quadrantOf(l.valuation_score, l.leverage_score);
  const points = data.trail.map((t, i) => ({
    ...t,
    // Opacity ramps toward the present so the direction of travel is obvious.
    age: i / Math.max(1, data.trail.length - 1),
  }));

  const compositeTail = tails.find((t) => t.signal === "composite" && t.pctile === 5);
  const band = data.bottomBand;

  return (
    <Panel
      title="Regime Router"
      subtitle={
        <>
          Position in two dimensions, because valuation and leverage answer different questions.
          The trail shows the last {data.trail.length} days — direction matters more than the dot.
          Both axes are percentile ranks against BTC's own history, expressed −100 (extreme low) to
          +100 (extreme high).
        </>
      }
      right={
        quad && (
          <Badge color={quad.tone}>
            {quad.label} — {quad.verdict}
          </Badge>
        )
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.35fr) minmax(260px, 1fr)", gap: 24 }}>
        {/* ── Quadrant scatter ── */}
        <div style={{ height: 380 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 12, bottom: 24, left: 4 }}>
              {QUADRANTS.map((qd) => (
                <ReferenceArea
                  key={qd.label}
                  x1={qd.x1}
                  x2={qd.x2}
                  y1={qd.y1}
                  y2={qd.y2}
                  fill={qd.tone}
                  fillOpacity={0.05}
                  stroke="none"
                />
              ))}
              <CartesianGrid stroke={C.grid} strokeDasharray="2 4" />
              <XAxis
                type="number"
                dataKey="valuation_score"
                domain={[-100, 100]}
                ticks={[-100, -50, 0, 50, 100]}
                stroke={C.textFaint}
                tick={{ fontSize: 10.5, fontFamily: FONT.mono, fill: C.textFaint }}
                label={{
                  value: "← CHEAP        VALUATION        EXPENSIVE →",
                  position: "insideBottom",
                  offset: -14,
                  style: { fontSize: 10, fontFamily: FONT.mono, fill: C.textDim, letterSpacing: 0.5 },
                }}
              />
              <YAxis
                type="number"
                dataKey="leverage_score"
                domain={[-100, 100]}
                ticks={[-100, -50, 0, 50, 100]}
                stroke={C.textFaint}
                tick={{ fontSize: 10.5, fontFamily: FONT.mono, fill: C.textFaint }}
                label={{
                  value: "← UNLEVERED    LEVERAGE    CROWDED →",
                  angle: -90,
                  position: "insideLeft",
                  style: { fontSize: 10, fontFamily: FONT.mono, fill: C.textDim, letterSpacing: 0.5, textAnchor: "middle" },
                }}
              />
              <ZAxis range={[16, 16]} />
              <ReferenceLine x={0} stroke={C.borderBright} />
              <ReferenceLine y={0} stroke={C.borderBright} />
              <Tooltip
                cursor={{ stroke: C.borderBright }}
                // A custom `content` replaces the default renderer entirely, so
                // no `formatter` is needed alongside it.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                content={({ payload }: any) => {
                  const p = payload?.[0]?.payload;
                  if (!p) return null;
                  return (
                    <div
                      style={{
                        background: C.panelAlt,
                        border: `1px solid ${C.borderBright}`,
                        borderRadius: 6,
                        padding: "8px 10px",
                        fontFamily: FONT.mono,
                        fontSize: 11.5,
                        color: C.text,
                      }}
                    >
                      <div style={{ color: C.textDim, marginBottom: 3 }}>{p.date}</div>
                      <div>{fmtUsd(p.price)}</div>
                      <div style={{ color: C.textDim }}>
                        val {fmtSigned(p.valuation_score)} · lev {fmtSigned(p.leverage_score)}
                      </div>
                    </div>
                  );
                }}
              />
              <Scatter data={points} isAnimationActive={false}>
                {points.map((p, i) => {
                  const isLast = i === points.length - 1;
                  return (
                    <Cell
                      key={p.date}
                      fill={isLast ? C.accent : C.info}
                      fillOpacity={isLast ? 1 : 0.15 + p.age * 0.5}
                      stroke={isLast ? "#fff" : "none"}
                      strokeWidth={isLast ? 2 : 0}
                      r={isLast ? 7 : 3}
                    />
                  );
                })}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        {/* ── Axis readouts ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 4 }}>
          <AxisReadout
            label="Valuation"
            value={l.valuation_score}
            invert
            hint="MVRV Z-score (double weight), Mayer multiple, Gold/BTC RSI. Negative = cheap."
          />
          <AxisReadout
            label="Leverage"
            value={l.leverage_score}
            hint={
              leverageReliable
                ? "OI heat, OI/market cap, funding. Positive = crowded."
                : "Insufficient open-interest history — treat as unreliable."
            }
            unreliable={!leverageReliable}
          />
          <AxisReadout
            label="Macro liquidity"
            value={l.macro_score}
            invert
            hint="Net liquidity, credit spreads, dollar, real rates, stablecoin float. Positive = tailwind."
          />
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
            <AxisReadout
              label="Composite"
              value={l.composite}
              invert
              hint="Blend of the three, oriented as expected forward return."
              big
            />
            {compositeTail && (
              <Evidence>
                Historically, the top 5% of composite readings (2018+) were followed by a median{" "}
                <b style={{ color: C.good }}>{fmtPct(compositeTail.med_fwd_90d)}</b> over 90 days and{" "}
                <b style={{ color: C.good }}>{fmtPct(compositeTail.med_fwd_180d)}</b> over 180 days,
                with a {fmtPct(compositeTail.hit_rate_90d, 0)} hit rate (n={compositeTail.n} days).
              </Evidence>
            )}
          </div>
        </div>
      </div>

      {/* ── Cycle snapshot ── */}
      <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 20, paddingTop: 18 }}>
        <MetricGrid min={128}>
          <Metric label="BTC spot" value={fmtUsd(l.price)} />
          <Metric
            label="Realized price"
            value={fmtUsd(l.realized_price)}
            sub={`spot ${fmtSigned(((l.realized_ratio ?? 1) - 1) * 100)}%`}
            color={(l.realized_ratio ?? 1) < 1 ? C.good : C.text}
            title="Aggregate on-chain cost basis. Derived from Coin Metrics market cap ÷ MVRV ÷ supply."
          />
          <Metric
            label="MVRV Z-score"
            value={fmtNum(l.mvrv_z)}
            sub={`${fmtNum(l.mvrv_pct, 0)}th pctile`}
            color={scoreColor(l.mvrv_pct == null ? null : (l.mvrv_pct - 50) * 2)}
          />
          <Metric
            label="Drawdown"
            value={fmtPct(l.drawdown)}
            sub={`week ${fmtNum(l.weeks_from_ath, 0)} from ATH`}
            color={C.bad}
          />
          <Metric label="Mayer" value={fmtNum(l.mayer)} sub="price / 200dma" />
          <Metric label="Puell" value={fmtNum(l.puell)} sub="miner revenue" />
        </MetricGrid>
      </div>

      {/* ── Trend-adjusted bottom band ── */}
      {band && (
        <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 18, paddingTop: 16 }}>
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start" }}>
            <Metric
              label="Projected cycle-low zone"
              value={`${fmtUsd(band.priceLow)} – ${fmtUsd(band.priceHigh)}`}
              sub={`${fmtPct(band.projectedDiscount)} vs realized price · midpoint ${fmtUsd(band.priceMid)}`}
              color={C.warn}
            />
          </div>
          <Evidence>
            Every prior bear low traded at a discount to realized price, but the discount has shrunk
            every cycle — {data.cycleLows.map((c) => fmtPct(c.discount, 0)).join(", ")} in{" "}
            {data.cycleLows.map((c) => c.date.slice(0, 4)).join(", ")}. A fixed "below realized price"
            trigger would wait for something that may never arrive, so this fits the decay and
            extrapolates one cycle forward. <b>{band.caveat}</b> Treat it as a zone of interest, not a
            forecast.
          </Evidence>
        </div>
      )}
    </Panel>
  );
}

function AxisReadout({
  label,
  value,
  hint,
  invert = false,
  big = false,
  unreliable = false,
}: {
  label: string;
  value: number | null;
  hint: string;
  invert?: boolean;
  big?: boolean;
  unreliable?: boolean;
}) {
  const color = unreliable ? C.textFaint : scoreColor(value, invert);
  return (
    <div style={{ opacity: unreliable ? 0.6 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span
          style={{
            fontFamily: FONT.sans,
            fontSize: 11,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: C.textFaint,
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: FONT.mono,
            fontSize: big ? 24 : 18,
            fontWeight: 600,
            color,
          }}
        >
          {value == null ? "—" : fmtSigned(value, 0)}
        </span>
      </div>
      <ScoreBar value={value} color={color} />
      <div style={{ fontFamily: FONT.sans, fontSize: 11, color: C.textFaint, marginTop: 6, lineHeight: 1.45 }}>
        {hint}
      </div>
    </div>
  );
}
