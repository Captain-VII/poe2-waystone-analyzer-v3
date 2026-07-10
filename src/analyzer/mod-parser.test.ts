// Covers only the tolerant regex parser (parseMods). Deliberately excludes
// the scoring/ranking model (mechanics.ts, scoring.ts, rewards.ts) and
// tablets.ts's DEFAULT_TABLETS mod values — out of scope for this pass.

import { describe, expect, it } from "vitest";
import { parseMods } from "./mod-parser";

describe("parseMods", () => {
  it("parses number-before-keyword phrasing", () => {
    const result = parseMods("+45% increased Rarity of Items found in this Area");
    expect(result.itemRarity).toBe(45);
  });

  it("parses keyword-before-number phrasing (header style)", () => {
    const result = parseMods("Item Rarity: +45% (augmented)");
    expect(result.itemRarity).toBe(45);
  });

  it("tolerates both find and drop phrasing for waystoneDropChance", () => {
    const find = parseMods("15% chance to find an additional Waystone");
    const drop = parseMods("15% chance to drop a Waystone");
    expect(find.waystoneDropChance).toBe(15);
    expect(drop.waystoneDropChance).toBe(15);
  });

  it("parses a realistic multi-line mod block into all six fields", () => {
    const text = [
      "+85% increased Item Quantity",
      "+45% increased Rarity of Items found in this Area",
      "12% increased Rarity of Monsters",
      "8% increased Pack Size",
      "20% increased Monster Effectiveness",
      "15% chance to drop a Waystone",
    ].join("\n");
    expect(parseMods(text)).toEqual({
      quantity: 85,
      itemRarity: 45,
      monsterRarity: 12,
      packSize: 8,
      monsterEffectiveness: 20,
      waystoneDropChance: 15,
    });
  });

  it("keeps the max value when the same stat appears more than once", () => {
    const text = ["10% increased Pack Size", "25% increased Pack Size"].join("\n");
    expect(parseMods(text).packSize).toBe(25);
  });

  it("degrades to the all-zero default on empty/null/undefined/whitespace input", () => {
    const zero = {
      quantity: 0,
      itemRarity: 0,
      monsterRarity: 0,
      packSize: 0,
      monsterEffectiveness: 0,
      waystoneDropChance: 0,
    };
    expect(parseMods("")).toEqual(zero);
    expect(parseMods(null)).toEqual(zero);
    expect(parseMods(undefined)).toEqual(zero);
    expect(parseMods("   \n  \n")).toEqual(zero);
  });

  it("is case-insensitive", () => {
    const lower = parseMods("+45% increased rarity of items found in this area");
    const mixed = parseMods("+45% INCREASED Rarity OF Items found IN this Area");
    expect(lower.itemRarity).toBe(45);
    expect(mixed.itemRarity).toBe(45);
  });
});
