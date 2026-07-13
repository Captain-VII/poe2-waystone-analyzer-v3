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
  loadCustomPosition,
  clearCustomPosition,
  loadSessionStats,
  saveSessionStats,
  clearSessionStats,
  summarizeSessionStats,
  type Mode,
} from "./settings";
import { registerHotkeys, getHotkeyBase, setHotkeyBase } from "./hotkeys";
import { getAutostartEnabled, setAutostartEnabled } from "./autostart";
import { reportInteractiveRegions } from "./interactive-rect";
import { runDiagnostics, applyDebugOpaqueOverride, sendReport, showWhenPainted, logAnalyzeAttempt } from "./diagnostics";
import { readClipboardText } from "./clipboard";
import { analyzeWaystoneText } from "./analyzer/adapter";
import { loadMetaConfig, readRawMetaFile, saveMetaFile, resetMetaFile } from "./analyzer/meta-config";
import { buildEditorModel, buildMetaFile, type MechanicEdit, type MetaEditorModel } from "./analyzer/meta-schema";
import { notifyLegendaryWaystone, notifyUpdateAvailable } from "./notify";
import { checkForUpdate, installUpdate } from "./updater";
import { shouldShowChangelog, markChangelogSeen } from "./changelog";
import type { AnalysisResult, TierClass } from "./types";

let tier: TierClass = "god";
let mode: Mode = loadMode(); // read before first render — no layout flash (§9); intended mode
let analyzing = false;
let lastNotifiedName: string | null = null; // avoid re-notifying on repeat/no-op analyzes

// Session stats (Settings panel): one score per waystone name, persisted —
// see settings.ts's SessionStats for the dedupe/session semantics.
const sessionStats = loadSessionStats();

function recordSessionStat(result: AnalysisResult): void {
  sessionStats.scores[result.waystone.name] = result.heat.score;
  saveSessionStats(sessionStats);
  overlay.setSessionStats(summarizeSessionStats(sessionStats));
}

/** Settings' session-stats "Réinitialiser" button — new farming session. */
function resetSessionStats(): void {
  sessionStats.scores = {};
  clearSessionStats();
  overlay.setSessionStats(summarizeSessionStats(sessionStats));
}

// Méta editor (Settings panel): each action re-reads the raw file, rebuilds
// the diff-only content (meta-schema.ts's buildMetaFile), writes, hot-reloads
// the active tables, and returns a fresh model — a concurrent hand-edit of
// the file is never clobbered beyond the field being changed.
async function metaModelFromDisk(): Promise<MetaEditorModel> {
  const { raw, corrupt } = await readRawMetaFile();
  return buildEditorModel(raw, corrupt);
}

const metaEditor = {
  load: metaModelFromDisk,
  async saveMechanic(name: string, edit: MechanicEdit): Promise<MetaEditorModel> {
    const { raw } = await readRawMetaFile();
    await saveMetaFile(buildMetaFile(raw, new Map([[name.toLowerCase(), edit]]), new Map()));
    return metaModelFromDisk();
  },
  async setTabletEnabled(name: string, enabled: boolean): Promise<MetaEditorModel> {
    const { raw } = await readRawMetaFile();
    await saveMetaFile(buildMetaFile(raw, new Map(), new Map([[name.toLowerCase(), enabled]])));
    return metaModelFromDisk();
  },
  async reset(): Promise<MetaEditorModel> {
    await resetMetaFile();
    return metaModelFromDisk();
  },
};

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
  onSetAutostart: "__TAURI_INTERNALS__" in window ? setAutostartEnabled : undefined,
  onCheckUpdate: "__TAURI_INTERNALS__" in window ? checkForUpdate : undefined,
  onInstallUpdate: "__TAURI_INTERNALS__" in window ? installUpdate : undefined,
  onDragStart: "__TAURI_INTERNALS__" in window ? startWindowDrag : undefined,
  onResetPosition: resetPosition,
  onResetStats: resetSessionStats,
  metaEditor: "__TAURI_INTERNALS__" in window ? metaEditor : undefined,
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
  // key-repeat guard (§8): blocks a second analyze() from overlapping the
  // first's clipboard round-trip (copy → 120ms settle → read → restore,
  // see clipboard.ts) — an overlap could restore the FIRST call's saved
  // clipboard over the SECOND call's freshly-copied text. 250ms leaves
  // roughly 2x that round-trip as margin while still keeping up with a
  // human repeatedly tapping the analyze hotkey (2026-07-13, down from
  // 450ms — user request to spam-tap Ctrl+E).
  if (analyzing) return;
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
      recordSessionStat(result);
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
  setTimeout(() => (analyzing = false), 250);
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
 *  plain-browser dev (both calls already guard on Tauri presence).
 *  Re-reports interactive regions after, same as toggleMode()'s morph —
 *  without it, `placeTopRight()`'s own onMoved fires with `repositioning`
 *  set (placement.ts's watchWindowMoves ignores it, by design, so it
 *  never persists a programmatic move as a "user drag") and nothing else
 *  updates the click-through rects, so every control stays stuck at the
 *  pre-reset screen position (found 2026-07-12, real in-game report). */
async function resetPosition(): Promise<void> {
  clearCustomPosition();
  await placeTopRight();
  await reportRegions();
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
  await registerHotkeys(analyze, toggleMode, hideOverlay);
  // The overlay mounts (synchronously, above) before the persisted base
  // can be fetched — labels default to Ins, corrected here if remapped.
  overlay.setHotkeyLabel(await getHotkeyBase());
  const autostartOn = await getAutostartEnabled();
  overlay.setAutostartChecked(autostartOn);
  // Re-assert so the registry Run key always points at the CURRENT exe —
  // an update that changes the install path/binary name (e.g. the
  // waystone-overlay → Waystone-Analyzer rename) would otherwise keep
  // launching the orphaned old install at every login.
  if (autostartOn) setAutostartEnabled(true).catch(() => {});
  overlay.setSessionStats(summarizeSessionStats(sessionStats)); // persisted stats from previous launches
  await prepareWindowDrag(); // caches the window ref so the header's mousedown can start a drag synchronously
  await watchDisplayChanges(() => void handleDisplayChange());
  // Persists a user drag once it settles, then re-reports interactive
  // regions at the header's new position — without this, a second drag
  // from anywhere but the original spawn position was ignored (ROADMAP.md,
  // root-caused 2026-07-12: the Rust side's click-through check compared
  // the cursor to stale pre-drag rects).
  await watchWindowMoves(reportRegions);
  await sendReport("display-watch-attached");
  // Startup paint only — must NOT simulate Ctrl+C: whatever window has OS
  // focus at this moment (often a dev terminal, not the game) would receive
  // the keystroke instead of the overlay, which for a console means SIGINT.
  analyze(false);
  // Fire-and-forget: version display + silent update check. Never blocks
  // startup, never installs anything — a found update only arms the
  // Settings row and fires one toast; installing stays a user click.
  void (async () => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const { getVersion } = await import("@tauri-apps/api/app");
    const version = await getVersion();
    overlay.setAppVersion(version);
    // First launch of a new version (i.e. right after an update, or a fresh
    // install): show the patch notes once. Marked seen immediately — if the
    // user closes without reading, re-showing every launch would be nagging;
    // the Settings row keeps them reachable.
    if (shouldShowChangelog(version)) {
      overlay.showChangelog();
      markChangelogSeen(version);
    }
    const info = await checkForUpdate();
    if (info) {
      overlay.setUpdateAvailable(info.version);
      await notifyUpdateAvailable(info.version);
    }
  })();
}

init();
