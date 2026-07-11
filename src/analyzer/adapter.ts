/** Adapter: raw PoE2 clipboard text → the shipped `AnalysisResult` contract
 *  (docs/overlay-ui-spec.md §11, cahier des charges §5/§9). This is the
 *  ONLY place tierClass/verdict/mechanic scores get computed — the UI
 *  never thresholds `score` itself. */

import { NotAWaystoneError, parseWaystone } from "./parser";
import { parseUnified } from "./unified-parser";
import {
  classifyModifierKind,
  computeDangerLevel,
  dangerHitsToWarnings,
  detectDangerHits,
  evaluateMap,
  CAPS,
  DEFAULT_THRESHOLD,
  STAT_REFERENCES,
  DANGER_SEVERITY_ORDER,
  type DangerHit,
  type DangerLevel,
  type DangerSeverity,
  type FieldContribution,
  type Weights,
} from "./scoring";
import { buildDisplayData, formatPercent } from "./displayAdapter";
import { getActiveMechanics, scoreMechanicFitRaw, priorityStatTier, type MechanicDef, type StatTier } from "./mechanics";
import { getActiveTablets, type TabletDef } from "./tablets";
import { describeReward } from "./rewards";
import type { AnalysisResult, DangerHitView, MechanicScore, Modifier, Rating, TabletVerdict, TierClass, Verdict } from "../types";
import type { ModStats } from "./mod-parser";

// Juiciness levels (§6): score → tierClass (internal id) band.
const TIER_BANDS: { max: number; tierClass: TierClass }[] = [
  { max: 20, tierClass: "trash" }, // Faible
  { max: 40, tierClass: "low" }, // Moyen
  { max: 60, tierClass: "good" }, // Bon
  { max: 80, tierClass: "splus" }, // Excellent
  { max: Infinity, tierClass: "god" }, // Legendaire
];

const TIER_LABELS: Record<TierClass, string> = {
  trash: "Weak",
  low: "Average",
  good: "Good",
  splus: "Excellent",
  god: "Legendary",
};

// dangerLevel → user-facing label. Purely a display mapping over a signal
// already fully independent of score/tierClass (computeDangerLevel derives
// it from `warnings` alone) — see scoring.ts's file-level comment. Exported
// for mock.ts's dev fixtures, so the preview data stays derived the same
// way the real adapter derives it.
export const DANGER_LABELS: Record<DangerLevel, string> = {
  none: "Safe",
  low: "Manageable",
  medium: "Dangerous",
  high: "Very Dangerous",
};

// scoring.ts's internal severity vocabulary (reflect/strong/moderate/minor,
// what computeDangerLevel reasons over) collapsed to the UI's 3-tier scale
// (DangerList.ts's grouping). This mapping is a display concern only — it
// must never move into scoring.ts, and must never feed back into
// computeDangerLevel/dangerLevel. KEEP EXACTLY: reflect + strong -> "high"
// (both are the "actively hurts you" tier), moderate -> "medium",
// minor -> "low".
const UI_SEVERITY: Record<DangerSeverity, DangerHitView["severity"]> = {
  reflect: "high",
  strong: "high",
  moderate: "medium",
  minor: "low",
};

// dangerHits → UI-ready view. Boundary-layer concern (belongs here, not in
// scoring.ts): sorts by the same domain order `dangerHitsToWarnings` uses
// (reusing DANGER_SEVERITY_ORDER rather than re-deriving it, so the two can
// never drift), then resolves labels via `dangerHitsToWarnings` itself on
// the already-sorted hits — a no-op re-sort — so `dangerHits[i].label` is
// always exactly `warnings[i]`. Exported for mock.ts's dev fixtures, same
// reason as DANGER_LABELS above.
export function describeDangerHits(hits: DangerHit[]): DangerHitView[] {
  const sorted = [...hits].sort((a, b) => DANGER_SEVERITY_ORDER[a.severity] - DANGER_SEVERITY_ORDER[b.severity]);
  const labels = dangerHitsToWarnings(sorted);
  return sorted.map((h, i) => ({ id: h.id, label: labels[i], severity: UI_SEVERITY[h.severity] }));
}

/** Mechanics with a real, tablet-linked story in PoE2 (tablets.ts, verified
 *  2026-07-04 against poe2wiki.net/maxroll.gg/odealo.com + poe2db.tw,
 *  extended 2026-07-06 with Irradiated/Temple) — the only mechanics allowed
 *  to become `recommendedMechanic` (see below). As of 2026-07-10 this is
 *  also every mechanic `mechanics.ts` still tracks (Blight/Heist/Sanctum/
 *  Legion/Harvest/Metamorph/Essence/Incursion/Bestiary were removed — no
 *  real tablet, dead weight), so the filter below is now a no-op safety
 *  net rather than an active exclusion — kept for whenever a mechanic
 *  without a tablet gets added back. Exported for verify-adapter.mjs's
 *  regression assertion, not just used internally here. */
export const TABLET_LINKED_MECHANICS = new Set([
  "Breach",
  "Ritual",
  "Delirium",
  "Expedition",
  "Abyss",
  "General",
  "Irradiated",
  "Temple",
]);

function classifyTier(score: number): TierClass {
  for (const band of TIER_BANDS) {
    if (score < band.max) return band.tierClass;
  }
  return "god"; // unreachable (last band is Infinity), for TS exhaustiveness
}

// Same 0-100 boundaries as TIER_BANDS, expressed as letters — a simpler,
// more universally-read scale than tierClass for any 0-100 score, not just
// the Juice Score (also used for tablet fit below). Supplementary display
// only: tierClass/tierLabel/verdict remain the source of truth.
function scoreToRating(score: number): Rating {
  if (score >= 80) return "S";
  if (score >= 60) return "A";
  if (score >= 40) return "B";
  if (score >= 20) return "C";
  return "D";
}

/** §9 verdict logic: Skip / Run / Garder — purely a function of the Juice
 *  Score (loot potential) and tier. Danger/annoyance mods never factor in
 *  here; they only ever surface via `warning`/`warnings`. Tier is used as
 *  the "high tier" signal for Keep — waystones tier III+ worth keeping
 *  for a good tablet rather than running immediately. */
function classifyVerdict(score: number, tier: number): Verdict {
  if (score < DEFAULT_THRESHOLD) return "SKIP";
  if (score >= 50 && tier >= 3) return "KEEP";
  return "RUN";
}

// 2026-07-10 (user request, revised same day): the tablet row no longer
// shows its raw fit number/bar — a 3-tier "Run/Why not/Don't run" verdict
// reads faster at a glance, mirroring the SKIP/RUN/KEEP vocabulary
// already used for the waystone-level verdict above. Originally bucketed
// on the numeric `fit` (30/55 thresholds); revised the same day to read
// straight off the tablet's own mechanic's `priorityStatTier` instead —
// the same 4-tier read (weak/ok/top/legendary) the Mechanic Match Score
// now uses, collapsed to 3: weak -> dont-run, ok -> why-not, top and
// legendary both -> run (the top/legendary distinction still shows up in
// the numeric fit on hover, just not as a separate row-level verdict).
function tabletVerdict(tier: StatTier): TabletVerdict {
  if (tier === "weak") return "dont-run";
  if (tier === "ok") return "why-not";
  return "run"; // top or legendary
}

const FIELD_LABELS: Record<keyof Weights, string> = {
  itemRarity: "Item Rarity",
  monsterRarity: "Monster Rarity",
  packSize: "Pack Size",
  monsterEffectiveness: "Monster Effectiveness",
  waystoneDropChance: "Waystone Drop Chance",
};

// UX fix (2026-07-06): each stat row shows the REAL parsed value (e.g. "+39%
// Item Rarity") instead of a weighted point delta a player can't cross-check
// against the item — see displayAdapter.ts's file-level comment. `max` is
// the stat's own cap (not a flat constant), so the UI's bar width stays
// meaningful across stats with very different natural scales.
function buildBreakdown(
  fields: Record<keyof Weights, FieldContribution>,
  bonusTotal: number,
): AnalysisResult["heat"]["breakdown"] {
  const rows: AnalysisResult["heat"]["breakdown"] = (Object.keys(fields) as (keyof Weights)[]).map((key) => ({
    key,
    label: FIELD_LABELS[key],
    value: fields[key].rawValue,
    display: formatPercent(fields[key].rawValue),
    max: CAPS[key],
  }));
  // The "bonus" row (extra-content detection, e.g. "ritual present") isn't a
  // %-based stat, so it keeps the old point-delta rendering (no `display`).
  if (bonusTotal > 0) rows.push({ key: "bonus", label: "Bonus", value: Math.round(bonusTotal * 10) / 10 });
  return rows;
}

function buildModifiers(rawLines: string[]): Modifier[] {
  return rawLines.map((text) => ({ text, kind: classifyModifierKind(text) }));
}

function buildInsights(bonusReasons: { reason: string; bonus: number }[]): string[] {
  return bonusReasons.slice(0, 3).map((b) => `Bonus: ${b.reason} (+${b.bonus})`);
}

/** Quick-scan "why this waystone" summary — derived entirely from numbers
 *  already computed above (breakdown contributions, mechanic score, top
 *  tablet's reward score), never new analysis. 0-4 lines; empty when
 *  nothing clears the bar, so the overlay just hides the row. */
function buildKeyFactors(
  breakdown: Record<keyof Weights, FieldContribution>,
  recommendedMechanic: string | null,
  bestMechanicScore: number,
  topTablet: { tablet: TabletDef; fit: number } | undefined,
): string[] {
  const factors: string[] = [];

  const topFields = (Object.keys(breakdown) as (keyof Weights)[])
    .map((key) => ({ key, contribution: breakdown[key].contribution }))
    .filter((f) => f.contribution >= 8) // below this, not a "key" factor, just noise
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 2);
  for (const f of topFields) factors.push(`High ${FIELD_LABELS[f.key]}`);

  if (recommendedMechanic && bestMechanicScore >= 50) {
    factors.push(`Strong ${recommendedMechanic} match`);
  }

  if (topTablet && topTablet.tablet.rewardScore > 0) {
    const topReward = topTablet.tablet.rewards?.[0];
    factors.push(topReward ? `${describeReward(topReward).label} rewards` : `${topTablet.tablet.name} rewards`);
  }

  return factors.slice(0, 4);
}

// Sourced from Fubgun's 0.5 strats (pasted into this session 2026-07-10):
// "8 Mod waystones seem to be the best for loot" (8 = the practical
// ceiling/target) and "cheapest option is to make your own ... waystones
// with 6 modifiers and corrupt after" (6 = a real, still-viable-but-not-
// optimal alternative). Only two sourced data points, no full curve — a
// straight linear ramp from 0 to the 8-mod ceiling is the honest fit,
// not more shape than the data supports. Applies uniformly to every
// mechanic (no sourced reason to think mod count matters differently per
// mechanic) — unlike the removed flat detect bonus (+15, KNOWN_ISSUES),
// this is small (max +8, matching EXTRA_CONTENT_BONUS's own upper range)
// and grounded in an actual quote rather than an arbitrary round number.
const MOD_COUNT_BONUS_WEIGHT = 8;
const MOD_COUNT_REFERENCE = 8;
// Exported for verify-adapter.mjs — lets tests compute the exact expected
// delta a mod-count change should produce, rather than re-deriving the
// formula by hand in the test file.
export function modCountBonus(modCount: number): number {
  return Math.max(0, Math.min(1, modCount / MOD_COUNT_REFERENCE)) * MOD_COUNT_BONUS_WEIGHT;
}

/** §7: cross the waystone's own stat profile against each mechanic's
 *  priority/secondary stats (via `scoreMechanicFitRaw`, shared with tablet
 *  ranking below), plus a small mod-count bonus (`modCountBonus`, sourced,
 *  uniform across mechanics). Returns scores for all mechanics, desc
 *  sorted.
 *
 *  Otherwise purely stat-fit based — "which mechanic do THESE STATS suit"
 *  — no presence-detection bonus mixed in. §8/§9's "mecanique naturelle"
 *  bonus used to live here too (a flat +15 for any mechanic whose keyword
 *  appeared in the text), but it was a single uniform number applied to
 *  16 of 17 mechanics, disconnected from the real Juice Score's own
 *  differentiated, sourced table for the same idea (`EXTRA_CONTENT_BONUS`
 *  in mechanic-patterns.ts: Ritual/Breach +10, Delirium/Expedition +8, the
 *  other 12 get nothing) — and it was large enough to make Delirium (whose
 *  keyword is common on real maps) cluster near 70 regardless of how well
 *  its stats actually fit (user report, 2026-07-10). Removed rather than
 *  reweighted: the "mechanic already active" signal isn't lost, it's just
 *  no longer blended into this specific metric — it still surfaces via the
 *  real Juice Score's own `Bonus: extra content: X (+N)` insight line
 *  (scoring.ts/mechanic-patterns.ts, unaffected by this change).
 *
 *  Sorted by the *unrounded* `scoreMechanicFitRaw`, not the rounded `score`
 *  each entry displays — several mechanics share the same priority stat, so
 *  sorting on the rounded value produced frequent exact ties that silently
 *  fell back to `MECHANICS`' declaration order (array position), biasing
 *  which mechanic/tablet won regardless of the waystone's actual stats. */
function computeMechanicScores(stats: ModStats, modCount: number): MechanicScore[] {
  const bonus = modCountBonus(modCount);
  const scores = getActiveMechanics().map((mech) => {
    const raw = scoreMechanicFitRaw(stats, mech, bonus);
    return { mechanic: mech.name, score: Math.round(raw), raw };
  });
  return scores.sort((a, b) => b.raw - a.raw).map(({ mechanic, score }) => ({ mechanic, score }));
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** "Why this score" decomposition for one tablet — see `Tablet.breakdown`'s
 *  doc comment for the additive contract. Just the two components that
 *  make up `fit`: how well THIS WAYSTONE suits the tablet's mechanic, and
 *  the tablet's own mechanic-specific reward (rewards.ts), if any. */
function buildTabletBreakdown(statFit: number, rewardScore: number): { label: string; value?: number }[] {
  const rows: { label: string; value?: number }[] = [{ label: "Stat fit", value: round1(statFit) }];
  if (rewardScore > 0) rows.push({ label: "Reward", value: round1(rewardScore) });
  return rows;
}

/** §9 "TABLETTE RECOMMANDEE": ranks every active tablet by how well THIS
 *  WAYSTONE's own stats fit ITS OWN mechanic — not a single mechanic shared
 *  across every tablet, and (2026-07-10 rework, user report) no longer the
 *  tablet's own small 10-25% boost roll either. A tablet's mechanic
 *  identity comes from `tablet.tags` resolved to a `TABLET_LINKED_MECHANICS`
 *  entry — Standard/Overseer Precursor (`tags: ["general"]`) resolve to
 *  "General", Breach/Ritual/Delirium/etc. resolve to their own name. Direct
 *  tag lookup, not a search for whichever of the 8 mechanics numerically
 *  scores highest — an argmax search was tried and discarded: it let e.g.
 *  Standard Precursor Tablet's Quantity+Item Rarity boosts "match"
 *  Irradiated purely by numeric coincidence, a confusing label with no real
 *  identity behind it. A tablet's declared tag is curated data (tablets.ts),
 *  not something to rediscover per analysis.
 *
 *  Reused directly from `scoreMechanicFitRaw(stats, mech, ...)` — the exact
 *  same formula and caps `computeMechanicScores` uses for the Mechanic
 *  Match Score, so there's only one "does this waystone suit this
 *  mechanic" calculation in the whole app, not two scales to keep in sync.
 *  Previously this scored the TABLET's own roll against a separate,
 *  smaller cap (`TABLET_ROLL_CAP`), with the waystone's stats only leaking
 *  in via a small capped `computeSynergyBonus` — that's why a real waystone
 *  with +62% Monster Rarity still showed a weak Abyss Tablet fit (its own
 *  roll didn't have Pack Size, the-then priority stat). Removed along with
 *  the confidence/secondary-mechanic multipliers (×0.92/×0.8) and the
 *  inert `minThresholds` scaffold — none were validated against real data,
 *  and stacking multiple unsourced multipliers on top of a now-correct
 *  base score was exactly the "hard to reason about" complaint that
 *  triggered this rework (KNOWN_ISSUES.md).
 *
 *  A mechanic's optional `recommendedTablets` pin (meta.json-editable,
 *  meta-schema.ts) still adds a flat +10 bonus for the curated tablet.
 *  `rewardScore` (rewards.ts, real mechanic-specific currency) is added on
 *  top, clamped to 0-100. Sorted by the unrounded fit (`fitRaw`), not the
 *  rounded `fit` each tablet displays — same rounding-tie problem
 *  `computeMechanicScores` has, just one level down. `fitRaw` is stripped
 *  before returning. */
function rankTablets(
  stats: ModStats,
  modCount: number,
): { tablet: TabletDef; fit: number; mechanic: string; verdict: TabletVerdict; breakdown: { label: string; value?: number }[] }[] {
  const activeMechanics = getActiveMechanics();
  const tagToMechanic = new Map(
    [...TABLET_LINKED_MECHANICS]
      .map((name): [string, MechanicDef | undefined] => [name.toLowerCase(), activeMechanics.find((m) => m.name === name)])
      .filter((entry): entry is [string, MechanicDef] => entry[1] !== undefined),
  );
  const generalDef = tagToMechanic.get("general")!; // TABLET_LINKED_MECHANICS always includes "General"
  const bonus = modCountBonus(modCount);
  return getActiveTablets()
    .map((tablet) => {
      const tag = tablet.tags?.find((t) => tagToMechanic.has(t));
      const mech = (tag && tagToMechanic.get(tag)) || generalDef;
      const pinBonus = mech.recommendedTablets?.includes(tablet.name) ? 10 : 0;
      const statFit = scoreMechanicFitRaw(stats, mech, bonus + pinBonus);
      const fitRaw = Math.max(0, Math.min(100, statFit + tablet.rewardScore));
      const fit = Math.round(fitRaw);
      const verdict = tabletVerdict(priorityStatTier(stats, mech));
      const breakdown = buildTabletBreakdown(statFit, tablet.rewardScore);
      return { tablet, fit, fitRaw, mechanic: mech.name, verdict, breakdown };
    })
    .sort((a, b) => b.fitRaw - a.fitRaw)
    .map(({ tablet, fit, mechanic, verdict, breakdown }) => ({ tablet, fit, mechanic, verdict, breakdown }));
}

function sumBoosts(boosts: TabletDef["boosts"]): number {
  return Object.values(boosts).reduce((s, v) => s + (v ?? 0), 0);
}

/** Returns null if `text` doesn't look like a Waystone item. */
export function analyzeWaystoneText(text: string): AnalysisResult | null {
  let parsed;
  try {
    parsed = parseWaystone(text);
  } catch (e) {
    if (e instanceof NotAWaystoneError) return null;
    throw e;
  }

  const stats = parseUnified(text);
  // parsed.contentText (every block except the header) — not the full raw
  // `text` — so the item's own NAME can never inflate the mechanic-density
  // term (KNOWN_ISSUES #4's score-side follow-up, 2026-07-08: a waystone
  // named "Ritual Reliquary" must not count as having Ritual present).
  const evaluation = evaluateMap(stats, parsed.contentText);
  // Tier/verdict/rating/heat.score read `effectiveScore` (reward synergy,
  // normalized 0-100, clamped — danger never reduces it; danger surfaces
  // display-only via warnings/Insights). `evaluation.breakdown` (below, in
  // `heat`) is intentionally left reading the old model — its line-items no
  // longer sum to `heat.score` as a result, which is expected given the
  // synergy/stretch math sitting on top of it.
  const tierClass = classifyTier(evaluation.effectiveScore);
  const verdict = classifyVerdict(evaluation.effectiveScore, parsed.tier);
  const warnings = dangerHitsToWarnings(evaluation.dangerHits);
  const dangerLevel = computeDangerLevel(evaluation.dangerHits);
  const display = buildDisplayData(stats, evaluation);

  const mechanicScores = computeMechanicScores(stats, parsed.modifiers.length);
  // Trust fix: only a mechanic with a real PoE2 tablet (see tablets.ts's
  // 2026-07-04 research pass, extended 2026-07-06 — Standard/Overseer are
  // the generic fallback, Breach/Ritual/Delirium/Expedition/Abyss/
  // Irradiated/Temple are the seven mechanic-specific ones) may become the
  // waystone-level `recommendedMechanic` verdict below. Since 2026-07-10,
  // that's every mechanic mechanics.ts tracks — the 9 tablet-less ones
  // were removed outright rather than scored-but-never-recommendable.
  //
  // §10 gate: a mechanic may only become `recommendedMechanic` if it
  // actually scored (> 0) AND the map's Juice Score clears that mechanic's
  // `skipIfBelow` ("below this Juice Score, this mechanic isn't worth
  // chasing"). find() walks the desc-sorted list, so this picks the best
  // fitting mechanic *worth chasing at this score*, not just the best
  // fitting one. This gate is deliberately NOT applied to the tablet list
  // below (2026-07-10) — each tablet shows its own honest best fit
  // regardless of whether the waystone as a whole clears any threshold.
  const activeMechanics = getActiveMechanics();
  const bestTabletLinked = mechanicScores.find((m) => {
    if (!TABLET_LINKED_MECHANICS.has(m.mechanic) || m.score <= 0) return false;
    const def = activeMechanics.find((d) => d.name === m.mechanic);
    return def !== undefined && evaluation.effectiveScore >= def.skipIfBelow;
  });
  const recommendedMechanic = bestTabletLinked ? bestTabletLinked.mechanic : null;

  const ranked = rankTablets(stats, parsed.modifiers.length);
  // Every active tablet, not just a top-N slice (2026-07-10, user request:
  // "je veux que toutes les tablettes soient présentées, de façon
  // permanente") — the overlay decides per-mode how many rows it has room
  // for (RelicPanel.ts: Full shows the whole list in its own scrolling
  // column, Compact keeps a top-5 cutoff, its fixed-height card has no
  // scroll budget for more).
  const tablets = ranked.map(({ tablet, fit, mechanic, verdict, breakdown }) => ({
    name: tablet.name,
    delta: Math.round((sumBoosts(tablet.boosts) / 10) * 10) / 10,
    reason: `${tablet.name} matches ${mechanic} (${fit}/100)`,
    rating: scoreToRating(fit),
    fit,
    verdict,
    mechanic,
    rewards: tablet.rewards && tablet.rewards.length > 0 ? tablet.rewards.map(describeReward) : undefined,
    breakdown,
  }));
  // Trust fix: never show a mechanic recommendation with no tablet paired to
  // it — that reads as a broken/misleading suggestion in the UI.
  const finalRecommendedMechanic = tablets.length > 0 ? recommendedMechanic : null;

  return {
    waystone: {
      tier: parsed.tier,
      name: parsed.name,
      corrupted: parsed.corrupted,
      modCount: parsed.modifiers.length,
    },
    heat: {
      score: evaluation.effectiveScore,
      tierClass,
      tierLabel: TIER_LABELS[tierClass],
      verdict,
      rating: scoreToRating(evaluation.effectiveScore),
      scoreLabel: display.score.label,
      breakdown: buildBreakdown(evaluation.breakdown, evaluation.bonusDetails.reduce((sum, b) => sum + b.bonus, 0)),
    },
    modifiers: buildModifiers(parsed.modifiers),
    tablets,
    warning: warnings[0] ?? null,
    warnings,
    dangerHits: describeDangerHits(evaluation.dangerHits),
    dangerLevel,
    dangerLabel: DANGER_LABELS[dangerLevel],
    insights: buildInsights(evaluation.bonusDetails),
    mechanicScores,
    recommendedMechanic: finalRecommendedMechanic,
    keyFactors: buildKeyFactors(evaluation.breakdown, finalRecommendedMechanic, bestTabletLinked?.score ?? 0, ranked[0]),
  };
}

export { DEFAULT_THRESHOLD, STAT_REFERENCES };
// Re-exported for verify-adapter.mjs's unit-level danger-logic tests only —
// not used by the overlay UI (which only ever sees the AnalysisResult
// contract fields: warning/warnings/dangerLevel/dangerLabel).
export { computeDangerLevel, dangerHitsToWarnings, detectDangerHits };
// Re-exported for verify-adapter.mjs's meta-merge end-to-end check only —
// lets the script activate a merged mechanic table inside THIS bundle's
// module instance (the separate meta-schema bundle has its own copy of
// MECHANICS, so its setActive* wouldn't affect analyzeWaystoneText here).
export { setActiveMechanics, MECHANICS, TIER_SCORE, priorityStatTier } from "./mechanics";
