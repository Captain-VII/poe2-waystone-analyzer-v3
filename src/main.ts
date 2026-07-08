import { MOCK_RESULTS, TIER_ORDER } from "./mock";
import { mountOverlay, type AnalyzeFailure } from "./components/RelicPanel";
import {
  placeTopRight,
  computeEffectiveMode,
  watchDisplayChanges,
  prepareWindowDrag,
  startWindowDrag,
  restoreCustomPosition,
  watchWindowMoves,
} from "./placement";
import {
  loadMode,
  saveMode,
  loadReduceEffects,
  loadCompactCompressed,
  loadCompareList,
  saveCompareList,
  loadCustomPosition,
  clearCustomPosition,
  type Mode,
  type CompareEntry,
} from "./settings";
import { registerHotkeys, getHotkeyBase, setHotkeyBase } from "./hotkeys";
import { getAutostartEnabled, setAutostartEnabled } from "./autostart";
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
// KNOWN_ISSUES #8: entries carry a pin flag (pinned survive the roll,
// max 2 so the third slot always shows the latest analysis), duplicates
// (same waystone name) update in place, and the list persists across
// restarts via localStorage.
const compareList: CompareEntry[] = loadCompareList();
let compareOpen = false;
const MAX_COMPARE = 3;
const MAX_PINS = 2;

/** Newest-first insert with in-place dedupe (re-analyzing a waystone
 *  refreshes its entry — pin and position kept — instead of duplicating
 *  it) and pin-aware eviction: past the cap, the oldest UNPINNED entry
 *  goes. MAX_PINS < MAX_COMPARE guarantees an unpinned candidate exists. */
function pushCompareEntry(result: AnalysisResult): void {
  const existing = compareList.find((e) => e.result.waystone.name === result.waystone.name);
  if (existing) {
    existing.result = result;
  } else {
    compareList.unshift({ result, pinned: false });
    while (compareList.length > MAX_COMPARE) {
      const oldestUnpinned = [...compareList].reverse().find((e) => !e.pinned)!;
      compareList.splice(compareList.indexOf(oldestUnpinned), 1);
    }
  }
  saveCompareList(compareList);
}

/** Pin/remove handlers for the per-card Compare buttons (RelicPanel). */
function toggleComparePin(index: number): void {
  const entry = compareList[index];
  if (!entry) return;
  // Cap: un-pinning is always allowed, a third pin is a no-op (the pin
  // button's tooltip states the 2-pin limit).
  if (!entry.pinned && compareList.filter((e) => e.pinned).length >= MAX_PINS) return;
  entry.pinned = !entry.pinned;
  saveCompareList(compareList);
  if (compareOpen) overlay.showCompare(compareList);
}

function removeCompareEntry(index: number): void {
  if (!compareList[index]) return;
  compareList.splice(index, 1);
  saveCompareList(compareList);
  if (!compareOpen) return;
  if (compareList.length === 0) {
    toggleCompare(); // nothing left — restore the underlying body
  } else {
    overlay.showCompare(compareList);
    void reportRegions(); // the grid shrank — shrink its click-through rect too
  }
}

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
  onComparePin: toggleComparePin,
  onCompareRemove: removeCompareEntry,
  onSetAutostart: "__TAURI_INTERNALS__" in window ? setAutostartEnabled : undefined,
  onDragStart: "__TAURI_INTERNALS__" in window ? startWindowDrag : undefined,
  onResetPosition: resetPosition,
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
      pushCompareEntry(result);
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

/** Settings' "Réinitialiser" position button — drops the saved custom
 *  position and snaps back to the default top-right anchor. No-op in
 *  plain-browser dev (both calls already guard on Tauri presence). */
function resetPosition(): void {
  clearCustomPosition();
  void placeTopRight();
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
    // A real display/DPI/monitor change invalidates any dragged position —
    // remapping a stale absolute position onto new geometry risks landing
    // off-screen, so always fall back to the self-healing top-right anchor
    // rather than trying to preserve it (drag-to-reposition, see
    // placement.ts's restoreCustomPosition doc comment).
    clearCustomPosition();
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

  // Drag-to-reposition: restore a previously-dragged spot instead of the
  // default top-right anchor when one was saved and still fits a connected
  // monitor (restoreCustomPosition's own check) — while still hidden, no
  // visible jump on reveal either way.
  const customPos = loadCustomPosition();
  const restored = customPos ? await restoreCustomPosition(customPos) : false;
  if (!restored) await placeTopRight();
  await applyEffectiveMode(); // §2 fallback cascade — may render compact/mini instead of intended
  await sendReport("post-placement");
  await showWhenPainted();
  await registerHotkeys(analyze, toggleMode, toggleCompare, hideOverlay);
  // The overlay mounts (synchronously, above) before the persisted base
  // can be fetched — labels default to Ins, corrected here if remapped.
  overlay.setHotkeyLabel(await getHotkeyBase());
  overlay.setAutostartChecked(await getAutostartEnabled());
  await prepareWindowDrag(); // caches the window ref so the header's mousedown can start a drag synchronously
  await watchDisplayChanges(() => void handleDisplayChange());
  await watchWindowMoves(); // persists a user drag once it settles (KNOWN_ISSUES-adjacent QoL, see placement.ts)
  await sendReport("display-watch-attached");
  // Startup paint only — must NOT simulate Ctrl+C: whatever window has OS
  // focus at this moment (often a dev terminal, not the game) would receive
  // the keystroke instead of the overlay, which for a console means SIGINT.
  analyze(false);
}

init();
