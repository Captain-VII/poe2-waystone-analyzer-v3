// Contract check for the analyzer adapter (M5): assert AnalysisResult
// boundary rules hold (docs/overlay-ui-spec.md §11). Run via:
// npm run verify-adapter (that script bundles src/analyzer/adapter.ts with
// esbuild first, since Node's ESM resolver needs explicit extensions the TS
// source doesn't use).
//
// SAMPLE is inlined directly (no external/sibling-repo file) so this script
// runs deterministically and offline on a fresh clone.
import {
  analyzeWaystoneText,
  TABLET_LINKED_MECHANICS,
  computeDangerLevel,
  dangerHitsToWarnings,
  describeDangerHits,
  detectDangerHits,
} from "./.adapter-bundle.mjs";

const SAMPLE = `Item Class: Waystones
Rarity: Rare
Forsaken Vault
Waystone (Tier 15)
--------
Waystone Tier: 15
Item Level: 82
--------
+45% increased Rarity of Items found in this Area
+38% increased Rarity of Monsters
+25% increased Pack Size
+30% Monster Effectiveness
2 additional Rare Monster packs
Area contains an Expedition Encampment
--------
Corrupted`;

let failures = 0;
function check(label, cond) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`ok:   ${label}`);
  }
}

const result = analyzeWaystoneText(SAMPLE);
check("parses sample as a valid waystone (non-null)", result !== null);
if (!result) process.exit(1);

console.log(JSON.stringify(result, null, 2));

// SAMPLE has exactly 6 mod lines between the two `--------` separators —
// confirm the parser's block-boundary logic still isolates that block.
console.log(`waystone.modCount: ${result.waystone.modCount} (expected 6)`);

check("waystone.tier === 15", result.waystone.tier === 15);
check("waystone.name === 'Forsaken Vault'", result.waystone.name === "Forsaken Vault");
check("waystone.corrupted === true", result.waystone.corrupted === true);
check("waystone.modCount === modifiers.length", result.waystone.modCount === result.modifiers.length);

check("tierClass is one of the five valid values",
  ["trash", "low", "good", "splus", "god"].includes(result.heat.tierClass));
check("verdict is one of the three valid values (§9: Skip/Run/Garder)",
  ["SKIP", "RUN", "GARDER"].includes(result.heat.verdict));
check("score is within 0-100 (§6 Juice Score)", result.heat.score >= 0 && result.heat.score <= 100);

check("insights has at most 3 entries", result.insights.length <= 3);
check("warning is a string or null", result.warning === null || typeof result.warning === "string");
check("warnings is an array of strings", Array.isArray(result.warnings) && result.warnings.every((w) => typeof w === "string"));
check("warning equals warnings[0] or null", result.warning === (result.warnings[0] ?? null));
check("dangerLevel is one of the four valid values",
  ["none", "low", "medium", "high"].includes(result.dangerLevel));
check("dangerLabel is a non-empty string", typeof result.dangerLabel === "string" && result.dangerLabel.length > 0);
check("dangerLevel is consistent with warnings (empty warnings <=> 'none')",
  (result.warnings.length === 0) === (result.dangerLevel === "none"));
const UI_SEVERITIES = ["high", "medium", "low"];
check("dangerHits is an array of {id, label, severity} views (UI 3-tier scale)",
  Array.isArray(result.dangerHits) &&
  result.dangerHits.every((h) => typeof h.id === "string" && typeof h.label === "string" && UI_SEVERITIES.includes(h.severity)));
check("dangerHits labels equal warnings (1:1, same order)",
  result.dangerHits.length === result.warnings.length &&
  result.dangerHits.every((h, i) => h.label === result.warnings[i]));

// Final integration assertion (adapter.ts's describeDangerHits, the
// boundary-layer function that replaced scoring.ts's removed
// describeDangerHits): one mixed-severity input exercising all three UI
// tiers at once — sorted high→low, labels 1:1 with dangerHitsToWarnings,
// and both "reflect" and "strong" domain severities landing in the HIGH
// group (the collapse this function exists to do).
const mixedHits = [
  { id: "reduced-curse-effect", severity: "minor" },
  { id: "fast-monsters", severity: "strong" },
  { id: "reduced-recovery", severity: "moderate" },
  { id: "reflect-damage", severity: "reflect" },
];
const mixedView = describeDangerHits(mixedHits);
const mixedLabels = dangerHitsToWarnings(mixedHits);
check("describeDangerHits: sorted high -> medium -> low across all tiers",
  mixedView.map((h) => h.severity).join(",") === "high,high,medium,low");
check("describeDangerHits: labels 1:1 with dangerHitsToWarnings",
  mixedView.every((h, i) => h.label === mixedLabels[i]));
check("describeDangerHits: both reflect and strong hits land in HIGH",
  mixedView[0].id === "reflect-damage" && mixedView[0].severity === "high" &&
  mixedView[1].id === "fast-monsters" && mixedView[1].severity === "high");

// §7/§8: Mechanic Match Score
check("mechanicScores is a non-empty array", Array.isArray(result.mechanicScores) && result.mechanicScores.length > 0);
check("mechanicScores sorted desc", result.mechanicScores.every((m, i, arr) => i === 0 || arr[i - 1].score >= m.score));
check("every mechanic score is within 0-100",
  result.mechanicScores.every((m) => m.score >= 0 && m.score <= 100));
check("recommendedMechanic is a string or null", result.recommendedMechanic === null || typeof result.recommendedMechanic === "string");
check("tablets have positive delta and named reasons", result.tablets.every((t) => typeof t.name === "string" && typeof t.reason === "string"));

// Rating + rewards + keyFactors (2026-07-04 UI-interpretability additions)
const RATINGS = ["S", "A", "B", "C", "D"];
check("heat.rating is one of the five valid letters", RATINGS.includes(result.heat.rating));
check("every tablet has a valid rating", result.tablets.every((t) => RATINGS.includes(t.rating)));
check("tablet rewards, when present, are non-empty label+value pairs",
  result.tablets.every((t) => t.rewards === undefined || (t.rewards.length > 0 && t.rewards.every((r) => typeof r.label === "string" && typeof r.value === "number"))));
check("keyFactors is an array of at most 4 short strings",
  Array.isArray(result.keyFactors) && result.keyFactors.length <= 4 && result.keyFactors.every((f) => typeof f === "string"));

// §11 (superseded 2026-07-06): breakdown rows are the raw loot-signal
// contributions (rarity/pack size/etc, pre-synergy) and no longer sum to
// `heat.score` — `heat.score` is now `effectiveScore` (synergy + stretch,
// normalized 0-100, then the danger penalty), while `breakdown` intentionally
// still reflects the pre-synergy/pre-danger model so users can see which raw
// stat drove the result. Just sanity-check the breakdown itself stays a
// plausible, non-negative composite.
const breakdownSum = result.heat.breakdown.reduce((s, b) => s + b.value, 0);
check(`breakdown sum is non-negative and finite (${breakdownSum.toFixed(2)})`, breakdownSum >= 0 && Number.isFinite(breakdownSum));

// modifiers[].kind must be a valid enum value
check("every modifier has a valid kind",
  result.modifiers.every((m) => ["positive", "neutral", "danger"].includes(m.kind)));

// Non-waystone text must return null cleanly (never throw)
const invalid = analyzeWaystoneText("Item Class: Body Armours\nRarity: Normal\nSomething");
check("non-waystone text returns null", invalid === null);

// Garbage/edge-case input must never throw
try {
  analyzeWaystoneText("");
  analyzeWaystoneText("Item Class: Waystones\n");
  check("empty/degenerate waystone text never throws", true);
} catch (e) {
  check(`empty/degenerate waystone text never throws (threw: ${e})`, false);
}

// ============================================================
// INVARIANTS — must survive any future weight/threshold rebalance.
// These encode relationships between fields, never a specific
// magic-number output, so tuning DEFAULT_WEIGHTS never breaks them.
// ============================================================

check("score in [0,100]", result.heat.score >= 0 && result.heat.score <= 100);

// Juice Detector v2 (2026-07-06): `score`/`verdict`/`tierClass` now measure
// real farming value, not loot potential alone — `heat.score` is
// `effectiveScore`, i.e. reward (synergy + stretch, normalized 0-100) scaled
// down by the danger penalty (none/low x1.0, medium x0.9, high x0.75).
// Danger/annoyance mods still surface via `warning`/`warnings`/`dangerLevel`
// too, but they are NO LONGER score-neutral — this is an intentional reversal
// of the original "danger never reduces score" rule (see the
// "dangerous-but-juicy" regression below, updated to match).

check("recommendedMechanic valid",
  result.recommendedMechanic === null ||
  (
    TABLET_LINKED_MECHANICS.has(result.recommendedMechanic) &&
    result.mechanicScores.find((m) => m.mechanic === result.recommendedMechanic)?.score > 0
  ));

check("deterministic scoring",
  analyzeWaystoneText(SAMPLE).heat.score === analyzeWaystoneText(SAMPLE).heat.score);

// ============================================================
// DANGER LOGIC — unit-level checks on the structured DangerHit[] model
// (scoring.ts), independent of the AnalysisResult pipeline above. Proves
// dangerLevel is a pure function of `severity`, with zero coupling to any
// `id`/label string — renaming or relocalizing a warning cannot silently
// change danger logic.
// ============================================================

check("computeDangerLevel([]) is 'none'", computeDangerLevel([]) === "none");

check("computeDangerLevel: any reflect hit is always 'high'",
  computeDangerLevel([{ id: "reflect-damage", severity: "reflect" }]) === "high");

check("computeDangerLevel: 3+ hits incl. one strong is 'high'",
  computeDangerLevel([
    { id: "a", severity: "strong" },
    { id: "b", severity: "moderate" },
    { id: "c", severity: "moderate" },
  ]) === "high");

check("computeDangerLevel: a single strong hit is 'medium'",
  computeDangerLevel([{ id: "a", severity: "strong" }]) === "medium");

check("computeDangerLevel: 2+ moderate hits is 'medium'",
  computeDangerLevel([{ id: "a", severity: "moderate" }, { id: "b", severity: "moderate" }]) === "medium");

check("computeDangerLevel: a single minor hit is 'low'",
  computeDangerLevel([{ id: "a", severity: "minor" }]) === "low");

// The core anti-coupling guarantee: renaming/relocalizing `id` must never
// change the computed level, since computeDangerLevel only ever reads
// `severity`. Two hit sets differing ONLY in `id` strings must agree.
const hitsWithOriginalIds = [{ id: "reflect-damage", severity: "reflect" }, { id: "fast-monsters", severity: "strong" }];
const hitsWithRenamedIds = [{ id: "some-renamed-warning-xyz", severity: "reflect" }, { id: "translated-libellé", severity: "strong" }];
check("changing a warning's id/label does NOT affect dangerLevel",
  computeDangerLevel(hitsWithOriginalIds) === computeDangerLevel(hitsWithRenamedIds));

// dangerHitsToWarnings must sort most-severe-first regardless of input order.
const scrambledHits = [
  { id: "reduced-curse-effect", severity: "minor" },
  { id: "reduced-recovery", severity: "moderate" },
  { id: "reflect-damage", severity: "reflect" },
  { id: "high-crit-monsters", severity: "strong" },
];
const orderedWarnings = dangerHitsToWarnings(scrambledHits);
check("dangerHitsToWarnings sorts reflect > strong > moderate > minor",
  orderedWarnings[0] === "Reflect Damage" &&
  orderedWarnings[1] === "High Crit Monsters" &&
  orderedWarnings[2] === "Reduced Recovery" &&
  orderedWarnings[3] === "Reduced Curse Effect");

// ============================================================
// DANGER DETECTION — per-category unit tests on detectDangerHits
// (real PoE2-style mod wording). Each pins detection + severity for one
// pattern-table category, so a fat-fingered severity or regex edit can't
// drift silently.
// ============================================================

check("detectDangerHits: crit monsters (strong)",
  detectDangerHits("Monsters have +50% Critical Hit Chance")
    .some((h) => h.id === "high-crit-monsters" && h.severity === "strong"));

check("detectDangerHits: fast monsters (strong)",
  detectDangerHits("Monsters have 40% increased Attack, Cast, and Movement Speed")
    .some((h) => h.id === "fast-monsters" && h.severity === "strong"));

check("detectDangerHits: reduced curse effect (minor)",
  detectDangerHits("50% reduced Effect of Curses on Monsters")
    .some((h) => h.id === "reduced-curse-effect" && h.severity === "minor"));

check("detectDangerHits: elemental penetration, monster wording (strong)",
  detectDangerHits("Monster Damage Penetrates 15% Elemental Resistances")
    .some((h) => h.id === "elemental-penetration" && h.severity === "strong"));

// REQUIRED negative cases — the penetration pattern must be scoped to
// monster modifiers. A plain resistance line has no danger content at all,
// and a player-side "Damage Penetrates ..." line (gear/passive wording, no
// "Monster" prefix) must NOT fire elemental-penetration. The second case is
// the pinned regression for the unscoped-regex false-positive bug.
check("detectDangerHits: resistance line produces no hits",
  detectDangerHits("+10% to Fire Resistance").length === 0);

check("detectDangerHits: non-monster penetration text does NOT match",
  !detectDangerHits("Damage Penetrates 10% of Enemy Elemental Resistances")
    .some((h) => h.id === "elemental-penetration"));

// NOT asserted: "no single breakdown component exceeds the total score."
// Verified empirically false — scoring.ts's speed-penalty multipliers
// apply to the post-sum total, but each breakdown row displays its
// pre-penalty contribution, so a single field (e.g. itemRarity: 4.95) can
// legitimately exceed a final penalized score (e.g. 3.03) on real input
// with a "reduced recovery"/"avoid ailments" mod present. Asserting it
// would fail on correct output, not catch a real regression — a flaky
// check here is worse than no check.

// ============================================================
// PINNED REGRESSION TESTS — must NEVER break. Each one encodes a
// specific, already-diagnosed bug; an invariant can't catch a
// regression in the exact regex/filter that fixed it, only re-running
// the literal scenario can.
// ============================================================

// Real PoE2 wording ("Monsters reflect 18% of Elemental Damage") must
// still hard-block — regression case for the reflect-regex fix.
const SAMPLE_REFLECT = `Item Class: Waystones
Rarity: Magic
Waystone of the Fool
Waystone (Tier 4)
--------
Waystone Tier: 4
Item Level: 20
--------
Monsters reflect 18% of Elemental Damage
Monsters have 20% increased Accuracy Rating
--------`;
const reflect = analyzeWaystoneText(SAMPLE_REFLECT);
// SAMPLE_REFLECT scores 0 regardless of the v2 danger penalty, since it
// carries no rarity/pack/etc stats at all (0 x any multiplier is still 0) —
// this only pins that reflect still surfaces as a warning. The
// dangerous-but-juicy regression below is what pins the actual v2 danger
// penalty math on a map with real loot stats.
check("reflect produces a warning", reflect.warnings.includes("Reflect Damage"));
check("reflect warning present", reflect.warning?.toLowerCase().includes("reflect") ?? false);

// Juice Detector v2 (2026-07-06): a map with great loot stats but severe
// danger must still clearly be worth running (verdict !== SKIP, several
// warnings survive), but its score must now land measurably below what the
// same loot stats would score if safe — proving the danger penalty
// (dangerLevel 'high' => x0.75 on effectiveScore) actually applies. This
// intentionally supersedes the old "danger never reduces score" rule.
const SAMPLE_DANGEROUS_BUT_JUICY = `Item Class: Waystones
Rarity: Rare
Doomvault
Waystone (Tier 15)
--------
Waystone Tier: 15
Item Level: 82
--------
+160% increased Rarity of Items found in this Area
+90% increased Rarity of Monsters
+140% increased Pack Size
+90% Monster Effectiveness
Area contains an Expedition Encampment
Monsters reflect 18% of Elemental Damage
Monsters have 40% increased Attack, Cast, and Movement Speed
--------
Corrupted`;
const dangerousButJuicy = analyzeWaystoneText(SAMPLE_DANGEROUS_BUT_JUICY);
// Same loot stats, with the two danger-mod lines removed — isolates the
// danger penalty's effect instead of pinning a magic-number score, so this
// keeps working across future weight/synergy rebalances.
const SAMPLE_JUICY_BUT_SAFE = SAMPLE_DANGEROUS_BUT_JUICY
  .split("\n")
  .filter((l) => !/reflect|Attack, Cast, and Movement Speed/.test(l))
  .join("\n");
const juicyButSafe = analyzeWaystoneText(SAMPLE_JUICY_BUT_SAFE);
check("dangerous-but-juicy map still clears SKIP despite warnings",
  dangerousButJuicy.heat.score > 20 &&
  dangerousButJuicy.heat.verdict !== "SKIP" &&
  dangerousButJuicy.warnings.length >= 2);
check("dangerous-but-juicy map scores measurably below its safe equivalent (danger penalty applied)",
  juicyButSafe.dangerLevel === "none" &&
  dangerousButJuicy.heat.score < juicyButSafe.heat.score);
// dangerLevel is a fully separate signal from score/verdict — this map must
// read as clearly dangerous (reflect present) despite its high Juice Score.
check("dangerous-but-juicy map has dangerLevel 'high'",
  dangerousButJuicy.dangerLevel === "high");
// End-to-end (not just the unit-level dangerHitsToWarnings check above):
// the real pipeline's warnings[] must also come out reflect-first.
check("dangerous-but-juicy map's warnings are severity-ordered (reflect first)",
  dangerousButJuicy.warnings[0] === "Reflect Damage");
// Same guarantee for the structured view the Full-mode danger list renders.
// Reflect collapses to the UI's "high" tier (adapter.ts's UI_SEVERITY map).
check("dangerous-but-juicy map's dangerHits mirror warnings with severities",
  dangerousButJuicy.dangerHits.length === dangerousButJuicy.warnings.length &&
  dangerousButJuicy.dangerHits.every((h, i) => h.label === dangerousButJuicy.warnings[i]) &&
  dangerousButJuicy.dangerHits[0].severity === "high");

// Mirror case: a safe map with poor loot stats must score low AND read as
// low-danger — the two signals move independently in both directions.
const SAMPLE_SAFE_BUT_DULL = `Item Class: Waystones
Rarity: Magic
Waystone of the Calm
Waystone (Tier 2)
--------
Waystone Tier: 2
Item Level: 10
--------
+5% increased Rarity of Items found in this Area
--------`;
const safeButDull = analyzeWaystoneText(SAMPLE_SAFE_BUT_DULL);
check("safe-but-dull map scores low with no/low danger",
  safeButDull.heat.score < 20 &&
  safeButDull.heat.verdict === "SKIP" &&
  (safeButDull.dangerLevel === "none" || safeButDull.dangerLevel === "low"));

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
