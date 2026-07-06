# Waystone Overlay

A small always-on-top overlay for Path of Exile 2 that reads a Waystone you're
hovering and tells you, at a glance, whether it's juicy enough to run and
which tablet/mechanic to pair it with — without alt-tabbing out of the game.

## What it does

1. In-game, hover a Waystone and press **Ins** — the overlay simulates the
   Ctrl+C for you (no manual copy needed), scores the map, and shows a
   **Juice Score** (0-100), a juiciness level (**Faible / Moyen / Bon /
   Excellent / Legendaire**), a verdict (**Skip / Run / Garder**), and the
   best mechanic + tablet to match it with.
2. Press **Shift+Ins** any time to switch between the compact vertical card
   and the full three-column breakdown.
3. Press **Ctrl+Ins** to compare your last 2-3 analyzed Waystones side by
   side, with the best Juice Score starred and highlighted.

The overlay is click-through everywhere except its own buttons and the
Full-mode modifier list, so it never blocks a click into the game underneath.
A Legendaire find also fires a native OS notification, in case you miss it
mid-fight.

## Requirements

- Windows 10/11
- [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) —
  usually already installed on modern Windows; if the overlay won't launch,
  install this first.

## Install

Run the installer from a release build (`src-tauri/target/release/bundle/nsis/`
after running `npm run tauri build`, or wherever you obtained the `.exe`
installer). It installs per-user — no admin rights needed — and adds a Start
Menu shortcut.

To uninstall, use **Settings → Apps** and remove "waystone-overlay" like any
other app.

## Usage

| Key | Action |
|---|---|
| **Ins** | Analyze the Waystone you're hovering (auto-copies it first) |
| **Shift+Ins** | Toggle between Compact and Full layout |
| **Ctrl+Ins** | Toggle Compare mode (needs 2+ waystones analyzed already) |

These are **global shortcuts** — they work even while the game has focus.
Whatever was on your clipboard before pressing Ins is restored afterward.

### Reading the overlay

- **Juice Score** — a single 0-100 number measuring real farming value:
  Item Rarity, Monster Rarity, Pack Size, Monster Effectiveness, and
  Waystone Drop Chance (each as a % of a "god map" reference), plus
  mechanic density and stacking synergy for extra content
  (Ritual/Breach/Delirium/Expedition, ...). Danger/annoyance mods
  (reflect, no leech, no regen, fast monsters, elemental penetration, ...)
  scale the score down (x0.95 / x0.85 / x0.7 for low/medium/high danger) —
  a great-but-deadly map lands measurably below its safe equivalent, but
  good loot stats still clearly outweigh the penalty.
- **Juiciness badge / verdict chip** — `FAIBLE` → `MOYEN` → `BON` →
  `EXCELLENT` → `LEGENDAIRE`, paired with a **Skip / Run / Garder** verdict.
  Both are driven by the (danger-adjusted) Juice Score.
- **Top Tablets / Mechanic Match** (Full mode) — which league mechanic best
  matches this Waystone's stats, and which tablet to slot for it. See
  [KNOWN_ISSUES.md](KNOWN_ISSUES.md) for the current tablet list's scope.
- **Warning strip** — every detected danger/annoyance mod, shown
  independently of the score. Compact mode and the header's mini badge show
  only the single most severe one (space-constrained); Full mode's Insights
  column lists all of them.
- **Danger level** — a `Safe`/`Manageable`/`Dangerous`/`Very Dangerous`
  signal derived only from the warnings above (never from the score).
  Compact mode appends a short tag to the warning strip (e.g. "· High");
  Full mode shows it next to the Insights heading. A map can be both
  `S`-tier juicy and `Very Dangerous` at the same time — that's expected,
  not a bug.

Full mode additionally breaks down exactly where the score came from and
lists every detected modifier.

### Tuning via meta.json

NOTE:
Scoring weights, thresholds, and mod patterns are currently hardcoded in
`src/analyzer/scoring.ts`.

`meta.json` only controls:
- mechanics
- tablets
- rewards
- enable/disable flags

It does NOT affect scoring weights.

An editable `meta.json` lives in the app's config directory (seeded on
first run from `src-tauri/default-meta.json`). Edit it and restart the
overlay to pick up changes — no rebuild needed.

**Adding a tablet** doesn't need a code change either: add an entry to
`meta.json`'s `"tablets"` array with a name and its mods written as plain
PoE2-style text — the same tolerant mod parser used for waystones reads
them, and the tablet is automatically ranked against every mechanic by how
well its stats fit (no per-mechanic name list to maintain):

```json
{
  "metas": { ... },
  "tablets": [
    {
      "name": "Legion Tablet",
      "mods": ["40% increased Pack Size", "20% increased Monster Rarity"],
      "tags": ["legion"]
    },
    { "name": "Ritual Tablet", "enabled": false }
  ]
}
```

An entry whose `name` matches a bundled default (case-insensitive) overrides
that default's mods/tags/enabled/rewards/confidence/source; any other name
is added as a new tablet. `"enabled": false` hides a tablet from
recommendations without deleting its definition — no `mods` needed for
that case, only `enabled`.

A tablet can also declare how reliable its own data is — informational
only today (not used in scoring), but visible on the entry for future
filtering/UI:

```json
{ "name": "Legion Tablet", "mods": [...], "confidence": "low", "source": "manual" }
```

`confidence` is `"high"` / `"medium"` / `"low"`; `source` is `"wiki"`
(triangulated against community wiki/guide text), `"poe2db"`
(data-mined game files — confirms the item exists, not necessarily exact
wording), `"community"` (a single unconfirmed source), or `"manual"`
(hand-guessed). Both default to `"medium"`/unset if omitted.

**Rewards** (optional) let a tablet's ranking reflect value the six generic
stats can't express — real mechanic-specific currency, mainly, since PoE2's
actual Breach/Expedition/Delirium/Ritual/Abyss tablets mostly grant
Splinters/Artifacts/Tribute rather than boosting the stats above. Add a
`"rewards"` array to any tablet entry:

```json
{
  "name": "Delirium Tablet",
  "mods": ["20% increased Pack Size"],
  "rewards": [
    { "type": "mechanic", "id": "delirium", "value": 9 },
    { "type": "currency", "id": "simulacrum_splinter", "weight": 3 }
  ]
}
```

Three reward shapes: `"mechanic"` (contributes that mechanic's value —
looked up in `src/analyzer/rewards.ts`'s `MECHANIC_VALUES` table first, so
every tablet citing the same mechanic stays consistent, falling back to
this entry's own `value` for an unlisted mechanic), `"currency"`
(contributes `weight` scaled by one shared multiplier), and `"generic"`
(contributes `score` directly). A tablet without `"rewards"` is ranked
purely on its stats, exactly as before this existed.

## Known issues

See [KNOWN_ISSUES.md](KNOWN_ISSUES.md) — most importantly, the overlay can
occasionally render as a black or invisible rectangle. This is a known,
unresolved WebView2/graphics-driver compositor issue, not something a
restart of the game fixes. Read that file before reporting it as a new bug.

## For developers

Project structure, build instructions, the full UI spec, and the milestone
implementation log all live in [docs/](docs/):

- [`docs/overlay-ui-spec.md`](docs/overlay-ui-spec.md) — the locked visual/
  behavioral spec (dimensions, colors, animations, data contract).
- [`docs/implementation-plan.md`](docs/implementation-plan.md) — milestone-
  by-milestone build log, including the full compositor-bug investigation
  and the cahier des charges rework (Juice Score, Mechanic Match, Compare
  mode).
- [`docs/release-checklist.md`](docs/release-checklist.md) — what to verify
  before shipping a new build.

### Requirements (build from source)

- [Node.js](https://nodejs.org/) 20+ and npm
- [Rust](https://www.rust-lang.org/tools/install) (stable) + Cargo
- Windows: [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)
  (usually preinstalled) + the "Desktop development with C++" workload from
  Visual Studio Build Tools (Tauri's Windows requirement)

### Setup

```bash
git clone <repo-url>
cd poe2-waystone-analyzer-v3
npm install
cp .env.example .env   # only if you need to override a VITE_ var — optional
```

### Dev

```bash
npm run dev          # frontend only, plain browser (localhost:5173)
npm run tauri:dev     # full app — Tauri window + Rust backend + hot reload
```

### Build

```bash
npm run build         # type-check + frontend production build (dist/)
npm run tauri:build   # release installer (src-tauri/target/release/bundle/)
npm run verify-adapter  # contract-tests the scoring/parsing pipeline
```

### Multi-machine workflow (2+ PCs on the same repo)

```bash
# first time on a new machine
git clone <repo-url>
cd poe2-waystone-analyzer-v3
npm install

# before you start working — always pull first
git pull

# after you're done — stage, commit, push
git add -A
git commit -m "describe what changed"
git push

# switching to the other PC: repeat `git pull` before editing there too
```

If both machines have uncommitted changes to the same file, `git pull` will
ask you to commit or stash first — commit locally, then `git pull` again to
merge (or `git stash`, pull, `git stash pop` if it's throwaway work).
