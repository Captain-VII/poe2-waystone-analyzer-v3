/** Juice Score engine for PoE2 waystones: a single 0-100 composite over the
 *  loot-potential signals only — Item Rarity, Monster Rarity, Pack Size,
 *  Monster Effectiveness, Waystone Drop Chance, Item Quantity — deliberately
 *  NOT a per-suffix/prefix point ledger. One profile, not five: one clear
 *  answer, not archetype tuning.
 *
 *  Danger/annoyance mods (reflect, no leech/regen, reduced recovery, fast
 *  monsters, elemental penetration, ...) are detected here too, but purely
 *  for display (`warning`/`warnings` in the analyzer output) — they NEVER
 *  reduce or zero `score`. Score = loot potential only; danger is a fully
 *  separate signal. */

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
// CAPS/DEFAULT_THRESHOLD/the pattern tables below) are hardcoded here and
// read by nothing in meta-config.ts. Tuning them requires editing this file
// and rebuilding — see README's "Tuning via meta.json" section.
export const DEFAULT_WEIGHTS: Weights = {
  itemRarity: 22 / CAPS.itemRarity,
  monsterRarity: 20 / CAPS.monsterRarity,
  packSize: 22 / CAPS.packSize,
  monsterEffectiveness: 16 / CAPS.monsterEffectiveness,
  waystoneDropChance: 10 / CAPS.waystoneDropChance,
  quantity: 10 / CAPS.quantity,
};

export const DEFAULT_THRESHOLD = 20; // below this: SKIP (§9)

// Danger/annoyance mods — detected for display only (`warning`/`warnings`/
// `dangerLevel`), never applied to `score`. `id` is a stable internal key
// (never shown to the user, never changes with wording/localization);
// `label` is the current UI-facing text, looked up from `id` only when
// building `warnings` for display. This split is deliberate: `dangerLevel`
// is computed from `severity` (via `DangerHit[]`, see below) and must never
// depend on `label` — renaming/relocalizing a label can't silently change
// danger logic.
//
// `severity` feeds `computeDangerLevel` below only — it never touches
// `score`. "reflect" is its own tier (heavily weighted, see
// computeDangerLevel); "strong" mods actively hurt survivability/leech
// (crit/penetration/speed/no-leech/no-regen); "moderate" slow the loop
// without threatening it; "minor" is cosmetic annoyance.
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

/** All matched danger/annoyance mods on this map, in pattern-table order —
 *  display/level-computation input only, never applied to `score` (see the
 *  file-level comment). */
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
 *  warning can never change this. Also never derived from raw text or
 *  `score`, keeping it fully independent of the Juice Score. Deliberately
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
  score: number;
  decision: "run" | "skip";
  breakdown: Record<keyof Weights, FieldContribution>;
  bonusDetails: BonusDetail[];
  /** Danger/annoyance mods detected on this map (structured, string-free) —
   *  display/level-computation input only, never applied to `score`. */
  dangerHits: DangerHit[];
}

/** Composite Juice Score: weighted loot-signal fields + extra-content bonus.
 *  Danger/annoyance mods are detected (`dangerHits`) but never change
 *  `score` — see the file-level comment. */
export function evaluateMap(
  stats: ModStats,
  rawText = "",
  weights: Weights = DEFAULT_WEIGHTS,
  threshold: number = DEFAULT_THRESHOLD,
): EvaluationResult {
  const breakdown = breakdownFields(stats, weights, CAPS);
  const baseScore = round2(Object.values(breakdown).reduce((sum, f) => sum + f.contribution, 0));

  const bonusDetails = detectPositiveMods(rawText);
  const dangerHits = detectDangerHits(rawText);

  const score = round2(Math.max(0, Math.min(100, baseScore + bonusDetails.reduce((sum, b) => sum + b.bonus, 0))));
  const decision = score >= threshold ? "run" : "skip";

  return { score, decision, breakdown, bonusDetails, dangerHits };
}
