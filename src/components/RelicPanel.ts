import type { AnalysisResult, TierClass } from "../types";
import type { Mode, EffectiveMode, CompareEntry, SessionStatsView } from "../settings";
import type { MechanicEdit, MetaEditorModel } from "../analyzer/meta-schema";
import {
  loadReduceEffects,
  saveReduceEffects,
  loadCompactCompressed,
  saveCompactCompressed,
} from "../settings";
import { renderDangerList, bindDangerListToggle } from "./DangerList";
import {
  loadShowInsights,
  saveShowInsights,
  loadOpacity,
  saveOpacity,
  loadScale,
  saveScale,
} from "../overlaySettings";
import { DEFAULT_HOTKEY_BASE, hotkeyLabel, keyEventToBase } from "../hotkeys";
import { parseChangelog } from "../changelog";
import { ATLAS_MASTER_ICONS } from "../atlas-master-icons";
import { ATLAS_NOTABLE_ICONS } from "../atlas-notable-icons";

export interface OverlayOptions {
  mode: Mode;
  /** OS reduced-motion OR the user's reduceEffects setting (§10). */
  isReduced(): boolean;
  /** §2 height contingency: 392px → ~359px Compact, trimming air only. */
  compactCompressed(): boolean;
  onAnalyze(): void;
  onToggleMode(): void;
  /** Settings panel's "Hide" button — sends the overlay to the system tray
   *  (quitting for good is tray-icon-only, see main.ts). */
  onHide(): void;
  /** Dev-only mock-tier cycling on badge click; omitted entirely in
   *  production builds — see main.ts. */
  onCycleTier?(): void;
  /** Fires whenever the set of currently-interactive controls changes (e.g.
   *  the Settings panel opening/closing) so main.ts can re-report
   *  click-through regions — see interactiveEls(). */
  onInteractiveChange?(): void;
  /** KNOWN_ISSUES #7: remap the hotkey base key (Shift/Ctrl layers derive
   *  from it). Resolves with the normalized stored base; rejects with a
   *  user-displayable message. Omitted = remapping unavailable (the
   *  Settings row stays display-only). */
  onSetHotkey?(base: string): Promise<string>;
  /** KNOWN_ISSUES #8: per-card Compare controls. The list itself lives in
   *  main.ts (same owner as before) — these just report which card was
   *  clicked; main.ts mutates, persists, and calls showCompare again. */
  onComparePin?(index: number): void;
  onCompareRemove?(index: number): void;
  /** Launch-with-Windows toggle (autostart.ts). Rejects on failure — the
   *  checkbox reverts to its previous state rather than showing a stale
   *  "on" it didn't actually achieve. Omitted = unavailable (plain-browser
   *  dev), same convention as onSetHotkey. */
  onSetAutostart?(enabled: boolean): Promise<void>;
  /** Update check/install (updater.ts). Check never throws (null = up to
   *  date, or unavailable, or the check itself failed — deliberately
   *  indistinguishable); install rejects on failure so the row can show
   *  the error and restore the install button. Omitted = unavailable
   *  (plain-browser dev), same convention as onSetAutostart. */
  onCheckUpdate?(): Promise<{ version: string } | null>;
  onInstallUpdate?(onProgress: (pct: number | null) => void): Promise<void>;
  /** Drag-to-reposition (placement.ts's startWindowDrag) — fired
   *  synchronously from the header's mousedown, see that function's doc
   *  for why. Omitted = unavailable (plain-browser dev). */
  onDragStart?(): void;
  /** Settings' "Reset" position button — clears the saved custom
   *  position and re-anchors top-right. */
  onResetPosition?(): void;
  /** Settings' session-stats "Reset" button — clears the persisted
   *  stats to start a fresh farming session (main.ts owns the storage and
   *  calls setSessionStats back with the emptied view). */
  onResetStats?(): void;
  /** Settings' Meta editor (meta.json). main.ts owns all IO: every action
   *  re-reads the file, writes a diff-only rebuild, hot-reloads the
   *  analyzer tables, and returns a fresh model to render. A rejected
   *  promise means the write failed — the panel shows the error and
   *  re-renders from its last good model. Omitted = plain-browser dev
   *  (no Tauri fs) → the whole section is removed from the DOM. */
  metaEditor?: {
    load(): Promise<MetaEditorModel>;
    saveMechanic(name: string, edit: MechanicEdit): Promise<MetaEditorModel>;
    setTabletEnabled(name: string, enabled: boolean): Promise<MetaEditorModel>;
    reset(): Promise<MetaEditorModel>;
  };
}

/** Why an Ins press produced no new result: the copy/read itself failed
 *  (or the clipboard was empty), vs. the clipboard held text that isn't a
 *  Waystone (parser's "Item Class: Waystones" gate). */
export type AnalyzeFailure = "clipboard" | "not-waystone";

export interface OverlayHandle {
  setResult(result: AnalysisResult): void;
  setMode(mode: EffectiveMode): void;
  analyze(): void;
  /** Shows the transient status chip naming why Ins produced nothing new —
   *  the failure counterpart of analyze()'s success pulse (which must NOT
   *  play alongside it, so the two outcomes stay unambiguous). */
  showAnalyzeError(kind: AnalyzeFailure): void;
  /** §12 Compare mode: renders up to 3 waystones side by side, highlighting
   *  the best Juice Score, with per-card pin/remove controls (#8). Overlays
   *  on top of whichever Compact/Full/Mini body was active; `closeCompare()`
   *  restores it. */
  showCompare(entries: CompareEntry[]): void;
  closeCompare(): void;
  /** Updates every rendered hotkey label (Settings row, Compact footer,
   *  toggle tooltip) — called once at startup when the persisted base is
   *  fetched from Rust, and after a successful remap. */
  setHotkeyLabel(base: string): void;
  /** Reflects the real autostart registration state onto the checkbox —
   *  called once at startup after the async `isEnabled()` check resolves
   *  (main.ts's init()). */
  setAutostartChecked(enabled: boolean): void;
  /** Renders the app version in Settings — called once at startup
   *  (getVersion() is async, the row shows "—" until then). */
  setAppVersion(version: string): void;
  /** Flips the update row to "Install vX.Y.Z" — called when the silent
   *  startup check (main.ts) finds a newer version, so the row is already
   *  actionable when the user opens Settings after the toast. */
  setUpdateAvailable(version: string): void;
  /** Opens the "What's New" panel (CHANGELOG.md) — called once by
   *  main.ts on the first launch after an update; also reachable any time
   *  from the Settings row. */
  showChangelog(): void;
  /** Renders the session-stats rows in Settings (count / average / best).
   *  Called at startup with the persisted stats, after every applied
   *  analysis, and after a reset. */
  setSessionStats(view: SessionStatsView): void;
  /** Panel element, for click-through rect reporting. */
  panelEl: HTMLElement;
  /** Currently-visible interactive controls (§2: toggle / footer / mod-scroll
   *  only), for narrowing click-through to exactly these regions. */
  interactiveEls(): HTMLElement[];
}

const TIER_CLASSES: TierClass[] = ["trash", "low", "good", "splus", "god"];

const BADGE_LABEL: Record<TierClass, string> = {
  trash: "WEAK",
  low: "AVERAGE",
  good: "GOOD",
  splus: "EXCELLENT",
  god: "JUICY ✦",
};

/** Row icon per tablet, keyed by the display short name (name minus the
 *  "(Precursor) Tablet" suffix, lowercased). Display-only flavor — an
 *  unknown/new tablet (e.g. added via meta.json) falls back to "◆". */
const TABLET_ICONS: Record<string, string> = {
  breach: "⚡",
  ritual: "🔱",
  delirium: "🌀",
  abyss: "👁",
  expedition: "⛏",
  irradiated: "☢",
  temple: "🏛",
  standard: "✦",
  overseer: "👑",
};

// 2026-07-12 (user request): replaces the earlier RUN/WHY NOT/DON'T RUN
// verdict label — a plain percentage, colored on a continuous red→gold
// ramp (0% = --danger, 100% = --god, same hex values the rest of the app
// already uses for its worst/best states), gives both the exact number
// and an at-a-glance visual cue in one compact element.
const FIT_COLOR_LOW: [number, number, number] = [181, 74, 58]; // --danger #b54a3a
const FIT_COLOR_HIGH: [number, number, number] = [255, 211, 106]; // --god #ffd36a

function fitColor(percent: number): string {
  const t = Math.max(0, Math.min(100, percent)) / 100;
  const [r1, g1, b1] = FIT_COLOR_LOW;
  const [r2, g2, b2] = FIT_COLOR_HIGH;
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

const CORNER_PATHS = `
  <path d="M2 23 V8 Q2 2 8 2 H23" fill="none" stroke="currentColor" stroke-width="2.2"/>
  <path d="M2 17 Q10 15 10 10 Q15 10 17 2" fill="none" stroke="currentColor" stroke-width="1" opacity=".7"/>
  <path d="M2 22 Q5.5 20.5 5.5 16.5 M22 2 Q20.5 5.5 16.5 5.5" fill="none" stroke="currentColor" stroke-width="1" opacity=".5"/>
  <rect x="4.4" y="4.4" width="3.2" height="3.2" transform="rotate(45 6 6)" fill="currentColor"/>
  <circle cx="10" cy="10" r="1.1" fill="currentColor" opacity=".8"/>`;

function cornerSvg(pos: "tl" | "tr" | "br" | "bl"): string {
  return `<svg class="corner ${pos}" viewBox="0 0 24 24" aria-hidden="true">${CORNER_PATHS}</svg>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function fmtDelta(v: number): string {
  return (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1);
}

/** Categorizes an existing insight/bonus-reason string for display —
 *  no new data, just a keyword read of text already produced by
 *  adapter.ts's buildInsights. Anything that matches nothing keeps the
 *  original plain "◆" look (never drops a line for not fitting a bucket). */
function categorizeInsight(text: string): { icon: string; cls: string } {
  const t = text.toLowerCase();
  if (/reflect|no leech|no regen|avoid|danger|risk/.test(t)) return { icon: "⚠", cls: "danger" };
  if (/breach|tablet|pair|synerg|value|worth/.test(t)) return { icon: "💰", cls: "value" };
  if (/safe|corrupt|ceiling|stable/.test(t)) return { icon: "✅", cls: "safe" };
  return { icon: "◆", cls: "" };
}

/** Remove/reflow/re-add so the same animation can fire repeatedly. */
function retrigger(el: Element, cls: string): void {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
  el.addEventListener("animationend", () => el.classList.remove(cls), { once: true });
}

export function mountOverlay(
  root: HTMLElement,
  initial: AnalysisResult,
  opts: OverlayOptions,
): OverlayHandle {
  root.innerHTML = `
    <div class="overlay">
      <div class="panel">
        ${cornerSvg("tl")}${cornerSvg("tr")}${cornerSvg("br")}${cornerSvg("bl")}
        <svg class="clasp" viewBox="0 0 22 11" aria-hidden="true">
          <path d="M11 .5 L15 5.5 L11 10.5 L7 5.5 Z" fill="currentColor"/>
          <path d="M1 5.5 H7 M15 5.5 H21" stroke="currentColor" stroke-width="1" opacity=".7"/>
        </svg>
        <div class="status-chip" data-status hidden><span class="s-ic" data-status-icon></span><span data-status-text></span></div>
        <div class="p-head" data-head title="Drag to move the overlay">
          <svg class="glyph" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 1 L14 8 L8 15 L2 8 Z" fill="none" stroke="currentColor" stroke-width="1.4"/>
            <path d="M8 4.5 L11.2 8 L8 11.5 L4.8 8 Z" fill="currentColor" opacity=".7"/>
          </svg>
          <span class="p-title">Waystone</span>
          <span class="p-sub" data-sub></span>
          <span class="mini-score" data-mini-score></span>
          <span class="mini-warn" data-mini-warn title="" hidden>⚠</span>
          <button class="badge" data-badge></button>
          <button class="toggle-btn" data-toggle title="Toggle Compact / Full (Shift+Ins)" aria-label="Toggle compact or full view">⤢</button>
          <button class="settings-btn" data-settings title="Settings" aria-label="Toggle settings panel">⚙</button>
          <button class="minimize-btn" data-minimize title="Minimize to tray (Esc)" aria-label="Minimize overlay to tray">–</button>
        </div>
        <div class="bodies">
          <div class="body body-compact">
            <div class="hero-v">
              <div class="heat-label">Heat</div>
              <div class="score-wrap" data-hero-compact><span class="halo"></span><span class="score-num" data-score></span></div>
              <div class="tier-name"><span data-tiername></span> <span class="rating-pill" data-rating></span></div>
              <div class="action-chip" data-action></div>
            </div>
            <div class="sep"></div>
            <div class="tabs-v">
              <div class="sec-h">Recommended Tablets</div>
              <div data-tablets></div>
            </div>
            <div class="warn-strip" data-warn hidden><span class="w-ic">⚠</span><span data-warntext></span><span class="w-level" data-warnlevel></span></div>
            <button class="p-foot" data-foot><kbd data-foot-kbd>Ins</kbd> Analyze Waystone</button>
          </div>
          <div class="body body-full">
            <div class="cols">
              <div class="col" data-col-tablets>
                <div class="sec-h">Recommended Tablets</div>
                <div data-tablets-full></div>
                <div class="atlas-master" data-atlas-master hidden>
                  <img class="atlas-master-icon" data-atlas-master-icon alt="" title="" />
                  <div class="atlas-master-body">
                    <div class="atlas-master-lab-row">
                      <span class="atlas-master-lab">Atlas Master:</span>
                      <span class="atlas-master-name" data-atlas-master-name></span>
                    </div>
                    <div class="atlas-notables" data-atlas-notables></div>
                  </div>
                </div>
              </div>
              <div class="col" data-col-heat>
                <div class="sec-h">Heat Breakdown</div>
                <div class="score-row">
                  <span class="score-wrap" data-hero-full><span class="halo"></span><span class="score-num" data-score-full></span></span>
                  <span class="badge badge-sm" data-minibadge></span>
                </div>
                <div data-breakdown></div>
                <div class="total-row"><span class="t-lab">Total Heat</span><span class="t-right"><span class="t-val" data-total></span><span class="rating-pill" data-rating-full></span></span></div>
              </div>
              <div class="col" data-col-insights>
                <div class="insights-block" data-insights-block>
                  <div class="sec-h">Insights <span class="danger-badge" data-danger-badge hidden></span></div>
                  <div class="insights" data-insights></div>
                </div>
              </div>
            </div>
          </div>
          <div class="body body-compare">
            <div class="sec-h">Compare Waystones</div>
            <div class="compare-cols" data-compare></div>
          </div>
          <div class="body body-settings" data-settings-panel>
            <div class="settings-scroll">
              <div class="sec-h">Display</div>
              <div class="set-row">
                <span class="set-lab">Overlay Mode</span>
                <button class="set-btn" data-set-mode type="button"></button>
              </div>
              <div class="set-row">
                <span class="set-lab">Insights</span>
                <label class="set-switch">
                  <input type="checkbox" data-set-insights />
                  <span class="set-switch-track"></span>
                </label>
              </div>
              <div class="set-row" title="Disables pulse, flare, sparks and transition animations (§10)">
                <span class="set-lab">Reduce Effects</span>
                <label class="set-switch">
                  <input type="checkbox" data-set-reduce />
                  <span class="set-switch-track"></span>
                </label>
              </div>
              <div class="set-row" title="Trims Compact mode to ~359px if the overlay overlaps your in-game HUD (§2)">
                <span class="set-lab">Compact Compressed</span>
                <label class="set-switch">
                  <input type="checkbox" data-set-compressed />
                  <span class="set-switch-track"></span>
                </label>
              </div>
              <div class="set-row set-col">
                <div class="set-row">
                  <span class="set-lab">Overlay Opacity</span>
                  <span class="set-val" data-set-opacity-val></span>
                </div>
                <input class="set-slider" type="range" min="60" max="100" step="1" data-set-opacity />
              </div>
              <div class="set-row set-col">
                <div class="set-row">
                  <span class="set-lab">Overlay Scale</span>
                  <span class="set-val" data-set-scale-val></span>
                </div>
                <input class="set-slider" type="range" min="0.8" max="1.05" step="0.05" data-set-scale />
              </div>
              <div class="set-sep"></div>
              <div class="sec-h">Controls</div>
              <div class="set-row" title="Click, then press the new key (Escape cancels). Shift+key toggles Compact/Full, Ctrl+key opens Compare.">
                <span class="set-lab">Hotkey</span>
                <span class="set-val set-hotkey-msg" data-hotkey-msg hidden></span>
                <button class="set-hotkey" data-set-hotkey type="button" aria-label="Remap the analyze hotkey"><kbd data-hotkey-kbd>Ins</kbd></button>
              </div>
              <div class="set-row" title="Drag the title bar to move the overlay elsewhere on screen — this button cancels that and returns to the default top-right corner">
                <span class="set-lab">Position</span>
                <button class="set-btn" data-set-reset-position type="button">Reset</button>
              </div>
              <div class="set-row" title="Launches the overlay automatically at Windows sign-in (stays unobtrusive: click-through, hides normally)">
                <span class="set-lab">Launch with Windows</span>
                <label class="set-switch">
                  <input type="checkbox" data-set-autostart />
                  <span class="set-switch-track"></span>
                </label>
              </div>
              <div class="set-sep"></div>
              <div class="sec-h" title="Since the last Reset — each waystone counts once (re-analyzing it updates its score)">Session</div>
              <div class="set-row">
                <span class="set-lab">Waystones analyzed</span>
                <span class="set-val" data-stat-count>0</span>
              </div>
              <div class="set-row">
                <span class="set-lab">Average score</span>
                <span class="set-val" data-stat-avg>—</span>
              </div>
              <div class="set-row">
                <span class="set-lab">Best find</span>
                <span class="set-val set-stat-best" data-stat-best>—</span>
              </div>
              <div class="set-row" title="Resets session stats to zero to start a fresh farming session">
                <span class="set-lab">Stats</span>
                <button class="set-btn" data-stat-reset type="button">Reset</button>
              </div>
              <div class="set-group" data-meta-section>
                <div class="set-sep"></div>
                <div class="sec-h" title="Customizes per-mechanic recommendations (meta.json). Only values that differ from the defaults are written to the file.">Meta</div>
                <span class="set-val set-meta-msg" data-meta-msg hidden></span>
                <div class="set-row">
                  <span class="set-lab">Mechanic</span>
                  <button class="set-select" type="button" data-meta-mech aria-haspopup="listbox" aria-label="Mechanic to customize"></button>
                </div>
                <div class="set-row">
                  <span class="set-lab">Priority stat</span>
                  <button class="set-select" type="button" data-meta-priority aria-haspopup="listbox" aria-label="Priority stat"></button>
                </div>
                <div class="set-row set-col" title="Below this Juice Score, the mechanic isn't recommended">
                  <div class="set-row">
                    <span class="set-lab">Skip if score below</span>
                    <span class="set-val" data-meta-skip-val></span>
                  </div>
                  <input class="set-slider" type="range" min="0" max="100" step="1" data-meta-skip aria-label="Skip threshold" />
                </div>
                <div class="set-group" data-meta-tablets></div>
                <div class="set-row" title="Rewrites meta.json empty: every mechanic and tablet reverts to the code's defaults">
                  <span class="set-lab">Meta</span>
                  <button class="set-btn" data-meta-reset type="button">Restore defaults</button>
                </div>
              </div>
              <div class="set-sep"></div>
              <div class="sec-h">Application</div>
              <div class="set-row">
                <span class="set-lab">Version</span>
                <span class="set-val" data-app-version>—</span>
              </div>
              <div class="set-row" title="Checks GitHub; installation only ever starts on click — never automatically">
                <span class="set-lab">Update</span>
                <span class="set-val set-update-msg" data-update-msg hidden></span>
                <button class="set-btn" data-update-btn type="button">Check for updates</button>
              </div>
              <div class="set-row" title="Change history, version by version — also shown automatically once after each update">
                <span class="set-lab">Patch Notes</span>
                <button class="set-btn" data-changelog-show type="button">Show</button>
              </div>
              <div class="set-row">
                <span class="set-lab">Hide Overlay</span>
                <button class="set-btn" data-set-hide type="button" title="Sends the overlay to the system tray. Right-click the tray icon to quit for good.">Hide</button>
              </div>
            </div>
          </div>
          <div class="body body-changelog" data-changelog-panel>
            <div class="settings-scroll">
              <div class="cl-head">
                <div class="sec-h">What's New</div>
                <button class="set-btn" data-changelog-close type="button">Close</button>
              </div>
              <div data-changelog-list></div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  const overlayEl = root.querySelector(".overlay") as HTMLElement;
  const panel = overlayEl.querySelector(".panel") as HTMLElement;
  const q = (sel: string) => panel.querySelector(sel) as HTMLElement;
  const badge = q("[data-badge]");
  const miniBadge = q("[data-minibadge]");
  const miniScore = q("[data-mini-score]");
  const miniWarn = q("[data-mini-warn]");
  const scoreCompact = q("[data-score]");
  const scoreFull = q("[data-score-full]");
  const chip = q("[data-action]");
  const statusChip = q("[data-status]");
  const warn = q("[data-warn]");
  const toggleBtn = q("[data-toggle]");
  const footBtn = q("[data-foot]");
  const colTablets = q("[data-col-tablets]");
  const colInsights = q("[data-col-insights]");
  const tabletsEl = q("[data-tablets]");
  const tabletsFullEl = q("[data-tablets-full]");
  const atlasMasterEl = q("[data-atlas-master]");
  const atlasMasterIcon = q("[data-atlas-master-icon]") as HTMLImageElement;
  const atlasMasterName = q("[data-atlas-master-name]");
  const atlasNotablesEl = q("[data-atlas-notables]");
  const compareGrid = q("[data-compare]");
  const settingsBtn = q("[data-settings]");
  const minimizeBtn = q("[data-minimize]");
  const settingsPanel = q("[data-settings-panel]");
  const setModeBtn = q("[data-set-mode]") as HTMLButtonElement;
  const setInsightsInput = q("[data-set-insights]") as HTMLInputElement;
  const setReduceInput = q("[data-set-reduce]") as HTMLInputElement;
  const setCompressedInput = q("[data-set-compressed]") as HTMLInputElement;
  const setAutostartInput = q("[data-set-autostart]") as HTMLInputElement;
  const setOpacityInput = q("[data-set-opacity]") as HTMLInputElement;
  const setOpacityVal = q("[data-set-opacity-val]");
  const setScaleInput = q("[data-set-scale]") as HTMLInputElement;
  const setScaleVal = q("[data-set-scale-val]");
  const setHideBtn = q("[data-set-hide]");
  const setResetPositionBtn = q("[data-set-reset-position]");
  const appVersionEl = q("[data-app-version]");
  const updateBtn = q("[data-update-btn]") as HTMLButtonElement;
  const updateMsg = q("[data-update-msg]");
  const changelogPanel = q("[data-changelog-panel]");
  const changelogList = q("[data-changelog-list]");
  const changelogShowBtn = q("[data-changelog-show]");
  const changelogCloseBtn = q("[data-changelog-close]");
  const statCountEl = q("[data-stat-count]");
  const statAvgEl = q("[data-stat-avg]");
  const statBestEl = q("[data-stat-best]");
  const statResetBtn = q("[data-stat-reset]");
  const metaSection = q("[data-meta-section]");
  const metaMechSel = q("[data-meta-mech]") as HTMLButtonElement;
  const metaPrioritySel = q("[data-meta-priority]") as HTMLButtonElement;
  const metaSkipInput = q("[data-meta-skip]") as HTMLInputElement;
  const metaSkipVal = q("[data-meta-skip-val]");
  const metaTabletsEl = q("[data-meta-tablets]");
  const metaMsg = q("[data-meta-msg]");
  const metaResetBtn = q("[data-meta-reset]") as HTMLButtonElement;
  const headEl = q("[data-head]");
  const hotkeyBtn = q("[data-set-hotkey]") as HTMLButtonElement;
  const hotkeyKbd = q("[data-hotkey-kbd]");
  const hotkeyMsg = q("[data-hotkey-msg]");
  const footKbd = q("[data-foot-kbd]");

  let current = initial;
  let effective: EffectiveMode = opts.mode;
  let compareActive = false;
  let settingsOpen = false;

  function setResult(result: AnalysisResult): void {
    hideStatusChip(); // a success instantly clears a lingering failure chip
    closeTabletPopup(); // the tablet list is about to be rebuilt — its anchor row would go stale
    current = result;
    const { heat, waystone } = result;
    for (const t of TIER_CLASSES) panel.classList.toggle(`tier-${t}`, t === heat.tierClass);

    badge.textContent = BADGE_LABEL[heat.tierClass];
    miniScore.textContent = heat.score.toFixed(1);
    if (result.warning) {
      miniWarn.hidden = false;
      miniWarn.title = result.warning;
    } else {
      miniWarn.hidden = true;
      miniWarn.title = "";
    }
    scoreCompact.textContent = heat.score.toFixed(1);
    q("[data-sub]").textContent = `T${waystone.tier} · ${waystone.name}`;
    q("[data-tiername]").textContent = heat.tierLabel;
    chip.textContent = heat.verdict;
    const ratingEl = q("[data-rating]");
    ratingEl.textContent = heat.rating;
    ratingEl.className = `rating-pill rec-rating-${heat.rating}`;
    ratingEl.title = `Rating: ${heat.rating} (${heat.score.toFixed(1)})`;

    // Heat Breakdown's composite score/rating (Full mode). Re-enabled
    // 2026-07-1x once the underlying formula was rebuilt around the
    // waystone's own dominant stat (scoring.ts) — was temporarily hidden
    // 2026-07-10 while the old weighted-sum model was found misleading
    // mid-rework (KNOWN_ISSUES.md). The per-stat % rows below were never
    // affected either way.
    miniBadge.textContent = BADGE_LABEL[heat.tierClass];
    scoreFull.textContent = heat.score.toFixed(1);
    q("[data-total]").textContent = heat.score.toFixed(1);
    const ratingFullEl = q("[data-rating-full]");
    ratingFullEl.textContent = heat.rating;
    ratingFullEl.className = `rating-pill rec-rating-${heat.rating}`;
    ratingFullEl.title = `Rating: ${heat.rating} (${heat.score.toFixed(1)})`;

    // "Stat fit: 45" / "Reward: +9" / a value-less qualitative note like
    // "Confidence: medium (×0.92)" — see Tablet.breakdown's doc comment for
    // the additive-vs-qualitative contract this formatting follows.
    const formatBreakdownRow = (row: { label: string; value?: number }): string => {
      if (row.value === undefined) return row.label;
      const prefix = row.label === "Stat fit" || row.value < 0 ? "" : "+";
      return `${row.label}: ${prefix}${row.value}`;
    };

    // One uniform scan-row per tablet: icon · NAME · Run/Why not/Don't run.
    // No per-row reason/rating/rewards lines, and no raw fit number/bar
    // (2026-07-10) — the hover title carries the exact numbers instead, the
    // row itself reads at a glance. No always-visible footer either
    // (removed same day, once the list grew past 5 rows and needed a
    // scrollbar — the user's call: not worth the space for a number "dont
    // les gens se foutent" once it's one hover away like every other row).
    const tabletRow = (t: AnalysisResult["tablets"][number]) => {
      // Every real tablet name ends in "Tablet" (Expedition Tablet, Standard
      // Precursor Tablet, ...) — that word carries no distinguishing info in
      // a column titled "Tablettes Recommandées", so it's dropped here
      // (display only; t.name stays in the hover title).
      const shortName = t.name.replace(/\s+(Precursor\s+)?Tablet$/i, "");
      const icon = TABLET_ICONS[shortName.toLowerCase()] ?? "◆";
      // Multi-line native tooltip: the opaque "matches X (Y/100)" reason,
      // then one line per breakdown row — every row gets this on hover.
      const title = [t.reason, ...(t.breakdown ?? []).map(formatBreakdownRow)].join("\n");
      // data-mechanic drives the Full-mode click-to-edit popup
      // (openTabletPopup) — rendered on every row (Compact too) since
      // tabletRow is shared, but only tabletsFullEl gets a click listener.
      return `
        <div class="trow" data-mechanic="${esc(t.mechanic)}" title="${esc(title)}">
          <span class="t-ic">${icon}</span>
          <span class="t-name" title="${esc(t.name)}">${esc(shortName)}</span>
          <span class="t-fit" style="color: ${fitColor(t.fit)}">${t.fit}%</span>
        </div>`;
    };
    // Every active tablet, always, in the fixed alphabetical order
    // rankTablets now returns (2026-07-12, user request) — both Compact
    // and Full show the full list; Compact's column scrolls on overflow
    // instead of truncating (compact.css).
    tabletsEl.innerHTML = result.tablets.map(tabletRow).join("");
    tabletsFullEl.innerHTML = result.tablets.map(tabletRow).join("");

    // Full mode only (§ROADMAP placement) — hidden entirely when the
    // recommended mechanic has no sourced Atlas Master pick yet
    // (atlas-masters.ts), rather than guessing. Master's own circular
    // portrait first, then one small icon per notable/keystone to
    // allocate (2026-07-12, user request — mirrors how the real Atlas
    // Tree UI shows a master's active keystones as a row of icons next to
    // their portrait, not just a name).
    const masterIcon = result.atlasMaster ? ATLAS_MASTER_ICONS[result.atlasMaster] : undefined;
    if (result.atlasMaster && masterIcon) {
      atlasMasterIcon.src = masterIcon;
      atlasMasterIcon.title = result.atlasMaster;
      atlasMasterName.textContent = result.atlasMaster;
      atlasNotablesEl.innerHTML = result.atlasMasterNotables
        .map((name) => {
          const icon = ATLAS_NOTABLE_ICONS[name];
          return icon ? `<img class="atlas-notable-icon" src="${esc(icon)}" alt="" title="${esc(name)}" />` : "";
        })
        .join("");
      atlasMasterEl.hidden = false;
    } else {
      atlasMasterEl.hidden = true;
    }

    // The column-1 label width (~104px) fits every breakdown label except
    // these two — shortened display-only (full name still on hover), same
    // pattern as tabletRow's `shortName` above; adapter.ts's `label` (used
    // by Insights' "High <label>" phrasing, which has room for the long
    // form) is untouched.
    const BREAKDOWN_SHORT_LABELS: Partial<Record<string, string>> = {
      monsterEffectiveness: "Monster Eff.",
      waystoneDropChance: "Drop Chance",
    };
    q("[data-breakdown]").innerHTML = heat.breakdown
      .map((b) => {
        const shortLabel = BREAKDOWN_SHORT_LABELS[b.key] ?? b.label;
        return `
        <div class="brow">
          <span class="b-lab" title="${esc(b.label)}">${esc(shortLabel)}</span>
          <span class="b-val">${b.display ?? fmtDelta(b.value)}</span>
        </div>`;
      })
      .join("");

    // Key factors + insights share one row, folded together rather than a
    // new titled section (see docs/implementation-plan.md). The danger
    // list (severity-grouped, DangerList.ts) comes first and always shows
    // in full; factors/insights used to be capped at 1 combined row —
    // real content (keyFactors: ≤4, insights: ≤3) was silently discarded
    // to fit the column's old fixed-height budget. Since the Full columns
    // now overflow-scroll individually (2026-07-12's equal-width layout),
    // that cap was just leaving real, already-computed rows on the floor
    // and an empty column underneath — show them all instead (found
    // 2026-07-12, real overlay screenshot: a big dead gap below "Insights"
    // on waystones with only 1-3 danger hits).
    const factorRows = result.keyFactors.map(
      (line) => `<div class="ins-row factor"><span class="i-ic">+</span><span>${esc(line)}</span></div>`,
    );
    const insightRows = result.insights.map((line) => {
      const { icon, cls } = categorizeInsight(line);
      return `<div class="ins-row${cls ? ` ${cls}` : ""}"><span class="i-ic">${icon}</span><span>${esc(line)}</span></div>`;
    });
    // Bonus rows get their own group header (matching DangerList.ts's
    // Medium/Low headers) so the column reads as two distinct types —
    // malus (the danger list above) and bonus — instead of one
    // undifferentiated stream (2026-07-12, user request).
    const bonusHeader = factorRows.length || insightRows.length ? `<div class="dl-group-h dl-bonus">Bonus</div>` : "";
    q("[data-insights]").innerHTML = [
      renderDangerList(result.dangerHits),
      bonusHeader,
      ...factorRows,
      ...insightRows,
    ].join("");

    // Danger badge: purely a display label over `dangerLevel` (itself
    // derived only from `warnings`, never `score`) — sits inline in the
    // Insights heading so it costs no extra vertical row.
    const dangerBadge = q("[data-danger-badge]");
    if (result.dangerLevel === "none") {
      dangerBadge.hidden = true;
    } else {
      dangerBadge.hidden = false;
      dangerBadge.textContent = result.dangerLabel;
      dangerBadge.className = `danger-badge lvl-${result.dangerLevel}`;
    }

    if (result.warning) {
      warn.hidden = false;
      q("[data-warntext]").textContent = result.warning;
      // Compact strip has room for the single most-severe warning only —
      // append a short level tag (e.g. "· High") rather than the full
      // dangerLabel (too long for this width).
      const level = result.dangerLevel;
      q("[data-warnlevel]").textContent = level === "none" ? "" : ` · ${level[0].toUpperCase()}${level.slice(1)}`;
    } else {
      warn.hidden = true;
    }
  }

  function spawnSparks(): void {
    const host = effective === "full" ? q("[data-hero-full]") : q("[data-hero-compact]");
    for (let n = 0; n < 5; n++) {
      const s = document.createElement("span");
      s.className = "spark";
      const ang = Math.random() * Math.PI * 2;
      const dist = 18 + Math.random() * 10;
      s.style.setProperty("--dx", `${Math.cos(ang) * dist}px`);
      s.style.setProperty("--dy", `${Math.sin(ang) * dist}px`);
      s.style.animationDelay = `${Math.random() * 120}ms`;
      host.appendChild(s);
      setTimeout(() => s.remove(), 1100);
    }
  }

  function analyze(): void {
    if (settingsOpen) toggleSettings(); // a fresh analysis should be seen, not hidden behind Settings
    if (changelogOpen) toggleChangelog(); // same — the result must not stay hidden behind the notes
    syncReducedClass();
    if (opts.isReduced()) return; // §10: color states stay, motion doesn't
    retrigger(scoreCompact, "pulse");
    retrigger(scoreFull, "pulse");
    retrigger(badge, "flare");
    retrigger(miniBadge, "flare");
    retrigger(chip, "flare");
    if (!warn.hidden) retrigger(warn, "reveal"); // §7 warning reveal
    if (!miniWarn.hidden) retrigger(miniWarn, "reveal");
    if (current.heat.tierClass === "god") spawnSparks();
  }

  // Icon + text + class per failure kind — meaning never rests on color
  // alone (§6): "clipboard" is a real malfunction (danger red), while
  // "not-waystone" means the app worked correctly on the wrong item (info).
  const STATUS_CONTENT: Record<AnalyzeFailure, { icon: string; text: string; cls: string }> = {
    clipboard: { icon: "⚠", text: "Copy failed — clipboard empty", cls: "status-err" },
    "not-waystone": { icon: "◆", text: "Not a Waystone", cls: "status-info" },
  };

  let statusTimer: ReturnType<typeof setTimeout> | undefined;

  function hideStatusChip(): void {
    clearTimeout(statusTimer);
    statusChip.hidden = true;
  }

  function showAnalyzeError(kind: AnalyzeFailure): void {
    // Unlike analyze(), an open Settings panel is left alone — the chip
    // floats above the header, readable either way, and closing Settings
    // over a failed keystroke would be intrusive.
    const { icon, text, cls } = STATUS_CONTENT[kind];
    q("[data-status-icon]").textContent = icon;
    q("[data-status-text]").textContent = text;
    statusChip.className = `status-chip ${cls}`;
    statusChip.hidden = false;
    syncReducedClass();
    if (!opts.isReduced()) retrigger(statusChip, "reveal"); // §7 reveal; §10: the chip itself always shows
    // Auto-hide after 2s; re-invocation resets the timer, so key spam
    // shows one steady chip instead of flicker.
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => (statusChip.hidden = true), 2000);
  }

  /** §10: mirrors the reduced-motion state onto a class, so CSS-only
   *  transitions (mode morph, halo fade-in, body cross-fade, ...) respect
   *  the user's `reduceEffects` setting too, not just the JS-triggered
   *  effects gated above — the OS `prefers-reduced-motion` media query
   *  alone can't see that setting. */
  function syncReducedClass(): void {
    overlayEl.classList.toggle("reduced", opts.isReduced());
  }

  function setMode(m: EffectiveMode): void {
    const modeChanged = m !== effective;
    effective = m;
    overlayEl.classList.toggle("mode-full", m === "full");
    overlayEl.classList.toggle("mode-compact", m === "compact");
    overlayEl.classList.toggle("mode-mini", m === "mini");
    toggleBtn.textContent = m === "full" ? "⤡" : "⤢";
    setModeBtn.textContent = m === "full" ? "Switch to Compact" : "Switch to Full";
    // A real Compact/Full/Mini change closes Settings — it's called for
    // every fallback-cascade re-evaluation (display changes, etc.), so this
    // only fires on an actual layout switch, not every re-application of
    // the same mode. Avoids a stale Settings panel over the new layout.
    if (settingsOpen && modeChanged) toggleSettings();
    if (changelogOpen && modeChanged) toggleChangelog(); // same staleness reasoning as Settings
    // The tablet-mechanic popup is Full-only UI anchored to Full-mode DOM —
    // a real mode switch invalidates it even if Settings wasn't open.
    if (modeChanged) closeTabletPopup();
  }

  /** Settings-panel-only display prefs (insights visibility, opacity,
   *  scale) — Overlay Mode in the panel just calls opts.onToggleMode(),
   *  it doesn't own mode state (see settings.ts). */
  function applyShowInsights(show: boolean): void {
    panel.classList.toggle("hide-insights", !show);
    setInsightsInput.checked = show;
  }

  function applyOpacity(pct: number): void {
    panel.style.setProperty("--user-opacity", String(pct / 100));
    setOpacityInput.value = String(pct);
    setOpacityVal.textContent = `${Math.round(pct)}%`;
  }

  function applyScale(scale: number): void {
    panel.style.setProperty("--user-scale", scale.toFixed(2));
    setScaleInput.value = String(scale);
    setScaleVal.textContent = `${scale.toFixed(2)}x`;
  }

  function toggleSettings(): void {
    settingsOpen = !settingsOpen;
    if (!settingsOpen) stopHotkeyCapture(); // a half-finished capture must not outlive its UI
    if (!settingsOpen) openDropdownClose?.(); // an open dropdown must not outlive its panel
    if (settingsOpen && compareActive) closeCompare();
    if (settingsOpen && changelogOpen) toggleChangelog();
    if (settingsOpen) closeTabletPopup(); // the popup lives outside .bodies, CSS cross-fade alone won't hide it
    if (settingsOpen) void loadMetaEditor(); // fresh model on every open — a hand-edit of the file mid-session shows up
    overlayEl.classList.toggle("settings-open", settingsOpen);
    settingsBtn.classList.toggle("active", settingsOpen);
    opts.onInteractiveChange?.();
  }

  /** "What's New" panel — a fifth `.body` following the Settings-panel
   *  pattern (same region, no window resize). Content is static
   *  (CHANGELOG.md bundled at build time), rendered once at mount. */
  let changelogOpen = false;

  function toggleChangelog(): void {
    changelogOpen = !changelogOpen;
    if (changelogOpen && settingsOpen) toggleSettings();
    if (changelogOpen && compareActive) closeCompare();
    if (changelogOpen) closeTabletPopup(); // same reason as toggleSettings
    overlayEl.classList.toggle("changelog-open", changelogOpen);
    opts.onInteractiveChange?.();
  }

  function showChangelog(): void {
    if (!changelogOpen) toggleChangelog();
  }

  // The only markdown allowed through: **bold** (escaped first, so this
  // can't open an HTML injection surface via the changelog file).
  const clText = (s: string): string => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  function renderChangelog(): void {
    changelogList.innerHTML = parseChangelog()
      .map(
        (s) => `
        <div class="cl-section">
          <div class="cl-ver">${esc(s.version)}</div>
          ${s.bullets.map((b) => `<div class="cl-li">${clText(b)}</div>`).join("")}
        </div>`,
      )
      .join("");
  }

  /** Méta editor (meta.json). One set of controls navigated by a mechanic
   *  select — the model comes from opts.metaEditor (main.ts), every change
   *  saves immediately (like every other Settings control), and a rejected
   *  save shows the error and re-renders from the last good model. */
  let metaModel: MetaEditorModel | null = null;
  let selectedMech = "";
  let metaMsgTimer: ReturnType<typeof setTimeout> | undefined;

  function showMetaMsg(text: string, opts2: { persistent?: boolean } = {}): void {
    metaMsg.textContent = text;
    metaMsg.classList.add("err");
    metaMsg.hidden = false;
    clearTimeout(metaMsgTimer);
    if (!opts2.persistent) metaMsgTimer = setTimeout(() => (metaMsg.hidden = true), 3000);
  }

  function setMetaControlsDisabled(disabled: boolean): void {
    for (const el of [metaMechSel, metaPrioritySel, metaSkipInput, metaResetBtn]) {
      el.disabled = disabled;
    }
    for (const input of metaTabletsEl.querySelectorAll("input")) input.disabled = disabled;
  }

  async function loadMetaEditor(): Promise<void> {
    if (!opts.metaEditor) return;
    setMetaControlsDisabled(true);
    try {
      metaModel = await opts.metaEditor.load();
      renderMetaEditor();
    } catch {
      showMetaMsg("Could not read meta.json");
    } finally {
      setMetaControlsDisabled(false);
    }
  }

  /** Custom dropdown replacing the native <select>. The native popup is an
   *  OS window that can extend past the overlay's bounds — clicks landing
   *  out there hit lib.rs's click-away poll (a left-click outside every
   *  interactive rect hides the overlay), so picking an option in the
   *  overflow area dismissed the whole overlay mid-selection. This list is
   *  a plain element appended to the settings panel and clamped inside it,
   *  so every click stays within the already-reported interactive rect. */
  interface DropdownOption {
    value: string;
    label: string;
  }
  let openDropdownClose: (() => void) | null = null;

  function makeDropdown(btn: HTMLButtonElement, onPick: (value: string) => void, container: HTMLElement = settingsPanel) {
    let options: DropdownOption[] = [];
    let value = "";

    function applyLabel(): void {
      btn.textContent = options.find((o) => o.value === value)?.label ?? "—";
    }

    function open(): void {
      openDropdownClose?.();
      const list = document.createElement("div");
      list.className = "set-dropdown-list";
      list.setAttribute("role", "listbox");
      for (const o of options) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "set-dropdown-item" + (o.value === value ? " selected" : "");
        item.setAttribute("role", "option");
        item.textContent = o.label;
        item.addEventListener("click", () => {
          const changed = o.value !== value;
          close();
          if (changed) {
            value = o.value;
            applyLabel();
            onPick(o.value);
          }
        });
        list.appendChild(item);
      }
      container.appendChild(list);
      // Clamp inside the container: below the button if it fits, above
      // otherwise — the container IS (or is inside) the reported
      // click-through rect, so staying inside it is what keeps every
      // option clickable (and the click-away poll quiet).
      const containerRect = container.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const height = Math.min(list.scrollHeight, 180);
      let top = btnRect.bottom - containerRect.top + 3;
      if (top + height > containerRect.height - 6) {
        top = Math.max(6, btnRect.top - containerRect.top - height - 3);
      }
      list.style.top = `${top}px`;
      list.style.right = `${Math.max(6, containerRect.right - btnRect.right)}px`;
      list.style.maxHeight = `${height}px`;

      const onDocMousedown = (ev: MouseEvent): void => {
        if (ev.target instanceof Node && (list.contains(ev.target) || btn.contains(ev.target))) return;
        close();
      };
      const onEscape = (ev: KeyboardEvent): void => {
        if (ev.key !== "Escape") return;
        ev.stopPropagation(); // must NOT reach hotkeys.ts's Escape-hides-overlay listener
        close();
      };
      const onScroll = (): void => close(); // anchored position is stale once the container scrolls
      function close(): void {
        list.remove();
        document.removeEventListener("mousedown", onDocMousedown, true);
        window.removeEventListener("keydown", onEscape, true);
        scrollHost?.removeEventListener("scroll", onScroll);
        openDropdownClose = null;
      }
      // .settings-scroll only exists inside settingsPanel — other
      // containers (e.g. the tablet meta popup) have no independent scroll
      // region of their own, so this is a no-op there (nothing to attach).
      const scrollHost = container.querySelector(".settings-scroll");
      document.addEventListener("mousedown", onDocMousedown, true);
      window.addEventListener("keydown", onEscape, true);
      scrollHost?.addEventListener("scroll", onScroll);
      openDropdownClose = close;
    }

    btn.addEventListener("click", () => {
      if (openDropdownClose) openDropdownClose();
      else open();
    });

    return {
      get value(): string {
        return value;
      },
      set(newOptions: DropdownOption[], selected: string): void {
        options = newOptions;
        value = selected;
        applyLabel();
      },
    };
  }

  const mechDropdown = makeDropdown(metaMechSel, (v) => {
    selectedMech = v;
    renderMetaEditor(); // navigation only — nothing saved
  });
  const priorityDropdown = makeDropdown(metaPrioritySel, () => collectMechanicEdit());

  function renderMetaEditor(): void {
    const model = metaModel;
    if (!model) return;
    if (!model.mechanics.some((m) => m.name === selectedMech)) {
      selectedMech = model.mechanics[0]?.name ?? "";
    }
    mechDropdown.set(
      model.mechanics.map((m) => ({ value: m.name, label: m.name + (m.isOverridden ? " •" : "") })),
      selectedMech,
    );
    const mech = model.mechanics.find((m) => m.name === selectedMech);
    if (!mech) return;
    const statOptions = model.statOptions.map((s) => ({ value: s.key as string, label: s.label }));
    priorityDropdown.set(statOptions, mech.effective.priorityStat);
    metaSkipInput.value = String(mech.effective.skipIfBelow);
    metaSkipVal.textContent = String(mech.effective.skipIfBelow);
    metaTabletsEl.innerHTML = model.tablets
      .map(
        (t, i) => `<div class="set-row">
          <span class="set-lab set-lab-tablet">${t.name}${t.isCustom ? " (custom)" : ""}</span>
          <label class="set-switch"><input type="checkbox" data-meta-tablet-idx="${i}"${t.enabled ? " checked" : ""} /><span class="set-switch-track"></span></label>
        </div>`,
      )
      .join("");
    for (const input of metaTabletsEl.querySelectorAll<HTMLInputElement>("input[data-meta-tablet-idx]")) {
      input.addEventListener("change", () => {
        const tablet = model.tablets[Number(input.dataset.metaTabletIdx)];
        if (tablet) void metaAction((ed) => ed.setTabletEnabled(tablet.name, input.checked));
      });
    }
    if (model.fileCorrupt) {
      showMetaMsg("meta.json unreadable — the next change will rewrite it", { persistent: true });
    } else if (!metaMsg.classList.contains("err") || metaMsg.hidden) {
      metaMsg.hidden = true;
    }
  }

  /** Runs one editor action; on failure the last good model is re-rendered
   *  (reverting whatever the control optimistically showed). */
  async function metaAction(
    run: (ed: NonNullable<OverlayOptions["metaEditor"]>) => Promise<MetaEditorModel>,
  ): Promise<void> {
    if (!opts.metaEditor) return;
    setMetaControlsDisabled(true);
    try {
      metaModel = await run(opts.metaEditor);
      metaMsg.hidden = true; // a successful write clears any stale corrupt/error banner
      renderMetaEditor();
      tabletPopupRenderFields?.(); // a save from EITHER surface (Settings or the tablet popup) refreshes both
    } catch {
      showMetaMsg("Could not write meta.json");
      renderMetaEditor();
      tabletPopupRenderFields?.();
    } finally {
      setMetaControlsDisabled(false);
    }
  }

  function collectMechanicEdit(): void {
    const mech = metaModel?.mechanics.find((m) => m.name === selectedMech);
    if (!mech) return;
    // Secondary stats no longer have a UI (dead weight, KNOWN_ISSUES #3 —
    // scoring.ts stopped reading them) — carry the mechanic's current
    // value through unchanged instead of wiping any existing meta.json
    // override to [].
    void metaAction((ed) =>
      ed.saveMechanic(mech.name, {
        priorityStat: priorityDropdown.value as MechanicEdit["priorityStat"],
        secondaryStats: mech.effective.secondaryStats,
        skipIfBelow: Number(metaSkipInput.value),
      }),
    );
  }

  /** Full-mode-only, scoped-down twin of the Settings Méta editor: clicking
   *  a tablet row (see the click delegation on tabletsFullEl below) opens a
   *  small popup showing just THAT tablet's mechanic's 3 editable fields,
   *  saving through the exact same metaAction()/saveMechanic pipeline as
   *  Settings — meta.json persistence is identical, no new IO. Lives
   *  appended directly to `panel` (not `.bodies`) since it must survive a
   *  mode/Settings/Compare cross-fade only via the explicit close hooks
   *  below, not by being hidden along with a `.body` layer. */
  let openTabletMechanicPopup: string | null = null;
  let tabletPopupEl: HTMLElement | null = null;
  let tabletPopupCleanup: (() => void) | null = null;
  let tabletPopupRenderFields: (() => void) | null = null;

  function closeTabletPopup(): void {
    if (!tabletPopupEl) return;
    openDropdownClose?.(); // a dropdown opened inside the popup must not outlive it
    tabletPopupCleanup?.();
    tabletPopupEl.remove();
    tabletPopupEl = null;
    openTabletMechanicPopup = null;
    opts.onInteractiveChange?.();
  }

  function openTabletPopup(mechanicName: string, anchorRow: HTMLElement): void {
    if (openTabletMechanicPopup === mechanicName) {
      closeTabletPopup(); // re-clicking the same row toggles it shut
      return;
    }
    closeTabletPopup();
    if (!opts.metaEditor || !metaModel) return; // no IO, or meta.json not loaded yet — nothing to show
    const mech = metaModel.mechanics.find((m) => m.name === mechanicName);
    if (!mech) return;

    openTabletMechanicPopup = mechanicName;
    const el = document.createElement("div");
    el.className = "tablet-meta-popup";
    el.innerHTML = `
      <div class="tmp-head">
        <span class="tmp-title">${esc(mechanicName)}</span>
        <button type="button" class="tmp-close" data-tmp-close aria-label="Close">×</button>
      </div>
      <div class="set-row">
        <span class="set-lab">Priority stat</span>
        <button class="set-select" type="button" data-tmp-priority aria-haspopup="listbox" aria-label="Priority stat"></button>
      </div>
      <div class="set-row" title="Below this Juice Score, the mechanic isn't recommended">
        <span class="set-lab">Skip if score below</span>
        <span class="set-val" data-tmp-skip-val></span>
      </div>
      <input class="set-slider" type="range" min="0" max="100" step="1" data-tmp-skip aria-label="Skip threshold" />`;
    panel.appendChild(el);

    const priorityBtn = el.querySelector("[data-tmp-priority]") as HTMLButtonElement;
    const skipInput = el.querySelector("[data-tmp-skip]") as HTMLInputElement;
    const skipVal = el.querySelector("[data-tmp-skip-val]") as HTMLElement;
    const closeBtn = el.querySelector("[data-tmp-close]") as HTMLButtonElement;

    function collectPopupEdit(): void {
      const m = metaModel?.mechanics.find((x) => x.name === mechanicName);
      if (!m) return;
      // Secondary stats no longer have a UI (dead weight, KNOWN_ISSUES #3 —
      // scoring.ts stopped reading them) — carry the mechanic's current
      // value through unchanged instead of wiping any existing meta.json
      // override to [].
      void metaAction((ed) =>
        ed.saveMechanic(mechanicName, {
          priorityStat: tmpPriority.value as MechanicEdit["priorityStat"],
          secondaryStats: m.effective.secondaryStats,
          skipIfBelow: Number(skipInput.value),
        }),
      );
    }
    const tmpPriority = makeDropdown(priorityBtn, collectPopupEdit, el);

    function renderPopupFields(): void {
      const m = metaModel?.mechanics.find((x) => x.name === mechanicName);
      if (!m || !metaModel) return;
      const statOptions = metaModel.statOptions.map((s) => ({ value: s.key as string, label: s.label }));
      tmpPriority.set(statOptions, m.effective.priorityStat);
      skipInput.value = String(m.effective.skipIfBelow);
      skipVal.textContent = String(m.effective.skipIfBelow);
    }
    renderPopupFields();
    tabletPopupRenderFields = renderPopupFields;

    // Centered in the panel (not anchored to the clicked row) — the row it
    // came from is no longer relevant to where it sits, and centering keeps
    // it clear of the tablet list on every panel size. The `.tmp-head` drag
    // handle below lets the user move it off-center if it's in the way of
    // something else; it re-centers again on the next open (no persisted
    // position, matching the transient nature of this popup).
    const panelRect = panel.getBoundingClientRect();
    const width = 200;
    el.style.width = `${width}px`;
    const height = el.offsetHeight;
    el.style.left = `${Math.max(6, (panelRect.width - width) / 2)}px`;
    el.style.top = `${Math.max(6, (panelRect.height - height) / 2)}px`;

    // Drag by the header (title/empty space, not the close button) — a
    // plain DOM reposition clamped inside `panel`, no OS window move
    // involved (unlike the overlay's own opts.onDragStart drag).
    const head = el.querySelector(".tmp-head") as HTMLElement;
    let stopDrag: (() => void) | null = null;
    const onHeadMousedown = (ev: MouseEvent): void => {
      if ((ev.target as HTMLElement).closest("button")) return; // let the close button handle its own click
      ev.preventDefault();
      const startX = ev.clientX;
      const startY = ev.clientY;
      const startLeft = el.offsetLeft;
      const startTop = el.offsetTop;
      const onMove = (mv: MouseEvent): void => {
        const bounds = panel.getBoundingClientRect();
        const left = Math.min(Math.max(6, startLeft + (mv.clientX - startX)), bounds.width - el.offsetWidth - 6);
        const top = Math.min(Math.max(6, startTop + (mv.clientY - startY)), bounds.height - el.offsetHeight - 6);
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
      };
      const onUp = (): void => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        stopDrag = null;
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      stopDrag = onUp;
    };
    head.addEventListener("mousedown", onHeadMousedown);

    const onDocMousedown = (ev: MouseEvent): void => {
      if (ev.target instanceof Node && (el.contains(ev.target) || anchorRow.contains(ev.target))) return;
      closeTabletPopup();
    };
    const onEscape = (ev: KeyboardEvent): void => {
      if (ev.key !== "Escape") return;
      ev.stopPropagation(); // must NOT reach hotkeys.ts's Escape-hides-overlay listener
      closeTabletPopup();
    };
    document.addEventListener("mousedown", onDocMousedown, true);
    window.addEventListener("keydown", onEscape, true);
    closeBtn.addEventListener("click", () => closeTabletPopup());
    skipInput.addEventListener("input", () => (skipVal.textContent = skipInput.value));
    skipInput.addEventListener("change", collectPopupEdit);
    tabletPopupCleanup = () => {
      stopDrag?.();
      head.removeEventListener("mousedown", onHeadMousedown);
      document.removeEventListener("mousedown", onDocMousedown, true);
      window.removeEventListener("keydown", onEscape, true);
      tabletPopupRenderFields = null;
    };

    tabletPopupEl = el;
    opts.onInteractiveChange?.();
  }

  /** Hotkey remap (KNOWN_ISSUES #7). Click the binding → capture the next
   *  keydown (window-level, capture phase, so hotkeys.ts's Escape-to-hide
   *  bubble listener never sees the press) → hand it to opts.onSetHotkey
   *  (Rust validates, swaps registrations, persists). Note the *current*
   *  hotkey can't be captured — it's globally grabbed OS-side, so the
   *  webview never receives its keydown — but re-selecting the same key
   *  would be a no-op anyway. */
  let hotkeyBase = DEFAULT_HOTKEY_BASE;
  let capturingHotkey = false;
  let hotkeyMsgTimer: ReturnType<typeof setTimeout> | undefined;

  function applyHotkeyLabel(): void {
    const label = hotkeyLabel(hotkeyBase);
    hotkeyKbd.textContent = label;
    footKbd.textContent = label;
    toggleBtn.title = `Toggle Compact / Full (Shift+${label})`;
  }

  function setHotkeyLabel(base: string): void {
    hotkeyBase = base;
    if (!capturingHotkey) applyHotkeyLabel();
  }

  function setAutostartChecked(enabled: boolean): void {
    setAutostartInput.checked = enabled;
  }

  function setAppVersion(version: string): void {
    appVersionEl.textContent = `v${version}`;
  }

  // Version found by the last check (startup or manual) — while set, the
  // button installs instead of re-checking.
  let updateVersion: string | null = null;
  let updateMsgTimer: ReturnType<typeof setTimeout> | undefined;

  function showUpdateMsg(text: string, isError: boolean, transient: boolean): void {
    updateMsg.textContent = text;
    updateMsg.classList.toggle("err", isError);
    updateMsg.hidden = false;
    clearTimeout(updateMsgTimer);
    if (transient) updateMsgTimer = setTimeout(() => (updateMsg.hidden = true), 4000);
  }

  function setUpdateAvailable(version: string): void {
    updateVersion = version;
    updateMsg.hidden = true;
    updateBtn.textContent = `Install v${version}`;
    updateBtn.disabled = false;
  }

  function setSessionStats(view: SessionStatsView): void {
    statCountEl.textContent = String(view.count);
    statAvgEl.textContent = view.avg === null ? "—" : view.avg.toFixed(1);
    statBestEl.textContent = view.best === null ? "—" : `${view.best.name} (${Math.round(view.best.score)})`;
    statBestEl.title = view.best?.name ?? "";
  }

  function showHotkeyMsg(text: string, isError: boolean): void {
    hotkeyMsg.textContent = text;
    hotkeyMsg.classList.toggle("err", isError);
    hotkeyMsg.hidden = false;
    clearTimeout(hotkeyMsgTimer);
    hotkeyMsgTimer = setTimeout(() => (hotkeyMsg.hidden = true), 2500);
  }

  function stopHotkeyCapture(): void {
    if (!capturingHotkey) return;
    capturingHotkey = false;
    hotkeyBtn.classList.remove("capturing");
    applyHotkeyLabel();
    window.removeEventListener("keydown", onHotkeyCaptureKey, true);
  }

  function onHotkeyCaptureKey(e: KeyboardEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      stopHotkeyCapture();
      return;
    }
    const base = keyEventToBase(e);
    if (!base) return; // bare modifier — keep listening
    stopHotkeyCapture();
    opts
      .onSetHotkey!(base)
      .then((stored) => {
        hotkeyBase = stored;
        applyHotkeyLabel();
        showHotkeyMsg("Saved ✓", false);
      })
      .catch((err: unknown) => {
        showHotkeyMsg(err instanceof Error ? err.message : String(err), true);
      });
  }

  /** §12: side-by-side Juice Scores, best one starred + highlighted border,
   *  plus per-card pin/remove (#8). Renders over whichever body was active;
   *  `closeCompare()` reveals it again unchanged (compare doesn't touch
   *  `mode`/`effective`). */
  function showCompare(entries: CompareEntry[]): void {
    closeTabletPopup(); // like Settings, Compare can be invoked externally (hotkey) — don't leave the popup orphaned
    compareActive = true;
    overlayEl.classList.add("compare-active");
    const best = entries.reduce((a, b) => (b.result.heat.score > a.result.heat.score ? b : a), entries[0]!);
    q("[data-compare]").innerHTML = entries
      .map((e, i) => {
        const r = e.result;
        const isBest = e === best;
        return `
        <div class="cmp-card${isBest ? " best" : ""}${e.pinned ? " pinned" : ""}">
          <div class="cmp-ctl">
            <button class="cmp-btn cmp-pin" data-cmp-pin="${i}" type="button"
              title="${e.pinned ? "Unpin" : "Pin (survives new analyses, max 2)"}"
              aria-label="${e.pinned ? "Unpin this waystone" : "Pin this waystone"}">📌</button>
            <button class="cmp-btn cmp-remove" data-cmp-remove="${i}" type="button"
              title="Remove from comparison" aria-label="Remove this waystone from compare">×</button>
          </div>
          <div class="cmp-name" title="${esc(r.waystone.name)}">${esc(r.waystone.name)}${isBest ? " ★" : ""}</div>
          <div class="cmp-sub">T${r.waystone.tier} · ${esc(BADGE_LABEL[r.heat.tierClass])}</div>
          <div class="cmp-score">${r.heat.score.toFixed(1)}</div>
          <div class="cmp-verdict">${esc(r.heat.verdict)}</div>
        </div>`;
      })
      .join("");
  }

  function closeCompare(): void {
    compareActive = false;
    overlayEl.classList.remove("compare-active");
  }

  /** §2: click-through narrows to exactly these regions for the active layout. */
  function interactiveEls(): HTMLElement[] {
    // §2: header (toggle/settings/badge live inside it, plus its own
    // background is the drag handle) / footer / mod-scroll only. Without
    // drag support (plain-browser dev), fall back to the narrower
    // toggle/settings-only zone the header used to report — the badge is
    // only interactive there in dev builds anyway (mock-tier cycling).
    const els = opts.onDragStart ? [headEl] : [toggleBtn, settingsBtn, minimizeBtn];
    if (!opts.onDragStart && opts.onCycleTier) els.push(badge);
    if (settingsOpen) return [...els, settingsPanel]; // whole panel as one rect
    if (changelogOpen) return [...els, changelogPanel]; // scroll + Fermer button
    if (compareActive) return [...els, compareGrid]; // per-card pin/remove buttons (#8)
    // Same reasoning as settingsOpen above: the popup's own dropdowns can
    // overflow past its small box (makeDropdown's clamping), so the whole
    // panel is reported rather than trying to track that overflow.
    if (openTabletMechanicPopup) return [...els, panel];
    // tabletsEl: the Compact tablet list now scrolls internally (all 8
    // tablets, fixed-height card, 2026-07-12) — without reporting it here,
    // a mouse-wheel over it falls through to the game like everywhere
    // else outside the click-through whitelist, so the scroll never fires
    // in practice (reported: "le scroll ne marche pas" in-game).
    if (effective === "compact") els.push(footBtn, tabletsEl);
    // Either full-mode column can overflow-scroll on some DPI/font combos —
    // its scrollbar is unusable unless the column is inside the
    // click-through whitelist.
    if (effective === "full") els.push(colTablets, colInsights);
    return els;
  }

  footBtn.addEventListener("click", opts.onAnalyze);
  // Delegated: the cards are re-rendered on every showCompare, the grid isn't.
  compareGrid.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>("[data-cmp-pin],[data-cmp-remove]");
    if (!btn) return;
    if (btn.dataset.cmpPin !== undefined) opts.onComparePin?.(Number(btn.dataset.cmpPin));
    else opts.onCompareRemove?.(Number(btn.dataset.cmpRemove));
  });
  bindDangerListToggle(q("[data-insights]"));
  if (opts.onCycleTier) {
    const onCycleTier = opts.onCycleTier;
    badge.classList.add("dev-clickable");
    badge.title = "Cycle mock tier (dev)";
    badge.addEventListener("click", onCycleTier);
  }
  toggleBtn.addEventListener("click", opts.onToggleMode);
  settingsBtn.addEventListener("click", toggleSettings);
  minimizeBtn.addEventListener("click", opts.onHide);
  setModeBtn.addEventListener("click", opts.onToggleMode);
  setInsightsInput.addEventListener("change", () => {
    const show = setInsightsInput.checked;
    saveShowInsights(show);
    applyShowInsights(show);
  });
  setReduceInput.addEventListener("change", () => {
    saveReduceEffects(setReduceInput.checked);
    // opts.isReduced() reads the setting live (and ORs the OS media query),
    // so re-syncing the class is all it takes to apply immediately.
    syncReducedClass();
  });
  setCompressedInput.addEventListener("change", () => {
    const enabled = setCompressedInput.checked;
    saveCompactCompressed(enabled);
    overlayEl.classList.toggle("compact-compressed", enabled);
  });
  if (opts.onSetAutostart) {
    const onSetAutostart = opts.onSetAutostart;
    setAutostartInput.addEventListener("change", () => {
      const enabled = setAutostartInput.checked;
      // No localStorage mirror here (unlike every other toggle) — the
      // registry key IS the state. Revert on failure rather than showing
      // an "on" that didn't actually take (e.g. a permission hiccup).
      onSetAutostart(enabled).catch((err: unknown) => {
        setAutostartInput.checked = !enabled;
        void import("@tauri-apps/api/core").then(({ invoke }) =>
          invoke("log_frontend_report", {
            report: `[autostart] set(${enabled}) failed: ${err instanceof Error ? err.message : String(err)}`,
          }),
        ).catch(() => {});
      });
    });
  } else {
    setAutostartInput.disabled = true; // plain-browser dev: display-only
  }
  setOpacityInput.addEventListener("input", () => {
    const pct = Number(setOpacityInput.value);
    saveOpacity(pct);
    applyOpacity(pct);
  });
  setScaleInput.addEventListener("input", () => {
    const scale = Number(setScaleInput.value);
    saveScale(scale);
    applyScale(scale);
  });
  setHideBtn.addEventListener("click", opts.onHide);
  setResetPositionBtn.addEventListener("click", () => opts.onResetPosition?.());
  changelogShowBtn.addEventListener("click", toggleChangelog); // toggleChangelog closes Settings itself
  changelogCloseBtn.addEventListener("click", toggleChangelog);
  if (opts.onCheckUpdate && opts.onInstallUpdate) {
    const { onCheckUpdate, onInstallUpdate } = opts;
    updateBtn.addEventListener("click", () => {
      if (updateVersion) {
        // Install path — explicit user click, the only place an install
        // ever starts (in-game overlay: never auto-install).
        const version = updateVersion;
        updateBtn.disabled = true;
        showUpdateMsg("Downloading…", false, false);
        onInstallUpdate((pct) => {
          showUpdateMsg(pct === null ? "Downloading…" : `Downloading… ${pct}%`, false, false);
        }).catch(() => {
          // The pending update is still valid — restore the install button.
          showUpdateMsg("Update failed", true, true);
          setUpdateAvailable(version);
        });
        // Success needs no handler: the passive NSIS updater relaunches
        // the app, this whole DOM is torn down mid-install.
      } else {
        updateBtn.disabled = true;
        updateBtn.textContent = "Checking…";
        void onCheckUpdate().then((info) => {
          if (info) {
            setUpdateAvailable(info.version);
          } else {
            updateBtn.textContent = "Check for updates";
            updateBtn.disabled = false;
            showUpdateMsg("Up to date", false, true);
          }
        });
      }
    });
  } else {
    updateBtn.disabled = true; // plain-browser dev: display-only
  }
  statResetBtn.addEventListener("click", () => opts.onResetStats?.());
  if (opts.metaEditor) {
    // The four dropdown buttons wire themselves in makeDropdown — only the
    // slider and reset button need listeners here.
    // Live value while dragging, one write on release.
    metaSkipInput.addEventListener("input", () => (metaSkipVal.textContent = metaSkipInput.value));
    metaSkipInput.addEventListener("change", collectMechanicEdit);
    metaResetBtn.addEventListener("click", () => void metaAction((ed) => ed.reset()));
    // Full-mode-only click-to-edit: delegated (rows are rebuilt on every
    // setResult, the container isn't). Gated on opts.metaEditor like the
    // rest of the Méta section — nothing to edit without IO.
    tabletsFullEl.addEventListener("click", (ev) => {
      const row = (ev.target as HTMLElement).closest<HTMLElement>(".trow[data-mechanic]");
      if (!row) return;
      const mechanic = row.dataset.mechanic;
      if (mechanic) openTabletPopup(mechanic, row);
    });
    void loadMetaEditor(); // loaded once eagerly so a tablet click doesn't need its own fetch/loading state
  } else {
    metaSection.remove(); // plain-browser dev — no Tauri fs to edit
  }
  if (opts.onDragStart) {
    const onDragStart = opts.onDragStart;
    headEl.addEventListener("mousedown", (ev) => {
      // Let the toggle/settings/minimize buttons handle their own click —
      // only the header's background (and the tier badge, which is only
      // clickable in dev via onCycleTier) starts a drag. In production the
      // badge is an inert <button> and must not swallow the drag gesture.
      const btn = (ev.target as HTMLElement).closest("button");
      if (btn && (btn !== badge || opts.onCycleTier)) return;
      onDragStart();
    });
  }
  if (opts.onSetHotkey) {
    hotkeyBtn.addEventListener("click", () => {
      if (capturingHotkey) {
        stopHotkeyCapture(); // second click = cancel
        return;
      }
      capturingHotkey = true;
      hotkeyBtn.classList.add("capturing");
      hotkeyKbd.textContent = "…";
      window.addEventListener("keydown", onHotkeyCaptureKey, true);
    });
  } else {
    hotkeyBtn.disabled = true; // plain-browser dev: display-only, like before
  }

  setMode(opts.mode); // applied before first paint — no mode flash (§9)
  syncReducedClass();
  overlayEl.classList.toggle("compact-compressed", opts.compactCompressed());
  applyShowInsights(loadShowInsights());
  // Switch states reflect the persisted user settings — for Reduce Effects
  // that's deliberately the setting alone, not opts.isReduced(), which also
  // ORs the OS prefers-reduced-motion query the user can't toggle here.
  setReduceInput.checked = loadReduceEffects();
  setCompressedInput.checked = loadCompactCompressed();
  applyOpacity(loadOpacity());
  applyScale(loadScale());
  applyHotkeyLabel();
  renderChangelog(); // static content (bundled CHANGELOG.md) — once is enough
  setResult(initial);
  return {
    setResult,
    setMode,
    analyze,
    showAnalyzeError,
    showCompare,
    closeCompare,
    setHotkeyLabel,
    setAutostartChecked,
    setAppVersion,
    setUpdateAvailable,
    showChangelog,
    setSessionStats,
    panelEl: panel,
    interactiveEls,
  };
}
