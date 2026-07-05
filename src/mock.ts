import { CAPS, computeDangerLevel, dangerHitsToWarnings, type DangerHit } from "./analyzer/scoring";
import { DANGER_LABELS, describeDangerHits } from "./analyzer/adapter";
import { formatPercent, getScoreLabel } from "./analyzer/displayAdapter";
import type { AnalysisResult, TierClass, Verdict } from "./types";

export const TIER_ORDER: TierClass[] = ["trash", "low", "good", "splus", "god"];

const TABLETS: AnalysisResult["tablets"] = [
  {
    name: "Expedition Tablet",
    delta: 6.0,
    reason: "Matches Expedition (82/100)",
    rating: "A",
    rewards: [
      { label: "Expedition", value: 8 },
      { label: "Logbook", value: 6 },
    ],
  },
  { name: "Standard Precursor Tablet", delta: 3.5, reason: "Matches General (68/100)", rating: "B" },
];

const MODIFIERS: AnalysisResult["modifiers"] = [
  { text: "Monsters reflect 18% of Elemental Damage", kind: "danger" },
  { text: "+38% Rarity of Items found in this Area", kind: "positive" },
  { text: "+22% Monster Rarity", kind: "positive" },
  { text: "2 additional Rare Monster packs", kind: "positive" },
  { text: "+25% Monster Pack Size", kind: "positive" },
  { text: "+18% Monster Effectiveness", kind: "positive" },
  { text: "Area has patches of Chilled Ground", kind: "neutral" },
  { text: "+14% Monster Movement Speed", kind: "neutral" },
];

const MECHANIC_SCORES: AnalysisResult["mechanicScores"] = [
  { mechanic: "Expedition", score: 82 },
  { mechanic: "General", score: 68 },
  { mechanic: "Blight", score: 55 },
];

function fixture(
  overrides: Pick<AnalysisResult["heat"], "score" | "tierClass" | "tierLabel" | "verdict" | "rating">,
  br: [number, number, number, number],
  dangerHits: DangerHit[],
  insight: string,
  keyFactors: string[] = [],
): AnalysisResult {
  const warnings = dangerHitsToWarnings(dangerHits);
  const dangerLevel = computeDangerLevel(dangerHits);
  return {
    waystone: { tier: 15, name: "Waystone of the Sovereign", corrupted: false, modCount: 6 },
    heat: {
      ...overrides,
      scoreLabel: getScoreLabel(overrides.score),
      // `br` doubles as the real stat % here (2026-07-06: matches the real
      // adapter's contract — display/max — so this dev fixture demonstrates
      // the same real-percentage rendering production data does).
      breakdown: [
        { key: "itemRarity", label: "Item Rarity", value: br[0], display: formatPercent(br[0]), max: CAPS.itemRarity },
        {
          key: "monsterRarity",
          label: "Monster Rarity",
          value: br[1],
          display: formatPercent(br[1]),
          max: CAPS.monsterRarity,
        },
        { key: "packSize", label: "Pack Size", value: br[2], display: formatPercent(br[2]), max: CAPS.packSize },
        {
          key: "monsterEffectiveness",
          label: "Monster Effectiveness",
          value: br[3],
          display: formatPercent(br[3]),
          max: CAPS.monsterEffectiveness,
        },
      ],
    },
    modifiers: MODIFIERS,
    tablets: TABLETS,
    warning: warnings[0] ?? null,
    warnings,
    dangerHits: describeDangerHits(dangerHits),
    dangerLevel,
    dangerLabel: DANGER_LABELS[dangerLevel],
    insights: [insight, "Safe to corrupt — modifier ceiling reached"],
    mechanicScores: MECHANIC_SCORES,
    recommendedMechanic: "Expedition",
    keyFactors,
  };
}

const VERDICT: Record<TierClass, Verdict> = {
  trash: "SKIP",
  low: "RUN",
  good: "RUN",
  splus: "GARDER",
  god: "GARDER",
};

export const MOCK_RESULTS: Record<TierClass, AnalysisResult> = {
  trash: fixture(
    { score: 12.6, tierClass: "trash", tierLabel: "Faible", verdict: VERDICT.trash, rating: "D" },
    [3.0, 2.0, 4.0, 3.6],
    [],
    "Re-roll or vendor this Waystone",
  ),
  low: fixture(
    { score: 32.2, tierClass: "low", tierLabel: "Moyen", verdict: VERDICT.low, rating: "C" },
    [8.0, 6.0, 9.0, 9.2],
    [],
    "Run only to sustain Waystones",
  ),
  good: fixture(
    { score: 52.5, tierClass: "good", tierLabel: "Bon", verdict: VERDICT.good, rating: "B" },
    [12.0, 10.0, 14.0, 16.5],
    [],
    "Worth a mid-tier tablet slot",
    ["High Monster Effectiveness"],
  ),
  splus: fixture(
    { score: 76.7, tierClass: "splus", tierLabel: "Excellent", verdict: VERDICT.splus, rating: "A" },
    [16.0, 15.0, 19.0, 22.7],
    [{ id: "reflect-damage", severity: "reflect" }],
    "Pairs well with Expedition tablets",
    ["High Monster Effectiveness", "High Pack Size", "Strong Expedition match"],
  ),
  // Demonstrates the Juice Detector contract: score/tier/verdict stay top-end
  // even with multiple simultaneous danger mods — danger only ever shows up
  // via warnings, never by pulling the score down.
  god: fixture(
    { score: 94.2, tierClass: "god", tierLabel: "Legendaire", verdict: VERDICT.god, rating: "S" },
    [20.0, 19.0, 21.0, 25.0],
    [
      { id: "reflect-damage", severity: "reflect" },
      { id: "fast-monsters", severity: "strong" },
    ],
    "Pairs well with Expedition tablets",
    ["High Monster Effectiveness", "Strong Expedition match", "Expedition rewards"],
  ),
};
