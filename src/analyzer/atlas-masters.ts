/** Atlas Master (Atlas Tree Ascendancy) recommendation per mechanic —
 *  ROADMAP idea, sourced 2026-07-12 from Fubgun's per-mechanic strat
 *  guides (pasted by the user; the Mobalytics page itself blocks
 *  scraping) plus 3 real in-game screenshots confirming which circular
 *  icon belongs to which master (the active-master icon on the right of
 *  the skill panel changes per screenshot).
 *
 *  Name-only here (no icon assets) — kept out of adapter.ts's image-free
 *  dependency graph so `esbuild --bundle` (verify-adapter.mjs's plain CLI
 *  invocation, no loader config) doesn't choke on a `.png` import. Icons
 *  live in `src/atlas-master-icons.ts` (UI layer only), same split
 *  `TABLET_ICONS` already uses in RelicPanel.ts (icon lookup by name,
 *  never part of the adapter's data contract).
 *
 *  Only mechanics with a real, sourced recommendation are listed below —
 *  explicit user call (2026-07-12): Irradiated/Temple/General show
 *  nothing rather than guess, even though Jado is the pattern everywhere
 *  else that WAS sourced. */

/** Keyed by `MechanicDef.name` (mechanics.ts); value is the master's name. */
export const MECHANIC_MASTERS: Partial<Record<string, string>> = {
  // "Jado: Unexpected Missions, Eastern Knowledge, Partial Translations
  // and Keen appraisal. Doryani is also viable, but I had more success
  // running jado."
  Expedition: "Jado",
  // "Jado: Partial translation and unforeseen threats - unexpected
  // mission is also good."
  Ritual: "Jado",
  // Two strats exist: 1st (currency-focused) "Jado: Partial translation,
  // unforeseen threats and unexpected mission." — 2nd (rare-focused) uses
  // Hilda instead (Breeding Season, Ancient Inscriptions). Jado kept as
  // the representative pick since it's the first-listed/primary strat,
  // same "one representative pick" convention tablets.ts already uses.
  Abyss: "Jado",
  // "Master: Jado / Partial translation, unforeseen threats and
  // unexpected mission."
  Breach: "Jado",
  // No explicit "Master:" line in this strat's text, but the pasted
  // in-game skill screenshot for it shows the same Jado keystones
  // (Unexpected Missions, Unforeseen Threats, Eastern Knowledge, Partial
  // Translations) allocated.
  Delirium: "Jado",
};

/** The specific Atlas Tree notables/keystones to allocate for that
 *  mechanic's master pick above — same sourcing (2026-07-12), verified
 *  directly against Fubgun's live Mobalytics tree (Atlas Tree tab, not
 *  just the write-up text) via each notable's own icon/name pair, since
 *  the write-up alone doesn't disambiguate which exact keystones "Partial
 *  translation and unforeseen threats" refers to. Expedition/Delirium
 *  have all 4 of Jado's loot-relevant notables named; Ritual/Abyss/Breach
 *  only ever name 3 — shown as 3, not padded with an unsourced 4th
 *  (2026-07-12, explicit user call: honest with what's actually sourced). */
export const MECHANIC_MASTER_NOTABLES: Partial<Record<string, string[]>> = {
  Expedition: ["Unexpected Missions", "Eastern Knowledge", "Partial Translations", "Keen Appraisal"],
  Ritual: ["Partial Translations", "Unforeseen Threats", "Unexpected Missions"],
  Abyss: ["Partial Translations", "Unforeseen Threats", "Unexpected Missions"],
  Breach: ["Partial Translations", "Unforeseen Threats", "Unexpected Missions"],
  Delirium: ["Unexpected Missions", "Unforeseen Threats", "Eastern Knowledge", "Partial Translations"],
};
