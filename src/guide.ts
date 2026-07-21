/** Static "Guide" panel content: why each stat matters and how the score is
 *  computed, so the player understands the Ctrl+E verdict instead of just
 *  trusting it blindly. Grounded directly in the real logic it explains
 *  (scoring.ts's dominant-stat model, mechanics.ts's priority-stat fit,
 *  adapter.ts's Skip/Keep/Run thresholds) — kept in sync with those by
 *  hand, same convention as CHANGELOG.md (bundled, not generated). */

export interface GuideSection {
  title: string;
  bullets: string[];
}

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    title: "How it works",
    bullets: [
      "Hover a Waystone in-game and press your analyze hotkey (**Ctrl+E** by default) — the app copies its text and scores it instantly, no manual copy needed.",
      "You get a **Juice Score** (0-100) with a Skip/Keep/Run verdict, and — when a league mechanic tablet applies — a **Mechanic Match Score** plus a ranked list of Recommended Tablets.",
    ],
  },
  {
    title: "The Juice Score",
    bullets: [
      "It's built around your waystone's **single strongest stat**, not an average of all of them. Each stat is compared against its own realistic ceiling first (they roll on very different scales), then tiered: Weak, OK, Top, or Legendary.",
      "Every other stat that's at least \"OK\" adds a small bonus on top — so one genuinely great roll carries the score, instead of being diluted by four mediocre lines.",
    ],
  },
  {
    title: "The 5 stats behind it",
    bullets: [
      "**Item Rarity** — better quality of everything the map drops (more rares/uniques).",
      "**Monster Rarity** — more magic and rare monsters spawn; each one drops more on its own.",
      "**Pack Size** — more monsters per pack overall, so more kills, more drops.",
      "**Monster Effectiveness** — monsters hit harder and take more to kill; raises rewards, but is danger-adjacent (see Warnings below).",
      "**Waystone Drop Chance** — more Waystones come back from the map, sustaining your mapping. It naturally rolls higher than the other four, so its own Legendary bar is set higher too.",
    ],
  },
  {
    title: "Item Quantity — the odd one out",
    bullets: [
      "Quantity is parsed but deliberately left out of the Juice Score — it skewed results when it was weighted in. It still matters for one thing: the Mechanic Match Score of mechanics whose real profit scales with it (Expedition above all).",
    ],
  },
  {
    title: "Verdict: Skip / Keep / Run",
    bullets: [
      "**Skip** — Juice Score below 20: not worth running.",
      "**Keep** — Juice Score 50+ on a Tier 3+ Waystone: strong enough to hold onto for a good Precursor Tablet instead of running it right away.",
      "**Run** — everything else worth playing.",
    ],
  },
  {
    title: "Mechanic Match & Recommended Tablets",
    bullets: [
      "Each league mechanic (Expedition, Abyss, Delirium, ...) cares about one specific stat the most — its **priority stat** — because that's what actually predicts good rewards FROM that mechanic, not from the map in general.",
      "The app reads your waystone's priority stat for the mechanic it best fits, tiers it the same way as the Juice Score, and ranks Precursor Tablets by how well they'd combo with what you're holding.",
    ],
  },
  {
    title: "Warnings",
    bullets: [
      "Dangerous or annoying mods (Reflect, Cannot Leech, Fast Monsters, ...) are flagged but never lower the score — the Juice Score measures loot potential only. Staying safe with those mods is your call.",
    ],
  },
];
