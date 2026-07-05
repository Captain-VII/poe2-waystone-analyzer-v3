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
 *  actual Precursor Tablet/Atlas Tower system: real PoE2 has exactly **six**
 *  tablet types — Standard, Overseer, Breach, Ritual, Delirium, Expedition —
 *  no more. There is no Abyss, Legion, Heist, Sanctum, Harvest, Metamorph,
 *  Essence, Incursion, or Bestiary tablet in the game; those mechanics get
 *  no dedicated tablet at all (a `mechanics.ts` fact, not a gap in this
 *  file — see KNOWN_ISSUES.md #2). All 8 "placeholder" entries and the
 *  unverified Abyss/Blight/General entries from the earlier pass are
 *  removed rather than kept alongside real data.
 *
 *  Every real tablet is Magic rarity (1 prefix + 1 suffix) and can roll
 *  from the *same* shared generic-stat prefix pool (Quantity/Rarity/Pack
 *  Size/Magic Monsters/Rare Monsters/Gold/Experience); each `mods` entry
 *  below is one representative prefix from that pool, not an exhaustive
 *  roll table. The four mechanic-specific types' real value is almost
 *  entirely in their *suffix*, which grants mechanic-specific currency
 *  (Breach Splinters, Expedition Artifacts/Logbooks, Ritual Tribute,
 *  Delirium Simulacrum Splinters) rather than a generic stat — that's what
 *  `rewards` (rewards.ts) represents; Standard/Overseer have no
 *  mechanic-specific currency of their own, so they carry no `rewards`.
 *  Replace any entry's exact mod wording once a more precise source turns
 *  up; no other code needs to change either way. */

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
  {
    name: "Standard Precursor Tablet",
    mods: ["15% increased Quantity of Items found", "12% increased Rarity of Items found"],
    tags: ["general"],
    confidence: "high",
    source: "wiki",
  },
  // Drops from Map Bosses; boosts their own drops specifically. Real suffix
  // ranges: waystone quantity (5-10)%, item rarity (15-25)% dropped by Map
  // Bosses — using midpoints. No mechanic-specific currency of its own.
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
  // shared-prefix roll (Pack Size, since Breach content is dense packs of
  // Magic monsters).
  {
    name: "Breach Tablet",
    mods: ["20% increased Pack Size"],
    tags: ["breach"],
    confidence: "medium",
    source: "wiki",
    rewards: [
      { type: "mechanic", id: "breach", value: 7 },
      { type: "currency", id: "breach_splinter", weight: 3 },
    ],
  },
  // Real suffixes are Ritual Tribute/Favour-focused, not a generic stat —
  // see `rewards`. `mods` is a representative shared-prefix roll.
  {
    name: "Ritual Tablet",
    mods: ["15% increased Rarity of Items found"],
    tags: ["ritual"],
    confidence: "medium",
    source: "wiki",
    rewards: [
      { type: "mechanic", id: "ritual", value: 6 },
      { type: "currency", id: "tribute", weight: 2 },
    ],
  },
  // Real suffixes are Simulacrum Splinters/Fog-focused, not a generic stat
  // — see `rewards`. `mods` is a representative shared-prefix roll.
  {
    name: "Delirium Tablet",
    mods: ["20% increased Pack Size"],
    tags: ["delirium"],
    confidence: "medium",
    source: "wiki",
    rewards: [
      { type: "mechanic", id: "delirium", value: 9 },
      { type: "currency", id: "simulacrum_splinter", weight: 3 },
    ],
  },
  // Real suffixes are Artifact/Logbook/Remnant-focused, not a generic stat
  // — see `rewards`. `mods` is a representative shared-prefix roll.
  {
    name: "Expedition Tablet",
    mods: ["15% increased Quantity of Items found"],
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
  // difference this app doesn't model). poe2db explicitly doesn't have
  // exact affix text ("Modifier weight information cannot be obtained from
  // game files"), so — unlike the six above — its `mods` here is a
  // plausible representative roll, not confirmed wording; real value is
  // mostly Abyssal Jewels/Abyssal troves, represented via `rewards`.
  {
    name: "Abyss Tablet",
    mods: ["15% increased Pack Size"],
    tags: ["abyss"],
    confidence: "low",
    source: "poe2db",
    rewards: [
      { type: "mechanic", id: "abyss", value: 7 },
      { type: "currency", id: "abyssal_jewel", weight: 2 },
    ],
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

/** Small end-stage multiplier so speculative (`"low"`) tablet data can't
 *  outrank reliable (`"high"`) data purely because its `mods`/`rewards`
 *  happened to be guessed generously — applied once, after `statFit` +
 *  `rewardScore` are already combined (`adapter.ts`'s `rankTablets`), never
 *  inside either of those calculations. Deliberately gentle (-8%/-20%, not
 *  a hard filter): a `"low"`-confidence tablet that's a much better fit
 *  than the alternatives should still surface, just not win on a coin-flip
 *  margin against a `"high"`-confidence one. */
export function getConfidenceMultiplier(confidence: TabletDef["confidence"]): number {
  switch (confidence) {
    case "high":
      return 1.0;
    case "medium":
      return 0.92;
    case "low":
      return 0.8;
    default:
      return 0.92;
  }
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
