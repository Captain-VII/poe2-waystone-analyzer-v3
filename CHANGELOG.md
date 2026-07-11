# Notes de version

Format : une section `## X.Y.Z` par release, puces courtes orientées
utilisateur (pas de détails internes). La section la plus récente en premier.
Ce fichier est embarqué dans l'app (panneau "Quoi de neuf" + Réglages) et
sert de description à la release GitHub — écrire pour les joueurs.

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
