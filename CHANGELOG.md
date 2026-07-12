# Notes de version

Format : une section `## X.Y.Z` par release, puces courtes orientées
utilisateur (pas de détails internes). La section la plus récente en premier.
Ce fichier est embarqué dans l'app (panneau "Quoi de neuf" + Réglages) et
sert de description à la release GitHub — écrire pour les joueurs.

## 0.3.4

- **Fixed: the tier badge text next to the score in Full mode could get hard-cropped mid-word** instead of showing "..." cleanly.
- **Fixed: the header buttons in Compact mode were glued right after the tier badge text** instead of staying anchored to the top-right corner.

## 0.3.3

- **New: recommended Atlas Master.** For Breach, Ritual, Delirium, Expedition, and Abyss waystones, the "Recommended Tablets" column (Full mode) now shows which Atlas Master to run — Jado, across all five right now. Not shown for mechanics without a clear best pick yet.

## 0.3.2

- **Fixed: scrolling the "Recommended Tablets" list in Compact mode didn't work in-game** — mouse wheel input over that area was falling through to the game underneath instead of scrolling the list.
- **Full mode's 3 columns are now exactly equal width.**

## 0.3.1

- **"Recommended Tablets" reworked**: all 8 tablets now always show, in a fixed alphabetical order — no more list that reshuffles or drops tablets depending on the waystone.
- **New fit display**: each tablet now shows its match as a percentage, colored from red (poor fit) to gold (great fit), replacing the old "RUN / WHY NOT / DON'T RUN" labels.

## 0.3.0

- **Fixed: the Compact header looked off-center**, with the icons bunched up on the right and empty space on the left — the whole row now sits together on the left like it should.

## 0.2.10

- **Fixed: the "LEGENDARY" pill next to the score in Full mode could drop to its own line** instead of staying beside the number, hurting readability.
- **Heat Breakdown order fixed**: Pack Size now shows before Monster Rarity, matching the real in-game stat order.

## 0.2.9

- **More accurate "Recommended Tablets" list**: every tablet's stats are now sourced from real game data instead of guesses, including corrected values for the Overseer tablet. Also removed a "Standard Precursor Tablet" that turned out to never actually exist in the game.

## 0.2.8

- **Removed the "Secondary 1/2" dropdowns** from Settings' Meta section and the tablet-click popup — they stopped affecting scoring a while ago and were just confusing to fiddle with. Priority stat and skip threshold still work exactly the same.
- Dev-infra only: the CI now enforces consistent formatting and lints the Rust side (`cargo fmt`/`cargo clippy`) on every push — no player-visible change.

## 0.2.7

- **Fixed: dragging the overlay by its header didn't work when you clicked on the tier badge** (e.g. the "Legendary" pill) — it silently ate the drag instead of moving the window.
- **New: a minimize button** in the top-right of the header, next to Settings, sends the overlay to the tray without opening Settings first.
- **Fixed: the tier badge text (e.g. "Legendary") was cut off in Compact mode** — it now always displays in full.

## 0.2.6

- **The app is now fully in English.** Every screen, message, and button was previously a mix of English and French — everything is English now, including hotkey remap errors and update-flow messages.
- **Settings has been reorganized** into clear sections: Display, Controls, Session, Meta, and Application — instead of one long unsorted list.
- **Legendary is rarer and more meaningful.** Waystone Drop Chance alone needed too small a roll to trigger it, so nearly every waystone with a decent Drop Chance roll read as Legendary regardless of its other stats. It now needs a genuinely high roll (~108%+) to hit Legendary on its own, matching the bar every other stat already had.
- Removed the "top 3 mechanics" percentage line added last update — it didn't read well visually.
- The waystone-level verdict is now labeled **KEEP** instead of the previous French wording.

## 0.2.5

- **More accurate Juice Score**: the per-stat ceilings the score compares against are now based on real market data instead of estimates — Pack Size and Monster Effectiveness in particular were being held to an unrealistically high bar and could lose out to Item Rarity/Drop Chance even on a genuinely strong roll. This should read as noticeably more consistent scoring, especially on Pack-Size- or Monster-Effectiveness-heavy waystones.

## 0.2.4

- **Top 3 mechanics at a glance**: the card now shows the three best mechanics for the analyzed waystone as percentages (e.g. "Breach 84% · Ritual 62% · Abyss 55%"), right under the verdict in Compact and under Total Heat in Full.

## 0.2.3

- **Notes de version dans l'app** : ce panneau "Quoi de neuf" s'affiche une fois après chaque mise à jour, et reste lisible à tout moment via Réglages → Notes de version.
- Le fichier du programme s'appelle maintenant `Waystone-Analyzer.exe` (il avait gardé son ancien nom lors du renommage).

## 0.2.2

- L'application s'appelle désormais **Waystone-Analyzer**.
- Nouveau schéma de version simple : 0.2.2, puis 0.2.3, etc. à chaque mise à jour.
- Correction : le démarrage automatique avec Windows suit maintenant l'application après une mise à jour.

## 0.2.0-beta.2

- **Mises à jour automatiques** : l'app vérifie au démarrage si une nouvelle version existe, prévient par une notification, et l'installe en un clic depuis les Réglages (jamais toute seule).
- Nouvelle ligne "Version" dans les Réglages.

## 0.2.0-beta.1

- Première bêta restreinte.
- Analyse de waystone à la volée (Ins), score Juice, recommandations de mécaniques et de tablettes, mode comparaison, stats de session, éditeur méta.
