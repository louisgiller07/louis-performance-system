# PR2-DH-REVOCATION — plan de déploiement (préparé, NON exécuté)

**Pour** : opérateur (Louis), après **GO HPM explicite** et merge de la PR2. Aucune étape n'a été exécutée en production.
**Contenu** : branche `release/v2-dh-revocation`, depuis `main` `a0a8921` (PR1, en production côté web).
- **Base** : une migration additive, `20261027120000_v2_dh_drill_revocation.sql` (SQL 78).
- **Rollback** : `supabase/rollbacks/v2_dh_revocation/`.
- **Edge** : `session-execution` (code 409 de la RPC).
- **Tests.**

Aucun changement web, aucun flag. V2 reste OFF, sans signature sportive ni dose.

## Ce qui change en production

**Base.**
- Nouvelle table `dh_drill_revocations`, vide, en ajout seul, réservée aux opérateurs.
- Nouvelle fonction de lecture `execution_dh_revocation_block`.
- `record_session_execution` et `persist_daily_run_v2` sont redéfinies : corps actuels (`power_guard_01`, `p0_3_manual_keep`), plus :
  - le garde READ COMMITTED (`NX301`) ;
  - le verrou `SHARE` sur la table ;
  - les refus d'un exercice révoqué (`dh_validation_not_current` ; `NX302` pour le daily-run).
- Aucune ligne existante n'est modifiée ni supprimée.

**Edge.** Deux fonctions sont déployées depuis le commit de merge de la PR2 :
- **`session-execution`** : PR1 (garde de validation côté code) et PR2 (`dh_validation_not_current` → 409). En production : v19, source `5fff972`, identique jusqu'à `1e0de28`.
- **`daily-run`** : PR1 (`NX302` → 409 `dh_validation_not_current` ; porte DH active seulement en V2 ON). En production : v48, source `1d7d219`.

Ces fonctions embarquent le code de PR1 déjà publié côté web. Avec V2 OFF, leur comportement est celui de la production : 0 différence sur 278 daily-runs (PR1-PRECHECK-01 B).

**Non redéployée : `generate-training-plan` (v29).**
- Elle n'appelle aucune des deux RPC et ne lit pas la table : elle est compatible par construction, et la campagne S1 le vérifie.
- Ses changements de PR1 ne concernent que V2 ON : ils attendent l'activation de V2.

**Web.** Aucun changement de l'application. Seul `git.deploymentEnabled` change, dans `web/vercel.json` et `marketing-site/vercel.json` : `release/v2-dh-revocation` est exclue des déploiements Git automatiques, comme `release/v2-dh-protections-off`. `main` et les autres branches gardent leur comportement. Le merge redéclenche Vercel (`nalynt`, `nalynt-marketing`) avec une application identique.

## Pourquoi sans suspension des écritures

1. **Une seule transaction.** La migration s'applique en une transaction (une par fichier avec la CLI). Si elle échoue, rien n'est appliqué.
2. **Comportement inchangé tant que la table est vide.**
   - Les verrous `SHARE` ne se bloquent pas entre eux, et les appels de l'API tournent en READ COMMITTED : les deux RPC répondent exactement comme avant.
   - Les fonctions Edge actuelles (v48 / v19) continuent donc sans changement.
   - Preuve : campagne S1, code Edge de production sur la base migrée (stack locale jetable, données fictives).
3. **Nouvelles fonctions Edge compatibles avant et après la migration.**
   - Avant (77 migrations) : campagne de PR1.
   - Après (78) : campagne S2.
   - Toutes les fenêtres intermédiaires sont donc couvertes.
4. **Une suspension serait incomplète.** `NALYNT_WRITES_SUSPENDED` ne couvre ni `daily-run` ni `generate-training-plan`.
5. **Aucune révocation pendant la livraison.** La première révocation est une décision HPM séparée, prise après la livraison complète.

## 0. Préalables (lecture seule)

| # | Action | Attendu |
|---|---|---|
| 0.1 | `git rev-parse origin/main` ; `git diff --name-only a0a8921 origin/main` | le merge de la PR2 ; uniquement les fichiers de la PR2 |
| 0.2 | `npx supabase functions list --project-ref uvolpldwwyvadlamulvr` | `daily-run` v48, `session-execution` v19, `generate-training-plan` v29, `verify_jwt = true` partout. **Noter les `ezbr_sha256`** (retour arrière, §6) |
| 0.3 | `npx supabase migration list --linked` | 77 / 77, dernière `20261021200000` |
| 0.4 | `npx supabase secrets list --project-ref uvolpldwwyvadlamulvr` (empreintes seulement) | `NALYNT_V2_PLAN_GENERATION_ENABLED` = sha256(`"false"`) ou absent ; autres interrupteurs V2 absents ; `NALYNT_WRITES_SUSPENDED` = sha256(`"false"`) |
| 0.5 | `docs/release/pr2-dh-revocation/PR2_PREFLIGHT_READONLY.sql` (SQL Editor) | `on`, 77, `20261021200000`, `true`, `false`, `true`, `true` |

Tout écart est un STOP.

## 1. Build de release (aucun service contacté)

1. Faire un checkout propre du commit de merge dans `C:\Users\Louis\nalynt-rc-<sha>`, puis `npm ci` (racine + 5 paquets).
2. Lancer `npm run build:release:all`, puis `npm run build:release:all -- --verify-only` : sortie 0 attendue.
3. `npm --prefix planning-engine run verify:sport-approvals` doit afficher : « 0 signed drill(s), common absent ».

## 2. Migration

| # | Action | Vérification / arrêt |
|---|---|---|
| 2.1 | `npx supabase db push --linked --dry-run` | exactement `20261027120000_v2_dh_drill_revocation.sql`. Autre chose : STOP |
| 2.2 | `npx supabase db push --linked` | succès. **Erreur** : la transaction est annulée ; vérifier 77 / 77 et la table absente (0.5) ; STOP |
| 2.3 | `docs/release/pr2-dh-revocation/PR2_POSTCHECK_READONLY.sql` | `on`, 78, `20261027120000`, 0, puis `true` partout (RLS sans policy, droits opérateurs seuls, triggers d'ajout seul, aide réservée à son propriétaire (`PUBLIC`, `anon`, `authenticated`, `service_role` sans `EXECUTE` ; appelée par `record_session_execution`, SECURITY DEFINER, même propriétaire), corps des 3 fonctions identiques au fichier, droits des RPC inchangés). Écart : STOP (§6) |

**État après 2** : nouvelle base avec les fonctions Edge v48 / v19. Supporté (S1). Aucune urgence pour l'étape 3.

## 3. Edge (à quelques minutes d'intervalle)

Règles : jamais `functions deploy` sans nom, jamais `--prune`, jamais `--no-verify-jwt`, jamais `--use-api` (bundling Docker local).

| # | Action | Vérification |
|---|---|---|
| 3.1 | `npx supabase functions deploy session-execution --project-ref uvolpldwwyvadlamulvr` | `functions list` : v20, nouvel `ezbr_sha256`, `verify_jwt = true`, aucune autre version changée |
| 3.2 | `npx supabase functions deploy daily-run --project-ref uvolpldwwyvadlamulvr` | v49, même contrôle |

Un échec de déploiement laisse la version précédente active : vérifier avec `functions list`, puis STOP. La fenêtre entre 3.1 et 3.2 est supportée, les deux fonctions étant indépendantes.

## 4. Smoke de production

Il faut un **accord distinct de Louis** : des écritures seront faites sur un compte de test dédié, jamais sur un rider réel.

1. **Lecture seule** : refaire 0.2, 0.3, 0.4 et 2.3.
2. **V1 authentifié, sur le compte de test** (même parcours que `v2DhRevocationV1Http.integration.test.ts`) :
   - `generate-training-plan` → V1 ;
   - `accept-training-plan` ;
   - check-in, puis `daily-run` du jour → décision V1, sans prescription du jour ;
   - `completed-session` → 200.
   - En base : aucune ligne V2 pour ce compte, et `dh_drill_revocations` toujours à 0.
3. **Purge du compte de test** (purge serveur existante) : comptage à zéro.
4. **Aucune révocation insérée comme test.**
   - La table est en ajout seul : une révocation est définitive et rend le rollback impossible.
   - Le comportement de la révocation est prouvé en local (§7).
5. **Compte interne de simulation (V2)** : aucune action.

## 5. Surveillance (48 h)

- `pilot_observability_events` : `daily_run_failed` et `session_completion_failed` à zéro (agrégat par type et par jour).
- Logs Edge `session-execution` et `daily-run` : aucune réponse 500 ; aucun `NX301` (isolation) dans les logs Postgres.
- `dh_drill_revocations` : 0 ligne, sauf décision HPM de révocation.

## 6. Correction en avant, retour arrière

**Principe.** On corrige d'abord en avant :
- une nouvelle migration additive qui redéfinit les fonctions ;
- ou un redéploiement Edge depuis un checkout connu.

Aucune ligne de données n'est à restaurer : ni la migration ni son rollback ne modifient une ligne existante (preuve S1, §7).

| # | Cas | Action |
|---|---|---|
| 6.1 | Problème Edge | Redéployer la version précédente depuis son checkout : `session-execution` depuis `C:\Users\Louis\nalynt-rc-<1e0de28>` (source de v19), `daily-run` depuis `C:\Users\Louis\nalynt-rc-1d7d219` (v48). Vérifier les `ezbr_sha256` notés en 0.2. Une ancienne fonction sur la nouvelle base est supportée (S1) |
| 6.2 | Problème base, aucune révocation enregistrée | **De préférence** : migration corrective additive. **Sinon** : rollback `supabase/rollbacks/v2_dh_revocation/20261027120000_rollback_v2_dh_drill_revocation.sql`, avec `psql` sur la connexion directe de production (une transaction explicite ; refusé si une révocation existe), puis `npx supabase migration repair --status reverted 20261027120000 --linked`. Effet : fonctions restaurées à l'identique, aide supprimée, table conservée (historique) et fermée aux nouvelles révocations |
| 6.3 | Problème base, révocation déjà enregistrée | Correction en avant seulement. Le rollback est refusé à dessein : il réautoriserait un exercice révoqué |

**Ordre.** Toutes les combinaisons de versions sont supportées. On peut donc revenir sur Edge d'abord, puis sur la base seulement si c'est nécessaire.

## 7. Preuves locales

Voir `docs/review/pr2-dh-revocation/PR2_DH_REVOCATION_PREP_REPORT.md` : campagnes, empreintes des données, tests de révocation, de concurrence, V1 et V2 OFF.
