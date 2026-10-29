# Plan d'intégration local — PR2, SPORT-V2-CORRECTIONS-01, BETA-V2-TECH-01

**Statut** : plan seulement. **Aucune fusion n'a été faite.**
- Les conflits ont été calculés avec `git merge-tree --write-tree` : aucun commit, aucune branche ni aucun worktree modifié.
- Aucun push, merge, migration distante ni déploiement.

## 1. Les trois branches

Toutes partent de `origin/main` `a0a8921`.

| | PR2 `release/v2-dh-revocation` | SPORT `sport/v2-corrections-01` | BETA `beta/v2-tech-01` |
|---|---|---|---|
| Tête locale | `0f18f31` (12 commits ; la branche distante `0c9f332` n'a pas les 5 derniers, docs et correctif de message R1) | `72ef231` (10 commits, locale seulement) | `262c874` + le commit de cette revue (locale seulement) |
| Migration | `20261027120000` révocation DH (+ rollback) | `20261028120000` catégorie professionnelle commotion, candidate (+ rollback) | aucune ; l'option A de l'exemption V1 en ajouterait une (§ 4) |
| Canon `docs/01`–`10` | `docs/04`, `05`, `07` **modifiés sur la branche**, en attente d'approbation (réserve R1) | `docs/04`, `05` proposés, non appliqués | `docs/05` proposé, non appliqué |
| Prérequis hors code | approbation du canon R1 | signatures professionnelles (DH, PHYS, santé) pour le contenu ; GO de la migration | approbation de l'ADR ; écritures de production des affectations (GO Louis) |

## 2. Conflits textuels (réels)

| Paire | Fichiers en conflit | Résolution |
|---|---|---|
| PR2 × SPORT | `docs/00`, `docs/11` | garder les deux entrées, ordre chronologique |
| PR2 × BETA | `docs/00`, `docs/11` | idem |
| SPORT × BETA | `docs/00`, `docs/11`, `docs/12`, `a5P0Hardening.integration.test.ts` | docs : idem ; test : union des deux blocs d'import |

Aucun conflit de code de production : les trois branches ne modifient aucun fichier source commun.

## 3. Conflits sémantiques (sans conflit textuel, mais cassants)

| # | Paire | Constat | Résolution proposée |
|---|---|---|---|
| S1 | SPORT × BETA | **Le test fusionné ne compile plus.** Le nouveau test SPORT « no bypass under an open concussion » appelle `generateAndPersistTrainingPlanV2`, dont BETA a retiré l'import. Git fusionne sans le signaler. | Générer ce second programme avec `generateSignedV2Plan` (le fichier tourne dans la partition signée « test » depuis BETA). Assertions inchangées. |
| S2 | PR2 × BETA (B) | `v2DhRevocationV1Http` génère un programme V1 par HTTP pour un rider **sans affectation** : la règle B répondra 403. | Affectation `v1` explicite dans la fixture, comme pour `v2L2History` et `bugV23StartDate`. Assertions inchangées. |
| S3 | PR2 × BETA (T2) | `v2DhRevocationDailyRun` modélise la « production » par un quotidien **sans** unité DH et attend des jours DH sans unité servis (`created`, unité `none`). Après T2, la production exige toujours l'unité : ces jours sont bloqués (`dh_repetition_unit_unknown`) avant toute révocation. Le test passe encore (appel de bibliothèque), mais sa « production » n'est plus la production. | **À décider, ce n'est pas cosmétique** : faire tourner le rider « production » avec `DAILY_DH_UNIT_REQUIREMENT` et attendre `blocked` pour ses jours DH sans unité ; la révocation reste prouvée sur le rider signé. Change des attentes documentées de PR2 : accord de l'architecte requis. |
| S4 | PR2 × BETA (canon) | PR2 insère la section `dh_drill_revocations` juste après le paragraphe `training_plan_model_assignments` de `docs/05`, que BETA propose de réécrire. | Appliquer le canon BETA **après** celui de PR2, et vérifier à la main. |
| S5 | SPORT × BETA (T2) | Seul le nouveau test de S1 génère en Node un programme V2 sans unité, puis passe un jour DH par le runtime. `sportSafe02A5Lifecycle` (une ligne changée par SPORT) passe déjà sur le runtime BETA. | S1 ; rejouer `sportSafe02A5Lifecycle`. |
| S6 | Migrations | PR2 `20261027120000`, puis SPORT `20261028120000` : aucun objet commun. Chaîne, contrôles et rollbacks validés en REVIEW 1 (79 migrations, 0 échec). | Si l'option A de l'exemption V1 est retenue, horodater la migration BETA **après** `20261028120000`, pour garder l'ordre quel que soit l'ordre de fusion. |

## 4. Ordre recommandé : PR2, puis BETA, puis SPORT

1. **PR2** : branche déjà poussée, migration la plus ancienne, protection de sécurité. Attend l'approbation de son canon (R1).
2. **BETA** : protections seulement (T2 fail-closed, refus B), prérequis de la bêta. Rebasée sur PR2 ; elle porte S2, S3 et S4.
3. **SPORT** : changements de contenu, qui dépendent de signatures professionnelles, et migration candidate. Rebasée en dernier ; elle porte S1 et S5.

Si PR2 tarde, BETA peut passer avant : PR2 porte alors S2 et S3 elle-même. Les résolutions sont les mêmes.

## 5. Tests à rejouer à chaque étape

Sur pile jetable neuve, **par le garde-fou**.
- Un passage n'est retenu que si le journal du runtime ne montre **aucun rechargement** pendant la suite.
- Les morts de workers (obstacle Windows, `V2_OFF_STABILITY.md`) sont comptées à part, jamais comme des réussites.

| Étape | Unitaires et build | Intégration |
|---|---|---|
| BETA sur PR2 | `head-coach-engine`, Edge, `planning-engine`, web ; `build:release` ; typecheck aux bases | suite complète V2 OFF (avec les suites PR2) ; partition V2 ON signée « test » ; V2 ON bundles réels ; web ; suites destructives de PR2 sur **pile neuve dédiée** (`RUN_LOCAL_DH_REVOCATION=1` : `v2DhRevocation`, `v2DhRevocationDailyRun` après S3, `v2DhRevocationV1Http` après S2, `powerGuard01`) ; orchestrations HTTP `generatePlanV2Rollout` et `dailyRunV2` ; contrôle PR2 en lecture seule |
| SPORT sur PR2 + BETA | `planning-engine` (instantanés), web (`ConcussionFollowUpForm`), `build:release` dont `verify:sport-approvals` | chaîne de migrations neuve dans l'ordre ; contrôle SPORT ; rollbacks SPORT et PR2 (5a, 5b de REVIEW 1) ; `a5P0Hardening` (signé, après S1), `sportSafe02A5Lifecycle`, `t21`, `runDailyFor.longitudinal`, `p0SafeHealthContinuity`, `p0SafeHealthEdge` ; puis suite complète V2 OFF, V2 ON signée, V2 ON réelle, web |

**Ce que la CI GitHub ne couvre pas** : `.github/workflows/ci.yml` lance les tests unitaires, Edge et `verify:sport-approvals`, **sans pile Supabase**. Aucune suite d'intégration n'y tourne. Une Draft PR confirmera les unitaires, pas la suite V2 OFF : celle-ci reste une preuve locale, sauf décision d'ajouter un job avec pile.

## 6. Changements canoniques à approuver, par branche

| Branche | Canon | Où |
|---|---|---|
| PR2 | `docs/04` (refus), `docs/05` (`dh_drill_revocations`), `docs/07` (terme) | sur la branche, réserve R1 |
| SPORT | `docs/04`, `docs/05` (`health_flag_attestations`) | `P0_CORRECTIONS.md`, proposés |
| BETA | `docs/05` (résolution des affectations, interrupteur ; colonne `decided_by` si l'option A est retenue) | `ADR_BETA_V2_TECH_01.md` § 5 |
| T4 (plus tard) | `docs/05` (table de suspensions), `docs/04` (code `prescription_suspended`) | `T4_SUSPENSION_DESIGN.md` |
