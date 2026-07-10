/** Juice Score engine for PoE2 waystones.
 *
 *  The actual score (`rewardScore`/`effectiveScore`/`score`) is a
 *  DOMINANT-STAT model (2026-07-1x redesign, user's own gameplay judgment —
 *  "basé sur sa plus grosse stat, et des petits bonus si y'a d'autres stats
 *  intéressantes"): find the waystone's single strongest stat (normalized
 *  against its own realistic ceiling — see `STAT_REFERENCES`, all 5 stats
 *  now share the same 100/120 ceilings after the 2026-07-11 Pack Size fix
 *  below), tier it with the same 15/25/50 boundaries already used for
 *  mechanic/tablet fit (`mechanics.ts`'s `tierForPercent`), and add a small
 *  bonus for every OTHER stat that also clears "ok". See
 *  `computeCompositeScore` below. This replaces the 2026-07-06 weighted-sum
 *  model (6 signals incl. a mechanic-density term, each capped and summed,
 *  then scaled by multiplicative mechanic/Pack-Size synergy) — that model
 *  was found to average away genuinely strong individual stats (a real
 *  waystone with +80% Drop Chance and +55% Item Rarity but nothing else
 *  landed in the "MOYEN" band) and had accreted layers (synergy multipliers,
 *  a soft overflow cap) that were hard to reason about together.
 *
 *  `breakdown`/`bonusDetails` (from the legacy `Weights`-per-field model and
 *  `POSITIVE_MOD_PATTERNS`) are kept ONLY as a display breakdown for the UI
 *  (heat.breakdown chips, key factors, "Bonus: ..." insights in adapter.ts)
 *  — they no longer feed the actual score. Any resemblance between their
 *  numbers and `score` is coincidental.
 *
 *  Item Quantity (`ModStats.quantity`) is not one of the scored signals: it
 *  skewed results when weighted in (2026-07-06) and isn't part of the
 *  cahier des charges' 5 signals. It's still parsed (mod-parser.ts) and
 *  still used by the Mechanic Match Score (mechanics.ts's Heist/Harvest/
 *  Abyss/Expedition secondary stats) — only the Juice Score ignores it.
 *
 *  Danger/annoyance mods (reflect, no leech/regen, reduced recovery, fast
 *  monsters, elemental penetration, ...) are detected here too, but surface
 *  for display ONLY (`warning`/`warnings`/`dangerLevel`/`dangerLabel` — the
 *  Insights column). They never affect the score: the score measures loot
 *  value on paper, and danger is the player's call (2026-07-08 decision,
 *  reverting the short-lived 2026-07-06 ×0.7-0.95 danger multiplier on
 *  `effectiveScore`). */

import { PATTERNS as NUMERIC_PATTERNS, type ModStats } from "./mod-parser";
import { MECHANIC_PATTERNS, EXTRA_CONTENT_BONUS } from "./mechanic-patterns";
import { TIER_SCORE, tierForPercent, type StatTier } from "./mechanics";

export interface Weights {
  itemRarity: number;
  monsterRarity: number;
  packSize: number;
  monsterEffectiveness: number;
  waystoneDropChance: number;
}

// Per-stat ceiling applied before weighting, for the LEGACY display-only
// breakdown only (see file-level comment) — keeps it stable and normalized
// even if a garbled outlier value gets parsed. Not used by the actual score.
export const CAPS: Record<keyof Weights, number> = {
  itemRarity: 200,
  monsterRarity: 100,
  packSize: 150,
  monsterEffectiveness: 100,
  waystoneDropChance: 100,
};

// Weight = (max points this field can contribute at its cap) / cap, for the
// legacy display breakdown (`EvaluationResult.breakdown`, UI-only — see
// file-level comment). NOT used by `rewardScore`/`effectiveScore`/`score`.
//
// NOT meta.json-driven: unlike mechanics.ts/tablets.ts, these weights (and
// CAPS/DEFAULT_THRESHOLD/the pattern tables below) are hardcoded here and
// read by nothing in meta-config.ts. Tuning them requires editing this file
// and rebuilding — see README's "Tuning via meta.json" section.
export const DEFAULT_WEIGHTS: Weights = {
  itemRarity: 22 / CAPS.itemRarity,
  monsterRarity: 20 / CAPS.monsterRarity,
  packSize: 22 / CAPS.packSize,
  monsterEffectiveness: 16 / CAPS.monsterEffectiveness,
  waystoneDropChance: 10 / CAPS.waystoneDropChance,
};

export const DEFAULT_THRESHOLD = 20; // below this: SKIP (§9)

// Danger/annoyance mods — detected for display only (`warning`/`warnings`/
// `dangerLevel`); they never affect the score.
// `id` is a stable internal key (never shown to the user, never changes with
// wording/localization); `label` is the current UI-facing text, looked up
// from `id` only when building `warnings` for display. This split is
// deliberate: `dangerLevel` is computed from `severity` (via `DangerHit[]`,
// see below) and must never depend on `label` — renaming/relocalizing a
// label can't silently change danger logic.
//
// `severity` feeds `computeDangerLevel` below; "reflect" is its own tier
// (heavily weighted, see computeDangerLevel); "strong" mods actively hurt
// survivability/leech (crit/penetration/speed/no-leech/no-regen); "moderate"
// slow the loop without threatening it; "minor" is cosmetic annoyance.
export type DangerSeverity = "reflect" | "strong" | "moderate" | "minor";
const DANGER_PATTERNS: { id: string; label: string; severity: DangerSeverity; pattern: RegExp }[] = [
  // Real PoE2 wording is "Monsters reflect 18% of Elemental Damage" — allow
  // any short run of characters (the "18% of Elemental" part) between the
  // verb and "damage", not just a single bare word.
  {
    id: "reflect-damage",
    label: "Reflect Damage",
    severity: "reflect",
    pattern: /reflect(?:s|ed)?\b[^\n]{0,30}?damage/i,
  },
  { id: "cannot-leech", label: "Cannot Leech", severity: "strong", pattern: /cannot\s+leech/i },
  // Real PoE2 wording is "Players cannot Regenerate Life, Mana or Energy
  // Shield" — "no ... regenerat" alone never matched it.
  {
    id: "no-regeneration",
    label: "No Regeneration",
    severity: "strong",
    pattern: /(?:no|cannot)\s+[^\n]{0,30}?regenerat/i,
  },
  // Real PoE2 wording is "Players have X% less Recovery Rate of Life and
  // Energy Shield" — "reduced ... recovery" alone never matched it.
  {
    id: "reduced-recovery",
    label: "Reduced Recovery",
    severity: "moderate",
    pattern: /(?:reduced|less)\s+[^\n]{0,30}?recovery/i,
  },
  {
    id: "reduced-regeneration",
    label: "Reduced Regeneration",
    severity: "moderate",
    pattern: /less\s+.*regenerat/i,
  },
  { id: "avoid-ailments", label: "Avoid Ailments", severity: "moderate", pattern: /avoid(?:s|ed)?\s+.*ailments?/i },
  {
    id: "reduced-action-speed",
    label: "Reduced Action Speed",
    severity: "moderate",
    pattern: /(?:reduced|less)\s+.*action\s+speed|temporal\s+chains/i,
  },
  {
    id: "high-crit-monsters",
    label: "High Crit Monsters",
    severity: "strong",
    // Verb-scoped (have/gain/deal): the map suffix "Monsters take X%
    // reduced Extra Damage from Critical Hits" is a *defensive* monster mod
    // (annoying, not dangerous) and must not read as monsters critting you.
    pattern: /monsters?\s+(?:have|gain|deal)[^\n]{0,40}critical/i,
  },
  {
    id: "elemental-penetration",
    label: "Elemental Penetration",
    severity: "strong",
    // Scoped to monster wording like its siblings: a bare /penetrat/ also
    // matches player-side gear/passive lines ("Damage Penetrates ...") and
    // resistance text, which are not map dangers.
    pattern: /monsters?[^\n]{0,40}penetrat(?:e|es|ion)/i,
  },
  {
    id: "fast-monsters",
    label: "Fast Monsters",
    severity: "strong",
    pattern: /monsters?[^\n]{0,40}(?:attack|cast|movement)[^\n]{0,15}speed/i,
  },
  {
    id: "extra-elemental-damage",
    label: "Extra Elemental Damage",
    severity: "strong",
    // "Monsters deal 30% of Damage as Extra Fire" / "Monsters gain 20% of
    // their Physical Damage as extra Chaos Damage".
    pattern: /(?:deals?|gains?)[^\n]{0,30}?damage\s+as\s+extra/i,
  },
  {
    id: "lowered-max-resistances",
    label: "Lowered Max Resistances",
    severity: "strong",
    // "-12% maximum Player Resistances" — the stat only ever appears on a
    // waystone as this malus, so matching the stat name alone is safe.
    pattern: /maximum\s+player\s+resistances/i,
  },
  {
    id: "additional-projectiles",
    label: "Extra Projectiles",
    severity: "moderate",
    // "Monsters fire 2 additional Projectiles"
    pattern: /fires?\s+\d+\s+additional\s+projectiles?/i,
  },
  {
    id: "player-curses",
    label: "Cursed Players",
    severity: "moderate",
    // "Players are Cursed with Elemental Weakness/Enfeeble/Temporal Chains"
    pattern: /players?\s+are\s+cursed\s+with/i,
  },
  {
    id: "reduced-curse-effect",
    label: "Reduced Curse Effect",
    severity: "minor",
    pattern: /(?:reduced|less)[^\n]{0,25}curse|curse[^\n]{0,25}(?:reduced|less)/i,
  },
];

// A duplicate id would silently last-write-wins overwrite an entry in
// DANGER_LABEL_BY_ID below — no compiler error, wrong label in the UI. The
// table is static developer-authored data, so a duplicate is always a
// copy-paste bug: fail hard at module load (dev, tests, and app alike)
// instead of shipping the corruption.
const dangerIds = DANGER_PATTERNS.map((d) => d.id);
const duplicateDangerIds = [...new Set(dangerIds.filter((id, i) => dangerIds.indexOf(id) !== i))];
if (duplicateDangerIds.length > 0) {
  throw new Error(`Duplicate DANGER_PATTERNS ids: ${duplicateDangerIds.join(", ")}`);
}

const DANGER_LABEL_BY_ID: Record<string, string> = Object.fromEntries(DANGER_PATTERNS.map((d) => [d.id, d.label]));

// Exported so adapter.ts can sort DangerHit[] by the same domain order when
// building its UI-facing view (DangerHitView), without either duplicating
// this comparator or scoring.ts knowing about UI severity tiers.
export const DANGER_SEVERITY_ORDER: Record<DangerSeverity, number> = { reflect: 0, strong: 1, moderate: 2, minor: 3 };

// Positive mods: signals that increase profit/hour beyond what the raw
// stat numbers already capture. Display-only (see file-level comment) —
// feeds `bonusDetails`/the UI's "Bonus: ..." insights and heat.breakdown's
// bonus row, NOT the actual score. The 4 "extra content: X" entries are
// derived from the shared EXTRA_CONTENT_BONUS/MECHANIC_PATTERNS
// (mechanic-patterns.ts) — order preserved (ritual, breach, delirium,
// expedition after the 2 monster entries) since it drives display order.
const POSITIVE_MOD_PATTERNS: Record<string, [RegExp, number]> = {
  "more rare monsters": [/(?:increased|additional).*rare\s+monsters/i, 6.0],
  "more magic monsters": [/(?:increased|additional).*magic\s+monsters/i, 4.0],
  ...Object.fromEntries(
    Object.entries(EXTRA_CONTENT_BONUS).map(([id, bonus]) => [
      `extra content: ${id}`,
      [MECHANIC_PATTERNS[id as keyof typeof MECHANIC_PATTERNS], bonus] as [RegExp, number],
    ]),
  ),
};

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// The 5 cahier-des-charges signals, keyed the same as `Weights`/`ModStats`.
type StatSignal = keyof Weights;
const STAT_SIGNALS: StatSignal[] = [
  "itemRarity",
  "monsterRarity",
  "packSize",
  "monsterEffectiveness",
  "waystoneDropChance",
];

// Each stat's realistic ceiling — used ONLY to compare stats of very
// different natural ranges on a level footing before picking "the biggest
// one". packSize was 30 at launch (copied from the old god-map reference
// table without re-checking it) — far too low: a real T15's base Pack Size
// mod alone rolls (41-50)% (maxroll.gg, already sourced for the same
// constant on the Mechanic Match Score side, KNOWN_ISSUES #3's 2026-07-10
// update), so 30 meant a completely ordinary 15% roll normalized to 50%
// of "ceiling" — instant legendary tier for nearly every real waystone
// with any Pack Size at all (user report, 2026-07-11: "le rating est tout
// le temps en légendaire"). Raised to 100, matching every other stat here
// (same generous-ceiling-over-tight-fit reasoning already used for that
// other constant) — real Pack Size (up to ~64% observed) now needs to
// actually be strong to dominate, same bar as Item Rarity/Monster Rarity/
// Monster Effectiveness.
const STAT_REFERENCES: Record<StatSignal, number> = {
  itemRarity: 100,
  monsterRarity: 100,
  packSize: 100,
  monsterEffectiveness: 100,
  waystoneDropChance: 120,
};

// Max bonus a single non-dominant stat can add, scaled by how close it is to
// its own ceiling (100% of ceiling = full +5). With at most 4 other stats,
// the composite score can't exceed legendary's 80 + 4*5 = 100 — no overflow
// cap needed, unlike the old multiplicative-synergy model.
const SECONDARY_BONUS_CAP = 5;

interface DominantStat {
  key: StatSignal;
  normalizedPercent: number;
  tier: StatTier;
}

/** The waystone's single strongest stat, tiered, plus a small bonus for
 *  every other stat that also clears "ok" — see the file-level comment for
 *  why. `normalizedPercent` is "how close to this stat's own ceiling", not
 *  the raw %, so it's only meaningful for comparing stats against each
 *  other, never shown to the player directly. */
function computeCompositeScore(stats: ModStats): { score: number; dominant: DominantStat; bonus: number } {
  const candidates = STAT_SIGNALS.map((key) => ({
    key,
    normalizedPercent: ((stats[key] ?? 0) / STAT_REFERENCES[key]) * 100,
  }));
  const dominant = candidates.reduce((best, c) => (c.normalizedPercent > best.normalizedPercent ? c : best));
  const dominantTier = tierForPercent(dominant.normalizedPercent);

  const bonus = candidates
    .filter((c) => c.key !== dominant.key && tierForPercent(c.normalizedPercent) !== "weak")
    .reduce((sum, c) => sum + clamp01(c.normalizedPercent / 100) * SECONDARY_BONUS_CAP, 0);

  const score = Math.max(0, Math.min(100, TIER_SCORE[dominantTier] + bonus));
  return { score, dominant: { key: dominant.key, normalizedPercent: dominant.normalizedPercent, tier: dominantTier }, bonus };
}

export interface FieldContribution {
  rawValue: number;
  cappedValue: number;
  weight: number;
  contribution: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// LEGACY per-field breakdown — display only (see file-level comment). Does
// NOT feed `rewardScore`/`effectiveScore`/`score`.
function breakdownFields(
  stats: ModStats,
  weights: Weights,
  caps: Record<keyof Weights, number>,
): Record<keyof Weights, FieldContribution> {
  const out = {} as Record<keyof Weights, FieldContribution>;
  for (const field of Object.keys(weights) as (keyof Weights)[]) {
    const rawValue = stats[field] ?? 0;
    const cappedValue = Math.min(rawValue, caps[field]);
    const weight = weights[field];
    out[field] = { rawValue, cappedValue, weight, contribution: round2(cappedValue * weight) };
  }
  return out;
}

export interface BonusDetail {
  reason: string;
  bonus: number;
}

/** Internal, string-decoupled unit of danger detection: `id` is a stable key
 *  (never user-facing), `severity` is what all danger logic (currently just
 *  `computeDangerLevel`) reasons over. Never derive danger logic from
 *  `warnings`/labels — always from `DangerHit[]`. */
export interface DangerHit {
  id: string;
  severity: DangerSeverity;
}

/** All matched danger/annoyance mods on this map, in pattern-table order. */
export function detectDangerHits(text: string): DangerHit[] {
  if (!text) return [];
  return DANGER_PATTERNS.filter((d) => d.pattern.test(text)).map((d) => ({ id: d.id, severity: d.severity }));
}

/** `DangerHit[]` → UI-facing label strings, sorted most-severe-first
 *  (reflect > strong > moderate > minor). This is the ONLY place a hit's
 *  `id` is translated to display text — nothing upstream of this should
 *  need the label. */
export function dangerHitsToWarnings(hits: DangerHit[]): string[] {
  return [...hits]
    .sort((a, b) => DANGER_SEVERITY_ORDER[a.severity] - DANGER_SEVERITY_ORDER[b.severity])
    .map((h) => DANGER_LABEL_BY_ID[h.id] ?? h.id);
}

export type DangerLevel = "none" | "low" | "medium" | "high";

/** Derives an at-a-glance danger signal from `DangerHit[]` — `severity`
 *  only, never a label/warning string, so renaming or relocalizing a
 *  warning can never change this. Also never derived from raw text,
 *  keeping it fully independent of danger *detection*. Deliberately
 *  simple, evaluated most-severe-first:
 *  - "high": any "reflect" hit, or 3+ hits with at least one "strong" one
 *    (crit/penetration/fast-monsters/no-leech/no-regen).
 *  - "medium": any single "strong" hit, or 2+ "moderate" ones.
 *  - "low": anything left over (a single moderate/minor hit).
 *  - "none": no hits at all. */
export function computeDangerLevel(hits: DangerHit[]): DangerLevel {
  if (hits.length === 0) return "none";

  const hasReflect = hits.some((h) => h.severity === "reflect");
  const strongCount = hits.filter((h) => h.severity === "strong").length;
  const moderateCount = hits.filter((h) => h.severity === "moderate").length;

  if (hasReflect) return "high";
  if (hits.length >= 3 && strongCount >= 1) return "high";
  if (strongCount >= 1) return "medium";
  if (moderateCount >= 2) return "medium";
  return "low";
}

/** Classifies a single raw modifier line for display (§5 modifiers[].kind). */
export function classifyModifierKind(text: string): "positive" | "neutral" | "danger" {
  for (const { pattern } of DANGER_PATTERNS) {
    if (pattern.test(text)) return "danger";
  }
  for (const [pattern] of Object.values(POSITIVE_MOD_PATTERNS)) {
    if (pattern.test(text)) return "positive";
  }
  for (const pattern of Object.values(NUMERIC_PATTERNS)) {
    if (pattern.test(text)) return "positive";
  }
  return "neutral";
}

export function detectPositiveMods(text: string): BonusDetail[] {
  if (!text) return [];
  const details: BonusDetail[] = [];
  for (const [reason, [pattern, bonus]] of Object.entries(POSITIVE_MOD_PATTERNS)) {
    if (pattern.test(text)) details.push({ reason, bonus });
  }
  return details;
}

export interface EvaluationResult {
  /** Final score, thresholded on for `decision` — equal to `effectiveScore`.
   *  Kept as its own field (rather than dropped in favor of just
   *  `effectiveScore`) for backward compatibility with existing callers. */
  score: number;
  decision: "run" | "skip";
  /** LEGACY per-field breakdown (display only — heat.breakdown/keyFactors in
   *  adapter.ts). Computed from the old flat `Weights`/`CAPS` model, fully
   *  decoupled from `score`/`rewardScore`/`effectiveScore` below — it will
   *  NOT sum to them. */
  breakdown: Record<keyof Weights, FieldContribution>;
  /** LEGACY positive-mod bonuses (display only — adapter.ts's "Bonus: ..."
   *  insights and heat.breakdown's bonus row). Not applied to the score. */
  bonusDetails: BonusDetail[];
  /** Danger/annoyance mods detected on this map (structured, string-free) —
   *  feeds `warning`/`warnings`/`dangerLevel` display only; never affects
   *  any score field. */
  dangerHits: DangerHit[];
  /** The real score: the dominant stat's tier score plus the secondary-stat
   *  bonus (`computeCompositeScore`) — "how good is this map on paper",
   *  ignoring danger. Naturally bounded to [0, 100] by construction (no
   *  overshoot, unlike the old multiplicative-synergy model), so this is
   *  already equal to `effectiveScore`/`score`. */
  rewardScore: number;
  /** Same value as `rewardScore`/`score`. Kept as its own field for
   *  backward compatibility from when it also carried a danger multiplier
   *  (removed 2026-07-08 — danger is display-only) and a soft overflow cap
   *  (removed 2026-07-1x — the new model can't overshoot 100). */
  effectiveScore: number;
  /** The dominant stat's tier score (10/25/55/80, `mechanics.ts`'s
   *  `TIER_SCORE`) alone, before the secondary-stat bonus — for display
   *  layers that want to show "main stat vs. bonus" as separate numbers
   *  (see displayAdapter.ts) instead of re-deriving them from scratch. */
  baseScore: number;
  /** The secondary-stat bonus alone (`rewardScore` - `baseScore`) — every
   *  other stat that also cleared "ok", each contributing up to
   *  `SECONDARY_BONUS_CAP` scaled by how close it is to its own ceiling.
   *  Always >= 0. */
  synergyBonus: number;
}

/** Composite Juice Score (2026-07-1x dominant-stat redesign — see the
 *  file-level comment for the "why"): `computeCompositeScore` finds the
 *  waystone's single strongest stat (normalized against its own realistic
 *  ceiling), tiers it (same 15/25/50 boundaries as mechanic/tablet fit),
 *  and adds a small bonus for every other stat that's also at least "ok".
 *  Bounded to [0, 100] by construction — `rewardScore`/`effectiveScore`/
 *  `score` are all the same number now (kept as separate fields for
 *  backward compatibility, see their own doc comments). Danger mods never
 *  reduce the score — they surface as display-only warnings (see the
 *  file-level comment). `breakdown`/`bonusDetails` are still computed from
 *  the old flat model, but purely for UI display now — see the file-level
 *  comment.
 *
 *  `contentText` (parser.ts's `ParsedWaystone.contentText` — every block
 *  except the header) is what positive-mod/danger keyword matching runs
 *  against, so the item's own NAME can never false-positive a match
 *  (KNOWN_ISSUES #4's follow-up, 2026-07-08). */
export function evaluateMap(
  stats: ModStats,
  contentText = "",
  weights: Weights = DEFAULT_WEIGHTS,
  threshold: number = DEFAULT_THRESHOLD,
): EvaluationResult {
  const breakdown = breakdownFields(stats, weights, CAPS);
  const bonusDetails = detectPositiveMods(contentText);
  const dangerHits = detectDangerHits(contentText);

  const { score: composite, dominant, bonus } = computeCompositeScore(stats);
  const rewardScore = round2(composite);
  const effectiveScore = rewardScore;
  const score = effectiveScore;
  const decision = score >= threshold ? "run" : "skip";
  const baseScore = round2(TIER_SCORE[dominant.tier]);
  const synergyBonus = round2(bonus);

  return {
    score,
    decision,
    breakdown,
    bonusDetails,
    dangerHits,
    rewardScore,
    effectiveScore,
    baseScore,
    synergyBonus,
  };
}
