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
  DANGER_SEVERITY_ORDER,
  type DangerHit,
  type DangerLevel,
  type DangerSeverity,
  type FieldContribution,
  type Weights,
} from "./scoring";
import { buildDisplayData, formatPercent } from "./displayAdapter";
import {
  getActiveMechanics,
  scoreMechanicFit,
  scoreMechanicFitRaw,
  NORMALIZE_CAP,
  TABLET_ROLL_CAP,
  type MechanicDef,
  type StatKey,
} from "./mechanics";
import { getActiveTablets, getConfidenceMultiplier, type TabletDef } from "./tablets";
import { describeReward } from "./rewards";
import type { AnalysisResult, DangerHitView, MechanicScore, Modifier, Rating, TierClass, Verdict } from "../types";
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
 *  the "high tier" signal for Garder — waystones tier III+ worth keeping
 *  for a good tablet rather than running immediately. */
function classifyVerdict(score: number, tier: number): Verdict {
  if (score < DEFAULT_THRESHOLD) return "SKIP";
  if (score >= 50 && tier >= 3) return "GARDER";
  return "RUN";
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

/** §7: cross the waystone's own stat profile against each mechanic's
 *  priority/secondary stats (via `scoreMechanicFit`, shared with tablet
 *  ranking below). Returns scores for all mechanics, desc sorted.
 *
 *  Purely stat-fit based — "which mechanic do THESE STATS suit" — no
 *  presence-detection bonus mixed in. §8/§9's "mecanique naturelle" bonus
 *  used to live here too (a flat +15 for any mechanic whose keyword
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
function computeMechanicScores(stats: ModStats): MechanicScore[] {
  const scores = getActiveMechanics().map((mech) => ({
    mechanic: mech.name,
    score: scoreMechanicFit(stats, mech),
    raw: scoreMechanicFitRaw(stats, mech),
  }));
  return scores.sort((a, b) => b.raw - a.raw).map(({ mechanic, score }) => ({ mechanic, score }));
}

/** Which of *this waystone's own* stats synergize with a tablet's mechanic
 *  — independent of which mechanic `rankTablets` ends up matching that
 *  tablet against: a Breach Tablet gets credit for a high-pack-size
 *  waystone even when its own best-fit mechanic is something else. Keyed
 *  by the same lowercase mechanic id already used in `tags`/`rewards[].id` (delirium,
 *  breach, expedition, ritual, abyss) — no new field on `TabletDef`.
 *  Real `StatKey`s only; "monster density"/"magic monsters" aren't tracked
 *  stats in this app (see KNOWN_ISSUES.md #2), so the nearest tracked proxy
 *  is used instead (`monsterEffectiveness`/`monsterRarity`). */
// Kept aligned with each mechanic's researched priority/secondary stats in
// mechanics.ts (community consensus 0.5, 2026-07-06) — same sources, same
// rationale comments there.
const MECHANIC_SYNERGY: Partial<Record<string, StatKey[]>> = {
  delirium: ["packSize", "itemRarity"],
  breach: ["monsterRarity", "itemRarity"],
  expedition: ["quantity", "monsterRarity"],
  ritual: ["monsterRarity", "packSize"],
  abyss: ["monsterRarity", "quantity"],
  irradiated: ["itemRarity", "monsterEffectiveness"],
  temple: ["itemRarity", "packSize"],
};

/** User-designated primary mechanics (2026-07-06): the ones worth building
 *  a map around. Tablets whose mechanic isn't in this set (Expedition,
 *  Irradiated, Temple, and the generic Standard/Overseer) take a gentle
 *  end-stage ×0.8 on their fit in `rankTablets` — same soft-malus pattern
 *  as `getConfidenceMultiplier`, never a hard grouping: a secondary tablet
 *  that fits this waystone far better can still rank first. */
const PRIMARY_MECHANIC_TAGS = new Set(["breach", "delirium", "ritual", "abyss"]);
const SECONDARY_MECHANIC_MULTIPLIER = 0.8;

const SYNERGY_CAP = 10;

// Short stat names for the tablet list's one-line synergy footer ("Pack
// size + Monster eff. = Breach loot") — tighter than FIELD_LABELS, which
// is sized for the Heat Breakdown rows, not an inline formula.
const SYNERGY_STAT_LABELS: Record<StatKey, string> = {
  itemRarity: "Rarity",
  monsterRarity: "Monster rarity",
  packSize: "Pack size",
  monsterEffectiveness: "Monster eff.",
  waystoneDropChance: "Waystones",
  quantity: "Quantity",
};

/** "Pack size + Monster eff. = Breach loot" — why the top tablet pairs
 *  with this map, phrased from the same MECHANIC_SYNERGY stats
 *  computeSynergyBonus scores on (never a second, drifting list).
 *  Undefined for tablets without a synergy-mapped mechanic tag
 *  (Standard/Overseer/General) — the overlay hides the footer then. */
function buildSynergyLine(tablet: TabletDef): string | undefined {
  const mechId = tablet.tags?.find((t) => t in MECHANIC_SYNERGY);
  const synergyStats = mechId ? MECHANIC_SYNERGY[mechId] : undefined;
  if (!mechId || !synergyStats || synergyStats.length === 0) return undefined;
  const mechName = mechId.charAt(0).toUpperCase() + mechId.slice(1);
  return `${synergyStats.map((s) => SYNERGY_STAT_LABELS[s]).join(" + ")} = ${mechName} loot`;
}

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
 *  boosts fit ITS OWN mechanic — not a single mechanic shared across every
 *  tablet. A tablet's mechanic identity comes from `tablet.tags` (the same
 *  source `computeSynergyBonus`/`buildSynergyLine`/`tierMult` already use
 *  below) resolved to a `TABLET_LINKED_MECHANICS` entry — Standard/Overseer
 *  Precursor (`tags: ["general"]`) resolve to "General", Breach/Ritual/
 *  Delirium/etc. resolve to their own name. Direct tag lookup, not a search
 *  for whichever of the 8 mechanics numerically scores highest — an
 *  argmax search was tried and discarded: it let e.g. Standard Precursor
 *  Tablet's Quantity+Item Rarity boosts "match" Irradiated (whose
 *  secondaries happen to include quantity) purely by numeric coincidence,
 *  a confusing label with no real identity behind it. A tablet's declared
 *  tag is curated data (tablets.ts), not something to rediscover per
 *  analysis.
 *
 *  2026-07-10 design fix (user report): every tablet used to be scored
 *  against the single globally-`recommendedMechanic`, so e.g. a Delirium
 *  Tablet (boosts: 20% Pack Size — a strong Delirium fit) on a
 *  Ritual-winning waystone displayed "matches Ritual (16/100)" — its real
 *  strength against its own mechanic (48/100) never shown, and even the
 *  small `computeSynergyBonus` couldn't fully compensate (capped at half
 *  of an already-suppressed base). `recommendedMechanic` (the waystone-
 *  level "Strong X match" verdict, still gated by `skipIfBelow`) is fully
 *  decoupled from this now — deliberately: a tablet's own honest fit is
 *  shown even on a waystone too weak to recommend chasing any specific
 *  mechanic (see call site).
 *
 *  A mechanic's optional `recommendedTablets` pin adds a flat bonus (now
 *  evaluated against each tablet's OWN mechanic, not the global winner —
 *  a real fix in its own right: a curated pin used to only ever apply to
 *  whichever tablet matched the global winner, e.g. Delirium's pin on
 *  "Delirium Tablet" only ever fired when Delirium itself won globally).
 *  Any tablet (including ones added purely via meta.json, no code change)
 *  is automatically eligible — an unrecognized/missing tag falls back to
 *  "General", same as the synergy/tier-multiplier logic below.
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
 *  never changes `scoreToRating`'s bands.
 *
 *  Sorted by the unrounded fit (`fitRaw`), not the rounded `fit` each tablet
 *  displays — same rounding-tie problem `computeMechanicScores` has, just
 *  one level down. `fitRaw` is stripped before returning. */
function rankTablets(stats: ModStats): { tablet: TabletDef; fit: number; mechanic: string }[] {
  const activeMechanics = getActiveMechanics();
  const tagToMechanic = new Map(
    [...TABLET_LINKED_MECHANICS]
      .map((name): [string, MechanicDef | undefined] => [name.toLowerCase(), activeMechanics.find((m) => m.name === name)])
      .filter((entry): entry is [string, MechanicDef] => entry[1] !== undefined),
  );
  const generalDef = tagToMechanic.get("general")!; // TABLET_LINKED_MECHANICS always includes "General"
  return getActiveTablets()
    .map((tablet) => {
      const tag = tablet.tags?.find((t) => tagToMechanic.has(t));
      const mech = (tag && tagToMechanic.get(tag)) || generalDef;
      const pinBonus = mech.recommendedTablets?.includes(tablet.name) ? 10 : 0;
      // TABLET_ROLL_CAP, not NORMALIZE_CAP: a tablet carries one 10-25%
      // roll, not a waystone's stacked totals — see mechanics.ts.
      const statFit = scoreMechanicFitRaw(tablet.boosts, mech, pinBonus, TABLET_ROLL_CAP);
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
      const confidenceMult = getConfidenceMultiplier(tablet.confidence);
      const tierMult = tablet.tags?.some((t) => PRIMARY_MECHANIC_TAGS.has(t))
        ? 1
        : SECONDARY_MECHANIC_MULTIPLIER;
      const fitRaw = Math.max(0, Math.min(100, adjusted * confidenceMult * tierMult));
      const fit = Math.round(fitRaw);
      return { tablet, fit, fitRaw, mechanic: mech.name };
    })
    .sort((a, b) => b.fitRaw - a.fitRaw)
    .map(({ tablet, fit, mechanic }) => ({ tablet, fit, mechanic }));
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

  const mechanicScores = computeMechanicScores(stats);
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

  const ranked = rankTablets(stats);
  // 5 rows (was 4): the tablet list is now a uniform icon/score/bar scan
  // list with no per-row reason/rewards lines, so five rows cost less
  // height than the old three did.
  const tablets = ranked.slice(0, 5).map(({ tablet, fit, mechanic }, i) => ({
    name: tablet.name,
    delta: Math.round((sumBoosts(tablet.boosts) / 10) * 10) / 10,
    reason: `${tablet.name} matches ${mechanic} (${fit}/100)`,
    rating: scoreToRating(fit),
    fit,
    synergy: i === 0 ? buildSynergyLine(tablet) : undefined,
    rewards: tablet.rewards && tablet.rewards.length > 0 ? tablet.rewards.map(describeReward) : undefined,
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

export { DEFAULT_THRESHOLD };
// Re-exported for verify-adapter.mjs's unit-level danger-logic tests only —
// not used by the overlay UI (which only ever sees the AnalysisResult
// contract fields: warning/warnings/dangerLevel/dangerLabel).
export { computeDangerLevel, dangerHitsToWarnings, detectDangerHits };
// Re-exported for verify-adapter.mjs's meta-merge end-to-end check only —
// lets the script activate a merged mechanic table inside THIS bundle's
// module instance (the separate meta-schema bundle has its own copy of
// MECHANICS, so its setActive* wouldn't affect analyzeWaystoneText here).
export { setActiveMechanics, MECHANICS } from "./mechanics";
