import { MOCK_RESULTS, TIER_ORDER } from "./mock";
import { mountOverlay, type AnalyzeFailure } from "./components/RelicPanel";
import { placeTopRight, computeEffectiveMode, watchDisplayChanges } from "./placement";
import { loadMode, saveMode, loadReduceEffects, loadCompactCompressed, type Mode } from "./settings";
import { registerHotkeys, getHotkeyBase, setHotkeyBase } from "./hotkeys";
import { reportInteractiveRegions } from "./interactive-rect";
import { runDiagnostics, applyDebugOpaqueOverride, sendReport, showWhenPainted, logAnalyzeAttempt } from "./diagnostics";
import { readClipboardText } from "./clipboard";
import { analyzeWaystoneText } from "./analyzer/adapter";
import { loadMetaConfig } from "./analyzer/meta-config";
import { notifyLegendaryWaystone } from "./notify";
import type { AnalysisResult, TierClass } from "./types";

let tier: TierClass = "god";
let mode: Mode = loadMode(); // read before first render — no layout flash (§9); intended mode
let analyzing = false;
let lastNotifiedName: string | null = null; // avoid re-notifying on repeat/no-op analyzes

// §12 Compare mode: rolling window of the last distinct real analyses
// (newest first), capped at 3 — "2 ou 3 waystones cotes a cotes".
const compareList: AnalysisResult[] = [];
let compareOpen = false;

const overlay = mountOverlay(document.getElementById("app")!, MOCK_RESULTS[tier], {
  mode,
  isReduced: () =>
    loadReduceEffects() || matchMedia("(prefers-reduced-motion: reduce)").matches,
  compactCompressed: loadCompactCompressed,
  onAnalyze: analyze,
  onToggleMode: toggleMode,
  onHide: hideOverlay,
  onInteractiveChange: () => void reportRegions(),
  // Rust validates, swaps the three registrations (with rollback on
  // conflict), and persists — see lib.rs's set_hotkey_base. Only offered
  // inside the real overlay; plain-browser dev keeps a display-only row.
  onSetHotkey: "__TAURI_INTERNALS__" in window ? setHotkeyBase : undefined,
  // Dev-only: clicking the tier badge cycles the mock fixtures, for UI
  // testing without a real clipboard waystone. Disabled in production
  // builds (import.meta.env.DEV is false) — it would otherwise silently
  // overwrite a real analyzed result with mock data.
  onCycleTier: import.meta.env.DEV
    ? () => {
        tier = TIER_ORDER[(TIER_ORDER.indexOf(tier) + 1) % TIER_ORDER.length];
        overlay.setResult(MOCK_RESULTS[tier]);
      }
    : undefined,
});

async function reportRegions(): Promise<void> {
  await reportInteractiveRegions(overlay.interactiveEls());
}

/** §2: re-evaluates the fallback cascade (Full→Compact→Mini) against current
 *  monitor space and renders it — `mode` (intended) is untouched here, so a
 *  forced fallback is automatically undone the next time space allows it. */
async function applyEffectiveMode(): Promise<void> {
  const effective = await computeEffectiveMode(mode);
  overlay.setMode(effective);
  await reportRegions();
}

/** §5 M5: Ins reads the real clipboard and, if it holds a valid Waystone
 *  (per parseWaystone's "Item Class: Waystones" gate), replaces the
 *  displayed result with the real AnalysisResult — the UI never computes
 *  tierClass/verdict itself (§11), the adapter already has. On failure
 *  (copy/read failed, empty clipboard, or non-Waystone text) the display
 *  keeps whatever's currently shown and a status chip names the failure —
 *  the success pulse never plays, so a failed press is unambiguous. */
async function analyze(simulateCopy = true): Promise<void> {
  if (analyzing) return; // key-repeat guard (§8)
  analyzing = true;
  // Re-reveal on a real Ins press (never on the startup-only analyze(false)
  // call, which happens before the window's first-ever show and doesn't
  // need it) — this is how Escape/click-away's hide gets undone.
  if (simulateCopy) void revealOverlay();
  const clip = await readClipboardText(simulateCopy);
  let applied: { score: number; tierClass: string; name: string } | null = null;
  let failure: AnalyzeFailure | null = null;
  if (!clip) {
    failure = "clipboard";
  } else {
    const result = analyzeWaystoneText(clip);
    if (!result) {
      failure = "not-waystone";
    } else {
      overlay.setResult(result);
      applied = { score: result.heat.score, tierClass: result.heat.tierClass, name: result.waystone.name };
      if (result.heat.tierClass === "god" && result.waystone.name !== lastNotifiedName) {
        lastNotifiedName = result.waystone.name;
        void notifyLegendaryWaystone(result.waystone.name, result.heat.score);
      }
      compareList.unshift(result);
      compareList.length = Math.min(compareList.length, 3);
      if (compareOpen) overlay.showCompare(compareList);
    }
  }
  // Support/debugging checkpoint: confirms whether Ins actually applied a
  // real clipboard analysis vs. left the display unchanged (invalid/no
  // Waystone on clipboard) — see docs/release-checklist.md §3.
  await logAnalyzeAttempt({ hadClipboardText: !!clip, applied, failure, clipPreview: clip?.slice(0, 60) ?? null });
  if (failure) {
    // Only on a real press — the startup-only analyze(false) keeps its
    // silent mock-data fallback (plain-browser dev has no clipboard).
    if (simulateCopy) overlay.showAnalyzeError(failure);
  } else {
    overlay.analyze();
  }
  setTimeout(() => (analyzing = false), 450);
}

/** §12: toggles the Compare body on/off. Needs at least 2 analyzed
 *  waystones to be worth showing — otherwise a no-op (nothing to compare
 *  yet), rather than a confusing single-card view. */
function toggleCompare(): void {
  if (compareOpen) {
    compareOpen = false;
    overlay.closeCompare();
    return;
  }
  if (compareList.length < 2) return;
  compareOpen = true;
  overlay.showCompare(compareList);
  void reportRegions();
}

/** Settings panel's "Hide" button — sends the overlay to the system tray.
 *  Quitting for good is tray-icon-only (right-click → Quitter, see
 *  src-tauri/src/lib.rs). No-op in plain-browser dev (no Tauri window to
 *  hide). */
function hideOverlay(): void {
  if (!("__TAURI_INTERNALS__" in window)) return;
  import("@tauri-apps/api/core").then(({ invoke }) => invoke("hide_window"));
}

/** Undoes hideOverlay() — called on every real Ins press, idempotent if the
 *  overlay was already visible. No-op in plain-browser dev. */
async function revealOverlay(): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("reveal_window").catch(() => {});
}

function toggleMode(): void {
  mode = mode === "compact" ? "full" : "compact";
  saveMode(mode); // user-initiated — updates intendedMode too (§9)
  applyEffectiveMode();
  // re-report regions once the 220ms morph settles
  setTimeout(reportRegions, 260);
}

let handlingDisplayChange = false;

/** §2/M1: display/DPI/resolution/monitor-space changed — re-anchor top-right,
 *  re-evaluate the Full→Compact→Mini fallback against the new space (this is
 *  also exactly how the intended mode gets restored once space returns: it's
 *  re-derived from `mode`, never overwritten by a prior forced fallback), and
 *  re-report the (possibly moved/resized) interactive regions. */
async function handleDisplayChange(): Promise<void> {
  if (handlingDisplayChange) return; // coalesce bursts of change events
  handlingDisplayChange = true;
  try {
    await placeTopRight();
    await applyEffectiveMode(); // also re-reports regions
    setTimeout(reportRegions, 260); // once more after any mode-morph settles
  } finally {
    handlingDisplayChange = false;
  }
}

async function init(): Promise<void> {
  await loadMetaConfig(); // §3: meta.json weights/tablets/thresholds before any analysis
  await sendReport("pre-placement");

  const { debugOpaque } = await runDiagnostics();
  if (debugOpaque) {
    applyDebugOpaqueOverride();
    await placeTopRight(); // same window size/position as the shipped overlay
    await sendReport("debug-opaque-applied");
    await showWhenPainted(); // window starts hidden; reveal once compositor has a real frame
    return; // isolate step 1 — paint only, nothing else (no click-through, no hotkeys)
  }

  await placeTopRight(); // position while still hidden — no visible jump on reveal
  await applyEffectiveMode(); // §2 fallback cascade — may render compact/mini instead of intended
  await sendReport("post-placement");
  await showWhenPainted();
  await registerHotkeys(analyze, toggleMode, toggleCompare, hideOverlay);
  // The overlay mounts (synchronously, above) before the persisted base
  // can be fetched — labels default to Ins, corrected here if remapped.
  overlay.setHotkeyLabel(await getHotkeyBase());
  await watchDisplayChanges(() => void handleDisplayChange());
  await sendReport("display-watch-attached");
  // Startup paint only — must NOT simulate Ctrl+C: whatever window has OS
  // focus at this moment (often a dev terminal, not the game) would receive
  // the keystroke instead of the overlay, which for a console means SIGINT.
  analyze(false);
}

init();
