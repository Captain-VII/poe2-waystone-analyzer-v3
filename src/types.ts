/** Analyzer → overlay data contract. See docs/overlay-ui-spec.md §11.
 *  The overlay is a pure renderer of this object: it never thresholds `score`
 *  or derives tierClass/verdict itself. */

/** Internal identifiers only — juiciness levels (§6): Faible/Moyen/Bon/
 *  Excellent/Legendaire. Kept as stable CSS/state hooks; user-facing text
 *  lives in RelicPanel's BADGE_LABEL. */
export type TierClass = "trash" | "low" | "good" | "splus" | "god";
/** §9 verdict logic: Skip / Run / Garder. */
export type Verdict = "SKIP" | "RUN" | "GARDER";

/** At-a-glance danger signal, derived ONLY from `warnings` — never from
 *  `score`. Fully independent of the Juice Score: a "high" danger map can
 *  still carry a 94+ score, and vice versa. See `warnings` below. */
export type DangerLevel = "none" | "low" | "medium" | "high";

/** One detected danger mod, display-ready: `label` is the UI text (resolved
 *  adapter-side from the stable internal `id`), `severity` is already
 *  collapsed to the UI's 3-tier scale (adapter.ts maps scoring.ts's
 *  internal reflect/strong/moderate/minor down to this — the overlay never
 *  sees or computes that internal vocabulary, same pure-renderer rule as
 *  tierClass/verdict). Sorted most-severe-first; `.map(h => h.label)`
 *  equals `warnings`. */
export interface DangerHitView {
  id: string;
  label: string;
  severity: "high" | "medium" | "low";
}

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
  /** Pre-sorted: danger > positive > neutral.
   *  `modifiers` and `mechanicScores` are computed but not currently used
   *  in UI. They are REQUIRED by verify-adapter.mjs tests and part of the
   *  data contract. Do not remove without updating tests. */
  modifiers: Modifier[];
  /** Sorted by delta desc; Compact and Full both take up to 3. */
  tablets: Tablet[];
  /**
   * warning:
   * - The single most severe danger/annoyance mod on this waystone (if any),
   *   sized for the space-constrained Compact card / mini-badge tooltip.
   * - Equal to `warnings[0] ?? null`.
   * - Danger/annoyance mods (reflect, no leech/regen, fast monsters,
   *   elemental penetration, ...) NEVER affect `score`/`verdict`/`tierClass`
   *   — the Juice Score measures loot potential only. Danger is communicated
   *   exclusively through `warning`/`warnings`.
   * - Do NOT change wording of pinned-regression warnings without updating
   *   tests (scripts/verify-adapter.mjs).
   *
   * At most one line, ≤ ~34 chars, or null.
   */
  warning: string | null;
  /** Every detected danger/annoyance mod, most-severe-first. Full mode
   *  renders the whole list; Compact/mini use `warning` (the first entry)
   *  only, per the Compact card's single-line warning strip. Same
   *  never-affects-score guarantee as `warning` above. */
  warnings: string[];
  /** Structured view of the same detected danger mods as `warnings`
   *  (1:1, same order) with per-hit severity for visual grouping. Full
   *  mode's danger list renders from this; `warnings` stays for the
   *  Compact strip and any consumer that only needs text. */
  dangerHits: DangerHitView[];
  /** Derived purely from `warnings` (see `DangerLevel`) — never from
   *  `score`. UI-only signal, independent of tier/verdict/score. */
  dangerLevel: DangerLevel;
  /** Human-readable label for `dangerLevel` ("Safe"/"Manageable"/
   *  "Dangerous"/"Very Dangerous"), for UI display only. */
  dangerLabel: string;
  /** 0–3 short lines, Full mode only. */
  insights: string[];
  /** Mechanic Match Score per detected/candidate mechanic (§7), desc sorted.
   *  Not currently used in UI. REQUIRED by verify-adapter.mjs tests and
   *  part of the data contract. Do not remove without updating tests. */
  mechanicScores: MechanicScore[];
  /** Best mechanic to target, or null if none scored above zero. */
  recommendedMechanic: string | null;
  /** 0-4 short "why this waystone" lines (strongest stats, mechanic match,
   *  reward presence) — a quick-scan summary, not new information beyond
   *  what `breakdown`/`mechanicScores`/`tablets` already contain. Empty
   *  when nothing stands out; the overlay hides the row entirely then. */
  keyFactors: string[];
}
