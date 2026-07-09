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

// Disabled 2026-07-10 pending the tablet-scoring rework (KNOWN_ISSUES.md):
// the Heat Breakdown column's composite score/rating was found misleading
// mid-rework (a real waystone showed a "35" Abyss fit next to a huge
// Monster Rarity roll purely from a since-fixed formula bug) — the user
// asked to stop DISPLAYING a score there temporarily without removing any
// markup, so it's a straightforward re-enable once the rework has been
// validated against more real waystones. The per-stat % rows
// (data-breakdown) are untouched — those just mirror the item's own
// tooltip and were never in question. Flip back to `true` to restore.
const HEAT_SCORE_VISIBLE = false;

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
  /** Drag-to-reposition (placement.ts's startWindowDrag) — fired
   *  synchronously from the header's mousedown, see that function's doc
   *  for why. Omitted = unavailable (plain-browser dev). */
  onDragStart?(): void;
  /** Settings' "Réinitialiser" position button — clears the saved custom
   *  position and re-anchors top-right. */
  onResetPosition?(): void;
  /** Settings' session-stats "Réinitialiser" button — clears the persisted
   *  stats to start a fresh farming session (main.ts owns the storage and
   *  calls setSessionStats back with the emptied view). */
  onResetStats?(): void;
  /** Settings' Méta editor (meta.json). main.ts owns all IO: every action
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
  trash: "FAIBLE",
  low: "MOYEN",
  good: "BON",
  splus: "EXCELLENT",
  god: "LEGENDAIRE ✦",
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

// 2026-07-10 (user request): the row shows this label instead of the raw
// fit number/bar — mirrors the SKIP/RUN/GARDER wording already used for
// the waystone-level verdict. Keyed by `Tablet.verdict` (adapter.ts's
// `tabletVerdict`); the exact number/breakdown is still one hover away.
const TABLET_VERDICT_LABEL: Record<AnalysisResult["tablets"][number]["verdict"], string> = {
  run: "RUN",
  "why-not": "WHY NOT",
  "dont-run": "DON'T RUN",
};

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
        <div class="p-head" data-head title="Glisser pour déplacer l'overlay">
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
              <div class="sec-h">Tablettes Recommandées</div>
              <div data-tablets></div>
            </div>
            <div class="warn-strip" data-warn hidden><span class="w-ic">⚠</span><span data-warntext></span><span class="w-level" data-warnlevel></span></div>
            <button class="p-foot" data-foot><kbd data-foot-kbd>Ins</kbd> Analyze Waystone</button>
          </div>
          <div class="body body-full">
            <div class="cols">
              <div class="col" data-col-tablets>
                <div class="sec-h">Tablettes Recommandées</div>
                <div data-tablets-full></div>
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
              <div class="sec-h">Settings</div>
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
              <div class="set-row" title="Lance l'overlay automatiquement à l'ouverture de session Windows (reste discret : cliquez-à-travers, se cache normalement)">
                <span class="set-lab">Lancement avec Windows</span>
                <label class="set-switch">
                  <input type="checkbox" data-set-autostart />
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
              <div class="set-row" title="Cliquez puis appuyez sur la nouvelle touche (Échap annule). Shift+touche bascule Compact/Full, Ctrl+touche ouvre Compare.">
                <span class="set-lab">Hotkey</span>
                <span class="set-val set-hotkey-msg" data-hotkey-msg hidden></span>
                <button class="set-hotkey" data-set-hotkey type="button" aria-label="Remap the analyze hotkey"><kbd data-hotkey-kbd>Ins</kbd></button>
              </div>
              <div class="set-row" title="Glissez la barre de titre pour déplacer l'overlay ailleurs à l'écran — ce bouton annule et revient au coin haut-droit par défaut">
                <span class="set-lab">Position</span>
                <button class="set-btn" data-set-reset-position type="button">Réinitialiser</button>
              </div>
              <div class="set-sep"></div>
              <div class="sec-h" title="Depuis le dernier Réinitialiser — chaque waystone compte une fois (la re-analyser met à jour son score)">Session</div>
              <div class="set-row">
                <span class="set-lab">Waystones analysées</span>
                <span class="set-val" data-stat-count>0</span>
              </div>
              <div class="set-row">
                <span class="set-lab">Score moyen</span>
                <span class="set-val" data-stat-avg>—</span>
              </div>
              <div class="set-row">
                <span class="set-lab">Meilleure trouvaille</span>
                <span class="set-val set-stat-best" data-stat-best>—</span>
              </div>
              <div class="set-row" title="Remet les stats de session à zéro pour démarrer une nouvelle session de farm">
                <span class="set-lab">Stats</span>
                <button class="set-btn" data-stat-reset type="button">Réinitialiser</button>
              </div>
              <div class="set-group" data-meta-section>
                <div class="set-sep"></div>
                <div class="sec-h" title="Personnalise les recommandations par mécanique (meta.json). Seules les valeurs différentes des défauts sont écrites dans le fichier.">Méta</div>
                <span class="set-val set-meta-msg" data-meta-msg hidden></span>
                <div class="set-row">
                  <span class="set-lab">Mécanique</span>
                  <button class="set-select" type="button" data-meta-mech aria-haspopup="listbox" aria-label="Mécanique à personnaliser"></button>
                </div>
                <div class="set-row">
                  <span class="set-lab">Stat prioritaire</span>
                  <button class="set-select" type="button" data-meta-priority aria-haspopup="listbox" aria-label="Stat prioritaire"></button>
                </div>
                <div class="set-row">
                  <span class="set-lab">Secondaire 1</span>
                  <button class="set-select" type="button" data-meta-sec1 aria-haspopup="listbox" aria-label="Première stat secondaire"></button>
                </div>
                <div class="set-row">
                  <span class="set-lab">Secondaire 2</span>
                  <button class="set-select" type="button" data-meta-sec2 aria-haspopup="listbox" aria-label="Seconde stat secondaire"></button>
                </div>
                <div class="set-row set-col" title="Sous ce Juice Score, la mécanique n'est pas recommandée">
                  <div class="set-row">
                    <span class="set-lab">Skip si score sous</span>
                    <span class="set-val" data-meta-skip-val></span>
                  </div>
                  <input class="set-slider" type="range" min="0" max="100" step="1" data-meta-skip aria-label="Seuil de skip" />
                </div>
                <div class="set-group" data-meta-tablets></div>
                <div class="set-row" title="Réécrit meta.json vide : toutes les mécaniques et tablettes reviennent aux défauts du code">
                  <span class="set-lab">Méta</span>
                  <button class="set-btn" data-meta-reset type="button">Rétablir les défauts</button>
                </div>
              </div>
              <div class="set-sep"></div>
              <div class="set-row">
                <span class="set-lab">Hide Overlay</span>
                <button class="set-btn" data-set-hide type="button" title="Sends the overlay to the system tray. Right-click the tray icon to quit for good.">Hide</button>
              </div>
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
  const compareGrid = q("[data-compare]");
  const settingsBtn = q("[data-settings]");
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
  const statCountEl = q("[data-stat-count]");
  const statAvgEl = q("[data-stat-avg]");
  const statBestEl = q("[data-stat-best]");
  const statResetBtn = q("[data-stat-reset]");
  const metaSection = q("[data-meta-section]");
  const metaMechSel = q("[data-meta-mech]") as HTMLButtonElement;
  const metaPrioritySel = q("[data-meta-priority]") as HTMLButtonElement;
  const metaSec1Sel = q("[data-meta-sec1]") as HTMLButtonElement;
  const metaSec2Sel = q("[data-meta-sec2]") as HTMLButtonElement;
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

    // Heat Breakdown's composite score/rating (Full mode only) is
    // temporarily off — see HEAT_SCORE_VISIBLE's doc comment. The per-stat
    // % rows below are unaffected.
    if (HEAT_SCORE_VISIBLE) {
      miniBadge.textContent = BADGE_LABEL[heat.tierClass];
      scoreFull.textContent = heat.score.toFixed(1);
      q("[data-total]").textContent = heat.score.toFixed(1);
      const ratingFullEl = q("[data-rating-full]");
      ratingFullEl.textContent = heat.rating;
      ratingFullEl.className = `rating-pill rec-rating-${heat.rating}`;
      ratingFullEl.title = `Rating: ${heat.rating} (${heat.score.toFixed(1)})`;
    } else {
      miniBadge.textContent = "—";
      scoreFull.textContent = "—";
      q("[data-total]").textContent = "—";
      const ratingFullEl = q("[data-rating-full]");
      ratingFullEl.textContent = "";
      ratingFullEl.className = "rating-pill";
      ratingFullEl.title = "";
    }

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
      return `
        <div class="trow" title="${esc(title)}">
          <span class="t-ic">${icon}</span>
          <span class="t-name" title="${esc(t.name)}">${esc(shortName)}</span>
          <span class="t-verdict t-verdict-${t.verdict}">${TABLET_VERDICT_LABEL[t.verdict]}</span>
        </div>`;
    };
    // Compact keeps a top-5 cutoff (fixed-height card, no scroll budget) —
    // Full shows every active tablet (2026-07-10, user request), its
    // column already scrolls on overflow (`.col`, full.css).
    q("[data-tablets]").innerHTML = result.tablets.slice(0, 5).map(tabletRow).join("");
    q("[data-tablets-full]").innerHTML = result.tablets.map(tabletRow).join("");

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
    // new titled section (see docs/implementation-plan.md) — but the
    // original contract only ever budgeted ≤3 insight rows for this
    // column's fixed height (docs/overlay-ui-spec.md), and keyFactors is a
    // net-new source of rows on top of that, plus the new tab-rewards line
    // under the top tablet. The danger list (severity-grouped, DangerList.ts)
    // comes first and always shows in full; factors/insights fill whatever's
    // left, capped at 1. The column overflow-scrolls if a mod-heavy map
    // still exceeds the fixed 580×332 panel's height budget.
    const factorRows = result.keyFactors.map(
      (line) => `<div class="ins-row factor"><span class="i-ic">+</span><span>${esc(line)}</span></div>`,
    );
    const insightRows = result.insights.map((line) => {
      const { icon, cls } = categorizeInsight(line);
      return `<div class="ins-row${cls ? ` ${cls}` : ""}"><span class="i-ic">${icon}</span><span>${esc(line)}</span></div>`;
    });
    q("[data-insights]").innerHTML = [
      renderDangerList(result.dangerHits),
      ...[...factorRows, ...insightRows].slice(0, 1),
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
    clipboard: { icon: "⚠", text: "Copie impossible — presse-papiers vide", cls: "status-err" },
    "not-waystone": { icon: "◆", text: "Pas une Waystone", cls: "status-info" },
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
    if (settingsOpen) void loadMetaEditor(); // fresh model on every open — a hand-edit of the file mid-session shows up
    overlayEl.classList.toggle("settings-open", settingsOpen);
    settingsBtn.classList.toggle("active", settingsOpen);
    opts.onInteractiveChange?.();
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
    for (const el of [metaMechSel, metaPrioritySel, metaSec1Sel, metaSec2Sel, metaSkipInput, metaResetBtn]) {
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
      showMetaMsg("Lecture de meta.json impossible");
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

  function makeDropdown(btn: HTMLButtonElement, onPick: (value: string) => void) {
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
      settingsPanel.appendChild(list);
      // Clamp inside the panel: below the button if it fits, above otherwise —
      // the panel IS the reported click-through rect, so staying inside it is
      // what keeps every option clickable (and the click-away poll quiet).
      const panelRect = settingsPanel.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const height = Math.min(list.scrollHeight, 180);
      let top = btnRect.bottom - panelRect.top + 3;
      if (top + height > panelRect.height - 6) {
        top = Math.max(6, btnRect.top - panelRect.top - height - 3);
      }
      list.style.top = `${top}px`;
      list.style.right = `${Math.max(6, panelRect.right - btnRect.right)}px`;
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
      const onScroll = (): void => close(); // anchored position is stale once the panel scrolls
      function close(): void {
        list.remove();
        document.removeEventListener("mousedown", onDocMousedown, true);
        window.removeEventListener("keydown", onEscape, true);
        scrollHost?.removeEventListener("scroll", onScroll);
        openDropdownClose = null;
      }
      const scrollHost = settingsPanel.querySelector(".settings-scroll");
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
  const sec1Dropdown = makeDropdown(metaSec1Sel, () => collectMechanicEdit());
  const sec2Dropdown = makeDropdown(metaSec2Sel, () => collectMechanicEdit());

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
    const withNone = [{ value: "", label: "—" }, ...statOptions];
    priorityDropdown.set(statOptions, mech.effective.priorityStat);
    sec1Dropdown.set(withNone, mech.effective.secondaryStats[0] ?? "");
    sec2Dropdown.set(withNone, mech.effective.secondaryStats[1] ?? "");
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
      showMetaMsg("meta.json illisible — le prochain changement le réécrira", { persistent: true });
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
    } catch {
      showMetaMsg("Écriture de meta.json impossible");
      renderMetaEditor();
    } finally {
      setMetaControlsDisabled(false);
    }
  }

  function collectMechanicEdit(): void {
    const mech = metaModel?.mechanics.find((m) => m.name === selectedMech);
    if (!mech) return;
    const secondaryStats = [sec1Dropdown.value, sec2Dropdown.value].filter((v) => v !== "");
    void metaAction((ed) =>
      ed.saveMechanic(mech.name, {
        priorityStat: priorityDropdown.value as MechanicEdit["priorityStat"],
        secondaryStats: secondaryStats as MechanicEdit["secondaryStats"],
        skipIfBelow: Number(metaSkipInput.value),
      }),
    );
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
        showHotkeyMsg("Enregistré ✓", false);
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
              title="${e.pinned ? "Désépingler" : "Épingler (survit aux nouvelles analyses, 2 max)"}"
              aria-label="${e.pinned ? "Unpin this waystone" : "Pin this waystone"}">📌</button>
            <button class="cmp-btn cmp-remove" data-cmp-remove="${i}" type="button"
              title="Retirer de la comparaison" aria-label="Remove this waystone from compare">×</button>
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
    const els = opts.onDragStart ? [headEl] : [toggleBtn, settingsBtn];
    if (!opts.onDragStart && opts.onCycleTier) els.push(badge);
    if (settingsOpen) return [...els, settingsPanel]; // whole panel as one rect
    if (compareActive) return [...els, compareGrid]; // per-card pin/remove buttons (#8)
    if (effective === "compact") els.push(footBtn);
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
  statResetBtn.addEventListener("click", () => opts.onResetStats?.());
  if (opts.metaEditor) {
    // The four dropdown buttons wire themselves in makeDropdown — only the
    // slider and reset button need listeners here.
    // Live value while dragging, one write on release.
    metaSkipInput.addEventListener("input", () => (metaSkipVal.textContent = metaSkipInput.value));
    metaSkipInput.addEventListener("change", collectMechanicEdit);
    metaResetBtn.addEventListener("click", () => void metaAction((ed) => ed.reset()));
  } else {
    metaSection.remove(); // plain-browser dev — no Tauri fs to edit
  }
  if (opts.onDragStart) {
    const onDragStart = opts.onDragStart;
    headEl.addEventListener("mousedown", (ev) => {
      // Let the badge/toggle/settings buttons handle their own click —
      // only the header's background starts a drag.
      if ((ev.target as HTMLElement).closest("button")) return;
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
    setSessionStats,
    panelEl: panel,
    interactiveEls,
  };
}
