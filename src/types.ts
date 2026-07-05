/** Analyzer → overlay data contract. See docs/overlay-ui-spec.md §11.
 *  The overlay is a pure renderer of this object: it never thresholds `score`
 *  or derives tierClass/verdict itself. */

/** Internal identifiers only — juiciness levels (§6): Faible/Moyen/Bon/
 *  Excellent/Legendaire. Kept as stable CSS/state hooks; user-facing text
 *  lives in RelicPanel's BADGE_LABEL. */
export type TierClass = "trash" | "low" | "good" | "splus" | "god";
/** §9 verdict logic: Skip / Run / Garder. */
export type Verdict = "SKIP" | "RUN" | "GARDER";

/** Letter-grade view of a 0-100 score (tablet stat+reward fit, or the Juice
 *  Score itself) — supplementary to `tierClass`/`tierLabel`, not a
 *  replacement. Computed in adapter.ts (never in the overlay, same rule as
 *  `tierClass`/`verdict`). */
export type Rating = "S" | "A" | "B" | "C" | "D";

export interface BreakdownEntry {
  key:
    | "itemRarity"
    | "monsterRarity"
    | "packSize"
    | "monsterEffectiveness"
    | "waystoneDropChance"
    | "quantity"
    | "penalty"
    | (string & {});
  label: string;
  /** Signed, display-final (1 decimal). Negative renders in danger styling. */
  value: number;
}

/** Per-mechanic Mechanic Match Score (§7), 0-100. */
export interface MechanicScore {
  mechanic: string;
  score: number;
}

export interface Modifier {
  text: string;
  kind: "positive" | "neutral" | "danger";
}

export interface Tablet {
  name: string;
  /** Heat gain, rendered "+12.3". */
  delta: number;
  /** One line, ≤ ~40 chars — written for the Compact card. */
  reason: string;
  /** Letter view of this tablet's stat+reward fit score (0-100) against the
   *  recommended mechanic. */
  rating: Rating;
  /** Individual reward line items (rewards.ts), already resolved to a
   *  display label + the exact number that contributed to this tablet's
   *  fit score. Omitted/empty when the tablet declares no `rewards` — the
   *  overlay only renders a rewards line when this is non-empty. */
  rewards?: { label: string; value: number }[];
}

export interface AnalysisResult {
  waystone: {
    tier: number;
    name: string;
    corrupted: boolean;
    modCount: number;
  };
  heat: {
    score: number;
    tierClass: TierClass;
    tierLabel: string;
    verdict: Verdict;
    /** Letter view of `score`, e.g. for "Rating: S (94.2)" — supplementary
     *  to tierClass/tierLabel, not a replacement. */
    rating: Rating;
    /** Display order; values sum to score. */
    breakdown: BreakdownEntry[];
  };
  /** Pre-sorted: danger > positive > neutral. */
  modifiers: Modifier[];
  /** Sorted by delta desc; Compact and Full both take up to 3. */
  tablets: Tablet[];
  /** At most one line, ≤ ~34 chars, or null. */
  warning: string | null;
  /** 0–3 short lines, Full mode only. */
  insights: string[];
  /** Mechanic Match Score per detected/candidate mechanic (§7), desc sorted. */
  mechanicScores: MechanicScore[];
  /** Best mechanic to target, or null if none scored above zero. */
  recommendedMechanic: string | null;
  /** 0-4 short "why this waystone" lines (strongest stats, mechanic match,
   *  reward presence) — a quick-scan summary, not new information beyond
   *  what `breakdown`/`mechanicScores`/`tablets` already contain. Empty
   *  when nothing stands out; the overlay hides the row entirely then. */
  keyFactors: string[];
}
