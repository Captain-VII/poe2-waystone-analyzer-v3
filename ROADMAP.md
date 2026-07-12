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

- [ ] Compléter le maître de l'Atlas recommandé (livré 2026-07-12, voir
      CHANGELOG) pour Irradiated/Temple/General — aucune source Fubgun
      trouvée pour ces 3 cas, l'app n'affiche donc rien plutôt que de
      deviner (choix explicite de l'utilisateur). À revoir si une source
      apparaît. `Abyss` a aussi une 2e stratégie sourcée (Hilda,
      orientée rare-monster) non utilisée — Jado reste la recommandation
      affichée (stratégie principale/listée en premier chez Fubgun), voir
      `src/analyzer/atlas-masters.ts`.
- [ ] Bug écran noir (KNOWN_ISSUES #1) : ne rouvrir que si l'hypothèse
      WebView2 process-reuse se confirme chez les testeurs — dernière
      tentative (rafale de nudges différés) le 2026-07-11, sans succès.
- [ ] Stats de session enrichies (historique par jour, export).
- [ ] Vérifier que `scripts/verify-adapter.mjs` n'a plus de dépendance à un
      checkout sibling v2 (fragilité CI potentielle relevée le 2026-07-11).
- [ ] Lint JS/TS (eslint) — aucun configuré aujourd'hui.
