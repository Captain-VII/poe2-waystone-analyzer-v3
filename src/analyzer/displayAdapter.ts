/** Display layer for the Juice Score (2026-07-06): separates CALCULATION
 *  (scoring.ts's `evaluateMap` — normalized 0-100 model, synergy, danger
 *  penalty) from DISPLAY (this file). `heat.breakdown` in adapter.ts shows
 *  derived point deltas (e.g. "+5.4") that don't mean anything to a player
 *  comparing against in-game mod text — `buildDisplayData` instead surfaces
 *  the REAL parsed stat percentages (e.g. "+39% Item Rarity") as the
 *  primary, trustworthy information, with the score as secondary context.
 *
 *  Nothing here re-derives scoring math: every number comes straight off
 *  `EvaluationResult`, so scoring.ts stays the single source of truth. */

import type { ModStats } from "./mod-parser";
import { computeDangerLevel, dangerHitsToWarnings, type DangerLevel, type EvaluationResult } from "./scoring";

export type ScoreLabel = "Bad" | "Average" | "Good" | "Excellent";

/** Coarse, player-facing read of a 0-100 score — separate from adapter.ts's
 *  `tierClass`/`rating` (which drive UI tier bands/letter grades elsewhere);
 *  this is only ever used inside `DisplayData`. */
export function getScoreLabel(score: number): ScoreLabel {
  if (score < 25) return "Bad";
  if (score < 50) return "Average";
  if (score < 70) return "Good";
  return "Excellent";
}

export interface DisplayData {
  /** Real, parsed map stats — always the PRIMARY information a player reads,
   *  never a derived scoring component. Formatted straight from `ModStats`,
   *  e.g. "+39%", matching the wording on the item itself. */
  stats: {
    itemRarity: string;
    packSize: string;
    monsterRarity: string;
    monsterEffectiveness: string;
    dropChance: string;
  };
  /** SECONDARY information: the Juice Score, for context only. */
  score: {
    value: number;
    label: ScoreLabel;
    rewardScore: number;
    effectiveScore: number;
  };
  /** How `score` was arrived at, decomposed for transparency — not a fake
   *  per-stat number, just the three real stages of the pipeline. */
  breakdown: {
    baseScore: number;
    synergyBonus: number;
    dangerPenalty: number;
  };
  danger: {
    level: DangerLevel;
    warnings: string[];
  };
}

/** Single source of truth for "raw stat number" -> "real, on-item-matching
 *  percentage string" — reused by adapter.ts's `heat.breakdown` so the real
 *  overlay panel shows the same real percentages this module was built to
 *  surface, instead of re-deriving its own formatting. */
export function formatPercent(value: number): string {
  return `+${Math.round(value)}%`;
}

/** Builds the player-facing view of a waystone: real stat percentages
 *  first, the Juice Score and its breakdown second. Takes the already-
 *  computed `EvaluationResult` (rather than re-running `evaluateMap`
 *  itself) so callers that need both the raw evaluation and this display
 *  view (adapter.ts) don't pay for the analysis twice. */
export function buildDisplayData(stats: ModStats, evaluation: EvaluationResult): DisplayData {
  const dangerLevel = computeDangerLevel(evaluation.dangerHits);
  const warnings = dangerHitsToWarnings(evaluation.dangerHits);

  return {
    stats: {
      itemRarity: formatPercent(stats.itemRarity),
      packSize: formatPercent(stats.packSize),
      monsterRarity: formatPercent(stats.monsterRarity),
      monsterEffectiveness: formatPercent(stats.monsterEffectiveness),
      dropChance: formatPercent(stats.waystoneDropChance),
    },
    score: {
      value: evaluation.score,
      label: getScoreLabel(evaluation.score),
      rewardScore: evaluation.rewardScore,
      effectiveScore: evaluation.effectiveScore,
    },
    breakdown: {
      baseScore: evaluation.baseScore,
      synergyBonus: evaluation.synergyBonus,
      dangerPenalty: evaluation.dangerPenalty,
    },
    danger: {
      level: dangerLevel,
      warnings,
    },
  };
}
