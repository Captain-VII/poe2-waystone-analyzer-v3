# Waystone Analyzer — Overlay UI Implementation Spec

Status: **locked** (validated 2026-07-03 against the live mockup:
https://claude.ai/code/artifact/12964401-e4ff-454d-8fb2-aee72523fc55).
The mockup is the visual source of truth; this document is the engineering contract.

Goal: after pressing **Ins**, the player understands in under one second whether the
Waystone is worth running and which tablets to use.

---

## 1. Design tokens

### 1.1 Colors

| Token | Hex | Usage |
|---|---|---|
| `panel-a` | `#12100D` | Panel background gradient start |
| `panel-b` | `#18130F` | Panel background gradient end |
| `header-a` | `#241A10` | Header gradient start |
| `header-b` | `#1D140C` | Header gradient end |
| `gold-dim` | `#8A6526` | Tarnished gold — outer panel border |
| `gold` | `#B88735` | Ornaments, separators, ranks, footer kbd |
| `gold-hi` | `#F0B84A` | Accents: deltas, bar fill end, hover states |
| `god` | `#FFD36A` | God tier only: badge, halo, sparks, corners/clasp tint |
| `ivory` | `#F1E6C8` | Primary text |
| `grey` | `#B8A98A` | Secondary text, labels, mod prose |
| `danger` | `#B54A3A` | Warnings, dangerous mods, penalty bar |
| `track` | `#2A2118` | Breakdown bar track |

Alpha conventions (rgba of `gold` `184,135,53` unless noted):
separators `.30–.35`, inner relic stroke `.20`, section-heading underline `.18`,
column dividers `.30`, footer/toggle borders `.25–.40`,
warning strip background `rgba(181,74,58,.12)`.

### 1.2 Surface treatment (both modes)

- Background: `linear-gradient(panel-a → panel-b)` **plus** two soft radial stains
  (`rgba(0,0,0,.30)` upper-right ~230×140, `rgba(40,28,15,.45)` lower-left ~260×170).
- Grain: SVG `feTurbulence` noise overlay at **9%** opacity (panel), 5% (scene, if any).
- Border: `1px solid gold-dim`, radius **4px**; inner stroke `1px rgba(gold,.20)` inset 3px.
- Bevel: `inset 0 1px 0 rgba(241,230,200,.05)` + `inset 0 -1px 0 rgba(0,0,0,.45)`.
- Drop shadow: `0 8px 28px rgba(0,0,0,.60)`. Panel opacity **0.96**.
- Ornaments (inline SVG, `currentColor`, default `gold`, God tier `god`):
  - 4 corner filigrees **26×26**, offset **−5px** past the border, double curl +
    rotated-square finial + rivet dot; `drop-shadow(0 0 2px rgba(0,0,0,.8))`.
  - Top-center diamond **clasp** 22×11, offset −5px.
- Header: gradient `header-a → header-b`, bottom border `rgba(gold,.30)`,
  embossed inset (`inset 0 1px 0 rgba(241,230,200,.04)`, `inset 0 -1px 0 rgba(0,0,0,.5)`).

### 1.3 Typography

| Role | Face | Size | Weight | Treatment |
|---|---|---|---|---|
| Panel title | Display serif | 15px | 600 | Uppercase, +2.5px tracking, `text-shadow 0 1px 2px rgba(0,0,0,.7)` |
| Heat score (Compact) | Display serif | **48px** | 700 | Tabular numerals, line-height 1 |
| Heat score (Full) | Display serif | 29px | 700 | Tabular numerals |
| Tier badge / verdict chip | Display serif | 12–13px | 700 | Uppercase, +1.5px (badge) / +3px (chip) tracking |
| Tier name | Display serif | 15px | 400 | Single line, ellipsis |
| Section headings | Body sans | 11px | 600 | Uppercase, +1.5px tracking, `grey` |
| Body / mods / tablet names | Body sans | 13px | 400 | Line-height 1.45 |
| Tablet reasons / secondary | Body sans | 11px | 400 | `grey` |
| Warnings | Body sans | 11.5px | 600 | `danger` |
| Footer / eyebrow labels | Body sans | 9–10.5px | 400 | Uppercase, +2–3px tracking |

Faces: display `"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif`;
body `"Segoe UI", "Trebuchet MS", system-ui, sans-serif`. Both are system faces on
Windows — no font loading required. `font-variant-numeric: tabular-nums` on every
numeric field (score, deltas, breakdown values) so pulses never cause jitter.

---

## 2. Anchoring & safe zone

- Anchor **top-right**: `x = screenW − panelW − pad`, `y = pad`.
- `pad = 20px` default; **14px** when viewport `< 1600w` or `< 900h`.
- **Full mode micro-shift**: translate `(−16px, +16px)`, animated as part of the
  expand transition. Compact sits exactly at the anchor (no shift).
- Fallback cascade (evaluate before every render, and on any resize/DPI/display change):
  1. Requested mode fits → use it.
  2. Full doesn't fit → force Compact, but remember the *intended* mode and restore
     it automatically when space returns.
  3. Compact doesn't fit → **Mini Compact** `240×84`: single row —
     glyph, score, tier badge, verdict chip, toggle; warning collapses to a ⚠ icon.
- Clamp: no edge may ever leave the screen.
- Height contingency (pre-agreed): if 392px Compact overlaps the real game HUD,
  compress to **~360px** by trimming air only — hero paddings 10/13→6/9, score 48→42,
  chip margin 9→6 & padding 4→3, tablet row padding 3→2, tablets top pad 8→6,
  warning margin 9→6, footer trim. Never drop the score, verdict chip, or any of
  the three tablets. Never revert to a horizontal layout.
- Input: window is click-through except the toggle button, footer button, and the
  Full-mode modifier scroll region (Electron: `setIgnoreMouseEvents(true, {forward:true})`
  with pointer-tracked interactive zones; Tauri: equivalent hit-test regions).

---

## 3. Modes

Two mutually exclusive modes held in a single state field — never two booleans:

```
mode: "compact" | "full"        // user-facing state, persisted
intendedMode: "compact" | "full" // survives forced fallbacks
```

Toggle sources (all dispatch the same action): header button (`⤢`/`⤡`),
**Shift+Ins**. **Ins** alone triggers analysis + refresh in the current mode.

---

## 4. Compact mode — vertical quick-decision card

**292 × 392 px.** Read order: score → verdict → tablets → warning.

```
┌──────────────────────────────┐
│ ◈ WAYSTONE      [S+]    [⤢] │  Header 40px
├──────────────────────────────┤
│            HEAT              │  eyebrow 9px/+3px tracking
│           94.2               │  score 48px, halo behind (God)
│         Perfect roll         │  tier name 15px serif
│        ◆  JUICE  ◆          │  verdict chip
│──────────gold sep───────────│
│ TOP TABLETS                  │
│ I   Irradiated Prec.  +12.3  │  name 13px + delta gold
│     Best quantity scaling…   │  reason 11px grey
│ II  Overseer Prec.     +8.1  │
│     Adds rare packs…         │
│ III Domination Prec.   +5.4  │
│     Extra shrines, low risk  │
│ ▌⚠ Avoid ele-reflect builds │  warning strip (conditional)
│ [ Ins ]  ANALYZE WAYSTONE    │  footer button, pinned bottom
└──────────────────────────────┘
```

| Region | Spec |
|---|---|
| Header | 40px; glyph 16px, title, badge (pill, serif 12px), toggle 26×26 |
| Hero | Centered column, padding `10px 16px 13px`; eyebrow → score → tier name (+2px) → chip (+9px) |
| Verdict chip | Serif 13px/700/+3px tracking, padding `4px 16px`, `1px solid tier-color`, text `tier-color`, bg `rgba(0,0,0,.25)`, radius 2px, `◆` flankers (8px, .55 opacity). God adds `0 0 10px rgba(255,211,106,.25)` |
| Separator | 1px gradient gold `.35`, fades at ends, inset 12px |
| Tablets | Section heading + exactly 3 entries; entry = rank numeral (serif, gold-hi, 16px col) + name (ellipsis) + delta (gold-hi, tabular) on line 1, reason 11px grey indented 24px on line 2; row padding 3px 0 |
| Warning strip | Max **one**; `margin 9px 14px 0`, `padding 5px 10px`, 2px `danger` left rule, `rgba(181,74,58,.12)` bg, 11.5px/600. Hidden entirely when null |
| Footer | Button pinned via `margin-top:auto`, `margin 0 14px 10px`, `padding 6px`, 10.5px uppercase +2px tracking grey, `kbd` chip for "Ins"; hover → gold-hi text/border; click = analyze |

Excluded from Compact by design: score breakdown, modifier list, insights,
multi-line warnings, any dense rows.

Verdict mapping (from analyzer, but defaults if absent):
`trash → TRASH`, `low → MODIFY`, `good → RUN`, `splus → JUICE`, `god → JUICE`.

---

## 5. Full mode — three-column analysis panel

**580 × 332 px**, micro-shifted (−16,+16). Header 44px (Compact header + waystone
subtitle "T15 · Sovereign's Path", 12px grey, ellipsis; toggle glyph flips to ⤡).

Grid: `30fr | 34fr | 36fr`, body padding `14px 18px 16px`, 16px gutters,
`1px rgba(gold,.30)` dividers with 16px padding-left on columns 2–3.
Section headings gain `4px` bottom padding + `1px rgba(gold,.18)` underline.

| Column | Content |
|---|---|
| 1 — Detected Modifiers | Scrollable list (thin 3px gold scrollbar, 16px bottom fade mask). Row: 13px, `padding 2px 0`, prose in `grey` with **numeric values bold ivory**; positive rows prefixed `▴` (gold-hi 11px); danger rows fully `danger` + `⚠`; neutral rows `rgba(grey,.7)`, no icon |
| 2 — Heat Breakdown | Score 29px + mini badge; then one bar row per breakdown entry: label (58px, grey, 12px) + bar (5px tall, track `track` w/ inset shadow, fill `gold→gold-hi` gradient, radius 2px) + value (44px right-aligned tabular). Penalty row: danger fill + danger value. Total row pinned bottom: 1px gold `.35` top border, serif label 11px + serif value 16px tier-colored |
| 3 — Tablets & Insights | Top Tablets: up to 4 dense rows (rank/name/delta, 23px). Gold fade separator. Insights: warning line first (danger, ⚠), then 2–3 lines `◆`-bulleted, 12px grey, line-height 1.5 |

Bar width = `abs(value) / 35 * 100%`, clamped to 100 (35 = expected max single
contribution; recalibrate constant if scoring changes).

---

## 6. Tier states

Tier class applied at the panel root; everything derives from it.

| Tier | `--tier` | Badge | Glow | Corners/clasp | Verdict |
|---|---|---|---|---|---|
| `trash` | `#8A5A4A` | Outline only | None | gold | TRASH |
| `low` | `#8C93A0` | Outline only | None | gold | MODIFY |
| `good` | `#D9B45F` | Outline + `0 0 8px rgba(240,184,74,.25)` | Subtle | gold | RUN |
| `splus` | `#F0B84A` | + bg `rgba(240,184,74,.08)`, `0 0 12px .45` | Light | gold | JUICE |
| `god` | `#FFD36A` | Gold-filled gradient bg, ivory text, `0 0 8px rgba(255,211,106,.7)` + `0 0 18px .25` | Halo + sparks + score text-shadow | **god tint** | JUICE |

God-tier extras ("premium, not loud"):
- Halo behind score only: radial `rgba(255,211,106,.22) → .08 @45% → transparent @68%`;
  132px Compact / 100px Full; fades in 500ms; static afterwards (no loop).
- Score & total text-shadow: `0 0 14px rgba(255,211,106,.35)` / `0 0 10px .30`.
- Halo/sparks clipped to panel bounds + 12px bleed — must never reach the minimap.

Tier colors are score-tier semantics; `danger` red is a separate channel and never
counts as tier styling. Danger meaning never rests on color alone (always ⚠ / ▌rule).

---

## 7. Animations

GPU-safe properties only (`transform`, `opacity`, `box-shadow` on small elements).
Every effect decays to a static state — nothing loops during gameplay.

| Name | Trigger | Effect | Duration / easing |
|---|---|---|---|
| Score pulse | Analyze (Ins/footer) | scale 1 → 1.12 → 1 | 380ms `cubic-bezier(.2,.9,.3,1.2)` |
| Badge + chip flare | Analyze | box-shadow flares to `0 0 22px tier` @30%, settles | 400ms ease-out |
| Bar sweep | Analyze / tier change / entering Full | widths 0 → value | 450ms ease-out |
| Mode morph | Toggle | Panel width/height transition + micro-shift translate; bodies cross-fade (outgoing opacity→0 scale→.97, incoming reverse) | 220ms ease-in-out (fade 180ms) |
| God halo | God tier detected | opacity 0 → 1, then static | 500ms ease |
| Sparks | Analyze while God | **5** particles, 3px, `god` + `0 0 5px` glow, radial drift 18–28px, staggered 0–120ms, fade+shrink | 900ms ease-out, one-shot |
| Warning reveal | Warning appears | Single fade/underline sweep, no flashing | 250ms |

Re-trigger pattern: remove class → force reflow → re-add; remove on `animationend`.

---

## 8. Keyboard shortcuts

| Key | Action |
|---|---|
| **Ins** | Run analysis, refresh data, fire pulse/flare/bars (+sparks if God). Works in either mode; if overlay hidden, show in last persisted mode |
| **Shift+Ins** | Toggle Compact ⇄ Full (updates `mode` and `intendedMode`, persists) |

Register as **global hotkeys** at the app layer (game has focus, not the overlay).
Guard against key-repeat: ignore repeats while an analyze animation is in flight.

---

## 9. Persistence

Config (file-based settings store; localStorage acceptable for web-view shells):

| Key | Type | Default | Written |
|---|---|---|---|
| `overlay.mode` | `"compact" \| "full"` | `"compact"` | On every toggle |
| `overlay.intendedMode` | same | mirrors mode | On user-initiated toggle only (not fallback) |
| `overlay.reduceEffects` | boolean | `false` | On settings change |

Read **before first render** — the panel must appear directly in the persisted mode
with no flash of the wrong layout.

---

## 10. Reduced motion / effects

Two independent inputs, OR-ed together:
1. OS `prefers-reduced-motion: reduce`.
2. User setting **Reduce effects** (`overlay.reduceEffects`).

When active: no score pulse, no flares, no sparks; bars set width instantly;
mode toggle may keep a fast (≤100ms) opacity fade; halo renders **statically**
(tier color states are information and are always kept). Tier colors, badge fills,
warning strips: never disabled.

---

## 11. Data contract — analyzer → overlay

The overlay is a pure renderer of one immutable object per analysis:

```ts
type TierClass = "trash" | "low" | "good" | "splus" | "god";
type Verdict   = "TRASH" | "MODIFY" | "RUN" | "JUICE";

interface AnalysisResult {
  waystone: {
    tier: number;              // 15
    name: string;              // "Waystone of the Sovereign" (Full header subtitle)
    corrupted: boolean;
    modCount: number;
  };

  heat: {
    score: number;             // render with 1 decimal, tabular
    tierClass: TierClass;      // drives ALL visual state
    tierLabel: string;         // "Perfect roll" — Compact hero, 1 line
    verdict: Verdict;          // Compact chip; fallback map from tierClass if absent
    breakdown: Array<{         // Full col 2, in display order; sums to score
      key: "base" | "quantity" | "rarity" | "density" | "penalty" | string;
      label: string;           // "Base T15"
      value: number;           // signed; negative ⇒ danger styling
    }>;
  };

  modifiers: Array<{           // Full col 1, pre-sorted: danger > positive > neutral
    text: string;              // "+38% Item Quantity" — highlight leading numeric bold ivory
    kind: "positive" | "neutral" | "danger";
  }>;

  tablets: Array<{             // sorted by delta desc; Compact takes 3, Full up to 4
    name: string;              // "Irradiated Precursor"
    delta: number;             // heat gain, "+12.3"
    reason: string;            // Compact one-liner, ≤ ~40 chars
  }>;

  warning: string | null;      // AT MOST ONE line, ≤ ~34 chars (Compact strip width)
  insights: string[];          // 0–3 short lines, Full mode only
}
```

Contract rules the analyzer must honor (the overlay does not re-derive):
- `tierClass` and `verdict` are computed analyzer-side — the UI never thresholds `score`.
- `warning` is the single most important caveat, already truncated to one line.
- `tablets[].reason` is written for the Compact card (short, imperative).
- `breakdown` values are display-final (already weighted/rounded to 1 decimal).

---

## 12. Component structure

Framework-agnostic tree (maps 1:1 to React/Solid components or vanilla modules):

```
OverlayApp
├─ HotkeyManager            global Ins / Shift+Ins registration
├─ SettingsStore            mode, intendedMode, reduceEffects (persisted)
├─ PlacementEngine          anchor math, safe-zone pad, micro-shift,
│                           fallback cascade, clamping, DPI/display events
└─ RelicPanel               frame: gradient, stains, grain, borders, bevel,
    │                       CornerOrnament ×4, Clasp, tier class on root
    ├─ PanelHeader
    │   ├─ WaystoneGlyph
    │   ├─ Title / Subtitle (subtitle Full-only)
    │   ├─ TierBadge        shared with BreakdownColumn (size variant)
    │   └─ ModeToggleButton
    ├─ CompactBody          (mode === "compact")
    │   ├─ HeatHero         eyebrow + HeatScore + tierLabel + VerdictChip
    │   ├─ GoldSeparator
    │   ├─ TabletList       variant="reasoned" (3, two-line entries)
    │   ├─ WarningStrip     (warning != null)
    │   └─ AnalyzeFooter    button → analyze()
    ├─ FullBody             (mode === "full")
    │   ├─ ModifierColumn   ModRow ×n, scroll + fade mask
    │   ├─ BreakdownColumn  HeatScore(sm) + TierBadge(sm) + BreakdownBar ×n + TotalRow
    │   └─ InsightColumn    TabletList variant="dense" + InsightList (warning first)
    └─ FxLayer              Halo + SparkEmitter, absolutely positioned over the
                            active score, clipped to panel + 12px
MiniCompactBody             fallback layout (240×84), same data, no tablets
```

Shared primitives: `HeatScore`, `TierBadge`, `VerdictChip`, `TabletList`,
`GoldSeparator`, `SectionHeading`, `WarningStrip`. Tier styling flows exclusively
through the root tier class + `--tier` custom property — components never branch
on tier in JS except `FxLayer` (sparks gate on `god`).

### Window shell requirements
- Frameless, transparent, always-on-top, non-activating overlay window
  (Electron: `transparent, frame:false, alwaysOnTop:'screen-saver', focusable:false`;
  Tauri/native equivalents fine).
- Click-through by default; interactive regions (toggle, footer, mod scroll)
  re-enable input on hover.
- Re-run `PlacementEngine` on: display change, resolution/DPI change, game
  windowed/fullscreen switch.
- All px values are @100% scale — multiply by the monitor's device pixel ratio.

---

## 13. Acceptance checklist

- [ ] Overlay opens in persisted mode with zero layout flash.
- [ ] Ins → data + pulse + flare (+ sparks on God) in < 100ms after analyzer returns.
- [ ] Shift+Ins and header button both morph modes in 220ms with micro-shift.
- [ ] All five tier states render per §6; God halo never exceeds panel + 12px.
- [ ] Compact shows exactly: score, tier name, verdict chip, 3 tablets + reasons,
      ≤1 warning, footer. Nothing else.
- [ ] Safe-zone pad 20px (14px below 1600×900); no edge ever off-screen.
- [ ] Fallback: Full→Compact→Mini Compact; intended mode restored when space returns.
- [ ] Reduce effects + OS reduced-motion honored per §10.
- [ ] Game input is never blocked outside the three interactive regions.
- [ ] Score digits don't shift during pulse (tabular numerals everywhere).
