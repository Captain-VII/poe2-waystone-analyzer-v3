# Roadmap

Ce qu'on prévoit pour les prochaines mises à jour. Le miroir de
[CHANGELOG.md](CHANGELOG.md) (le passé livré) — ici, le futur.

**Usage** : les idées entrent en bas (« Idées »), remontent d'une section
quand on décide de les faire, et sortent du fichier quand c'est livré — la
ligne devient alors une puce du CHANGELOG, réécrite pour les joueurs. Une
ligne = un item, avec référence vers [KNOWN_ISSUES.md](KNOWN_ISSUES.md)
quand elle existe.

## Prochaine version

- [ ] En Compact, le header parait décentré (glyphe seul à gauche, groupe
      badge/toggle/settings/minimize loin à droite) — causé par `.p-sub`
      (`panel.css:151-153`, `flex:1; min-width:0;`) qui reste dans le flux
      flex même invisible en Compact et agit comme un spacer élastique
      depuis qu'on a caché `.p-title` (`compact.css:13`). Fix : ajouter
      `.mode-compact .p-sub { display: none; }` dans `compact.css`
      (même traitement que `.mode-mini .p-sub`, `panel.css:163-164`) pour
      que tout le groupe se colle naturellement à gauche.
- [ ] En Full, le badge "LEGENDARY" à côté du score peut passer à la ligne
      en dessous au lieu de rester collé au score — `.score-row`
      (`full.css:57-64`) a `flex-wrap: wrap` sans raison fonctionnelle
      (`.halo` est `position:absolute`, ne compte pas dans la largeur).
      Fix : `flex-wrap: nowrap;` sur `.score-row` (`full.css:59`).
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
- [ ] Masquer (ou marquer inertes) les dropdowns « Secondary 1/2 » du
      panneau Settings — ils n'ont plus aucun effet sur le scoring depuis le
      rework tier-based, source de confusion (KNOWN_ISSUES #3).

## Idées

Vrac à trier :

- [ ] Afficher quel « maître de l'Atlas » (spécialisation d'arbre Atlas)
      convient le mieux à la mécanique dominante de la waystone analysée.
      Source pressentie : les strats Fubgun sur Mobalytics
      (<https://mobalytics.gg/poe-2/atlas-trees/fubgun-atlas-tree-strats>) —
      attention, la page bloque le scraping (403) et ses onglets sont en JS
      côté client : le contenu devra être collé à la main depuis le
      navigateur, comme pour la recalibration Breach/Abyss du 2026-07-10.
      Placement décidé (2026-07-11, capture utilisateur) : en bas de la
      colonne « Recommended Tablets » du mode Full, sous la liste, avec
      l'icône du maître directement visible. Prévoir la question des
      assets d'icônes (glyphes texte comme TABLET_ICONS, ou images à
      fournir).
- [ ] Bug écran noir (KNOWN_ISSUES #1) : ne rouvrir que si l'hypothèse
      WebView2 process-reuse se confirme chez les testeurs — dernière
      tentative (rafale de nudges différés) le 2026-07-11, sans succès.
- [ ] Stats de session enrichies (historique par jour, export).
- [ ] Confirmer les mods réels des tablettes Abyss/Irradiated/Temple quand
      une source fiable apparaît (KNOWN_ISSUES #2).
- [ ] Vérifier que `scripts/verify-adapter.mjs` n'a plus de dépendance à un
      checkout sibling v2 (fragilité CI potentielle relevée le 2026-07-11).
- [ ] Lint JS/TS (eslint) — aucun configuré aujourd'hui.
