# REL-01 D′ — RELEASE GATE REPORT (RELEASE-GATE-01)

**Date** : 2026-10-16 · **Pour** : HPM et Louis · **Statut** : validation locale uniquement.

Rien n'a été touché :
- aucun changement de code produit ;
- aucun push ni merge, aucun déploiement ;
- aucune migration, aucun SQL ni secret en production ;
- aucune activation V2 ou PHYS.

**Verdict : READY LOCAL.** Le GO Production appartient au HPM (conditions au §10).

## 1. Candidat

| | |
|---|---|
| Code | `b3279210df03b4b88cbfbdcec02c9d03e8d7f0b3`, branche `rel/rel-01-d-prime` (locale, non poussée) |
| Ce rapport | commit docs-only au-dessus de `b327921`. L'arbre de code est inchangé : graphes Edge et migrations identiques |
| Parent | D `649a0a2` |
| Seul écart avec D | 2 renommages, contenu identique : `20261013120000` → `20261013180100`, blob `19fc9a55…` ; `20261013140000` → `20261013180200`, blob `9ced952b…` |
| Production de référence | web C `59202dc` ; base 68 migrations (C + hotfix B, dernière `20261013180000`) ; Edge `session-execution` v18, `completed-session` v22, `daily-run` v42, `generate-training-plan` v26 |
| Écart avec C | 62 commits. Moteur M1 (`src/{types,engine,rules,domains,mapping}`) : **0 fichier modifié** |

Le hotfix B (`627228d`) n'est pas un ancêtre de D′. Ses fichiers (2 migrations, `session-execution`, `completed-session`) sont **identiques** dans D′ (diff vide). `origin/main` = `59202dc`.

## 2. Migrations 68 → 74

Les 6 migrations restantes, toutes postérieures à `20261013180000`. C'est le but de D′ : le CLI les applique sans `--include-all`.

| Version | Objet | Effet |
|---|---|---|
| `20261013180100` | `persist_daily_run_v2` (remplacée) | P0-3 : KEEP manuel V2 accepté à l'écriture |
| `20261013180200` | `project_training_plan` (remplacée) ; 2 fonctions et 2 triggers ajoutés sur `planned_sessions` | P0-3 : verrou serveur d'un jour exécuté (NX201) |
| `20261013190000` | `persist_completed_session` (remplacée) | INT-01 : pas de débrief V1 sur une tentative guidée arrêtée avec résultats (NX104) |
| `20261014090000` | droits | P0-SEC : TRUNCATE retiré à `anon` / `authenticated` (fail closed) |
| `20261014120000` | droits | P0-SEC : TRIGGER retiré (fail closed) |
| `20261014150000` | droits | P0-SEC : MAINTAIN retiré si PostgreSQL ≥ 17, sinon NOTICE et aucun effet (fail closed) |

**Indépendance de l'ordre.** Les migrations renumérotées ne touchent aucun objet des deux migrations du hotfix :
- hotfix : `record_session_execution`, `persist_completed_session` et leurs fonctions d'aide ;
- renumérotées : `persist_daily_run_v2`, `project_training_plan`, verrou du jour.

**Preuve sur la pile isolée `nalynt-gate01`** (PostgreSQL 17.6, données fictives) :
- **Point de départ** : état de production. C `59202dc` + B, 68 migrations. Les corps, la sécurité, les réglages et les droits des 4 fonctions du hotfix sont égaux aux valeurs de production relevées par Louis (P2 post-installation).
- **`db push --dry-run`** : exactement les 6 fichiers ci-dessus ; aucun seed, aucun rôle.
- **`db push`** : 6 migrations appliquées en 4 s, sans erreur, historique 74. Aucun `--include-all`, aucun `migration repair`.
- **Contre-épreuve** (gate du hotfix) : D original exige `--include-all`. `20261013120000` et `20261013140000` sont antérieures à `20261013180000`, et le CLI refuse (`LegacyDbPushMissingRemoteError`).

## 3. Équivalence avec D

| Contrôle | Résultat |
|---|---|
| Schéma (gate 74 vs D original 74) | **identique** : 596 objets. Fonctions avec droits, `SECURITY DEFINER` et réglages ; tables avec droits et RLS ; 8 vues, 37 politiques, 62 triggers, 129 index, 263 contraintes, 31 enums |
| Privilèges | identiques : privilèges par défaut, droits du schéma, des tables et des colonnes |
| Données | identiques avant et après le push (39 tables, 11 273 lignes, empreinte md5 par table). Les migrations ne réécrivent aucune ligne |
| Edge | graphes D′ = D (`build:release:all --verify-only`) |

## 4. Tests et preuves (pile `nalynt-gate01`, cible vérifiée)

Les suites D′ impriment la cible vérifiée `[test-target] project=nalynt-gate01` (QA-ISOLATION-01). Le harnais de C ne connaît pas encore ce contrôle. Il vise la gate par `SUPABASE_URL`, `LOCAL_SUPABASE_API_PORT` et `LOCAL_SUPABASE_DB_CONTAINER` (vérifiés). L'échec attendu `athletesDeleteGrant` (ci-dessous) n'est possible que sur une base où P0-SEC est appliqué, ce qui confirme la cible.

### 4.1 D′ complet (SQL 74, Edge D′ servies, web D′)

| Suite | Résultat |
|---|---|
| head-coach-engine (DB + Edge) | **1455/1455** (142 fichiers, 0 ignoré) |
| web | **2274/2274** (163 fichiers) |
| longitudinal-engine | 890/890 |
| planning-engine | 883/883 |
| prescription-engine | 96/96 |

Parcours critiques couverts par les suites. Regroupement par nom de fichier ; head-coach / web :

| Parcours | head-coach | web |
|---|---|---|
| P0-SAFE, santé (R3/R4/R6) | 36/36 | 26/26 |
| INT-01, débrief V1 | 24/24 | 218/218 |
| Séance guidée et terminaison | 30/30 | 106/106 |
| Décision quotidienne | 170/170 | 226/226 |
| Génération et acceptation de plan | 109/109 | 73/73 |
| Historique | 12/12 | 176/176 |
| Concurrence | 10/10 | 8/8 |
| V2 désactivée / rollout | 51/51 | — |
| P0-SEC, droits, RLS | 94/94 | — |
| P0-3 manuel, verrou du jour | 38/38 | 34/34 |

### 4.2 Preuves ciblées

| Preuve | Résultat |
|---|---|
| Matrice P0-SAFE (fichier du hotfix) | 9/9 : R3, R4, R6 refusés |
| Edge P0-SAFE | 3/3 : 409 `health_suspended`, observabilité `health_suspended` |
| Reproduction P0-SAFETY-INV-01 | 6/6. O-43/O-46 et le mécanisme de restauration d'O-45 reproduits ; R3, R4, R6 refusés ; R5 sans check-in automatique |
| O-32 (web) | 3/3, défaut reproduit (§7) |
| V2 OFF → ON → OFF (Edge HTTP, JWT des riders) | **26/26** : OFF → V1 ou 503 `v2_generation_disabled`, jamais V1 pour un rider V2 ; corps forgés refusés ; plan V2 accepté, séance guidée, daily-run ; retour OFF sans perte |
| Séance partielle (web, test temporaire) | 3/3. Défaut constaté et préexistant (§7) |
| Précontrôle SQL de production (`REL_01_D_PRIME_PRECHECK_READONLY.sql`) | validé sur la gate dans les deux états. PRE sur l'état 68, simulé dans une transaction annulée : rollbacks SQL et retrait des 6 lignes d'historique, toutes les valeurs attendues. POST sur l'état 74 : toutes les valeurs attendues. Gate inchangée ensuite |

### 4.3 États intermédiaires et compatibilité

| Combinaison | Résultat |
|---|---|
| **S1** — SQL D′ + Edge C+B + web C (après l'étape SQL) | head-coach C 1297/1298. Seul échec : `athletesDeleteGrant`, test catalogue de C qui attend TRIGGER / TRUNCATE ; P0-SEC les retire volontairement, et D′ a adapté ce test. Web C 2136/2136 |
| **S3** — SQL D′ + Edge D′ + web C (fenêtre avant le web) | web C 2136/2136 |
| **daily-run D′ sur les plans générés par C** (état de production juste après le déploiement) | 6/6 décisions persistées sur des plans courants C (catalogues `session-model-v2.6` et `v3`) : KEEP `created`, REST `not_required`, REPLACE. Aucune erreur |
| Référence C+B sur la pile, avant le push | head-coach C+B 1298/1298 (9 tests de matrice ignorés, ils exigent une variable d'étape) |

## 5. Compatibilité avec la production actuelle

**Edge** — inventaire `verify-only` de D′ comparé aux sources de production :

| Fonction | D′ | Production | Action |
|---|---|---|---|
| `daily-run` | `e00f0011…` | v42, `c9df7832…` (C) | **redéployer** |
| `generate-training-plan` | `dbccafa4…` | v26, `b8815db1…` (C) | **redéployer** |
| `session-execution` | `aebd17b1…` | v18 (B), même graphe | **aucun redéploiement** |
| `completed-session` | `b1b067cf…` | v22 (B), même graphe | **aucun redéploiement** |
| `abandon-training-plan`, `accept-training-plan`, `get-insights`, `health-flag-resolution`, `refresh-longitudinal`, `submit-review` | graphes = C | sources de production vérifiées = C | aucune |

Ces deux redéploiements viennent du code partagé, pas des dossiers de fonctions :
- `head-coach-engine/src/supabase` : `reconcileFinalPrescriptionV2`, `trainingPlanVersionSnapshotRepo` ;
- `planning-engine/src` : catalogues, `dhPrescriptionV2`, `buildFinalPrescriptionV2`, `buildKeepFinalPrescriptionV2`, `validatePlanInputSnapshot` ;
- `generate-training-plan/index.ts`.

**Web** : 39 fichiers hors tests changent, plus 34 fichiers de tests :
- débrief (`afterSession`, `completedSessionErrors`) et check-in ;
- Aujourd'hui (`DailyPlanPanel`, `DailyPlanView`, `bodyStatus`, `TodayPage`) ;
- séance guidée (DH, Force, `executionRepo`, `healthBlock`, chargeur) ;
- historique (P0-4 : détail des séances guidées, `HistoryDetailPage`) ;
- planification (verrou du jour, `PlanPage`) ;
- `FinalPrescriptionV2Card`, erreurs de génération, options de profil, `tsconfig.build.json`.

**SQL** : les 6 migrations du §2.

## 6. Risques

| Risque | Exposition | Traitement |
|---|---|---|
| Version PostgreSQL de production non consignée dans le dépôt | effet de `20261014150000` : révocation (≥ 17) ou NOTICE sans effet (< 17, décision HPM 6) | bloc 6 du précontrôle. Si < 17 : STOP et décision HPM avant le push |
| P0-SEC fail closed | une table hors liste avec TRUNCATE / TRIGGER / MAINTAIN, un droit `PUBLIC` ou une appartenance de rôle fait échouer la migration | bloc 4 du précontrôle (attendu : 0 ligne, 0 / 0). Échec quand même : historique entre 71 et 73, la migration fautive annulée. État fonctionnellement = S1 (P0-SEC ne retire que des droits), donc STOP sans nouvel essai |
| Verrous pendant le push | `CREATE OR REPLACE` de 3 fonctions, 2 triggers sur `planned_sessions`, `REVOKE` sur 12 tables. Verrous brefs, une transaction par migration | 4 s en local ; push hors heures d'usage |
| Concurrence `persist_daily_run_v2` | ne prend pas le verrou consultatif (limite documentée dans D, `P0_3_RELEASE_PLAN`) | inchangé, accepté dans D |
| Fenêtres entre étapes | SQL seul ; SQL + Edge D′ + web C | prouvées sûres (S1, S3) |
| Références aux anciens numéros `20261013120000` / `20261013140000` | 16 fichiers : docs, commentaires, noms des scripts de rollback P0-3. Rien d'exécutable | non corrigé : corriger le commentaire de `buildFinalPrescriptionV2.ts` changerait le graphe `daily-run`. Correspondance au §1 |
| Surveillance 48 h du hotfix B | se termine le 2026-10-18 | recommandation : ne pas commencer D′ avant le PASS T+48 |
| Web = push sur `main` | fast-forward `59202dc` → commit du rapport ; Vercel déploie automatiquement | GO HPM distinct pour le push ; la branche du hotfix B (rapport de production) reste hors `main` |

## 7. Défauts connus (non corrigés, comme demandé)

| Défaut | D′ | Classement |
|---|---|---|
| **O-43 / O-46** : séance manuelle hors du plan courant | reproduit : `trainingPlanReview`, `TrainingPlanPreviewPage`, `todayContext(Repo)` inchangés depuis C | **anomalie déjà présente dans C** (CONFIRMED PROD, lignes manuelles héritées) |
| **O-32** : mission périmée après un changement de date | reproduit (test web 3/3) : restauration de `DailyPlanPanel` inchangée | **anomalie déjà présente dans C** (défaut client) |
| **Message générique sur le refus R6** malgré le 409 | **corrigé par le web D′** : `completedSessionErrors.ts` traduit `health_suspended`, `daily_decision_not_current` et `guided_results_exist` en messages dédiés. Avec le web C, le message reste générique | corrigé par D′ ; effectif seulement après l'étape web |
| **Séance partielle présentée comme réalisée** | voir le détail ci-dessous | anomalie déjà présente dans C, atténuée par D′ |
| O-45 : décision antérieure au signal restaurée | mécanisme reproduit, sans changement | anomalie déjà présente dans C (SIMULATION ONLY / HISTORICAL, rapport INV-01) |

**Séance partiellement effectuée — détail.**

Le serveur accepte une séance partielle : une série réalisée suffit, séries manquantes et arrêt anticipé sont permis après confirmation. C'est un **comportement voulu et documenté** (`11_DECISION_LOG`, F-6C). La confirmation dit ce qui manque (`strengthPartialCompletionMessage`).

La présentation, elle, **dit « Réalisée »** dans ces deux cas (prouvé, 3/3) :
- une séance guidée terminée avec des séries manquantes ;
- un débrief V1 « partiel ».

Causes, dans `WeekDaysPicker.tsx:22` et `ProgramSessionCard.tsx:49` :
- le modèle de lecture (`effectiveDay.ts:88`) ne connaît que les événements, pas le nombre de séries ;
- `performed` regroupe done, partial et replaced.

En revanche, l'historique V1 affiche « Séance partiellement réalisée ».

Ce que D′ change :
- une tentative arrêtée n'est jamais comptée comme réalisée (`guidedPartialOf`) ; elle apparaît comme « arrêtée » ;
- le détail de l'historique (P0-4) montre les résultats série par série.

**Défauts du harnais** (pas du produit), corrigés par des copies temporaires non versionnées :
- `functionsRuntime.ts` code en dur le conteneur Edge `supabase_edge_runtime_louis-performance-system` ;
- l'orchestrateur de rollout code en dur les dates 2026-10-06 → 11, antérieures au début d'un plan généré aujourd'hui.

Avec ces deux corrections : 26/26.

## 8. Procédure de déploiement (proposée, non exécutée)

Règles :
- un GO HPM, puis la confirmation de Louis, avant chaque écriture ;
- **STOP** après chaque étape tant que sa vérification n'est pas conforme ;
- jamais `--include-all`, `migration repair`, `--prune`, `--no-verify-jwt`, `--use-api` ;
- aucun smoke qui modifie des données sans GO distinct ;
- Louis exécute le SQL de production.

| # | Action | Vérification | Si non conforme |
|---|---|---|---|
| P1 | Checkout propre du commit approuvé (`C:\Users\Louis\nalynt-rc-<sha>`) et liaison au projet `uvolpldwwyvadlamulvr`. `npm ci`, `npm run build:release:all`, puis `-- --verify-only` | sortie 0 ; seuls `daily-run` (`e00f0011…`) et `generate-training-plan` (`dbccafa4…`) diffèrent de la production ; `session-execution` `aebd17b1…` et `completed-session` `b1b067cf…` égaux | STOP |
| P2 | `npx supabase migration list --linked` | 68 appliquées, dernière `20261013180000` ; exactement les 6 du §2 en attente ; aucune distante inconnue | STOP |
| P3 | `npx supabase functions list --project-ref uvolpldwwyvadlamulvr` | versions du §1 ; noter `ezbr` de `daily-run` / `generate-training-plan` (référence de retour arrière) ; `verify_jwt = true` partout | STOP |
| P4 | `REL_01_D_PRIME_PRECHECK_READONLY.sql`, blocs 1 à 7 (Louis) | valeurs attendues des blocs 1 à 5 ; bloc 6 ≥ 170000 | STOP et rapport au HPM |
| P5 | Retour arrière Edge prêt : `D:\nx\rel01-c-deploy` ou checkout propre de `59202dc` | graphes C `daily-run` `c9df7832…`, `generate-training-plan` `b8815db1…` | STOP |
| **1a** | `npx supabase db push --linked --dry-run` | **exactement** les 6 fichiers du §2 | STOP |
| **1b** | `npx supabase db push --linked` | `migration list` 74/74 ; SQL POST Q1–Q5 conforme (Louis) | voir ci-dessous |
| **2** | `npx supabase functions deploy daily-run --project-ref uvolpldwwyvadlamulvr` (**jamais avant 1b** : un KEEP manuel V2 exige `20261013180100`) | version +1, ACTIVE, `verify_jwt = true`, aucune autre fonction changée ; sans JWT : 401. Journaux (Louis) : démarrage sans erreur | redéployer `daily-run` C depuis P5 |
| **3** | `npx supabase functions deploy generate-training-plan --project-ref uvolpldwwyvadlamulvr` | idem | redéployer `generate-training-plan` C depuis P5 |
| **4** | Web, après GO push distinct : `git log --oneline origin/main..HEAD` = commits D′ seulement, puis push fast-forward sur `main` (Vercel `nalynt`) | bundle servi contenant « Un signal de santé suspend l'entraînement ce jour-là » et « Seuls son type et sa charge sont connus » | promotion Vercel du déploiement C |
| 5 | Surveillance 48 h : journaux des 4 fonctions concernées, `persistence_failed`, 5xx | aucune hausse ; des 409 `health_suspended`, `daily_decision_not_current` et NX201 sont possibles et voulus | décision HPM |

**Échec à l'étape 1b.** Chaque migration a sa propre transaction (prouvé avec le hotfix). La migration fautive est annulée et les précédentes restent :
- **après 180100 ou 180200** : SQL compatible avec les Edge C et le web C (S1) ; STOP, pas de nouvel essai à l'aveugle ;
- **échec P0-SEC** : historique entre 71 et 73, état fonctionnel complet ; STOP, analyse des droits (bloc 4).

**Ce qui ne bouge pas** :
- `session-execution` et `completed-session` (graphes identiques à v18 / v22) ;
- les 6 autres fonctions ;
- les secrets et les flags V2 / PHYS.

## 9. Procédure de retour arrière

**Configuration recommandée** (INT-01 §4.2, répétée sur la gate) :

| Composant | En cas de retour arrière vers C |
|---|---|
| SQL (74) | **conservé** : gardes santé, verrou du jour, gardes du débrief, P0-SEC |
| `daily-run`, `generate-training-plan` | sources C (v42 / v26 actuelles, depuis `rel01-c-deploy`) |
| `session-execution`, `completed-session` | inchangées (B = D′) |
| Web | **D′ conservé de préférence**. Sinon : promotion Vercel du déploiement C, puis `git revert` |

**Preuves sur la gate**, après des données D′ :
- **Edge C+B + web D′ sur SQL D′** : web 2274/2274, plus les 6 tests temporaires de la gate (2280/2280 au total) ;
- **head-coach C sur la même base** : 1297/1298, seul échec `athletesDeleteGrant` (attendu, §4.3). Un fichier interrompu par un crash du worker vitest passe 6/6 une fois relancé ;
- **plans D′ contenant le nouveau drill `cornering_advanced_line_exit`** : acceptés par le code C, puis décisions quotidiennes C sur les jours du drill, 4/4 KEEP `created`, drill conservé. C lit le contenu D′ ; ce n'est pas une cible de retour arrière perdue.

**Retour arrière SQL (exceptionnel)** : seulement si le SQL lui-même est en cause. Les scripts `supabase/rollbacks/` sont rejoués comme **nouvelles** migrations, en ordre inverse :
`p0_sec` 150000 → 120000 → 090000, `int01` 190000, `p0_3` « 140000 » (verrou, = `180200`), puis « 120000 » (= `180100`, jamais avant le retour de `daily-run` C).

**Répétition sur la gate** : les 6 scripts, dans une transaction annulée (`BEGIN … ROLLBACK`), s'appliquent sans erreur. Résultats :
- schéma revenu exactement à C+B : **592/592 objets**, dont 4 égaux après neutralisation des fins de ligne ;
- `persist_completed_session` = valeur de production post-B ;
- droits sensibles rétablis.

La gate est restée à 74, ce qui a été vérifié. **Avertissement** : les rollbacks P0-SEC redonnent volontairement des privilèges dangereux, ils ne sont pas un retour arrière de routine. Aucune donnée n'est réécrite dans un sens ou dans l'autre.

## 10. Verdict

**READY LOCAL** pour `b327921` :
- 68 → 74 sans `--include-all` ni réparation ;
- schéma, droits et Edge équivalents à D ;
- suites complètes vertes ;
- états intermédiaires et retour arrière prouvés ;
- aucune régression introduite par D′ trouvée.

**Conditions avant un GO Production** (décision HPM) :
1. PASS de la surveillance T+48 du hotfix B (2026-10-18).
2. Précontrôle P1 à P4 conforme, dont la version PostgreSQL (bloc 6).
3. GO séparés pour : le push SQL, chaque Edge, le push `main` (web).
4. Les défauts du §7 restent ouverts. O-43/O-46, O-32 et la présentation « Réalisée » d'une séance partielle sont antérieurs à D′ et ne bloquent pas ce gate ; ils relèvent de tickets distincts.

Preuves brutes (sorties de tests, empreintes, journaux) : scratchpad local de la session, non versionné. Valeurs reprises ici et dans le fichier SQL.
