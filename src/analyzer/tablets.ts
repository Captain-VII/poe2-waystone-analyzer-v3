/** Tablet definitions (cahier des charges §2). Data-driven: each tablet
 *  declares its stat boosts as plain PoE2-style mod text (e.g. "30%
 *  increased Monster Effectiveness"), parsed through `mod-parser.ts`'s
 *  already-tolerant regex — the same matcher proven against real waystone
 *  text — instead of a second hand-rolled parser. `meta-config.ts` overlays
 *  user tablets from meta.json on top of `DEFAULT_TABLETS` at load time,
 *  same pattern as mechanics.ts, so adding a tablet never requires a code
 *  change or rebuild.
 *
 *  Tablets are matched to mechanics by stat-fit (`scoreMechanicFit` in
 *  mechanics.ts), not by name — a new tablet is automatically eligible for
 *  every mechanic its boosts fit, with no `recommendedTablets` list to
 *  maintain per mechanic.
 *
 *  **Re-verified 2026-07-12 against a real data-mined source:**
 *  repoe-fork.github.io/poe2/mods.json (a fork of the RePoE tool-dev data
 *  export, `"domain": "tablet"` entries — genuinely mined from the game's
 *  files, not a wiki summary). This corrected two things earlier passes
 *  got wrong from wiki/poe2db.tw sourcing:
 *  1. **"Standard Precursor Tablet" was never real** — the data-mined
 *     source has an implicit "Adds [mechanic] to a Map" mod for exactly
 *     **eight** real base types — Breach, Ritual, Delirium, Expedition,
 *     Irradiated, Overseer, Abyss, Temple (Temple = Incursion/Vaal
 *     Beacons internally) — no generic ninth type. Removed outright
 *     rather than kept as a plausible-looking fiction. Legion, Heist,
 *     Sanctum, Harvest, Metamorph, Essence, and Bestiary still have no
 *     dedicated tablet at all (a `mechanics.ts` fact, not a gap here —
 *     see KNOWN_ISSUES.md #2).
 *  2. **"Every real tablet is Magic rarity, 1 prefix + 1 suffix max" was
 *     wrong** — two real in-game item texts (pasted by the user) proved a
 *     Normal-rarity tablet has *zero* mods (just the base "Adds
 *     [mechanic] to a Map, 10 uses" implicit) while a well-rolled Rare
 *     tablet can carry **4** (2 prefixes + 2 suffixes). Each `mods` entry
 *     below now represents a well-rolled Rare tablet — up to 2 prefix + 2
 *     suffix lines — not an exhaustive roll table, and not every possible
 *     combination (a real tablet still only has 2 of each at once). All
 *     four shared-pool prefixes (Item Rarity/Monster Rarity/Pack
 *     Size/Monster Effectiveness) are available to every one of the eight
 *     real tablets equally; when a slot has more tracked-stat options than
 *     it has room for, the ones picked are a reasoned, mechanic-themed
 *     choice (documented per entry) in the absence of market data on
 *     which roll players actually prioritize — a user with a differently-
 *     rolled real tablet overrides it via meta.json's "tablets" array.
 *     Duplicating a stat key across two lines on the same tablet is
 *     avoided on purpose: `mod-parser.ts` keeps the max value per stat
 *     across all lines, not a sum, so a repeated key would just waste a
 *     slot. The mechanic-specific types' real value is also partly in
 *     mechanic-specific currency (Breach Splinters, Expedition
 *     Artifacts/Logbooks, Ritual Tribute, Delirium Simulacrum Splinters)
 *     — that's what `rewards` (rewards.ts) represents, kept separate from
 *     `mods`.
 *
 *  Every real per-tablet pool includes plenty of mods outside this app's
 *  six tracked stats (Experience, Gold, monster/rare-monster *density*
 *  rather than rarity%, chest/Essence/Shrine/Strongbox chance, mechanic-
 *  scoped effects like "Effectiveness of Rare Breach Monsters") —
 *  deliberately left out, not a gap (see KNOWN_ISSUES.md #2). Replace any
 *  entry's exact mod wording once a more precise/updated source turns up;
 *  no other code needs to change either way. */

import { parseMods } from "./mod-parser";
import { computeRewardScore, type Reward } from "./rewards";
import type { StatKey } from "./mechanics";

/** The shape read from `default-tablets.json` / meta.json's `"tablets"`
 *  array — plain data, no parsed boosts yet. */
export interface RawTabletDef {
  name: string;
  /** Raw mod lines, PoE2 item-text style. Parsed via `parseMods`. */
  mods: string[];
  /** Free-form grouping (e.g. league name) — informational only today,
   *  available for future filtering/UI without a schema change. */
  tags?: string[];
  /** Defaults to true. Set false (in meta.json) to hide a default tablet
   *  without deleting its definition. */
  enabled?: boolean;
  /** Value beyond the six generic stats — mechanic-specific currency, a
   *  named mechanic's own worth, or a flat score (see rewards.ts).
   *  Optional: a tablet without `rewards` is ranked purely on `mods`,
   *  exactly as before this feature existed. */
  rewards?: Reward[];
  /** How reliable this entry's `mods`/`rewards` data is, not whether the
   *  tablet itself exists in-game. Defaults to `"medium"` when omitted
   *  (`hydrate()`). Informational only today — available for future
   *  filtering/UI without another schema change, same as `tags`. */
  confidence?: "high" | "medium" | "low";
  /** Where the data came from. `"wiki"` = triangulated against
   *  community wiki/guide text (poe2wiki.net/maxroll.gg/odealo.com);
   *  `"poe2db"` = data-mined game files (confirms the item exists, not
   *  necessarily exact affix wording); `"community"` = a single
   *  community source, unconfirmed elsewhere; `"manual"` = hand-guessed,
   *  not checked against any source. */
  source?: "wiki" | "poe2db" | "community" | "manual";
}

export interface TabletDef extends RawTabletDef {
  enabled: boolean;
  /** `mods` parsed once at load time into numeric stat boosts. */
  boosts: Partial<Record<StatKey, number>>;
  /** `rewards` summed once at load time via `computeRewardScore`. 0 when
   *  `rewards` is absent — adds nothing to ranking, same as before. */
  rewardScore: number;
  /** Resolved default for `confidence` — always set, never undefined. */
  confidence: "high" | "medium" | "low";
}

// Bundled defaults. Extend this list, or (preferred, no rebuild needed) add
// entries to the user's meta.json "tablets" array — see meta-config.ts.
export const DEFAULT_TABLETS: RawTabletDef[] = [
  // Removed 2026-07-12: "Standard Precursor Tablet" was never a real
  // PoE2 base item — the authoritative data-mined mod list
  // (repoe-fork.github.io/poe2/mods.json, domain "tablet") only has
  // implicit "Adds [mechanic] to a Map" mods for exactly eight real base
  // types (Breach/Ritual/Delirium/Expedition/Irradiated/Overseer/Abyss/
  // Temple, i.e. Incursion) — no generic "Standard" one. Likely invented
  // in an earlier pass; removed rather than kept as a plausible-looking
  // fiction. Every real tablet (any of the eight) can roll from the same
  // shared generic-stat pool this entry used, so nothing is lost — see
  // each entry below.
  //
  // Drops from Map Bosses; boosts their own drops specifically. Re-sourced
  // 2026-07-12 from repoe-fork.github.io/poe2/mods.json's real tablet mod
  // pool (domain "tablet") — Overseer has two boss-scoped suffixes mapping
  // onto tracked stats: Item Rarity of Map Boss drops (35-60%, was
  // wrongly 20% from an older wiki-summary source) and Waystone Quantity
  // from Map Bosses (18-30%, was wrongly 8%). Prefixes switched to Monster
  // Effectiveness + Monster Rarity (both distinct from the two boss
  // suffixes — the shared Item Rarity prefix would just be shadowed by
  // the much bigger boss-scoped suffix on the same stat, since duplicate
  // stat lines take the max, not a sum) at their shared-pool midpoints.
  {
    name: "Overseer Precursor Tablet",
    mods: [
      "12% increased Monster Effectiveness",
      "17% increased Monster Rarity",
      "47% increased Rarity of Items dropped by Map Bosses",
      "24% increased chance to drop a Waystone",
    ],
    tags: ["general"],
    confidence: "high",
    source: "poe2db",
  },
  // Re-sourced 2026-07-12 from poe2db.tw's Modifiers Calc widget (pasted
  // by the user) — Breach Tablet's real prefix pool includes Monster
  // Effectiveness (10-15%), Item Rarity (8-12%), Pack Size (5-7%), and
  // Monster Rarity (15-20%), but a real tablet only has 2 prefixes at
  // once; picked Monster Rarity + Item Rarity (more rare/magic monsters
  // = more Breach Splinters, same "rares carry the value" theme as
  // Ritual below) at each range's midpoint. Suffix pool's two
  // tracked-stat options: "Quantity of Waystones found in Map" (30-40%,
  // = this app's waystoneDropChance, reworded to the existing "chance to
  // drop a Waystone" phrasing so mod-parser.ts's regex catches it) and a
  // Breach-scoped Pack Size roll (5-15%) — both used, midpoints. The rest
  // of the real pool (Experience/Gold/chest-Essence-Shrine-Strongbox
  // chance/rare-monster *count*/Breach-monster-specific effectiveness) is
  // outside this app's six tracked stats, left out. Real mechanic-
  // specific value (Splinters etc.) stays in `rewards` below, unchanged.
  {
    name: "Breach Tablet",
    mods: [
      "17% increased Rarity of Monsters",
      "10% increased Rarity of Items found",
      "35% increased chance to drop a Waystone",
      "10% increased Pack Size",
    ],
    tags: ["breach"],
    confidence: "high",
    source: "poe2db",
    rewards: [
      { type: "mechanic", id: "breach", value: 7 },
      { type: "currency", id: "breach_splinter", weight: 3 },
    ],
  },
  // Re-sourced 2026-07-12 from repoe-fork.github.io/poe2/mods.json (data-
  // mined, domain "tablet") — Ritual has no stat-mapped mechanic-specific
  // suffix (its suffix pool is entirely Tribute/Favour/Omen-focused, see
  // `rewards`), so its suffix falls back to the shared "Quantity of
  // Waystones found in Map" line. Prefixes: Monster Rarity + Pack Size —
  // both monster-count/rarity themed, matching the existing "tribute
  // scales with magic/rare monster count, item rarity does NOT affect
  // ritual rewards" research finding better than the old single-line
  // version did.
  {
    name: "Ritual Tablet",
    mods: ["17% increased Monster Rarity", "6% increased Pack Size", "35% increased chance to drop a Waystone"],
    tags: ["ritual"],
    confidence: "high",
    source: "poe2db",
    rewards: [
      { type: "mechanic", id: "ritual", value: 6 },
      { type: "currency", id: "tribute", weight: 2 },
    ],
  },
  // Re-sourced 2026-07-12 from repoe-fork.github.io/poe2/mods.json — real
  // Delirium-scoped suffix "Delirium Monsters in Map have (15-30)%
  // increased Pack Size" replaces the old made-up-sounding 8% guess.
  // Prefixes (Item Rarity, Monster Effectiveness) deliberately avoid Pack
  // Size again — duplicating a stat key across lines is wasted space,
  // since `mod-parser.ts` keeps the max per stat, not a sum.
  {
    name: "Delirium Tablet",
    mods: [
      "10% increased Rarity of Items found",
      "12% increased Monster Effectiveness",
      "22% increased Pack Size for Delirium Monsters",
      "35% increased chance to drop a Waystone",
    ],
    tags: ["delirium"],
    confidence: "high",
    source: "poe2db",
    rewards: [
      { type: "mechanic", id: "delirium", value: 9 },
      { type: "currency", id: "simulacrum_splinter", weight: 3 },
    ],
  },
  // Re-sourced 2026-07-12 from repoe-fork.github.io/poe2/mods.json — the
  // old "10% increased Quantity of Items found" line didn't correspond to
  // any real rollable tablet mod at all (no generic Item Quantity prefix
  // exists in the real shared pool, only Rarity/Pack Size/Monster stats —
  // likely an invented placeholder from an earlier pass). Expedition has
  // no stat-mapped mechanic-specific suffix either (its pool is
  // Artifact/Logbook/Remnant-focused, see `rewards`), so it falls back to
  // the shared Waystone suffix like Ritual. Prefixes: Monster
  // Effectiveness + Pack Size (more/tougher monsters near the dig site).
  {
    name: "Expedition Tablet",
    mods: [
      "12% increased Monster Effectiveness",
      "6% increased Pack Size",
      "35% increased chance to drop a Waystone",
    ],
    tags: ["expedition"],
    confidence: "high",
    source: "poe2db",
    rewards: [
      { type: "mechanic", id: "expedition", value: 8 },
      { type: "currency", id: "logbook", weight: 2 },
    ],
  },
  // Re-sourced 2026-07-12 from repoe-fork.github.io/poe2/mods.json — Abyss
  // has no stat-mapped mechanic-specific suffix (its real suffixes are
  // Abyssal-Depths/Modifier/Currency-focused, see `rewards`), falls back
  // to the shared Waystone suffix. Prefixes keep Monster Rarity (loot
  // comes from rares, pack size explicitly not recommended — the existing
  // 0.5 research finding) and add Monster Effectiveness (stronger abyssal
  // monsters, same "rares carry the value" theme).
  {
    name: "Abyss Tablet",
    mods: [
      "17% increased Monster Rarity",
      "12% increased Monster Effectiveness",
      "35% increased chance to drop a Waystone",
    ],
    tags: ["abyss"],
    confidence: "high",
    source: "poe2db",
    rewards: [
      { type: "mechanic", id: "abyss", value: 7 },
      { type: "currency", id: "abyssal_jewel", weight: 2 },
    ],
  },
  // Re-sourced 2026-07-12 from repoe-fork.github.io/poe2/mods.json —
  // Irradiated is confirmed to have NO mechanic-specific suffix pool at
  // all (no "tower_augment_irradiated"-tagged mods exist anywhere in the
  // 125-entry real tablet mod list — genuinely just a risk/reward map
  // toggle), so it rolls purely from the shared generic pool: Item Rarity
  // + Monster Rarity as prefixes, the shared Waystone line as suffix.
  {
    name: "Irradiated Tablet",
    mods: [
      "10% increased Rarity of Items found",
      "17% increased Monster Rarity",
      "35% increased chance to drop a Waystone",
    ],
    tags: ["irradiated"],
    confidence: "high",
    source: "poe2db",
    rewards: [{ type: "mechanic", id: "irradiated", value: 6 }],
  },
  // Re-sourced 2026-07-12 from repoe-fork.github.io/poe2/mods.json — real
  // base type is "Adds Vaal Beacons to a Map" (the mod data's internal id
  // is "incursion", matching PoE1's Temple of Atzoatl lineage). No
  // stat-mapped mechanic-specific suffix (its pool is Vaal-Beacon/
  // Monster-focused, see `rewards`) — falls back to the shared Waystone
  // suffix. Prefixes: Item Rarity (better chest loot at Vaal Beacons) +
  // Pack Size (matches its own "extra pack of Monsters around Vaal
  // Beacons" suffix theme).
  {
    name: "Temple Tablet",
    mods: [
      "10% increased Rarity of Items found",
      "6% increased Pack Size",
      "35% increased chance to drop a Waystone",
    ],
    tags: ["temple"],
    confidence: "high",
    source: "poe2db",
    rewards: [{ type: "mechanic", id: "temple", value: 5 }],
  },
];

function toBoosts(mods: string[]): Partial<Record<StatKey, number>> {
  const parsed = parseMods(mods.join("\n"));
  const boosts: Partial<Record<StatKey, number>> = {};
  for (const key of Object.keys(parsed) as StatKey[]) {
    if (parsed[key] > 0) boosts[key] = parsed[key];
  }
  return boosts;
}

function hydrate(raw: RawTabletDef): TabletDef {
  return {
    ...raw,
    enabled: raw.enabled ?? true,
    boosts: toBoosts(raw.mods),
    rewardScore: computeRewardScore(raw.rewards),
    confidence: raw.confidence ?? "medium",
  };
}

let active: TabletDef[] = DEFAULT_TABLETS.map(hydrate);

/** Overlays meta-config.ts's parsed meta.json tablets onto the bundled
 *  defaults — read by adapter.ts's rankTablets instead of DEFAULT_TABLETS
 *  directly, so a user edit takes effect without a rebuild. */
export function setActiveTablets(overrides: RawTabletDef[]): void {
  active = overrides.map(hydrate);
}

/** Enabled tablets only — disabled ones stay defined but excluded from
 *  ranking/recommendation. */
export function getActiveTablets(): TabletDef[] {
  return active.filter((t) => t.enabled);
}

export function findTablet(name: string): TabletDef | undefined {
  return active.find((t) => t.name === name);
}
