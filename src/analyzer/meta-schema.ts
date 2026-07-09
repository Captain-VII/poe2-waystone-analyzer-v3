/** Pure meta.json schema logic — parse, merge onto the bundled defaults,
 *  and the reverse direction the in-app editor needs: diff an edited state
 *  back into a minimal file. Extracted from meta-config.ts (which keeps the
 *  Tauri IO) so verify-adapter.mjs can exercise all of it in plain Node.
 *
 *  The write direction is deliberately DIFF-ONLY: a value equal to the
 *  hardcoded default is never written, and an entry that ends up carrying
 *  nothing is dropped. Rationale: a full dump pins today's defaults into
 *  the user's file, which silently diverges when the code's tuning evolves —
 *  exactly the stale-meta.json drift bug debugged on 2026-07-08. Anything
 *  this module doesn't manage (hand-added tablets, custom recommended_
 *  tablets, unknown keys) is carried through byte-for-byte. */

import { MECHANICS, type MechanicDef, type StatKey } from "./mechanics";
import { DEFAULT_TABLETS, type RawTabletDef } from "./tablets";
import type { Reward } from "./rewards";

// Re-exported so verify-adapter.mjs's meta-schema bundle can assert against
// the same defaults this module diffs against.
export { MECHANICS, DEFAULT_TABLETS };
export type { MechanicDef, RawTabletDef, StatKey };

export const STAT_NAME_TO_KEY: Record<string, StatKey> = {
  "item rarity": "itemRarity",
  "monster rarity": "monsterRarity",
  "pack size": "packSize",
  "monster effectiveness": "monsterEffectiveness",
  "waystone drop chance": "waystoneDropChance",
  quantity: "quantity",
};

/** Human-readable labels, both for serialization (the file speaks "Pack
 *  Size", not "packSize") and for the editor's dropdowns. */
export const STAT_KEY_TO_NAME: Record<StatKey, string> = {
  itemRarity: "Item Rarity",
  monsterRarity: "Monster Rarity",
  packSize: "Pack Size",
  monsterEffectiveness: "Monster Effectiveness",
  waystoneDropChance: "Waystone Drop Chance",
  quantity: "Quantity",
};

/** Dropdown display order. */
export const STAT_KEYS: StatKey[] = [
  "itemRarity",
  "monsterRarity",
  "packSize",
  "monsterEffectiveness",
  "waystoneDropChance",
  "quantity",
];

export function toStatKey(name: unknown): StatKey | null {
  if (typeof name !== "string") return null;
  return STAT_NAME_TO_KEY[name.trim().toLowerCase()] ?? null;
}

export interface RawMechanicMeta {
  priority_stat?: unknown;
  secondary_stats?: unknown;
  recommended_tablets?: unknown;
  skip_if_below?: unknown;
}

/** meta.json as it sits on disk. Keys this module doesn't manage — both
 *  top-level and inside each mechanic entry — are transported untouched so
 *  a hand-edited file survives a round-trip through the editor. */
export interface RawMetaFile {
  metas?: Record<string, RawMechanicMeta & Record<string, unknown>>;
  tablets?: unknown[];
  [key: string]: unknown;
}

/** Defensive JSON.parse: null for anything that isn't a JSON object (the
 *  caller decides whether that means "absent" or "corrupt"). */
export function parseMetaFile(text: string): RawMetaFile | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as RawMetaFile;
  } catch {
    return null;
  }
}

function applyOverride(base: MechanicDef, raw: RawMechanicMeta): MechanicDef {
  const priorityStat = toStatKey(raw.priority_stat) ?? base.priorityStat;
  const secondaryStats = Array.isArray(raw.secondary_stats)
    ? raw.secondary_stats.map(toStatKey).filter((k): k is StatKey => k !== null)
    : base.secondaryStats;
  const recommendedTablets = Array.isArray(raw.recommended_tablets)
    ? raw.recommended_tablets.filter((t): t is string => typeof t === "string")
    : base.recommendedTablets;
  const skipIfBelow = typeof raw.skip_if_below === "number" ? raw.skip_if_below : base.skipIfBelow;
  return { ...base, priorityStat, secondaryStats, recommendedTablets, skipIfBelow };
}

function isValidReward(entry: unknown): entry is Reward {
  if (typeof entry !== "object" || entry === null) return false;
  const r = entry as Record<string, unknown>;
  switch (r.type) {
    case "currency":
      return typeof r.id === "string" && typeof r.weight === "number";
    case "mechanic":
      return typeof r.id === "string" && typeof r.value === "number";
    case "generic":
      return typeof r.score === "number";
    default:
      return false;
  }
}

const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
const SOURCES = ["wiki", "poe2db", "community", "manual"] as const;

function toRawTablet(entry: unknown): RawTabletDef | null {
  if (typeof entry !== "object" || entry === null) return null;
  const e = entry as Record<string, unknown>;
  if (typeof e.name !== "string" || !e.name.trim()) return null;
  const mods = Array.isArray(e.mods) ? e.mods.filter((m): m is string => typeof m === "string") : [];
  const tags = Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === "string") : undefined;
  const enabled = typeof e.enabled === "boolean" ? e.enabled : undefined;
  const rewards = Array.isArray(e.rewards) ? e.rewards.filter(isValidReward) : undefined;
  const confidence = CONFIDENCE_LEVELS.includes(e.confidence as never)
    ? (e.confidence as RawTabletDef["confidence"])
    : undefined;
  const source = SOURCES.includes(e.source as never) ? (e.source as RawTabletDef["source"]) : undefined;
  return { name: e.name, mods, tags, enabled, rewards, confidence, source };
}

/** Merges user meta.json tablets onto DEFAULT_TABLETS by name (case
 *  insensitive): a matching name overrides that default's
 *  mods/tags/enabled/rewards/confidence/source, a new name is appended —
 *  so both "tune a default" and "add a brand new tablet" are just
 *  meta.json edits, no rebuild. Never throws: any entry missing a valid
 *  `name` is skipped, any reward with an unrecognized shape is dropped
 *  rather than corrupting the tablet's whole reward list, and an
 *  unrecognized confidence/source string falls back to the base/default
 *  rather than crashing. */
export function mergeTablets(userTablets: unknown): RawTabletDef[] {
  if (!Array.isArray(userTablets)) return DEFAULT_TABLETS;
  const byName = new Map(DEFAULT_TABLETS.map((t) => [t.name.toLowerCase(), t]));
  for (const entry of userTablets) {
    const raw = toRawTablet(entry);
    if (!raw) continue;
    const key = raw.name.toLowerCase();
    const base = byName.get(key);
    byName.set(key, {
      name: raw.name,
      mods: raw.mods.length > 0 ? raw.mods : base?.mods ?? [],
      tags: raw.tags ?? base?.tags,
      enabled: raw.enabled ?? base?.enabled,
      rewards: raw.rewards ?? base?.rewards,
      confidence: raw.confidence ?? base?.confidence,
      source: raw.source ?? base?.source,
    });
  }
  return [...byName.values()];
}

/** The forward direction: file (or null) → the mechanic/tablet tables to
 *  activate. Pure — meta-config.ts calls this then setActive*. */
export function mergeMetaConfig(parsed: RawMetaFile | null): {
  mechanics: MechanicDef[];
  tablets: RawTabletDef[];
} {
  const metas = parsed?.metas;
  const mechanics =
    metas && typeof metas === "object"
      ? MECHANICS.map((mech) => {
          const raw = metas[mech.name.toLowerCase()];
          return raw ? applyOverride(mech, raw) : mech;
        })
      : MECHANICS;
  return { mechanics, tablets: mergeTablets(parsed?.tablets) };
}

/** What the in-app editor edits for one mechanic. Expressed in effective
 *  StatKey values — buildMetaFile serializes back through STAT_KEY_TO_NAME,
 *  so buildMetaFile → mergeMetaConfig round-trips to exactly these values. */
export interface MechanicEdit {
  priorityStat: StatKey;
  /** 0-2 entries, no duplicates, never equal to priorityStat (the editor
   *  normalizes; buildMetaFile also enforces it defensively). */
  secondaryStats: StatKey[];
  /** Clamped to 0-100 integers. */
  skipIfBelow: number;
}

/** Snapshot the Settings panel renders — rebuilt after every action. */
export interface MetaEditorModel {
  mechanics: {
    name: string;
    effective: MechanicEdit;
    /** Any managed field (or recommended_tablets) differs from the
     *  hardcoded default — drives the "•" marker in the mechanic select. */
    isOverridden: boolean;
  }[];
  tablets: { name: string; enabled: boolean; isCustom: boolean }[];
  statOptions: { key: StatKey; label: string }[];
  /** meta.json exists but doesn't parse — the editor warns that saving
   *  will rewrite it. */
  fileCorrupt: boolean;
}

const MANAGED_META_KEYS = new Set(["priority_stat", "secondary_stats", "recommended_tablets", "skip_if_below"]);

function sameStatList(a: StatKey[], b: StatKey[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function sameStringList(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function normalizeEdit(def: MechanicDef, edit: MechanicEdit): MechanicEdit {
  const seen = new Set<StatKey>();
  const secondaryStats = edit.secondaryStats
    .filter((k) => k !== edit.priorityStat && !seen.has(k) && seen.add(k) !== undefined)
    .slice(0, 2);
  const skipIfBelow = Math.min(100, Math.max(0, Math.round(edit.skipIfBelow)));
  return { priorityStat: edit.priorityStat ?? def.priorityStat, secondaryStats, skipIfBelow };
}

function editFromDef(def: MechanicDef): MechanicEdit {
  return {
    priorityStat: def.priorityStat,
    secondaryStats: [...def.secondaryStats],
    skipIfBelow: def.skipIfBelow,
  };
}

export function buildEditorModel(parsed: RawMetaFile | null, fileCorrupt: boolean): MetaEditorModel {
  const { mechanics, tablets } = mergeMetaConfig(parsed);
  const defaultNames = new Set(DEFAULT_TABLETS.map((t) => t.name.toLowerCase()));
  return {
    mechanics: mechanics.map((m, i) => {
      const def = MECHANICS[i]!;
      return {
        name: m.name,
        effective: editFromDef(m),
        isOverridden:
          m.priorityStat !== def.priorityStat ||
          !sameStatList(m.secondaryStats, def.secondaryStats) ||
          m.skipIfBelow !== def.skipIfBelow ||
          !sameStringList(m.recommendedTablets, def.recommendedTablets),
      };
    }),
    tablets: tablets.map((t) => ({
      name: t.name,
      enabled: t.enabled ?? true,
      isCustom: !defaultNames.has(t.name.toLowerCase()),
    })),
    statOptions: STAT_KEYS.map((key) => ({ key, label: STAT_KEY_TO_NAME[key] })),
    fileCorrupt,
  };
}

/** The reverse direction: rebuild a minimal meta.json from the existing
 *  raw file plus the editor's current state.
 *
 *  - `mechanicEdits`/`tabletEnabled` are keyed by lowercased name and carry
 *    the DESIRED EFFECTIVE state (not a delta). A mechanic absent from
 *    `mechanicEdits` keeps whatever its existing entry expressed.
 *  - Every entry is re-normalized against the defaults on every build: a
 *    managed field equal to its hardcoded default is dropped, and so is
 *    recommended_tablets when identical to the default — this is what
 *    purges the old duplicated-seed drift on the first save.
 *  - Unknown keys (top-level, per-mechanic, whole unrecognized tablet
 *    entries) are carried through untouched. */
export function buildMetaFile(
  existing: RawMetaFile | null,
  mechanicEdits: ReadonlyMap<string, MechanicEdit>,
  tabletEnabled: ReadonlyMap<string, boolean>,
): RawMetaFile {
  const out: RawMetaFile = {};
  // Top-level unknown keys first, preserving the original order.
  if (existing) {
    for (const [k, v] of Object.entries(existing)) {
      if (k !== "metas" && k !== "tablets") out[k] = v;
    }
  }

  // --- metas ---
  const metas: Record<string, RawMechanicMeta & Record<string, unknown>> = {};
  for (const def of MECHANICS) {
    const key = def.name.toLowerCase();
    const existingEntry = existing?.metas?.[key];
    const desired = mechanicEdits.has(key)
      ? normalizeEdit(def, mechanicEdits.get(key)!)
      : editFromDef(existingEntry ? applyOverride(def, existingEntry) : def);

    const entry: RawMechanicMeta & Record<string, unknown> = {};
    if (desired.priorityStat !== def.priorityStat) {
      entry.priority_stat = STAT_KEY_TO_NAME[desired.priorityStat];
    }
    if (!sameStatList(desired.secondaryStats, def.secondaryStats)) {
      entry.secondary_stats = desired.secondaryStats.map((k) => STAT_KEY_TO_NAME[k]);
    }
    if (desired.skipIfBelow !== def.skipIfBelow) {
      entry.skip_if_below = desired.skipIfBelow;
    }
    // recommended_tablets isn't editable in the UI — carried from the
    // existing entry, but only when it genuinely diverges from the default
    // (a copy of the default is pinned noise, not a customization).
    if (existingEntry && Array.isArray(existingEntry.recommended_tablets)) {
      const effective = existingEntry.recommended_tablets.filter((t): t is string => typeof t === "string");
      if (!sameStringList(effective, def.recommendedTablets)) {
        entry.recommended_tablets = existingEntry.recommended_tablets;
      }
    }
    // Unknown per-mechanic keys survive verbatim.
    if (existingEntry) {
      for (const [k, v] of Object.entries(existingEntry)) {
        if (!MANAGED_META_KEYS.has(k)) entry[k] = v;
      }
    }
    if (Object.keys(entry).length > 0) metas[key] = entry;
  }
  // Orphan meta keys (no matching mechanic — user notes, future mechanics)
  // are never read by the merge but belong to the user: keep them.
  if (existing?.metas) {
    const known = new Set(MECHANICS.map((m) => m.name.toLowerCase()));
    for (const [k, v] of Object.entries(existing.metas)) {
      if (!known.has(k)) metas[k] = v;
    }
  }
  if (Object.keys(metas).length > 0) out.metas = metas;

  // --- tablets ---
  const defaultsByName = new Map(DEFAULT_TABLETS.map((t) => [t.name.toLowerCase(), t]));
  const entries: unknown[] = existing?.tablets ? [...existing.tablets] : [];
  const entryIndexByName = new Map<string, number>();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (typeof e === "object" && e !== null && typeof (e as { name?: unknown }).name === "string") {
      entryIndexByName.set(((e as { name: string }).name).toLowerCase(), i);
    }
  }
  for (const [key, enabled] of tabletEnabled) {
    const def = defaultsByName.get(key);
    const defaultEnabled = def ? def.enabled ?? true : true;
    const idx = entryIndexByName.get(key);
    if (idx !== undefined) {
      // Touch ONLY the enabled field of the existing entry — mods/rewards/
      // tags/etc. stay exactly as the user wrote them.
      const entry = { ...(entries[idx] as Record<string, unknown>) };
      if (def && enabled === defaultEnabled) {
        delete entry.enabled;
      } else {
        entry.enabled = enabled;
      }
      const keys = Object.keys(entry);
      const onlyNameLeft = keys.length === 1 && keys[0] === "name";
      if (def && onlyNameLeft) {
        entries.splice(idx, 1);
        entryIndexByName.delete(key);
        for (const [n, i] of entryIndexByName) if (i > idx) entryIndexByName.set(n, i - 1);
      } else {
        entries[idx] = entry;
      }
    } else if (def && enabled !== defaultEnabled) {
      entries.push({ name: def.name, enabled });
      entryIndexByName.set(key, entries.length - 1);
    }
    // No entry and no default (a custom tablet the file no longer defines):
    // nothing to toggle — dropped silently.
  }
  if (entries.length > 0) out.tablets = entries;

  return out;
}

export function serializeMetaFile(file: RawMetaFile): string {
  return JSON.stringify(file, null, 2) + "\n";
}
