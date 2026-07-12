// Guards against mock.ts's dev fixtures drifting from the real adapter's
// shape — happened twice in one session (2026-07-12): the fixed
// alphabetical tablet order outlived the real sort-by-fit change, and the
// breakdown was missing the waystoneDropChance row entirely because
// DEFAULT_WEIGHTS gained it long after this fixture was last touched.
// Both were silent (TypeScript doesn't catch "array has the wrong keys" or
// "missing an array entry"), so this exists to catch the next one loudly.

import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS } from "./analyzer/scoring";
import { MOCK_RESULTS, TIER_ORDER } from "./mock";

describe("mock fixtures stay in sync with the real adapter's shape", () => {
  const realStatKeys = Object.keys(DEFAULT_WEIGHTS);

  it.each(TIER_ORDER)("%s: breakdown has exactly the real Weights stat rows, in order", (tier) => {
    const keys = MOCK_RESULTS[tier].heat.breakdown.map((row) => row.key).filter((key) => key !== "bonus");
    expect(keys).toEqual(realStatKeys);
  });

  it.each(TIER_ORDER)("%s: tablets are sorted by fit descending, matching rankTablets", (tier) => {
    const fits = MOCK_RESULTS[tier].tablets.map((t) => t.fit);
    expect(fits).toEqual([...fits].sort((a, b) => b - a));
  });
});
