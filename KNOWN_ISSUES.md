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

**Update (2026-07-11):** a new mitigation was tried targeting specifically
the "invisible from the start, no hover/reveal involved" case (trial #16 in
the log below) — the existing reactive nudge never had a trigger to fire on
for that case. `show_window` now schedules a delayed nudge burst (300/800/
1500ms after the window is shown) instead of the immediate nudge that was
already tried and made things worse (trial #12). **Tested with 8 back-to-back
launches and real desktop screenshots (a CDP screenshot can't see this bug —
see the methodology note in the trial log): 4 of 8 still failed**, despite
the nudges confirmed firing every time. Shipped anyway (bisectable via
`OVERLAY_STARTUP_NUDGE_BURST`, default on) since it's cheap and doesn't
appear to make anything worse, but **this issue is still open** — see
`docs/implementation-plan.md`'s M1 section for the full result and a
methodological caveat about the failure pattern.

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

**Update (2026-07-10) — mod count now feeds the Mechanic Match Score, sourced:**
third idea adopted from the same externally-proposed model review (its
`"mods"` axis, "Map Modifiers"). `waystone.modCount` (`parsed.modifiers.length`)
was already parsed and shown but never fed into any scoring — dead data,
like the mechanics removed above. Unlike the threshold idea, this one had
real sourcing already sitting in this session's own Fubgun quotes: *"8 Mod
waystones seem to be the best for loot"* (8 = the practical ceiling) and
*"cheapest option is to make your own ... waystones with 6 modifiers"*
(6 = a real, sourced, still-viable midpoint). `adapter.ts`'s `modCountBonus`
is a linear ramp from 0 (no mods) to +8 points (8 mods, matching
`EXTRA_CONTENT_BONUS`'s own upper range) — a straight line is the honest
fit for two data points, not a fabricated curve. Applied uniformly to
every mechanic in `computeMechanicScores` (no sourced reason to think mod
count matters differently per mechanic) — scoped to the **Mechanic Match
Score only**, not the real Juice Score (`scoring.ts`), per explicit user
direction; revisiting the Juice Score itself is a separate, bigger-blast-
radius decision for later. Verified: three existing checks that asserted
a mechanic scores *exactly* 0 when none of its tracked stats are present
correctly started failing (a stat-less mod line legitimately moves the
score a little now, via mod count) — fixed to assert the exact sourced
bonus instead of zero, not loosened or deleted.

**Update (2026-07-10) — mechanic threshold scaffolding added, deliberately
inert (no sourced numbers exist):** while reviewing an externally-proposed
scoring model, its `"constraints"` block (a per-mechanic minimum stat
threshold — "below this Pack Size, Abyss barely functions") looked like a
genuinely useful idea, matching a real property of these mechanics (some
league mechanics need a minimum density/investment to "turn on"). Before
writing any code, went looking for a real sourced number to back it —
a targeted web search across Abyss/Delirium/Breach/Ritual/Expedition guides
(Switchblade Gaming, maxroll.gg, mobalytics.gg) found **zero credible
numeric thresholds** for any of the six tracked stats; every source is
qualitative ("more density is better", "don't skip Delirium even if the
map looks sparse" — the latter actually arguing AGAINST a Delirium
threshold existing at all). Re-checked Fubgun's own strat text (already
pasted into this session for the Breach/Abyss recalibration above) for the
same thing — the only real threshold he states anywhere is a **map tier**
requirement for Ritual ("won't get good omens below lvl 79", i.e. T15),
not a percentage on any of the six stats.

Given that, built the mechanism without inventing numbers: `mechanics.ts`'s
`MechanicDef.minThresholds` (optional, per-stat, real-%-scale) and
`mechanicThresholdPenalty()` — a smooth linear ramp (1 at/above the
threshold, 0 at zero, no hard cliff, matching the existing synergy-bonus
taper's "no hard cutoff" principle) rather than a binary cutoff, with
multiple thresholded stats compounding multiplicatively. Wired into
`computeMechanicScores` (the waystone-level Mechanic Match Score) only —
deliberately NOT into `rankTablets`' tablet-vs-mechanic fit, since a
threshold is about whether the WAYSTONE's own stats clear a bar, not
whether a tablet's own small boost roll does.

**No bundled mechanic sets `minThresholds` today** — `mechanicThresholdPenalty`
returns exactly `1` (no-op) for all 8 real mechanics, pinned by a
verify-adapter.mjs check that fails the moment that stops being true. The
mechanism is exercised only via synthetic mechanics in tests. This is
scaffolding: ready to receive a real number the moment one is sourced
(a guide, a datamine, or your own observed gameplay breakpoint), without
another scoring-architecture change — not a shipped tuning change.

**Update (2026-07-10) — tablet ranking was a design flaw, not a tuning
issue: every tablet was scored against ONE shared mechanic, fixed:**
after the Delirium fix above, the user flagged a deeper problem in the
tablet list itself. Confirmed in `adapter.ts`'s `rankTablets`: all 9 active
tablets were scored against the single globally-`recommendedMechanic` —
never against their own profile. Concretely, on a Ritual-winning waystone,
Delirium Tablet (real boosts: `20% increased Pack Size`, a strong Delirium
fit) displayed **"Delirium Tablet matches Ritual (16/100)"** — its real
strength against its own mechanic (Delirium, ~72/100) was never shown, and
`computeSynergyBonus` (already mechanic-independent) could only add up to
10 points, itself capped at half of the already-suppressed base — a
compounding effect, not a rounding error.

**Fix**: each tablet now resolves its OWN mechanic from `tablet.tags`
(the same source `computeSynergyBonus`/`buildSynergyLine`/the primary-vs-
secondary tier multiplier already used) — Breach/Ritual/Delirium/
Expedition/Abyss/Irradiated/Temple Tablet each score against their own
name; Standard/Overseer Precursor (`tags: ["general"]`) score against
General. An earlier version of this fix searched all 8 tablet-linked
mechanics for whichever numerically scored highest per tablet — discarded
after live testing showed it could pick a confusing "match" with no real
identity behind it (Standard Precursor Tablet's Quantity+Item Rarity
boosts numerically favored Irradiated over General, purely because
Irradiated's secondary stats happen to include quantity) — a tablet's
declared tag is curated identity, not something to rediscover via
curve-fitting each analysis. The `recommendedTablets` curator pin also now
applies correctly per tablet (previously it only ever fired for whichever
tablet matched the global winner).

**Deliberate side effect, confirmed with the user**: a tablet's own match
is now shown even when the waystone as a whole doesn't clear any
mechanic's `skipIfBelow` (white waystone, low-score map) — e.g. Delirium
Tablet still shows "matches Delirium" on a blank waystone, since its
boosts are fixed regardless of what's being analyzed. The `skipIfBelow`
gate still governs the separate waystone-level `recommendedMechanic` /
"Strong X match" verdict, now fully decoupled from the tablet list.

Verified: `verify-adapter.mjs` pins a Ritual-leaning waystone where
Delirium Tablet still reads "matches Delirium" (not "matches Ritual"),
and that two different tablets on the same waystone can show two
different mechanics — impossible under the old design.

**Update (2026-07-09) — the Pack Size / Item Rarity cap mismatch is
resolved, from real data this time:** the 2026-07-08 update below flagged
`NORMALIZE_CAP.packSize = 150` vs. `PACK_SIZE_REFERENCE = 30` disagreeing
5x but left both alone for lack of a solid external number. A live
clipboard paste (real T15 waystone, see issue #9) settled it differently:
that waystone's Pack Size (16%) is real, ordinary, and NOT an outlier, so
the fix isn't "find the true external cap" — it's that `NORMALIZE_CAP`
and the god-map `REFERENCE` constants are both trying to express the same
"how strong is this stat" scale and must agree with each other, whichever
exact number is right. `NORMALIZE_CAP.itemRarity`/`packSize` (200/150)
are now **100/30**, matching `RARITY_REFERENCE`/`PACK_SIZE_REFERENCE` —
the same references the actual Juice Score already uses, already
user-validated in the 2026-07-06 audit. Confirmed via that real waystone:
Pack Size going from 53%-of-score-reference but only 11%-of-mechanic-fit-
cap to 53%/53% visibly changed which mechanic (and tablet) got
recommended (Delirium/Legion, both Pack-Size-priority, now rank near the
top instead of being suppressed). `monsterRarity`/`monsterEffectiveness`
were already coincidentally aligned (100=100) and are untouched.

**Update (2026-07-10) — Delirium's Mechanic Match Score clustering near 70
was two compounding bugs, both now fixed:** user report — Delirium's fit
score tended to sit near 70/100 across most real waystones while other
mechanics spread out more, feeling like "too big a multiplier" somewhere.
Root-caused with real data (7 T15 waystones the user pasted this session)
rather than guessing:
1. **`NORMALIZE_CAP.packSize` (30, set 2026-07-09) was itself too low.**
   The 7 real waystones show Pack Size from 7% to 44%, and a real market
   listing (17 divine — a genuinely sought-after roll, not a fluke) showed
   **64%**. maxroll.gg ("Rolling Waystones and Precursor Tablets") confirms
   a T15's base Pack Size mod rolls **(41-50)%** — already above the old
   30 cap on its own, meaning most real waystones were saturating (or
   nearly saturating) Delirium's 0.6-weighted priority term regardless of
   how the map actually compared to others. Raised to **100**, matching
   how `itemRarity`/`monsterRarity`/`monsterEffectiveness` are already
   treated (a round, generous ceiling rather than a tight fit to the
   highest sample seen so far) — comfortable headroom above the observed
   64% max.
2. **The same waystones exposed an identical bug on Waystone Drop
   Chance**: values from 80% to **140%** against a cap of 100 (never
   touched by the 2026-07-09 pass, which only fixed itemRarity/packSize).
   No external "mod tops out at X%" citation exists for this one, so the
   new cap (**150**) is an empirical choice: headroom above the highest
   confirmed real roll (140%), same margin logic as quantity's
   29%-observed → 35-cap.
3. **The flat +15 "mechanic already present" bonus in
   `adapter.ts`'s `computeMechanicScores`** applied uniformly to 16 of 17
   mechanics whenever their keyword appeared in the item text — while the
   real Juice Score already had a *differentiated, sourced* table for the
   same idea (`EXTRA_CONTENT_BONUS`: Ritual/Breach +10, Delirium/Expedition
   +8, the other 12 get nothing). Delirium's keyword is common on real
   maps (instilled "Players in Area are X% Delirious" lines, or actually
   farming Delirium encounters), so this flat, oversized, non-differentiated
   bonus was firing often and stacking on top of the already-inflated
   priority term from bug #1. **Removed entirely** from the Mechanic Match
   Score rather than reweighted to match `EXTRA_CONTENT_BONUS` — the user's
   call, after confirming most of the "stuck near 70" pattern already
   disappeared once the cap was fixed: any fixed number here is still
   arbitrary, and the underlying "mechanic already present" signal isn't
   lost, it still surfaces via the real Juice Score's own
   `Bonus: extra content: X (+N)` insight line. This is a deliberate
   deviation from the cahier des charges' §8/§9 "mecanique naturelle"
   intent for the *Match Score* specifically — sanctioned by the user, not
   a silent scope change; the Juice Score itself is untouched and still
   honors §8/§9.

**Scope boundary, explicitly not resolved here:** this pass only touches
`mechanics.ts`'s `NORMALIZE_CAP` (feeds the Mechanic Match Score / tablet
ranking). It deliberately does NOT touch `scoring.ts`'s god-map
`REFERENCE` constants (`PACK_SIZE_REFERENCE = 30`, `DROP_CHANCE_REFERENCE
= 120`), which drive the actual displayed Juice Score and were
user-validated in the 2026-07-06 audit — reopening those would be a
bigger, separate decision. This means `NORMALIZE_CAP` and `REFERENCE` now
disagree again for `packSize` (100 vs 30) and `waystoneDropChance` (150 vs
120) — the exact shape of mismatch the 2026-07-09 pass closed, reopened
here on purpose because `NORMALIZE_CAP` now has the fresher, stronger
sourcing (maxroll + 7 real samples) than `REFERENCE` ever had for these
two stats. Left for a future pass if the real Juice Score's own weighting
should move too.

**Update (2026-07-10) — Breach and Abyss recalibrated from Fubgun's 0.5
atlas strats (the strongest mechanic→stat source obtained so far):** the
user pointed at Fubgun's Mobalytics "Atlas Tree and Strats" page (patch
0.5, updated 2026-07-05). The page blocks scraping (403; Wayback
unavailable) and its per-mechanic tabs are client-side JS — every web
search returned the same generic intro paragraph regardless of the
mechanic asked about, so tab contents were **pasted directly by the user
from their browser**. Changes made in `mechanics.ts`:
- **Breach**: priority `monsterRarity` → `monsterEffectiveness`,
  secondaries `[itemRarity, monsterEffectiveness]` → `[itemRarity]`.
  Quotes: *"you're looking for high item rarity and high monster
  effectiveness"*, *"if you can only get one, choose monster
  effectiveness"* — and neither Monster Rarity nor Pack Size appears
  anywhere in the Breach tab. Converges with an independent aoeah.com
  mirror: *"pack size is irrelevant — rare monster count is static"*,
  *"Monster Rarity is mostly wasted for the same reason"* (a Breach's
  rare count is set by tablets, not map stats). Two sources agreeing on
  a mechanical reason beats the older monsterRarity-first consensus.
- **Abyss**: priority `monsterRarity` → `packSize`, secondaries
  `[quantity, monsterEffectiveness]` → `[monsterRarity, itemRarity]`.
  The tab gives an explicit ranking, repeated verbatim in BOTH of
  Fubgun's abyss strats: *"1) pack size in map 2) monster rarity
  3) rarity of items found 4) monster effectiveness (not as good in this
  strat because you already have so much)"*. The effectiveness demotion
  is strat-specific (his mandatory tablet mods already stack it), so it
  was dropped from the model without being marked "bad".
- **Ritual / Delirium — confirmed out-of-model, nothing changed**: the
  Ritual tab mentions none of the six stats (all Tribute/Favours/Omens —
  mechanic currency, already modeled via `rewards.ts`); the "Deli Rush"
  tab literally says *"you don't care for any modifier"* — but that's a
  specialized mirror-rush strat, neither confirming nor refuting
  Delirium's `packSize` priority for generic fog farming. Inconclusive.
- **Expedition — deliberately NOT changed**: the only "Waystone:"
  paragraph in that tab (*"aim for the highest monster effect… pack size
  is bad"*) is word-for-word the same generic text every web search
  returned for every mechanic — it reads as the page's shared intro
  paragraph, not Expedition-specific advice. Future sessions: don't
  re-treat that paragraph as a new Expedition signal.
- **Two older doubts weakened by the same source**: boss-rush strat
  targets *"Waystone Drop Chance… minimum 95%, ideally 105%+"* — first
  real-usage number in `DROP_CHANCE_REFERENCE = 120`'s single-waystone
  framing (corroborates the scale; it's a roll target, not a max, so the
  cap question stays open). And *"make your own 70% effect waystones"*
  gives Monster Effectiveness its first practical ceiling (~70%
  self-crafted) — `NORMALIZE_CAP.monsterEffectiveness = 100` is plausible.

**Still unsourced, NOT changed:**
- **Monster Rarity**: the real waystone in issue #9 confirms the literal
  wording *"Monster Rarity: +18% (augmented)"* is real (in the aggregate
  header-summary block) — so the earlier 2026-07-08 worry that this
  wording might not exist on real items was wrong. What's still unsourced
  is only the CAP (how high can this go) — no number found yet.
- **Monster Effectiveness cap**: ~70% practical self-craft ceiling now
  known (above), but no confirmed hard max.
- **Waystone Drop Chance cap**: mechanically more complex than a
  single-mod cap — combines an innate mod-count-based scaling (a
  6-modifier waystone reportedly guarantees a replacement drop) with a
  dedicated suffix mod; one community post claimed extreme stacked totals
  (over 1000%) via cumulative crafting/Atlas effects, not comparable to
  `DROP_CHANCE_REFERENCE = 120`'s single-waystone framing. The 95-105%+
  boss-rush target above corroborates the reference's scale.
- **Mechanic priority-stat disagreement (informational only):** one
  source (Switchblade Gaming) ranks Ritual as "item rarity → ritual size"
  and Expedition as "pack size → rare monster mods" — contradicting the
  existing 3-source "community consensus 0.5" already cited in
  `mechanics.ts` (Ritual: monster rarity priority, item rarity explicitly
  excluded; Expedition: quantity priority). One dissenting source doesn't
  overturn a 3-source consensus on its own — logged for whoever revisits
  this with more data, nothing changed.

**Update (2026-07-10) — Abyss reverted to `monsterRarity` priority
(sourced, 2 vs. 1), and tablet ranking recentred on the waystone's own
stats instead of the tablet's own roll:** user report — a real T15
waystone ("Rotting Course": Monster Rarity +62%, Pack Size +9%) showed
Abyss Tablet fitting at only 35/100, which read as incoherent next to
such a high Monster Rarity roll. Root-caused with the probe-script
pattern (§ above): `rankTablets` scored a tablet against **its own**
10-25% boost roll (`tablet.boosts`, `TABLET_ROLL_CAP`), not the
waystone's stats — the waystone only leaked in via a small, capped
(`computeSynergyBonus`, max +10, further tapered) bonus. Abyss Tablet's
own roll is `"15% increased Rarity of Monsters"` (written for the
*pre*-07-10 monsterRarity-priority Abyss), so once Abyss's priority stat
flipped to `packSize` earlier the same day (see the Fubgun recalibration
above), the tablet's own roll no longer matched its mechanic's new
priority at all — statFit = 22 (12 from the monsterRarity secondary +
10 pin bonus), Pack Size contributing 0 since the tablet never rolls it.

**Two changes, from a real conversation, not a guess:**
1. **Abyss reverted**: two more independent sources found while
   debugging — Mobalytics "Abyss Juicing Tablet Tier List" (Perra):
   *"Pack Size is considered bait... Rare Monster Modifier along with
   the Rarity of Items modifiers are most important"*; Switchblade
   Gaming's Abyss waystone-rolling priority: *"rare monster count → item
   quantity → monster effectiveness"* (pack size/monster rarity assigned
   to *other* mechanics there). 2 sources against Fubgun's 1, and both
   converge with the Abyss Tablet's own real roll. `Abyss.priorityStat`
   is `monsterRarity` again, secondaries `[itemRarity, quantity]`.
2. **Tablet fit recentred on the waystone (user decision, explicit
   scope: "les 3" pain points — numbers that never stop moving, a
   formula too layered to reason about, and no stable ground truth)**:
   `rankTablets` (`adapter.ts`) no longer scores a tablet against its own
   roll at all. It now reuses `scoreMechanicFitRaw(stats, mech, ...)` —
   the exact same formula/caps `computeMechanicScores` (the Mechanic
   Match Score) already uses — so there is only one "does this waystone
   suit this mechanic" calculation in the app, applied once per mechanic
   and once per tablet (via its resolved mechanic). Removed as part of
   the same "coupe large" simplification pass, all previously unvalidated
   against real data: `confidenceMult` (×0.92/×0.8 by `tablet.confidence`,
   `getConfidenceMultiplier`), the primary/secondary-mechanic tier
   multiplier (×0.8, `PRIMARY_MECHANIC_TAGS`), `computeSynergyBonus`/
   `MECHANIC_SYNERGY`/`buildSynergyLine` (mathematically redundant now
   that the base fit already IS the waystone-stat signal), and the
   `minThresholds`/`mechanicThresholdPenalty` scaffold added earlier the
   same day (still inert, never sourced — cut rather than left dormant).
   Kept: the curated `recommendedTablets` pin (+10, still meta.json-
   editable) and `rewardScore` (rewards.ts, real mechanic-specific
   currency) — both additive on top of the waystone fit. `Tablet.breakdown`
   simplified from up to 5 conditional rows to 2 (`Stat fit`, `Reward`).
   `TABLET_ROLL_CAP` removed (no remaining consumer).

   Verified against the real "Rotting Course" waystone: Abyss Tablet's
   fit went from 35 (Stat fit 22, Pack Size-starved) to **72** (Stat fit
   59, driven by Monster Rarity — now the top-ranked tablet), and the
   Mechanic Match Score's Abyss entry moved from mid-pack to top (49).
   `verify-adapter.mjs` pins the new formula directly (a tablet's fit
   must track the waystone's own stats, not a fixed roll) plus the
   specific reported case (high Monster Rarity + low Pack Size still
   gives Abyss Tablet a strong fit).

**Heat Breakdown's composite score temporarily hidden (Full mode only,
`RelicPanel.ts`'s `HEAT_SCORE_VISIBLE = false`)**: same conversation —
the user found the Heat Breakdown column's Total Heat number/rating
misleading mid-rework and asked it not be *displayed* for now, without
removing any code. The per-stat % rows (Item Rarity/Monster Rarity/etc.)
are unaffected — those just mirror the item's own tooltip. A single
flag flip (`true`) restores it once the rework has been validated
against more real waystones in actual gameplay.

**Update (2026-07-10, same day, later still) — the continuous weighted-sum
formula was replaced entirely by a 4-tier read of ONE stat, sourced from
the user's own gameplay judgment (not a web guide, for once):** after
watching the tablet-ranking fix above land, the user named the actual
recurring pain directly — "à chaque nouvelle source web, les poids
bougent, le système est trop complexe, et il n'y a pas de vérité fiable."
Rather than adopt yet another external model, they proposed their own
rule: *"pour le score de base, toutes les mécaniques font : de 0% à 15%
= nul, de 15% à 25% = ok, de 25% à 50% = top, et au-delà de 50% =
ultra/juicy/légendaire."* Confirmed via two follow-up questions that this
should (a) drive BOTH the Mechanic Match Score and the tablet verdict, and
(b) look at the mechanic's **priority stat alone** — secondary stats no
longer factor into scoring at all.

**What changed** (`mechanics.ts`):
- `scoreMechanicFitRaw`'s old body (priority weighted 0.6, up to two
  secondaries at 0.2 each, each normalized against `NORMALIZE_CAP`) is
  gone. New `priorityStatTier(profile, mech)` reads ONLY `profile[mech.
  priorityStat]` against the four thresholds above and returns one of
  `"weak" | "ok" | "top" | "legendary"` (`StatTier`). A representative
  0-100 point value per tier (`TIER_SCORE`: 10/25/55/80) keeps every
  existing 0-100 consumer (mechanicScores sort order, `Tablet.fit`,
  `scoreToRating`'s letter, `modCountBonus`/`recommendedTablets` pin
  additions) working unchanged — `scoreMechanicFitRaw` keeps its old name
  and call signature (`profile, mech, extraBonus`) precisely so
  `computeMechanicScores`/`rankTablets` in adapter.ts needed zero call-site
  changes, only its internals moved.
- `NORMALIZE_CAP` is gone — its whole reason to exist (converting a raw %
  into a continuous 0-1 signal) no longer applies. Its sourcing history
  (real waystone Pack Size/Drop Chance ranges, maxroll.gg citations) is
  preserved above in this same section for the record, even though the
  constant itself is retired.
- `MechanicDef.secondaryStats` **stays on the type and stays meta.json-
  editable** (the Settings panel's secondary-stat dropdowns still work as
  UI) — it's simply unused by scoring now. Flagging this explicitly since
  it's a real, disclosed side effect of the user's "priority stat alone"
  call: editing a mechanic's secondary stats in the meta editor no longer
  changes anything about how that mechanic scores.
- Tablet verdict (`adapter.ts`'s `tabletVerdict`, added earlier the same
  day) now takes the `StatTier` directly instead of bucketing the numeric
  `fit`: weak -> Don't run, ok -> Why not, top and legendary both -> Run
  (per the user's explicit 4-to-3 collapse — the top/legendary distinction
  still shows up in the fit number on hover, just not as a separate
  row-level verdict).

**Consequence worth watching**: every mechanic now has a non-zero
baseline score (`TIER_SCORE.weak = 10`, plus the mod-count bonus) even
when its priority stat is completely absent — the old formula could hit
a true zero. `verify-adapter.mjs`'s "no longer feeds X at all" checks were
updated to assert the weak-tier baseline instead of zero, not loosened.

**Update (2026-07-1x) — the Juice Score itself replaced with a dominant-
stat model, and `HEAT_SCORE_VISIBLE` re-enabled:** the tier-based rework
above only ever touched the Mechanic Match Score/tablet verdict; the real
Juice Score (`scoring.ts`'s `evaluateMap`) kept its 2026-07-06 weighted-sum
+ multiplicative-synergy formula, still hidden behind `HEAT_SCORE_VISIBLE
= false`. A real waystone surfaced why that formula stayed wrong even
after the tablet fixes: **"Putrid Bearings"** (+55% Item Rarity, +80%
Waystone Drop Chance, nothing else) landed in the "MOYEN" band under the
old weighted-sum — averaging 6 signals (including a mechanic-density term)
diluted two genuinely strong stats down to mediocre. The user's call:
*"on va réactiver le score principal mais il sera basé sur ça plus grosse
stat, et des petits bonus si y'a d'autres stats intéressantes"* — same
philosophy as the tablet-fit rework, applied to the waystone's own
composite score.

**What changed** (`scoring.ts`'s `computeCompositeScore`, replacing
`computeBaseScore`/`synergyMultiplier`/`statSynergyMultiplier`/
`normalizeToScale` entirely):
1. Each of the 5 cahier-des-charges stats is normalized against its OWN
   realistic ceiling (`STAT_REFERENCES` — Item Rarity/Monster Rarity/100%,
   Pack Size/30%, Monster Effectiveness/100%, Drop Chance/120%, same
   values the old god-map references used) — asked and confirmed with the
   user first: comparing raw %s directly would mean Pack Size (tops out
   near 30%) could never "win" against Item Rarity/Drop Chance (run past
   100%) even when maxed. The stat with the highest normalized value is
   the **dominant stat**.
2. The dominant stat is tiered with the exact same 15/25/50 boundaries as
   the Mechanic Match Score (`mechanics.ts`'s `tierForPercent`, extracted
   from `priorityStatTier` for this reuse) — one mental model for "how
   strong is this stat" across the whole app now. `TIER_SCORE[tier]`
   (10/25/55/80) is the base score.
3. Every OTHER stat that also clears "ok" (>= 15% normalized) adds a small
   bonus, proportional to how close it is to its own ceiling (0 to
   `SECONDARY_BONUS_CAP = 5`, confirmed with the user as "proportionnel à
   la valeur" over a flat +5) — a "nul" secondary contributes nothing.
   With at most 4 other stats, legendary(80) + 4×5 = 100 exactly, so the
   score can never overshoot 100 by construction — no soft overflow cap
   needed, unlike the old model.
4. The mechanic-density term (counting distinct league-mechanic keywords
   in the item text) is dropped outright, not folded in as a 6th "stat" —
   the user's wording was specifically about *stats*. Its only remaining
   consumers (Blight/Legion/Essence's `MECHANIC_PATTERNS` entries,
   `SYNERGY_MECHANIC_IDS`) had no other use once the density term was
   gone, so they were removed from `mechanic-patterns.ts` rather than left
   dead — the other six tablet-less mechanics (Heist/Sanctum/Harvest/
   Metamorph/Incursion/Bestiary) had already been cut the same way on
   2026-07-10.

**Item Quantity stays excluded** from the Juice Score (unchanged from the
2026-07-06 design, see the file-level comment) — it's Expedition's
priority stat for the Mechanic Match Score, but contributes nothing to the
dominant-stat comparison. Verified directly: a quantity-only waystone's
Juice Score floors at the weak-tier baseline (~10) while its Expedition
Match Score reads legendary — the §10 `skipIfBelow` gate still correctly
withholds the waystone-level recommendation in that case
(`verify-adapter.mjs`).

`HEAT_SCORE_VISIBLE` removed (was `RelicPanel.ts`'s temporary display
toggle from earlier this session) — the Heat Breakdown column's composite
score/rating is shown again unconditionally, now backed by this formula.

Verified against real data: "Putrid Bearings" now scores **82.75,
Legendaire** (was "MOYEN"); "Rotting Course" (the original Abyss bug
report waystone) scores **81.5, Legendaire**, consistent with its Abyss
Tablet fit of 100/100. `verify-adapter.mjs` pins the formula directly —
a lone stat scores exactly its tier, a lone weak stat floors at 10 with
zero bonus, and the secondary-stat bonus scales with the secondary's own
magnitude rather than being a flat award. (The original version of this
paragraph also cited "Pack Size at 25% outranks a bigger-looking Item
Rarity at 40%" as a worked example of the ceiling-comparison design —
that example relied on `STAT_REFERENCES.packSize = 30`, which the
2026-07-11 update directly below found to be a bug, not a feature; see
that entry for the corrected reference and the replacement test.)

**Update (2026-07-11) — Pack Size's reference was itself miscalibrated,
causing near-every real waystone to read Legendaire:** user report —
"le rating est tout le temps en légendaire." Root-caused with a probe
script: `STAT_REFERENCES.packSize` was `30` (copied from the old
weighted-sum model's god-map reference table above without re-checking
it against the new dominant-stat model's different use of that number).
Under the dominant-stat model, a stat reaches "legendary" tier at 50% of
its own reference — for Pack Size that meant **15% raw Pack Size**, a
thoroughly ordinary roll (this project's own prior research, cited
earlier in this section, already established real Pack Size runs
7-64%, with T15's base mod alone rolling 41-50%). Confirmed via probe:
a bare `+15% increased Pack Size` alone scored 80/100 Legendaire; a
waystone with nothing above 20% on any of the 5 stats (including a
modest 10% Pack Size) scored 56.8/100 "Bon" — Pack Size didn't need to
be the map's true strength to hijack the dominant-stat slot, just
merely present.

**Fix**: `STAT_REFERENCES.packSize` raised from 30 to **100**, matching
itemRarity/monsterRarity/monsterEffectiveness (the same "generous
ceiling over a tight fit to the observed sample" reasoning already used
once before in this project for the analogous `NORMALIZE_CAP.packSize`
constant, see the 2026-07-10 entry above — that fix just never got
mirrored into this file's own reference table). Waystone Drop Chance
keeps its distinct 120 reference (its own real range runs up to ~140%,
per the 2026-07-10 entry above) — it's now the only stat that isn't
directly 1:1 comparable to the other four, and `verify-adapter.mjs`'s
composite-score test block was updated to demonstrate the ceiling-based
comparison using Drop-Chance-vs-Item-Rarity instead of the now-invalid
Pack-Size-vs-Item-Rarity example, plus two new regression checks pinning
this exact bug (15% Pack Size alone = "ok", not legendary; 50%+ Pack
Size alone = legendary, same bar as every other stat).

Re-verified against the same probe cases: the earlier "mediocre
everything" fixture (nothing above 20% on any stat) now scores 25.8/100
"Moyen" (was wrongly 56.8/100 "Bon"), and "Putrid Bearings"/"Rotting
Course" above are unaffected (neither has meaningful Pack Size).

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

## 9. ~~Parser assumed a clipboard format real PoE2 text doesn't use~~ (resolved 2026-07-09)

Every fixture this app was ever tested against — `scripts/verify-adapter.mjs`'s
hand-written `SAMPLE`, `docs/` writeups, the original `poe2-waystone-analyzer-v2`
port — assumed a simpler item-text shape than what the game actually pastes.
A real clipboard copy (user-provided, live T15 waystone, 2026-07-09) exposed
two structural mismatches nothing had caught before:

1. **No "Waystone Tier:" line exists.** Real text has an aggregate summary
   block instead (`Item Rarity: +27% (augmented)`, `Pack Size: +16%
   (augmented)`, etc., plus an unrelated `Revives Available:` line) — the
   tier number only ever appears in the header's own base-type line,
   `Waystone (Tier 15)`. `parser.ts`'s `extractTier()` scanned only for the
   line that doesn't exist, silently returning **0** — every real waystone
   displayed **"T0"** in the overlay, permanently. Fixed: tier is now
   parsed from the header line first (the line-scan for the old assumed
   format stays as a harmless fallback).
2. **Every rolled modifier is prefixed with a label line** —
   `{ Prefix Modifier "Frostbitten" (Tier: 1) }` — that carries no stat,
   just the mod's internal name/tier. Left in, it inflated `modCount`
   (counted as real mod lines) and would render as a meaningless row like
   `{ Prefix Modifier "Frostbitten" (Tier: 1) }` in the Full-mode modifier
   list. Fixed: `extractModifiers()` now filters out
   `{ Prefix/Suffix/Implicit/Enchant Modifier ... }` label lines.

The 5 core stats themselves (Item Rarity/Monster Rarity/Pack Size/Monster
Effectiveness/Waystone Drop Chance) already parsed correctly on real text —
`mod-parser.ts`'s tolerant fallback regex scans the *full* raw text, so it
picked up the aggregate summary block's clean `"Stat: +NN% (augmented)"`
lines even though the "primary" (clean modifier-block-only) parse pass
never saw them. Only tier and modCount/display were actually broken.

Also resolved in the same pass, once real data was available: the
Pack-Size/Item-Rarity `NORMALIZE_CAP` mismatch from issue #3 — see that
entry's 2026-07-09 update.

**Not investigated further:** whether this is a genuinely NEW clipboard
format (a patch changed it since this app was first built) or whether it
was simply never tested against real text before now — doesn't change the
fix either way. `scripts/verify-adapter.mjs` now pins the exact real text
provided (tier, modCount, clean modifier list, correct stat values) so a
future format change would be caught the same way this one should have
been.
