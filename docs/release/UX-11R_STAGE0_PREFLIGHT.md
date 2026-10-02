# UX-11R.3 — Stage 0 production preflight

> **Rien n'a été exécuté contre la production.** Ce document prépare le déploiement réel et s'arrête **avant le Stage 1**. Chaque commande ci-dessous est à lancer par un humain, au moment prévu, après l'approbation qui la couvre (§12). Aucune approbation n'en autorise implicitement une autre.
>
> Aucun secret ici. L'UUID du compte interne n'est écrit nulle part dans le dépôt : il est fourni par l'opérateur au moment de l'exécution (`<INTERNAL_ATHLETE_ID>`).

## 1. Cible

| Élément | Valeur | Source |
|---|---|---|
| Projet Supabase | `uvolpldwwyvadlamulvr`, nom « LOUIS PERFORMANCE SYSTEM » | `supabase/.temp/project-ref` et `linked-project.json` (lien CLI local, non versionné) ; toutes les mises en production documentées (dernière : PILOT_013, 2026-09-24) |
| Projet à ne **jamais** viser | `evynmzyjhobdpmxdiwsy` (inactif, non lié) | `docs/11_DECISION_LOG.md` |
| Web | Vercel, projet `louis-performance-system`, scope `nalynt`, alias `https://louis-performance-system.vercel.app` | `web/.vercel/project.json` (non versionné), `docs/06_ARCHITECTURE.md` |
| CLI Supabase | `2.114.0` (racine, `npx supabase`) | `package.json` racine |

- Le lien CLI local pointe sur la production. `db push` et `functions deploy` sans option visent donc le projet lié.
- Règle de ce runbook : **toujours** passer `--project-ref uvolpldwwyvadlamulvr` explicitement, jamais une commande sans cible.
- Aucune variable `SUPABASE_*` dans l'environnement du shell local (vérifié) ; `web/.env.local` vise la pile locale.
- Le web n'est **pas** relié à Git : un push ne déploie rien. Seul `npx vercel deploy --prod --scope nalynt` depuis `web/` déploie.

## 2. Source de la release

- Commit de release : la tête de la pile UX-11 approuvée (actuellement `feat/ux11r3-production-preflight`). `main` = `origin/main` = `ba59239` (production), 55 commits non poussés au-dessus.
- **Décision humaine requise avant l'Approbation A** : fusionner et pousser cette pile sur `main` avant le Stage 1, pour que `origin/main` reste égal au code en production (pratique suivie jusqu'ici), ou déployer depuis la branche. Recommandé : fusion + push d'abord, puis déploiement depuis un checkout propre de ce commit.
- Rien de local n'est versionné par erreur : `.env.local` et `web/.env.local` sont ignorés, `supabase/.temp` aussi, `web/.vercel` aussi, `ROLL_OUT_CHECKLIST.md` est exclu localement, aucun `dist/` n'est suivi. Ajouts toujours fichier par fichier, jamais `git add .`.

## 3. Build de release (checkout propre, hors ligne)

```bash
git clone <repo> nalynt-release && cd nalynt-release && git checkout --detach <RELEASE_SHA>
npm ci                                   # racine (CLI Supabase épinglée)
for p in planning-engine prescription-engine longitudinal-engine head-coach-engine web; do (cd $p && npm ci); done
npm run build:release:all                # build complet + vérification du graphe Edge + inventaire sha256
npm run build:release:all -- --verify-only   # juste avant chaque déploiement : revérifie sans reconstruire
```

- `npm ci` est la seule étape réseau (registre npm). `build:release:all` ne contacte aucun service et ne déploie rien.
- Il échoue si un `node_modules` manque, si une étape de build échoue, ou si un import d'une Edge Function ne résout pas vers un fichier construit.
- Ne **jamais** déployer depuis le dépôt de développement : son `head-coach-engine/dist` contient des fichiers obsolètes sans source (ex. `dist/config/athleteCoachingProfile.js`), absents d'un checkout propre.
- Prouvé en local (UX-11R.3), depuis un worktree propre :
  - sans `node_modules` → échec explicite ;
  - sans `dist` en `--verify-only` → échec explicite (27 imports manquants) ;
  - build complet → sortie 0, bundles identiques octet pour octet au build de développement, hashes de graphe identiques.
- Web : Vercel reconstruit lui-même à partir de `web/` seul. Le build isolé (copie de `web/` sans dépôt autour) passe en local. Aucune nouvelle variable `VITE_*` depuis `ba59239`.

## 4. Inventaire Edge

Hash du graphe = sha256 de l'ensemble des fichiers importés, fins de ligne normalisées ; identique quel que soit le checkout pour un même commit. Valeurs au commit `8fb5dde` (à revérifier au commit de release avec `--verify-only`).

| Fonction | Rollout | Entrée | Artefact | Dépendances internes | Hash graphe (16 premiers) |
|---|---|---|---|---|---|
| `generate-training-plan` | **Déployer** | `supabase/functions/generate-training-plan/index.ts` | `head-coach-engine/dist/edge/generateTrainingPlan.bundle.js` (sha256 `02f0bca33721021d…`, contient V1 + V2 + flag) | `dist/supabase/observability/pilotEvents.js`, `errorMapping.ts`, `@supabase/server@1.4.1` | `ce9734fd8caece4b` |
| `daily-run` | **Déployer** | `supabase/functions/daily-run/index.ts` | 73 fichiers `head-coach-engine/dist/supabase/**` + `dist/edge/dailyRunV2.bundle.js` (sha256 `951ca9bdde1e7010…`, import paresseux) | M1 figé, `runDailyFor`, `persistDailyRun`, `dailyV2/*` | `661e556a070ae640` |
| `session-execution` | **Déployer (nouvelle)** | `supabase/functions/session-execution/index.ts` | aucun bundle | `validation.ts`, `@supabase/server` ; RPC `record_session_execution` (migrations 2, 4, 5, 6, 7) | `84e464d55239e148` |
| `accept-training-plan` | Ne pas toucher | | | sources de la fonction et du chemin d'acceptation inchangés depuis `ba59239` ; seuls des ajouts inutilisés dans deux repos partagés | `8598a419e9b082bc` |
| `abandon-training-plan` | Ne pas toucher | | | inchangé | `932d95a2c3e0c195` |
| `completed-session` | Ne pas toucher | | | inchangé (seul `pilotEvents` a gagné des champs optionnels) | `f79841d1b2aa401a` |
| `get-insights`, `refresh-longitudinal`, `submit-review` | Ne pas toucher | | `longitudinal-engine/dist` | inchangés depuis `ba59239` | `8259c1b0…`, `5bd6746a…`, `8519406f…` |

- eszip local (image `edge-runtime:v1.74.3`, rien envoyé) depuis le checkout propre : `generate-training-plan`, `daily-run`, `session-execution` → code 0.
- **Interdit** : `supabase functions deploy` sans nom (déploierait les 9 fonctions) et `--prune` (supprimerait des fonctions distantes).
- Le déploiement précédent utilisait `--use-api` (bundling côté Supabase, graphe transitif hors de `supabase/functions` prouvé en M3_005). L'inclusion de l'import paresseux du bundle V2 par ce bundling distant n'est pas prouvée : elle se vérifie au Stage 3, avant toute séance (§9).

## 5. Migrations

Distant attendu : 50 migrations, la dernière `20260924110000`. À appliquer, dans cet ordre, rien d'autre :

1. `20260930120000_ux11b2_execution_schema`
2. `20260930120500_ux11b2_record_session_execution`
3. `20260930130000_ux11a5a2b_dh_technical_tier`
4. `20261001090000_ux11b23_pass_measure_contract`
5. `20261001120000_ux11a5c2_v2_daily_persistence`
6. `20261001140000_ux11b25_session_activity_results`
7. `20261002090000_ux11b26_execution_result_integrity`
8. `20261002120000_ux11r1_athlete_account_purge`
9. `20261003090000_ux11r2_training_plan_model_assignments`

`git diff --name-status ba59239..HEAD -- supabase/migrations` : 9 ajouts (`A`), 0 modification, 0 suppression. Aucun seed : `supabase/seed.sql` n'existe pas. Aucune migration n'insère d'assignation ni d'athlète.

**Ce que le CLI vérifie, et ce qu'il ne vérifie pas.**

| Besoin | Commande | Portée réelle |
|---|---|---|
| Historique distant, pending | `migration list` | Compare les **versions** des fichiers locaux à `supabase_migrations.schema_migrations`. Ne compare pas le contenu. |
| Ce que `db push` appliquerait | `db push --dry-run` | Liste les fichiers en attente. **N'exécute pas le SQL**, ne valide ni la syntaxe ni les gardes de données. Ce n'est pas un vrai essai à blanc. |
| Dérive du schéma | `db dump --schema public` distant, comparé au schéma `ba59239` local | Seule preuve de contenu disponible ; comparaison manuelle après normalisation. Le CLI n'a pas de détection de dérive fiable. |
| Succès des migrations | — | Prouvé seulement par les répétitions locales (base vierge, base type production : UX-11R.1 et R.2). |

## 6. Sauvegarde et restauration

| Contrôle | Statut |
|---|---|
| Sauvegardes quotidiennes Supabase présentes | **TO VERIFY AT APPROVAL GATE** (Dashboard → Database → Backups, ou `backups list`) |
| Point-in-time recovery | **TO VERIFY AT APPROVAL GATE** (option payante liée au plan) |
| Qui peut restaurer | **TO VERIFY AT APPROVAL GATE** : un rôle Owner / Administrator de l'organisation Supabase (Louis, à confirmer) |
| Dump logique récent | Dernier connu : 2026-09-28, hors dépôt, avec `SHA256SUMS` et `RESTORE.md`. **Périmé** : un nouveau dump est exigé au Stage 0. |

**Restauration possible :**
- restauration Supabase (sauvegarde quotidienne ou PITR) : le projet entier revient à un instant donné, avec indisponibilité ;
- ou restauration logique du dump (rôles, schéma, données) dans un projet neuf, selon `RESTORE.md`.

**Pas de migration descendante.** En cas d'échec partiel, on corrige en avant. La restauration reste le dernier recours, après décision humaine.

## 7. Stage 0 — commandes (NON exécutées)

### READ-ONLY CHECKS

| # | Objectif | Commande | Cible | Attendu / risque |
|---|---|---|---|---|
| 0.1 | Commit et arbre propres | `git rev-parse HEAD` · `git status --porcelain` | local | `<RELEASE_SHA>` ; sortie vide |
| 0.2 | Cible liée | `cat supabase/.temp/project-ref` | local | `uvolpldwwyvadlamulvr` |
| 0.3 | Version CLI | `npx supabase --version` | local | `2.114.0` |
| 0.4 | Projet existant et sain | `npx supabase projects list` | API Supabase, lecture | ligne `uvolpldwwyvadlamulvr`, nom attendu ; aucun risque |
| 0.5 | Historique des migrations | `npx supabase migration list --project-ref uvolpldwwyvadlamulvr` | DB prod, lecture | 59 locales, 50 distantes jusqu'à `20260924110000`, **exactement** les 9 du §5 sans contrepartie distante, aucune version distante absente du dépôt. Sinon : STOP. |
| 0.6 | Dérive de schéma | `npx supabase db dump --project-ref uvolpldwwyvadlamulvr --schema public -f <HORS_DEPOT>/prod_public_<date>.sql`, puis comparaison avec `db dump --local --schema public` d'une pile locale jetable construite depuis les 50 migrations de `ba59239` | DB prod, lecture (pg_dump) ; fichier local hors dépôt | Diff vide après normalisation (ordre, propriétaires). Toute différence de table, colonne, policy, grant ou fonction : STOP et analyse. |
| 0.7 | Gardes de données des migrations | SQL en lecture seule (éditeur SQL ou psql) : `select decision_id, count(*) from public.decision_final_prescriptions group by 1 having count(*) > 1;` · `select to_regclass('public.session_executions'), to_regclass('public.training_plan_model_assignments');` | DB prod, lecture | 0 ligne ; `null, null` |
| 0.8 | Sauvegardes | Dashboard → Database → Backups · `npx supabase backups list --project-ref uvolpldwwyvadlamulvr` | API, lecture | sauvegarde récente présente ; PITR noté (oui / non) |
| 0.9 | Fonctions déployées | `npx supabase functions list --project-ref uvolpldwwyvadlamulvr` | API, lecture | versions notées pour `daily-run`, `generate-training-plan`, `accept-training-plan`, `completed-session` ; `session-execution` absente ; `verify_jwt = true` |
| 0.10 | Flag global | `npx supabase secrets list --project-ref uvolpldwwyvadlamulvr` | API, lecture (noms et empreintes seulement) | `NALYNT_V2_PLAN_GENERATION_ENABLED` **absent** |
| 0.11 | Web en production | `npx vercel ls louis-performance-system --scope nalynt` puis `npx vercel inspect https://louis-performance-system.vercel.app --scope nalynt` | Vercel, lecture | identifiant du déploiement courant noté (retour web possible tant qu'aucun plan V2 n'existe) |
| 0.12 | Référence de comptage V1 | SQL lecture : `select 'training_plan_versions', count(*) from public.training_plan_versions union all select 'decisions', count(*) from public.decisions union all select 'completed_sessions', count(*) from public.completed_sessions union all select 'athletes', count(*) from public.athletes;` | DB prod, lecture | valeurs notées ; comparées après le Stage 1 |

### MUTATING COMMANDS

Aucune commande du Stage 0 ne modifie la production.
- La sauvegarde logique écrit uniquement des fichiers locaux, hors dépôt (`db dump --role-only`, `--schema public,…`, `--data-only --use-copy` ; puis `SHA256SUMS` et `RESTORE.md`). Elle lit la production.
- Le smoke V1 de référence sur le compte de test écrit des données de ce compte seulement : il n'a lieu qu'au Stage 1 (§8), sous l'Approbation A.

## 8. Stage 1 — migrations (APPROVAL A ; commandes préparées, NON exécutées)

**Gates, tous vrais avant la commande de mutation :**
- cible confirmée (0.2, 0.4) ;
- sauvegarde ou PITR confirmé (0.8) **et** dump logique frais, avec sommes de contrôle ;
- `migration list` exactement 50 / 9 pending (0.5), aucune dérive (0.6), gardes OK (0.7) ;
- commit en production confirmé `ba59239` (0.9, 0.11) et commit de release confirmé (0.1) ;
- flag global absent (0.10).

| # | Commande | Type | Note |
|---|---|---|---|
| 1.1 | `npx supabase db push --project-ref uvolpldwwyvadlamulvr --dry-run --skip-vault` | lecture | doit lister exactement les 9 fichiers du §5 |
| 1.2 | `npx supabase db push --project-ref uvolpldwwyvadlamulvr --skip-vault` | **MUTATION** | jamais `--include-all`, `--include-seed`, `--include-roles`, `--yes` ; mot de passe DB saisi au prompt, jamais dans la ligne de commande ; relire la liste avant de confirmer. `--skip-vault` : aucun secret Vault n'est configuré, rien ne doit être écrit. |
| 1.3 | `npx supabase migration list --project-ref uvolpldwwyvadlamulvr` | lecture | 59 / 59, 0 pending |
| 1.4 | SQL lecture : `select count(*) from public.training_plan_model_assignments;` · `select relrowsecurity from pg_class where oid = 'public.training_plan_model_assignments'::regclass;` · `select grantee, string_agg(privilege_type, ',') from information_schema.role_table_grants where table_name = 'training_plan_model_assignments' group by 1;` · `select to_regprocedure('public.purge_athlete_account(uuid)');` | lecture | `0` ; `true` ; `service_role` seul (SELECT, INSERT, UPDATE, DELETE) ; non null |
| 1.5 | Comptages du 0.12 | lecture | identiques |
| 1.6 | Smoke V1, compte de test, avec l'ancien code Edge et web encore en place | écrit sur le compte de test | génération, acceptation, Daily, completed-session : OK, comme avant |

**Échec d'une migration k.**
- STOP ; ne pas relancer à l'aveugle.
- Les migrations 1 à k−1 restent appliquées. Elles sont additives et compatibles avec l'ancien code (répétition « ancien code / nouveau schéma »).
- Analyser, corriger en avant par une nouvelle migration revue. Restauration seulement sur décision humaine (§6).

## 9. Stage 2 — code, V2 désactivé (APPROVAL B ; NON exécuté)

**Gates :**
- Stage 1 vert ;
- `secrets list` sans `NALYNT_V2_PLAN_GENERATION_ENABLED` ;
- table d'assignation vide ;
- checkout propre au commit de release ;
- `build:release:all -- --verify-only` vert, avec les mêmes hashes que l'inventaire enregistré.

Depuis la racine du checkout de release, dans cet ordre, **une fonction nommée à la fois** :

| # | Commande | Pourquoi cet ordre |
|---|---|---|
| 2.1 | `npx supabase functions deploy session-execution --project-ref uvolpldwwyvadlamulvr --use-api` | nouvelle, inerte : aucune prescription V2 ne peut exister |
| 2.2 | `npx supabase functions deploy daily-run --project-ref uvolpldwwyvadlamulvr --use-api` | chemin V1 identique ; lecteurs V2 présents mais inactifs |
| 2.3 | `npx supabase functions deploy generate-training-plan --project-ref uvolpldwwyvadlamulvr --use-api` | flag absent → V1 |
| 2.4 | `npx supabase functions list --project-ref uvolpldwwyvadlamulvr` | versions +1 pour les 3 seulement, `verify_jwt = true`, les autres versions inchangées |
| 2.5 | `cd web && npx vercel deploy --prod --scope nalynt` | en dernier : web RC compatible V1, fail-closed pour V2 |

Jamais `--no-verify-jwt`, jamais `--prune`, jamais `functions deploy` sans nom.

**Smokes V1** (compte de test) :
- appel sans JWT à chaque fonction → 401 ;
- génération → 200, puis `plan_generation_succeeded` avec `planningModel = v1` et `rolloutReason = global_v2_disabled` ;
- acceptation → 200 ;
- Daily → 200, sans champ V2, `decisions.final_prescription_status` NULL ;
- completed-session → 200 ;
- web : routes principales 200 ; aucune entrée « séance guidée ».

**Retour arrière du Stage 2** (permis **seulement** si `select count(*) from public.training_plan_versions where prescription_schema_version = 'v2'` vaut 0) :
- redéployer `daily-run` et `generate-training-plan` depuis un checkout propre de `ba59239` ;
- promouvoir le déploiement web noté au 0.11 ;
- `session-execution` peut rester (inerte).

## 10. Stage 3 — compte interne (APPROVALS C puis D ; NON exécuté)

**Règle.** V2 est limité au seul compte interne / de test explicitement approuvé. Aucun pilote externe tant que le sign-off coaching (`COACHING_CONTENT_SIGNOFF.md`, 275 entrées `pending`) n'est pas validé.

**Ordre retenu : assignation d'abord, flag ensuite.**
- Interrupteur absent, une assignation est inerte (prouvé : OFF → V1 même assigné). On peut donc vérifier la ligne et observer une génération V1 avec `global_v2_disabled` avant toute exposition.
- Ensuite, activer l'interrupteur n'expose que les athlètes déjà assignés.
- L'ordre inverse est sûr lui aussi (table vide → V1 pour tous), mais l'activation réelle coïnciderait alors avec l'écriture SQL, sans contrôle préalable.

| # | Étape | Type | Approbation | Contrôle |
|---|---|---|---|---|
| 3.1 | Code et schéma déployés, smoke V1 vert | — | A, B déjà | §8, §9 |
| 3.2 | Profil V2 du compte prêt : `select dh_technical_tier, technical_priorities, terrain_access, equipment from public.athlete_performance_profiles where athlete_id = '<INTERNAL_ATHLETE_ID>';` | lecture | — | palier DH, 1 à 3 priorités DH, terrains, équipement renseignés ; sinon la génération V2 répondra 422 |
| 3.3 | `insert into public.training_plan_model_assignments (athlete_id, planning_model, note) values ('<INTERNAL_ATHLETE_ID>', 'v2', '<opérateur> — Stage 3 interne');` | **MUTATION** | **C** | `select athlete_id, planning_model from public.training_plan_model_assignments;` → 1 ligne exactement, le bon compte |
| 3.4 | (Facultatif) génération depuis l'app, interrupteur absent | écrit, compte de test | C | événement `planningModel = v1`, `rolloutReason = global_v2_disabled` |
| 3.5 | `npx supabase secrets set NALYNT_V2_PLAN_GENERATION_ENABLED=true --project-ref uvolpldwwyvadlamulvr` | **MUTATION** | **D** | `secrets list` montre le nom |
| 3.6 | **Nouvelle** génération depuis l'app (même endpoint, même corps) | écrit, compte de test | D | `plan_generation_succeeded`, `planningModel = v2`, `rolloutReason = assigned_v2` (Q1, §11). Si `v1` : la prise en compte du secret n'est pas faite, STOP et vérifier ; ne pas redéployer à l'aveugle. |
| 3.7 | Relire puis accepter le plan V2 | écrit | D | `training_plan_current_version` → version `v2` |
| 3.8 | Daily (jours suivants) | écrit | D | `daily_run_succeeded.metadata.finalPrescriptionStatus` ∈ `created` / `not_required` / `blocked` attendu (Q2) ; **preuve que le bundle V2 est chargé par le bundling distant** |
| 3.9 | Séance guidée : démarrer, saisir, terminer | écrit | D | `execution_events` started → completed (Q3) ; log `session-execution` `outcome: recorded` |
| 3.10 | Daily suivant | écrit | D | la séance complétée compte dans la charge récente (retour M1) |

## 11. Observabilité pendant le Stage 3

Aucune alerte automatique : contrôles manuels, au minimum après chaque étape du §10. Requêtes en lecture seule ; `pilot_observability_events` n'est lisible que par un rôle SQL admin.

```sql
-- Q1 Génération : modèle, raison, issue
select created_at, event_type, metadata->>'planningModel' as model, metadata->>'rolloutReason' as reason,
       metadata->>'blockedReason' as blocked, metadata->>'errorCode' as error
from public.pilot_observability_events
where event_type like 'plan_generation_%' and created_at > now() - interval '1 day'
order by created_at desc;

-- Q2 Daily : statut de la prescription du jour
select created_at, event_type, metadata->>'finalPrescriptionStatus' as status, metadata->>'finalPrescriptionStatusCode' as code
from public.pilot_observability_events
where event_type like 'daily_run_%' and created_at > now() - interval '1 day'
order by created_at desc;
select decision_date, final_prescription_status, final_prescription_status_code
from public.decisions where athlete_id = '<INTERNAL_ATHLETE_ID>' order by created_at desc limit 10;

-- Q3 Exécution : cycle de vie (started, paused, resumed, completed, abandoned)
select e.session_date, ev.event_type, ev.occurred_at, ev.recorded_at
from public.session_executions e join public.execution_events ev on ev.execution_id = e.id
where e.athlete_id = '<INTERNAL_ATHLETE_ID>' order by ev.event_seq;

-- Q4 Plans V2 en production (aussi le garde-fou du « pas d'ancien runtime »)
select athlete_id, count(*) from public.training_plan_versions where prescription_schema_version = 'v2' group by 1;

-- Q5 Assignations
select athlete_id, planning_model, updated_at from public.training_plan_model_assignments;
```

Logs Edge (Dashboard → Edge Functions → Logs) :
- `session-execution` écrit une ligne JSON par lot : `outcome: recorded` (événements par type, séries, activités, rejeux) ou `outcome: rejected` (code, statut HTTP) ;
- `generate-training-plan` : `V2 generation blocked -> <code>` et `generation failed [...]` ;
- `daily-run` : `runDailyFor failed [...]`.

Les refus de `session-execution` ne sont **que** dans ces logs, pas en base.

## 12. Conditions d'arrêt du Stage 3

Un seul compte interne : pas de seuil statistique. **Un seul** des cas suivants suffit pour passer au kill switch (§13) puis analyser :

1. une génération V2 en 500 (`plan_generation_failed`, modèle `v2`) ;
2. une génération V2 bloquée alors que le profil est complet (3.2 vérifié) ;
3. une Daily `blocked` (ou `final_prescription_no_lineage`) sur un jour où le plan V2 prévoit une séance et la décision est KEEP ;
4. toute erreur DB contractuelle : `unsupported_plan_prescription_schema`, `internal_error` d'une RPC, violation de contrainte, garde append-only déclenchée hors purge ;
5. toute réponse 5xx de `session-execution`, ou un refus hors des codes attendus pour l'action réalisée ;
6. tout écart schéma / catalogue : version de catalogue ou de manifeste inattendue, document V2 non lisible par le web (rendu fermé « version non prise en charge ») ;
7. 5xx répétés sur n'importe quelle fonction Edge (deux fois de suite sur la même action) ;
8. **tout comportement V1 modifié** pour un autre athlète : génération autre que `v1`, Daily avec champs V2, erreur nouvelle ;
9. une assignation présente pour un autre compte que le compte interne.

## 13. Kill switch et retour au V1

**Global.**
- `npx supabase secrets set NALYNT_V2_PLAN_GENERATION_ENABLED=false --project-ref uvolpldwwyvadlamulvr`. Préférer `false` à `unset`, pour que la valeur reste visible dans `secrets list` ; absent vaut OFF aussi.
- Vérification : prochaine génération `planningModel = v1`, `rolloutReason = global_v2_disabled`.

**Individuel.**
- `update public.training_plan_model_assignments set planning_model = 'v1' where athlete_id = '<INTERNAL_ATHLETE_ID>';` (ou `delete`).
- Vérification : prochaine génération `v1` / `assigned_v1` (ou `default_v1`).

**Ce qui continue après le kill switch** (prouvé en local, HTTP 26/26) :
- le plan V2 courant reste courant ;
- Daily continue en V2 ;
- les séances guidées et les exécutions existantes restent lisibles et complétables ;
- seule la génération est coupée.

**Retour complet au V1 du compte interne :**
1. kill switch global ou individuel ;
2. nouvelle génération depuis l'app → plan V1 ;
3. relire puis accepter le plan V1 → il devient courant ;
4. Daily suivant → chemin V1, sans champ V2.

Les exécutions V2 passées restent en historique (append-only). **Jamais d'ancien code.**

## 14. Pas d'ancien runtime

> **DÈS QU'UN PREMIER PLAN V2 EST PERSISTÉ EN PRODUCTION (Q4 > 0), NE PLUS JAMAIS REDÉPLOYER `ba59239` NI UN CODE ANTÉRIEUR À CETTE RELEASE.**
>
> - `daily-run@ba59239` sert le document V2 comme prescription « V1 » (répétition UX-11R.1) : incompatible.
> - Web `ba59239` (et tout déploiement web antérieur à la release) : pas de garde de lecture V2 → incompatible.
> - `generate-training-plan@ba59239` : génère du V1 sans flag ni trace du modèle ; non incompatible avec les données, mais interdit (versions mélangées non testées).
> - Supprimer `session-execution` couperait des séances en cours : interdit.
>
> **Retour arrière = code de la release + kill switch OFF** (§13).

## 15. Approbations

Chaque approbation est donnée explicitement, par écrit, après lecture des preuves de l'étape précédente. **Aucune n'autorise la suivante.**

| Approbation | Autorise uniquement | N'autorise pas | Preuves exigées |
|---|---|---|---|
| **A — Stage 1 DB** | 1.2 (`db push` des 9 migrations), puis 1.3 à 1.6 | tout déploiement Edge ou web, tout secret, toute assignation | 0.1 à 0.12 verts, sauvegarde ou PITR confirmé, dump frais avec sommes de contrôle, décision sur la source de release (§2) |
| **B — Stage 2 code** | 2.1 à 2.5 (3 fonctions nommées + web), smokes V1 | toute assignation, tout secret V2 | Stage 1 vert, `--verify-only` vert avec les hashes enregistrés, flag absent |
| **C — Stage 3 assignation** | 3.2 à 3.4 : une ligne d'assignation, pour le seul compte interne nommé dans l'approbation | l'interrupteur global | Stage 2 vert, smokes V1 verts, compte interne identifié hors dépôt |
| **D — Stage 3 V2 ON** | 3.5 à 3.10 (interrupteur global à `true`) | toute assignation supplémentaire, tout pilote externe, le Stage 5 | assignation unique vérifiée (Q5), conditions d'arrêt (§12) et kill switch (§13) relus |

## 16. Points ouverts avant l'Approbation A

1. Sauvegarde / PITR et rôle de restauration : **TO VERIFY AT APPROVAL GATE** ; dump logique frais requis (celui du 2026-09-28 est périmé).
2. Historique des migrations distantes et absence de dérive : à constater en lecture seule (0.5, 0.6).
3. Source de la release : fusion + push de la pile sur `main` avant le Stage 1 (recommandé), ou déploiement depuis la branche. Décision humaine ; aucun push n'a eu lieu.
4. Non bloquants pour A : sign-off coaching (gate du Stage 5, pas du Stage 3 interne) ; GRANT DELETE sur `athletes` (classé OBSOLETE / SHOULD REVOKE, §17) ; parcours produit de suppression de compte (§18).

## 17. Audit du DELETE client sur `athletes`

Constaté en local, identique sur le schéma `ba59239` (50 migrations) et sur le schéma de la release (59). Test versionné : `head-coach-engine/tests/supabase/athletesDeleteGrant.integration.test.ts` (7/7 sur la release, 5/5 + 2 sans objet sur `ba59239`).

- **GRANT** : `anon` et `authenticated` ont DELETE (et tous les autres privilèges) sur `athletes`, hérités du `GRANT ALL` de la baseline V0.2 (dump Supabase générique), pas d'une décision produit.
- **RLS** : seule policy `athletes_own_data`, `ALL`, `user_id = auth.uid()`.
- **A — rider, sa propre ligne, sans plan** : suppression **acceptée**. La cascade (exécutée comme propriétaire de table, donc hors RLS et hors grants des tables enfants) efface check-ins, décisions, health flags et completed sessions, alors que le rider ne peut pas supprimer une décision directement (42501). L'identité Auth et les événements pilotes restent orphelins. Au prochain chargement, le web recrée une ligne `athletes` vide.
- **A — avec plan** (cas de tout pilote actif) : refusée, 23503 (`training_plan_versions` RESTRICT), rien supprimé. Après les migrations UX, une assignation de modèle ou une exécution bloque aussi (RESTRICT).
- **B — autre athlète** : 0 ligne, aucune erreur, rien supprimé.
- **C — anon** : 0 ligne, même avec un filtre universel.
- **D — purge serveur** : tout supprimé (plan, assignation, événements pilotes, identité Auth), témoin intact.
- **Interaction avec les migrations UX** : aucune aggravation ; elles ajoutent des RESTRICT (`session_executions`, `training_plan_model_assignments`, `decision_final_prescriptions → decisions`).
- **Usage produit** : aucun. Tout le code et tous les tests suppriment via le service role. La notice de confidentialité promet la suppression sur demande écrite, exécutée par l'opérateur. Le contrat documenté (ADR UX-11B.2.1, `05_DATA_MODEL.md`) fait de la purge serveur l'unique chemin.

**Classement : OBSOLETE / SHOULD REVOKE.**
- Pas un BLOCKER du Stage 1 : comportement déjà présent en production, limité aux propres données du rider, et sans effet sur un athlète qui a un plan. Les migrations UX ne l'élargissent pas.
- Proposition, **non implémentée**, à approuver séparément comme migration additive UX-11R.3 :

```sql
revoke delete on public.athletes from anon, authenticated;
```

- `INSERT`, `SELECT` et `UPDATE` restent nécessaires : l'amorçage web insère la ligne, le profil la lit et la met à jour.
- `TRUNCATE`, `REFERENCES` et `TRIGGER` (défauts Supabase) ne sont pas exposés par PostgREST ; leur nettoyage serait un ticket distinct.
- Effet attendu : A → 42501 ; B, C, D inchangés ; aucun code ni test client à modifier.

## 18. Suppression de compte côté produit

- Backend : **prêt** (purge tout-ou-rien, `purgeAthleteAccount` puis suppression Auth ; testé sur base vierge, type production, et dans cet audit).
- Parcours produit : **absent**. Pas d'écran, pas d'Edge dédiée.
- Promesse actuelle : suppression sur demande écrite à l'adresse de contact. Elle est tenue par l'opérateur.
- **Stage 3 interne** : non bloquant (compte de test, opérateur interne).
- **Stage 5** : bloquant tant qu'une procédure opérateur de purge en production n'est pas écrite et répétée. Elle s'exécute en local avec la clé service, jamais dans le dépôt. Un écran en self-service n'est requis que si le produit le promet ; la notice actuelle ne le promet pas.
