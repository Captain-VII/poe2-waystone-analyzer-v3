// Contract check for the analyzer adapter (M5): run against the real
// sample_waystone.txt from v2, assert AnalysisResult boundary rules hold
// (docs/overlay-ui-spec.md §11). Run via: npm run verify-adapter
// (that script bundles src/analyzer/adapter.ts with esbuild first, since
// Node's ESM resolver needs explicit extensions the TS source doesn't use).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { analyzeWaystoneText } from "./.adapter-bundle.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const V2_SAMPLE = join(__dirname, "..", "..", "poe2-waystone-analyzer-v2", "sample_waystone.txt");

const sample = readFileSync(V2_SAMPLE, "utf-8");

let failures = 0;
function check(label, cond) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`ok:   ${label}`);
  }
}

const result = analyzeWaystoneText(sample);
check("parses sample as a valid waystone (non-null)", result !== null);
if (!result) process.exit(1);

console.log(JSON.stringify(result, null, 2));

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

// §11: "breakdown values are display-final ... sum to score"
const breakdownSum = result.heat.breakdown.reduce((s, b) => s + b.value, 0);
const diff = Math.abs(breakdownSum - result.heat.score);
check(`breakdown sums to score (${breakdownSum.toFixed(2)} vs ${result.heat.score}, diff ${diff.toFixed(4)})`, diff < 0.05);

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

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
