/** Merge the structural parser (parseWaystone) with the tolerant regex
 *  parser (parseMods) into a single, stable, always-safe stats reading.
 *  Ported from poe2-waystone-analyzer-v2/src/core/unified_parser.py.
 *
 *  parseWaystone is precise but can throw on unexpected input. parseMods
 *  is tolerant (never throws) but works on raw, noisy text and can pick
 *  up duplicate/near-duplicate values from unrelated parts of the item
 *  text. Reusing parseMods on the *clean* modifier lines that
 *  parseWaystone isolates gives a "primary" reading that is both precise
 *  (right text block) and consistent (same extraction rules). */

import { parseMods, type ModStats } from "./mod-parser";
import { parseWaystone } from "./parser";

const FIELDS = [
  "quantity",
  "itemRarity",
  "monsterRarity",
  "packSize",
  "monsterEffectiveness",
  "waystoneDropChance",
] as const;
const DEFAULT: ModStats = {
  quantity: 0,
  itemRarity: 0,
  monsterRarity: 0,
  packSize: 0,
  monsterEffectiveness: 0,
  waystoneDropChance: 0,
};

// Defensive upper bound: a value above this is implausible (e.g. a stray
// run of digits misread as a percentage).
const MAX_PLAUSIBLE_VALUE = 300;

function runPrimary(text: string): ModStats {
  try {
    const waystone = parseWaystone(text);
    return parseMods(waystone.modifiers.join("\n"));
  } catch {
    return { ...DEFAULT };
  }
}

function confidence(source: "primary" | "fallback", value: number): number {
  if (value <= 0) return 0;
  if (value > MAX_PLAUSIBLE_VALUE) return 0.1;
  return source === "primary" ? 0.9 : 0.6;
}

function mergeField(primaryValue: number, fallbackValue: number): number {
  const primaryScore = confidence("primary", primaryValue);
  const fallbackScore = confidence("fallback", fallbackValue);
  if (primaryScore === 0 && fallbackScore === 0) return 0;
  return primaryScore >= fallbackScore ? primaryValue : fallbackValue;
}

/** Never throws. Combines the precise and tolerant readings into one
 *  stable {quantity, rarity, packSize} result. */
export function parseUnified(text: string): ModStats {
  const primary = runPrimary(text);
  const fallback = parseMods(text);

  const merged: ModStats = { ...DEFAULT };
  for (const field of FIELDS) {
    merged[field] = mergeField(primary[field], fallback[field]);
  }
  return merged;
}
