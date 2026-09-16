// ─── REGIME VOCABULARY ──────────────────────────────────────────────────────
// The four quadrants as the page names and colours them. Mirrors QUADRANTS in
// server/verdict.ts, which is the authority on how a day is assigned.

import type { QuadrantKey } from "./services/api";
import { C } from "./theme";

export const QUADRANT_META: Record<QuadrantKey, { name: string; tag: string; color: string; meaning: string }> = {
  acc: {
    name: "Accumulation zone",
    tag: "cheap · light leverage",
    color: C.good,
    meaning:
      "Bitcoin is on the cheap side of its own history and the market is not crowded with leverage. Historically the kind of stretch that has rewarded patient buyers.",
  },
  knife: {
    name: "Falling knife",
    tag: "cheap · crowded",
    color: C.warn,
    meaning:
      "Bitcoin looks cheap, but the market is still crowded with leverage. Cheap can get cheaper while over-leveraged positions are forced out.",
  },
  trend: {
    name: "Healthy trend",
    tag: "expensive · light leverage",
    color: C.info,
    meaning:
      "Bitcoin is on the expensive side, but the move is not being carried by leverage. The healthier kind of uptrend.",
  },
  danger: {
    name: "Danger zone",
    tag: "expensive · crowded",
    color: C.bad,
    meaning:
      "Bitcoin is expensive and the market is crowded with leverage. The fragile combination that has preceded the sharp drops.",
  },
};
