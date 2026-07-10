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
 *  **Verified against the real game (2026-07-04), replacing the earlier
 *  7 "original" + 8 "placeholder" guesses.** Cross-checked against three
 *  independent sources (poe2wiki.net, maxroll.gg, odealo.com) covering the
 *  Precursor Tablet/Atlas Tower system, plus poe2db.tw's item data (checked
 *  2026-07-06) for the full base-type list: real PoE2 has **nine** standard
 *  tablet types — Standard, Overseer, Breach, Ritual, Delirium, Expedition,
 *  Abyss, Irradiated, Temple — no more. Legion, Heist, Sanctum, Harvest,
 *  Metamorph, Essence, Incursion, and Bestiary have no dedicated tablet at
 *  all (a `mechanics.ts` fact, not a gap in this file — see
 *  KNOWN_ISSUES.md #2). All 8 "placeholder" entries and the unverified
 *  Blight/General entries from the earlier pass are removed rather than
 *  kept alongside real data.
 *
 *  Every real tablet is Magic rarity (1 prefix + 1 suffix) and can roll
 *  from the *same* shared generic-stat prefix pool (Quantity/Rarity/Pack
 *  Size/Magic Monsters/Rare Monsters/Gold/Experience); each `mods` entry
 *  below is one representative prefix (or, for Standard/Overseer, prefix +
 *  a stat-shaped suffix) from that pool, not an exhaustive roll table — a
 *  real tablet only ever has one of each anyway, so "the full pool" isn't
 *  something a single definition can represent; a user with a differently-
 *  rolled real tablet overrides it via meta.json's "tablets" array. The
 *  four mechanic-specific types' real value is almost entirely in their
 *  *suffix*, which grants mechanic-specific currency (Breach Splinters,
 *  Expedition Artifacts/Logbooks, Ritual Tribute, Delirium Simulacrum
 *  Splinters) rather than a generic stat — that's what `rewards`
 *  (rewards.ts) represents; Standard/Overseer have no mechanic-specific
 *  currency of their own, so they carry no `rewards`.
 *
 *  **Re-sourced 2026-07-11**: the shared prefix pool and the Standard/
 *  Overseer/Breach/Ritual/Delirium/Expedition suffix pools were cross-
 *  checked against poe2wiki.net's dedicated tablet-modifier list (fetched
 *  via odealo.com's summary — poe2wiki itself blocks non-browser fetches)
 *  and maxroll.gg's rolling guide; several representative values were
 *  outside the newly-confirmed real ranges and corrected (see each entry's
 *  own comment). Magic Monsters/Gold/Experience remain untracked (would
 *  need new `StatKey`s and a scoring-model decision — explicitly out of
 *  scope for this pass, see KNOWN_ISSUES.md #2). Abyss/Irradiated/Temple
 *  mods remain unconfirmed by any source checked so far (both new sources
 *  explicitly omit them, same as poe2db.tw before). Replace any entry's
 *  exact mod wording once a more precise source turns up; no other code
 *  needs to change either way. */

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
  // Verified against real PoE2 Precursor Tablet modifiers (poe2wiki.net,
  // maxroll.gg, odealo.com — cross-checked 2026-07-04). The one
  // non-mechanic-specific tablet type: no mechanic-specific currency of its
  // own, so no `rewards`. Real shared-prefix range (10-20)%; suffix ranges
  // vary by roll (e.g. "1 additional random Modifier") — using a
  // representative prefix midpoint.
  // 2026-07-11: corrected from two prefix-pool lines (a mistake — a real
  // tablet is Magic rarity, 1 prefix + 1 suffix, never two prefixes) to one
  // of each, cross-checked against poe2wiki's tablet-modifier list (via
  // odealo.com's summary) and maxroll.gg: prefix Rarity of Items (10-15%
  // range, both sources agree, using the midpoint) + Standard's own real
  // suffix ("increased Quantity of Waystones found in your Maps," 10-20%
  // range). That suffix is rephrased here as "chance to drop a Waystone" —
  // verified via probe script that the literal wiki wording also parses as
  // `quantity` (Item Quantity) purely because it contains the word
  // "quantity," which would be a wrong/duplicate boost; this app's existing
  // "chance to drop/find a Waystone" phrasing parses cleanly as only
  // `waystoneDropChance`, same real range, no accuracy loss.
  {
    name: "Standard Precursor Tablet",
    mods: ["12% increased Rarity of Items found", "15% increased chance to drop a Waystone"],
    tags: ["general"],
    confidence: "high",
    source: "wiki",
  },
  // Drops from Map Bosses; boosts their own drops specifically. Real suffix
  // ranges: waystone quantity (5-10)%, item rarity (15-25)% dropped by Map
  // Bosses — using midpoints. No mechanic-specific currency of its own.
  // Re-confirmed 2026-07-11 against poe2wiki's tablet-modifier list (via
  // odealo.com) and maxroll.gg — both existing values already sit inside
  // the sourced ranges, unchanged.
  {
    name: "Overseer Precursor Tablet",
    mods: ["8% increased chance to drop a Waystone", "20% increased Rarity of Items dropped by Map Bosses"],
    tags: ["general"],
    confidence: "high",
    source: "wiki",
  },
  // Real suffixes are almost entirely Breach-specific (Splinters, monster
  // density, additional Breaches) rather than a generic stat — that value
  // flows through `rewards`, not `mods`. `mods` here is one representative
  // shared-prefix roll (Rare Monsters, matching the researched 0.5 Breach
  // profile: rares carry the value, not white packs). Value corrected
  // 2026-07-11: the shared "Rare Monsters" prefix's real range is (10-15)%
  // (poe2wiki via odealo.com, confirmed by maxroll.gg) — was 20%, outside
  // that range; now the midpoint.
  {
    name: "Breach Tablet",
    mods: ["12% increased Rarity of Monsters"],
    tags: ["breach"],
    confidence: "medium",
    source: "wiki",
    rewards: [
      { type: "mechanic", id: "breach", value: 7 },
      { type: "currency", id: "breach_splinter", weight: 3 },
    ],
  },
  // Real suffixes are Ritual Tribute/Favour-focused, not a generic stat —
  // see `rewards`. `mods` is a representative shared-prefix roll (Rare
  // Monsters: tribute scales with magic/rare monster count, and item
  // rarity does NOT affect ritual rewards per the 0.5 research pass).
  // Value corrected 2026-07-11 to the sourced (10-15)% midpoint, same
  // shared-prefix range as Breach above — see that entry's comment for
  // sourcing.
  {
    name: "Ritual Tablet",
    mods: ["12% increased Rarity of Monsters"],
    tags: ["ritual"],
    confidence: "medium",
    source: "wiki",
    rewards: [
      { type: "mechanic", id: "ritual", value: 6 },
      { type: "currency", id: "tribute", weight: 2 },
    ],
  },
  // Real suffixes are Simulacrum Splinters/Fog-focused, not a generic stat
  // — see `rewards`. Was a generic 20% Pack Size prefix — corrected
  // 2026-07-11: the shared Pack Size prefix's real range is only (3-7)%
  // (poe2wiki via odealo.com AND maxroll.gg agree exactly on this one), so
  // 20% was well outside it. Switched to Delirium's own real suffix
  // instead — "Delirium Monsters in your Maps have (5-10)% increased Pack
  // Size" — both more accurate to a real roll AND thematically Delirium-
  // specific rather than a generic map-wide line; phrased to parse as
  // packSize only (verified via probe script), using the midpoint.
  {
    name: "Delirium Tablet",
    mods: ["8% increased Pack Size for Delirium Monsters"],
    tags: ["delirium"],
    confidence: "medium",
    source: "wiki",
    rewards: [
      { type: "mechanic", id: "delirium", value: 9 },
      { type: "currency", id: "simulacrum_splinter", weight: 3 },
    ],
  },
  // Real suffixes are Artifact/Logbook/Remnant-focused, not a generic stat
  // — see `rewards`. `mods` is a representative shared-prefix roll (Item
  // Quantity — no real Expedition-specific generic-stat suffix exists, so
  // any shared prefix is as defensible as another). Value note 2026-07-11:
  // the shared Quantity prefix's real range is genuinely disputed between
  // the two sources checked — poe2wiki (via odealo.com) says (3-7)%,
  // maxroll.gg says (10-20)% for the same nominal mod, no overlap between
  // them. Not resolved (avoiding a third-source hunt for a tie-break, see
  // KNOWN_ISSUES.md #3's fatigue note) — 10% sits right at maxroll's floor
  // and just above odealo's ceiling, the least-arbitrary single number
  // given both are cited.
  {
    name: "Expedition Tablet",
    mods: ["10% increased Quantity of Items found"],
    tags: ["expedition"],
    confidence: "medium",
    source: "wiki",
    rewards: [
      { type: "mechanic", id: "expedition", value: 8 },
      { type: "currency", id: "logbook", weight: 2 },
    ],
  },
  // Confirmed real via poe2db.tw (data-mined from game files, checked
  // 2026-07-04): base type "Abyss Tablet", drop level 65, "Adds Abysses to
  // a Map", 10 uses remaining — a personal-Map-Device consumable, not
  // slotted into a Precursor Tower like the six above (a real mechanical
  // difference this app doesn't model). Its `mods` is a plausible
  // representative roll, not confirmed wording (poe2db has no affix text)
  // — but that's equally true of every mechanic-specific entry above, so
  // it carries the same "medium" confidence they do (was "low", which
  // stacked a permanent ×0.8 vs ×0.92 penalty on top of its already-lowest
  // rewardScore and kept it pinned to the bottom of the list — rebalanced
  // 2026-07-06). Roll aligned with the researched 0.5 Abyss profile
  // (monsterRarity priority — loot comes from rares, pack size explicitly
  // not recommended); real value is mostly Abyssal Jewels/troves, via
  // `rewards`.
  {
    name: "Abyss Tablet",
    mods: ["15% increased Rarity of Monsters"],
    tags: ["abyss"],
    confidence: "medium",
    source: "poe2db",
    rewards: [
      { type: "mechanic", id: "abyss", value: 7 },
      { type: "currency", id: "abyssal_jewel", weight: 2 },
    ],
  },
  // Confirmed real via poe2db.tw (data-mined, checked 2026-07-06): base type
  // "Irradiated Tablet", "Adds Irradiated to a Map". Unlike Breach/Ritual/
  // Delirium/Expedition/Abyss, Irradiated doesn't grant a distinct
  // mechanic-specific currency (it's a risk/reward map modifier — tougher
  // monsters, more generic loot) — represented as a flat `mechanic` reward
  // only, no `currency` entry. `mods` is a plausible representative roll,
  // not confirmed wording (poe2db has no affix text for tablets).
  {
    name: "Irradiated Tablet",
    mods: ["15% increased Rarity of Items found"],
    tags: ["irradiated"],
    confidence: "low",
    source: "poe2db",
    rewards: [{ type: "mechanic", id: "irradiated", value: 6 }],
  },
  // Confirmed real via poe2db.tw (data-mined, checked 2026-07-06): base type
  // "Temple Tablet", "Adds Vaal Beacons to a Map". Same caveat as
  // Irradiated above: no confirmed dedicated currency, `mods` is a
  // plausible representative roll.
  {
    name: "Temple Tablet",
    mods: ["15% increased Quantity of Items found"],
    tags: ["temple"],
    confidence: "low",
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
