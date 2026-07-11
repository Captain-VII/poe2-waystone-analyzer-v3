/** Mechanic table (cahier des charges §8/§10): which stat each league
 *  mechanic cares about most, which tablets suit it, and a keyword regex to
 *  flag when the mechanic is already naturally present on the map text.
 *  This is the bundled default — `meta-config.ts` overlays a user-editable
 *  meta.json on top of it. */

import type { ModStats } from "./mod-parser";
import { MECHANIC_PATTERNS } from "./mechanic-patterns";

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
  /** Keyword match flagging the mechanic as already on the map. Tested
   *  against `ParsedWaystone.contentText` (every block except the header —
   *  see parser.ts), never the item name/flavor — see adapter.ts's
   *  computeMechanicScores call site (KNOWN_ISSUES #4). Sourced from the
   *  shared `MECHANIC_PATTERNS` (mechanic-patterns.ts) — deliberately NOT
   *  meta.json-overridable (meta-config.ts's applyOverride never touches
   *  this field), so the bundled wording always applies regardless of
   *  user config. */
  detect?: RegExp;
}

/** 4-tier read of how strong a raw stat % is (2026-07-10, user's own
 *  gameplay judgment — not a web guide this time, see KNOWN_ISSUES.md):
 *  "0-15% = nul, 15-25% = ok, 25-50% = top, 50%+ = ultra/juicy/legendaire".
 *  Replaces the previous continuous per-stat cap/normalization entirely —
 *  see `scoreMechanicFitRaw`'s doc comment for what this superseded. */
export type StatTier = "weak" | "ok" | "top" | "legendary";

const TIER_BOUNDS: { belowPercent: number; tier: StatTier }[] = [
  { belowPercent: 15, tier: "weak" },
  { belowPercent: 25, tier: "ok" },
  { belowPercent: 50, tier: "top" },
  { belowPercent: Infinity, tier: "legendary" },
];

/** Which tier a raw stat % falls into, against the same 15/25/50 boundaries
 *  everywhere in the app now uses. Exported so scoring.ts's composite
 *  waystone score (2026-07-1x: dominant-stat-plus-bonus model) can reuse the
 *  exact same tiering instead of keeping its own copy. */
export function tierForPercent(value: number): StatTier {
  return TIER_BOUNDS.find((b) => value < b.belowPercent)!.tier;
}

/** Which tier a mechanic's PRIORITY stat falls into, given a stat profile
 *  (a waystone's parsed mods). Secondary stats no longer factor in at all
 *  (simplification, user's explicit call — `secondaryStats` stays on
 *  `MechanicDef`/meta.json only as user-facing/editable data, unused by
 *  scoring now). */
export function priorityStatTier(profile: Partial<Record<StatKey, number>>, mech: MechanicDef): StatTier {
  return tierForPercent(profile[mech.priorityStat] ?? 0);
}

// Representative 0-100 point value per tier — exists only so every caller
// that still needs a number (sorting mechanicScores, the tablet fit shown
// on hover, `scoreToRating`'s letter, the 0-100 AnalysisResult contract)
// keeps working unchanged. Never re-derived from a continuous formula
// anymore — a tier IS the score now. Chosen so "top"+`modCountBonus` (max
// +8) still clears the existing `keyFactors` "Strong X match" bar (score
// >= 50) on its own, matching top/legendary intuitively reading as strong.
// Exported so verify-adapter.mjs can compute exact expected scores instead
// of re-hardcoding these numbers in the test file (same reasoning as
// adapter.ts's exported `modCountBonus`).
export const TIER_SCORE: Record<StatTier, number> = { weak: 10, ok: 25, top: 55, legendary: 80 };

/** Old doc (kept for context, formula replaced 2026-07-10): used to cross a
 *  waystone's stat profile against a mechanic's priority/secondary stats
 *  (priority weighted 0.6, up to two secondaries at 0.2 each, continuous
 *  0-100). Removed after repeated conflicting-web-guide rework left the
 *  weights feeling arbitrary and hard to reason about (KNOWN_ISSUES.md) —
 *  replaced by `priorityStatTier`'s 4-tier read of the priority stat ALONE,
 *  sourced from the user's own gameplay judgment rather than another guide.
 *  Same call signature as before (`profile, mech, extraBonus`) so callers
 *  (`computeMechanicScores`/`rankTablets` in adapter.ts) didn't need to
 *  change. `extraBonus` still folds in anything additive-and-clamped
 *  (mod-count bonus, a tablet-name pin). Unrounded on purpose — ties are
 *  still possible (several mechanics can land in the same tier), broken by
 *  `extraBonus`/`rewardScore` at the call site, not here. */
export function scoreMechanicFitRaw(profile: Partial<Record<StatKey, number>>, mech: MechanicDef, extraBonus = 0): number {
  const score = TIER_SCORE[priorityStatTier(profile, mech)] + extraBonus;
  return Math.max(0, Math.min(100, score));
}

/** Display/contract version of `scoreMechanicFitRaw` — rounded to a whole
 *  0-100 number, same as every other user-facing score in this app. */
export function scoreMechanicFit(profile: Partial<Record<StatKey, number>>, mech: MechanicDef, extraBonus = 0): number {
  return Math.round(scoreMechanicFitRaw(profile, mech, extraBonus));
}

// Only mechanics with a real PoE2 tablet are modeled here (2026-07-10 —
// see TABLET_LINKED_MECHANICS in adapter.ts for the same list): Blight,
// Heist, Sanctum, Legion, Harvest, Metamorph, Essence, Incursion, and
// Bestiary were previously scored too (mechanicScores kept all 17) even
// though they could never surface as a tablet recommendation — dead
// weight the user asked to cut. Blight/Legion/Essence's keyword patterns
// stayed in mechanic-patterns.ts a while longer (they fed the real Juice
// Score's mechanic-density term) but that term itself was cut in the
// 2026-07-1x composite-score rework (scoring.ts) — they were removed from
// mechanic-patterns.ts in the same pass, alongside the other six
// (Heist/Sanctum/Harvest/Metamorph/Incursion/Bestiary), which had no other
// consumer to begin with.
export const MECHANICS: MechanicDef[] = [
  // Community consensus 0.5 (switchbladegaming/timesaver/u4gm, 2026-07-06):
  // pack size drives splinter throughput in the fog; rarity (140%+ target)
  // and quantity (20-25%) scale what each fog kill is worth.
  {
    name: "Delirium",
    priorityStat: "packSize",
    secondaryStats: ["itemRarity", "quantity"],
    recommendedTablets: ["Delirium Tablet", "Overseer Precursor Tablet"],
    skipIfBelow: 40,
    detect: MECHANIC_PATTERNS.delirium,
  },
  // Community consensus 0.5 (maxroll/aoeah/timesaver, 2026-07-06): logbook/
  // artifact quantity is the money stat, then runic/rare monster spawns;
  // pack size only helps chain detonations.
  {
    name: "Expedition",
    priorityStat: "quantity",
    secondaryStats: ["monsterRarity", "packSize"],
    recommendedTablets: ["Expedition Tablet", "Overseer Precursor Tablet"],
    skipIfBelow: 35,
    detect: MECHANIC_PATTERNS.expedition,
  },
  // Reverted 2026-07-10 (same day, later): the 2026-07-10 packSize-priority
  // change above (Fubgun's Jado/Hilda strats) was contradicted by two
  // independent sources found on a real waystone bug report (Abyss Tablet
  // scoring 35/100 despite +62% Monster Rarity): Mobalytics "Abyss Juicing
  // Tablet Tier List" (Perra) — "Pack Size is considered bait... Rare
  // Monster Modifier along with the Rarity of Items modifiers are most
  // important" — and Switchblade Gaming's waystone-rolling priority for
  // Abyss, "rare monster count → item quantity → monster effectiveness"
  // (pack size/monster rarity explicitly assigned to other mechanics
  // there). 2 sources against Fubgun's 1, and both converge with the
  // Abyss Tablet's own real roll (tablets.ts: "15% increased Rarity of
  // Monsters", written for the monsterRarity-priority model). "Rare
  // monster count" isn't a tracked StatKey (KNOWN_ISSUES #2) — monsterRarity
  // is the nearest tracked proxy, same convention used elsewhere.
  {
    name: "Abyss",
    priorityStat: "monsterRarity",
    secondaryStats: ["itemRarity", "quantity"],
    recommendedTablets: ["Abyss Tablet", "Overseer Precursor Tablet"],
    skipIfBelow: 30,
    detect: MECHANIC_PATTERNS.abyss,
  },
  // Community consensus 0.5 (mobalytics/exile.codex/aoeah, 2026-07-06):
  // tribute scales with magic/rare monster count and pack density — item
  // rarity does NOT affect ritual rewards, so it's dropped here.
  {
    name: "Ritual",
    priorityStat: "monsterRarity",
    secondaryStats: ["packSize", "monsterEffectiveness"],
    recommendedTablets: ["Ritual Tablet", "Overseer Precursor Tablet"],
    skipIfBelow: 35,
    detect: MECHANIC_PATTERNS.ritual,
  },
  // Fubgun 0.5 atlas strats (mobalytics, user-pasted tab text, 2026-07-10):
  // waystone line reads "you're looking for high item rarity and high
  // monster effectiveness", and among tablet mods "if you can only get one,
  // choose monster effectiveness". Neither Monster Rarity nor Pack Size is
  // mentioned — converges with the independent aoeah mirror ("pack size is
  // irrelevant / monster rarity mostly wasted — rare monster count in a
  // Breach is static", set by tablets, not map stats). Replaces the older
  // switchbladegaming/aoeah/boostmatch consensus (monsterRarity priority).
  // Single secondary on purpose — no padding with an explicitly-wasted stat.
  {
    name: "Breach",
    priorityStat: "monsterEffectiveness",
    secondaryStats: ["itemRarity"],
    recommendedTablets: ["Breach Tablet", "Overseer Precursor Tablet"],
    skipIfBelow: 35,
    detect: MECHANIC_PATTERNS.breach,
  },
  {
    name: "General",
    priorityStat: "itemRarity",
    secondaryStats: ["monsterRarity", "packSize"],
    recommendedTablets: ["Overseer Precursor Tablet"],
    skipIfBelow: 30,
  },
  {
    name: "Irradiated",
    priorityStat: "itemRarity",
    secondaryStats: ["monsterEffectiveness", "quantity"],
    recommendedTablets: ["Irradiated Tablet", "Overseer Precursor Tablet"],
    skipIfBelow: 30,
    detect: MECHANIC_PATTERNS.irradiated,
  },
  {
    name: "Temple",
    priorityStat: "itemRarity",
    secondaryStats: ["packSize", "quantity"],
    recommendedTablets: ["Temple Tablet", "Overseer Precursor Tablet"],
    skipIfBelow: 30,
    detect: MECHANIC_PATTERNS.temple,
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
