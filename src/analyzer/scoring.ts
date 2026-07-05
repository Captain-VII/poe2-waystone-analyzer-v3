/** Juice Score engine for PoE2 waystones (cahier des charges §2/§6): a
 *  single 0-100 composite over the "signaux metiers" the spec calls out —
 *  Item Rarity, Monster Rarity, Pack Size, Monster Effectiveness, Waystone
 *  Drop Chance, Item Quantity — deliberately NOT a per-suffix/prefix point
 *  ledger. One profile, not five: the cahier des charges wants one clear
 *  answer, not archetype tuning. Hard-block/speed-penalty/positive-mod
 *  detection from the prior v2-ported engine is kept as-is — it's still
 *  the right signal for "does this map actively fight the loop." */

import { PATTERNS as NUMERIC_PATTERNS, type ModStats } from "./mod-parser";

export interface Weights {
  itemRarity: number;
  monsterRarity: number;
  packSize: number;
  monsterEffectiveness: number;
  waystoneDropChance: number;
  quantity: number;
}

// Per-stat ceiling applied before weighting: keeps the score stable and
// normalized even if a garbled outlier value gets parsed.
export const CAPS: ModStats = {
  itemRarity: 200,
  monsterRarity: 100,
  packSize: 150,
  monsterEffectiveness: 100,
  waystoneDropChance: 100,
  quantity: 200,
};

// Weight = (max points this field can contribute at its cap) / cap.
// Max contributions sum to 100 (§2: item rarity/monster rarity/pack size
// weighted highest, monster effectiveness medium-high, quantity/drop
// chance minor) — bonuses/penalties are applied on top and the final
// score is clamped back into [0, 100].
//
// NOT meta.json-driven: unlike mechanics.ts/tablets.ts, these weights (and
// CAPS/DEFAULT_THRESHOLD/the three pattern tables below) are hardcoded here
// and read by nothing in meta-config.ts. Tuning them requires editing this
// file and rebuilding — see README's "Tuning the scoring" section.
export const DEFAULT_WEIGHTS: Weights = {
  itemRarity: 22 / CAPS.itemRarity,
  monsterRarity: 20 / CAPS.monsterRarity,
  packSize: 22 / CAPS.packSize,
  monsterEffectiveness: 16 / CAPS.monsterEffectiveness,
  waystoneDropChance: 10 / CAPS.waystoneDropChance,
  quantity: 10 / CAPS.quantity,
};

export const DEFAULT_THRESHOLD = 20; // below this: SKIP (§9)

// Dangerous mods, split by how they hit profit/hour:
// hardBlock: actively fights the loop -> skip outright.
// speedPenalty: slows the loop without bricking it -> score multiplied down.
const HARD_BLOCK_PATTERNS: Record<string, RegExp> = {
  // Real PoE2 wording is "Monsters reflect 18% of Elemental Damage" — allow
  // any short run of characters (the "18% of Elemental" part) between the
  // verb and "damage", not just a single bare word.
  "reflect damage": /reflect(?:s|ed)?\b[^\n]{0,30}?damage/i,
  "cannot leech": /cannot\s+leech/i,
  "no regeneration": /no\s+.*regenerat/i,
};

const SPEED_PENALTY_PATTERNS: Record<string, [RegExp, number]> = {
  "reduced recovery": [/reduced\s+.*recovery/i, 0.8],
  "less regeneration": [/less\s+.*regenerat/i, 0.8],
  "avoid ailments": [/avoid(?:s|ed)?\s+.*ailments?/i, 0.9],
  "temporal slowing effects": [/(?:reduced|less)\s+.*action\s+speed|temporal\s+chains/i, 0.85],
};

// Positive mods: signals that increase profit/hour beyond what the raw
// stat numbers already capture — additive flat bonus.
const POSITIVE_MOD_PATTERNS: Record<string, [RegExp, number]> = {
  "more rare monsters": [/(?:increased|additional).*rare\s+monsters/i, 6.0],
  "more magic monsters": [/(?:increased|additional).*magic\s+monsters/i, 4.0],
  "extra content: ritual": [/\britual\b/i, 10.0],
  "extra content: breach": [/\bbreach(?:es)?\b/i, 10.0],
  "extra content: delirium": [/\bdelirium\b/i, 8.0],
  "extra content: expedition": [/\bexpedition\b/i, 8.0],
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

function breakdownFields(
  stats: ModStats,
  weights: Weights,
  caps: ModStats,
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

export interface PenaltyDetail {
  reason: string;
  multiplier: number;
}
export interface BonusDetail {
  reason: string;
  bonus: number;
}

export interface ModAnalysis {
  hardBlock: boolean;
  hardBlockReasons: string[];
  penaltyDetails: PenaltyDetail[];
}

export function analyzeMapMods(text: string): ModAnalysis {
  const result: ModAnalysis = { hardBlock: false, hardBlockReasons: [], penaltyDetails: [] };
  if (!text) return result;

  for (const [reason, pattern] of Object.entries(HARD_BLOCK_PATTERNS)) {
    if (pattern.test(text)) {
      result.hardBlock = true;
      result.hardBlockReasons.push(reason);
    }
  }
  for (const [reason, [pattern, multiplier]] of Object.entries(SPEED_PENALTY_PATTERNS)) {
    if (pattern.test(text)) result.penaltyDetails.push({ reason, multiplier });
  }
  return result;
}

/** Classifies a single raw modifier line for display (§5 modifiers[].kind). */
export function classifyModifierKind(text: string): "positive" | "neutral" | "danger" {
  for (const pattern of Object.values(HARD_BLOCK_PATTERNS)) {
    if (pattern.test(text)) return "danger";
  }
  for (const [pattern] of Object.values(SPEED_PENALTY_PATTERNS)) {
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
  score: number;
  decision: "run" | "skip";
  hardBlock: boolean;
  hardBlockReasons: string[];
  breakdown: Record<keyof Weights, FieldContribution>;
  bonusDetails: BonusDetail[];
  penaltyDetails: PenaltyDetail[];
  /** before-penalties total minus after-penalties total — the single
   *  display-ready "penalty" delta, reconciling exactly with `score`. */
  penaltyDelta: number;
}

/** Composite Juice Score (§6): weighted signals + extra-content bonus,
 *  gated by hard-block/speed-penalty mods. Output contract: {score,
 *  decision, breakdown, bonusDetails, penaltyDetails, hardBlock*}. */
export function evaluateMap(
  stats: ModStats,
  rawText = "",
  weights: Weights = DEFAULT_WEIGHTS,
  threshold: number = DEFAULT_THRESHOLD,
): EvaluationResult {
  const breakdown = breakdownFields(stats, weights, CAPS);
  const baseScore = round2(Object.values(breakdown).reduce((sum, f) => sum + f.contribution, 0));

  const mods = analyzeMapMods(rawText);
  const bonusDetails = detectPositiveMods(rawText);
  const penaltyDetails = mods.penaltyDetails;

  const beforePenalties = baseScore + bonusDetails.reduce((sum, b) => sum + b.bonus, 0);

  if (mods.hardBlock) {
    return {
      score: 0,
      decision: "skip",
      hardBlock: true,
      hardBlockReasons: mods.hardBlockReasons,
      breakdown,
      bonusDetails,
      penaltyDetails,
      penaltyDelta: 0,
    };
  }

  let finalScore = baseScore + bonusDetails.reduce((sum, b) => sum + b.bonus, 0);
  for (const p of penaltyDetails) finalScore *= p.multiplier;
  finalScore = round2(Math.max(0, Math.min(100, finalScore)));

  const decision = finalScore >= threshold ? "run" : "skip";

  return {
    score: finalScore,
    decision,
    hardBlock: false,
    hardBlockReasons: [],
    breakdown,
    bonusDetails,
    penaltyDetails,
    penaltyDelta: round2(beforePenalties - finalScore),
  };
}
