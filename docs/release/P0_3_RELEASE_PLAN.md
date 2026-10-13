# P0-3 — plan de livraison et de retour arrière (préparé, NON exécuté)

**Pour** : opérateur (Louis), après **GO HPM explicite**. Rien n'est déployé.
**Contenu** : branche `fix/p0-3-manual-sessions` (depuis la production P0-SAFE `92937a9`), migrations `20261013120000_p0_3_manual_keep_persist_daily_run_v2` (fonction) et `20261013140000_p0_3_planned_session_day_lock` (triggers `planned_sessions`, fonction d'aide, `project_training_plan`), Edge `daily-run` (planning-engine embarqué), web.
**Hors périmètre** : P0-2, P1-TXT-01, A12. Aucune colonne ni donnée modifiée.

## 1. Préalables (lecture seule)
| # | Contrôle | Attendu |
|---|---|---|
| 0.1 | Migrations production | 66 / 66, dernière `20261007090000` ; les deux candidates seules en attente |
| 0.2 | `functions list` | versions notées (`daily-run`, autres), `verify_jwt = true` |
| 0.3 | Corps actuels en production | `persist_daily_run_v2` identique à `20261001120000` ; `project_training_plan` identique à `20260924110000` (md5 du corps : `82649dd9…` en LF, `35eff9c5…` en CRLF — seule différence possible : les fins de ligne) |
| 0.3b | Triggers de `planned_sessions` | seul `trg_planned_sessions_updated_at` |
| 0.4 | Comptes V2 en production | nombre d'athlètes dont la version courante est `v2` (aujourd'hui : le compte Simulation) — seuls concernés par F1 |

## 2. Build de release
Checkout propre du commit RC, `npm ci`, `npm run build:release:all` puis `--verify-only`. Attendu : seul le graphe de `daily-run` change (planning-engine : branche manuelle) ; noter si `generate-training-plan` change aussi (même paquet embarqué) et ne pas le déployer s'il n'est pas nécessaire.

## 3. Ordre de déploiement
| # | Étape | Pourquoi cet ordre | Vérification |
|---|---|---|---|
| 3.1 | Migrations (`db push` : `20261013120000` puis `20261013140000`) | sans effet sur l'ancien `daily-run` (il n'envoie jamais l'origine manuelle) ; le verrou est compatible avec l'ancien web (un refus serveur y apparaît comme l'échec d'enregistrement existant) et l'ancien `accept-training-plan` (projection en SQL) | 68 / 68 ; `persist_daily_run_v2` et `project_training_plan` : `SECURITY DEFINER`, `search_path`, signature, droits inchangés ; deux triggers ajoutés ; nouvelles fonctions exécutables par aucun rôle de l'API |
| 3.2 | Edge `daily-run` | **jamais avant 3.1** : sans la migration, un KEEP manuel V2 serait refusé à l'écriture (daily-run en erreur pour ce jour) | nouvelle version ACTIVE ; sans JWT 401 ; OPTIONS 204 |
| 3.3 | Web (fast-forward `main`) | mentions V1, refus V2 précis, verrou de `/plan`, F3 ; compatible avec 3.1 et 3.2 dans les deux sens | bundle servi : « Seuls son type et sa charge sont connus », « il ne modifie pas la séance du jour » |

Fenêtre 3.2 → 3.3 : l'ancien web affiche une prescription manuelle créée comme toute prescription V2 ; un refus manuel y garde le message neutre existant.

## 4. Smoke (compte de test jetable dédié, plan V2)
1. Séance manuelle Force haut du corps → Aujourd'hui : exercices, séance guidée qui démarre ; en base `keep`, origine manuelle, aucune règle.
2. DH manuelle 90 min + 30 min au check-in → récupération active ≤ 30 min, trace « Action : adapted ».
3. Type sans builder (ex. Puissance) → refus explicite.
4. Plan V1 (autre compte jetable) → mention « Seuls son type et sa charge sont connus ».
5. Verrou : séance du jour commencée → modifier ou supprimer le jour dans `/plan` est refusé (« jour verrouillé ») ; nouveau programme généré et accepté le même jour → le jour garde sa séance, la séance se termine.
6. Purge des comptes jetables (séances terminées comprises).

## 5. Retour arrière (ordre inverse)
| # | Action | Effet |
|---|---|---|
| 5.1 | Edge `daily-run` de la release précédente | plus aucune prescription manuelle produite |
| 5.2 | Rejouer `supabase/rollbacks/p0_3/20261013140000_rollback_planned_session_day_lock.sql` comme nouvelle migration (indépendant de l'Edge) | `project_training_plan` exact de `20260924110000`, triggers et fonctions retirés ; le verrou redevient web seulement |
| 5.2b | Rejouer `supabase/rollbacks/p0_3/20261013120000_rollback_persist_daily_run_v2.sql` comme nouvelle migration | corps et droits exacts de `20261001120000` ; **jamais avant 5.1** |
| 5.3 | Web : promotion Vercel du déploiement précédent, puis revert | anciennes mentions |

**Données** : aucune table ni ligne réécrite. Les prescriptions manuelles déjà écrites restent valides pour les contraintes de table (origine `manual_override_new_kind`, `keep` sans prescription prévue) et lisibles par le web ; leurs exécutions restent intactes.

## 6. Verrou serveur (GO L1)
Livré par `20261013140000` (voir ADR P0-3). Smoke ajouté au §4 : sur le compte jetable, une séance commencée → la modification et la suppression du jour dans `/plan` sont refusées (« jour verrouillé ») ; acceptation d'un nouveau programme le même jour → le jour garde sa séance.
