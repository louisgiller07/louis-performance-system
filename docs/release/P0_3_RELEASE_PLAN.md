# P0-3 — plan de livraison et de retour arrière (préparé, NON exécuté)

**Pour** : opérateur (Louis), après **GO HPM explicite**. Rien n'est déployé.
**Contenu** : branche `fix/p0-3-manual-sessions` (depuis la production P0-SAFE `92937a9`), migration de fonction `20261013120000_p0_3_manual_keep_persist_daily_run_v2`, Edge `daily-run` (planning-engine embarqué), web.
**Hors périmètre** : P0-2, P1-TXT-01, A12. Aucune table modifiée.

## 1. Préalables (lecture seule)
| # | Contrôle | Attendu |
|---|---|---|
| 0.1 | Migrations production | 66 / 66, dernière `20261007090000` ; la candidate seule en attente |
| 0.2 | `functions list` | versions notées (`daily-run`, autres), `verify_jwt = true` |
| 0.3 | Corps actuel de `persist_daily_run_v2` en production | identique à `20261001120000` (md5 du corps comparé au fichier de rollback) |
| 0.4 | Comptes V2 en production | nombre d'athlètes dont la version courante est `v2` (aujourd'hui : le compte Simulation) — seuls concernés par F1 |

## 2. Build de release
Checkout propre du commit RC, `npm ci`, `npm run build:release:all` puis `--verify-only`. Attendu : seul le graphe de `daily-run` change (planning-engine : branche manuelle) ; noter si `generate-training-plan` change aussi (même paquet embarqué) et ne pas le déployer s'il n'est pas nécessaire.

## 3. Ordre de déploiement
| # | Étape | Pourquoi cet ordre | Vérification |
|---|---|---|---|
| 3.1 | Migration de fonction (`db push`, la seule en attente) | sans effet sur l'ancien `daily-run` : il n'envoie jamais l'origine manuelle | 67 / 67 ; `SECURITY DEFINER`, `search_path`, signature, droits inchangés (requête du §5) |
| 3.2 | Edge `daily-run` | **jamais avant 3.1** : sans la migration, un KEEP manuel V2 serait refusé à l'écriture (daily-run en erreur pour ce jour) | nouvelle version ACTIVE ; sans JWT 401 ; OPTIONS 204 |
| 3.3 | Web (fast-forward `main`) | mentions V1, refus V2 précis, verrou de `/plan`, F3 ; compatible avec 3.1 et 3.2 dans les deux sens | bundle servi : « Seuls son type et sa charge sont connus », « il ne modifie pas la séance du jour » |

Fenêtre 3.2 → 3.3 : l'ancien web affiche une prescription manuelle créée comme toute prescription V2 ; un refus manuel y garde le message neutre existant.

## 4. Smoke (compte de test jetable dédié, plan V2)
1. Séance manuelle Force haut du corps → Aujourd'hui : exercices, séance guidée qui démarre ; en base `keep`, origine manuelle, aucune règle.
2. DH manuelle 90 min + 30 min au check-in → récupération active ≤ 30 min, trace « Action : adapted ».
3. Type sans builder (ex. Puissance) → refus explicite.
4. Plan V1 (autre compte jetable) → mention « Seuls son type et sa charge sont connus ».
5. Purge des comptes jetables.

## 5. Retour arrière (ordre inverse)
| # | Action | Effet |
|---|---|---|
| 5.1 | Edge `daily-run` de la release précédente | plus aucune prescription manuelle produite |
| 5.2 | Rejouer `supabase/rollbacks/p0_3/20261013120000_rollback_persist_daily_run_v2.sql` comme nouvelle migration | corps et droits exacts de `20261001120000` ; **jamais avant 5.1** |
| 5.3 | Web : promotion Vercel du déploiement précédent, puis revert | anciennes mentions |

**Données** : aucune table ni ligne réécrite. Les prescriptions manuelles déjà écrites restent valides pour les contraintes de table (origine `manual_override_new_kind`, `keep` sans prescription prévue) et lisibles par le web ; leurs exécutions restent intactes.

## 6. Risque ouvert (décision HPM)
Verrou serveur des écritures `planned_sessions` sur un jour commencé ou terminé : non livré (trigger, migration de table). Le verrou web et `record_session_execution` protègent les exécutions, pas la cohérence du « prévu ».
