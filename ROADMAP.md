# Roadmap

Ce qu'on prévoit pour les prochaines mises à jour. Le miroir de
[CHANGELOG.md](CHANGELOG.md) (le passé livré) — ici, le futur.

**Usage** : les idées entrent en bas (« Idées »), remontent d'une section
quand on décide de les faire, et sortent du fichier quand c'est livré — la
ligne devient alors une puce du CHANGELOG, réécrite pour les joueurs. Une
ligne = un item, avec référence vers [KNOWN_ISSUES.md](KNOWN_ISSUES.md)
quand elle existe.

## Prochaine version

*(rien d'engagé pour l'instant — remonter ici ce qui partira dans la prochaine release)*

## Ensuite

Validé, mais pas urgent :

- [ ] Test multi-écrans réel — la cascade de fallback (Full → Compact → Mini)
      n'a jamais été exercée sur du vrai matériel multi-moniteur/DPI mixte
      (KNOWN_ISSUES #6).
- [ ] Masquer (ou marquer inertes) les dropdowns « Secondary 1/2 » du
      panneau Settings — ils n'ont plus aucun effet sur le scoring depuis le
      rework tier-based, source de confusion (KNOWN_ISSUES #3).
- [ ] `cargo clippy` + `cargo fmt --check` dans le job rust-checks de la CI.

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
