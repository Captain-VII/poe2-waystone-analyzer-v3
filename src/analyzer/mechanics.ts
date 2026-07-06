/** Mechanic table (cahier des charges §8/§10): which stat each league
 *  mechanic cares about most, which tablets suit it, and a keyword regex to
 *  flag when the mechanic is already naturally present on the map text.
 *  This is the bundled default — `meta-config.ts` overlays a user-editable
 *  meta.json on top of it. */

import type { ModStats } from "./mod-parser";

export type StatKey = keyof ModStats;

export interface MechanicDef {
  /** Display name, matches §8. */
  name: string;
  priorityStat: StatKey;
  secondaryStats: StatKey[];
  /** Optional manual pin: these tablet names get a fit-score bonus (see
   *  `scoreMechanicFit`'s `extraBonus`) so curated picks still surface
   *  first, but tablets are otherwise ranked automatically by stat fit —
   *  a new tablet added only to tablets.ts/meta.json's data needs no entry
   *  here to become eligible. */
  recommendedTablets?: string[];
  /** Below this Juice Score, this mechanic isn't worth chasing (§10). */
  skipIfBelow: number;
  /** Keyword match against raw modifier text: mechanic already on the map. */
  detect?: RegExp;
}

// Per-stat cap used to normalize a raw stat value (waystone mod magnitude,
// or a tablet's own boost magnitude) into a 0-1 "how strong is this"
// signal — shared by mechanic scoring (adapter.ts's computeMechanicScores)
// and tablet-fit scoring (adapter.ts's rankTablets) so both use one scale.
export const NORMALIZE_CAP: Record<StatKey, number> = {
  itemRarity: 200,
  monsterRarity: 100,
  packSize: 150,
  monsterEffectiveness: 100,
  waystoneDropChance: 100,
  quantity: 200,
};

/** Crosses any stat profile (a waystone's parsed mods, or a tablet's parsed
 *  boosts) against a mechanic's priority/secondary stats: priority weighted
 *  0.6, up to two secondary stats at 0.2 each, scaled to 0-100. `extraBonus`
 *  folds in anything additive-and-clamped (mechanic "naturally present on
 *  the map" detection, or a tablet-name pin) without duplicating the
 *  weighting math at each call site.
 *
 *  Unrounded — several mechanics share the same priority/secondary stats,
 *  so a rounded score produces frequent exact ties; callers that need to
 *  *rank/sort* mechanics or tablets should compare this raw value (see
 *  adapter.ts's computeMechanicScores/rankTablets), not the rounded
 *  `scoreMechanicFit` below, or ties silently fall back to array
 *  declaration order instead of reflecting the actual stat profile. */
export function scoreMechanicFitRaw(
  profile: Partial<Record<StatKey, number>>,
  mech: MechanicDef,
  extraBonus = 0,
): number {
  const normalized = (key: StatKey) => Math.min(1, (profile[key] ?? 0) / NORMALIZE_CAP[key]);
  let score = 0.6 * normalized(mech.priorityStat);
  for (const sec of mech.secondaryStats.slice(0, 2)) score += 0.2 * normalized(sec);
  score = score * 100 + extraBonus;
  return Math.max(0, Math.min(100, score));
}

/** Display/contract version of `scoreMechanicFitRaw` — rounded to a whole
 *  0-100 number, same as every other user-facing score in this app. */
export function scoreMechanicFit(
  profile: Partial<Record<StatKey, number>>,
  mech: MechanicDef,
  extraBonus = 0,
): number {
  return Math.round(scoreMechanicFitRaw(profile, mech, extraBonus));
}

export const MECHANICS: MechanicDef[] = [
  {
    name: "Blight",
    priorityStat: "monsterEffectiveness",
    secondaryStats: ["itemRarity", "packSize"],
    recommendedTablets: ["Expedition Tablet", "Standard Precursor Tablet"],
    skipIfBelow: 35,
    detect: /\bblight\b/i,
  },
  {
    name: "Delirium",
    priorityStat: "packSize",
    secondaryStats: ["itemRarity", "monsterRarity"],
    recommendedTablets: ["Delirium Tablet", "Standard Precursor Tablet"],
    skipIfBelow: 40,
    detect: /\bdelirium\b/i,
  },
  {
    name: "Expedition",
    priorityStat: "monsterEffectiveness",
    secondaryStats: ["packSize", "waystoneDropChance"],
    recommendedTablets: ["Expedition Tablet", "Standard Precursor Tablet"],
    skipIfBelow: 35,
    detect: /\bexpedition\b/i,
  },
  {
    name: "Heist",
    priorityStat: "itemRarity",
    secondaryStats: ["quantity"],
    recommendedTablets: ["Standard Precursor Tablet"],
    skipIfBelow: 30,
    detect: /\bheist\b|blueprint|contract/i,
  },
  {
    name: "Sanctum",
    priorityStat: "itemRarity",
    secondaryStats: ["monsterRarity"],
    recommendedTablets: ["Standard Precursor Tablet"],
    skipIfBelow: 30,
    detect: /\bsanctum\b|focus relic/i,
  },
  {
    name: "Legion",
    priorityStat: "packSize",
    secondaryStats: ["monsterRarity", "itemRarity"],
    recommendedTablets: ["Standard Precursor Tablet"],
    skipIfBelow: 35,
    detect: /\blegion\b/i,
  },
  {
    name: "Harvest",
    priorityStat: "itemRarity",
    secondaryStats: ["quantity"],
    recommendedTablets: ["Standard Precursor Tablet"],
    skipIfBelow: 30,
    detect: /\bharvest\b/i,
  },
  {
    name: "Metamorph",
    priorityStat: "monsterEffectiveness",
    secondaryStats: ["itemRarity"],
    recommendedTablets: ["Standard Precursor Tablet"],
    skipIfBelow: 30,
    detect: /\bmetamorph\b|catalyst/i,
  },
  {
    name: "Abyss",
    priorityStat: "packSize",
    secondaryStats: ["monsterRarity", "quantity"],
    recommendedTablets: ["Abyss Tablet", "Standard Precursor Tablet"],
    skipIfBelow: 30,
    detect: /\babyss(?:al)?\b/i,
  },
  {
    name: "Ritual",
    priorityStat: "monsterRarity",
    secondaryStats: ["itemRarity", "packSize"],
    recommendedTablets: ["Ritual Tablet", "Standard Precursor Tablet"],
    skipIfBelow: 35,
    detect: /\britual\b/i,
  },
  {
    name: "Breach",
    priorityStat: "monsterEffectiveness",
    secondaryStats: ["packSize", "monsterRarity"],
    recommendedTablets: ["Breach Tablet", "Standard Precursor Tablet"],
    skipIfBelow: 35,
    detect: /\bbreach(?:es)?\b/i,
  },
  {
    name: "Essence",
    priorityStat: "monsterRarity",
    secondaryStats: ["itemRarity"],
    recommendedTablets: ["Standard Precursor Tablet"],
    skipIfBelow: 30,
    detect: /\bessence\b/i,
  },
  {
    name: "Incursion",
    priorityStat: "itemRarity",
    secondaryStats: ["packSize"],
    recommendedTablets: ["Standard Precursor Tablet"],
    skipIfBelow: 30,
    detect: /\bincursion\b|architect'?s? hand/i,
  },
  {
    name: "Bestiary",
    priorityStat: "monsterRarity",
    secondaryStats: ["packSize"],
    recommendedTablets: ["Standard Precursor Tablet"],
    skipIfBelow: 30,
    detect: /\bbestiary\b|beast(?:s)?\b/i,
  },
  {
    name: "General",
    priorityStat: "itemRarity",
    secondaryStats: ["monsterRarity", "packSize"],
    recommendedTablets: ["Standard Precursor Tablet", "Overseer Precursor Tablet"],
    skipIfBelow: 30,
  },
  {
    name: "Irradiated",
    priorityStat: "itemRarity",
    secondaryStats: ["monsterEffectiveness", "quantity"],
    recommendedTablets: ["Irradiated Tablet", "Standard Precursor Tablet"],
    skipIfBelow: 30,
    detect: /\birradiat(?:ed|ion)\b/i,
  },
  {
    name: "Temple",
    priorityStat: "itemRarity",
    secondaryStats: ["packSize", "quantity"],
    recommendedTablets: ["Temple Tablet", "Standard Precursor Tablet"],
    skipIfBelow: 30,
    detect: /\btemple\b|vaal beacon/i,
  },
];

let active: MechanicDef[] = MECHANICS;

/** Overlays meta-config.ts's parsed meta.json onto the bundled defaults —
 *  read by adapter.ts's computeMechanicScores instead of MECHANICS
 *  directly, so a user edit takes effect without a rebuild. */
export function setActiveMechanics(overrides: MechanicDef[]): void {
  active = overrides;
}

export function getActiveMechanics(): MechanicDef[] {
  return active;
}
