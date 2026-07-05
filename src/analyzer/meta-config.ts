/** Loads the user-editable meta.json (cahier des charges §10) from the app
 *  config dir and overlays it onto the bundled MECHANICS defaults. Never
 *  throws: any missing file, bad JSON, or unknown mechanic key/stat name is
 *  silently ignored and that mechanic keeps its hardcoded default —
 *  matching every other analyzer module's "degrade to defaults" contract. */

import { MECHANICS, setActiveMechanics, type MechanicDef, type StatKey } from "./mechanics";
import { DEFAULT_TABLETS, setActiveTablets, type RawTabletDef } from "./tablets";
import type { Reward } from "./rewards";

const STAT_NAME_TO_KEY: Record<string, StatKey> = {
  "item rarity": "itemRarity",
  "monster rarity": "monsterRarity",
  "pack size": "packSize",
  "monster effectiveness": "monsterEffectiveness",
  "waystone drop chance": "waystoneDropChance",
  quantity: "quantity",
};

function toStatKey(name: unknown): StatKey | null {
  if (typeof name !== "string") return null;
  return STAT_NAME_TO_KEY[name.trim().toLowerCase()] ?? null;
}

interface RawMechanicMeta {
  priority_stat?: unknown;
  secondary_stats?: unknown;
  recommended_tablets?: unknown;
  skip_if_below?: unknown;
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
function mergeTablets(userTablets: unknown): RawTabletDef[] {
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

/** Reads meta.json (if running under Tauri) and activates the merged
 *  mechanic + tablet tables for subsequent analyses. Safe to call multiple
 *  times (e.g. re-load on demand) — always falls back to the bundled
 *  defaults on failure. */
export async function loadMetaConfig(): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  try {
    const { readTextFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
    const text = await readTextFile("meta.json", { baseDir: BaseDirectory.AppConfig });
    const parsed = JSON.parse(text) as { metas?: Record<string, RawMechanicMeta>; tablets?: unknown };

    const metas = parsed.metas;
    if (metas && typeof metas === "object") {
      const merged = MECHANICS.map((mech) => {
        const raw = metas[mech.name.toLowerCase()];
        return raw ? applyOverride(mech, raw) : mech;
      });
      setActiveMechanics(merged);
    } else {
      setActiveMechanics(MECHANICS);
    }

    setActiveTablets(mergeTablets(parsed.tablets));
  } catch {
    setActiveMechanics(MECHANICS);
    setActiveTablets(DEFAULT_TABLETS);
  }
}
