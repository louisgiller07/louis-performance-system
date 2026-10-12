# P0-SAFE — runbook de livraison isolée (préparé, NON exécuté)

**Pour** : opérateur (Louis), après **GO HPM explicite**. Aucune étape n'a été exécutée en production.
**Contenu livré** : branche `fix/p0-safe-health-continuity` (depuis `origin/main` = `2c5b882`, code actuellement en production). Commit RC : **le HEAD validé par le HPM** (au moment de ce runbook : `82cf255` + ce document).
**Sans migration** (production : 66 migrations, inchangées). Rien d'A12 n'est embarqué (vérifié par `git diff --name-only origin/main..HEAD` et par l'inventaire des graphes Edge, §2).

## 0. Préalables (lecture seule)
| # | Action | Attendu |
|---|---|---|
| 0.1 | `npx supabase functions list --project-ref uvolpldwwyvadlamulvr` | `daily-run` v40 (`ezbr_sha256` `9b3b72e4…`, release `nalynt-rc-e36e749`), `health-flag-resolution` absente, `verify_jwt = true` partout. Noter versions et hashes |
| 0.2 | `npx supabase migration list --linked` | 66 / 66, dernière `20261007090000` ; rien en attente côté hotfix |
| 0.3 | Bundle web public (`app.nalynt.ch`) | empreinte `origin/main` (`2c5b882`) : « Tes courses » présent, « Coaching suspendu » absent |
| 0.4 | Inventaire agrégé des signaux ouverts (§6.1) | comparer à l'inventaire du 12.10 (blessure 6 dont 6 graves et 1 multi-zones, maladie 1, commotion 1) |
| 0.5 | Communication aux riders ayant un signal ouvert (décision HPM) | message prêt : le coaching sera suspendu jusqu'à la clôture ; une blessure grave demande une autorisation de reprise |

## 1. Build de release (aucun service contacté)
1. Checkout propre du commit RC dans `C:\Users\Louis\nalynt-rc-<sha>` (même convention que les releases précédentes) ; `npm ci` (racine + 5 paquets).
2. `npm run build:release:all` puis `npm run build:release:all -- --verify-only` : sortie 0.
3. Inventaire attendu par rapport à `2c5b882` : **seul `daily-run` change** (graphe `6c26c286…` au lieu de `9a85ff38…`) et **`health-flag-resolution` s'ajoute** (3 fichiers, graphe `147d5da9…`). Toutes les autres fonctions, et les bundles `dailyRunV2` / `generateTrainingPlan`, identiques à l'octet. Toute autre différence : STOP.

## 2. Déploiement (ordre HPM, à quelques minutes d'intervalle)
Jamais `functions deploy` sans nom, jamais `--prune`, jamais `--no-verify-jwt`, jamais `--use-api` (bundling Docker local).

| # | Action | Vérification |
|---|---|---|
| 2.1 | `npx supabase functions deploy health-flag-resolution --project-ref uvolpldwwyvadlamulvr` | `functions list` : nouvelle fonction ACTIVE v1, `verify_jwt = true`, aucune autre version changée. Smoke : POST sans JWT → 401 ; avec le JWT du compte de test, `{ "flagId": "<uuid inconnu>", "inspect": true }` → 404 `health_flag_not_found`. Inerte tant que le web ne l'appelle pas |
| 2.2 | Web : vérifier `git log --oneline origin/main..HEAD` (uniquement les commits P0-SAFE), puis push fast-forward sur `main` (Vercel `nalynt` déploie automatiquement) | bundle servi : contient « Coaching suspendu », « Clôturer ce signal », `health-flag-resolution` ; `/today`, `/history` en 200 |
| 2.3 | `npx supabase functions deploy daily-run --project-ref uvolpldwwyvadlamulvr` | `functions list` : `daily-run` v41, nouveau `ezbr_sha256`, `verify_jwt = true`, aucune autre version changée |

Fenêtre entre 2.2 et 2.3 : le bandeau annonce la suspension alors que l'ancien `daily-run` propose encore des séances. La garder la plus courte possible.

## 3. Smoke production (compte de test dédié, jamais un rider réel ; données créées puis purgées)
1. Check-in avec genou 2/10 non nouveau sur une DH : séance adaptée, « Douleur signalée ».
2. Même jour, 8/10 : « Coaching suspendu », « Signal actif », bandeau « Suspicion de blessure (genou droit) ». La clôture simple est possible, mais le signal se rouvre tant que le check-in du jour déclare 8/10.
3. Date suivante (paramètre `date` du Daily, compte de test), check-in normal : « Coaching suspendu » (A7), rappel du signal.
4. Clôture depuis l'app (déclaration) : la décision est relancée et une séance est proposée. En base, `resolution_note` contient « Aucune vérification médicale par NALYNT ».
5. Signal grave (douleur traumatique) : clôture refusée sans attestation (409 `professional_clearance_required`), acceptée avec.
6. Purge du compte de test (purge serveur existante) ; comptage à zéro.

## 4. Surveillance (48 h)
- `pilot_observability_events` : `daily_run_failed` et `session_completion_failed` à zéro (requête agrégée par type et par jour).
- Logs Edge `health-flag-resolution` : aucune erreur 500.
- Décisions agrégées par jour : nombre de journées A6 / A7, nombre de clôtures (`health_flags.status = resolved` avec `resolution_note` P0-SAFE), sans donnée individuelle.
- Retours des riders ayant un signal ouvert (canal de support).

## 5. Retour arrière (ordre inverse)
| # | Action | Effet |
|---|---|---|
| 5.1 | `daily-run` : depuis `C:\Users\Louis\nalynt-rc-e36e749`, `npx supabase functions deploy daily-run --project-ref uvolpldwwyvadlamulvr` | retour au comportement v40 ; vérifier `ezbr_sha256` = `9b3b72e4…` |
| 5.2 | Web : promotion du déploiement Vercel précédent (instantané), puis `git revert` des commits P0-SAFE sur `main` | ancien bandeau (commotion seule) |
| 5.3 | `health-flag-resolution` : la laisser (inerte sans le web) ou la supprimer sur GO HPM | — |

**Données** : aucune migration, aucun schéma à restaurer. Les clôtures enregistrées et les signaux créés par A6 restent valides ; l'ancien moteur ignore les signaux blessure et maladie ouverts (comportement d'avant).

## 6. Requêtes agrégées (lecture seule, sans donnée personnelle)
### 6.1 Signaux ouverts
`docs/review/P0_SAFE_FLAGS_INVENTORY.sql` : par type et statut, nombre de signaux, nombre d'athlètes, dates extrêmes, signaux sans décision, signaux graves (A2 / A4), signaux multi-zones.
