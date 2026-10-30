# BETA-V2-TECH-01 — plan de release (préparé, NON exécuté)

**Pour** : l'opérateur (Louis). Chaque étape marquée **GO** demande une autorisation distincte de Louis ; le GO technique HPM ne la remplace pas. Aucune étape n'a été exécutée en production.

**Contenu** : `beta/v2-tech-01` après BETA-INTEGRATION-01. La branche intègre `main` `40b1266` (PR2 fusionnée), S2, S3, S4 et le patch compagnon `docs/04`.
- **Base** : une migration additive, `20261027150000_beta_v2_tech_01_v1_exemption_trace.sql` (colonne `decided_by`, deux contraintes). Rollback : `supabase/rollbacks/beta_v2_tech_01/`.
- **Edge** :
  - `generate-training-plan` (B : l'affectation est l'autorisation de générer ; 403 sans affectation, 503 si illisible) ;
  - `daily-run` (T2 : unité DH signée toujours exigée).
- **Web** : messages 403 et 503 de génération. Ils sont livrés automatiquement par Vercel au merge de BETA, mais restent inertes tant que `generate-training-plan` n'est pas redéployée.
- **Contrats** : ADR `docs/review/beta-v2-tech-01/ADR_BETA_V2_TECH_01.md` (approuvée, CANON-GATE CLOSED) ; `docs/05`, `docs/04`.

V2 reste OFF. Aucun changement d'interrupteur, aucune signature sportive, aucune dose.

**Règle absolue** : **tout STOP interdit le déploiement Edge.** Un STOP ne se lève jamais par une simple comparaison manuelle.

## Ce qui change en production

- **Base** :
  - une colonne `decided_by` facultative ;
  - une contrainte de longueur ;
  - une contrainte de trace des exemptions `v1`. Elle est ajoutée `NOT VALID`, et validée par la migration seulement s'il n'existe aucune ligne `v1` (première application).
  - Aucune ligne n'est réécrite ; aucun auteur n'est inventé.
- **`generate-training-plan`** :
  - un compte **sans affectation** reçoit 403 `beta_access_not_granted`, jamais V1 par défaut ;
  - `v1` : V1, exemption tracée réservée aux comptes de test ;
  - `v2` avec l'interrupteur OFF : 503 (A09) ;
  - affectation illisible : 503 `beta_access_check_unavailable`.
  - Les programmes existants continuent au quotidien.
- **`daily-run`** : l'exigence d'unité DH signée ne dépend plus de l'interrupteur. En production, les tables de signatures sont vides : les jours DH de **tout** document V2 sont bloqués (200 `blocked`, motif `dh_repetition_unit_unknown`, décision M1 écrite). C'est aujourd'hui le compte interne de simulation V2. Aucune régénération ne débloque ces jours tant qu'aucune unité n'est signée.

## 0. Préalables (lecture seule)

| # | Action | Attendu, sinon STOP |
|---|---|---|
| 0.1 | `git rev-parse origin/main` | le merge de BETA ; `git diff --name-only 40b1266 origin/main` ne liste que les fichiers de BETA |
| 0.2 | **PR2 livrée** : `npx supabase migration list --linked` | 78 / 78, dernière `20261027120000` ; postcheck PR2 (`docs/release/pr2-dh-revocation/PR2_POSTCHECK_READONLY.sql`) conforme. **PR2 non livrée : STOP.** Livrer PR2 d'abord selon `docs/release/PR2_DH_REVOCATION_RELEASE_PLAN.md`. Combiner les deux livraisons demande une décision HPM distincte. |
| 0.3 | `npx supabase functions list --project-ref <ref>` | versions et `ezbr_sha256` de `generate-training-plan`, `daily-run`, `session-execution` notés (sources de retour arrière) ; `verify_jwt = true` |
| 0.4 | `npx supabase secrets list --project-ref <ref>` (empreintes seulement) | `NALYNT_V2_PLAN_GENERATION_ENABLED` = sha256(`"false"`) ou absent |
| 0.5 | **Version PostgreSQL cible** : `show server_version;` (SQL Editor, lecture seule) | **version majeure 17**, celle sur laquelle les définitions attendues du contrôle de release sont prouvées. Autre version : STOP ; adapter formellement le contrôle (commit, revue, nouvelle preuve sur pile jetable de cette version), puis reprendre. |

## 1. Build de release (aucun service contacté)

1. Faire un checkout propre du commit de merge de BETA dans `C:\Users\Louis\nalynt-rc-<sha>`, puis `npm ci` (racine et paquets).
2. Lancer `npm run build:release:all`, puis `npm run build:release:all -- --verify-only` : sortie 0.
3. `npm --prefix planning-engine run verify:sport-approvals` doit afficher : « 0 signed drill(s) ». Ce sont les tables de production, vides.

## 2. Inventaire des affectations (lecture seule) — GO

`docs/review/beta-v2-tech-01/V1_EXEMPTION_PREFLIGHT_READONLY.sql`.
- **Partie A** : compteurs seulement, partageables.
  - 2 : lignes `v1`. Toutes seront sans auteur juste après la migration.
  - 3 : sous-ensemble sans motif.
  - 4 : lignes `v2`.
  - 5 : athlètes **sans affectation**. Ils ne pourront plus générer après le déploiement de `generate-training-plan`.
- **Partie B** : identifiants. Opérateur seulement, jamais partagée ni consignée.

## 3. Décisions d'affectation — GO Louis, compte par compte

Avant toute écriture, une **vraie décision** pour chaque ligne :
- **compte de test qui garde V1** : `v1`, avec un motif réel (`note`, « compte de test : … ») et un auteur réel (`decided_by`) ;
- **vrai rider** : jamais exempté artificiellement en `v1`. La décision explicite est `v2`, ou la suppression de l'affectation (403 à la génération) ;
- **pilote de la bêta** : `v2`.

**Jamais d'auteur inventé.** Les décisions sont consignées sans identifiant de rider (compteurs par catégorie).

## 4. Migration — GO distinct

| # | Action | Vérification / arrêt |
|---|---|---|
| 4.1 | `npx supabase db push --linked --dry-run` | exactement `20261027150000_beta_v2_tech_01_v1_exemption_trace.sql`. Autre chose : STOP |
| 4.2 | `npx supabase db push --linked` (**`db push` obligatoire** : la migration est ainsi enregistrée dans `supabase_migrations.schema_migrations`, ce que le contrôle de release vérifie) | succès. Un NOTICE « left NOT VALID: N v1 assignment(s) » est attendu si des lignes `v1` existent. **Erreur** : la transaction est annulée ; vérifier 78 / 78 ; STOP |
| 4.3 | `docs/review/beta-v2-tech-01/V1_EXEMPTION_POSTCHECK_READONLY.sql` | colonne et contraintes présentes ; 4 = `true` seulement s'il n'y avait aucune ligne `v1` ; 6 = 0 ; 7 = `true` |

## 5. Régularisation et validation — GO distinct (écritures de production)

1. **Écrire les décisions de l'étape 3**, une par ligne.
   - Une mise à jour qui laisserait une ligne `v1` sans motif ou sans auteur est refusée (23514).
   - Les affectations `v2` et les suppressions se font de la même manière.
2. **Valider la contrainte** :
   `alter table public.training_plan_model_assignments validate constraint training_plan_model_assignments_v1_exemption_traced;`
   Un échec signifie qu'une ligne `v1` reste non tracée : STOP, retour à l'étape 3.
3. Relancer le postcheck (4.3) : 4 = `true`, 5 = 0.

## 6. Contrôle de release V1 — bloquant

`docs/review/beta-v2-tech-01/V1_EXEMPTION_RELEASE_GATE_READONLY.sql`, avec **psql et `ON_ERROR_STOP`**, sur la connexion directe du projet.

```
psql "<connexion directe, saisie par l'opérateur, jamais consignée>" -v ON_ERROR_STOP=1 \
  -c "set statement_timeout = '30s';" -f docs/review/beta-v2-tech-01/V1_EXEMPTION_RELEASE_GATE_READONLY.sql
```

- **GO** : sortie 0, et NOTICE `release_gate_go: v1_rows=… v1_untraced=0 … trace_constraint_validated=true …`.
- **STOP** : sortie non nulle, avec `release_gate_stop: <motifs>` et un DETAIL de compteurs. **Toute autre erreur vaut STOP.**
- **À conserver** : uniquement le verdict, les motifs et la ligne de compteurs. Jamais la chaîne de connexion, ni un identifiant de rider.
- **Un STOP interdit le déploiement Edge.** On ne le lève jamais par comparaison manuelle. Si une définition rendue diffère : enquêter, adapter formellement le contrôle (commit, revue), le retester sur pile jetable, puis obtenir son GO.

## 7. Edge — GO distinct, seulement après le GO de l'étape 6

| # | Action | Vérification |
|---|---|---|
| 7.1 | `npx supabase functions deploy generate-training-plan --project-ref <ref>` (depuis le checkout de l'étape 1) | `functions list` : nouvelle version, nouvel `ezbr_sha256`, `verify_jwt = true` |
| 7.2 | `npx supabase functions deploy daily-run --project-ref <ref>` | même contrôle |

`session-execution` n'est pas redéployée par BETA.

## 8. Smoke de production — GO distinct, comptes de test seulement

1. **Lecture seule** : refaire 0.3, 0.4 et 4.3.
2. **Compte de test tracé `v1`** : `generate-training-plan` → programme V1 (`rolloutReason: assigned_v1`). Puis `daily-run` du jour → décision V1.
3. **Compte de test sans affectation** : `generate-training-plan` → 403 `beta_access_not_granted`, rien d'écrit, événement `plan_generation_blocked`.
4. **Aucun rider réel**, aucune révocation, aucun changement d'interrupteur. Purge des comptes de test créés pour l'occasion.

## 9. Surveillance (48 h)

- `pilot_observability_events` :
  - `plan_generation_blocked` avec `beta_access_not_granted` : attendus seulement pour les comptes sans affectation décidés à l'étape 3 ;
  - `daily_run_failed` à zéro.
- Logs Edge `generate-training-plan` et `daily-run` : aucune réponse 500.
- `training_plan_model_assignments` : contrôle de release rejoué en fin de surveillance : GO.

## 10. Correction en avant, retour arrière

| # | Cas | Action |
|---|---|---|
| 10.1 | Problème Edge | Redéployer la version précédente depuis son checkout (versions et `ezbr_sha256` notés en 0.3) |
| 10.2 | Problème base | De préférence, une migration corrective additive. Sinon, le rollback `supabase/rollbacks/beta_v2_tech_01/20261027150000_rollback_v1_exemption_trace.sql` : il retire les deux contraintes et garde la colonne et ses valeurs, l'historique des décisions. Avec psql, GO distinct. |
| 10.3 | Affectations | Jamais de suppression d'un auteur ni d'un motif réels. Une décision se corrige par une nouvelle décision réelle, GO Louis. |

## 11. Preuves locales (BETA-INTEGRATION-01)

- `docs/11_DECISION_LOG.md`, entrée BETA-INTEGRATION-01 ;
- `docs/review/beta-v2-tech-01/ADR_BETA_V2_TECH_01.md` § 1.3, § 2.3, § 2.5 ;
- la CI GitHub `integration-v2-off` **doit être rejouée après le push autorisé**. L'exécution antérieure (sur `076721f`, BETA seule) ne compte pas pour cette branche intégrée.
