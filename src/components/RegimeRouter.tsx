// ─── PANEL 0: OVERVIEW — THE DAILY VIEW ─────────────────────────────────────
// Rebuilt 2026-09-12 to be read at a glance rather than studied, and written
// 2026-09-13 for a reader with no context: every term is either plain English
// or explained where it appears. The verdict leads at display size with one
// sentence saying what it means, every number carries its own motion (a
// delta, a 30-day ghost marker, a sparkline), the sign conventions are drawn
// onto the bars, and the prose that explains the method sits behind
// disclosures at the bottom.
//
// The regime itself is computed server-side (server/verdict.ts) from 7-day
// means with a ±10 dead zone, and logged once per as-of date so the calls can
// be scored later. This file only draws it.

import { useState, type CSSProperties, type ReactNode } from "react";
import type {
  LeverageResponse,
  QuadrantKey,
  RegimeResponse,
  SignalRow,
  TailRow,
  TermStructureResponse,
  TrailRow,
  VerdictsResponse,
} from "../services/api";
import { QUADRANT_META } from "../regime";
import { C, FONT, fmtNum, fmtUsd } from "../theme";
import { AxisBar, Badge, Disclosure, MiniStat, Panel, Spark } from "./ui";
import { RegimeMap } from "./RegimeMap";

// ── formatting ──────────────────────────────────────────────────────────────

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dmy = (d: string) => {
  const [, m, dd] = d.split("-");
  return `${MON[Number(m) - 1]} ${Number(dd)}`;
};
const sgn = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "");
// Sign follows the ROUNDED value, so −0.3 prints as 0, never as −0.
const signed = (v: number | null | undefined, digits = 0) => {
  if (v == null) return "—";
  const mag = Math.abs(v).toFixed(digits);
  return `${Number(mag) === 0 ? "" : sgn(v)}${mag}`;
};
const pct = (v: number | null | undefined, digits = 1) => {
  if (v == null) return "—";
  const mag = Math.abs(v * 100).toFixed(digits);
  return `${Number(mag) === 0 ? "" : sgn(v)}${mag}%`;
};
const pctPlain = (v: number | null | undefined, digits = 1) =>
  v == null ? "—" : `${v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(digits)}%`;
const glyph = (v: number) => (v > 0 ? "▲" : v < 0 ? "▼" : "·");
const dirColor = (v: number) => (v > 0 ? C.good : v < 0 ? C.bad : C.textFaint);
const kUsd = (v: number | null | undefined) => (v == null ? "—" : `$${(v / 1000).toFixed(1)}k`);
const pnl = (v: number | null) => (v == null ? C.textFaint : v >= 0 ? C.good : C.bad);

const labelStyle: CSSProperties = {
  fontFamily: FONT.ui,
  fontSize: 11,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: C.textFaint,
};
const hairlineTop: CSSProperties = { borderTop: `1px solid ${C.border}` };
const plain: CSSProperties = { fontFamily: FONT.ui, fontSize: 12.5, lineHeight: 1.55, color: C.textDim };

// ── axis vocabulary ─────────────────────────────────────────────────────────

type Axis = "valuation" | "leverage" | "macro";
type ScoreKey = "valuation_score" | "leverage_score" | "macro_score";

/** One plain word for a reading, in the vocabulary of that axis. */
function stateWord(axis: Axis, x: number | null): string {
  if (x == null) return "n/a";
  const a = Math.abs(x);
  const band = a < 15 ? 0 : a < 50 ? 1 : 2;
  const words: Record<Axis, [string[], string[]]> = {
    valuation: [["fair", "leaning cheap", "cheap"], ["fair", "leaning expensive", "expensive"]],
    leverage: [["neutral", "light", "very light"], ["neutral", "building", "crowded"]],
    macro: [["neutral", "headwind", "strong headwind"], ["neutral", "tailwind", "strong tailwind"]],
  };
  return words[axis][x < 0 ? 0 : 1][band];
}

/** Supportive readings are green, adverse ones red, and anything within 15 of neutral is muted. */
function stateTone(axis: Axis, x: number | null): string {
  if (x == null || Math.abs(x) < 15) return C.textFaint;
  const supportive = axis === "macro" ? x > 0 : x < 0;
  return supportive ? C.good : C.bad;
}

const STRENGTH_WORD = { faint: "weak", moderate: "moderate", strong: "strong" } as const;
const STRENGTH_NOTE = {
  faint: "both gauges sit close to neutral, so this is a close call",
  moderate: "one gauge is clearly away from neutral",
  strong: "both gauges are well away from neutral",
} as const;

const AXES: {
  key: ScoreKey;
  axis: Axis;
  question: string;
  parts: string;
  tip: string;
  left: string;
  right: string;
}[] = [
  {
    key: "valuation_score",
    axis: "valuation",
    question: "Cheap or expensive?",
    parts: "MVRV Z-score ×2, Mayer multiple, gold/BTC strength",
    tip:
      "MVRV Z-score: how far the price sits from the average cost basis of all coins, in standard deviations. " +
      "Mayer multiple: price divided by its 200-day average. Gold/BTC strength: how Bitcoin has done against gold recently.",
    left: "← cheap",
    right: "expensive →",
  },
  {
    key: "leverage_score",
    axis: "leverage",
    question: "Crowded with leverage?",
    parts: "open-interest heat, open interest ÷ market cap, funding level",
    tip:
      "Open interest: the value of futures positions open in the market. Heat: how much faster it has grown than price over the current move. " +
      "Funding level: what leveraged longs pay shorts, weighted across venues by the money behind each, on a fixed ten-year scale (neutral to 0.01% per 8 hours, warning above 0.02, hot above 0.04, extreme above 0.08).",
    left: "← light",
    right: "crowded →",
  },
  {
    key: "macro_score",
    axis: "macro",
    question: "Macro liquidity helping?",
    parts: "net liquidity, credit spreads, the dollar, real yields, stablecoin float",
    tip:
      "Net liquidity: the Fed's balance sheet minus the Treasury's account and reverse repo. Credit spreads: the extra yield junk bonds pay. " +
      "Real yields: the 10-year Treasury yield after inflation. Stablecoin float: total dollar stablecoins in circulation.",
    left: "← headwind",
    right: "tailwind →",
  },
];

const LABELS: Record<string, string> = {
  mvrv_z: "MVRV Z-score",
  realized_ratio: "Price vs cost basis",
  ndx_btc_rsi: "Nasdaq/BTC strength",
  gold_btc_rsi: "Gold/BTC strength",
  mayer: "Mayer multiple",
  puell: "Puell multiple",
  oi_heat_leg: "Open-interest heat (current move)",
  oi_heat_30d: "Open-interest heat (30 days)",
  funding_7d: "Funding rate, 7 days (BitMEX before 2022)",
  composite: "Overall score",
};
/** Signals whose extreme TOP readings are expected to precede losses, not gains. */
const OVERHEAT = new Set(["oi_heat_leg", "oi_heat_30d", "funding_7d"]);

// ── the panel ───────────────────────────────────────────────────────────────

export function RegimeRouter({
  data,
  cycle,
  tails,
  caveat,
  leverage,
  term,
  verdicts,
}: {
  data: RegimeResponse;
  cycle: SignalRow[];
  tails: TailRow[];
  caveat: string;
  leverage: LeverageResponse | null;
  term: TermStructureResponse | null;
  verdicts: VerdictsResponse | null;
}) {
  const [days, setDays] = useState<90 | 365>(90);
  const l = data.latest;
  const trail = data.trail;
  const v = data.verdict;
  if (!l || trail.length === 0) return null;

  const L = trail.length - 1;
  const at = (key: ScoreKey | "composite" | "price", back = 0): number | null =>
    L - back >= 0 ? (trail[L - back][key] ?? null) : null;
  const mean7 = (key: ScoreKey): number | null => {
    const vals = trail.slice(-7).map((r) => r[key]).filter((x): x is number => x != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const price = at("price") ?? l.price;
  const delta = (back: number) => {
    const p = at("price", back);
    return p ? price / p - 1 : null;
  };
  const comps = trail.map((r) => r.composite).filter((x): x is number => x != null);
  const meta = v ? QUADRANT_META[v.quadrant] : null;
  const band = data.bottomBand;
  const cyc = cycle.slice(-365);
  const cyc30 = cyc[cyc.length - 31];
  const drawdowns = cyc.map((r) => r.drawdown).filter((x): x is number => x != null);

  const since = !v
    ? ""
    : v.enteredFrom
      ? `This regime has held for ${v.daysInQuadrant} day${v.daysInQuadrant === 1 ? "" : "s"}. Until ${dmy(v.runStart)} the regime was "${QUADRANT_META[v.enteredFrom].name.toLowerCase()}"; ${
          v.enteredHow === "both" ? "both gauges" : `the ${v.enteredHow} gauge`
        } moved enough to change it.`
      : `This regime has held since ${dmy(v.runStart)}, the start of the record.`;

  return (
    <>
      {/* ── Today's read ── */}
      <Panel title={`Today's regime · ${l.date}`}>
        <div className="hero-grid">
          <div>
            {v && meta ? (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                    fontFamily: FONT.mono,
                    fontSize: "clamp(26px, 3.4vw, 34px)",
                    fontWeight: 500,
                    letterSpacing: "-0.01em",
                    lineHeight: 1.15,
                    color: C.text,
                  }}
                >
                  {meta.name}
                  <Badge color={meta.color}>{meta.tag}</Badge>
                </div>
                <p style={{ ...plain, margin: "10px 0 0", maxWidth: "64ch", fontSize: 13.5, color: C.text }}>
                  {meta.meaning}
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                  {AXES.map((a) => {
                    const x = mean7(a.key);
                    return (
                      <Badge key={a.key} color={stateTone(a.axis, x)} bg={Math.abs(x ?? 0) < 15 ? C.panelAlt : undefined}>
                        {a.question} <span style={{ fontWeight: 400, color: C.textFaint }}>{stateWord(a.axis, x)}</span>
                      </Badge>
                    );
                  })}
                  <Badge color={C.textDim} bg={C.panelAlt}>
                    Signal strength <span style={{ fontWeight: 400, color: C.textFaint }}>{STRENGTH_WORD[v.strength]}</span>
                  </Badge>
                </div>
                <p style={{ ...plain, margin: "12px 0 0", maxWidth: "64ch" }}>
                  {since} A {STRENGTH_WORD[v.strength]} signal means {STRENGTH_NOTE[v.strength]}.
                </p>
                <p style={{ margin: "6px 0 0", fontFamily: FONT.mono, fontSize: 11, color: C.textFaint }}>
                  Overall score {signed(at("composite"))} on a −100 to +100 scale, higher meaning better expected returns ·
                  a month ago {signed(at("composite", 30))} · past-year range{" "}
                  {comps.length ? `${signed(Math.min(...comps))} to ${signed(Math.max(...comps))}` : "—"}
                </p>
              </>
            ) : (
              <p style={{ margin: 0, color: C.textDim }}>Not enough history to name a regime yet.</p>
            )}
          </div>
          <div className="spot-block">
            <div style={labelStyle}>Bitcoin price</div>
            <div
              style={{
                fontFamily: FONT.mono,
                fontSize: "clamp(26px, 3.4vw, 34px)",
                fontWeight: 500,
                letterSpacing: "-0.02em",
                lineHeight: 1.15,
                color: C.text,
              }}
            >
              {fmtUsd(price)}
            </div>
            <div style={{ fontFamily: FONT.mono, fontSize: 12, color: C.textDim, marginTop: 4 }}>
              {(
                [
                  [delta(7), "7d", "change over the past 7 days"],
                  [delta(30), "30d", "change over the past 30 days"],
                  [delta(90), "90d", "change over the past 90 days"],
                ] as [number | null, string, string][]
              ).map(([d, name, tip], i) => (
                <span key={name} title={tip}>
                  {i > 0 && " · "}
                  {d == null ? (
                    "—"
                  ) : (
                    <b style={{ color: dirColor(d) }}>
                      {glyph(d)} {pct(d)}
                    </b>
                  )}{" "}
                  <span style={{ color: C.textFaint }}>{name}</span>
                </span>
              ))}
            </div>
            <div style={{ marginTop: 8 }} title="Price over the past 90 days; the last week in blue">
              <Spark values={trail.slice(-90).map((r) => r.price)} w={220} h={44} hi={7} />
            </div>
          </div>
        </div>
      </Panel>

      {/* ── The three gauges ── */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, flexWrap: "wrap", margin: "4px 2px 10px" }}>
          <span style={labelStyle}>The three gauges</span>
          <span style={{ ...plain, fontSize: 11.5, color: C.textFaint }}>
            Each runs from −100 to +100 against Bitcoin's own history; 0 is its long-run middle. The white tick is where the
            gauge stood a month ago.
          </span>
        </div>
        <div className="axes-grid">
          {AXES.map((a) => {
            const x = l[a.key];
            const g = at(a.key, 30);
            const m = mean7(a.key);
            const tone = stateTone(a.axis, x);
            return (
              <Panel key={a.key} title={a.question}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <span style={{ fontFamily: FONT.mono, fontSize: 28, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1.1, color: C.text }}>
                    {signed(x)}
                  </span>
                  <Badge color={tone} bg={Math.abs(x ?? 0) < 15 ? C.panelAlt : undefined}>
                    {stateWord(a.axis, x)}
                  </Badge>
                </div>
                <div style={{ marginTop: 10 }}>
                  <AxisBar value={x} ghost={g} color={tone} left={a.left} right={a.right} />
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                    marginTop: 10,
                    fontFamily: FONT.mono,
                    fontSize: 11,
                    color: C.textFaint,
                  }}
                >
                  <span>
                    7-day average {signed(m)} · a month ago {signed(g)} ({stateWord(a.axis, g)})
                  </span>
                  <span title="The past 90 days; the last 30 in blue">
                    <Spark values={trail.slice(-90).map((r) => r[a.key])} w={110} h={26} zero hi={30} />
                  </span>
                </div>
                <div style={{ ...plain, fontSize: 11, color: C.textFaint, marginTop: 8, cursor: "help" }} title={a.tip}>
                  Built from {a.parts}. Hover for definitions.
                </div>
              </Panel>
            );
          })}
        </div>
      </div>

      {/* ── Map, cycle tiles, ribbon ── */}
      <Panel
        title="Where today sits"
        subtitle="Each dot is one day and the bright dot is today. Left is cheap, right is expensive; lower is light leverage, higher is crowded. The grey cross is the dead zone: inside it the regime does not change."
        right={
          <div className="seg" role="group" aria-label="Trail length">
            {([90, 365] as const).map((d) => (
              <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>
                {d === 90 ? "90 days" : "1 year"}
              </button>
            ))}
          </div>
        }
      >
        <div className="map-grid">
          <RegimeMap trail={trail} days={days} band={v?.rules.band ?? 10} />
          <div className="cycle-grid">
            <MiniStat
              label="Price vs cost basis"
              value={pct((l.realized_ratio ?? 1) - 1)}
              sub={`above the average price coins last moved at (${fmtUsd(l.realized_price)}) · a month ago ${pct(cyc30?.realized_ratio == null ? null : cyc30.realized_ratio - 1)}`}
              spark={<Spark values={cyc.map((r) => (r.realized_ratio == null ? null : r.realized_ratio - 1))} w={96} h={24} zero />}
            />
            <MiniStat
              label="MVRV Z-score"
              value={fmtNum(l.mvrv_z)}
              sub={`distance from that cost basis, in standard deviations · ${fmtNum(l.mvrv_pct, 0)}th percentile of history`}
              spark={<Spark values={cyc.map((r) => r.mvrv_z)} w={96} h={24} />}
            />
            <MiniStat
              label="Below the all-time high"
              value={pctPlain(l.drawdown)}
              sub={`week ${fmtNum(l.weeks_from_ath, 0)} since the peak · deepest this year ${pctPlain(drawdowns.length ? Math.min(...drawdowns) : null)}`}
              spark={<Spark values={cyc.map((r) => r.drawdown)} w={96} h={24} />}
            />
            <MiniStat
              label="Price vs 200-day average"
              value={fmtNum(l.mayer)}
              sub={`the Mayer multiple · a month ago ${fmtNum(cyc30?.mayer)}`}
              spark={<Spark values={cyc.map((r) => r.mayer)} w={96} h={24} />}
            />
            <MiniStat
              label="Miner revenue vs its yearly average"
              value={fmtNum(l.puell)}
              sub="the Puell multiple · above 1 means miners earn more than usual"
              spark={<Spark values={cyc.map((r) => r.puell)} w={96} h={24} />}
            />
            {band && (
              <MiniStat
                label="Where a cycle low might land"
                value={`${kUsd(band.priceLow)}–${kUsd(band.priceHigh)}`}
                sub={`${pctPlain(band.projectedDiscount)} below the cost basis · fitted on the ${data.cycleLows.length} prior bear-market lows`}
                color={C.warn}
              />
            )}
          </div>
        </div>
        <Ribbon trail={trail} />
      </Panel>

      {/* ── Fine print, closed by default ── */}
      <div style={{ display: "grid", gap: 8 }}>
        <Disclosure summary="New here? How to read this page">
          <ul>
            <li>
              <b>Today's regime</b> names one of four market regimes from two gauges: whether Bitcoin is cheap or
              expensive against its own history, and whether the market is crowded with leverage. Accumulation zone is
              cheap and calm; falling knife is cheap but crowded; healthy trend is expensive but calm; danger zone is
              expensive and crowded.
            </li>
            <li>
              <b>Every gauge runs from −100 to +100.</b> Zero is Bitcoin's own long-run middle; the ends are the most
              extreme readings in its history. Green means the reading is supportive for future returns, red means it
              is adverse, grey means close to neutral.
            </li>
            <li>
              <b>The regime does not flip on one noisy day.</b> It only changes when a gauge's 7-day average moves
              clearly past neutral. Signal strength says how far from neutral the gauges are: a weak signal is a close
              call.
            </li>
            <li>
              <b>Macro liquidity is the third gauge.</b> It does not set the regime; it says whether the wider financial
              backdrop, money supply, credit, the dollar and real interest rates, is helping or hurting.
            </li>
            <li>
              Everything is recomputed each morning from free public sources, listed at the foot of the page. Nothing
              here is investment advice.
            </li>
          </ul>
        </Disclosure>

        <Disclosure summary="How the gauges are built">
          <ul>
            <li>
              <b>Cheap or expensive</b> = MVRV Z-score (double weight), Mayer multiple, gold/BTC strength (inverted).
              Each is an expanding percentile of Bitcoin's own history, mapped to −100…+100. Negative reads cheap.
            </li>
            <li>
              <b>Crowded with leverage</b> = open-interest heat over the current rally leg (percentage change in
              coin-denominated open interest divided by the percentage change in price), open interest divided by
              market cap, and the funding rate on a fixed ten-year scale (neutral up to 0.01% per 8 hours, warning
              above 0.02, hot above 0.04, extreme above 0.08; negative funding mildly supportive), taken as a 7-day
              mean of the rate weighted across venues by the smaller of each venue's open-interest and volume share.
              Positive reads crowded.
            </li>
            <li>
              <b>Macro liquidity</b> = net liquidity 90-day change, high-yield credit spreads, the broad dollar, the
              10-year real yield, stablecoin float growth. All but net liquidity enter inverted; positive reads tailwind.
            </li>
            <li>
              <b>The regime</b> = the signs of the {v?.rules.smoothDays ?? 7}-day means of the first two gauges, where a
              sign only changes when its mean moves beyond ±{v?.rules.band ?? 10}, the dead zone shaded on the map. Raw
              daily signs flipped 71 times in the year to Sep 2026; this rule changed 7 times. <b>Signal strength</b>{" "}
              is the smaller of the two means' distances from neutral: weak under 15, moderate under 50, strong beyond.
            </li>
            <li>
              Nasdaq/BTC strength and the sUSDe yield curve are tracked on their own tabs but excluded from every
              score: neither validated on 2018+ data (see the evidence below).
            </li>
            <li>
              The cycle-low zone fits the shrinking discount to the cost basis at each prior bear-market low
              ({data.cycleLows.map((c) => `${pctPlain(c.discount, 0)} in ${c.date.slice(0, 4)}`).join(", ")}) and
              extrapolates one cycle forward, with a 2σ interval. A zone of interest, not a forecast.
            </li>
          </ul>
        </Disclosure>

        <Disclosure summary="Does it work? Backtest evidence, 2018 onward">
          <Evidence tails={tails} caveat={caveat} leverage={leverage} term={term} />
        </Disclosure>

        <Disclosure summary="Track record · what this page said, and what happened next">
          <TrackRecord verdicts={verdicts} />
        </Disclosure>
      </div>
    </>
  );
}

// ── regime ribbon ───────────────────────────────────────────────────────────

function Ribbon({ trail }: { trail: TrailRow[] }) {
  const rows = trail.slice(-365);
  const n = rows.length;
  const runs: { q: QuadrantKey; start: number; end: number }[] = [];
  rows.forEach((r, i) => {
    if (!r.quadrant) return;
    const last = runs[runs.length - 1];
    if (last && last.q === r.quadrant && last.end === i - 1) last.end = i;
    else runs.push({ q: r.quadrant, start: i, end: i });
  });
  const labelled = runs.filter((r) => r.end - r.start + 1 >= 21);
  return (
    <div style={{ ...hairlineTop, marginTop: 20, paddingTop: 16 }}>
      <div style={labelStyle}>The regime, day by day, over the past {n} days</div>
      <svg
        viewBox={`0 0 ${n} 22`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: 22, display: "block", marginTop: 8 }}
        aria-hidden="true"
      >
        {rows.map((r, i) =>
          r.quadrant ? (
            <rect key={r.date} x={i} y={0} width={1} height={22} fill={QUADRANT_META[r.quadrant].color} opacity={0.7} />
          ) : null
        )}
        <rect x={n - 1} y={0} width={1} height={22} fill={C.text} />
      </svg>
      <div style={{ position: "relative", height: 34, fontFamily: FONT.mono, fontSize: 10, color: C.textFaint }}>
        {labelled.map((r, k) => {
          const frac = r.start / n;
          const late = frac > 0.7;
          return (
            <span
              key={r.start}
              style={{
                position: "absolute",
                top: (k % 2) * 16,
                whiteSpace: "nowrap",
                lineHeight: 1.1,
                ...(late
                  ? { right: `${(1 - frac) * 100}%`, borderRight: `1px solid ${C.borderBright}`, paddingRight: 4 }
                  : { left: `${frac * 100}%`, borderLeft: `1px solid ${C.borderBright}`, paddingLeft: 4 }),
              }}
            >
              <b style={{ color: C.textDim, fontWeight: 500 }}>{QUADRANT_META[r.q].name}</b> · from {dmy(rows[r.start].date)}
            </span>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, marginTop: 4 }}>
        {(Object.keys(QUADRANT_META) as QuadrantKey[]).map((k) => (
          <span key={k}>
            <i
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: 2,
                marginRight: 5,
                verticalAlign: -1,
                background: QUADRANT_META[k].color,
                opacity: 0.8,
              }}
            />
            {QUADRANT_META[k].name} <span style={{ color: C.textFaint }}>({QUADRANT_META[k].tag})</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── tables ──────────────────────────────────────────────────────────────────

const th: CSSProperties = {
  fontFamily: FONT.ui,
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: C.textFaint,
  textAlign: "left",
  padding: "0 10px 6px",
  borderBottom: `1px solid ${C.border}`,
};
const thN: CSSProperties = { ...th, textAlign: "right" };
const td: CSSProperties = { padding: "7px 10px", borderBottom: `1px solid ${C.border}`, color: C.textDim };
const tdN: CSSProperties = { ...td, textAlign: "right", color: C.text };

function Table({ children }: { children: ReactNode }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: FONT.mono, fontSize: 12 }}>{children}</table>
    </div>
  );
}

const Pct = ({ v }: { v: number | null }) => <span style={{ color: pnl(v) }}>{pct(v)}</span>;

function Evidence({
  tails,
  caveat,
  leverage,
  term,
}: {
  tails: TailRow[];
  caveat: string;
  leverage: LeverageResponse | null;
  term: TermStructureResponse | null;
}) {
  const rows = tails.filter((t) => t.pctile === 5).sort((a, b) => (b.med_fwd_180d ?? 0) - (a.med_fwd_180d ?? 0));
  const t2 = leverage?.thresholds?.find((t) => t.threshold === 2);
  const t3 = leverage?.thresholds?.find((t) => t.threshold === 3);
  const contango = term?.regimeStats.find((r) => r.regime === "CONTANGO");
  const steepBack = term?.regimeStats.find((r) => r.regime === "STEEP_BACKWARDATION");
  return (
    <>
      <p>
        What Bitcoin did in the 30, 90 and 180 days after each signal's most extreme 5% of readings, 2018 onward
        (median). Bottom signals are expected to be followed by gains; overheat signals by losses.
      </p>
      <Table>
        <thead>
          <tr>
            <th style={th}>Signal</th>
            <th style={th}>Tail</th>
            <th style={thN}>Days</th>
            <th style={thN}>30d</th>
            <th style={thN}>90d</th>
            <th style={thN}>180d</th>
            <th style={thN}>Hit 90d</th>
            <th style={th}>Verdict</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const wantNeg = OVERHEAT.has(t.signal) && t.tail === "top";
            const ok = wantNeg
              ? (t.med_fwd_30d ?? 0) < 0 && (t.med_fwd_90d ?? 0) < 0
              : (t.med_fwd_90d ?? 0) > 0 && (t.med_fwd_180d ?? 0) > 0;
            return (
              <tr key={`${t.signal}-${t.tail}`}>
                <td style={{ ...td, color: C.text }}>{LABELS[t.signal] ?? t.signal}</td>
                <td style={td}>{t.tail === "top" ? "top" : "bottom"} 5%</td>
                <td style={tdN}>{t.n}</td>
                <td style={tdN}><Pct v={t.med_fwd_30d} /></td>
                <td style={tdN}><Pct v={t.med_fwd_90d} /></td>
                <td style={tdN}><Pct v={t.med_fwd_180d} /></td>
                <td style={tdN}>{t.hit_rate_90d == null ? "—" : `${Math.round(t.hit_rate_90d * 100)}%`}</td>
                <td style={td}>
                  <Badge color={ok ? C.good : C.bad}>{ok ? "as expected" : "failed"}</Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {t2 && t3 && (
        <p style={{ marginTop: 12 }}>
          <b>Open-interest heat thresholds</b> (median forward return above vs below the line): 2× or more →{" "}
          <Pct v={t2.aboveMed30d} /> at 30d and <Pct v={t2.aboveMed90d} /> at 90d, against <Pct v={t2.belowMed30d} /> /{" "}
          <Pct v={t2.belowMed90d} /> below 2×; 3× or more → <Pct v={t3.aboveMed30d} /> / <Pct v={t3.aboveMed90d} /> (n=
          {t3.n} days).
        </p>
      )}
      <p style={{ color: C.textFaint, marginTop: 8 }}>
        {caveat} The MVRV bottom-5% result is essentially two episodes, March 2020 and November 2022.
      </p>
      {contango && steepBack && (
        <p style={{ color: C.textFaint }}>
          sUSDe yield curve: contango preceded <Pct v={contango.med_fwd_90d} /> at 90d (n={contango.n},{" "}
          {Math.round((contango.hit_rate_90d ?? 0) * 100)}% hit), the opposite of the source report's claim; steep
          backwardation <Pct v={steepBack.med_fwd_90d} /> (n={steepBack.n}). Small sample, one drawdown, unproven
          either way.
        </p>
      )}
    </>
  );
}

function TrackRecord({ verdicts }: { verdicts: VerdictsResponse | null }) {
  if (!verdicts || verdicts.count === 0) {
    return <p>Logging starts with the next morning refresh; nothing recorded yet.</p>;
  }
  const { rows, count, since, latestPrice, latestDate, summary } = verdicts;
  const scored = summary.filter((s) => s.n_90d > 0);
  return (
    <>
      <p>
        Every day this page names a regime, that call is written once to a log and never rewritten, so it can be judged
        against what Bitcoin did next. {count} day{count === 1 ? "" : "s"} logged since {since}, rules version{" "}
        {rows[0]?.rules_version ?? "—"}. The return columns fill in as the windows close (30 days for the first score,
        90 for the real test); until then the last column shows the return since the call, to{" "}
        {latestDate ?? "the latest close"}.
      </p>
      {scored.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <Table>
            <thead>
              <tr>
                <th style={th}>Regime</th>
                <th style={thN}>Days</th>
                <th style={thN}>Scored</th>
                <th style={thN}>Median 30d</th>
                <th style={thN}>Median 90d</th>
                <th style={thN}>Median 180d</th>
                <th style={thN}>Hit 90d</th>
              </tr>
            </thead>
            <tbody>
              {scored.map((s) => (
                <tr key={s.quadrant}>
                  <td style={{ ...td, color: C.text }}>{QUADRANT_META[s.quadrant].name}</td>
                  <td style={tdN}>{s.n}</td>
                  <td style={tdN}>{s.n_90d}</td>
                  <td style={tdN}><Pct v={s.med_fwd_30d} /></td>
                  <td style={tdN}><Pct v={s.med_fwd_90d} /></td>
                  <td style={tdN}><Pct v={s.med_fwd_180d} /></td>
                  <td style={tdN}>{s.hit_rate_90d == null ? "—" : `${Math.round(s.hit_rate_90d * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      <Table>
        <thead>
          <tr>
            <th style={th}>As of</th>
            <th style={th}>Regime</th>
            <th style={th}>Strength</th>
            <th style={thN}>Price</th>
            <th style={thN}>30d</th>
            <th style={thN}>90d</th>
            <th style={thN}>180d</th>
            <th style={thN}>Since call</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 12).map((r) => {
            const meta = QUADRANT_META[r.quadrant];
            const sinceCall = latestPrice && r.price ? latestPrice / r.price - 1 : null;
            return (
              <tr key={r.signal_date}>
                <td style={{ ...td, color: C.text }}>{r.signal_date}</td>
                <td style={td}><Badge color={meta.color}>{meta.name}</Badge></td>
                <td style={td}>{STRENGTH_WORD[r.strength]}</td>
                <td style={tdN}>{fmtUsd(r.price)}</td>
                <td style={tdN}><Pct v={r.fwd_30d} /></td>
                <td style={tdN}><Pct v={r.fwd_90d} /></td>
                <td style={tdN}><Pct v={r.fwd_180d} /></td>
                <td style={tdN}><Pct v={sinceCall} /></td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
