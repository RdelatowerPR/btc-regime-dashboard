// ─── PANEL 2: LEVERAGE & OVERHEAT (THE 1000x SIGNAL) ────────────────────────
// "Is this rally being carried by new leverage or by real spot demand?"
//
// The definition here is transcribed from the source episode rather than
// reconstructed — see OI_HEAT_SPEC in server/signals.ts.
//
// 2026-09-16: funding is displayed in its stored unit (percent per 8 hours; the
// tab used to multiply it by 100 a second time). The venue weighting behind the
// number, and the positioning data the sync collects, stay off this page: the
// tab shows the reading, the research note carries the analysis.

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
import type { LeverageResponse } from "../services/api";
import { C, FONT, fmtNum, fmtPct, fmtUsd } from "../theme";
import { Panel, Metric, MetricGrid, Note, Evidence, Badge, tooltipStyle, tooltipFormatter } from "./ui";

// Funding is stored in PERCENT PER 8 HOURS (coinalyze's convention). 0.01 is the
// exchanges' neutral rate; the words follow the ten-year bands behind fundingLevelScore.
const fmtFunding = (f: number | null | undefined) => (f == null ? "—" : `${f.toFixed(4)}%`);
const annualised = (f: number | null | undefined) => (f == null ? "—" : `${(f * 3 * 365).toFixed(1)}%`);
const fundingWord = (f: number | null | undefined) =>
  f == null
    ? "—"
    : f >= 0.08
      ? "extreme"
      : f >= 0.04
        ? "hot"
        : f >= 0.02
          ? "warning"
          : f >= 0.01
            ? "above neutral"
            : f >= 0
              ? "neutral"
              : "shorts paying";
const fundingColor = (f: number | null | undefined) =>
  f == null ? C.textFaint : f >= 0.04 ? C.bad : f >= 0.02 ? C.warn : f < 0 ? C.good : C.text;

export function LeveragePanel({ data }: { data: LeverageResponse }) {
  const latest = data.series.at(-1);
  const cov = data.coverage;
  const spec = data.spec;
  const heat = latest?.oi_heat_leg ?? null;
  const t2 = data.thresholds?.find((t) => t.threshold === 2);
  const t3 = data.thresholds?.find((t) => t.threshold === 3);

  return (
    <Panel
      title="Leverage & overheat"
      subtitle={
        <>
          Measures whether a rally is being carried by <b>new leverage</b> or by real spot demand.
          Open interest is counted in coin terms across all venues, because USD open interest rises
          mechanically with price and so cannot tell "more leverage" apart from "same leverage,
          higher price".
        </>
      }
      right={cov && <Badge color={data.hasHistory ? C.good : C.warn}>{cov.source} · {cov.n}d</Badge>}
    >
      {data.note && <Note tone="warn">{data.note}</Note>}

      {/* ── The definition, verbatim from the source ── */}
      {spec && (
        <div style={{ borderLeft: `2px solid ${C.accent}`, paddingLeft: 12, marginBottom: 18 }}>
          <div
            style={{
              fontFamily: FONT.ui,
              fontSize: 13,
              color: C.text,
              lineHeight: 1.6,
              fontStyle: "italic",
            }}
          >
            “{spec.quote}”
          </div>
          <div style={{ fontFamily: FONT.mono, fontSize: 11, color: C.textFaint, marginTop: 6 }}>
            Jonah Van Bourg —{" "}
            <a href={spec.url} target="_blank" rel="noreferrer" style={{ color: C.info }}>
              1000x, “How To Trade Using Open Interest &amp; Funding Rates”
            </a>
          </div>
          <div
            style={{
              fontFamily: FONT.ui,
              fontSize: 12,
              color: C.textDim,
              marginTop: 10,
              lineHeight: 1.55,
            }}
          >
            The sentence alone leaves the units ambiguous; his two worked examples pin them down. A{" "}
            <b>+40%</b> price leg that added <b>8.8%</b> to open interest gives{" "}
            <b style={{ color: C.good }}>0.22</b> — "open interest doesn't go crazy". The next leg,{" "}
            <b>+8.8%</b> price against <b>+21.6%</b> open interest, gives{" "}
            <b style={{ color: C.bad }}>2.45</b> — the danger case. So the ratio is{" "}
            <b>% change in coin-denominated OI ÷ % change in price</b>, measured{" "}
            <b>over the current rally leg</b> rather than a fixed lookback (his two legs ran about
            two months and about one week).
          </div>
        </div>
      )}

      {latest && (
        <MetricGrid min={140}>
          <Metric
            label="OI heat — current leg"
            value={fmtNum(heat)}
            sub={latest.oi_leg_start ? `leg from ${latest.oi_leg_start}` : undefined}
            color={heatColor(heat)}
            title="%Δ coin-denominated OI ÷ %Δ price since the last confirmed swing low"
          />
          <Metric
            label="Leg price change"
            value={fmtPct(latest.oi_leg_price_chg)}
            color={(latest.oi_leg_price_chg ?? 0) >= 0 ? C.good : C.bad}
          />
          <Metric
            label="Leg OI change"
            value={fmtPct(latest.oi_leg_oi_chg)}
            color={(latest.oi_leg_oi_chg ?? 0) >= 0 ? C.warn : C.good}
          />
          <Metric
            label="Percentile"
            value={latest.oi_heat_pct == null ? "—" : `${fmtNum(latest.oi_heat_pct, 0)}th`}
            sub={data.hasHistory ? "vs own history" : "needs more history"}
          />
          <Metric label="Open interest" value={`${fmtUsd(latest.oi_usd ? latest.oi_usd / 1e9 : null, 1)}B`} />
          <Metric
            label="OI in coins"
            value={latest.oi_coins ? `${(latest.oi_coins / 1000).toFixed(1)}k BTC` : "—"}
          />
          <Metric label="OI / market cap" value={fmtPct(latest.oi_mcap_ratio, 2)} />
          <Metric
            label="Funding"
            value={fmtFunding(latest.funding_rate)}
            sub={`per 8h · ≈ ${annualised(latest.funding_rate)} a year · ${fundingWord(latest.funding_rate)}`}
            color={fundingColor(latest.funding_rate)}
            title="What leveraged longs pay shorts, weighted across venues by the money behind each. 0.01% per 8h is the exchanges' neutral rate; above 0.04 has preceded losses over ten years."
          />
        </MetricGrid>
      )}

      {heat != null && (
        <div style={{ marginTop: 18 }}>
          <Badge color={heatColor(heat)}>{verdict(heat)}</Badge>
        </div>
      )}

      <div style={{ height: 300, marginTop: 22 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data.series} margin={{ top: 6, right: 46, bottom: 4, left: 6 }}>
            <CartesianGrid stroke={C.grid} />
            <XAxis dataKey="date" minTickGap={60} stroke={C.textFaint}
              tick={{ fontSize: 11, fontFamily: FONT.mono, fill: C.textFaint }} />
            {/* allowDataOverflow is required: without it Recharts treats the
                domain as a hint and stretches it to fit outliers, which both
                buries the 2x/3x lines and produces unrounded tick labels. */}
            <YAxis yAxisId="heat" domain={[-3, 5]} allowDataOverflow
              ticks={[-3, -2, -1, 0, 1, 2, 3, 4, 5]} stroke={C.textFaint}
              tick={{ fontSize: 11, fontFamily: FONT.mono, fill: C.textFaint }}
              label={{ value: "OI heat (leg)", angle: -90, position: "insideLeft",
                style: { fontSize: 10, fontFamily: FONT.mono, fill: C.textDim } }} />
            <YAxis yAxisId="px" orientation="right" stroke={C.textFaint}
              tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
              tick={{ fontSize: 11, fontFamily: FONT.mono, fill: C.textFaint }} />
            <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: C.textDim }}
              formatter={tooltipFormatter((v, n) => [n === "BTC" ? fmtUsd(v) : fmtNum(v, 2), n])} />
            <Legend wrapperStyle={{ fontFamily: FONT.mono, fontSize: 11 }} />
            <ReferenceLine yAxisId="heat" y={0} stroke={C.borderBright} />
            <ReferenceLine yAxisId="heat" y={2} stroke={C.warn} strokeDasharray="4 3"
              label={{ value: "2× danger zone", position: "insideTopLeft",
                style: { fontSize: 10, fontFamily: FONT.mono, fill: C.warn } }} />
            <ReferenceLine yAxisId="heat" y={3} stroke={C.bad} strokeDasharray="4 3"
              label={{ value: "3×", position: "insideTopLeft",
                style: { fontSize: 10, fontFamily: FONT.mono, fill: C.bad } }} />
            <Bar yAxisId="heat" dataKey="oi_heat_leg" name="OI heat (leg)">
              {data.series.map((d, i) => (
                <Cell key={i} fill={heatColor(d.oi_heat_leg)} fillOpacity={0.75} />
              ))}
            </Bar>
            <Line yAxisId="px" type="monotone" dataKey="price" name="BTC" stroke={C.info} dot={false} strokeWidth={1.5} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ── Do his thresholds actually hold? ── */}
      {data.thresholds?.length > 0 && (
        <>
          <div style={{ marginTop: 24, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: FONT.mono, fontSize: 12 }}>
              <thead>
                <tr style={{ color: C.textFaint, textAlign: "right" }}>
                  <th style={{ textAlign: "left", padding: "6px 10px", fontWeight: 500 }}>OI heat</th>
                  <th style={{ padding: "6px 10px", fontWeight: 500 }}>Days</th>
                  <th style={{ padding: "6px 10px", fontWeight: 500 }}>Median 30d</th>
                  <th style={{ padding: "6px 10px", fontWeight: 500 }}>Median 90d</th>
                </tr>
              </thead>
              <tbody>
                {t2 && (
                  <tr style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: "7px 10px", color: C.good }}>&lt; 2× (baseline)</td>
                    <td style={{ padding: "7px 10px", textAlign: "right", color: C.textDim }}>—</td>
                    <td style={{ padding: "7px 10px", textAlign: "right", color: pnl(t2.belowMed30d), fontWeight: 600 }}>
                      {fmtPct(t2.belowMed30d)}
                    </td>
                    <td style={{ padding: "7px 10px", textAlign: "right", color: C.textDim }}>
                      {fmtPct(t2.belowMed90d)}
                    </td>
                  </tr>
                )}
                {data.thresholds.map((t) => (
                  <tr key={t.threshold} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: "7px 10px", color: heatColor(t.threshold) }}>≥ {t.threshold}×</td>
                    <td style={{ padding: "7px 10px", textAlign: "right", color: C.textDim }}>{t.n}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right", color: pnl(t.aboveMed30d), fontWeight: 600 }}>
                      {fmtPct(t.aboveMed30d)}
                    </td>
                    <td style={{ padding: "7px 10px", textAlign: "right", color: C.textDim }}>
                      {fmtPct(t.aboveMed90d)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {t2 && t3 && (() => {
            // The sentence follows the live numbers. A hard-coded "washes out by
            // 90 days" once sat beside a table showing a 16pp gap at 90 days.
            const gap30 = (t2.belowMed30d ?? 0) - (t2.aboveMed30d ?? 0);
            const gap90 = (t2.belowMed90d ?? 0) - (t2.aboveMed90d ?? 0);
            const validates = gap30 > 0.02;
            const persists = gap90 > 0.02;
            return (
              <Evidence>
                <b style={{ color: validates ? C.good : C.warn }}>
                  {validates
                    ? "The stated thresholds validate at 30 days."
                    : "The stated thresholds do not separate at 30 days on this data."}
                </b>{" "}
                Readings at or above 2× were followed by a median{" "}
                <b style={{ color: C.bad }}>{fmtPct(t2.aboveMed30d)}</b> over the next month against{" "}
                <b style={{ color: C.good }}>{fmtPct(t2.belowMed30d)}</b> below 2×, and at 3× the
                median is <b style={{ color: C.bad }}>{fmtPct(t3.aboveMed30d)}</b>.{" "}
                {persists ? (
                  <>
                    At 90 days the gap is still {fmtNum(gap90 * 100, 0)}pp ({fmtPct(t2.aboveMed90d)} against{" "}
                    {fmtPct(t2.belowMed90d)}), so on the current history it reads as more than a
                    weeks-long positioning signal.
                  </>
                ) : (
                  <>
                    By 90 days the gap has closed ({fmtPct(t2.aboveMed90d)} against {fmtPct(t2.belowMed90d)}),
                    which matches how it is framed on air: a tactical signal with a horizon of weeks.
                  </>
                )}{" "}
                These figures are recomputed on every sync and this wording follows them.
              </Evidence>
            );
          })()}
          <Evidence>
            Small samples ({t3?.n} days above 3×) clustered into a handful of episodes.
            Directionally consistent, not statistically proven.
          </Evidence>
        </>
      )}
    </Panel>
  );
}

function verdict(v: number) {
  if (v >= 3) return "SEVERE — leverage far outpacing price";
  if (v >= 2) return "DANGER ZONE — leverage-led move";
  if (v >= 1) return "ELEVATED";
  if (v < 0) return "DELEVERAGING — open interest coming off";
  return "HEALTHY — spot-led";
}

function heatColor(v: number | null | undefined) {
  if (v == null) return C.textFaint;
  if (v >= 3) return C.bad;
  if (v >= 2) return C.warn;
  if (v >= 1) return C.badMid;
  if (v < 0) return C.info;
  return C.good;
}

const pnl = (v: number | null) => (v == null ? C.textFaint : v >= 0 ? C.good : C.bad);
