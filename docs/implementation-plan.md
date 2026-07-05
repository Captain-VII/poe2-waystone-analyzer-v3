# Implementation Plan — Waystone Overlay

Source of truth: [overlay-ui-spec.md](overlay-ui-spec.md) (locked).
Tracked as milestone checklists; tick items only when verified against the spec's
acceptance checklist (§13).

**Slice 1 (smallest shippable)**: Tauri shell + Compact card rendered from mocked
`AnalysisResult`. No analyzer integration. Items in scope are tagged `[S1]`.

---

## M1 — Project shell (Tauri)

- [x] `[S1]` Tauri 2 + Vite (vanilla TS) scaffold; `npm run tauri dev` boots
- [x] `[S1]` Transparent, frameless, always-on-top, skip-taskbar overlay window
- [x] `[S1]` Non-focusable (`focus:false`) — game keeps input focus
      (config-level `focusable` deferred; verify no focus steal during M4 hotkey work)
- [x] `[S1]` Click-through by default; *interim*: Rust cursor-poll re-enables input
      while the cursor is over the panel bounds (spec-final region-level hit-testing
      — toggle / footer / mod-scroll only — lands in M4)
- [x] `[S1]` DPI-aware top-right placement: logical coords, 20px pad (14px < 1600×900)
- [x] Re-run placement on display/DPI/resolution change events — 2026-07-04:
      `watchDisplayChanges()` (`src/placement.ts`) combines Tauri's native
      `onScaleChanged`/`onMoved`/`onResized` window events (fire promptly,
      but don't cover every OS display-reconfiguration case on their own)
      with a 3s poll comparing a monitor snapshot (position/size/scale) as a
      robust fallback for whatever those miss. On any real change it re-runs
      the same pipeline as a manual mode toggle: `placeTopRight()` →
      `computeEffectiveMode()`/`setMode()` (so the Full→Compact→Mini cascade
      and intended-mode restore apply to the *new* space, not the old one) →
      `reportInteractiveRegions()` (both immediately and again 260ms later,
      once any resulting mode-morph settles). Guards against two footguns:
      a `repositioning` flag so `placeTopRight()`'s own `setPosition()` call
      doesn't make the `onMoved` listener mistake our own move for an
      external change (infinite-loop risk), and a `handlingDisplayChange`
      flag coalescing bursts of change events into one pass. `placeTopRight()`
      also now clamps its computed position to the monitor bounds (§2 "no
      edge may ever leave the screen"), not just relying on the pad math
      alone. Verified live: window built and booted with zero errors through
      a `display-watch-attached` report checkpoint added specifically to
      catch permission-denial rejections (which are async — added an
      `unhandledrejection` listener to `diagnostics.ts` alongside the
      existing synchronous `error` listener, since the old capture would
      have missed exactly this failure mode). No capability/ACL changes were
      needed — these window events fall under `core:default`, already
      granted. This work is app-side placement/layout logic and surfaced no
      connection to the separate WebView2/DirectComposition compositor issue
      tracked below; that remains open and untouched by this pass.

**Debug tooling added during render-paint investigation:** `--debug-opaque-overlay`
CLI flag (or `OVERLAY_DEBUG_OPAQUE=1` under `tauri dev`) builds the window at
the exact same size/position as shipped, but opaque, non-click-through, with
a dark `#1a1a2e` ground, a bright lime "OVERLAY DEBUG" label, and a 2px
border — isolates "does the surface paint at all" from every transparency/
compositing variable. Every window flag is independently overridable via
`OVERLAY_TRANSPARENT` / `OVERLAY_DECORATIONS` / `OVERLAY_ALWAYS_ON_TOP` /
`OVERLAY_SKIP_TASKBAR` / `OVERLAY_CLICK_THROUGH` / `OVERLAY_SHADOW` (all
read in `src-tauri/src/lib.rs`) for future compositor debugging. Diagnostics
(`src/diagnostics.ts`) route a full DOM/CSSOM report through a
`log_frontend_report` Rust command and print to stdout, since WebView2
console output isn't forwarded to the terminal.

**Render-paint bug (2026-07-04), root-caused and fixed:** the overlay window
was alive and correctly positioned (Win32 rect matched expected top-right
placement exactly) but nothing painted on screen — not even a blank rectangle.
DOM/CSSOM diagnostics (`src/diagnostics.ts`, routed through a Rust `invoke`
since WebView2 console output isn't forwarded to the terminal) showed the
panel's `getBoundingClientRect()`/computed styles were all correct
(`visible`, `opacity:0.96`, right rect, right gradient) — the layout engine
believed it was rendering fine. This is the signature of a known Tauri/
WebView2 issue: a window shown via `.visible(true)` on the builder can freeze
on a blank compositor frame if it's shown before WebView2 attaches, and
nothing later invalidates that frame.

**Fix:** build the window with `.visible(false)`, then have the frontend
call a `show_window` Tauri command only after two `requestAnimationFrame`
ticks confirm a real frame was composited (`showWhenPainted()` in
diagnostics.ts, called from `main.ts` after placement, before hotkeys).
Verified via a debug matrix (`OVERLAY_DEBUG_OPAQUE`/`OVERLAY_TRANSPARENT`/
`OVERLAY_DECORATIONS`/etc. env vars read in `src-tauri/src/lib.rs`): opaque
+ decorated content now paints correctly end-to-end (full Compact card,
god-tier glow, corner ornaments all confirmed visible). The transparent
shipped config was confirmed to build with the correct flags and to invoke
`show_window`; final pixel-level visual confirmation of the transparent
case is pending the user's own look (screenshotting a transparent window
composites through to whatever is behind it on the desktop, so it isn't a
privacy-safe verification method — see chat log).

Removed `tauri.conf.json`'s declarative `app.windows[]` entirely
(`"windows": []`) since it conflicted with programmatic window creation
(panicked with "a webview with label `main` already exists"); the window is
now always built in `lib.rs`'s `.setup()`, with every flag controllable by
an `OVERLAY_*` env var for future debugging.

### Known issue (2026-07-04): intermittent black/invisible overlay on hover — UNRESOLVED

Separate from the deterministic bug above (which **is** fixed — see below),
manual testing surfaced a second, non-deterministic failure: the overlay
sometimes goes solid black or fails to appear at all, on some launches but
not others, with byte-identical code and window flags. Debugging this
stopped without a fix; documented here so the investigation isn't repeated
from scratch.

**Symptoms observed** (via `--debug-opaque-overlay`, see below):
1. Window renders correctly for a few seconds, then turns solid black the
   moment the cursor enters it.
2. Window never appears at all ("invisible from the start") — no visible
   content from the moment the process shows the window, hover uninvolved.

**Reproduction rate:** roughly 30–40% failure across ~10 manual trials with
otherwise identical config. Confirmed non-deterministic: the *exact same*
env-var configuration reproduced the bug on one launch and was clean on the
next, back to back, on the same machine, same session.

**Root cause (suspected, unconfirmed):** a WebView2 / DirectComposition /
DWM compositor race, most likely tied to this machine's GPU driver or
WebView2 Runtime version, rather than anything in the app's own window
configuration or CSS. Evidence:
- DOM/CSSOM diagnostics during a black-screen occurrence show the panel as
  fully correct (`visible`, right rect, right gradient) — the page itself
  is fine; the compositor simply isn't presenting it.
- Bisecting every individual window flag (`decorations`, `always_on_top`,
  `skip_taskbar`, `transparent`, `click_through`) — including the *exact*
  flag combination that had just reproduced the bug — showed each one
  passing cleanly on a subsequent identical run. No single flag is
  deterministically responsible.

**Mitigations implemented (kept, but do not claim to fully fix it):**
- `background_color(Color(...))` set explicitly on the webview builder
  (`OVERLAY_EXPLICIT_BG`, default on) — states DirectComposition's clear
  color explicitly instead of leaving it ambiguous for transparent windows,
  a known trigger category for "goes black on recomposite."
- A defensive resize-nudge (`OVERLAY_HOVER_NUDGE`, default on) in the
  click-through polling thread (`src-tauri/src/lib.rs`): on a genuine
  cursor-enter transition, resizes the window by 1px and back, forcing
  `WM_SIZE` and a fresh WebView2 composite. Guarded against firing on the
  polling thread's first observation (if the cursor already happens to be
  over the window when the thread starts — e.g. left there from a prior
  test — this used to fire immediately at startup and appeared to *cause*
  an "invisible from the start" run; now skipped).
- `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--disable-gpu --disable-gpu-compositing
  --disable-features=Windows10CustomTitlebar` — tested alone (before the
  background-color fix existed) and combined with the background-color fix
  (after). Neither eliminated the bug; combined, 1 of 2 trials still failed
  ("invisible from the start", no hover involved).

**Trial log** (chronological, `debug_opaque=true` unless noted, all with
`show_window`-after-paint fix already in place):

| # | Config delta from previous | Hover result |
|---|---|---|
| 1 | first `--debug-opaque-overlay` launch | blackens after a few seconds of hover |
| 2 | `--disable-gpu` etc. added | still blackens on hover |
| 3 | `decorations=true,always_on_top=false,skip_taskbar=false,click_through=false` | clean (baseline) |
| 4 | `decorations=false` only | clean |
| 5 | `always_on_top=true` only | clean |
| 6 | `skip_taskbar=true` only (= matches trial 1's flags) | clean — **contradicts trial 1** |
| 7 | `transparent=true` only | clean |
| 8 | `click_through=true` (now = full shipped flags) | clean |
| 9 | repeat of 8, identical | clean |
| 10 | repeat of 8, identical | **blackens + click-through leaks through on hover** |
| — | added `background_color` + hover-nudge fixes | |
| 11 | repeat of 8 with fixes | clean |
| 12 | repeat | **invisible from the start** (no hover) — traced to nudge firing on thread's first poll because cursor was already over the window; added startup guard |
| 13 | repeat with startup guard, cursor moved away first | clean, visible from start |
| 14 | repeat | clean |
| — | added `--disable-gpu` on top of both fixes | |
| 15 | repeat | clean |
| 16 | repeat | **invisible from the start again**, despite GPU disabled + both fixes + startup guard (confirmed via log: nudge did not fire) |

**Decision (2026-07-04):** stop active debugging. The deterministic bug is
fixed (see next section) and that's the part that would have blocked any
real use. This remaining intermittent behavior is being treated as a known
flaky issue pending: (a) the user checking for a WebView2 Runtime / GPU
driver update on this machine, separately from app changes, and (b) revisit
if it turns out to affect real gameplay sessions — a single always-on-top
overlay staying open for a full game session behaves differently than
rapid dev-mode restarts, and may not be affected the same way.

**Follow-up (2026-07-04, same day):** user ran the overlay through a real
gameplay session (left open, not rapid dev-restart cycling) — no black/
invisible occurrence. Consistent with (b) above: the ~30-40%-per-launch
reproduction rate was measured under rapid dev-mode restarts, and may not
transfer 1:1 to a single long-lived real-use window. Not a confirmed fix —
one clean session doesn't clear a non-deterministic bug at that base rate —
but it's the first positive real-use data point, so downgrading urgency:
no further active debugging planned unless it resurfaces in real use.

### Deterministic invisible-window bug (2026-07-03/04) — FIXED

**Toolchain note (2026-07-03):** Rust was missing on this machine; installed via
`rustup-init -y --default-toolchain stable-msvc --profile minimal` (VS Community
2022 C++ tools were already present). `cargo check` passes (tauri 2.11.5).
App icons generated from `src-tauri/icon-source.png` via `npx tauri icon`
(icon.ico is required by tauri-build's Windows resource step).
If vite's file watcher crashes with an FSWatcher/UVException error (seen when
launched from a constrained shell), run with `CHOKIDAR_USEPOLLING=1`.

## M2 — Static UI (Compact first)

- [x] `[S1]` Design tokens as CSS custom properties (spec §1) — `src/styles/tokens.css`
- [x] `[S1]` `RelicPanel` frame: gradient + stains + 9% grain, tarnished border,
      inner stroke, bevel, 4 corner filigrees, clasp (§1.2)
- [x] `[S1]` `PanelHeader`: glyph, title, `TierBadge`, toggle button (§4)
      (badge click = dev-only fixture cycling until M5)
- [x] `[S1]` `CompactBody`: HeatHero (48px score, tier name, `VerdictChip`),
      `TabletList` (3 × two-line), `WarningStrip`, `AnalyzeFooter` (§4)
- [x] `[S1]` Tier classes on panel root driving `--tier` (§6, all five states)
- [x] `[S1]` God halo behind score, clipped to panel + 12px bleed (§6)
- [x] `[S1]` Mocked `AnalysisResult` provider — one fixture per tier, contract-complete (§11)
      — `src/mock.ts`
- [x] `FullBody` three-column layout (§5) — mods w/ bold numerics, breakdown bars,
      total row, dense tablets, insights (warning first)
- [x] Mini Compact fallback layout (240×84) (§2) — 2026-07-04: single merged
      header row (glyph, score, tier badge, single ⚠ icon w/ tooltip, toggle);
      `.bodies` hidden entirely; `src/components/RelicPanel.ts` + `panel.css`

## M3 — Modes & persistence

- [x] Compact ⇄ Full morph (single `mode` field, 220ms, micro-shift −16/+16) (§3, §7)
      — window is a fixed 620×416 envelope; the morph is pure CSS, no OS resize
- [x] Mini Compact engaged by fallback cascade only (§2) — 2026-07-04:
      `computeEffectiveMode()` in `src/placement.ts` compares monitor space
      (minus safe-zone pad) against each mode's footprint (Compact 292×392,
      Full 580×332+16 micro-shift clearance) and returns `EffectiveMode`
      ("compact"|"full"|"mini"), distinct from the persisted `mode`
      (intended). `RelicPanel.setMode()` now takes `EffectiveMode`; only
      updates the persisted mode when not "mini", so intent survives a
      forced fallback.
- [x] Persistence keys `overlay.mode`, `overlay.intendedMode`, `overlay.reduceEffects`;
      read before first render, no layout flash (§9) — `src/settings.ts` (localStorage);
      reduceEffects honored in animations, settings UI toggle still M6
- [x] Intended-mode restore when space returns after a forced fallback (§2) —
      `computeEffectiveMode(mode)` re-derives the effective display from the
      *intended* mode every time it's called (init, and after every toggle);
      since intent was never overwritten by a fallback, space returning
      naturally re-renders the intended mode on the next evaluation. (Re-running
      this on live display/resolution-change events, not just at init/toggle
      time, remains the M1 "re-run placement on display change" checklist item.)
- [x] Verified 2026-07-04: shipped (non-debug) config runs the full init() path
      end-to-end with zero captured errors (`errors: []` in every DOM report
      phase, `post-placement` tag reached) — confirms mode/persistence code is
      sound independent of the compositor flakiness documented in M1

## M4 — Hotkeys & actions

- [x] Global **Ins** → analyze + refresh + pulse/flare (global-shortcut plugin) (§8)
- [x] Global **Shift+Ins** → mode toggle (§8)
- [x] Key-repeat guard: ignore repeats while analyze animation in flight (§8)
- [x] Footer button fires the identical analyze path (§4)
- [x] Verified 2026-07-04: `registerHotkeys()` reached and completed without
      throwing in the shipped config (see M3 note above) — live keypress
      testing best done by the user directly given the compositor flakiness
- [x] Final click-through: only toggle / footer / mod-scroll regions interactive (§2)
      — 2026-07-04: `set_interactive_rects` (plural) replaces the old single-rect
      command; Rust holds a `Vec<Rect>` and re-enables input only when the
      cursor is inside *any* reported region (`src-tauri/src/lib.rs`).
      Frontend: `RelicPanel.interactiveEls()` returns exactly the badge +
      toggle always, `+footer` in Compact, `+mods` scroll in Full, nothing
      extra in Mini; `reportInteractiveRegions()` (`src/interactive-rect.ts`)
      ships their physical rects after mount, after placement, and 260ms
      after every mode toggle (once the morph settles). Falls back to
      whole-window bounds only before the frontend's first report lands.

## M5 — Adapter layer

- [x] Inventory current analyzer output; diff against `AnalysisResult` (§11) —
      2026-07-04: source is `poe2-waystone-analyzer-v2` (Python/PyQt6, clipboard
      text parsing, no OCR). It never converged on one scoring pipeline — three
      parallel entry points (`analyze()`, `analyze_waystone()`,
      `evaluate_waystone()`), the last using `map_evaluator.py`'s density-first
      weighted scorer (chosen as the basis per user decision). Waystone/modifier
      *text* data mapped over cleanly; `heat.tierClass/verdict/breakdown[]`,
      `modifiers[].kind`, `warning`, `insights[]` all needed new logic since v2
      only ever produced a binary run/skip decision. `tablets[]` has no v2
      analog at all (v2 never recommended tablets) — ships `[]` this pass per
      user decision; real tablet-recommendation logic is separate future scope.
- [x] `analyzer-adapter` module: maps raw analyzer output → `AnalysisResult` —
      `src/analyzer/`: `mod-parser.ts` (regex quantity/rarity/packSize
      extraction), `parser.ts` (structural Waystone parse: name/tier/
      rarity/corrupted/modifiers), `unified-parser.ts` (primary/fallback
      confidence merge), `scoring.ts` (ported `map_evaluator.py`'s "default"
      profile: adaptive pack_size weighting, hard-block/speed-penalty/
      positive-mod regex sets, `evaluateMap()`), `adapter.ts` (ties it
      together + the new tierClass/verdict bands below). Architecture
      decision (user): **ported to TypeScript, not kept as a Python
      sidecar** — single process, no Python runtime to bundle, matches
      why Tauri was chosen for this overlay.
      New (not from v2) tierClass/verdict score bands, anchored on v2's own
      run/skip threshold (55) as the GOOD/RUN boundary — tune freely in
      `adapter.ts`'s `TIER_BANDS`: `<40` trash/TRASH, `<55` low/MODIFY,
      `<90` good/RUN, `<150` splus/JUICE, else god/JUICE. Hard-block mods
      (reflect/no-leech/no-regen) always force trash/TRASH regardless of
      score, matching v2's own "no amount of quantity is worth bricking
      the loop" rule. `modifiers[].kind` reuses the same danger/positive
      regex sets that drive scoring (`classifyModifierKind()`), so the
      displayed tag always agrees with what actually moved the score.
- [x] UI imports **only** `AnalysisResult` — no thresholds, no verdict computation
      client-side (tierClass/verdict come from the adapter/analyzer) (§11) —
      confirmed: `RelicPanel.ts`/`main.ts` never inspect `heat.score` to decide
      anything; they render whatever `tierClass`/`verdict` the adapter set.
      Clipboard wiring: `src/clipboard.ts` (Tauri clipboard-manager plugin,
      `null` in plain-browser dev) + `main.ts`'s `analyze()` now reads the
      real clipboard on every Ins/footer press and calls `analyzeWaystoneText()`;
      falls back to keeping the currently-displayed result (still plays the
      pulse) when the clipboard doesn't hold a valid Waystone.
- [x] Contract tests: adapter output satisfies §11 boundary rules
      (one-line warning, sorted tablets, breakdown sums to score) —
      `npm run verify-adapter` (bundles `adapter.ts` with esbuild, since
      Node's ESM resolver needs explicit extensions the TS source doesn't
      use, then runs `scripts/verify-adapter.mjs`) against v2's real
      `sample_waystone.txt`: parses correctly (tier 15, corrupted, 5 mods),
      breakdown sums to score exactly (177.00 vs 177, diff 0), tierClass/
      verdict/modifier-kind all valid enum values, non-waystone text
      returns `null` cleanly. Additional ad-hoc checks (not committed):
      hard-block mod → score 0 / trash / TRASH / warning populated; a
      speed-penalty mod → multiplicative penalty reconciles exactly in
      the breakdown (115.2 vs 115.2).

## M6 — Polish & acceptance

- [x] Full animation set at spec timings (§7) — 2026-07-04 audit against the
      spec's table found the whole set already correct (pulse 380ms,
      badge/chip flare 400ms, mode morph 220ms/180ms fade, god halo 500ms,
      sparks 900ms/5×/18-28px/0-120ms stagger all matched exactly) except
      two real gaps, both fixed:
      - **Bar sweep** was spec'd to trigger on "Analyze / tier change /
        **entering Full**" but only ever ran from `setResult()`/`analyze()`
        — toggling into Full with unchanged data never re-swept the bars.
        Fixed: `setMode()` now calls `animateBars()` when `m === "full"`
        (`RelicPanel.ts`).
      - **Warning reveal** ("single fade/underline sweep, no flashing")
        didn't exist at all — the warning strip just snapped visible via
        `hidden` toggling. Added `.warn-strip.reveal`/`.mini-warn.reveal`
        (250ms fade + left-edge `scaleX` sweep for the Compact strip, plain
        fade for the tiny Mini icon), retriggered from `analyze()` whenever
        a warning is present — mirrors how badge/chip flare already only
        plays alongside an analyze, not on every silent `setResult()`.
- [x] Reduced motion: OS pref OR `reduceEffects`; color states never disabled (§10)
      — audit found a real gap: the `prefers-reduced-motion` media query only
      ever sees the *OS* preference; the app's own `reduceEffects` setting
      only gated the JS-triggered effects (pulse/flare/sparks via `analyze()`'s
      early return), never the CSS-only transitions (mode morph, halo fade-in,
      body cross-fade, hover-color transitions, ...) — so setting
      `overlay.reduceEffects=true` without OS-level reduced motion left half
      the animations still running at full duration. Fixed: `analyze()` now
      calls `syncReducedClass()` (also called once at mount) to mirror
      `isReduced()` (which already ORs both inputs) onto an `.overlay.reduced`
      class; `panel.css` extends the same `!important` zero-duration override
      to `.overlay.reduced *` alongside the media query. Tier colors, badge
      fills, and warning strips are untouched by either path — only
      `animation-duration`/`transition-duration` are forced to ~0.
- [x] Safe-zone fallback cascade Full → Compact → Mini Compact (§2) — see M3;
      the live-resize/DPI-change gap noted here originally is now closed —
      see M1's `watchDisplayChanges()`, 2026-07-04.
- [x] 360px Compact compression variant behind a config flag (§2 contingency)
      — `overlay.compactCompressed` in `settings.ts` (localStorage; no
      dedicated settings UI exists in the spec's component tree yet, so this
      is the flag surface until one does), applied as a `.compact-compressed`
      class at mount. `compact.css` trims exactly the air the spec lists —
      hero padding 10/13→6/9, score 48→42, chip margin 9→6/padding 4→3, tablet
      row padding 3→2, tabs-v top-padding 8→6, warning margin 9→6, footer
      padding/margin trim — landing the panel at 359px. Score, verdict chip,
      and all three tablets are untouched; never reverts to horizontal.
- [x] Walk the full §13 acceptance checklist against the running overlay —
      2026-07-04, verified against the shipped (non-debug) config via DOM/log
      reports (no screenshots — transparent-window capture composites through
      to whatever's behind it on the desktop, which isn't a privacy-safe
      verification method; see the M1 investigation log):
      1. **Opens in persisted mode, zero flash** — ✅ architecturally
         guaranteed (`loadMode()` read synchronously before `mountOverlay()`
         call in `main.ts`) and confirmed live: this session's DOM report
         showed `panelRect: 580×332` (Full) on boot, matching a mode
         persisted from an earlier session, with the mode set before first
         paint per the code path.
      2. **Ins → pulse/flare(+sparks) < 100ms** — ✅ by construction (all
         retriggers fire synchronously inside `analyze()`, called directly
         from the hotkey callback); not independently profiled for exact
         wall-clock latency.
      3. **Shift+Ins / header button morph 220ms + micro-shift** — ✅ code
         verified (`toggleMode()` → `applyEffectiveMode()` → `setMode()`,
         220ms CSS transition + `translate(-16px,16px)` on `.mode-full`);
         not visually re-confirmed this pass (see M3's log-only verification
         note).
      4. **All five tier states, God halo ≤ panel+12px** — ✅ code-verified
         (`tier-*` classes drive `--tier`/`--tier-glow`; `.halo` is
         `absolute`, sized 132px/100px, centered on the score, well inside
         the 12px bleed margin); not visually re-confirmed this pass.
      5. **Compact shows exactly: score, tier name, chip, 3 tablets+reasons,
         ≤1 warning, footer** — ✅ `RelicPanel.ts`'s Compact markup contains
         precisely these elements, no more; `tablets.slice(0,3)` enforces the
         cap; `warning` is a single `string | null` field, never a list.
      6. **Safe-zone pad 20/14px, no edge off-screen** — ✅ `placeTopRight()`'s
         pad logic, now also explicitly clamped to monitor bounds; and re-run
         on live display/DPI/resolution change via `watchDisplayChanges()`
         (M1, 2026-07-04) — the gap noted when this checklist was first
         walked is closed.
      7. **Fallback restores intended mode when space returns** — ✅ see M3:
         `computeEffectiveMode(mode)` always re-derives from the *intended*
         mode, never overwrites it on a forced fallback.
      8. **Reduce effects + OS reduced-motion honored** — ✅ closed the gap
         above this same session.
      9. **Game input never blocked outside the three interactive regions**
         — ✅ code-verified (`interactiveEls()` returns exactly
         badge+toggle, `+footer` in Compact, `+mods` in Full, nothing extra
         in Mini; Rust's `set_interactive_rects` gates click-through on
         exactly those rects) — **caveat: the compositor flakiness
         documented in M1 means the click-through *mechanism* is correct by
         code but the window's visual/input reliability under real hover has
         an open, unresolved intermittent issue.**
      10. **Score digits don't shift during pulse** — ✅
          `font-variant-numeric: tabular-nums` is set on every numeric score
          element (`tokens.css`); pulse only transforms `scale`, never
          layout-affecting properties.

      Net: all ten items pass at the code/log level; three carry an explicit
      caveat (items 2/3/4 not re-confirmed visually this pass, item 6's
      live-resize case is open under M1, item 9 inherits the known
      compositor flakiness) rather than being silently marked done.

## Release readiness pass (2026-07-04)

Not a numbered milestone — a cleanup/packaging pass preparing the current
state for actual distribution.

**Real release bug found and fixed:** the tier-badge click-to-cycle-mock-tiers
dev affordance (from before M5) was still wired into every build, including
release ones. Since M5 wired the badge's real job (tier display) to actual
clipboard analysis, clicking it in a shipped build would have silently
overwritten a real analyzed result with mock fixture data — indistinguishable
from a bug to an end user. Fixed: `onCycleTier` is now `undefined` unless
`import.meta.env.DEV` (Vite's dev-vs-production flag), and
`RelicPanel.ts`/`panel.css` skip the click listener, `cursor:pointer`, and
tooltip entirely when it's absent. Also removed the badge from
`interactiveEls()`'s click-through-exempt regions in production, so §2's
"toggle / footer / mod-scroll only" is actually strictly true when shipped
(it was previously also exempting the badge everywhere, dev or not).

**Packaging configured and validated end-to-end** — `tauri.conf.json`
`bundle`: `active: true`, `targets: ["nsis"]`, publisher/description
metadata, explicit icon list. `npm run tauri build` produces a real
installer: `waystone-overlay_0.1.0_x64-setup.exe` (~2 MB). Verified, not
just configured:
- The release `.exe` (bundled assets served from `http://tauri.localhost/`,
  confirming `frontendDist` embedding works, not a dev-server dependency)
  boots cleanly through every diagnostic checkpoint with `errors: []`.
- Added a new lightweight `logAnalyzeAttempt()` checkpoint
  (`diagnostics.ts`/`main.ts`) firing on every Ins press — the existing
  `sendReport()` checkpoints only ran at init, so there was previously no
  way to confirm a real analysis actually landed vs. silently no-op'd.
- End-to-end validated with this checkpoint: real sample Waystone text on
  the OS clipboard, global Ins hotkey physically simulated, resulting
  applied data (`score: 177, tierClass: "god", name: "Forsaken Vault"`)
  matched `npm run verify-adapter`'s output exactly.
- **Testing gotcha discovered along the way:** simulating the Insert
  keypress via `SendKeys` while a terminal has focus can make the
  terminal's own key handling clobber the clipboard *before* the global
  hotkey fires (confirmed: clipboard became a 30-byte garbage fragment
  after one such attempt) — looks exactly like "analysis silently failed"
  but is a test-methodology artifact, not an app bug. Focusing a neutral
  window (Notepad) first before sending Insert fixed it. Documented in
  `docs/release-checklist.md` so this doesn't get mis-diagnosed as a
  regression later.
- Also closed a real diagnostics gap found in the process: `capturedErrors`
  only listened for synchronous `error` events, not `unhandledrejection` —
  meaning a denied Tauri permission (which rejects a promise, not a
  synchronous throw) would have been invisible to every report. Added the
  listener.

**Repo cleanup:** removed `npx tauri icon`'s iOS/Android/Windows-Store-tile
assets (this is a Windows-only desktop overlay; those were pure bloat) — kept
just `icon.ico`/`icon.png`/`icon.icns`/the PNG size set actually used for
Windows bundling. Added `src-tauri/gen/` (Tauri's auto-regenerated capability
schema files) to `.gitignore`. Added `"types": ["vite/client"]` to
`tsconfig.json` (needed for `import.meta.env.DEV` to type-check).

**New docs:**
- [`README.md`](../README.md) — user-facing: what it does, requirements,
  install/usage, keyboard shortcuts, how to read the overlay, links to the
  known-issues and dev docs.
- [`KNOWN_ISSUES.md`](../KNOWN_ISSUES.md) — user-facing distillation of the
  compositor flakiness (M1), the tablets/scoring-threshold/settings-UI scope
  gaps (M5/M6), and the live-multi-monitor caveat, written for someone who
  didn't read this implementation log.
- [`docs/release-checklist.md`](release-checklist.md) — the checklist this
  whole pass was built to satisfy; keep it current for future releases
  rather than re-deriving it each time.

## Juice Score / Mechanic Matching rework (2026-07-04)

Reworked the analyzer core per a new cahier des charges: the philosophy
shifted from a 3-stat (`quantity`/`rarity`/`packSize`) ported-from-v2 "heat"
score to a 0-100 **Juice Score** over 5 signals (Item Rarity, Monster
Rarity, Pack Size, Monster Effectiveness, Waystone Drop Chance) plus a
**Mechanic Match Score** per league mechanic, driving a real tablet +
mechanic recommendation. See `.claude/plans/woolly-hatching-hennessy.md`
(session plan) for the full design rationale.

**Auto Ctrl+C on Ins:** added the `enigo` crate (`src-tauri/Cargo.toml`) and
a `simulate_copy` Tauri command (`src-tauri/src/lib.rs`) that sends Ctrl+C
before `src/clipboard.ts` reads the clipboard — the player no longer needs
to copy manually before pressing Ins.

**Stat extraction:** `src/analyzer/mod-parser.ts`'s `ModStats` grew from 3
fields to 6 (`itemRarity`, `monsterRarity`, `packSize`,
`monsterEffectiveness`, `waystoneDropChance`, `quantity`); `unified-parser.ts`
updated to match.

**Scoring:** `src/analyzer/scoring.ts` dropped the 5-archetype `PROFILES`
system (v2 relic; only `default` was ever wired to the UI) for one
`DEFAULT_WEIGHTS` set summing to 100 points at full caps, normalized/clamped
to [0, 100]. Hard-block/speed-penalty/positive-mod regex gating kept as-is.

**Mechanic matching (new):** `src/analyzer/mechanics.ts` — 15 mechanics
(§8) each with a priority stat, up to 2 secondary stats, recommended
tablets, and a keyword-detection regex. `src/analyzer/tablets.ts` — 5
representative tablet definitions (see KNOWN_ISSUES.md #2 for scope).
`adapter.ts`'s `computeMechanicScores` crosses the waystone's normalized
stat profile against each mechanic (priority stat × 0.6 + up to 2 secondary
× 0.2 each), +15 flat bonus if the mechanic's keyword is already present in
the item text. Best-scoring mechanic drives `recommendedMechanic` and
`tablets[]` (previously hardcoded to `[]`).

**Verdict (§9):** `Verdict` type changed from `TRASH|MODIFY|RUN|JUICE` to
`SKIP|RUN|GARDER`, computed in `adapter.ts`'s `classifyVerdict` (hard-block
or score<20 → SKIP; score≥50 and waystone tier≥3 → GARDER; else RUN).
`TierClass`'s 5 string keys (`trash/low/good/splus/god`) kept as stable
internal/CSS identifiers but now map to Faible/Moyen/Bon/Excellent/
Legendaire display labels (`RelicPanel.ts`'s `BADGE_LABEL`).

**meta.json config (§10, new):** added `tauri-plugin-fs` scoped (via
`capabilities/default.json`) to read-only access on
`$APPCONFIG/meta.json`. `src-tauri/src/lib.rs`'s `seed_meta_json` copies
`src-tauri/default-meta.json` into the app config dir on first run only
(never overwrites a user edit). `src/analyzer/meta-config.ts`'s
`loadMetaConfig()` reads it at startup (`main.ts`'s `init()`) and overlays
matched mechanics' `priority_stat`/`secondary_stats`/`recommended_tablets`/
`skip_if_below` onto the bundled `MECHANICS` defaults via
`mechanics.ts`'s `setActiveMechanics`/`getActiveMechanics` — falls back
silently to defaults on any missing/malformed file.

**UI:** `RelicPanel.ts`'s Full-mode third column gained a "Mechanic Match"
section (reuses the existing breakdown-bar rendering, own 0-100 scale),
star-marking the recommended mechanic. `src/mock.ts` fixtures updated to
the new contract shape (`mechanicScores`, `recommendedMechanic`, fixed
breakdown keys — the old fixtures' `density` key never matched any real
`Weights` field).

**Deferred** (see KNOWN_ISSUES.md #3 for detail): in-app weight-editor UI
(§9's "l'utilisateur peut configurer ses propres poids" — `meta.json` is
still hand-editable, no UI). Everything else in the doc's Phase 4 list is
now implemented (below).

**Verification:** `npm run build` (tsc + vite) and `cargo check` both
clean. `npm run verify-adapter` extended with Juice Score range,
Mechanic Match Score range/sort-order, and verdict-enum assertions —
`ALL CHECKS PASSED` against the real `sample_waystone.txt` sample.

## Phase 4 "Qualite de vie" + startup-crash fix (2026-07-04, same day)

Two bugs surfaced from actually running the Phase 1-3 build, fixed first:

- **Vite watching `src-tauri/target`:** `cargo`'s active rebuild of
  `waystone_overlay_lib.dll` raced Vite's file watcher into an `EBUSY`
  crash on Windows. Fixed by excluding `src-tauri/**` from Vite's watcher
  (`vite.config.ts`'s `server.watch.ignored`) — the standard Tauri
  template setting, missing from this project's config.
- **Startup Ctrl+C hitting the dev terminal:** `main.ts`'s automatic
  startup `analyze()` call was simulating Ctrl+C like a real Ins press,
  and that keystroke goes to whatever window has OS focus (the overlay is
  `.focused(false)`) — a dev terminal's focus turned it into a SIGINT that
  killed `tauri dev` with `STATUS_CONTROL_C_EXIT`. Fixed: `analyze()` now
  takes a `simulateCopy` flag; only the hotkey-triggered path (which
  defaults to `true`) simulates the keystroke, the one automatic startup
  call passes `false`.

Then the cahier des charges' remaining Phase 4 items, per the user's
explicit instruction to keep following the doc rather than improvise scope:

- **Clipboard save/restore (§4 steps 1/8):** `src/clipboard.ts`'s
  `readClipboardText` now reads the clipboard *before* simulating Ctrl+C,
  and restores that value after reading the freshly-copied text (skipped
  entirely for the non-simulating startup call).
- **Legendaire notification (§16):** new `src/notify.ts` —
  `tauri-plugin-notification`, requests permission once, fires a native
  toast when `analyze()` in `main.ts` sees `tierClass === "god"` on a name
  not already notified this session (`lastNotifiedName` guard against
  re-notifying on repeat/no-op analyzes).
- **Highlight for excellent/legendary waystones (§13):** already existed
  (per-tier border/glow/halo in `panel.css`, spark-particle burst on `god`
  tier in `RelicPanel.ts`'s `spawnSparks`) — confirmed satisfies the
  requirement, no new code needed.
- **Compare mode (§12):** new third hotkey **Ctrl+Ins**
  (`hotkeys.ts`'s `onToggleCompare`) toggles a `.body-compare` overlay
  body. `main.ts` keeps a rolling `compareList` (last 2-3 distinct real
  analyses, newest first) and calls `overlay.showCompare(compareList)` /
  `closeCompare()` (new `OverlayHandle` methods in `RelicPanel.ts`). The
  compare body renders each waystone as a card (name/tier/score/verdict),
  starring + gold-bordering whichever has the highest Juice Score. A no-op
  until 2+ waystones have been analyzed. Doesn't touch `mode`/`effective`
  (Full/Compact/Mini) — closing Compare reveals whichever body was active
  before, unchanged.

**Verification:** `npm run build`, `cargo check`, `npm run verify-adapter`
all clean after every change in this section.

## Data-driven tablet pool (2026-07-04)

Reworked KNOWN_ISSUES.md #2 (small hardcoded tablet set) into a data-driven
system, per explicit user request for "clean, scalable, no more hardcode."

**Root design change:** tablets used to be matched to a mechanic by string
name (`MechanicDef.recommendedTablets: string[]`, looked up against
`TABLETS` by exact name in `adapter.ts`) — adding a tablet meant editing
both `tablets.ts` and every relevant mechanic's name list. Replaced with
stat-fit ranking: `mechanics.ts`'s new `scoreMechanicFit(profile, mech,
extraBonus)` — the same 0.6/priority + 0.2/0.2-secondary weighting
`computeMechanicScores` already used for a waystone's own stats — is now
also run against each tablet's `boosts` profile (`adapter.ts`'s new
`rankTablets`). A tablet is eligible for a mechanic purely because its
boosts fit that mechanic's priority/secondary stats; `recommendedTablets`
still exists but only adds a flat +10 fit-score bonus for curated picks, no
longer a hard filter — so it's optional, and a tablet added with zero
mechanic-side changes is fully functional.

**Tablet definitions became text, not numbers:** `tablets.ts`'s `TabletDef`
used to hand-declare `boosts: Partial<Record<StatKey, number>>` directly.
Now tablets declare `mods: string[]` as plain PoE2-style text (e.g. `"30%
increased Monster Effectiveness"`), and `toBoosts()` runs them through
`mod-parser.ts`'s existing `parseMods` — the same tolerant, already-proven
regex used for real waystone clipboard text — instead of a second
hand-rolled matcher. Expanded the bundled set from 5 to 7 (added Ritual and
Breach Tablets) purely as data.

**meta.json extended:** `meta-config.ts`'s `loadMetaConfig` now also reads a
top-level `"tablets"` array (sibling to the existing `"metas"` mechanic
overrides) — `mergeTablets()` matches by name case-insensitively: a name
matching a bundled default overrides its `mods`/`tags`/`enabled`, any other
name is appended as a brand new tablet. `enabled: false` hides a tablet
without deleting its definition (the "activer/désactiver" ask). Tolerant to
malformed entries per the module's existing "never throws, degrade to
defaults" contract (`toRawTablet` returns null and the entry is skipped).
Documented with a worked example in `README.md`'s "Tuning the scoring"
section.

**Verified:** `npx tsc --noEmit` clean; `npm run verify-adapter` all checks
pass, tablet ranking output sane (e.g. sample waystone's best-fit mechanic
"Heist" ranks "General Tablet" — the one with an Item Rarity boost — top);
manually confirmed a tablet added purely via a `setActiveTablets` call with
no `tablets.ts`/`mechanics.ts` edit parses its mods correctly and appears
in `getActiveTablets()` immediately (esbuild-bundled `tablets.ts` in
isolation, not through the full app, just to prove the extension path).

### Wider tablet pool (2026-07-04, same day)

Follow-up to the rework above, per explicit user request to widen the
pool now that it's data-driven. Added 9 new `DEFAULT_TABLETS` entries,
tagged `"placeholder"`, covering every mechanic that previously had no
naturally-fitting tablet at all (Legion, Heist, Sanctum, Harvest,
Metamorph, Essence, Incursion, Bestiary), plus a Cartographer's Tablet
weighted toward Waystone Drop Chance / Item Quantity (previously only
Expedition Tablet touched `waystoneDropChance`). 7 → 16 total.

Each new entry's mods were derived directly from that mechanic's own
`priorityStat`/`secondaryStats` in `mechanics.ts` (e.g. Heist is
`priorityStat: itemRarity, secondaryStats: [quantity]`, so Heist Tablet got
`"20% increased Item Rarity"` + `"15% increased Item Quantity"`) — this
guarantees each new tablet actually ranks near the top for the mechanic it
was built for, verified for Heist: `getActiveTablets()` ranking against the
sample waystone's best-fit mechanic ("Heist") now surfaces "Heist Tablet"
and "Harvest Tablet" (both itemRarity+quantity profiles) ahead of tablets
with no quantity boost.

**Explicitly not done:** verifying these 9 against real PoE2 tablet item
text — the user confirmed (per the same request) that real names/mods are
wanted as a follow-up once available, not fabricated now. `tablets.ts`'s
module comment and `KNOWN_ISSUES.md` #2 both flag which entries are
placeholders so this isn't mistaken for verified game data later.

**Verified:** `npx tsc --noEmit`, `npm run build`, `npm run verify-adapter`
all clean.

### Real PoE2 tablet data — partial (2026-07-04, same day)

User asked to also bring in real PoE2 tablet names/mods (WebSearch). Found
via poe2wiki.net/maxroll.gg that PoE2's actual tablet system (Precursor
Tablets slotted into Atlas Towers) is structurally different from what this
app models: mechanic-specific tablets (Breach/Expedition/Delirium/Ritual/
Abyss) mostly boost mechanic-specific *currency* (Splinters, Artifacts,
Tribute, Simulacrum Splinters), not the six generic stats
(`itemRarity`/`monsterRarity`/`packSize`/`monsterEffectiveness`/
`waystoneDropChance`/`quantity`) this app's `mod-parser.ts`/`scoring.ts`
track at all. Only two real tablet types actually map onto those six
stats: the non-mechanic-specific **Standard Precursor Tablet** ("10-20%
increased Quantity of Items found", "10-15% increased Rarity of Items
found") and the boss-drop **Overseer Precursor Tablet** ("+10-20% chance
Map Boss drops a Waystone", "15-25% increased Rarity of Items dropped by
Map Bosses").

Given this mismatch, offered the user a scope choice (replace only the two
that fit / extend the stat model to add mechanic-currency tracking / leave
placeholders as-is) — **chose the smallest option**: replaced
`DEFAULT_TABLETS`' "General Tablet"-adjacent entry set with two new
`"verified"`-tagged tablets using the real wording and range-midpoint
values, removed the placeholder "Cartographer's Tablet" it superseded, and
left the 7 original + 8 remaining placeholder entries untouched. No
`StatKey`/scoring model changes — the mechanic-specific real tablets remain
unmodeled, documented as a real gap in `KNOWN_ISSUES.md` #2 rather than
silently worked around.

**One parser gap found and fixed along the way:** the real Overseer
Tablet's exact phrasing is "chance to **drop** a Waystone" (verb-then-noun),
but `mod-parser.ts`'s `waystoneDropChance` regex only recognized "chance to
**find** an additional Waystone" — the real text silently parsed to a zero
boost. Fixed by widening that one alternation to
`chance\s+to\s+(?:find|drop)\s+an?\s+(?:additional\s+)?waystones?` — still
scoped to the parser's existing stated job (tolerant to real-world wording
variation), not a new stat or model change. Verified via an isolated
`tablets.ts` bundle: `Overseer Precursor Tablet`'s boosts now parse to
`{ itemRarity: 20, waystoneDropChance: 15 }`.

**Also surfaced, not investigated further (separate from tablets):** several
mechanics in `mechanics.ts` (Legion/Heist/Sanctum/Harvest/Metamorph/
Incursion/Bestiary/Essence) don't appear to be part of PoE2's actual
endgame tablet/mechanic system per this research — flagged in
`KNOWN_ISSUES.md` #2 as a `mechanics.ts` question for later, out of scope
for this tablets-focused pass.

**Verified:** `npx tsc --noEmit`, `npm run build`, `npm run verify-adapter`
all clean; manually confirmed both new tablets parse their real-wording
mods to the expected boosts.

### Reward-based tablet scoring (2026-07-04, same day)

Direct follow-up to the finding above: mechanic-specific real PoE2 tablets
mostly grant mechanic-specific currency (Splinters/Artifacts/Tribute), not
the six generic stats `mod-parser.ts` tracks — so those tablets' `boosts`
are weak/empty and they never ranked well via `scoreMechanicFit` alone, no
matter how valuable they really are. User asked for a way to represent
that value, explicitly ruling out live pricing/external APIs and asking to
keep it simple and non-breaking.

**New module, `src/analyzer/rewards.ts`:** a `Reward` discriminated union
(`"currency"` — `{ id, weight }`, contribution = `weight * 3`;
`"mechanic"` — `{ id, value }`, contribution = `MECHANIC_VALUES[id] ??
value ?? 5`; `"generic"` — `{ score }`, contribution = `score` directly)
and `computeRewardScore(rewards)` summing all of them, `undefined`/`[]` →
0. `MECHANIC_VALUES` is a small `Record<string, number>` (expedition 8,
delirium 9, ritual 6, breach 6, legion 7, abyss 5, essence 6) acting as a
single source of truth so two tablets citing the same mechanic don't drift
— an id it doesn't list falls back to that reward's own `value`, never
crashes. Every lookup/loop is wrapped to degrade to 0 on malformed data,
matching every other analyzer module's contract.

**Wiring, all additive/non-breaking:**
- `tablets.ts`'s `RawTabletDef` gained an optional `rewards?: Reward[]`;
  `TabletDef` gained `rewardScore: number`, computed once at `hydrate()`
  time via `computeRewardScore(raw.rewards)` — 0 for every tablet that
  doesn't declare `rewards`, i.e. every tablet that existed before this
  feature.
- `adapter.ts`'s `rankTablets`: `fit = clamp(statFit + tablet.rewardScore,
  0, 100)` — was just `statFit` before. Since `rewardScore` is 0 by
  default, this is provably a no-op for every pre-existing tablet.
- `meta-config.ts`: `toRawTablet`/`mergeTablets` also parse/merge an
  optional `rewards` array (validated per-entry via a new
  `isValidReward`, unrecognized shapes dropped, never throws) — same
  meta.json-editable pattern as `mods`/`tags`/`enabled`, documented with
  an example in README's "Tuning the scoring" section.
- Added example `rewards` to the three tablets hit hardest by the
  six-stat gap: Delirium, Expedition, Ritual Tablet.

**Verified:** `npx tsc --noEmit`, `npm run build`, `npm run verify-adapter`
all clean (unchanged pass/fail set — confirms non-breaking). Isolated
check: forcing a Delirium-leaning sample waystone, `Delirium Tablet`
ranks fit `37/100` — decomposes exactly as `19` stat-fit-plus-pin (9 raw
stat fit + 10 `recommendedTablets` pin bonus) `+ 18` reward score (`9`
from `MECHANIC_VALUES.delirium` + `9` from `3 (weight) * 3 (unit)`
currency reward) — matching the formula by hand, and it now outranks
`General Tablet` (18/100, no rewards) for that mechanic, which it did not
before this change.

## Surfacing rewards/rating in the UI, without a redesign (2026-07-04)

User asked to expose the new reward scoring and make the overlay more
interpretable — letter ratings, a rewards line, categorized insights, a
"key factors" summary — while explicitly keeping the fixed 580×332 Full
panel and not adding new titled sections that could overflow it. Chose
(user's call, offered as an option) to fold everything into existing
sections rather than add new ones: rewards became a sub-line under the
#1-ranked tablet's row, and "key factors" merged into the existing
Insights list instead of a new title.

**Data contract (additive, non-breaking):** `types.ts` gained `Rating =
"S"|"A"|"B"|"C"|"D"`, `Tablet.rating`/`Tablet.rewards?`, `heat.rating`,
and `AnalysisResult.keyFactors: string[]`. All computed in `adapter.ts`
(`scoreToRating` — same 20/40/60/80 boundaries as `TIER_BANDS`, just as
letters; `buildKeyFactors` — top breakdown contributors + mechanic match +
top tablet's reward presence) — never in the UI, matching this project's
standing rule that the overlay is a pure renderer and never derives
tierClass/verdict/score itself. `rewards.ts` gained `describeReward()` so
a tablet's reward line items are guaranteed to sum to the same
`rewardScore` used for ranking, not a second drifting formula.
`mock.ts`'s dev fixtures updated to match (typechecking would have caught
any drift here). `verify-adapter.mjs` gained checks for all of the above.

**Real bug found and fixed, unrelated to any of the above:** verifying
this with Playwright (`npx playwright`, headless Chromium — no
`chromium-cli` available in this environment) against the actual dev
server surfaced that column 2's "Total Heat" row was rendering ~113px
below the panel's real bottom edge, invisible in normal use. Root cause,
confirmed by disabling grid stretch and measuring natural per-column
content height: `.col` (`full.css`) had no `min-height:0`, so `.mods`
(column 1)'s `flex:1;overflow-y:auto` couldn't actually engage — its
content (8 modifier lines, several wrapping to 2 lines at that column
width) rendered at full natural height (342px) instead of clipping to the
available ~256px and scrolling internally as clearly intended. Since
`.cols` is a single-row CSS grid, one oversized column stretches all three
via default `align-items:stretch`, and none of `.cols`/`.body`/`.panel`
clip overflow — so the excess visually spilled past the card's rounded
border on the transparent overlay. Verified this predates today's session
entirely (col1's natural height alone, 342px, already exceeds the ~256px
budget with zero contribution from any of today's new tablet/reward/
rating content) — not something introduced by this pass, just not
previously caught because nobody had measured `getBoundingClientRect`
against it before.

**Fix:** `.col { min-height: 0; overflow-y: auto; overflow-x: hidden; }` —
extends the same "clip-and-scroll" pattern `.mods` already used to every
column, rather than a fragile pixel-budget chase. Also trimmed column 3
slightly to reduce how often that scroll has to engage in practice: merged
key-factors+insights capped at 2 combined rows (was up to 3, now sharing
that same original budget with keyFactors instead of adding to it),
`col3-sep` margins 8px→5px, and `tablets-full` slice 4→3 (now matches
Compact's existing 3-tablet cap — `types.ts`'s doc comment updated to
match). None of these three remove information in the common case (mock
data only ever has 2-3 tablets/mechanics to begin with); they reduce how
much the new internal scroll has to do in the dense-content case.

**Verified:** `npx tsc --noEmit`, `npm run build`, `npm run verify-adapter`
(with 4 new checks) all clean. Playwright screenshots of both Compact and
Full mode against the "god" mock fixture (richest content: warning +
keyFactors + a tablet with rewards) confirm the card renders fully
contained within its fixed bounds, `console --errors`-equivalent
(`page.on("console"/"pageerror")`) empty, and cycling all 5 mock tiers via
the dev-only badge click produces no console errors. Compact mode (more
vertical room per section) needed no layout changes at all — "Legendaire
· S", tablet rating badges, and the rewards sub-line all rendered cleanly
on the first pass.

## macOS dev-environment compatibility (2026-07-04)

Dev machine changed to macOS; the real target (Windows, WebView2) is
unchanged, so this is dev-convenience only, not a shipping target.
`cargo check` and `npm run tauri dev` both confirmed clean on macOS — the
app already ran without modification. Two gaps fixed:
- `simulate_copy` (`src-tauri/src/lib.rs`) hardcoded `Key::C` + `Control`,
  which only compiles on Windows in `enigo` 0.2 — added `#[cfg(target_os =
  "macos")]` branches for `Key::Unicode('c')` + `Key::Meta` (Cmd+C is
  macOS's copy accelerator, not Ctrl+C).
- No physical Mac keyboard has an Insert key, so none of the
  `Insert`/`Shift+Insert`/`Control+Insert` global shortcuts
  (`src/hotkeys.ts`) can ever fire there. Added mac-only (detected via
  `navigator.platform`) aliases `F9`/`Shift+F9`/`Control+F9` registered
  alongside the originals — purely additive, no effect on Windows.

## Tablet pool rewrite: only the 6 real PoE2 tablet types (2026-07-04)

Closes the open question from KNOWN_ISSUES.md #2 ("do the 8 placeholder
mechanics actually have tablets in the real game?"). Cross-checked three
independent sources (poe2wiki.net, maxroll.gg, odealo.com): real PoE2 has
exactly six Precursor Tablet types — Standard, Overseer, Breach, Ritual,
Delirium, Expedition — and no others. No Abyss, Legion, Heist, Sanctum,
Harvest, Metamorph, Essence, or Incursion/Bestiary tablet exists in-game.

**Change:** `tablets.ts`'s `DEFAULT_TABLETS` replaced wholesale — removed
all 8 "placeholder" entries plus the unverified Abyss/Blight/General
entries from the earlier pass, replaced with exactly the six real types,
all tagged `"verified"`. Each carries one representative shared-prefix
`mods` example (the four mechanic-specific types can all roll from the
same generic prefix pool in-game) plus real `rewards` for the
mechanic-specific currency their actual suffixes grant (Breach Splinters,
Ritual Tribute, Delirium Simulacrum Splinters, Expedition
Artifacts/Logbooks) — `rewards.ts` already existed for exactly this
channel, no new scoring code needed. `rewards.ts`'s `MECHANIC_VALUES`
trimmed to just the four mechanics with real tablet currency (dropped
abyss/legion/essence), reordered delirium > expedition > breach > ritual
per general community chase-value consensus — explicitly not a sourced
economic model, same caveat as the rest of this app's weights (KNOWN_ISSUES
#3). `mechanics.ts`'s `recommendedTablets` pins updated to the real names
(mostly "Standard Precursor Tablet" for the nine mechanics confirmed to
have no dedicated tablet). Also updated: `mock.ts`'s dev fixture,
`README.md`'s meta.json example, `src-tauri/default-meta.json` (the
seeded user-config default).

**Verified:** `npx tsc --noEmit` and `npm run build` clean. `npm run
verify-adapter` couldn't run in this environment (it reads a sample file
from a sibling `poe2-waystone-analyzer-v2` checkout that doesn't exist on
this machine — pre-existing environment gap, unrelated to this change);
verified instead with an ad-hoc script feeding a synthetic Waystone item
through `analyzeWaystoneText` directly — all six tablets rank without
crashing, rewards sum correctly into each tablet's displayed breakdown.

## Abyss Tablet re-added; runtime poe2db fetch rejected (2026-07-04, later same day)

A follow-up request asked to adopt a differently-shaped tablet scoring
system (`baseScore`/`MECHANIC_WEIGHTS`/a live `poe2db.tw` fetch layer) and,
separately, asserted Abyss now has a "verified via poe2db" tablet —
contradicting the removal two sections up. Re-researched rather than
taking either claim at face value:

- **Abyss, corrected:** the three sources used two sections up happen to
  predate Abyss's tablet addition (a separate abyss-focused guide cites
  patch 0.4.0; maxroll's atlas guide, current for patch 0.5.0, still
  doesn't mention it — inconclusive on its own). Checked poe2db.tw
  directly (data-mined from game files): confirms a real `Abyss Tablet`
  base type (drop level 65, "Adds Abysses to a Map," 10 uses remaining).
  Re-added to `tablets.ts` as `"verified"`, with `rewards` for Abyssal
  Jewels/troves value (mirroring the Breach/Ritual/Delirium/Expedition
  pattern) — but poe2db doesn't expose exact affix wording either, so its
  `mods` stays a representative example, not confirmed text like the six
  Precursor-Tower types. `rewards.ts`'s `MECHANIC_VALUES` and
  `mechanics.ts`'s Abyss `recommendedTablets` updated to match. See
  KNOWN_ISSUES.md #2 for the full correction.
- **New `baseScore`/`MECHANIC_WEIGHTS`/`computeTabletScore` schema: not
  adopted**, same call as the first time this was proposed — it would
  duplicate `TabletDef`/`rewards.ts`/`scoreToRating` (which already produce
  an equivalent S/A/B/C/D result) with a second, competing scoring path,
  and its reward list (`rewards: string[]`, no numeric value) is strictly
  less capable than the typed `Reward[]` this app already has wired
  through the UI (rating badges, reward sub-lines, `keyFactors`).
- **Runtime `poe2db.tw` fetch layer: not implemented.** Two concrete
  blockers: a `fetch()` from the Tauri webview to `poe2db.tw` almost
  certainly fails CORS (no reason for that site to allow this app's
  `tauri://localhost` origin), and this app's `analyze()` path is
  synchronous-and-local by design against a documented "Ins → pulse/flare
  < 100ms" acceptance criterion (M6) — a network call inline with every
  analysis would blow that budget and add an offline/rate-limit/slow-response
  failure mode where there currently is none. If ever revisited: a
  Rust-side (`reqwest`, no CORS issue) background refresh on startup, never
  inline with `analyze()`.

**Verified:** `npx tsc --noEmit` and `npm run build` clean after the Abyss
re-add.

## `confidence`/`source` replaces the ad-hoc `"verified"` tag (2026-07-04, later same day)

The "verified" signal on each `DEFAULT_TABLETS` entry was a free-form
string inside `tags` (informational only, no type backing it) — a request
to formalize it into a typed field was reasonable and, unlike the two
schema-replacement asks earlier this session, extends `RawTabletDef`
rather than competing with it. Added `confidence?: "high"|"medium"|"low"`
and `source?: "wiki"|"poe2db"|"community"|"manual"` to
`RawTabletDef`/`TabletDef` (`tablets.ts`); `hydrate()` defaults
`confidence` to `"medium"` when unset. Deviated from the requested source
enum by adding `"wiki"`: 6 of the 7 bundled tablets are triangulated
wiki/guide text (poe2wiki.net/maxroll.gg/odealo.com), not poe2db directly
— only Abyss Tablet's existence came from poe2db, and its exact mod
wording is still unconfirmed even there, so `"poe2db"` alone would have
mislabeled the other six.

Assigned per tablet: Standard/Overseer Precursor Tablet `high`/`wiki`
(exact wording triangulated); Breach/Ritual/Delirium/Expedition Tablet
`medium`/`wiki` (existence and mechanic-currency mapping confirmed, but
`mods` is a representative prefix, not exact wording); Abyss Tablet
`low`/`poe2db` (existence confirmed, `mods` unconfirmed guesswork).
`meta-config.ts`'s `toRawTablet`/`mergeTablets` extended to parse and
merge both new fields from a user's meta.json the same way as
mods/tags/enabled/rewards (unrecognized values fall back rather than
crashing) — documented in README's "Tuning the scoring" section. Not
wired into any scoring or UI yet — informational only, same starting
point `tags` had.

**Verified:** `npx tsc --noEmit` and `npm run build` clean; a quick
esbuild+node check confirms all 7 bundled tablets resolve the expected
confidence/source pair.

## Confidence-aware scoring: end-stage multiplier only (2026-07-04, later same day)

Wires the `confidence` field added above into `adapter.ts`'s `rankTablets`
so `"low"`-confidence data (currently just Abyss Tablet) can't outrank
`"high"`-confidence data purely by a thin scoring margin. Deliberately
minimal per the request's own constraints: `getConfidenceMultiplier`
(`tablets.ts`) — `high` → ×1.0, `medium` → ×0.92, `low` → ×0.8 — is applied
once, after `statFit + rewardScore` are already combined and clamped into
`baseFit`, never folded into either of those calculations, and
`scoreToRating`'s 20/40/60/80 bands are untouched (a lower `fit` can still
shift a tablet's letter grade, same as any other score change always
could — the bands themselves weren't touched). Skipped the prompt's
optional "debug" field on the ranked entry: nothing in this pipeline
consumes it, so it would've been dead code.

**Verified:** `npx tsc --noEmit`/`npm run build` clean. Ad-hoc check
against an Abyss-leaning synthetic waystone: Abyss Tablet's fit dropped
from 29/100 (top) pre-multiplier to 23/100 (3rd, tied-ish with Breach)
post-multiplier — Delirium (`medium`) now ranks above it instead of the
reverse, confirming the multiplier does what it's for without a rewrite of
`statFit`/`rewardScore`.

## rewardScore economic differentiation: retuned the existing lever, not a second one (2026-07-04, later same day)

A request to make different mechanics' rewards "not treated equally"
proposed a new `REWARD_VALUE_WEIGHTS` table keyed on `reward.type`
(`{breach: 1.1, ritual: 0.9, currency: 1.3, ...}`), multiplied into
`computeRewardScore`'s total. Didn't implement as specified — two real
problems: `Reward["type"]` is only ever `"currency"`/`"mechanic"`/
`"generic"` (the reward's *shape*), never a mechanic name, so a table keyed
on mechanic names against `.type` would never match anything but the
`?? 1` fallback; and `rewards.ts` already has exactly this lever
(`MECHANIC_VALUES`, keyed on the mechanic's real id via `reward.id`) — a
second one would just be redundant and risk drifting out of sync with the
first, the exact failure mode `MECHANIC_VALUES`'s own doc comment says it
exists to prevent.

Achieved the actual requested *outcome* (Delirium/Expedition favored,
Ritual reduced, no extreme shift, still deterministic, no new fields, no
UI change) by widening the existing `MECHANIC_VALUES` spread instead:
delirium 9→10, expedition 8→9, ritual 6→5; breach/abyss unchanged at 7.
Added a doc comment on `rewardContribution` explaining why a second table
was rejected, so this isn't re-proposed from scratch next time.

**Verified:** `npx tsc --noEmit`/`npm run build` clean. Isolated
`computeRewardScore` check (bundled `rewards.ts` alone, one `"mechanic"`
reward per mechanic id): delirium=10, expedition=9, breach=abyss=7,
ritual=5 — matches the intended ordering by hand.

## Waystone-vs-tablet synergy bonus (2026-07-04, later same day)

Adds a small bonus rewarding a tablet whose mechanic synergizes with what
*this specific waystone* is actually strong in (e.g. a high-pack-size
waystone favoring Delirium/Breach) — independent of `bestMechanicDef`,
`rankTablets`' existing single mechanic-fit parameter. Two adjustments
from the request as given, both to match the real codebase rather than an
imagined one: the synergy map's stat names had to be real `StatKey`s
(`packSize`/`itemRarity`/etc., not `pack_size`/`monster_density`/
`magic_monsters` — the last two aren't tracked stats in this app at all,
see KNOWN_ISSUES.md #2, so the nearest tracked proxy was substituted:
`monsterEffectiveness` for Breach's "magic monsters", `monsterRarity` for
Delirium/Abyss's "monster density"); and there's no `tablet.mechanics`
field to key off, so `computeSynergyBonus` (`adapter.ts`) reads the
tablet's existing `tags` (already `["breach"]`/`["delirium"]`/etc. per
`tablets.ts`) instead of adding a new one.

Each synergy stat is normalized via `NORMALIZE_CAP` (same 0-1 scale
`scoreMechanicFit` already uses, so no single stat's raw magnitude
dominates) and split evenly across however many stats that mechanic lists,
capped at 10. Wired into `rankTablets` exactly at the requested point:
`baseFit` (statFit + rewardScore, already existed) → + synergy bonus →
re-clamp → × confidence multiplier (already existed) → final clamp.
`rankTablets` and its one call site (`analyzeWaystoneText`) now also take
the waystone's own `ModStats` so the bonus has something to read.

**Verified:** `npx tsc --noEmit`/`npm run build` clean. Ran the same
synthetic waystone at Pack Size 10% vs 100% (holding Item Rarity/Monster
Rarity fixed): Delirium Tablet's fit went 21→38 and Breach Tablet's
18→25, while Expedition Tablet (no pack-size synergy entry) stayed flat at
14 — confirms the bonus differentiates by the waystone's own stats, not
just by which mechanic got picked as best-fit.

## Diminishing returns on the synergy bonus (2026-07-04, later same day)

Follow-up to the synergy bonus above: capped how much of it a weak tablet
can cash in, so a low `baseFit` (weak `statFit`/`rewardScore`) tablet can't
ride a maxed synergy roll to a misleadingly high rank. Implemented exactly
as requested (it matched the real pipeline's actual variable names this
time — `statFit`/`rewardScore`/`baseFit`/`synergyBonus`/
`computeSynergyBonus`/`getConfidenceMultiplier` all real, no adaptation
needed): in `rankTablets` (`adapter.ts`), `rawSynergy` passes through
untouched up to `baseFit * 0.5`; past that point it tapers to a 25%
marginal rate, then the existing `SYNERGY_CAP` (10) still applies on top —
smooth, no hard cutoff. `statFit`, `rewardScore`, `computeSynergyBonus`
itself, and the confidence multiplier step are all untouched; no new
fields.

Given `SYNERGY_CAP` is already 10, the math only actually engages when
`baseFit < 20` (`maxAllowedBonus = baseFit * 0.5 < 10`) — anything
stronger already gets the full synergy bonus it would have gotten before,
matching "preserve strong tablets benefiting from synergy."

**Verified:** `npx tsc --noEmit`/`npm run build` clean. Hand-checked the
formula directly: a weak tablet (`baseFit=8`) with a maxed synergy roll
(`rawSynergy=10`) now lands at `adjusted=13.5` instead of the uncapped
`18`; a strong tablet (`baseFit=50`) with the same maxed synergy still
gets the full `+10` (`adjusted=60`), unaffected — confirms the taper only
bites where it's supposed to.

## Real bug found: `.toggle-btn` pushed off-panel by the "god" tier badge (2026-07-04, later same day)

A request came in describing a toggle-button bug ("no longer appears, UI
stuck in Compact") with a specific diagnosis: button rendered inside
`.body-full`, hidden by that mode's opacity/pointer-events rule. Checked
`RelicPanel.ts` first rather than applying the prescribed fix — the
diagnosis didn't match this codebase: the button was already inside
`.p-head` (a `.bodies` sibling, never touched by the `.body` opacity
rule), already wired via `addEventListener` (no inline `onclick`), already
right-aligned (`.p-sub`'s `flex: 1` pushes everything after it to the
header's right edge). Asked the user to confirm it was a real, reproduced
bug rather than a hypothetical scenario — they confirmed it was real.

Reproduced it properly instead of trusting the (wrong) diagnosis:
installed Playwright headless Chromium temporarily (`npm install --no-save
playwright`, removed afterward — never added to `package.json`/lockfile)
and drove the actual running `vite` dev server, since a transparent
always-on-top overlay window can't be screenshotted meaningfully (see the
M1 compositor investigation) but a plain browser tab rendering the same
DOM/CSS can be inspected directly. `.toggle-btn` reported `visible: true`
and correct event wiring — but its bounding box put it exactly at the
viewport's right edge (`x` == viewport width, in both a 700px and a
1920px test), while the panel itself sat correctly on-screen. Walked every
`.p-head` child's bounding box: `.badge` (dev's default mock tier is
`"god"`, `main.ts`) was rendering at `134.5px` wide for its
`"LEGENDAIRE ✦"` label — the longest of the five tier labels — which,
combined with the other non-shrinking header children, exceeded
`.p-head`'s ~266px content budget even with `.p-sub` (the intended
shrink-to-absorb-overflow spacer) already collapsed to 0px. With
`overflow: visible` on `.panel`/`.p-head`, the excess didn't clip — it
pushed `.badge` and `.toggle-btn` bodily past the panel's right edge, off
the visible viewport entirely. Real, but tier-dependent: only the longest
label (`god`/`"LEGENDAIRE ✦"`) triggers it, which lines up with a player
noticing it specifically when they'd be most excited (a Legendaire
waystone) and least able to reach the toggle to see Full mode.

**Fix** (`panel.css`, no JS/wiring/mode-logic touched, matching the
constraint list from the original request even though the diagnosis
itself was wrong): tightened `.p-head`'s `gap` 8px→6px and `.p-title`'s
`letter-spacing` 2.5px→1.5px (small, reclaims a little room for every
tier); gave `.badge` a `max-width: 96px` + `overflow: hidden` +
`text-overflow: ellipsis` safety cap alongside a tightened
`letter-spacing`/`padding` — the four shorter labels (Faible/Moyen/Bon/
Excellent) still render in full, only the outlier `"LEGENDAIRE ✦"` now
ellipsizes (loses just the trailing `✦`, verified via `scrollWidth` 115 vs
`clientWidth` 94) rather than blowing the layout budget. This caps the
*worst case* instead of hoping every current/future label fits, so it
can't recur with a longer label later either.

**Verified:** re-ran the same Playwright check after the fix — `.badge`
now stays ≤96px, `.toggle-btn`'s right edge lands at `x=1897` inside the
panel's `1616-1908` bounds (previously `x=1920-1946`, off the 1920px
viewport entirely), clicking it still flips `.overlay`'s class from
`mode-compact` to `mode-full` and back with zero console/page errors.
Full mode's own header (578px wide at this panel size) was never at risk
— confirmed its toggle button still sits comfortably inside the panel
too. `npx tsc --noEmit`/`npm run build` clean (CSS-only change).
Playwright and its browser binary were removed after verification, not
left as a project dependency.
