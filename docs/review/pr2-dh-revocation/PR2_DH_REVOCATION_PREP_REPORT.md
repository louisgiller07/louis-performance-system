# PR2-DH-REVOCATION-PREP — rapport (LOCAL, HPM 2026-10-27)

**Branche** : `release/v2-dh-revocation`, depuis `main` `a0a8921`. Locale : ni poussée, ni fusionnée, ni déployée. Aucune migration appliquée en production.

## Périmètre

| Fichier | Rôle | Origine |
|---|---|---|
| `supabase/migrations/20261027120000_v2_dh_drill_revocation.sql` | table en ajout seul, aide en lecture, `record_session_execution` et `persist_daily_run_v2` avec garde READ COMMITTED (`NX301`), verrou `SHARE` et refus (`dh_validation_not_current`, `NX302`) | candidat revu (RELEASE-PREP-FINAL-01, RELEASE-CANDIDATE-CLOSE-01) : seuls l'en-tête et les marqueurs de commentaire changent, SQL identique (vérifié en retirant les commentaires). Un seul écart, demandé par le HPM le 2026-10-28 : `service_role` ajouté au `revoke` de la fonction d'aide (moindre privilège) ; corps des fonctions inchangés |
| `supabase/rollbacks/v2_dh_revocation/20261027120000_rollback_v2_dh_drill_revocation.sql` | rollback refusé tant qu'une révocation existe, table verrouillée avant le contrôle, table fermée aux nouvelles révocations | candidat revu : en-tête et deux messages seulement |
| `supabase/functions/session-execution/validation.ts`, `dhValidationGuard.ts` | `REJECTION_STATUS.dh_validation_not_current = 409` (code renvoyé par la RPC) | prévu par le candidat (« with the GO ») |
| `head-coach-engine/tests/supabase/powerGuard01.integration.test.ts` | empreinte = corps de la migration ; propriétés conservées et ajoutées ; comportement transactionnel | RELEASE-CANDIDATE-CLOSE-01, pointé sur la migration |
| `head-coach-engine/tests/supabase/v2DhRevocation.integration.test.ts` | isolation, verrou de table vide, rollback concurrent, première révocation, droits, actions refusées / conservées, concurrence, contre-preuve READ COMMITTED, refus du daily-run, rollback refusé | suite candidate, pointée sur la migration |
| `head-coach-engine/tests/supabase/v2DhRevocationDailyRun.integration.test.ts` | daily-run réel : KEEP / MODIFY / REPLACE / manuel servis puis refusés, concurrence, Force / REST / V1 inchangés ; **rider V2 OFF fidèle à la production** | suite candidate + rider V2 OFF |
| `head-coach-engine/tests/supabase/v2DhRevocationV1Http.integration.test.ts` | V1 de bout en bout en HTTP avec le JWT du rider | nouveau |
| `docs/release/PR2_DH_REVOCATION_RELEASE_PLAN.md`, `docs/release/pr2-dh-revocation/*.sql` | procédure de déploiement, préalables et contrôle post-migration (lecture seule) | nouveau |
| `web/vercel.json`, `marketing-site/vercel.json` | `git.deploymentEnabled` : `release/v2-dh-revocation` exclue des déploiements Git automatiques, à côté de `release/v2-dh-protections-off` | HPM 2026-10-28 |

**Déjà dans `main` depuis la PR1, non réintroduit** : `DhDrillRevokedError` et le mapping `NX302` → 409 (`persistDailyRunV2.ts`, `daily-run/errorMapping.ts`), le garde Edge de validation côté code (`session-execution`), leurs tests.

**Non embarqué** : prototypes, catalogues non validés, doses, signatures (tables de signatures vides), CODEOWNERS, dossiers de revue de la branche de travail.

## Compatibilité des fonctions

- **`session-execution`** : appelle `record_session_execution`. Code 409 ajouté. Le code de production (v19) sur la base migrée est inchangé tant que la table est vide (S1).
- **`daily-run`** : appelle `persist_daily_run_v2`. Mapping 409 déjà dans `main`. Code de production (v48) inchangé sur la base migrée (S1).
- **`generate-training-plan`** : n'appelle aucune des deux RPC et ne lit pas la table. Compatible par construction ; ses tests passent sur la base migrée (S1, S2).

## Preuves

### S1 — code Edge et schéma de production, avant et après la migration

Configuration : `1e0de28` (source de `daily-run` v48 et de `session-execution` v19), les 77 migrations de production, sur la stack Docker locale jetable `nalynt-dhunit01` (`127.0.0.1:59421`).
- **Base locale reconstruite** : `supabase start` sur une stack vide, 77 migrations rejouées, aucun seed ; arrêtée avec `--no-backup` (volume supprimé).
- **Données fictives** : toutes les lignes sont créées par la campagne de tests elle-même (pilotes de test). Aucune donnée de production importée, ni dump ni restauration.
- **Production non touchée** : aucune commande `--linked`, `db push` ni déploiement ; aucune URL ni clé de production. Les clés viennent de `supabase status` de la stack locale.

1. **Campagne de référence** : 1 236 tests réussis, 22 ignorés, 0 échec, sur 140 fichiers. Les trois fichiers V2 ON (`p0FirstGenerationEdge`, `p0_2DhTerrainMatrix`, `p0_3KeptDayRerun`) répondent 503 `v2_generation_disabled` en V2 OFF ; ils sont exclus comme dans la PR1.
2. **Empreinte des 40 tables de `public`** (nombre de lignes et hash de toutes les lignes) : 21 734 lignes, dont 364 prescriptions du jour, 4 602 prescriptions prévues, 578 décisions, 194 exécutions, 363 événements, 330 séries.
3. **Migration appliquée en une transaction** : les 40 tables restent **identiques** ; seule `dh_drill_revocations` s'ajoute, vide.
4. **Même campagne, ancien code Edge sur la base migrée** (état intermédiaire du déploiement) : une seule différence sur 1 273 tests. C'est l'empreinte `powerGuard01` de `1e0de28`, qui vérifie que le corps installé est celui de `power_guard_01` : il a changé, comme attendu. Tout le reste est identique.
5. **Rollback, puis réapplication, sur la base locale peuplée par les tests** (43 465 lignes) : les 41 tables restent identiques à chaque étape. Fonctions réinstallées, table vide.

**Conclusion** : aucune prescription, décision ou exécution historique n'est modifiée, ni par la migration ni par son rollback.

### S2 — PR2, 78 migrations, code Edge PR2 (stack fraîche)

- **Contrôle post-migration** (`PR2_POSTCHECK_READONLY.sql`) : `on|78|20261027120000|0|t|t|t|t|t|t|t|t`. Les trois empreintes md5 des corps de fonction sont vérifiées.
- **Campagne complète, V2 OFF, runtime Edge servi**, sans parallélisme de fichiers :
  - 1 284 réussis, 40 ignorés, **0 échec**, **aucun arrêt de worker** ;
  - les 40 ignorés sont les 24 ignorés par environnement de la référence et les 16 tests de révocation en opt-in (S3, S4) ;
  - hors partition, comme dans la PR1 : les trois fichiers V2 ON, en 503 `v2_generation_disabled` en V2 OFF (10 tests).
- **Comparaison avec la référence PR1** (`b3c71f8`, même arbre que `a0a8921`, 77 migrations) : aucun test réussi devenu échoué.
  - L'empreinte `powerGuard01` est remplacée par celle de la migration.
  - Six tests `powerGuard01` s'ajoutent (quatre assertions de fichier, l'empreinte, la sonde transactionnelle).
  - Le test V1 HTTP s'ajoute et passe (5 / 5).
  - 52 tests en attente dans la référence PR1, à cause d'arrêts de worker, passent ici.
- **Exécutions précédentes, pour mémoire** :
  - 1ʳᵉ : le test V1 HTTP était faux (corps de `generate-training-plan`, puis forme de la réponse de `daily-run`). Corrigé dans le test seulement, puis campagne complète relancée.
  - 2ᵉ et 3ᵉ (4 puis 2 workers) : arrêts de worker Vitest sous Windows (1 puis 59 tests non exécutés, aucun en échec). Elles ne valent pas PASS. D'où la campagne finale sans parallélisme.

### S3 — suite de révocation (stack fraîche, migration appliquée par `supabase start`)

`v2DhRevocation.integration.test.ts` : **12 / 12**, aucun arrêt de worker. Tests 1 à 5 sur une table vide :
1. isolation (`NX301` d'abord, rien d'écrit) ;
2. verrou de table vide ;
3. rollback concurrent (révocations de `service_role` et du propriétaire retenues puis refusées ; fonctions restaurées à l'identique ; réapplication) ;
4. première révocation, qui retient une exécution, un daily-run et le rollback ;
5. révocation en attente comptée par le rollback.

Ensuite :
- droits (opérateurs seuls, ajout seul) ;
- le rider ne peut ni lire ni écrire une révocation ;
- actions refusées et conservées ;
- concurrence dans les deux sens ;
- contre-preuve READ COMMITTED ;
- daily-run refusé sans écriture ;
- rollback refusé tant qu'une révocation existe.

### S4 — daily-run et révocation, V2 OFF et V2 ON (stack fraîche)

`v2DhRevocationDailyRun.integration.test.ts` : **4 / 4**, aucun arrêt de worker.
- **Rider fidèle à la production (V2 OFF)** : tables de signatures vides, programme V2 aux comptes sans unité, daily-run sans `dhUnit`.
  - Avant révocation : KEEP, MODIFY, REPLACE et manuel sont servis, sans unité.
  - Après révocation : chacun est refusé, rien n'est écrit, jamais un REST. La décision du jour reste, et son document sans unité ne peut plus être démarré (`dh_validation_not_current`).
- **Rider « V2 ON »** (signatures de test, unité exigée) : mêmes résultats. En plus, une révocation en cours d'écriture retient le daily-run, qui la voit ensuite.
- **Non touchés** : un jour de Force (pour les deux riders), un REST et un rider V1.

### Tests unitaires et build

| Suite | Résultat | Écart avec `main` |
|---|---|---|
| head-coach-engine | 1 110 réussis, 729 ignorés (intégration sans stack ; recompté le 2026-10-28, l'ancien « 724 » était faux) | +4 : assertions de fichier sur la migration |
| Edge | 66 / 66 | — |
| planning-engine | 1 163 réussis, 4 ignorés | — |
| `verify:sport-approvals` | PASS : 0 exercice signé, aucun valideur | — |
| web | 2 495 réussis, 64 ignorés | — |
| `build:release` | OK | — |

Typecheck : 28 erreurs, déjà présentes sur `main` (ensemble identique) ; aucune dans un fichier de la PR2.

### Corrections ciblées (HPM 2026-10-28)

**Vercel.** `git.deploymentEnabled` exclut `release/v2-dh-revocation` dans `web/vercel.json` et `marketing-site/vercel.json`, à côté de `release/v2-dh-protections-off`.
- Les deux fichiers sont valides selon le schéma officiel `openapi.vercel.sh/vercel.json` ; deux contre-exemples sont bien rejetés.
- Hors `git`, les clés sont identiques à `main`.
- Règle Vercel simulée (minimatch ; une branche est déployée si aucune règle ne la vise ou si au moins une règle vaut `true`) :
  - `release/v2-dh-revocation` n'est plus déployée ;
  - `main`, `release/v2-dh-protections-off` et les autres branches, y compris `release/v2-dh-revocation-2`, se comportent comme sur `main`.
- Aucune règle `true` ne peut annuler l'exclusion.

**Droits de `execution_dh_revocation_block`.** Avant la correction, mesuré sur une stack fraîche :
- la fonction est en SECURITY INVOKER et appartient à `postgres` ;
- `PUBLIC`, `anon` et `authenticated` n'ont pas `EXECUTE` ;
- **`service_role` a `EXECUTE`**, accordé par les privilèges par défaut de Supabase : `POST /rest/v1/rpc/execution_dh_revocation_block` répond 200 avec la clé `service_role`.

Il n'y avait aucune élévation de droits, car la fonction est en lecture seule et `service_role` lit déjà ces données. Mais elle était exposée en RPC, contrairement à `execution_health_block`, qui renvoie 403.

Aucun appel légitime n'en dépend :
- seule `record_session_execution` l'appelle ;
- `record_session_execution` est en SECURITY DEFINER et a le même propriétaire, `postgres`, qui exécute donc la fonction ;
- aucun code Edge, web ou moteur ne l'appelle directement.

Correction : `service_role` est ajouté au `revoke` de la migration, dans sa transaction. C'est la seule ligne SQL modifiée ; les corps de fonction et leurs empreintes md5 ne changent pas.

Après la correction, sur une stack fraîche :
- `PUBLIC`, `anon`, `authenticated` et `service_role` n'ont plus `EXECUTE` ; le propriétaire le garde ;
- en RPC, `anon` reçoit 401 et `service_role` 403, avec le code `42501` ;
- le contrôle post-migration, colonne 7 renforcée, donne `on|78|20261027120000|0|t|t|t|t|t|t|t|t`.

Tests rejoués, chacun sur une stack fraîche, sans arrêt de worker :

| Campagne | Résultat |
|---|---|
| S3 `v2DhRevocation`, avec l'assertion de droits étendue (`service_role`, `PUBLIC`, propriétaire, SECURITY DEFINER / INVOKER) et l'appel RPC `service_role` refusé | 12 / 12 |
| S4 `v2DhRevocationDailyRun`, dont un démarrage refusé par la RPC via `session-execution` | 4 / 4 |
| Parcours d'exécution via `service_role` et l'Edge : `sessionExecution`, `executionResultIntegrity`, `sessionActivityResults`, `powerGuard01`, `p0_3HealthSuspendedExecution`, `v2DhSportGate01b`, `v2DhSportGate01c`, `v2DhUnit01` | 57 / 57 |
| head-coach-engine (unitaires) | 1 110 réussis, 729 ignorés, comme avant la correction |

**Invariant REST / Safety.** `health_flag_to_create` n'est renseigné qu'à un seul endroit de M1, la branche Safety de `buildDailyPlan` : la séance finale et la décision y sont REST. Une prescription REST (`not_required`) ne contient aucun exercice. Un refus pour révocation ne peut donc pas faire perdre un signal de santé. S4 le confirme : un REST n'est pas touché.

## V2 OFF

- Aucun flag n'est touché : la migration ne lit ni n'écrit de secret.
- Production, lecture seule (contrôle post-merge PR1) : `NALYNT_V2_PLAN_GENERATION_ENABLED` vaut `"false"`, les autres interrupteurs V2 sont absents.
- Les campagnes tournent avec V2 OFF. La révocation s'applique au chemin quotidien V2 (rider dont le programme courant est V2), comme en production pour le compte de simulation. Le chemin V1 ne l'atteint jamais.

## Dépendances restantes (HPM 2026-10-28 : premier push fait, canon accepté sur le principe avec la réserve R1)

1. **Canon** : approbation formelle de l'architecte et de Louis du commit canonique (diffs `docs/05`, `docs/04`, `docs/07`, `PR2_CANON_PROPOSED_DIFFS.md`), avant son push et avant le merge.
2. **Push** des commits locaux : GO explicite de Louis.
3. **Merge** : décision HPM.
4. **Déploiement** : GO séparé (procédure : `docs/release/PR2_DH_REVOCATION_RELEASE_PLAN.md`).
5. **Smoke V1 de production** : après le déploiement, sur un compte de test dédié, avec un accord distinct de Louis.
6. **Première révocation** : décision HPM distincte, après le déploiement complet, jamais comme test.
   - Elle exige une décision sur la suspension contrôlée et l'information des riders concernés, ainsi que sur les programmes V1 qui prescrivent le même exercice (réserve R1, `PR2_FORWARD_FIX_ANALYSIS.md`).
   - Le retrait des signatures côté code ne rétablit pas le service, et le basculement V2 → V1 n'est pas une procédure sûre.
