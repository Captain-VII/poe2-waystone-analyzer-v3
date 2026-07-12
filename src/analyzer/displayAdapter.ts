/** Small display helpers shared by adapter.ts (2026-07-06). Nothing here
 *  re-derives scoring math — everything is a straight formatting/banding
 *  function over a number scoring.ts already computed. */

export type ScoreLabel = "Bad" | "Average" | "Good" | "Excellent";

/** Coarse, player-facing read of a 0-100 score — separate from adapter.ts's
 *  `tierClass`/`rating` (which drive UI tier bands/letter grades elsewhere).
 *  Bands deliberately sit on the same 20/40/60 boundaries as adapter.ts's
 *  TIER_BANDS (Bad = trash, Average = low, Good = good, Excellent = splus +
 *  god) so the overlay never shows an "EXCELLENT" tier badge next to a
 *  "Good" score label. */
export function getScoreLabel(score: number): ScoreLabel {
  if (score < 20) return "Bad";
  if (score < 40) return "Average";
  if (score < 60) return "Good";
  return "Excellent";
}

/** Single source of truth for "raw stat number" -> "real, on-item-matching
 *  percentage string" — reused by adapter.ts's `heat.breakdown` so the real
 *  overlay panel shows the same real percentages a player sees on the item
 *  itself, instead of re-deriving its own formatting. */
export function formatPercent(value: number): string {
  return `+${Math.round(value)}%`;
}
