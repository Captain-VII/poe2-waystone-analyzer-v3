// Covers only the structural parser (parseWaystone). Deliberately excludes
// the scoring/ranking model (mechanics.ts, scoring.ts, rewards.ts) and
// tablets.ts's DEFAULT_TABLETS mod values — out of scope for this pass.

import { describe, expect, it } from "vitest";
import { NotAWaystoneError, parseWaystone } from "./parser";

const CORRUPTED_WAYSTONE = `Item Class: Waystones
Rarity: Normal
Waystone of the Hunt
Waystone (Tier 5)
--------
Item Level: 68
--------
{ Prefix Modifier "Rarity" (Tier: 1) }
+45% increased Rarity of Items found in this Area
{ Suffix Modifier "of the Hunt" (Tier: 2) }
12% increased Rarity of Monsters
--------
Corrupted`;

const UNCORRUPTED_WAYSTONE = `Item Class: Waystones
Rarity: Normal
Waystone of the Hunt
Waystone (Tier 5)
--------
Item Level: 68
--------
{ Prefix Modifier "Rarity" (Tier: 1) }
+45% increased Rarity of Items found in this Area
{ Suffix Modifier "of the Hunt" (Tier: 2) }
12% increased Rarity of Monsters`;

describe("parseWaystone", () => {
  it("parses a full corrupted waystone", () => {
    const result = parseWaystone(CORRUPTED_WAYSTONE);
    expect(result.name).toBe("Waystone of the Hunt");
    expect(result.tier).toBe(5);
    expect(result.rarity).toBe("Normal");
    expect(result.corrupted).toBe(true);
    expect(result.modifiers).toEqual([
      "+45% increased Rarity of Items found in this Area",
      "12% increased Rarity of Monsters",
    ]);
    expect(result.contentText).toContain("+45% increased Rarity of Items found in this Area");
    expect(result.contentText).toContain("Corrupted");
  });

  it("parses the same waystone without a Corrupted block", () => {
    const result = parseWaystone(UNCORRUPTED_WAYSTONE);
    expect(result.corrupted).toBe(false);
    expect(result.modifiers).toEqual([
      "+45% increased Rarity of Items found in this Area",
      "12% increased Rarity of Monsters",
    ]);
  });

  it("throws NotAWaystoneError when the item class line is missing", () => {
    expect(() => parseWaystone("Item Class: Rings\nRarity: Normal\nA Ring")).toThrow(
      NotAWaystoneError,
    );
  });

  it("falls back to the legacy 'Waystone Tier:' line when the header doesn't carry it", () => {
    const text = `Item Class: Waystones
Rarity: Magic
Strange Waystone
Waystone Tier: 7
--------
Item Level: 50`;
    expect(parseWaystone(text).tier).toBe(7);
  });

  it("returns no modifiers when Item Level is directly followed by Corrupted", () => {
    const text = `Item Class: Waystones
Rarity: Normal
Plain Waystone
Waystone (Tier 3)
--------
Item Level: 60
--------
Corrupted`;
    expect(parseWaystone(text).modifiers).toEqual([]);
  });
});
