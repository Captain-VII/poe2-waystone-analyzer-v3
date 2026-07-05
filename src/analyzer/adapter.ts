/** Adapter: raw PoE2 clipboard text → the shipped `AnalysisResult` contract
 *  (docs/overlay-ui-spec.md §11, cahier des charges §5/§9). This is the
 *  ONLY place tierClass/verdict/mechanic scores get computed — the UI
 *  never thresholds `score` itself. */

import { NotAWaystoneError, parseWaystone } from "./parser";
import { parseUnified } from "./unified-parser";
import {
  classifyModifierKind,
  evaluateMap,
  DEFAULT_THRESHOLD,
  type FieldContribution,
  type Weights,
} from "./scoring";
import { getActiveMechanics, scoreMechanicFit, NORMALIZE_CAP, type MechanicDef, type StatKey } from "./mechanics";
import { getActiveTablets, getConfidenceMultiplier, type TabletDef } from "./tablets";
import { describeReward } from "./rewards";
import type { AnalysisResult, MechanicScore, Modifier, Rating, TierClass, Verdict } from "../types";
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
  trash: "Faible",
  low: "Moyen",
  good: "Bon",
  splus: "Excellent",
  god: "Legendaire",
};

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

/** §9 verdict logic: Skip / Run / Garder. Tier is used as the "high tier"
 *  signal for Garder — waystones tier III+ worth keeping for a good tablet
 *  rather than running immediately. */
function classifyVerdict(score: number, hardBlock: boolean, tier: number): Verdict {
  if (hardBlock || score < 20) return "SKIP";
  if (score >= 50 && tier >= 3) return "GARDER";
  return "RUN";
}

const FIELD_LABELS: Record<keyof Weights, string> = {
  itemRarity: "Item Rarity",
  monsterRarity: "Monster Rarity",
  packSize: "Pack Size",
  monsterEffectiveness: "Monster Effectiveness",
  waystoneDropChance: "Waystone Drop Chance",
  quantity: "Quantity",
};

function buildBreakdown(
  fields: Record<keyof Weights, FieldContribution>,
  bonusTotal: number,
  penaltyDelta: number,
): AnalysisResult["heat"]["breakdown"] {
  const rows: AnalysisResult["heat"]["breakdown"] = (Object.keys(fields) as (keyof Weights)[]).map((key) => ({
    key,
    label: FIELD_LABELS[key],
    value: fields[key].contribution,
  }));
  if (bonusTotal > 0) rows.push({ key: "bonus", label: "Bonus", value: Math.round(bonusTotal * 10) / 10 });
  if (penaltyDelta > 0) rows.push({ key: "penalty", label: "Penalty", value: -Math.round(penaltyDelta * 10) / 10 });
  return rows;
}

function buildModifiers(rawLines: string[]): Modifier[] {
  return rawLines.map((text) => ({ text, kind: classifyModifierKind(text) }));
}

function formatWarning(hardBlockReasons: string[], penaltyReasons: string[]): string | null {
  if (hardBlockReasons.length > 0) return `Hard block: ${hardBlockReasons[0]}`;
  if (penaltyReasons.length > 0) return `Speed penalty: ${penaltyReasons[0]}`;
  return null;
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

/** §7: cross the waystone's own stat profile against each mechanic's
 *  priority/secondary stats (via `scoreMechanicFit`, shared with tablet
 *  ranking below), plus a flat bonus if the mechanic is already naturally
 *  present on the map text (§8/§9 "mecanique naturelle"). Returns scores
 *  for all mechanics, desc sorted. */
function computeMechanicScores(stats: ModStats, rawText: string): MechanicScore[] {
  const scores = getActiveMechanics().map((mech) => {
    const detectBonus = mech.detect?.test(rawText) ? 15 : 0;
    return { mechanic: mech.name, score: scoreMechanicFit(stats, mech, detectBonus) };
  });
  return scores.sort((a, b) => b.score - a.score);
}

/** Which of *this waystone's own* stats synergize with a tablet's mechanic
 *  — independent of `bestMechanicDef` (the single mechanic `rankTablets` is
 *  ranking against): a Breach Tablet gets credit for a high-pack-size
 *  waystone even when e.g. Legion scored higher overall. Keyed by the same
 *  lowercase mechanic id already used in `tags`/`rewards[].id` (delirium,
 *  breach, expedition, ritual, abyss) — no new field on `TabletDef`.
 *  Real `StatKey`s only; "monster density"/"magic monsters" aren't tracked
 *  stats in this app (see KNOWN_ISSUES.md #2), so the nearest tracked proxy
 *  is used instead (`monsterEffectiveness`/`monsterRarity`). */
const MECHANIC_SYNERGY: Partial<Record<string, StatKey[]>> = {
  delirium: ["packSize", "monsterRarity"],
  breach: ["packSize", "monsterEffectiveness"],
  expedition: ["quantity", "itemRarity"],
  ritual: ["itemRarity"],
  abyss: ["monsterRarity"],
};

const SYNERGY_CAP = 10;

/** Small additive bonus (0-`SYNERGY_CAP`) rewarding a tablet whose mechanic
 *  synergizes with what this specific waystone is actually strong in.
 *  Each synergy stat is normalized 0-1 the same way `scoreMechanicFit` does
 *  (via `NORMALIZE_CAP`) so no single stat's raw magnitude dominates, then
 *  split evenly across however many stats that mechanic lists — a tablet
 *  with no recognized mechanic tag (or a mechanic with no synergy entry)
 *  contributes 0, unchanged from before this existed. */
function computeSynergyBonus(stats: ModStats, tablet: TabletDef): number {
  const mechId = tablet.tags?.find((t) => t in MECHANIC_SYNERGY);
  const synergyStats = mechId ? MECHANIC_SYNERGY[mechId] : undefined;
  if (!synergyStats || synergyStats.length === 0) return 0;
  const perStat = SYNERGY_CAP / synergyStats.length;
  let bonus = 0;
  for (const key of synergyStats) {
    bonus += Math.min(1, (stats[key] ?? 0) / NORMALIZE_CAP[key]) * perStat;
  }
  return Math.min(bonus, SYNERGY_CAP);
}

/** §9 "TABLETTE RECOMMANDEE": ranks every active tablet by how well its own
 *  boosts fit the target mechanic's priority/secondary stats — the same
 *  weighting `scoreMechanicFit` uses for the waystone itself, just applied
 *  to a tablet's `boosts` profile instead. A mechanic's optional
 *  `recommendedTablets` pin adds a flat bonus so curated picks still surface
 *  first, but any tablet (including ones added purely via meta.json, with
 *  no code change) is automatically eligible — no name list to maintain.
 *
 *  On top of that stat-fit, each tablet's `rewardScore` (rewards.ts) is
 *  added — value the six generic stats can't express (real
 *  mechanic-specific currency, mainly). A tablet with no `rewards`
 *  contributes 0 here, so this is purely additive: existing ranking for
 *  every tablet defined before this feature is unchanged. The combined
 *  total (`baseFit`) is clamped to 0-100, then a small, `baseFit`-scaled
 *  share of `computeSynergyBonus` is added (see the diminishing-returns
 *  comment just above the loop), re-clamped, then scaled by
 *  `getConfidenceMultiplier` (tablets.ts) as the final step — a
 *  `"high"`-confidence tablet is untouched (×1.0), `"low"` is gently
 *  penalized (×0.8), so speculative data can't outrank reliable data on a
 *  thin margin. Never folded into `statFit`/`rewardScore` themselves, and
 *  never changes `scoreToRating`'s bands. */
function rankTablets(mech: MechanicDef, stats: ModStats): { tablet: TabletDef; fit: number }[] {
  return getActiveTablets()
    .map((tablet) => {
      const pinBonus = mech.recommendedTablets?.includes(tablet.name) ? 10 : 0;
      const statFit = scoreMechanicFit(tablet.boosts, mech, pinBonus);
      const baseFit = Math.max(0, Math.min(100, statFit + tablet.rewardScore));
      const rawSynergy = computeSynergyBonus(stats, tablet);
      // Diminishing returns: a weak tablet (low baseFit) can't ride synergy
      // alone to the top. Below half of baseFit, synergy passes through
      // untouched; past that, it tapers to 25% marginal — smooth, no hard
      // cutoff — so a strong tablet still gets most of a good synergy roll
      // while a weak one's ceiling stays close to its own baseFit.
      const maxAllowedBonus = baseFit * 0.5;
      const scaledSynergy =
        rawSynergy <= maxAllowedBonus ? rawSynergy : maxAllowedBonus + (rawSynergy - maxAllowedBonus) * 0.25;
      const synergyBonus = Math.min(scaledSynergy, SYNERGY_CAP);
      const adjusted = Math.max(0, Math.min(100, baseFit + synergyBonus));
      const multiplier = getConfidenceMultiplier(tablet.confidence);
      const fit = Math.max(0, Math.min(100, Math.round(adjusted * multiplier)));
      return { tablet, fit };
    })
    .sort((a, b) => b.fit - a.fit);
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
  const evaluation = evaluateMap(stats, text);
  const tierClass = evaluation.hardBlock ? "trash" : classifyTier(evaluation.score);
  const verdict = classifyVerdict(evaluation.score, evaluation.hardBlock, parsed.tier);

  const mechanicScores = computeMechanicScores(stats, text);
  const best = mechanicScores[0];
  const bestMechanicDef = best ? getActiveMechanics().find((m) => m.name === best.mechanic) : undefined;
  const recommendedMechanic = best && best.score > 0 ? best.mechanic : null;

  const ranked = bestMechanicDef ? rankTablets(bestMechanicDef, stats) : [];
  const tablets = ranked.slice(0, 4).map(({ tablet, fit }) => ({
    name: tablet.name,
    delta: Math.round((sumBoosts(tablet.boosts) / 10) * 10) / 10,
    reason: `${tablet.name} matches ${recommendedMechanic ?? "General"} (${fit}/100)`,
    rating: scoreToRating(fit),
    rewards: tablet.rewards && tablet.rewards.length > 0 ? tablet.rewards.map(describeReward) : undefined,
  }));

  return {
    waystone: {
      tier: parsed.tier,
      name: parsed.name,
      corrupted: parsed.corrupted,
      modCount: parsed.modifiers.length,
    },
    heat: {
      score: evaluation.score,
      tierClass,
      tierLabel: TIER_LABELS[tierClass],
      verdict,
      rating: evaluation.hardBlock ? "D" : scoreToRating(evaluation.score),
      breakdown: buildBreakdown(
        evaluation.breakdown,
        evaluation.bonusDetails.reduce((sum, b) => sum + b.bonus, 0),
        evaluation.penaltyDelta,
      ),
    },
    modifiers: buildModifiers(parsed.modifiers),
    tablets,
    warning: formatWarning(
      evaluation.hardBlockReasons,
      evaluation.penaltyDetails.map((p) => p.reason),
    ),
    insights: buildInsights(evaluation.bonusDetails),
    mechanicScores,
    recommendedMechanic,
    keyFactors: buildKeyFactors(evaluation.breakdown, recommendedMechanic, best?.score ?? 0, ranked[0]),
  };
}

export { DEFAULT_THRESHOLD };
