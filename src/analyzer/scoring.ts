/** Juice Score engine for PoE2 waystones.
 *
 *  The actual score (`rewardScore`/`effectiveScore`/`score`) is a NORMALIZED
 *  model (2026-07-06 redesign): each loot signal contributes as a % of a
 *  "god map" reference value, not as a flat point value. This replaces the
 *  old flat-additive model, which compressed real maps into a ~0-25 band on
 *  a nominal 0-100 scale — see `computeBaseScore` below.
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
 *  monsters, elemental penetration, ...) are detected here too, and surface
 *  for display (`warning`/`warnings`/`dangerLevel`/`dangerLabel`). They also
 *  scale down `effectiveScore` (a dangerous map is worth less per hour to
 *  actually farm) — see `rewardScore` (pre-danger-penalty) vs
 *  `effectiveScore` (post-penalty, what the UI's tier/verdict/rating are
 *  computed from — see adapter.ts) on `EvaluationResult`. Danger
 *  *detection* (`DangerHit[]`/`computeDangerLevel`) is untouched by this —
 *  only `effectiveScore` reads it. */

import { PATTERNS as NUMERIC_PATTERNS, type ModStats } from "./mod-parser";

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
// `dangerLevel`), and to drive the danger penalty on `effectiveScore` below.
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
  { id: "no-regeneration", label: "No Regeneration", severity: "strong", pattern: /no\s+.*regenerat/i },
  { id: "reduced-recovery", label: "Reduced Recovery", severity: "moderate", pattern: /reduced\s+.*recovery/i },
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
    pattern: /monsters?[^\n]{0,40}critical/i,
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
// bonus row, NOT the actual score.
const POSITIVE_MOD_PATTERNS: Record<string, [RegExp, number]> = {
  "more rare monsters": [/(?:increased|additional).*rare\s+monsters/i, 6.0],
  "more magic monsters": [/(?:increased|additional).*magic\s+monsters/i, 4.0],
  "extra content: ritual": [/\britual\b/i, 10.0],
  "extra content: breach": [/\bbreach(?:es)?\b/i, 10.0],
  "extra content: delirium": [/\bdelirium\b/i, 8.0],
  "extra content: expedition": [/\bexpedition\b/i, 8.0],
};

// Distinct league mechanics counted for both the mechanic-density term in
// `computeBaseScore` and the stacking-synergy multiplier below — running
// several at once compounds density and reward far more than any single
// flat per-mechanic bonus could capture.
const MECHANIC_SYNERGY_PATTERNS: Record<string, RegExp> = {
  delirium: /\bdelirium\b/i,
  breach: /\bbreach(?:es)?\b/i,
  ritual: /\britual\b/i,
  abyss: /\babyss(?:al)?\b/i,
  expedition: /\bexpedition\b/i,
  legion: /\blegion\b/i,
  essence: /\bessence\b/i,
  blight: /\bblight\b/i,
};

function countActiveMechanics(text: string): number {
  if (!text) return 0;
  return Object.values(MECHANIC_SYNERGY_PATTERNS).filter((p) => p.test(text)).length;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// "God map" reference thresholds: the stat level at which that signal
// counts as fully maxed (i.e. contributes its full weight below). Distinct
// from CAPS above, which only bounds the legacy display breakdown.
const RARITY_REFERENCE = 100; // Item Rarity %
const PACK_SIZE_REFERENCE = 30; // Pack Size %
const DROP_CHANCE_REFERENCE = 120; // Waystone Drop Chance %
const MECHANIC_REFERENCE = 4; // distinct active mechanics

// Max points each signal contributes once it clears its god-map reference —
// sums to 100, so a maxed-out map (100% rarity, 30% pack size, 120% drop
// chance, 4+ mechanics) lands `computeBaseScore` at exactly 100 before
// synergy/danger are even applied.
const RARITY_WEIGHT = 30;
const PACK_SIZE_WEIGHT = 25;
const DROP_CHANCE_WEIGHT = 30;
const MECHANIC_WEIGHT = 15;

/** The actual "how good is this map" base signal: each stat contributes as
 *  a % of its own god-map reference (clamped to 100% of its own weight),
 *  not as a flat point value — so no single maxed-out stat can dominate the
 *  total, and a map doesn't need every signal maxed to reach a meaningful
 *  score. Naturally lands in [0, 100]. */
function computeBaseScore(stats: ModStats, mechanicCount: number): number {
  const rarityScore = clamp01(stats.itemRarity / RARITY_REFERENCE) * RARITY_WEIGHT;
  const packSizeScore = clamp01(stats.packSize / PACK_SIZE_REFERENCE) * PACK_SIZE_WEIGHT;
  const dropScore = clamp01(stats.waystoneDropChance / DROP_CHANCE_REFERENCE) * DROP_CHANCE_WEIGHT;
  const mechanicScore = clamp01(mechanicCount / MECHANIC_REFERENCE) * MECHANIC_WEIGHT;
  return rarityScore + packSizeScore + dropScore + mechanicScore;
}

// Reward stacking: 2+ distinct mechanics on one map compound each other
// (more density, more overlapping reward triggers) rather than just adding
// up — a multiplicative bonus on the count, not a per-mechanic flat one.
function synergyMultiplier(mechanicCount: number): number {
  if (mechanicCount >= 5) return 1.6;
  if (mechanicCount === 4) return 1.4;
  if (mechanicCount === 3) return 1.25;
  if (mechanicCount === 2) return 1.1;
  return 1.0;
}

// Pack Size amplifies whatever mechanic is stacked on top of it (more packs
// means more delirium fog clears / breach splinters / ritual mobs, etc.).
function statSynergyMultiplier(stats: ModStats, mechanicCount: number): number {
  const hasPackSize = (stats.packSize ?? 0) > 0;
  return hasPackSize && mechanicCount >= 1 ? 1.1 : 1.0;
}

// Smooth cap back onto a 0-100 scale: asymptotically approaches 100 as
// `raw` grows instead of hard-clipping, so two maps that both blow past the
// nominal ceiling (from synergy multipliers stacking on top of an already
// maxed base score) still rank against each other rather than both
// flattening to the same 100.
function normalizeToScale(raw: number): number {
  return 100 * (1 - Math.exp(-Math.max(0, raw) / 100));
}

// Real farming efficiency: a dangerous map costs more time/deaths per clear,
// so it's worth less per hour even at the same raw reward score.
const DANGER_PENALTY: Record<DangerLevel, number> = {
  none: 1.0,
  low: 0.95,
  medium: 0.85,
  high: 0.7,
};

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
   *  feeds `warning`/`warnings`/`dangerLevel` display AND the danger penalty
   *  applied below (`effectiveScore`). */
  dangerHits: DangerHit[];
  /** The real score: each loot signal normalized against a "god map"
   *  reference (`computeBaseScore`), scaled by mechanic-stacking synergy and
   *  the Pack-Size/mechanic synergy bonus, then smooth-capped back onto
   *  [0, 100] — "how good is this map on paper", ignoring danger. */
  rewardScore: number;
  /** `rewardScore` scaled by `DANGER_PENALTY[dangerLevel]`, clamped to
   *  [0, 100] — "how good is this map to actually farm". Same value as
   *  `score`. */
  effectiveScore: number;
}

/** Composite Juice Score (2026-07-06 normalized-model redesign): each loot
 *  signal contributes as a % of a "god map" reference value (`computeBaseScore`
 *  — Item Rarity/100%, Pack Size/30%, Waystone Drop Chance/120%, 4+
 *  mechanics), not as a flat point value, so real maps land across the full
 *  [0, 100] range instead of compressing into ~0-25. From there: a
 *  mechanic-stacking synergy multiplier, a Pack-Size/mechanic synergy bonus,
 *  a smooth cap back onto [0, 100] (`rewardScore`), and finally the danger
 *  penalty (`effectiveScore` — a "good but risky" map nets out below a
 *  "good and safe" one). `score` = `effectiveScore`, so existing callers
 *  (adapter.ts's tier/verdict/rating, all already reading `effectiveScore`
 *  directly) need no changes. `breakdown`/`bonusDetails` are still computed
 *  from the old flat model, but purely for UI display now — see the
 *  file-level comment. */
export function evaluateMap(
  stats: ModStats,
  rawText = "",
  weights: Weights = DEFAULT_WEIGHTS,
  threshold: number = DEFAULT_THRESHOLD,
): EvaluationResult {
  const breakdown = breakdownFields(stats, weights, CAPS);
  const bonusDetails = detectPositiveMods(rawText);
  const dangerHits = detectDangerHits(rawText);

  const mechanicCount = countActiveMechanics(rawText);
  const baseScore = computeBaseScore(stats, mechanicCount);
  const synergized = baseScore * synergyMultiplier(mechanicCount) * statSynergyMultiplier(stats, mechanicCount);
  const rewardScore = round2(normalizeToScale(synergized));

  const dangerLevel = computeDangerLevel(dangerHits);
  const effectiveScore = round2(Math.max(0, Math.min(100, rewardScore * DANGER_PENALTY[dangerLevel])));

  const score = effectiveScore;
  const decision = score >= threshold ? "run" : "skip";

  return { score, decision, breakdown, bonusDetails, dangerHits, rewardScore, effectiveScore };
}
