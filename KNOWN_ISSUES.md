# Known Issues

## 1. Overlay occasionally renders black or invisible (unresolved)

**Symptom:** the overlay window sometimes appears as a solid black rectangle,
or doesn't visibly render at all, on some launches but not others — with the
exact same build and settings. It can happen right at startup, or a few
seconds after the window shows, sometimes specifically when the mouse first
moves over it.

**What this is:** a non-deterministic WebView2 / DirectComposition / DWM
compositor race, most likely tied to this machine's GPU driver or WebView2
Runtime version — not a bug in the overlay's own window configuration or
layout code. In testing, this was confirmed non-deterministic: the *exact
same* configuration reproduced the issue on one launch and rendered cleanly
on the next, back to back, on the same machine. Every individual window
setting (transparency, always-on-top, decorations, skip-taskbar,
click-through) was tested in isolation and none of them reliably causes or
prevents it.

**What was tried:** an explicit DirectComposition background color, a
defensive window-resize nudge on hover, and disabling GPU compositing
(`--disable-gpu`) — none of these eliminated the issue, though the first two
are shipped anyway since they measurably reduce (not eliminate) how often it
happens.

**If you hit this:**
- Try moving the mouse away from the overlay and back, or toggling
  Compact/Full with **Shift+Ins** — this sometimes forces a fresh repaint.
- Check Windows Update / your GPU vendor's site for a driver update.
- Check for a [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)
  update — Settings → Apps → search "WebView2".
- If none of that helps, it's a known limitation of this build on this
  system, not something a restart of the overlay or the game will
  permanently fix.

Full technical writeup, including the reproduction trial log, is in
[`docs/implementation-plan.md`](docs/implementation-plan.md) under M1.

**Update (2026-07-04):** tested in a real gameplay session (overlay left open
for the session, not rapid dev-mode restarts) — no black/invisible occurrence.
This matches the theory that the bug may be specific to rapid dev-mode
restart cycling rather than a long-lived real-use overlay, but one clean
session isn't proof against a ~30-40%-per-launch flaky bug — keep watching
for it, especially right after launch or on the first hover.

## 2. Tablet pool is mostly not verified against real PoE2 tablet items — and the real system doesn't match this app's model

**As of the 2026-07-04 update below, `src/analyzer/tablets.ts` ships
exactly the six real PoE2 tablet types, all tagged `"verified"`** —
Standard/Overseer Precursor Tablet, Breach/Ritual/Delirium/Expedition
Tablet — with mods written as plain PoE2-style text (e.g. `"20% increased
Pack Size"`), parsed through the same tolerant regex `mod-parser.ts` uses
for waystone text. The rest of this entry is left as a history of how that
conclusion was reached (the earlier 17-tablet, three-confidence-level pool
is gone, not kept alongside).

**Bigger finding from the research pass that added the "verified" pair:**
PoE2's real tablet system (Precursor Tablets slotted into Atlas Towers)
mostly doesn't work like this app models it. Real mechanic-specific tablets
(Breach/Expedition/Delirium/Ritual/Abyss) boost mechanic-specific *currency*
— Breach Splinters, Expedition Artifacts, Ritual Tribute, Delirium
Simulacrum Splinters — not the six generic map stats (Item Rarity, Monster
Rarity, Pack Size, Monster Effectiveness, Waystone Drop Chance, Quantity)
this app's `mod-parser.ts`/`scoring.ts` track. Only the non-mechanic-specific
"Standard Precursor Tablet" and the boss-drop "Overseer Precursor Tablet"
actually map onto those six stats — hence only those two got the
`"verified"` tag; the mechanic-named tablets remain plausible-but-unverified
placeholders because their *real* effect is currently out of this app's
model entirely, not just unconfirmed wording. Also worth noting separately:
several mechanics in `mechanics.ts` (Legion/Heist/Sanctum/Harvest/Metamorph/
Incursion/Bestiary/Essence) don't appear to be part of PoE2's endgame tablet
system at all per this research — that's a `mechanics.ts` question, not a
tablets one, and wasn't investigated further (out of scope for this pass).

None of this is hardcoded to extend, though: tablets are matched to
mechanics by stat-fit (`scoreMechanicFit` in `mechanics.ts`), the same
weighting used to score a waystone against a mechanic — so any tablet
(real, placeholder, or user-added) is automatically eligible for whichever
mechanics its boosts fit, with no per-mechanic name list to touch. Add or
correct one via the user's `meta.json` `"tablets"` array (see README's
"Tuning the scoring" section for the exact format and an example), or edit
`DEFAULT_TABLETS` in `tablets.ts` directly — no rebuild needed for the
meta.json route, no other code changes needed either way. `mechanics.ts`'s
`recommendedTablets` field still exists but is now just an optional
fit-score bonus for curated picks, not a hard requirement for a tablet to
be recommended.

**Update (2026-07-04, same day) — partially closed:** added
`src/analyzer/rewards.ts`'s `Reward`/`computeRewardScore`, a second,
independent scoring channel for exactly the mechanic-currency value the
six-stat model can't express, without touching `StatKey`/`mod-parser.ts`/
`scoring.ts` at all (the bigger option below wasn't needed after all — see
`docs/implementation-plan.md`'s "Reward-based tablet scoring" entry for
the design). A tablet's optional `rewards` array is summed into a
`rewardScore` at load time and added on top of its stat-fit score in
`adapter.ts`'s `rankTablets`, clamped back to 0-100. Delirium/Expedition/
Ritual Tablet now declare example rewards; every other tablet is
unaffected (`rewardScore` defaults to 0 with no `rewards`). `meta.json`'s
`"tablets"` entries can set `rewards` too — see README's "Tuning the
scoring" section. Mechanic-specific tablets' currency value is now
representable; it's just not derived from real per-mechanic drop-rate data
(the `MECHANIC_VALUES` table and the three tablets' example weights are
still hand-picked, not sourced from the game).

**Update (2026-07-04, later same day) — mostly closed:** the "confirmed
those mechanics are actually part of PoE2's endgame tablet system" question
above is now answered. Cross-checked three independent sources
(poe2wiki.net, maxroll.gg, odealo.com): real PoE2 has exactly **six**
Precursor-Tower tablet types — Standard, Overseer, Breach, Ritual,
Delirium, Expedition. There is no Legion, Heist, Sanctum, Harvest,
Metamorph, Essence, Incursion, or Bestiary tablet in the game.
`src/analyzer/tablets.ts`'s `DEFAULT_TABLETS` now ships exactly those six,
all tagged `"verified"`, replacing the old 7 "original" + 8 "placeholder"
guesses entirely (removed, not kept alongside).

**Correction (2026-07-04, same day):** this entry originally also said
Abyss had no tablet at all — wrong. The three sources above happened to
predate Abyss's addition (one abyss-focused guide found separately cites
patch 0.4.0; maxroll's atlas guide, current as of patch 0.5.0, doesn't
mention it either, so this may be a moving target patch-to-patch). Checked
directly against **poe2db.tw** (data-mined from game files, not a
wiki write-up) instead: a real `Abyss Tablet` base type exists, drop level
65, "Adds Abysses to a Map," 10 uses remaining. Re-added to
`DEFAULT_TABLETS`, tagged `"verified"` — but poe2db itself doesn't expose
exact affix text ("Modifier weight information cannot be obtained from
game files"), so unlike the six Precursor-Tower types, Abyss Tablet's
`mods` here is a plausible representative roll, not confirmed wording.
It's also mechanically different from the six above: a personal-Map-Device
consumable with a limited use count, not something slotted into a
Precursor Tower to affect every map in its radius — this app doesn't model
that "uses remaining" mechanic for any tablet, Abyss included.

`mechanics.ts`'s `recommendedTablets` pins were updated to point at real
names (mostly "Standard Precursor Tablet" for mechanics with no dedicated
tablet, "Abyss Tablet" for Abyss). `rewards.ts`'s `MECHANIC_VALUES` now
lists the five mechanics with real mechanic-specific currency in-game
(delirium/expedition/breach/abyss/ritual), ordered by general community
consensus on chase-value — **that ordering itself is still not sourced
from real economic/drop-rate data**, same first-pass caveat as issue #3
below.

**Considered and rejected:** fetching poe2db.tw live at runtime (e.g. on
every analyze()) to auto-refresh tablet data. Rejected for two concrete
reasons: (1) a `fetch()` from the Tauri webview to `poe2db.tw` almost
certainly fails CORS (poe2db has no reason to allow the overlay's
`tauri://localhost` origin), and (2) this app's whole analyze path is
synchronous-and-local by design, with a documented acceptance criterion of
"Ins → pulse/flare < 100ms" (M6) — a network call on every analysis
would blow that budget and add a failure mode (offline, rate-limited,
slow) to a chat that currently has none. If this is revisited, it'd need
to be a Rust-side (`reqwest`, no CORS) background refresh on startup, never
inline with `analyze()` — not attempted here.

**Still open:** the shared generic-stat prefix pool (Quantity/Rarity/Pack
Size/Magic Monsters/Rare Monsters/Gold/Experience) that the six
Precursor-Tower types can roll from is only partially represented — each
tablet's `mods` here is one representative example prefix, not the full
roll table, and "Magic Monsters"/"Gold"/"Experience" aren't tracked stats
in this app's six-stat model at all (out of scope: would need new
`StatKey`s in `mod-parser.ts`/`scoring.ts`, a larger change than this
pass). The eight mechanics confirmed to have no real tablet (Legion/Heist/
Sanctum/Harvest/Metamorph/Essence/Incursion/Bestiary) still exist as
scoreable mechanics in `mechanics.ts` — that's real (they're still real
PoE2 league mechanics, just not ones with their own tablet), not a bug.

## 3. Juice Score weights and Mechanic Match Score formula are a first pass

The Juice Score's god-map references/weights (`src/analyzer/scoring.ts`'s
`computeBaseScore` constants — `DEFAULT_WEIGHTS` there is the *legacy
display-only* breakdown, not the score) and the Mechanic Match Score cross
(priority stat weighted 0.6, up to two secondary stats at 0.2 each,
`src/analyzer/adapter.ts`'s `computeMechanicScores`) are reasonable
first-pass formulas per the cahier des charges, not tuned against real
gameplay data.

What `meta.json` (app config dir, seeded from `src-tauri/default-meta.json`
on first run, §10) can actually override without a rebuild: each mechanic's
`priority_stat`/`secondary_stats`/`recommended_tablets`/`skip_if_below`, and
the whole `tablets` list (mods/tags/enabled/rewards/confidence/source). The
Juice Score weights, god-map references, SKIP threshold, danger patterns,
and synergy multipliers are **hardcoded in `scoring.ts`** and require an
edit + rebuild — earlier revisions of this entry wrongly claimed they were
meta.json-editable.

**Update (2026-07-08) — the Quantity cap doubt is resolved, sourced:**
web research (maxroll.gg's "Rolling Waystones and Precursor Tablets")
confirms a T15 waystone's Item Quantity mod line tops out at **(25-29)%**
— and `mod-parser.ts`'s `quantity` field is a single-line max, never a
sum (`extractMods` keeps the strongest match per stat, never adds), so
that IS the real ceiling a parsed waystone can show. `NORMALIZE_CAP.
quantity` was 200 — a perfect 29% roll only contributed ~14.5% of the
normalized signal, confirming and quantifying the suspicion below.
Lowered to **35** (headroom above the confirmed 29% max, matching
`TABLET_ROLL_CAP.quantity = 25`'s existing margin over its own ~25% real
ceiling) — mechanics.ts.

**Still unsourced, NOT changed** (same research pass, results too weak or
contradictory to act on):
- **Pack Size**: conflicting numbers between sources (~41-50% max in one
  guide, ~7-9% per-tier in another) — no clean tier table found. Worth
  noting: `scoring.ts`'s `PACK_SIZE_REFERENCE = 30` (drives the real Juice
  Score) and `mechanics.ts`'s `NORMALIZE_CAP.packSize = 150` (drives the
  Mechanic Match Score) already disagree with each other by 5x — flagged,
  not touched, since no real number is solid enough to arbitrate between
  them.
- **Monster Rarity**: no source gave a cap for the literal "increased
  Rarity of Monsters" wording `mod-parser.ts` matches. A similarly-named
  mod ("increased number of Rare Monsters", 55-65%) turned up instead —
  likely a *different* real PoE2 mod (more rare-monster packs, not rarity
  of what spawns), so not safely reusable as this stat's cap.
- **Monster Effectiveness**: only tablet numbers found (9-11% for XP
  farming builds), nothing for the waystone mod itself.
- **Waystone Drop Chance**: mechanically more complex than a single-mod
  cap — combines an innate mod-count-based scaling (a 6-modifier waystone
  reportedly guarantees a replacement drop) with a dedicated suffix mod;
  one community post claimed extreme stacked totals (over 1000%) via
  cumulative crafting/Atlas effects, not comparable to `DROP_CHANCE_
  REFERENCE = 120`'s single-waystone framing.
- **Mechanic priority-stat disagreement (informational only):** one
  source (Switchblade Gaming) ranks Ritual as "item rarity → ritual size"
  and Expedition as "pack size → rare monster mods" — contradicting the
  existing 3-source "community consensus 0.5" already cited in
  `mechanics.ts` (Ritual: monster rarity priority, item rarity explicitly
  excluded; Expedition: quantity priority). One dissenting source doesn't
  overturn a 3-source consensus on its own — logged for whoever revisits
  this with more data, nothing changed.

## 4. ~~Mechanic-presence detection is a simple keyword match~~ (resolved 2026-07-08)

"Mecanique naturelle presente sur la map" (§2/§8/§9) is detected by a regex
per mechanic (e.g. `\britual\b` for Ritual) adding a flat +15 to that
mechanic's match score.

**Update (2026-07-08):** the false-positive surface is closed — detection
now runs against `parser.ts`'s `ParsedWaystone.contentText` (every block
except the header/name block), never the item name or flavor text. A
waystone *named* "Ritual Reliquary" no longer hands Ritual an unearned +15.
Regexes were also widened for real plural phrasings ("Abysses",
"Essences").

**Update (2026-07-08, same day) — consolidated:** this same keyword logic
used to be duplicated in 3 places that could silently drift (and had: the
plural widening above only landed in `mechanics.ts`'s `detect`, not
`scoring.ts`'s two pattern tables, which fed the *actual Juice Score*'s
mechanic-density term). All three now read from one shared
`src/analyzer/mechanic-patterns.ts` (`MECHANIC_PATTERNS` plus the exact
`SYNERGY_MECHANIC_IDS`/`EXTRA_CONTENT_BONUS` subsets each consumer used),
typed so a dropped/typo'd id is a compile error, not a silent gap.

This also closed the score-side sibling of the bug above:
`evaluateMap`/`countActiveMechanics` (scoring.ts) used to read the full raw
item text, so a waystone *named* "Ritual Reliquary" inflated the real
score's mechanic-density term (§8's +10 weight, plus the ×1.1-1.6 stacking
multiplier) even with zero ritual mods — not just the mechanic-match
display bonus fixed above. Both now read `contentText`. One side effect
intentionally kept: `contentText` includes every non-header block, not
just the single isolated mod block, so an instilled enchant line living in
its own block (e.g. "Players in Area are X% Delirious" outside the mod
block) now correctly counts toward both the detect bonus and the real
score — the mod-block-only version from the first 2026-07-08 update could
have missed it.

`verify-adapter.mjs` (69 checks total) pins: the name-doesn't-count fix on
both the mechanic-match bonus AND `heat.score` itself; the instilled-
separate-block case actually being picked up; and that Abyss/Essence
plurals now move `heat.score`, not just the tablet recommendation. Still
keyword-based at heart — a mechanic phrased in a way that shares no
keyword with its regex would be missed, and a unique waystone's flavor
text (which also lives outside the header block) remains a narrow residual
false-positive surface — but the three-way drift and the header/name
surface are both closed.

## 5. Auto Ctrl+C on Ins

Pressing Ins now simulates Ctrl+C itself (via the new Rust `simulate_copy`
command, using the `enigo` crate) instead of requiring you to copy manually
first. `src/clipboard.ts` saves whatever was on the clipboard before
simulating the copy and restores it afterward (cahier des charges §4 steps
1/8), so this shouldn't clobber your normal copy/paste — but it's a
best-effort save/restore around a ~120ms window, not a guarantee under
heavy concurrent clipboard use.

**Dev-testing gotcha:** the simulated Ctrl+C is sent to whichever window
currently has OS focus, not to the overlay itself (the overlay window is
built `.focused(false)`). If a console/terminal has focus when Ctrl+C is
simulated, Windows treats it as SIGINT and kills that process — this
crashed `tauri dev` with `STATUS_CONTROL_C_EXIT` the first time, because
`main.ts` used to fire the startup paint's `analyze()` with copy-simulation
on, and the dev terminal happened to have focus. Fixed by only simulating
copy on a real user-triggered Ins (`main.ts`'s `analyze(simulateCopy)`); the
one automatic startup call passes `false`. Still relevant when testing
manually: make sure the game (or a neutral window) has focus, not your
terminal, before triggering Ins.

## 6. No live display/resize testing across multiple monitor configurations

The overlay re-anchors itself and falls back to a smaller layout
(Full → Compact → Mini) when it detects a display, DPI, or resolution change,
and this was verified to attach and run without errors. It has not been
exercised against every real multi-monitor/DPI-mismatch hardware
configuration — if the overlay lands somewhere unexpected after changing
displays, that's useful to report.

## 7. ~~Reduce-effects and Compact-compression settings have no UI yet~~ (resolved 2026-07-08)

Both settings are now toggles in the in-app Settings panel (gear button):
"Reduce Effects" (disables pulse/flare/spark animations, keeps all color
information) and "Compact Compressed" (a ~359px Compact layout for HUDs
where the default 392px card overlaps something else on screen). They
apply immediately and persist in `localStorage` as before.

**Update (2026-07-08):** custom hotkey remapping is now implemented. The
Settings row's `Ins` chip is a button: click it, press the new key (Escape
cancels), and all three shortcuts move to that base key (key = analyze,
Shift+key = toggle, Ctrl+key = compare). The base is validated Rust-side
(modifiers, Escape, Enter/Space/Tab/Backspace, and every *printable* key —
letters, digits, punctuation, numpad — are rejected, because a global grab
swallows the key OS-wide and would break typing everywhere, game chat
included; a key already grabbed by another app rolls back to the previous
binding with an error message). What's left: F-keys, Insert/Delete/Home/
End/PageUp/PageDown, arrows, and lock keys. The base persists in
`hotkey.txt` in the app
config dir — Rust-side, not `localStorage`, because registration happens at
startup before the webview exists. One quirk: the *currently bound* key
can't be captured in the remap flow, because the OS-level global grab means
the webview never receives its keydown — re-selecting the same key would be
a no-op anyway.

## 8. ~~Compare mode is basic~~ (resolved 2026-07-08)

**Ctrl+Ins** toggles Compare mode (§12): it overlays the last 2-3 distinct
analyzed waystones side by side (`main.ts`'s `compareList`), highlighting
the best Juice Score with a star + gold border. It's a no-op until at
least 2 waystones are in the list (nothing to compare yet).

**Update (2026-07-08):** the original gaps are closed. Each card now has a
**×** (remove it from the comparison) and a **📌** (pin it: pinned entries
survive the rolling window when new analyses come in — max 2 pins, so the
third slot always shows your latest analysis). Re-analyzing a waystone
already in the list updates its entry in place (pin and position kept)
instead of duplicating it — this also fixes the list silently filling with
duplicates of one map, which the old code allowed despite its "distinct"
comment. The list persists across restarts (`localStorage`, validated on
load — a corrupted payload falls back to an empty list). Removing the last
card closes Compare mode and restores the underlying view.
