/** Reward-based tablet scoring (2026-07-04), separate from stat-fit
 *  (`mechanics.ts`'s `scoreMechanicFit`). Closes a gap found while sourcing
 *  real PoE2 tablet data (see KNOWN_ISSUES.md #2): the real mechanic-specific
 *  Precursor Tablets (Breach/Expedition/Delirium/Ritual/Abyss) mostly grant
 *  mechanic-specific currency — Splinters, Artifacts, Tribute — not the six
 *  generic stats `mod-parser.ts` tracks, so their `boosts` are weak or empty
 *  and they never ranked well no matter how valuable they really are.
 *  `rewards` gives a tablet a second, independent scoring channel for that
 *  value, without touching `StatKey`/`mod-parser.ts`/`scoring.ts` at all. */

export type Reward =
  | { type: "currency"; id: string; weight: number }
  | { type: "mechanic"; id: string; value: number }
  | { type: "generic"; score: number };

// Simple, transparent multiplier: a currency reward's contribution is just
// its weight scaled by one constant — tune this single number to rebalance
// every currency reward at once, instead of editing every tablet.
const CURRENCY_WEIGHT_UNIT = 3;

/** How valuable each mechanic's own reward pool generally is, independent
 *  of any one tablet — a single source of truth so two tablets citing the
 *  same mechanic don't drift out of sync. Extend freely; a mechanic id not
 *  listed here falls back to that reward's own `value` (never crashes,
 *  never silently drops the reward).
 *
 *  Only the mechanics with a real PoE2 tablet (see tablets.ts, verified
 *  2026-07-04 against poe2wiki.net/maxroll.gg/odealo.com for the six
 *  Precursor-Tower types, and separately against poe2db.tw for Abyss/
 *  Irradiated/Temple Tablets, checked 2026-07-06) are listed — relative
 *  order reflects general community consensus on chase-value (Delirium/
 *  Expedition currency is usually rated above Breach/Abyss, Ritual's
 *  Tribute the least universally chased; Irradiated/Temple have no
 *  confirmed dedicated currency so sit at a cautious mid/low value), not a
 *  sourced economic model; see KNOWN_ISSUES.md #3 for the same caveat on
 *  the rest of this app's scoring.
 *
 *  Spread widened slightly (2026-07-04, later same day) so
 *  Delirium/Expedition read as clearly favored and Ritual as clearly
 *  behind, rather than all four sitting within 2 points of each other —
 *  same single lever, no second weighting table layered on top of it (see
 *  `rewardContribution`'s doc comment for why). */
// Expedition deliberately demoted from 9 to 5 (2026-07-06, user choice):
// it's now a *secondary* mechanic (see adapter.ts's PRIMARY_MECHANIC_TAGS)
// — its previously second-highest reward value made its tablet crowd the
// top of the list regardless of the waystone's actual profile.
export const MECHANIC_VALUES: Record<string, number> = {
  delirium: 10,
  breach: 7,
  abyss: 7,
  irradiated: 6,
  expedition: 5,
  ritual: 5,
  temple: 5,
};

const DEFAULT_MECHANIC_VALUE = 5;

/** Deliberately a single lever, not two: a request to also multiply this by
 *  a second table keyed on `reward.type` (`"currency"`/`"mechanic"`/
 *  `"generic"`) was considered and rejected — those three are the reward's
 *  *shape*, not which mechanic it's for (that's `reward.id`, already routed
 *  through `MECHANIC_VALUES` below), so such a table could never
 *  distinguish Breach from Ritual in the first place, and a second
 *  mechanic-value table would just drift out of sync with this one (the
 *  exact failure mode `MECHANIC_VALUES`'s own doc comment exists to avoid).
 *  If the relative weighting needs to shift, tune `MECHANIC_VALUES` or
 *  `CURRENCY_WEIGHT_UNIT` above — not a new table. */
function rewardContribution(reward: Reward): number {
  switch (reward.type) {
    case "currency":
      return reward.weight * CURRENCY_WEIGHT_UNIT;
    case "mechanic":
      // The shared table wins when it knows the mechanic (keeps every
      // tablet citing "delirium" in sync); an id it doesn't list yet falls
      // back to this reward's own value, then a flat default.
      return MECHANIC_VALUES[reward.id] ?? reward.value ?? DEFAULT_MECHANIC_VALUE;
    case "generic":
      return reward.score;
    default:
      return 0; // unrecognized shape (e.g. a stale/hand-edited meta.json) — never crash
  }
}

/** Sums every reward's contribution. `undefined`/`[]` → 0, so a tablet with
 *  no `rewards` scores exactly as it did before this feature existed.
 *  Never throws: a malformed entry contributes 0 instead of crashing the
 *  whole tablet-ranking pass. */
export function computeRewardScore(rewards: Reward[] | undefined): number {
  if (!rewards || rewards.length === 0) return 0;
  let score = 0;
  for (const reward of rewards) {
    try {
      score += rewardContribution(reward);
    } catch {
      // malformed entry — skip, don't let one bad reward sink the tablet
    }
  }
  return score;
}

function rewardLabel(reward: Reward): string {
  const raw = reward.type === "generic" ? "Bonus" : reward.id;
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** UI-facing view of a single reward: a display label and the same
 *  contribution number `computeRewardScore` would add for it — so a
 *  breakdown of these always sums to the tablet's `rewardScore`, never a
 *  second, drifting formula. */
export function describeReward(reward: Reward): { label: string; value: number } {
  return { label: rewardLabel(reward), value: rewardContribution(reward) };
}
