import type { AnalysisResult, TierClass } from "../types";
import type { Mode, EffectiveMode } from "../settings";
import {
  loadShowInsights,
  saveShowInsights,
  loadOpacity,
  saveOpacity,
  loadScale,
  saveScale,
} from "../overlaySettings";

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
}

export interface OverlayHandle {
  setResult(result: AnalysisResult): void;
  setMode(mode: EffectiveMode): void;
  analyze(): void;
  /** §12 Compare mode: renders up to 3 waystones side by side, highlighting
   *  the best Juice Score. Overlays on top of whichever Compact/Full/Mini
   *  body was active; `closeCompare()` restores it. */
  showCompare(results: AnalysisResult[]): void;
  closeCompare(): void;
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

const RANKS = ["I", "II", "III", "IV"];

/** §5: expected max single breakdown contribution; bar width = |value| / BR_MAX. */
const BR_MAX = 35;

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

/** §5: numeric magnitudes in mod prose render bold ivory. Input must be escaped. */
function boldNumerics(escaped: string): string {
  return escaped.replace(/([+\-−]?\d+(?:\.\d+)?%?)/g, "<b>$1</b>");
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
        <div class="p-head">
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
              <div class="sec-h">Top Tablets</div>
              <div data-tablets></div>
            </div>
            <div class="warn-strip" data-warn hidden><span class="w-ic">⚠</span><span data-warntext></span></div>
            <button class="p-foot" data-foot><kbd>Ins</kbd> Analyze Waystone</button>
          </div>
          <div class="body body-full">
            <div class="cols">
              <div class="col">
                <div class="sec-h">Detected Modifiers</div>
                <div class="mods" data-mods></div>
              </div>
              <div class="col">
                <div class="sec-h">Heat Breakdown</div>
                <div class="score-row">
                  <span class="score-wrap" data-hero-full><span class="halo"></span><span class="score-num" data-score-full></span></span>
                  <span class="badge badge-sm" data-minibadge></span>
                </div>
                <div data-breakdown></div>
                <div class="total-row"><span class="t-lab">Total Heat</span><span class="t-right"><span class="t-val" data-total></span><span class="rating-pill" data-rating-full></span></span></div>
              </div>
              <div class="col" data-col3>
                <div class="sec-h">Top Tablets</div>
                <div data-tablets-full></div>
                <div class="col3-sep"></div>
                <div class="sec-h">Mechanic Match</div>
                <div data-mechanics></div>
                <div class="col3-sep"></div>
                <div class="insights-block" data-insights-block>
                  <div class="sec-h">Insights</div>
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
              <div class="set-row">
                <span class="set-lab">Hotkey</span>
                <span class="set-hotkey"><kbd>Ins</kbd></span>
                <button class="set-btn set-btn-sm" data-set-hotkey type="button" disabled title="Custom hotkeys coming soon">Change</button>
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
  const scores = [q("[data-score]"), q("[data-score-full]")];
  const chip = q("[data-action]");
  const warn = q("[data-warn]");
  const toggleBtn = q("[data-toggle]");
  const footBtn = q("[data-foot]");
  const mods = q("[data-mods]");
  const col3 = q("[data-col3]");
  const settingsBtn = q("[data-settings]");
  const settingsPanel = q("[data-settings-panel]");
  const setModeBtn = q("[data-set-mode]") as HTMLButtonElement;
  const setInsightsInput = q("[data-set-insights]") as HTMLInputElement;
  const setOpacityInput = q("[data-set-opacity]") as HTMLInputElement;
  const setOpacityVal = q("[data-set-opacity-val]");
  const setScaleInput = q("[data-set-scale]") as HTMLInputElement;
  const setScaleVal = q("[data-set-scale-val]");
  const setHideBtn = q("[data-set-hide]");

  let current = initial;
  let effective: EffectiveMode = opts.mode;
  let compareActive = false;
  let settingsOpen = false;

  function setResult(result: AnalysisResult): void {
    current = result;
    const { heat, waystone } = result;
    for (const t of TIER_CLASSES) panel.classList.toggle(`tier-${t}`, t === heat.tierClass);

    badge.textContent = BADGE_LABEL[heat.tierClass];
    miniBadge.textContent = BADGE_LABEL[heat.tierClass];
    miniScore.textContent = heat.score.toFixed(1);
    if (result.warning) {
      miniWarn.hidden = false;
      miniWarn.title = result.warning;
    } else {
      miniWarn.hidden = true;
      miniWarn.title = "";
    }
    for (const s of scores) s.textContent = heat.score.toFixed(1);
    q("[data-total]").textContent = heat.score.toFixed(1);
    q("[data-sub]").textContent = `T${waystone.tier} · ${waystone.name}`;
    q("[data-tiername]").textContent = heat.tierLabel;
    chip.textContent = heat.verdict;
    for (const el of [q("[data-rating]"), q("[data-rating-full]")]) {
      el.textContent = heat.rating;
      el.className = `rating-pill rec-rating-${heat.rating}`;
      el.title = `Rating: ${heat.rating} (${heat.score.toFixed(1)})`;
    }

    // Only the top-ranked tablet's rewards are shown (§9 stays a single
    // recommendation, not a rewards table) — rendered as one compact line
    // under its row, nothing added when it has none.
    const rewardsLine = (t: AnalysisResult["tablets"][number]) =>
      t.rewards && t.rewards.length > 0
        ? `<div class="tab-rewards">${t.rewards
            .map((r) => `<span class="rw-ic">◆</span> ${esc(r.label)} <b>${fmtDelta(r.value)}</b>`)
            .join("")}</div>`
        : "";
    const tabletRow = (t: AnalysisResult["tablets"][number], i: number, reasoned: boolean) => {
      const line = `
        <span class="rec-rank">${RANKS[i]}</span>
        <span class="rec-name">${esc(t.name)}</span>
        <span class="rec-rating rec-rating-${t.rating}">${t.rating}</span>
        <span class="rec-delta">${fmtDelta(t.delta)}</span>`;
      const rewards = i === 0 ? rewardsLine(t) : "";
      if (reasoned) {
        return `<div class="tab-row"><div class="tab-line">${line}</div><div class="tab-reason">${esc(t.reason)}</div>${rewards}</div>`;
      }
      return rewards ? `<div class="rec-wrap"><div class="rec-row">${line}</div>${rewards}</div>` : `<div class="rec-row">${line}</div>`;
    };
    q("[data-tablets]").innerHTML = result.tablets
      .slice(0, 3)
      .map((t, i) => tabletRow(t, i, true))
      .join("");
    // Trimmed from 4 to 3 (2026-07-04, matches Compact's existing cap):
    // frees the vertical room the new rec-rating column and top tablet's
    // tab-rewards line need to avoid clipping the warning row below in
    // column 3's fixed, non-scrolling height budget.
    q("[data-tablets-full]").innerHTML = result.tablets
      .slice(0, 3)
      .map((t, i) => tabletRow(t, i, false))
      .join("");

    q("[data-mods]").innerHTML = result.modifiers
      .map((m) => {
        const icon = m.kind === "danger" ? "⚠" : m.kind === "positive" ? "▴" : "·";
        const text = m.kind === "danger" ? esc(m.text) : boldNumerics(esc(m.text));
        return `<div class="mod ${m.kind === "positive" ? "" : m.kind}"><span class="m-ic">${icon}</span><span>${text}</span></div>`;
      })
      .join("");

    q("[data-mechanics]").innerHTML = result.mechanicScores
      .slice(0, 4)
      .map(
        (m) => `
        <div class="brow${m.mechanic === result.recommendedMechanic ? " best" : ""}">
          <span class="b-lab">${esc(m.mechanic)}${m.mechanic === result.recommendedMechanic ? " ★" : ""}</span>
          <div class="bar"><i style="width:${Math.min(m.score, 100)}%"></i></div>
          <span class="b-val">${m.score}</span>
        </div>`,
      )
      .join("");

    q("[data-breakdown]").innerHTML = heat.breakdown
      .map(
        (b) => `
        <div class="brow${b.value < 0 ? " neg" : ""}">
          <span class="b-lab">${esc(b.label)}</span>
          <div class="bar"><i></i></div>
          <span class="b-val">${fmtDelta(b.value)}</span>
        </div>`,
      )
      .join("");
    animateBars();

    // Key factors + insights share one row, folded together rather than a
    // new titled section (see docs/implementation-plan.md) — but the
    // original contract only ever budgeted ≤3 insight rows for this
    // column's fixed height (docs/overlay-ui-spec.md), and keyFactors is a
    // net-new source of rows on top of that, plus the new tab-rewards line
    // under the top tablet. Capping the *combined* total at 2 (warning
    // stays separate/always-shown, as before) — measured against a live
    // render (Playwright) to fit the fixed 580×332 panel with both new
    // features present, instead of silently overflowing it.
    const factorRows = result.keyFactors.map(
      (line) => `<div class="ins-row factor"><span class="i-ic">+</span><span>${esc(line)}</span></div>`,
    );
    const insightRows = result.insights.map((line) => {
      const { icon, cls } = categorizeInsight(line);
      return `<div class="ins-row${cls ? ` ${cls}` : ""}"><span class="i-ic">${icon}</span><span>${esc(line)}</span></div>`;
    });
    q("[data-insights]").innerHTML = [
      ...(result.warning
        ? [`<div class="ins-row danger"><span class="i-ic">⚠</span><span>${esc(result.warning)}</span></div>`]
        : []),
      ...[...factorRows, ...insightRows].slice(0, 2),
    ].join("");

    if (result.warning) {
      warn.hidden = false;
      q("[data-warntext]").textContent = result.warning;
    } else {
      warn.hidden = true;
    }
  }

  function animateBars(): void {
    const rows = panel.querySelectorAll<HTMLElement>("[data-breakdown] .brow");
    rows.forEach((row, i) => {
      const fill = row.querySelector(".bar i") as HTMLElement;
      const value = current.heat.breakdown[i]?.value ?? 0;
      const width = `${Math.min((Math.abs(value) / BR_MAX) * 100, 100)}%`;
      if (opts.isReduced()) {
        fill.style.width = width; // §10: bars set instantly
        return;
      }
      fill.style.width = "0";
      requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = width)));
    });
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
    for (const s of scores) retrigger(s, "pulse");
    retrigger(badge, "flare");
    retrigger(miniBadge, "flare");
    retrigger(chip, "flare");
    if (!warn.hidden) retrigger(warn, "reveal"); // §7 warning reveal
    if (!miniWarn.hidden) retrigger(miniWarn, "reveal");
    animateBars();
    if (current.heat.tierClass === "god") spawnSparks();
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
    if (m === "full") animateBars(); // §7 bar sweep also triggers on entering Full
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
    if (settingsOpen && compareActive) closeCompare();
    overlayEl.classList.toggle("settings-open", settingsOpen);
    settingsBtn.classList.toggle("active", settingsOpen);
    opts.onInteractiveChange?.();
  }

  /** §12: side-by-side Juice Scores, best one starred + highlighted border.
   *  Renders over whichever body was active; `closeCompare()` reveals it
   *  again unchanged (compare doesn't touch `mode`/`effective`). */
  function showCompare(results: AnalysisResult[]): void {
    compareActive = true;
    overlayEl.classList.add("compare-active");
    const best = results.reduce((a, b) => (b.heat.score > a.heat.score ? b : a), results[0]!);
    q("[data-compare]").innerHTML = results
      .map((r) => {
        const isBest = r === best;
        return `
        <div class="cmp-card${isBest ? " best" : ""}">
          <div class="cmp-name">${esc(r.waystone.name)}${isBest ? " ★" : ""}</div>
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
    // §2: toggle / settings / footer / mod-scroll only. The badge is only
    // interactive in dev builds (mock-tier cycling) — see below.
    const els = [toggleBtn, settingsBtn];
    if (opts.onCycleTier) els.push(badge);
    if (settingsOpen) return [...els, settingsPanel]; // whole panel as one rect
    if (compareActive) return els; // compare body has no other interactive controls
    if (effective === "compact") els.push(footBtn);
    // col3 can overflow-scroll on some DPI/font combos — its scrollbar is
    // unusable unless the column is inside the click-through whitelist,
    // same rationale as the mods column.
    if (effective === "full") els.push(mods, col3);
    return els;
  }

  footBtn.addEventListener("click", opts.onAnalyze);
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

  setMode(opts.mode); // applied before first paint — no mode flash (§9)
  syncReducedClass();
  overlayEl.classList.toggle("compact-compressed", opts.compactCompressed());
  applyShowInsights(loadShowInsights());
  applyOpacity(loadOpacity());
  applyScale(loadScale());
  setResult(initial);
  return { setResult, setMode, analyze, showCompare, closeCompare, panelEl: panel, interactiveEls };
}
