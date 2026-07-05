/** Robust, tolerant parser for waystone/item mod text. Extracts the 5
 *  signals the cahier des charges scores against (§2/§5): Item Rarity,
 *  Monster Rarity, Pack Size, Monster Effectiveness, Waystone Drop Chance —
 *  plus Item Quantity, kept as a minor mod-count-style signal. Never
 *  throws: degrades to zeros on anything unexpected. */

export interface ModStats {
  quantity: number;
  itemRarity: number;
  monsterRarity: number;
  packSize: number;
  monsterEffectiveness: number;
  waystoneDropChance: number;
}

const DEFAULT_RESULT: ModStats = {
  quantity: 0,
  itemRarity: 0,
  monsterRarity: 0,
  packSize: 0,
  monsterEffectiveness: 0,
  waystoneDropChance: 0,
};

// One regex per mod, tolerant to word order in both directions:
//   "+85% increased Item Quantity"    -> number before keyword
//   "Item Quantity: +85% (augmented)" -> keyword before number
export const PATTERNS: Record<keyof ModStats, RegExp> = {
  quantity: /(?:(\d+)\s*%[^%\n]{0,20}?(?:item\s+)?quantity|(?:item\s+)?quantity[^%\d\n]{0,20}?(\d+)\s*%)/i,
  // Real PoE2 item text uses both "Item Rarity: +45%" (header) and
  // "+45% increased Rarity of Items found in this Area" (mod line) — accept
  // either "item rarity" or "rarity of items", but not when "monster"
  // qualifies it (that's monsterRarity's job).
  itemRarity:
    /(?:(\d+)\s*%[^%\n]{0,25}?(?:item\s+rarity|rarity\s+of\s+items)|(?:item\s+rarity|rarity\s+of\s+items)[^%\d\n]{0,25}?(\d+)\s*%)/i,
  monsterRarity:
    /(?:(\d+)\s*%[^%\n]{0,25}?(?:monster\s+rarity|rarity\s+of\s+monsters)|(?:monster\s+rarity|rarity\s+of\s+monsters)[^%\d\n]{0,25}?(\d+)\s*%)/i,
  packSize: /(?:(\d+)\s*%[^%\n]{0,20}?pack\s*size|pack\s*size[^%\d\n]{0,20}?(\d+)\s*%)/i,
  monsterEffectiveness:
    /(?:(\d+)\s*%[^%\n]{0,25}?monster\s+effectiveness|monster\s+effectiveness[^%\d\n]{0,25}?(\d+)\s*%)/i,
  // "chance to find an additional Waystone" (drop-first) and "chance to
  // drop a Waystone" (the real Overseer Precursor Tablet's phrasing,
  // find-vs-drop reversed) both mean the same thing — tolerate either verb.
  waystoneDropChance:
    /(?:(\d+)\s*%[^%\n]{0,30}?(?:waystones?\s+(?:found|drop)|chance\s+to\s+(?:find|drop)\s+an?\s+(?:additional\s+)?waystones?)|(?:waystones?\s+(?:found|drop))[^%\d\n]{0,30}?(\d+)\s*%)/i,
};

function cleanLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l.length > 0);
}

function extractMods(lines: string[]): ModStats {
  const result: ModStats = { ...DEFAULT_RESULT };
  for (const line of lines) {
    for (const key of Object.keys(PATTERNS) as (keyof ModStats)[]) {
      const match = PATTERNS[key].exec(line);
      if (!match) continue;
      const value = Number(match[1] ?? match[2]);
      // If the same mod appears more than once, keep the strongest value.
      result[key] = Math.max(result[key], value);
    }
  }
  return result;
}

/** Never throws. Any unexpected input degrades to the all-zero default. */
export function parseMods(text: string | null | undefined): ModStats {
  try {
    if (typeof text !== "string" || !text.trim()) return { ...DEFAULT_RESULT };
    return extractMods(cleanLines(text));
  } catch {
    return { ...DEFAULT_RESULT };
  }
}
