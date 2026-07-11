# Roadmap

Ce qu'on prévoit pour les prochaines mises à jour. Le miroir de
[CHANGELOG.md](CHANGELOG.md) (le passé livré) — ici, le futur.

**Usage** : les idées entrent en bas (« Idées »), remontent d'une section
quand on décide de les faire, et sortent du fichier quand c'est livré — la
ligne devient alors une puce du CHANGELOG, réécrite pour les joueurs. Une
ligne = un item, avec référence vers [KNOWN_ISSUES.md](KNOWN_ISSUES.md)
quand elle existe.

## Prochaine version

- [ ] Remonter la barre « Légendaire » du Waystone Drop Chance dans le Juice
      Score. Diagnostic fait et validé (2026-07-11) sur 6 waystones T15
      réelles collées par l'utilisateur : Drop Chance était la stat
      dominante dans les 6, et touchait la barre légendaire actuelle (50%
      de son plafond 155, ~77.5% brut) dans 3 des 6 — bien plus souvent que
      les 4 autres stats. Fix validé : sa barre légendaire seule passe à
      70% du plafond (~108.5% brut) ; les seuils faible/correct/top
      partagés, les 4 autres stats et le système de bonus secondaire restent
      inchangés. Effet vérifié à la main : 3/6 Légendaire → 1/6.
      Implémentation : `computeCompositeScore` (scoring.ts) — remplacer
      l'appel direct à `tierForPercent(dominant.normalizedPercent)` par une
      variante locale avec un override par stat (`DOMINANT_LEGENDARY_OVERRIDE`),
      + tests de régression `verify-adapter.mjs` pinnant les cas Cabal
      Gambit (reste légendaire) et Rotting Charge (ne l'est plus). Détail
      complet (code, checks, textes des 6 waystones) dans l'historique de
      conversation du 2026-07-11 si besoin de le retrouver.

## Ensuite

Validé, mais pas urgent :

- [ ] Test multi-écrans réel — la cascade de fallback (Full → Compact → Mini)
      n'a jamais été exercée sur du vrai matériel multi-moniteur/DPI mixte
      (KNOWN_ISSUES #6).
- [ ] Masquer (ou marquer inertes) les dropdowns « Secondaire 1/2 » du
      panneau Réglages — ils n'ont plus aucun effet sur le scoring depuis le
      rework tier-based, source de confusion (KNOWN_ISSUES #3).
- [ ] `cargo clippy` + `cargo fmt --check` dans le job rust-checks de la CI.
- [ ] Passer toute l'application en anglais (décision 2026-07-11 : la
      majorité des joueurs PoE2 jouent en anglais). Concerne : les libellés
      encore français du panneau Réglages, les textes du flux de mise à
      jour (« Vérifier / Installer / À jour / Téléchargement / Échec »),
      les notifications (notify.ts), le panneau « Quoi de neuf », et les
      prochaines sections de CHANGELOG.md (qui alimentent aussi le corps
      des releases GitHub) — l'historique déjà publié reste tel quel.
- [ ] Réorganiser le panneau Réglages — les rows se sont accumulées sans
      ordre (affichage, comportement, app et session entremêlés). Plan
      validé, en sections titrées (`sec-h`, comme « Session » et « Méta »
      aujourd'hui) : **Display** (Overlay Mode, Opacity, Scale, Compact
      Compressed, Reduce Effects, Insights) · **Controls** (Hotkey,
      Position, Launch with Windows) · **Session** (inchangé) · **Meta**
      (inchangé) · **Application** (Version, Update, Patch notes, Hide
      Overlay). Réordonnancement de HTML + libellés uniquement, aucune
      logique — à faire avec (ou après) le passage en anglais ci-dessus.

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
      colonne « Tablettes Recommandées » du mode Full, sous la liste, avec
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
