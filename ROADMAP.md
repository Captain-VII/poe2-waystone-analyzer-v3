# Roadmap

Ce qu'on prévoit pour les prochaines mises à jour. Le miroir de
[CHANGELOG.md](CHANGELOG.md) (le passé livré) — ici, le futur.

**Usage** : les idées entrent en bas (« Idées »), remontent d'une section
quand on décide de les faire, et sortent du fichier quand c'est livré — la
ligne devient alors une puce du CHANGELOG, réécrite pour les joueurs. Une
ligne = un item, avec référence vers [KNOWN_ISSUES.md](KNOWN_ISSUES.md)
quand elle existe.

## Prochaine version

- [ ] Après un premier drag de l'overlay, impossible de le re-drag
      (surtout loin de sa position de départ) — root-cause confirmée :
      `reportInteractiveRegions()` (`src/interactive-rect.ts`) calcule les
      rects cliquables en coordonnées écran absolues mais n'est appelée
      qu'une fois au démarrage (`main.ts:179`). Le thread Rust
      (`lib.rs:608-658`) compare le curseur à ces rects STALES pour
      activer/désactiver `set_ignore_cursor_events` — après un drag, le
      header à sa nouvelle position n'est plus reconnu comme cliquable.
      `watchWindowMoves()` (`placement.ts:140-159`) détecte déjà la fin du
      drag mais ne sauvegarde que la position, sans relancer
      `reportInteractiveRegions`. Fix : rebrancher `watchWindowMoves` pour
      aussi ré-appeler `reportInteractiveRegions(overlay.interactiveEls())`
      une fois le drag stabilisé (même debounce 300ms).

## Ensuite

Validé, mais pas urgent :

- [ ] Test multi-écrans réel — la cascade de fallback (Full → Compact → Mini)
      n'a jamais été exercée sur du vrai matériel multi-moniteur/DPI mixte
      (KNOWN_ISSUES #6).

## Idées

Vrac à trier :

- [ ] Afficher quel « maître de l'Atlas » (spécialisation d'arbre Atlas)
      convient le mieux à la mécanique dominante de la waystone analysée.
      Source pressentie : les strats Fubgun sur Mobalytics
      (<https://mobalytics.gg/poe-2/atlas-trees/fubgun-atlas-tree-strats>) —
      attention, la page bloque le scraping (403) et ses onglets sont en JS
      côté client : le contenu devra être collé à la main depuis le
      navigateur, comme pour la recalibration Breach/Abyss du 2026-07-10.
      Placement décidé (2026-07-11, capture utilisateur ; reconfirmé
      2026-07-12, croquis utilisateur) : en bas de la colonne
      « Recommended Tablets » du mode Full, sous la liste de tablettes
      (`data-tablets-full`), une rangée d'icônes du maître directement
      visible. Prévoir la question des assets d'icônes (glyphes texte
      comme TABLET_ICONS, ou images à fournir). Pas de placeholder vide
      ajouté dans l'UI en attendant — un cercle vide sans fonction
      lirait comme un bug, pas une réservation d'espace.
- [ ] Bug écran noir (KNOWN_ISSUES #1) : ne rouvrir que si l'hypothèse
      WebView2 process-reuse se confirme chez les testeurs — dernière
      tentative (rafale de nudges différés) le 2026-07-11, sans succès.
- [ ] Stats de session enrichies (historique par jour, export).
- [ ] Vérifier que `scripts/verify-adapter.mjs` n'a plus de dépendance à un
      checkout sibling v2 (fragilité CI potentielle relevée le 2026-07-11).
- [ ] Lint JS/TS (eslint) — aucun configuré aujourd'hui.
