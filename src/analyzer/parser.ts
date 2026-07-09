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
  // Real PoE2 clipboard text (verified against a live copy, 2026-07-09) has
  // no "Waystone Tier:" line at all — only the header's own base-type line,
  // "Waystone (Tier N)", carries it. That line is always present (it's the
  // item's base type), so it's tried first; the old "Waystone Tier:"
  // line-scan is kept as a tolerant fallback in case some other context
  // still emits it — costs nothing, never fires against real text today.
  for (const block of blocks) {
    const headerMatch = block.match(/Waystone\s*\(Tier\s*(\d+)\)/i);
    if (headerMatch) {
      const n = Number(headerMatch[1]);
      if (Number.isFinite(n)) return n;
    }
  }
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

// Real PoE2 clipboard text prefixes every rolled modifier with a label line
// like `{ Prefix Modifier "Frostbitten" (Tier: 1) }` — pure metadata, no
// stat. Left in, it inflates modCount and shows up as a meaningless row in
// the Full-mode modifier list (verified against a live copy, 2026-07-09).
const MOD_LABEL_LINE = /^\{\s*(?:Prefix|Suffix|Implicit|Enchant)\s+Modifier\b.*\}$/i;

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
      .filter((l) => l.length > 0)
      .filter((l) => !MOD_LABEL_LINE.test(l));
  }
  return [];
}
