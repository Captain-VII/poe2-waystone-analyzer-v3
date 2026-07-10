// Covers only the merge logic (parseUnified). Deliberately excludes the
// scoring/ranking model (mechanics.ts, scoring.ts, rewards.ts) and
// tablets.ts's DEFAULT_TABLETS mod values — out of scope for this pass.

import { describe, expect, it } from "vitest";
import { parseUnified } from "./unified-parser";

const VALID_WAYSTONE = `Item Class: Waystones
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

describe("parseUnified", () => {
  it("reads a valid waystone via the structural (primary) parser", () => {
    const result = parseUnified(VALID_WAYSTONE);
    expect(result.itemRarity).toBe(45);
    expect(result.monsterRarity).toBe(12);
    expect(result.quantity).toBe(0);
    expect(result.packSize).toBe(0);
  });

  it("falls back to the tolerant regex parser when the structural parser throws", () => {
    const notAWaystone = `Random Item
+20% increased Pack Size
12% increased Monster Effectiveness`;
    const result = parseUnified(notAWaystone);
    expect(result.packSize).toBe(20);
    expect(result.monsterEffectiveness).toBe(12);
  });

  it("returns the all-zero default for fully unrecognizable text", () => {
    const result = parseUnified("asdf jkl; nothing to see here");
    expect(result).toEqual({
      quantity: 0,
      itemRarity: 0,
      monsterRarity: 0,
      packSize: 0,
      monsterEffectiveness: 0,
      waystoneDropChance: 0,
    });
  });
});
