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

// Per-stat cap used to normalize a raw stat value into a 0-1 "how strong
// is this" signal — used by mechanic scoring (adapter.ts's
// computeMechanicScores) and synergy bonuses. monsterRarity/
// monsterEffectiveness are still the original unsourced first-pass numbers
// (KNOWN_ISSUES #3) — web research 2026-07-08 couldn't confirm or correct
// them (conflicting/tablet-only data), so they're untouched.
//
// itemRarity/packSize (2026-07-09): were 200/150, wildly out of step with
// scoring.ts's RARITY_REFERENCE=100/PACK_SIZE_REFERENCE=30 — the SAME real
// god-map references the actual Juice Score uses, already user-validated
// in the 2026-07-06 scoring audit. Realigned to 100/30 that day.
//
// packSize (2026-07-10, revised again): 30 was itself too low — 7 real T15
// waystones pasted by the user this session show Pack Size from 7% up to
// 44%, and a real market listing (17 divine, i.e. a genuinely sought-after
// roll, not a fluke) showed 64%. maxroll.gg ("Rolling Waystones and
// Precursor Tablets") confirms a T15's base Pack Size mod rolls (41-50)% —
// already above the old 30 cap on its own. Raised to 100, matching how
// itemRarity/monsterRarity/monsterEffectiveness are already treated (a
// round, generous ceiling rather than a tight fit to the highest sample
// seen so far) — comfortable headroom above the observed 64% max. This
// deliberately reopens a gap against scoring.ts's PACK_SIZE_REFERENCE=30
// (still 30, untouched — that's the real Juice Score, user-validated
// 2026-07-06, out of scope for this pass): NORMALIZE_CAP now diverges from
// REFERENCE again, same shape of disagreement the 2026-07-09 fix closed,
// but this time NORMALIZE_CAP has the stronger, fresher sourcing. Flagged,
// not silently reintroduced — see KNOWN_ISSUES #3.
//
// waystoneDropChance (2026-07-10): same bug, same session — those same 7
// real waystones show Drop Chance from 80% up to 140%, already exceeding
// the old cap of 100 (and even scoring.ts's own DROP_CHANCE_REFERENCE=120).
// No external "mod tops out at X%" citation exists for this stat (unlike
// quantity/packSize), so 150 is an empirical choice: headroom above the
// highest confirmed real roll (140%), same margin logic as quantity's
// 29%-observed → 35-cap. Also diverges from DROP_CHANCE_REFERENCE=120,
// same flagged trade-off as packSize above.
export const NORMALIZE_CAP: Record<StatKey, number> = {
  itemRarity: 100,
  monsterRarity: 100,
  packSize: 100,
  monsterEffectiveness: 100,
  waystoneDropChance: 150,
  // Sourced 2026-07-08 (maxroll.gg "Rolling Waystones and Precursor
  // Tablets"): a T15 waystone's single Item Quantity mod line tops out at
  // (25-29)% — mod-parser.ts's `quantity` is a single-line max, never a
  // sum (extractMods keeps the strongest match, doesn't add), so that IS
  // the realistic ceiling. The old 200 meant even a perfect 29% roll only
  // contributed ~14.5% of the normalized signal — confirms and quantifies
  // KNOWN_ISSUES #3's standing suspicion that this suppressed
  // quantity-driven mechanic fits (Expedition's priority stat). 35 leaves
  // headroom above the confirmed real max, same margin TABLET_ROLL_CAP.
  // quantity=25 already uses over its own ~25% real ceiling.
  quantity: 35,
};

// Same idea, sized for a single TABLET roll: a tablet carries one shared-
// prefix mod of 10-25% (tablets.ts research pass), so judging it against
// the waystone-total scale above made even a perfect tablet score ~8/100
// on statFit — the whole 0-100 fit scale was dead above ~43 and every
// tablet displayed C/D forever (user report 2026-07-06). 25 ≈ a top roll
// of the shared prefix pool; waystoneDropChance 12 because Overseer's real
// roll is 5-10%. Passed by adapter.ts's rankTablets as the `caps` override.
export const TABLET_ROLL_CAP: Record<StatKey, number> = {
  itemRarity: 25,
  monsterRarity: 25,
  packSize: 25,
  monsterEffectiveness: 25,
  waystoneDropChance: 12,
  quantity: 25,
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
  caps: Record<StatKey, number> = NORMALIZE_CAP,
): number {
  const normalized = (key: StatKey) => Math.min(1, (profile[key] ?? 0) / caps[key]);
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
  caps: Record<StatKey, number> = NORMALIZE_CAP,
): number {
  return Math.round(scoreMechanicFitRaw(profile, mech, extraBonus, caps));
}

// Only mechanics with a real PoE2 tablet are modeled here (2026-07-10 —
// see TABLET_LINKED_MECHANICS in adapter.ts for the same list): Blight,
// Heist, Sanctum, Legion, Harvest, Metamorph, Essence, Incursion, and
// Bestiary were previously scored too (mechanicScores kept all 17) even
// though they could never surface as a tablet recommendation — dead
// weight the user asked to cut. Blight/Legion/Essence's keyword patterns
// stay in mechanic-patterns.ts: they still feed the real Juice Score's
// mechanic-density term (scoring.ts's SYNERGY_MECHANIC_IDS), a separate,
// still-useful signal unrelated to tablet-matching. The other six
// (Heist/Sanctum/Harvest/Metamorph/Incursion/Bestiary) had no other
// consumer and were removed from mechanic-patterns.ts too.
export const MECHANICS: MechanicDef[] = [
  // Community consensus 0.5 (switchbladegaming/timesaver/u4gm, 2026-07-06):
  // pack size drives splinter throughput in the fog; rarity (140%+ target)
  // and quantity (20-25%) scale what each fog kill is worth.
  {
    name: "Delirium",
    priorityStat: "packSize",
    secondaryStats: ["itemRarity", "quantity"],
    recommendedTablets: ["Delirium Tablet", "Standard Precursor Tablet"],
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
    recommendedTablets: ["Expedition Tablet", "Standard Precursor Tablet"],
    skipIfBelow: 35,
    detect: MECHANIC_PATTERNS.expedition,
  },
  // Fubgun 0.5 atlas strats (mobalytics, user-pasted tab text, 2026-07-10),
  // explicit ranking repeated verbatim in BOTH of his abyss strats (Jado and
  // Hilda): "1) pack size in map 2) monster rarity 3) rarity of items found
  // 4) monster effectiveness (not as good in this strat because you already
  // have so much)". Replaces the older mobalytics-tierlist/mmogah consensus
  // (monsterRarity priority, quantity secondary). monsterEffectiveness's
  // demotion is strat-specific (his mandatory tablet mods already stack it),
  // so it's merely dropped here, not treated as bad.
  {
    name: "Abyss",
    priorityStat: "packSize",
    secondaryStats: ["monsterRarity", "itemRarity"],
    recommendedTablets: ["Abyss Tablet", "Standard Precursor Tablet"],
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
    recommendedTablets: ["Ritual Tablet", "Standard Precursor Tablet"],
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
    recommendedTablets: ["Breach Tablet", "Standard Precursor Tablet"],
    skipIfBelow: 35,
    detect: MECHANIC_PATTERNS.breach,
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
    detect: MECHANIC_PATTERNS.irradiated,
  },
  {
    name: "Temple",
    priorityStat: "itemRarity",
    secondaryStats: ["packSize", "quantity"],
    recommendedTablets: ["Temple Tablet", "Standard Precursor Tablet"],
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
