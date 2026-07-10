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
  modCountBonus,
  setActiveMechanics,
  MECHANICS,
  TIER_SCORE,
  priorityStatTier,
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
// 2026-07-10 (user request): the adapter no longer truncates to a top-5
// slice — every active tablet is returned, so a real (>5-tablet) roster
// must come back whole. The overlay is what caps Compact's rows now, not
// the data contract (RelicPanel.ts).
check("tablets are NOT pre-truncated to 5 (adapter returns every active tablet)", result.tablets.length > 5);

// Rating + rewards + keyFactors (2026-07-04 UI-interpretability additions)
const RATINGS = ["S", "A", "B", "C", "D"];
check("heat.rating is one of the five valid letters", RATINGS.includes(result.heat.rating));
check("every tablet has a valid rating", result.tablets.every((t) => RATINGS.includes(t.rating)));
const TABLET_VERDICTS = ["run", "why-not", "dont-run"];
check("every tablet has a valid verdict", result.tablets.every((t) => TABLET_VERDICTS.includes(t.verdict)));
check("tablet rewards, when present, are non-empty label+value pairs",
  result.tablets.every((t) => t.rewards === undefined || (t.rewards.length > 0 && t.rewards.every((r) => typeof r.label === "string" && typeof r.value === "number"))));

// Breakdown (2026-07-10): every tablet gets a non-empty "why this score"
// decomposition — always at least a "Stat fit" row (buildTabletBreakdown
// never omits it), rows have a label and an optional numeric value only
// (never NaN/null — value-less qualitative rows omit the key entirely).
check("every tablet has a non-empty breakdown with a Stat fit row",
  result.tablets.every((t) =>
    Array.isArray(t.breakdown) && t.breakdown.length > 0 &&
    t.breakdown[0].label === "Stat fit" && typeof t.breakdown[0].value === "number"));
check("breakdown rows are well-formed (label + optional finite value)",
  result.tablets.every((t) => t.breakdown.every((r) =>
    typeof r.label === "string" && r.label.length > 0 &&
    (r.value === undefined || (typeof r.value === "number" && Number.isFinite(r.value))))));
// Delirium Tablet declares real rewards (rewards.ts) — its breakdown must
// surface that as a "Reward" line, not silently drop it.
const deliriumTabletRow = result.tablets.find((t) => t.name === "Delirium Tablet");
check("Delirium Tablet's breakdown includes a Reward row (it has real rewards)",
  deliriumTabletRow === undefined || deliriumTabletRow.breakdown.some((r) => r.label === "Reward"));
check("keyFactors is an array of at most 4 short strings",
  Array.isArray(result.keyFactors) && result.keyFactors.length <= 4 && result.keyFactors.every((f) => typeof f === "string"));

// §11 (superseded 2026-07-06): breakdown rows are the raw loot-signal
// contributions (rarity/pack size/etc, pre-synergy) and no longer sum to
// `heat.score` — `heat.score` is now `effectiveScore` (synergy + stretch,
// normalized 0-100, clamped), while `breakdown` intentionally still
// reflects the pre-synergy model so users can see which raw stat drove the
// result. Just sanity-check the breakdown itself stays a plausible,
// non-negative composite.
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

// 2026-07-08: danger is display-only again — `heat.score` is
// `effectiveScore`, i.e. reward (synergy + stretch, normalized 0-100,
// clamped) with NO danger multiplier. Danger/annoyance mods surface via
// `warning`/`warnings`/`dangerLevel` only, purely to inform the player;
// they are strictly score-neutral (this reverts the short-lived 2026-07-06
// x0.7-0.95 danger penalty — see the "dangerous-but-juicy" regression
// below, updated to pin score-neutrality).

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
// The breakdown rows come from the legacy flat model while `heat.score`
// comes from the normalized model — the two are decoupled by design, so a
// single row can legitimately exceed the final score on real input.
// Asserting it would fail on correct output, not catch a real regression —
// a flaky check here is worse than no check.

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
// SAMPLE_REFLECT carries no rarity/pack/etc stats at all, so it scores 0 —
// this only pins that reflect still surfaces as a warning. The
// dangerous-but-juicy regression below is what pins score-neutrality on a
// map with real loot stats.
check("reflect produces a warning", reflect.warnings.includes("Reflect Damage"));
check("reflect warning present", reflect.warning?.toLowerCase().includes("reflect") ?? false);

// 2026-07-08 (danger is informational only): a map with great loot stats
// but severe danger must still clearly be worth running (verdict !== SKIP,
// several warnings survive), AND its score must be exactly what the same
// loot stats would score if safe — danger mods inform the player via the
// Insights column but never touch the score. This reverts the short-lived
// 2026-07-06 danger penalty (x0.7 on 'high').
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
// Same loot stats, with the two danger-mod lines removed — proves danger
// mods are score-neutral instead of pinning a magic-number score, so this
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
check("dangerous-but-juicy map scores EXACTLY like its safe equivalent (danger is score-neutral)",
  juicyButSafe.dangerLevel === "none" &&
  dangerousButJuicy.heat.score === juicyButSafe.heat.score);
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

// ============================================================
// SCORING-AUDIT REGRESSIONS (2026-07-06, second pass) — each pins one
// specific defect found and fixed by the scoring-system audit.
// ============================================================

// (1) Monster Rarity / Monster Effectiveness must contribute to the Juice
// Score. The god-map redesign originally shipped with both dropped: a
// +90%/+80% waystone scored 0/100 SKIP while its own mechanic panel showed
// Abyss/Ritual/Breach fits of ~70.
const SAMPLE_MONSTER_ONLY = `Item Class: Waystones
Rarity: Rare
Beast Nexus
Waystone (Tier 15)
--------
Waystone Tier: 15
Item Level: 82
--------
+90% increased Rarity of Monsters
+80% Monster Effectiveness
--------`;
const monsterOnly = analyzeWaystoneText(SAMPLE_MONSTER_ONLY);
check("monster-rarity/effectiveness-only map scores > 0 (both signals feed the score)",
  monsterOnly.heat.score > 0);

// (3) "Monsters take X% reduced Extra Damage from Critical Hits" is a
// DEFENSIVE monster mod — it must not read as monsters critting the player
// (the false positive showed an unearned "High Crit Monsters" warning).
check("detectDangerHits: 'take reduced Extra Damage from Critical Hits' does NOT match",
  !detectDangerHits("Monsters take 40% reduced Extra Damage from Critical Hits")
    .some((h) => h.id === "high-crit-monsters"));

// (4) Real PoE2 wordings for the existing recovery/regen categories.
check("detectDangerHits: 'less Recovery Rate' wording (moderate)",
  detectDangerHits("Players have 60% less Recovery Rate of Life and Energy Shield")
    .some((h) => h.id === "reduced-recovery" && h.severity === "moderate"));
check("detectDangerHits: 'cannot Regenerate' wording (strong)",
  detectDangerHits("Players cannot Regenerate Life, Mana or Energy Shield")
    .some((h) => h.id === "no-regeneration" && h.severity === "strong"));

// (5) Danger categories added by the audit, one real wording each.
check("detectDangerHits: extra elemental damage (strong)",
  detectDangerHits("Monsters deal 30% of Damage as Extra Fire")
    .some((h) => h.id === "extra-elemental-damage" && h.severity === "strong"));
check("detectDangerHits: lowered max player resistances (strong)",
  detectDangerHits("-12% maximum Player Resistances")
    .some((h) => h.id === "lowered-max-resistances" && h.severity === "strong"));
check("detectDangerHits: additional projectiles (moderate)",
  detectDangerHits("Monsters fire 2 additional Projectiles")
    .some((h) => h.id === "additional-projectiles" && h.severity === "moderate"));
check("detectDangerHits: players cursed (moderate)",
  detectDangerHits("Players are Cursed with Elemental Weakness")
    .some((h) => h.id === "player-curses" && h.severity === "moderate"));

// (6) White (no-mod) waystone: the waystone-level verdict must still be
// "no recommendation" (nothing clears skipIfBelow), but per-tablet ranking
// (2026-07-10 redesign) is deliberately independent of that verdict — each
// tablet keeps showing its own honest mechanic (from its `tags`, a fixed
// property of the tablet, not the blank waystone's stats). Since 2026-07-10
// (later, tablet-fit-tracks-the-waystone rework), every tablet's stat fit is
// ~equal on an all-zero-stat waystone (just the uniform mod-count bonus),
// so `rewardScore` breaks the tie — the two General-tagged tablets (no
// mechanic-specific currency) can legitimately fall out of the top 5 here,
// unlike the old tablet's-own-roll model. Not asserted.
const SAMPLE_WHITE = `Item Class: Waystones
Rarity: Normal
Waystone
Waystone (Tier 15)
--------
Waystone Tier: 15
Item Level: 82`;
const white = analyzeWaystoneText(SAMPLE_WHITE);
check("white waystone: no mechanic recommendation, but tablets still show their own honest match",
  white.recommendedMechanic === null &&
  white.tablets.length > 0 &&
  white.tablets.some((t) => t.reason.includes("matches Delirium")));

// (7) §10 skipIfBelow gate: a map whose Juice Score sits below every
// eligible mechanic's skipIfBelow must not recommend one, even when a
// mechanic fits well. Quantity is the cleanest fixture for this post-
// 2026-07-1x (dominant-stat rework): it's explicitly NOT one of the Juice
// Score's 5 scored signals (scoring.ts's file-level comment) but IS
// Expedition's priority stat, so a quantity-only waystone's Juice Score
// stays at the weak-tier floor (~10, well under Expedition's skipIfBelow
// of 35) while Expedition's own Match Score reads legendary. The tablet
// list is unaffected by this gate (2026-07-10) — same reasoning as check (6).
const SAMPLE_EXPEDITION_QUANTITY_ONLY = `Item Class: Waystones
Rarity: Rare
Buried Cache
Waystone (Tier 15)
--------
Waystone Tier: 15
Item Level: 82
--------
+90% increased Quantity of Items found in this Area
--------`;
const expeditionQuantityOnly = analyzeWaystoneText(SAMPLE_EXPEDITION_QUANTITY_ONLY);
check("skipIfBelow gates the waystone-level recommendation, not the tablet list",
  expeditionQuantityOnly.recommendedMechanic === null &&
  expeditionQuantityOnly.tablets.some((t) => t.reason.includes("matches Expedition")));

// (7b) Per-tablet independence, direct regression pin (2026-07-10): a
// waystone whose stats strongly favor Ritual GLOBALLY must not drag
// Delirium Tablet's own reason along with it — it's tagged "delirium"
// (tablets.ts), so its label must say so regardless of which mechanic
// wins the waystone overall or what Delirium Tablet's own boosts are.
const SAMPLE_RITUAL_LEANING = `Item Class: Waystones
Rarity: Rare
Ritual Grounds
Waystone (Tier 15)
--------
Waystone Tier: 15
Item Level: 82
--------
+70% increased Rarity of Monsters
+30% increased Pack Size
--------`;
const ritualLeaning = analyzeWaystoneText(SAMPLE_RITUAL_LEANING);
const tabletReason = (r, name) => r.tablets.find((t) => t.name === name)?.reason ?? "";
check("Delirium Tablet keeps matching Delirium even on a Ritual-winning waystone",
  tabletReason(ritualLeaning, "Delirium Tablet").includes("matches Delirium"));

// (7c) Direct proof of decoupling: two different tablets on the SAME
// waystone show two different mechanics in their reason — impossible under
// the old single-shared-mechanic design.
check("two tablets on the same waystone can show two different mechanics",
  tabletReason(ritualLeaning, "Delirium Tablet").includes("matches Delirium") &&
  tabletReason(ritualLeaning, "Ritual Tablet").includes("matches Ritual"));

// ============================================================
// MECHANIC MATCH SCORE IS PURELY STAT-FIT (2026-07-10): the old +15
// presence bonus (any mechanic whose keyword appeared in the text) is
// gone from computeMechanicScores — it was a single flat number applied
// uniformly to 16 of 17 mechanics, disconnected from the real Juice
// Score's own differentiated EXTRA_CONTENT_BONUS table, and large enough
// to cluster Delirium near 70 regardless of its actual stat fit (user
// report). mechanicScores must now depend ONLY on the six tracked stats —
// never on the item name, mod wording, or any mechanic keyword.
// ============================================================

const mkNamedSample = (name, extraMod = "") => `Item Class: Waystones
Rarity: Rare
${name}
Waystone (Tier 15)
--------
Waystone Tier: 15
Item Level: 82
--------
+30% increased Rarity of Monsters${extraMod ? `\n${extraMod}` : ""}
--------`;
const mechScoreOf = (r, name) => r.mechanicScores.find((m) => m.mechanic === name)?.score ?? 0;

// (8) Same mods throughout — name with vs without a mechanic keyword, and
// adding a mechanic-flavor mod LINE that carries no tracked stat (a real
// "Ritual Altars" mod doesn't move any of the six StatKeys) — none of it
// may change the Ritual score anymore. This is the mirror image of the old
// "still grants the bonus" check: now the absence of any effect IS correct.
const ritualNamed = analyzeWaystoneText(mkNamedSample("Ritual Reliquary"));
const plainNamed = analyzeWaystoneText(mkNamedSample("Forsaken Vault"));
const ritualModded = analyzeWaystoneText(mkNamedSample("Forsaken Vault", "Area contains 2 additional Ritual Altars"));
check("mechanic keyword in the NAME does not change the Ritual score",
  mechScoreOf(ritualNamed, "Ritual") === mechScoreOf(plainNamed, "Ritual"));
// 2026-07-10: a stat-less mod line now DOES move every mechanic's score a
// little — the sourced mod-count bonus (Fubgun: "8 Mod waystones seem to be
// the best for loot") is deliberately uniform across mechanics. The
// invariant this pins is narrower now: the WHOLE delta is exactly the
// mod-count bonus difference (2 mods vs 1), never a fake stat-fit change —
// Ritual Altars carries no tracked StatKey, so nothing else should move.
check("a stat-less 'Ritual Altars' mod line only moves the Ritual score via the sourced mod-count bonus",
  mechScoreOf(ritualModded, "Ritual") - mechScoreOf(plainNamed, "Ritual") === modCountBonus(2) - modCountBonus(1));

// (9) The flip side: a waystone with STRONG Ritual-fitting stats (priority
// monsterRarity, secondaries packSize/monsterEffectiveness) but zero
// mechanic wording anywhere must still score Ritual highly — proves the
// Match Score reads stats, not text. Values chosen to dominate the base
// "+30% increased Rarity of Monsters" line mkNamedSample always includes
// (mod-parser keeps the strongest match per stat, never sums — 70 wins
// over 30) : monsterRarity 70/100*.6 + packSize 60/100*.2 +
// monsterEffectiveness 50/100*.2 = 64.
const ritualStatsNoText = analyzeWaystoneText(mkNamedSample(
  "Forsaken Vault",
  "+70% increased Rarity of Monsters\n+60% increased Pack Size\n+50% Monster Effectiveness",
));
check("strong Ritual-shaped stats alone (no mechanic text anywhere) still score Ritual highly",
  mechScoreOf(ritualStatsNoText, "Ritual") >= 55);

// ============================================================
// MECHANIC-PATTERN CONSOLIDATION (KNOWN_ISSUES #4 follow-up, 2026-07-08):
// mechanics.ts's detect/scoring.ts's display patterns share one source
// (mechanic-patterns.ts) and one text surface (parsed.contentText — every
// block except the header). This pins the score-side correction that comes
// with it: the item NAME can no longer inflate the "extra content: X"
// display bonus (heat.score itself no longer reads contentText at all as
// of the 2026-07-1x dominant-stat rework — see below).
// ============================================================

const mkScoreSample = (name, extraLine = "") => `Item Class: Waystones
Rarity: Rare
${name}
Waystone (Tier 15)
--------
Waystone Tier: 15
Item Level: 82
--------
+100% increased Rarity of Items found in this Area
+50% increased Rarity of Monsters
+30% increased Pack Size
${extraLine}
--------`;

// (10) Score-side name fix: identical mods, only the name differs between
// a mechanic keyword and a plain name → identical heat.score (trivially
// true now that heat.score doesn't read contentText at all — kept as a
// regression pin) AND no "extra content: ritual" bonus line for the
// keyword-named one (still a real contentText-vs-name distinction, since
// bonusDetails/insights do read contentText).
const scoreRitualNamed = analyzeWaystoneText(mkScoreSample("Ritual Reliquary"));
const scorePlainNamed = analyzeWaystoneText(mkScoreSample("Forsaken Vault"));
check("waystone NAME containing a mechanic keyword does not change heat.score",
  scoreRitualNamed.heat.score === scorePlainNamed.heat.score);
check("waystone NAME containing a mechanic keyword grants no 'extra content' bonus",
  !scoreRitualNamed.insights.some((line) => /ritual/i.test(line)));

// (11)/(12) Removed 2026-07-1x: both pinned scoring.ts's mechanic-density
// term (an instilled/plural mechanic-keyword mod line raising heat.score),
// which the dominant-stat rework dropped entirely — heat.score now reads
// ONLY the 5 numeric stats, never contentText. See KNOWN_ISSUES.md.

// ============================================================
// REAL CLIPBOARD FORMAT (2026-07-09): a live paste from the game — the
// hand-written SAMPLE fixtures above never matched this shape (no
// "Waystone Tier:" line; a separate aggregate-stats block; each rolled
// mod prefixed with a `{ Prefix/Suffix Modifier "Name" (Tier: N) }` label
// line) — pins the parser.ts fix for both.
// ============================================================

const SAMPLE_REAL_CLIPBOARD = `Item Class: Waystones
Rarity: Rare
Dream Gambit
Waystone (Tier 15)
--------
Revives Available: 0 (augmented)
Item Rarity: +27% (augmented)
Pack Size: +16% (augmented)
Monster Rarity: +18% (augmented)
Monster Effectiveness: +28% (augmented)
Waystone Drop Chance: +105% (augmented)
--------
Item Level: 81
--------
{ Prefix Modifier "Frostbitten" (Tier: 1) }
Monsters deal 18(15-19)% of Damage as Extra Cold
{ Prefix Modifier "Fleeting" (Tier: 1) }
Monsters have 10(10-15)% increased Attack, Cast and Movement Speed
{ Prefix Modifier "Venomous" (Tier: 1) }
Monsters have 29(27-33)% chance to Poison on Hit
{ Suffix Modifier "of the Unwavering" (Tier: 1) }
Monsters have 74(70-79)% increased Ailment Threshold
Monsters have 67(60-69)% increased Stun Threshold
{ Suffix Modifier "of Buffering" (Tier: 1) }
Monsters gain 12(12-25)% of maximum Life as Extra maximum Energy Shield
{ Suffix Modifier "Flaming" (Tier: 1) }
Area has patches of Ignited Ground
{ Suffix Modifier "of Enduring" (Tier: 1) }
Monsters are Armoured
--------
Can be used in a Map Device, allowing you to enter a Map. Waystones can only be used once.
--------
Corrupted`;
const realClipboard = analyzeWaystoneText(SAMPLE_REAL_CLIPBOARD);

check("real clipboard: tier parses from the header (15), not 0",
  realClipboard.waystone.tier === 15);
check("real clipboard: no '{ ... Modifier ... }' label line leaks into modifiers",
  !realClipboard.modifiers.some((m) => /^\{.*Modifier\b.*\}$/i.test(m.text)));
// 8 real stat lines: Cold dmg, Speed, Poison, Ailment Threshold, Stun
// Threshold, ES gain, Ignited Ground, Armoured — the 8 label lines above
// them must be gone, not just uncounted.
check("real clipboard: modCount reflects only real stat lines (8), not label lines too",
  realClipboard.waystone.modCount === 8);
check("real clipboard: the 5 core stats parse from the aggregate summary block",
  realClipboard.heat.breakdown.find((b) => b.key === "itemRarity")?.value === 27 &&
  realClipboard.heat.breakdown.find((b) => b.key === "monsterRarity")?.value === 18 &&
  realClipboard.heat.breakdown.find((b) => b.key === "packSize")?.value === 16 &&
  realClipboard.heat.breakdown.find((b) => b.key === "monsterEffectiveness")?.value === 28 &&
  realClipboard.heat.breakdown.find((b) => b.key === "waystoneDropChance")?.value === 105);

// ---------------------------------------------------------------------------
// Breach/Abyss recalibration (Fubgun 0.5 atlas strats, user-pasted tab text,
// 2026-07-10 — see mechanics.ts's entry comments for the quotes). These pin
// the direction of the change, not exact numbers.
const mkStatWaystone = (modLines) => `Item Class: Waystones
Rarity: Rare
Stat Probe
Waystone (Tier 15)
--------
Waystone Tier: 15
Item Level: 82
--------
${modLines.join("\n")}
--------`;
const fitScoreOf = (r, name) => r.mechanicScores.find((m) => m.mechanic === name)?.score ?? 0;

// Breach now keys on monster effectiveness (secondary itemRarity is
// declared on the mechanic but no longer feeds scoring, see the tier-based
// rework below).
const effectRarity = analyzeWaystoneText(
  mkStatWaystone(["+40% Monster Effectiveness", "+60% increased Rarity of Items found in this Area"]),
);
check("Breach: a 40% Monster Effectiveness waystone gives Breach a strong (top-tier) fit (Fubgun 0.5)",
  fitScoreOf(effectRarity, "Breach") >= 30);
// ...and no longer on monster rarity ("mostly wasted — rare count is static").
// 2026-07-10 (revised same day): "no longer feeds it" now means "stuck at
// the weak-tier baseline plus the sourced, uniform mod-count bonus" — not a
// literal zero. Every mechanic always has SOME baseline now (TIER_SCORE.weak,
// the 0-15% band), since a raw-%-of-priority-stat tier read never returns
// zero the way the old continuous formula could.
const monsterRarityOnly = analyzeWaystoneText(mkStatWaystone(["+80% increased Rarity of Monsters"]));
check("Breach: monster-rarity-only waystone stays at the weak-tier baseline for Breach (0% Monster Effectiveness)",
  fitScoreOf(monsterRarityOnly, "Breach") === Math.round(TIER_SCORE.weak + modCountBonus(1)));

// Abyss reverted 2026-07-10 (same day, later — see mechanics.ts's Abyss
// entry comment): the packSize-priority change above was contradicted by
// two independent sources (Mobalytics "Abyss Juicing Tablet Tier List",
// Switchblade Gaming) found while debugging a real waystone where a huge
// Monster Rarity roll produced a weak Abyss Tablet fit. Abyss now keys on
// monster rarity ALONE (itemRarity/quantity are declared secondaries but,
// same as Breach above, no longer feed scoring — see the tier rework below).
const abyssShaped = analyzeWaystoneText(mkStatWaystone(["+60% increased Rarity of Monsters"]));
check("Abyss: a 60% Monster Rarity waystone gives Abyss a strong (legendary-tier) fit (reverted, sourced)",
  fitScoreOf(abyssShaped, "Abyss") >= 35);
// ...and pack size (the short-lived priority stat) no longer feeds it at
// all — same weak-tier-baseline caveat as the Breach check above.
const packSizeOnly = analyzeWaystoneText(mkStatWaystone(["+50% increased Pack Size"]));
check("Abyss: pack-size-only waystone stays at the weak-tier baseline for Abyss (0% Monster Rarity)",
  fitScoreOf(packSizeOnly, "Abyss") === Math.round(TIER_SCORE.weak + modCountBonus(1)));
// quantity was Abyss's secondary pre-rework; it's declared but inert now —
// a quantity-only waystone must land at the SAME weak-tier baseline as any
// other stat Abyss doesn't track, not a boosted number (2026-07-10, user's
// explicit call: "seul le stat prioritaire compte").
const quantityOnly = analyzeWaystoneText(mkStatWaystone(["30% increased Quantity of Items found"]));
check("Abyss: quantity-only waystone does NOT feed Abyss beyond the weak-tier baseline (secondary stats are inert now)",
  fitScoreOf(quantityOnly, "Abyss") === Math.round(TIER_SCORE.weak + modCountBonus(1)));

// ---------------------------------------------------------------------------
// Tier-based scoring (2026-07-10, revised again the same day — user's own
// gameplay judgment, not a web guide: "0-15%=nul, 15-25%=ok, 25-50%=top,
// 50%+=legendaire"). Replaces the previous 0.6/0.2/0.2 weighted-sum formula
// entirely — only a mechanic's PRIORITY stat's raw % decides its tier now.
{
  const at = (pct, statLine) => analyzeWaystoneText(mkStatWaystone([`+${pct}% ${statLine}`]));
  const RARITY = "increased Rarity of Monsters"; // Ritual/Abyss's priority stat
  const ritualDef = MECHANICS.find((m) => m.name === "Ritual");
  check("priorityStatTier: 0% -> weak", priorityStatTier({}, ritualDef) === "weak");
  check("tier boundary: 14% is weak, 15% is ok (< is exclusive at the tier's own top)",
    fitScoreOf(at(14, RARITY), "Ritual") === Math.round(TIER_SCORE.weak + modCountBonus(1)) &&
    fitScoreOf(at(15, RARITY), "Ritual") === Math.round(TIER_SCORE.ok + modCountBonus(1)));
  check("tier boundary: 24% is ok, 25% is top",
    fitScoreOf(at(24, RARITY), "Ritual") === Math.round(TIER_SCORE.ok + modCountBonus(1)) &&
    fitScoreOf(at(25, RARITY), "Ritual") === Math.round(TIER_SCORE.top + modCountBonus(1)));
  check("tier boundary: 49% is top, 50% is legendary",
    fitScoreOf(at(49, RARITY), "Ritual") === Math.round(TIER_SCORE.top + modCountBonus(1)) &&
    fitScoreOf(at(50, RARITY), "Ritual") === Math.round(TIER_SCORE.legendary + modCountBonus(1)));

  // Tablet verdict reads the tier directly (adapter.ts's tabletVerdict),
  // not the numeric fit — pin all 4 tiers against a real tablet (Ritual
  // Tablet, tag "ritual" -> mechanic Ritual, priorityStat monsterRarity).
  const verdictOf = (r, name) => r.tablets.find((t) => t.name === name)?.verdict;
  check("tablet verdict: weak tier -> dont-run", verdictOf(at(0, RARITY), "Ritual Tablet") === "dont-run");
  check("tablet verdict: ok tier -> why-not", verdictOf(at(20, RARITY), "Ritual Tablet") === "why-not");
  check("tablet verdict: top tier -> run", verdictOf(at(30, RARITY), "Ritual Tablet") === "run");
  check("tablet verdict: legendary tier -> run", verdictOf(at(60, RARITY), "Ritual Tablet") === "run");
}

// ---------------------------------------------------------------------------
// Composite Juice Score: dominant-stat model (2026-07-1x, user's own call —
// "basé sur sa plus grosse stat, et des petits bonus si y'a d'autres stats
// intéressantes"). Replaces the 2026-07-06 weighted-sum + multiplicative-
// synergy model entirely. References below (100 for 4 of the 5 stats, 120
// for Waystone Drop Chance) mirror scoring.ts's STAT_REFERENCES.
{
  check("a single stat alone scores exactly its own tier (Drop Chance 80% -> normalized 66.7% -> legendary -> 80, no bonus)",
    analyzeWaystoneText(mkStatWaystone(["+80% chance to find an additional Waystone"])).heat.score === TIER_SCORE.legendary);

  check("a lone weak stat floors at TIER_SCORE.weak with zero bonus (nothing else can be 'ok' if the max stat isn't)",
    analyzeWaystoneText(mkStatWaystone(["+3% increased Pack Size"])).heat.score === TIER_SCORE.weak);

  // Regression pin (2026-07-11 bug report: "le rating est tout le temps en
  // légendaire") — Pack Size's reference used to be 30, so an ordinary 15%
  // roll normalized to 50% of "ceiling" and hit legendary on its own. Now
  // shares the same 100 reference as itemRarity/monsterRarity/
  // monsterEffectiveness: 15% Pack Size alone must land at "ok" (25), and
  // it takes a real 50%+ roll to reach legendary, same bar as every other
  // stat here.
  check("an ordinary 15% Pack Size roll alone is 'ok', NOT legendary (2026-07-11 fix)",
    analyzeWaystoneText(mkStatWaystone(["+15% increased Pack Size"])).heat.score === TIER_SCORE.ok);
  check("a 50%+ Pack Size roll alone IS legendary — the bar didn't move, only the reference did",
    analyzeWaystoneText(mkStatWaystone(["+50% increased Pack Size"])).heat.score === TIER_SCORE.legendary);

  // Waystone Drop Chance (ceiling 120%) at 55% normalizes to ~45.8% (top)
  // and must lose to Item Rarity (ceiling 100%) at the SAME raw 55%, which
  // normalizes to 55% (legendary) — proves stats are still compared
  // against their OWN ceiling, not raw %, using the one pair of stats that
  // still has genuinely different references post-fix.
  const dropVsRarity = analyzeWaystoneText(
    mkStatWaystone(["+55% chance to find an additional Waystone", "+55% increased Rarity of Items found in this Area"]),
  );
  const dropNormalized = (55 / 120) * 100;
  const dropVsRarityExpected = Math.round((TIER_SCORE.legendary + Math.min(dropNormalized / 100, 1) * 5) * 100) / 100;
  check("Item Rarity 55% (ceiling 100) outranks the SAME raw 55% on Drop Chance (ceiling 120) as the dominant stat",
    dropVsRarity.heat.score === dropVsRarityExpected);

  // Same dominant stat (Drop Chance, maxed) with two different secondary
  // Monster Rarity values -> the bonus must scale with the secondary's own
  // magnitude, not just its presence (2026-07-10's Q3 answer: "bonus
  // proportionnel à la valeur de chaque stat").
  const smallSecondary = analyzeWaystoneText(
    mkStatWaystone(["+120% chance to find an additional Waystone", "+20% increased Rarity of Monsters"]),
  );
  const bigSecondary = analyzeWaystoneText(
    mkStatWaystone(["+120% chance to find an additional Waystone", "+90% increased Rarity of Monsters"]),
  );
  check("the secondary-stat bonus is proportional to that stat's own value, not flat",
    bigSecondary.heat.score > smallSecondary.heat.score &&
    smallSecondary.heat.score === TIER_SCORE.legendary + Math.min(20 / 100, 1) * 5 &&
    bigSecondary.heat.score === TIER_SCORE.legendary + Math.min(90 / 100, 1) * 5);

  // A secondary stat below "ok" (< 15%) contributes nothing — matches the
  // tablet-fit tiering, "nul" doesn't count as "intéressant".
  const weakSecondary = analyzeWaystoneText(
    mkStatWaystone(["+120% chance to find an additional Waystone", "+10% increased Rarity of Monsters"]),
  );
  check("a secondary stat under the 'ok' threshold contributes zero bonus",
    weakSecondary.heat.score === TIER_SCORE.legendary);
}

// ---------------------------------------------------------------------------
// Tablet fit = waystone fit (2026-07-10 rework, user report + AskUserQuestion
// decision "recentrer sur la waystone actuelle"): a tablet's `fit` is no
// longer its own small boost roll scored against TABLET_ROLL_CAP (removed) —
// it's now `mechanicScores[tablet's own mechanic].score` (same formula/caps
// as the Mechanic Match Score, via `scoreMechanicFitRaw(stats, mech, ...)`)
// plus the tablet's `rewardScore`, clamped 0-100. Direct proof: a tablet's
// fit must track the WAYSTONE's stats now, not a fixed per-tablet number —
// the same tablet gets a different fit on two different waystones shaped
// for its own mechanic vs. not.
{
  const deliriumShaped = analyzeWaystoneText(
    mkStatWaystone(["+70% increased Pack Size", "+30% increased Rarity of Items found in this Area"]),
  );
  const deliriumStarved = analyzeWaystoneText(mkStatWaystone(["+5% increased Pack Size"]));
  const fitOf = (r, name) => r.tablets.find((t) => t.name === name)?.fit ?? -1;
  check("tablet fit tracks the waystone's own stats, not a fixed per-tablet roll",
    fitOf(deliriumShaped, "Delirium Tablet") > fitOf(deliriumStarved, "Delirium Tablet"));

  // The Abyss bug this rework fixes, pinned directly: a real waystone with
  // a huge Monster Rarity roll but almost no Pack Size must now give the
  // Abyss Tablet a fit that reflects Monster Rarity (Abyss's reverted
  // priority stat), not a near-zero score starved by a stat it never rolls.
  const highMonsterRarityLowPack = analyzeWaystoneText(
    mkStatWaystone(["+62% increased Rarity of Monsters", "+9% increased Pack Size"]),
  );
  check("Abyss Tablet fit reflects high Monster Rarity even with low Pack Size (the reported bug)",
    fitOf(highMonsterRarityLowPack, "Abyss Tablet") >= 40);
}

// ---------------------------------------------------------------------------
// Mod-count bonus (2026-07-10, adapter.ts's modCountBonus/computeMechanicScores):
// sourced from Fubgun's "8 Mod waystones seem to be the best for loot" (8 =
// full bonus) and "...waystones with 6 modifiers..." (6 = a real, sourced,
// non-zero midpoint) — a linear ramp is the honest fit for two data points.
{
  check("modCountBonus: 0 mods → 0", modCountBonus(0) === 0);
  check("modCountBonus: 8 mods (Fubgun's target) → the full weight", modCountBonus(8) === 8);
  check("modCountBonus: 6 mods (Fubgun's 'cheapest viable' point) → 3/4 of the full weight",
    modCountBonus(6) === 6);
  check("modCountBonus: never exceeds its weight past 8 mods (corrupted implicits, etc.)",
    modCountBonus(12) === 8);
  check("modCountBonus: applies uniformly across every mechanic for the same waystone",
    (() => {
      const eight = analyzeWaystoneText(mkStatWaystone(Array(8).fill("+5% increased Rarity of Items found in this Area")));
      const four = analyzeWaystoneText(mkStatWaystone(Array(4).fill("+5% increased Rarity of Items found in this Area")));
      // Every mechanic's raw score should differ by exactly the bonus delta,
      // since these fixtures keep the tracked stat (itemRarity) identical
      // and only the mod COUNT differs (5 dummy stat lines wouldn't parse
      // distinctly anyway — mod-parser keeps the strongest match per stat).
      return eight.mechanicScores.every((m) => {
        const fourScore = four.mechanicScores.find((x) => x.mechanic === m.mechanic).score;
        return m.score - fourScore === Math.round(modCountBonus(8)) - Math.round(modCountBonus(4));
      });
    })());
}

// ---------------------------------------------------------------------------
// meta-schema.ts (pure parse/merge/diff module behind the in-app meta.json
// editor) — bundled separately (.meta-bundle.mjs). NOTE: that bundle carries
// its OWN copy of MECHANICS/DEFAULT_TABLETS; the end-to-end check at the very
// bottom therefore goes through the adapter bundle's setActiveMechanics.
import {
  parseMetaFile,
  mergeMetaConfig,
  buildMetaFile,
  serializeMetaFile,
  buildEditorModel,
  MECHANICS as SCHEMA_MECHANICS,
  DEFAULT_TABLETS as SCHEMA_TABLETS,
} from "./.meta-bundle.mjs";

const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const defOf = (name) => SCHEMA_MECHANICS.find((m) => m.name === name);

// 1. Unknown stat name (the silent-typo hazard) falls back to the default.
{
  const { mechanics } = mergeMetaConfig({ metas: { delirium: { priority_stat: "Pak Size" } } });
  const deli = mechanics.find((m) => m.name === "Delirium");
  check("meta: unknown stat name in priority_stat falls back to the default",
    deli.priorityStat === defOf("Delirium").priorityStat);
}

// 2. Merge is idempotent, and merging an empty file yields the pure defaults.
{
  const p = parseMetaFile('{"metas":{"blight":{"skip_if_below":50}}}');
  check("meta: merge is deterministic/idempotent",
    deepEq(mergeMetaConfig(p).mechanics, mergeMetaConfig(p).mechanics));
  const empty = mergeMetaConfig({});
  check("meta: merging {} yields the bundled defaults untouched",
    deepEq(empty.mechanics, SCHEMA_MECHANICS) && deepEq(empty.tablets, SCHEMA_TABLETS));
}

// 3. Diff-only write: an edit equal to the hardcoded default produces no entry.
{
  const breach = defOf("Breach");
  const out = buildMetaFile(null, new Map([["breach", {
    priorityStat: breach.priorityStat,
    secondaryStats: [...breach.secondaryStats],
    skipIfBelow: breach.skipIfBelow,
  }]]), new Map());
  check("meta: edit identical to defaults writes no metas entry", out.metas === undefined);
}

// 4. Round-trip: build -> serialize -> parse -> merge gives back the edit,
// and every untouched mechanic stays at its default.
{
  const edit = { priorityStat: "itemRarity", secondaryStats: ["quantity"], skipIfBelow: 55 };
  const text = serializeMetaFile(buildMetaFile(null, new Map([["delirium", edit]]), new Map()));
  const { mechanics } = mergeMetaConfig(parseMetaFile(text));
  const deli = mechanics.find((m) => m.name === "Delirium");
  check("meta: build->serialize->parse->merge round-trips the edited values",
    deli.priorityStat === "itemRarity" && deepEq(deli.secondaryStats, ["quantity"]) && deli.skipIfBelow === 55);
  check("meta: round-trip leaves every other mechanic at its default",
    mechanics.filter((m) => m.name !== "Delirium").every((m, i) => {
      const d = SCHEMA_MECHANICS.filter((x) => x.name !== "Delirium")[i];
      return m.priorityStat === d.priorityStat && deepEq(m.secondaryStats, d.secondaryStats) && m.skipIfBelow === d.skipIfBelow;
    }));
}

// 5. Hand-written content survives an unrelated edit: a custom tablet, an
// unknown top-level key, and a recommended_tablets that genuinely diverges.
{
  const existing = {
    notes: "mon pense-bête",
    metas: { breach: { recommended_tablets: ["Ritual Tablet"] } },
    tablets: [{ name: "Ma Tablette", mods: ["10% increased Pack Size"], rewards: [{ type: "generic", score: 5 }] }],
  };
  const out = buildMetaFile(existing, new Map([["delirium", { priorityStat: "packSize", secondaryStats: [], skipIfBelow: 60 }]]), new Map());
  check("meta: unknown top-level key survives an unrelated edit", out.notes === "mon pense-bête");
  check("meta: genuinely divergent recommended_tablets survives",
    deepEq(out.metas.breach.recommended_tablets, ["Ritual Tablet"]));
  check("meta: hand-added custom tablet survives byte-for-byte",
    deepEq(out.tablets, existing.tablets));
}

// 6. Anti-drift: entries that just duplicate the defaults (the old bundled
// seed did exactly this — the 2026-07-08 stale-file bug) are purged on save.
{
  const seedLike = { metas: {} };
  // Exact serialization labels, so the seed entries are true copies of the defaults.
  const label = (k) => ({ itemRarity: "Item Rarity", monsterRarity: "Monster Rarity", packSize: "Pack Size", monsterEffectiveness: "Monster Effectiveness", waystoneDropChance: "Waystone Drop Chance", quantity: "Quantity" })[k];
  for (const name of ["Breach", "Delirium", "Expedition", "General"]) {
    const d = defOf(name);
    seedLike.metas[name.toLowerCase()] = {
      priority_stat: label(d.priorityStat),
      secondary_stats: d.secondaryStats.map(label),
      recommended_tablets: [...(d.recommendedTablets ?? [])],
      skip_if_below: d.skipIfBelow,
    };
  }
  const out = buildMetaFile(seedLike, new Map([["ritual", { priorityStat: "monsterRarity", secondaryStats: ["packSize", "monsterEffectiveness"], skipIfBelow: 45 }]]), new Map());
  check("meta: default-duplicating seed entries are purged on save (anti-drift)",
    out.metas.breach === undefined && out.metas.delirium === undefined &&
    out.metas.expedition === undefined && out.metas.general === undefined);
  check("meta: the real edit is the only entry left after the purge",
    deepEq(Object.keys(out.metas), ["ritual"]) && out.metas.ritual.skip_if_below === 45);
}

// 7. Tablet toggle round-trip: disable writes a minimal entry, the merge
// honors it, re-enable removes the entry entirely.
{
  const disabled = buildMetaFile(null, new Map(), new Map([["breach tablet", false]]));
  check("meta: disabling a default tablet writes only {name, enabled:false}",
    deepEq(disabled.tablets, [{ name: "Breach Tablet", enabled: false }]));
  const merged = mergeMetaConfig(disabled).tablets.find((t) => t.name === "Breach Tablet");
  check("meta: the merge carries the disabled flag", merged.enabled === false);
  const reenabled = buildMetaFile(disabled, new Map(), new Map([["breach tablet", true]]));
  check("meta: re-enabling removes the entry (file returns to minimal)",
    reenabled.tablets === undefined);
}

// 8. Editor model: overridden flag tracks real divergence only.
{
  const model = buildEditorModel(parseMetaFile('{"metas":{"delirium":{"skip_if_below":60}}}'), false);
  check("meta: editor model flags only the genuinely overridden mechanic",
    model.mechanics.find((m) => m.name === "Delirium").isOverridden === true &&
    model.mechanics.filter((m) => m.name !== "Delirium").every((m) => !m.isOverridden));
  check("meta: editor model exposes the 6 stat options", model.statOptions.length === 6);
}

// 9. End-to-end through the adapter bundle: raising the CURRENT recommended
// mechanic's skip gate via a merged table changes the live recommendation,
// and restoring the bundled defaults brings it back. Deliberately not pinned
// to a mechanic name — recalibrations legitimately move which mechanic wins
// SAMPLE; this tests the gating MECHANISM. LAST check block — it mutates the
// adapter's active table (and restores it).
{
  const before = analyzeWaystoneText(SAMPLE).recommendedMechanic;
  const { mechanics } = mergeMetaConfig({ metas: { [before.toLowerCase()]: { skip_if_below: 99 } } });
  setActiveMechanics(mechanics);
  const gated = analyzeWaystoneText(SAMPLE).recommendedMechanic;
  setActiveMechanics(MECHANICS);
  const after = analyzeWaystoneText(SAMPLE).recommendedMechanic;
  check("meta e2e: skip_if_below=99 via merged table drops the current recommendation",
    typeof before === "string" && gated !== before);
  check("meta e2e: restoring the bundled defaults restores the recommendation",
    after === before);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
