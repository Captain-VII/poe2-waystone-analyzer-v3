/** Parse raw Path of Exile 2 clipboard text into a Waystone object.
 *  Ported from poe2-waystone-analyzer-v2/src/core/parser.py. */

export interface ParsedWaystone {
  name: string;
  tier: number;
  rarity: string;
  corrupted: boolean;
  modifiers: string[];
  /** Every block except the header (block 0 — Item Class/Rarity/name/
   *  "Waystone (Tier X)"): the mod block, plus any separate enchant/
   *  implicit blocks (e.g. instilled "Players in Area are X% Delirious"),
   *  plus "Corrupted" if present. Used by scoring.ts/adapter.ts for
   *  mechanic-keyword detection — excludes the item's own NAME (a
   *  false-positive source: a waystone named "Ritual Reliquary" must not
   *  count as having Ritual) while still covering mod-like lines that
   *  `modifiers` alone (single block only) can miss. */
  contentText: string;
}

const SEPARATOR = "--------";

export class NotAWaystoneError extends Error {}

export function parseWaystone(text: string): ParsedWaystone {
  if (!text.includes("Item Class: Waystones")) {
    throw new NotAWaystoneError("This text does not look like a Waystone item.");
  }

  const blocks = text
    .trim()
    .split(SEPARATOR)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const headerLines = blocks[0]!.split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return {
    name: extractName(headerLines),
    tier: extractTier(blocks),
    rarity: extractValue(headerLines, "Rarity:"),
    corrupted: blocks.some((b) => b.trim() === "Corrupted"),
    modifiers: extractModifiers(blocks),
    contentText: blocks.slice(1).join("\n"),
  };
}

function extractValue(lines: string[], prefix: string): string {
  for (const line of lines) {
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
  }
  return "";
}

function extractName(lines: string[]): string {
  for (const line of lines) {
    if (line.startsWith("Item Class:") || line.startsWith("Rarity:")) continue;
    if (line.startsWith("Waystone (Tier")) continue;
    return line;
  }
  return "Unknown Waystone";
}

function extractTier(blocks: string[]): number {
  for (const block of blocks) {
    for (const rawLine of block.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.startsWith("Waystone Tier:")) {
        const n = Number(line.slice("Waystone Tier:".length).trim());
        return Number.isFinite(n) ? n : 0;
      }
    }
  }
  return 0;
}

function extractModifiers(blocks: string[]): string[] {
  // The modifier list is the block that follows "Item Level: X".
  for (let i = 0; i < blocks.length; i++) {
    if (!blocks[i]!.includes("Item Level:")) continue;
    if (i + 1 >= blocks.length) return [];
    const candidate = blocks[i + 1]!;
    if (candidate.trim() === "Corrupted") return [];
    return candidate
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }
  return [];
}
