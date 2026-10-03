# UX-11R.3 — Stage 0 production preflight (mis à jour UX-11R.3.1, UX-11R.3.2)

> **Rien n'a été exécuté contre la production.** Ce document prépare le déploiement réel et s'arrête **avant le Stage 1**. Chaque commande ci-dessous est à lancer par un humain, au moment prévu, après l'approbation qui la couvre (§15). La première étape distante est le gate en lecture seule du §21, qui demande sa propre autorisation. Aucune approbation n'en autorise implicitement une autre.
>
> Aucun secret ici. L'UUID du compte interne n'est écrit nulle part dans le dépôt : il est fourni par l'opérateur au moment de l'exécution (`<INTERNAL_ATHLETE_ID>`).

## 1. Cible

| Élément | Valeur | Source |
|---|---|---|
| Projet Supabase | `uvolpldwwyvadlamulvr`, nom « LOUIS PERFORMANCE SYSTEM » | `supabase/.temp/project-ref` et `linked-project.json` (lien CLI local, non versionné) ; toutes les mises en production documentées (dernière : PILOT_013, 2026-09-24) |
| Projet à ne **jamais** viser | `evynmzyjhobdpmxdiwsy` (inactif, non lié) | `docs/11_DECISION_LOG.md` |
| Web | Vercel, projet `nalynt` (id `prj_PmxPGlFwH5beHjzMFcwV1pOAf9CS`, racine `web`), alias `https://louis-performance-system.vercel.app` ; marketing : projet `nalynt-marketing` (racine `marketing-site`) | Gate R7 (2026-10-02, lecture API Vercel) |
| CLI Supabase | `2.114.0` (racine, `npx supabase`) | `package.json` racine |

- Le lien CLI local pointe sur la production. `db push` et `functions deploy` sans option visent donc le projet lié.
- Règle de ce runbook : **toujours** passer `--project-ref uvolpldwwyvadlamulvr` explicitement, jamais une commande sans cible.
- Aucune variable `SUPABASE_*` dans l'environnement du shell local (vérifié) ; `web/.env.local` vise la pile locale.
- **Web : `AUTO_DEPLOY_ON_MAIN = TRUE`** (vérifié en lecture seule le 2026-10-02, §19). Les projets Vercel `nalynt` et `nalynt-marketing` sont reliés à GitHub `louisgiller07/louis-performance-system`, branche de production `main`, création automatique des déploiements activée, aucune étape de build ignorée. Le web en production est le build de `ba59239`, produit par le push sur `main`. Le constat V0.3_003E (« non relié à Git ») date d'avant la liaison du 2026-09-15 : il est périmé.

## 2. Source de la release

- Commit de release : la tête de la pile UX-11 approuvée (actuellement `feat/ux11r31-athlete-delete-merge-gate`). `main` = `origin/main` = `ba59239` (production).
- **INTERDIT : merge / push sur `main` avant le Stage 1.** Un push sur `main` est un déploiement production du web et du site marketing. L'ordre est verrouillé au §20.
- Le déploiement se fait toujours depuis un checkout propre du commit de release, qu'il soit poussé ou non.
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
- **Ne pas utiliser** le script `head-coach-engine` `deploy:daily-run` (ajouté en M3, 2026-08). Il ne lance que `npm run build`, sans `build:edge`, puis déploie `daily-run` directement en production : la fonction partirait sans le bundle V2 reconstruit. Le runbook utilise uniquement les commandes explicites du §9, après `build:release:all`.
- Le déploiement précédent utilisait `--use-api` (bundling côté Supabase, graphe transitif hors de `supabase/functions` prouvé en M3_005). L'inclusion de l'import paresseux du bundle V2 par ce bundling distant n'est pas prouvée : elle se vérifie au Stage 3, avant toute séance (§9).

## 5. Migrations

Distant attendu : 50 migrations, la dernière `20260924110000`. Local : 60. À appliquer, dans cet ordre, rien d'autre (10) :

1. `20260930120000_ux11b2_execution_schema`
2. `20260930120500_ux11b2_record_session_execution`
3. `20260930130000_ux11a5a2b_dh_technical_tier`
4. `20261001090000_ux11b23_pass_measure_contract`
5. `20261001120000_ux11a5c2_v2_daily_persistence`
6. `20261001140000_ux11b25_session_activity_results`
7. `20261002090000_ux11b26_execution_result_integrity`
8. `20261002120000_ux11r1_athlete_account_purge`
9. `20261003090000_ux11r2_training_plan_model_assignments`
10. `20261003120000_ux11r31_revoke_direct_athlete_delete` (UX-11R.3.1 : `revoke delete on public.athletes from anon, authenticated`)

`git diff --name-status ba59239..HEAD -- supabase/migrations` : 10 ajouts (`A`), 0 modification, 0 suppression. Les 9 premières n'ont pas changé depuis `be83f44`. Aucun seed : `supabase/seed.sql` n'existe pas. Aucune migration n'insère d'assignation ni d'athlète.

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
| 0.5 | Historique des migrations | voir §21, R3 (lecture garantie par transaction en lecture seule) | DB prod, lecture | 50 distantes jusqu'à `20260924110000`, **exactement** les 10 du §5 absentes du distant, aucune version distante absente du dépôt. Sinon : STOP. |
| 0.6 | Dérive de schéma | voir §21, R4 et R5 | DB prod, lecture (pg_dump) ; fichier local hors dépôt | Diff vide après normalisation (ordre, propriétaires). Toute différence de table, colonne, policy, grant ou fonction : STOP et analyse. |
| 0.7 | Gardes de données des migrations | SQL en lecture seule (§21, R3) : `select decision_id, count(*) from public.decision_final_prescriptions group by 1 having count(*) > 1;` · `select to_regclass('public.session_executions'), to_regclass('public.training_plan_model_assignments');` | DB prod, lecture | 0 ligne ; `null, null` |
| 0.8 | Sauvegardes | Dashboard → Database → Backups · `npx supabase backups list --project-ref uvolpldwwyvadlamulvr` | API, lecture | sauvegarde récente présente ; PITR noté (oui / non) |
| 0.9 | Fonctions déployées | `npx supabase functions list --project-ref uvolpldwwyvadlamulvr` | API, lecture | versions notées pour `daily-run`, `generate-training-plan`, `accept-training-plan`, `completed-session` ; `session-execution` absente ; `verify_jwt = true` |
| 0.10 | Flag global | `npx supabase secrets list --project-ref uvolpldwwyvadlamulvr` | API, lecture (noms et empreintes seulement) | `NALYNT_V2_PLAN_GENERATION_ENABLED` **absent** |
| 0.11 | Web en production | `npx vercel@62.2.0 api "/v9/projects/<projectId>?teamId=<orgId>" -X GET --raw`, filtré sur `targets.production` (ne jamais afficher `env`) | Vercel, lecture | identifiant du déploiement courant noté (retour web possible tant qu'aucun plan V2 n'existe) |
| 0.12 | Référence de comptage V1 | SQL lecture : `select 'training_plan_versions', count(*) from public.training_plan_versions union all select 'decisions', count(*) from public.decisions union all select 'completed_sessions', count(*) from public.completed_sessions union all select 'athletes', count(*) from public.athletes;` | DB prod, lecture | valeurs notées ; comparées après le Stage 1 |

### MUTATING COMMANDS

Aucune commande du Stage 0 ne modifie la production.
- La sauvegarde logique écrit uniquement des fichiers locaux, hors dépôt (`db dump --role-only`, `--schema public,…`, `--data-only --use-copy` ; puis `SHA256SUMS` et `RESTORE.md`). Elle lit la production.
- Le smoke V1 de référence sur le compte de test écrit des données de ce compte seulement : il n'a lieu qu'au Stage 1 (§8), sous l'Approbation A.

## 8. Stage 1 — migrations (APPROVAL A ; commandes préparées, NON exécutées)

**Gates, tous vrais avant la commande de mutation :**
- cible confirmée (0.2, 0.4) ;
- sauvegarde ou PITR confirmé (0.8) **et** dump logique frais, avec sommes de contrôle ;
- historique distant exactement 50 versions, les 10 du §5 en attente (0.5), aucune dérive (0.6), gardes OK (0.7) ;
- commit en production confirmé `ba59239` (0.9, 0.11) et commit de release confirmé (0.1) ;
- flag global absent (0.10).

| # | Commande | Type | Note |
|---|---|---|---|
| 1.1 | `npx supabase db push --project-ref uvolpldwwyvadlamulvr --dry-run --skip-vault` | lecture | doit lister exactement les 10 fichiers du §5 |
| 1.2 | `npx supabase db push --project-ref uvolpldwwyvadlamulvr --skip-vault` | **MUTATION** | `SUPABASE_DB_PASSWORD` défini (sinon le CLI crée un rôle de connexion temporaire, §21) ; jamais `--include-all`, `--include-seed`, `--include-roles`, `--yes` ; mot de passe DB saisi au prompt, jamais dans la ligne de commande ; relire la liste avant de confirmer. `--skip-vault` : aucun secret Vault n'est configuré, rien ne doit être écrit. |
| 1.3 | §21, R3 | lecture | 60 versions distantes, la dernière `20261003120000`, 0 pending |
| 1.4 | SQL lecture : `select count(*) from public.training_plan_model_assignments;` · `select relrowsecurity from pg_class where oid = 'public.training_plan_model_assignments'::regclass;` · `select grantee, string_agg(privilege_type, ',') from information_schema.role_table_grants where table_name = 'training_plan_model_assignments' group by 1;` · `select to_regprocedure('public.purge_athlete_account(uuid)');` · `select has_table_privilege('authenticated', 'public.athletes', 'DELETE'), has_table_privilege('anon', 'public.athletes', 'DELETE'), has_table_privilege('authenticated', 'public.athletes', 'UPDATE');` | lecture | `0` ; `true` ; `service_role` seul (SELECT, INSERT, UPDATE, DELETE) ; non null ; `false, false, true` |
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

Ordre exact (UX-11R.3.2). Le web n'est **plus** déployé par `vercel deploy` : c'est le push sur `main` qui le déploie, avec le site marketing. Ainsi « nouveau web + anciennes Edge » n'existe jamais comme étape planifiée.

| # | Commande / action | Pourquoi |
|---|---|---|
| 2.0 | Checkout propre au commit RC exact ; `npm ci` (racine + 5 paquets) ; `npm run build:release:all` puis `npm run build:release:all -- --verify-only` | mêmes hashes que l'inventaire (§4) |
| 2.1 | `npx supabase functions deploy session-execution --project-ref uvolpldwwyvadlamulvr --use-api` | nouvelle, inerte : aucune prescription V2 ne peut exister |
| 2.2 | `npx supabase functions deploy daily-run --project-ref uvolpldwwyvadlamulvr --use-api` | chemin V1 identique ; lecteurs V2 présents mais inactifs |
| 2.3 | `npx supabase functions deploy generate-training-plan --project-ref uvolpldwwyvadlamulvr --use-api` | flag absent → V1 |
| 2.4 | `npx supabase functions list --project-ref uvolpldwwyvadlamulvr` ; `NALYNT_V2_PLAN_GENERATION_ENABLED` toujours absent | versions +1 pour les 3 seulement, `verify_jwt = true` |
| 2.5 | **Smoke V1 Edge** (compte de test, web encore `ba59239`) | voir ci-dessous |
| 2.6 | **Seulement ensuite** : merge du commit RC dans `main`, puis push | le push déclenche les déploiements production Vercel `nalynt` (web) et `nalynt-marketing` (contenu inchangé depuis `ba59239`) |
| 2.7 | Vérifier le déploiement production (API Vercel en lecture : `targets.production.meta.githubCommitSha` = commit RC, `READY`) | web RC servi |
| 2.8 | **Smoke V1 web** | voir ci-dessous |

Jamais `--no-verify-jwt`, jamais `--prune`, jamais `functions deploy` sans nom, jamais `npx vercel deploy --prod` en parallèle du push.

**Smokes V1 Edge (2.5)** (compte de test) :
- appel sans JWT à chaque fonction → 401 ;
- génération → 200, puis `plan_generation_succeeded` avec `planningModel = v1` et `rolloutReason = global_v2_disabled` ;
- acceptation → 200 ;
- Daily → 200, sans champ V2, `decisions.final_prescription_status` NULL ;
- completed-session → 200.

**Smoke V1 web (2.8)** : routes principales 200, connexion du compte de test, Daily affiché, aucune entrée « séance guidée ».

**Retour arrière du Stage 2** (permis **seulement** si `select count(*) from public.training_plan_versions where prescription_schema_version = 'v2'` vaut 0) :
- redéployer `daily-run` et `generate-training-plan` depuis un checkout propre de `ba59239` ;
- web : promouvoir le déploiement production précédent (`dpl_AVRkb3jeU1iAvifRHsrRpgwpi8AG`, build de `ba59239`) via Vercel (`vercel promote` / « Instant Rollback »), **sans** pousser un revert sur `main` (qui redéploierait aussi) ;
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
| **A — Stage 1 DB** | 1.2 (`db push` des 10 migrations), puis 1.3 à 1.6 | tout déploiement Edge ou web, tout secret, toute assignation, **tout merge / push sur `main`** (§20) | gate en lecture seule du §21 vert (R1 à R8), dump frais avec sommes de contrôle, sauvegarde / PITR / restauration confirmés, cible reconfirmée au moment de l'opération |
| **B — Stage 2 code** | 2.1 à 2.5 (3 fonctions nommées + web), smokes V1 ; le merge / push sur `main` s'il déclenche un déploiement (§20) | toute assignation, tout secret V2 | Stage 1 vert, `--verify-only` vert avec les hashes enregistrés, flag absent |
| **C — Stage 3 assignation** | 3.2 à 3.4 : une ligne d'assignation, pour le seul compte interne nommé dans l'approbation | l'interrupteur global | Stage 2 vert, smokes V1 verts, compte interne identifié hors dépôt |
| **D — Stage 3 V2 ON** | 3.5 à 3.10 (interrupteur global à `true`) | toute assignation supplémentaire, tout pilote externe, le Stage 5 | assignation unique vérifiée (Q5), conditions d'arrêt (§12) et kill switch (§13) relus |

## 16. Points ouverts avant l'Approbation A

Remplacé par le §22 (UX-11R.3.1).

## 17. DELETE client sur `athletes` : révoqué (UX-11R.3.1)

**Audit UX-11R.3** (schémas `ba59239` et release) :
- un rider sans plan pouvait supprimer sa propre ligne ; la cascade (exécutée comme propriétaire de table) effaçait check-ins, décisions, health flags et completed sessions qu'il ne peut pas supprimer directement ;
- l'identité Auth et les événements pilotes restaient orphelins, et le web recréait une ligne vide ;
- avec un plan, une assignation ou une exécution : refus par FK RESTRICT ;
- autre athlète, anon : 0 ligne ;
- le droit venait du `GRANT ALL` générique de la baseline V0.2.

**Décision et migration 10** : `20261003120000_ux11r31_revoke_direct_athlete_delete`, `revoke delete on public.athletes from anon, authenticated;`.
- **Portée : DELETE seulement.** SELECT, INSERT et UPDATE (amorçage web, profil), les autres privilèges, la policy `athletes_own_data` et le grant EXECUTE de la purge (`service_role` seul) sont inchangés. Aucun grant à PUBLIC.
- **Recherche statique** : aucun `.from("athletes").delete()` ni `DELETE FROM athletes` dans le web, le site marketing, les Edge Functions ou les moteurs. Seuls les helpers de test l'utilisent, tous avec le client service role (55 appels vérifiés).
- **Contrat** : suppression de compte = purge serveur `purge_athlete_account` (`service_role`), puis suppression Auth par l'API Admin. Aucun autre chemin.

**Tests** (`athletesDeleteGrant.integration.test.ts`, 7/7 ; `athletePurge.integration.test.ts`, 5/5) :
- rider, propre ligne sans plan ni FK RESTRICT → 42501, rien supprimé ;
- rider, propre ligne avec plan → 42501 (le privilège est vérifié avant la FK) ;
- rider, autre athlète → 42501 ;
- anon, même avec un filtre universel → 42501 ;
- rider et anon appellent la purge → 42501 ;
- purge serveur → tout supprimé, identité Auth incluse, témoin intact ;
- échec forcé au dernier pas de la purge → rollback complet.

Mêmes résultats sur la base vierge (60 migrations) et sur la base type production (`ba59239` + données V1 de l'ancien code + 10 migrations), pour des athlètes historiques avec et sans plan.

## 18. Suppression de compte côté produit

- Backend : **prêt** (purge tout-ou-rien, `purgeAthleteAccount` puis suppression Auth ; testé sur base vierge, type production, et dans cet audit).
- Parcours produit : **absent**. Pas d'écran, pas d'Edge dédiée.
- Promesse actuelle : suppression sur demande écrite à l'adresse de contact. Elle est tenue par l'opérateur.
- **Stage 3 interne** : non bloquant (compte de test, opérateur interne).
- **Stage 5** : bloquant tant qu'une procédure opérateur de purge en production n'est pas écrite et répétée. Elle s'exécute en local avec la clé service, jamais dans le dépôt. Un écran en self-service n'est requis que si le produit le promet ; la notice actuelle ne le promet pas.

## 19. Merge / push sur `main` : risque de déploiement automatique (UX-11R.3.1)

**Audit local du dépôt.**

| Élément | Constat |
|---|---|
| GitHub Actions, GitLab CI, Bitbucket, CircleCI, Azure, Jenkins, Travis, Buildkite | aucun fichier versionné (`.github/` absent) |
| Hooks Git | aucun hook actif (`.git/hooks` : seulement des `.sample`), pas de `core.hooksPath`, pas de Husky / lefthook / pre-commit |
| Vercel | `web/vercel.json` = une règle de réécriture SPA, rien sur Git ni sur les branches. `web/.vercel/project.json` (non versionné) = identifiants du projet seulement. `marketing-site/.vercel` = sortie de build seulement ; aucun changement de `marketing-site` depuis `ba59239`. |
| Supabase | `config.toml` : aucune section `[remotes]`, aucune configuration de branching ; `[experimental.pgdelta]` ne concerne que `db diff` en local. Aucun fichier de workflow `db push` / `functions deploy`. |
| Scripts npm | aucun `prepare`, `postinstall` ou `preinstall` qui déploie. Un seul script manuel distant : `head-coach-engine` `deploy:daily-run`, exécuté seulement à la main, et à ne pas utiliser (§4). |
| Remote | `origin` = `github.com/louisgiller07/louis-performance-system` |
| Docs | Vercel « non connecté à Git » **constaté** en 2026-09 (V0.3_003E : des commits poussés sur `main` n'avaient pas atteint la production) |

**Ce que le dépôt ne peut pas prouver.**
- Un projet Vercel relié à GitHub déploie la branche de production à chaque push, sans aucun fichier dans le dépôt.
- L'intégration GitHub de Supabase (branching) peut appliquer les migrations au merge sur `main`, elle aussi sans fichier local.
- Des webhooks ou des GitHub Apps installés sur le dépôt ne sont visibles que côté GitHub.

Conclusion : **aucune automation dans le dépôt**. Ce n'est **pas** une preuve qu'aucun système externe ne déploie.

**Vérification distante en lecture seule (2026-10-02, UX-11R.3.2) : `AUTO_DEPLOY_ON_MAIN = TRUE`.**
- API Vercel (GET) : les projets `nalynt` (racine `web`) et `nalynt-marketing` (racine `marketing-site`) sont reliés à GitHub `louisgiller07/louis-performance-system`.
  - Branche de production `main`, `gitProviderOptions.createDeployments = enabled`, aucune `commandForIgnoringBuildStep`, aucun deploy hook.
  - Lien créé le 2026-09-15.
- Production web actuelle : `dpl_AVRkb3jeU1iAvifRHsrRpgwpi8AG`, `READY`, `githubCommitSha = ba59239…`, ref `main`, 2026-09-30 14:08 UTC.
- GitHub (API publique, GET) :
  - chaque push sur `main` du 2026-09-30 (`33f779b`, `9e68e4b`, `1f16235`, `35e6e62`, `ba59239`) a créé des déploiements **Production** par `vercel[bot]`, pour `nalynt` et `nalynt-marketing` ;
  - statuts « Vercel – nalynt » et « Vercel – nalynt-marketing » sur `ba59239` ;
  - aucun workflow GitHub Actions ; aucun check-run.
- Supabase : aucune branche de preview (`branches list` vide) ; aucun statut ni check-run Supabase sur les commits. Aucune intégration détectée ; l'intégration GitHub dans le dashboard, les webhooks et les GitHub Apps n'ont pas été vérifiés (pas d'accès GitHub authentifié).
- Le dépôt GitHub est **public**.

**Verdict : `DO NOT MERGE/PUSH MAIN BEFORE STAGE 1`.**
- Un push sur `main` déploierait immédiatement le web RC sur l'ancien schéma : nouveau code + ancien schéma = UNSUPPORTED.
- `createDeployments` étant actif, un push d'une **autre** branche crée probablement des déploiements Preview : aucun push de branche UX-11 avant l'Approbation B.
- Le push sur `main` devient l'étape 2.6 de l'Approbation B, après les Edge Functions (§9, §20).

## 20. Ordre de déploiement verrouillé

Compatibilité prouvée en local :
- **ancien code + nouveau schéma (60 migrations) : SUPPORTED** (répétition R.3.1 : Daily V1, génération, acceptation par le code de `ba59239`) ;
- **nouveau code + ancien schéma : UNSUPPORTED**.

**Ordre obligatoire :**
1. Gate distant en lecture seule (§21), sur autorisation explicite.
2. **Approbation A.**
3. Migrations (Stage 1, §8).
4. Smoke V1 avec l'**ancien** code toujours en place (1.6).
5. Seulement ensuite, **Approbation B** : déploiement du nouveau code, Edge d'abord puis web (§9). C'est aussi le seul moment où un merge / push sur `main` peut avoir lieu s'il déclenche un déploiement.

**Merge / push (verrouillé, UX-11R.3.2) :**
- **INTERDIT** : merge / push sur `main` avant le Stage 1, et avant les 3 Edge Functions du Stage 2.
- **APPROBATION A** : migrations seulement (§8), puis smoke V1 avec l'ancien code (1.6).
- **APPROBATION B**, dans cet ordre exact (§9) :
  1. checkout RC exact ;
  2. `build:release:all` puis `--verify-only` ;
  3. déploiement manuel de `session-execution`, `daily-run`, `generate-training-plan` ;
  4. flag V2 global toujours absent ;
  5. smoke V1 Edge ;
  6. merge / push `main` ;
  7. ce push déclenche les déploiements production Vercel web et marketing ;
  8. smoke V1 web.
- Une intégration Supabase qui appliquerait les migrations au merge n'a pas été détectée ; elle doit rester vérifiée inactive avant le push 6.

## 21. Gate distant en lecture seule (préparé, NON exécuté ; autorisation séparée requise)

Règles communes :
- cible explicite `uvolpldwwyvadlamulvr` partout ;
- aucun secret dans la ligne de commande ni dans l'historique : variables d'environnement saisies depuis le gestionnaire de mots de passe (`SUPABASE_DB_PASSWORD`, `PGPASSWORD`, `VERCEL_TOKEN`), effacées ensuite ;
- les sorties restent hors du dépôt (`<HORS_DEPOT>`).

**Connexion à la base sans écriture possible.**
- Le CLI Supabase 2.x, s'il n'a pas de mot de passe, peut créer un **rôle de connexion temporaire** via l'API de gestion avant de se connecter. C'est une écriture côté projet.
- Les lectures en base passent donc par `psql` / `pg_dump` (17.6, les versions du conteneur local `supabase_db_louis-performance-system`), avec le mot de passe fourni.
- Pour `psql` : `PGOPTIONS='-c default_transaction_read_only=on'`, qui fait refuser toute écriture par Postgres lui-même.
- Hôte et utilisateur : ceux de `supabase/.temp/pooler-url` (pooler de session, port 5432, sans mot de passe dans le fichier).

| # | Objectif | Outil et commande | Lecture seule | Donnée retournée | Secret requis | Risque |
|---|---|---|---|---|---|---|
| R1 | Confirmer la cible (local) | `cat supabase/.temp/project-ref` · `git rev-parse HEAD` | oui, local | `uvolpldwwyvadlamulvr`, commit | aucun | aucun |
| R2 | Confirmer la cible (distant) | `npx supabase projects list` | oui (GET de l'API de gestion) | projets du compte : ref, nom, région, statut | jeton d'accès Supabase (session CLI) | aucun ; vérifier que `evynmzyjhobdpmxdiwsy` n'est pas visé |
| R3 | Historique des migrations, gardes, grants | `docker exec -e PGPASSWORD -e PGOPTIONS='-c default_transaction_read_only=on' supabase_db_louis-performance-system psql "<pooler-url>" -At -c "select version from supabase_migrations.schema_migrations order by 1;"`, puis les requêtes 0.7 et 0.12 | **garantie** (transaction en lecture seule) | 50 versions attendues ; gardes ; comptages | mot de passe DB | aucun |
| R4 | Dump du schéma de production | `docker exec -e PGPASSWORD supabase_db_louis-performance-system pg_dump "<pooler-url>" --schema-only --schema=public --no-owner --no-privileges` (sortie redirigée vers `<HORS_DEPOT>/prod_public_<date>.sql`), plus une seconde passe **avec** privilèges (`--schema-only --schema=public`) pour comparer grants et policies | oui (pg_dump ne fait que lire, en transaction d'instantané) | schéma `public`, sans données | mot de passe DB | fichier local de schéma, à garder hors dépôt |
| R5 | Comparer la dérive avec `ba59239` | pile locale jetable construite depuis les 50 migrations de `ba59239`, `pg_dump` avec les mêmes options, puis `diff` après normalisation | oui, local | différences de tables, colonnes, contraintes, fonctions, policies, grants | aucun | aucun ; toute différence inexpliquée = STOP |
| R6 | Sauvegardes / PITR | Dashboard → Database → Backups (consultation seulement, sans bouton) · `npx supabase backups list --project-ref uvolpldwwyvadlamulvr` | oui (GET) | sauvegardes disponibles, PITR actif ou non | jeton d'accès Supabase | aucun ; ne jamais cliquer « Restore » |
| R7 | Vercel relié à Git ? | Dashboard Vercel → projet `louis-performance-system` → Settings → Git (consultation), **ou** `curl -s -H "Authorization: Bearer $VERCEL_TOKEN" "https://api.vercel.com/v9/projects/louis-performance-system?teamId=<orgId de web/.vercel/project.json>"` en lisant `link` et la branche de production · `gh api repos/louisgiller07/louis-performance-system/deployments` et `gh api repos/louisgiller07/louis-performance-system/commits/ba59239/statuses` (un déploiement Vercel posté par commit = intégration Git active) | oui (GET) | dépôt relié ou non, branche de production, déploiements créés par push | jeton Vercel en lecture ; session `gh` | aucun ; ne jamais utiliser `vercel git connect/disconnect` dans ce gate |
| R8 | Supabase relié à GitHub ? | Dashboard Supabase → Project Settings → Integrations → GitHub (consultation) · `npx supabase branches list --project-ref uvolpldwwyvadlamulvr` · `gh api repos/louisgiller07/louis-performance-system/hooks` (droits admin) · `gh api repos/louisgiller07/louis-performance-system/actions/workflows` | oui (GET) | intégration et branching actifs ou non, webhooks, workflows | jeton d'accès Supabase ; session `gh` | aucun |

**Exclus de ce gate**, car pas strictement en lecture seule ou hors périmètre :
- `supabase migration list` / `db dump` sans mot de passe (rôle de connexion temporaire) ;
- `db push --dry-run` (Stage 1) ;
- `secrets list` (lecture, mais à faire au Stage 1 juste avant la mutation : 0.10) ;
- toute création de sauvegarde côté Supabase ;
- `vercel git`, `vercel link`.

Le dump logique de **données** (sauvegarde fraîche) lit seulement la production mais contient des données personnelles : il relève de la préparation de l'Approbation A, au même titre que R6. Il suit les mêmes règles (`pg_dump`, mot de passe en variable, hors dépôt, `SHA256SUMS`, `RESTORE.md`).

## 22. Blockers avant l'Approbation A

L'Approbation A reste **BLOQUÉE** tant que ces points distants ne sont pas vérifiés (gate du §21, sur autorisation séparée) :

1. historique des migrations distantes : 50 versions, exactement les 10 du §5 absentes (R3) ;
2. dérive de schéma nulle par rapport à `ba59239` (R4, R5) ;
3. sauvegarde fraîche de production : dump logique, avec sommes de contrôle et procédure de restauration ;
4. capacité de restauration : sauvegardes, PITR, rôle autorisé (R6) ;
5. cible confirmée une seconde fois, au moment même de l'opération (R1, R2) ;
6. comportement Git : **fait** (R7 : `AUTO_DEPLOY_ON_MAIN = TRUE`, intégré à l'ordre du §20 ; R8 : aucune intégration Supabase détectée, webhooks et GitHub Apps non vérifiés).

Statut courant et matrice : §24.

## 23. Outil du gate en lecture seule (UX-11R.3.2)

`scripts/release/prod-readonly-gate.mjs` (versionné, sans secret). **Lancé par l'opérateur dans son propre terminal**, `PGPASSWORD` défini dans ce terminal seulement : le mot de passe ne transite ni par un fichier, ni par un argument, ni par un log.

| Commande | Fait | Écrit en production |
|---|---|---|
| `inspect --out <DIR>` | R3 (historique des migrations comparé à `ba59239` et aux 10 UX), grants / RLS / policies de `athletes`, comptages, catalogue structurel de `public`, dump `--schema-only --schema=public` | jamais : chaque requête dans `BEGIN READ ONLY … ROLLBACK` avec `ON_ERROR_STOP` ; `pg_dump` ne fait que lire |
| `catalog --target local:<conteneur> --out <FICHIER>` | catalogue de référence d'une pile locale construite depuis les 50 migrations de `ba59239` | — (local) |
| `drift --prod <catalogue> --ref <catalogue>` | R5 : différences ligne à ligne (tables, colonnes, types, defaults, contraintes, FK, index, fonctions et signatures, triggers, RLS, policies, grants de tables, de colonnes et de fonctions, vues, séquences, enums, default privileges, extensions) ; propriétaires exclus | — (local) |
| `backup --out <DIR>` | dump logique complet : `public` + `supabase_migrations` (schéma et données), `auth` et `storage` en **données seulement** (sans `auth.schema_migrations`), format custom, `SHA256SUMS`, comptages avant / après | jamais (`pg_dump`) |
| `restore-check --backup <DIR> --into local:<conteneur vide>` | restauration dans une pile **locale** vide (auth → storage → app), comptages, catalogue restauré comparé à celui de la sauvegarde, athlètes sans identité Auth | — (local seulement ; refuse la production) |

Garde-fous : ref liée = `uvolpldwwyvadlamulvr` obligatoire, `evynmzyjhobdpmxdiwsy` refusé, utilisateur du pooler de ce projet, `PGPASSWORD` requis (jamais affiché), sorties hors du dépôt, cible `local:` limitée aux conteneurs `supabase_db_*`. Aucune commande du CLI Supabase (pas de rôle de connexion temporaire), aucune API de gestion.

**Validé en local** (pile `ba59239` + données = « fausse production », référence `ba59239` fraîche, pile vide de restauration) :
- `inspect` : 50 appliquées = `ba59239`, exactement les 10 UX en attente, grants pré-migration (DELETE présent pour `anon` / `authenticated`) ;
- `drift` : 0 ligne entre la fausse production et la référence (même hash de catalogue) ; contrôle positif : 147 / 3 lignes contre le schéma à 60 migrations, dont le grant DELETE de `athletes` ;
- `backup` puis `restore-check` : 0 écart de comptage, 0 athlète sans identité Auth, catalogue identique à une ligne près ;
  - l'écart restant est une CHECK de `pattern_insight_reviews` réécrite avec des parenthèses normalisées par PostgreSQL lors de l'aller-retour : bruit d'outil démontré, sans effet ;
  - seule erreur restante : `schema "public" already exists`, sans effet ;
- lecture V1 par le code de production `ba59239` sur la base restaurée (`computeDailyFor`) : 4 / 4.

**Limites de la sauvegarde logique** (à connaître avant d'accepter le risque) :
- **Auth** : les lignes `auth.*` sont restaurables en données si le service Auth cible est à une version de schéma compatible. Ne sont **pas** dans le dump :
  - la configuration Auth (fournisseurs, SMTP, URL du site, modèles d'e-mail) ;
  - les clés de signature JWT du projet. Dans un nouveau projet, les sessions et jetons existants sont invalides et les utilisateurs se reconnectent ; les hachages de mot de passe restent valables.
- Lisibilité de `auth` par le rôle `postgres` en production : à constater au premier `backup` (`NO_SELECT_PRIVILEGE` ou échec de `pg_dump` = Auth non sauvegardée).
- **Storage** : seules les métadonnées (`storage.buckets`, `storage.objects`) ; pas le contenu des fichiers.
- **Hors base** : secrets et versions des Edge Functions, secrets Vault (`supabase_vault`), clés API, paramètres réseau et de projet, configuration Vercel.
- La restauration vise une base **vide** au même schéma de plateforme ; sur un projet Supabase neuf, il faut d'abord comparer les versions des services.

## 24. Statut du gate et matrice de l'Approbation A (finale, 2026-10-03)

Les commandes avec `PGPASSWORD` ont été lancées par l'opérateur dans son terminal. L'agent n'a jamais eu le mot de passe et n'a analysé que les fichiers locaux produits (hors dépôt, `C:\Temp\nalynt-prod-gate`). Aucune mutation, aucun `db push`.

**Historique et dérive** (`inspect`, 2026-10-03 07:03 UTC) :
- 50 migrations appliquées, identiques à `ba59239`, aucune version inconnue ;
- exactement les 10 UX en attente ;
- dérive : 3 lignes, toutes expliquées et non matérielles :
  - `set_updated_at()` : même logique, corps en CRLF en production (fonction antérieure à la baseline, marquée appliquée par `migration repair`) contre LF dans le blob git ; MD5 reproduit exactement ;
  - `pg_net` : extension créée par l'image Supabase **locale**, utilisée par aucune migration, fonction, trigger ou RPC du dépôt.

**État pré-migration** :
- `athletes` : `anon` et `authenticated` ont DELETE (la migration 10 le retirera) ; RLS active ; policy unique `athletes_own_data`.
- Comptages de référence (39 tables) : `athletes` 7, `auth.users` 10, `auth.identities` 11, `decisions` 83, `decision_outcomes` 42, `daily_checkins` 46, `completed_sessions` 7, `planned_sessions` 82, `training_plan_versions` 12, `training_plan_current_version` 5, `training_plan_generated_sessions` 137, `training_plan_planned_prescriptions` 120, `pilot_observability_events` 57, `pattern_*` 0, `storage` 0, `schema_migrations` 50.

**Sauvegarde logique de production** (2026-10-03 16:31:14–16:31:21 UTC, `pg_dump` format custom, client PostgreSQL 17, comptages stables pendant la sauvegarde et identiques à ceux de 07:03, catalogue identique) :

| Archive | Contenu | Taille | SHA-256 |
|---|---|---|---|
| `app-public-and-migrations.dump` | schémas `public` + `supabase_migrations`, schéma et données (35 tables, fonctions et RPC, 51 index, 51 triggers, 58 FK, 34 RLS, 33 policies, 8 vues, ACL, default privileges) | 476 363 o | `338443ad3f83794f97a9750a315fa1036d4a70f4aeed7c7fd044e24c718c1e35` |
| `auth-data.dump` | `auth`, données seulement, 26 tables (users, identities, sessions, refresh_tokens, MFA, SSO / SAML, OAuth, WebAuthn…), sans `auth.schema_migrations` | 18 973 o | `7a188e12b70629892a3deccb7d051aaa64908b22c242ab79021b21703832519f` |
| `storage-data.dump` | `storage`, données seulement, 8 tables (métadonnées ; 0 bucket, 0 objet en production) | 6 978 o | `22a4d9137e1d19ac3d96e30c07c4e5fc30fdb26fd852fcd61d185c65ab145be7` |

`SHA256SUMS` vérifié. Stockage : local, hors dépôt. Les fichiers contiennent des données personnelles.

**Restauration rehearsal** :
- pile **locale vide dédiée** `nalynt-prodrestore-r33` (0 migration, Storage activé pour recevoir les métadonnées), jamais la pile principale ni `r32ref` ; ordre auth → storage → app.
- **0 écart de comptage** sur les 39 tables, dont `auth.users` 10/10 et `auth.identities` 11/11 ; aussi `auth.sessions` 26/26 et `auth.refresh_tokens` 37/37.
- 0 athlète sans identité Auth.
- Catalogue restauré identique à la production, à deux lignes près, analysées :
  - la CHECK `pattern_insight_reviews_reviewer_note_shape`, réécrite `(a AND b AND c)` au lieu de `((a AND b) AND c)` par l'aller-retour PostgreSQL : même logique ;
  - `pg_net`, propre à la pile locale.
  - `set_updated_at` est restaurée à l'identique (CRLF).
- Erreurs `pg_restore` (sortie 1, erreurs ignorées), toutes non matérielles :
  - `schema "public" already exists` ;
  - Auth locale plus ancienne que la production : `mfa_recovery_code_sets`, `mfa_recovery_codes`, `scim_tokens`, `scim_users` absentes, colonne `one_time_tokens.expires_at` absente. Ces 5 tables ont **0 ligne** dans la sauvegarde.
  - Storage local plus ancien : colonnes `buckets.versioning_status`, `objects.archived_at` absentes ; `buckets` et `objects` ont 0 ligne. `storage.migrations` est la table de version du service : le conflit est attendu.
- Lecture V1 par le code de production `ba59239` sur la base restaurée : `computeDailyFor` **46 / 46** (tous les check-ins, 5 athlètes), 0 échec.

**Auth** : `DATABASE AUTH DATA RECOVERABLE` (comptes, identités, hachages de mot de passe, sessions et refresh tokens). La cible doit avoir un schéma Auth au moins aussi récent que la production : une cible plus ancienne perdrait les tables manquantes, vides aujourd'hui. **Pas** de récupération Auth complète : la configuration Auth (fournisseurs, SMTP, Site URL, redirections, modèles), les clés de signature JWT et les autres secrets ne sont pas dans le dump. Dans un nouveau projet, les sessions sont invalides et les utilisateurs se reconnectent.

**Storage** : seules les métadonnées (aujourd'hui vides) ; aucun fichier n'est sauvegardé.

**Hors base** : secrets et code déployé des Edge Functions, secrets Vault, clés API, réglages réseau et projet, configuration Vercel.

| Gate | Status |
|---|---|
| Production target | PASS |
| Migration history | PASS |
| Exactly 10 pending | PASS |
| Material schema drift | PASS (zéro dérive matérielle ; bruit de plateforme expliqué) |
| DELETE pre-state | PASS |
| Baseline row counts | PASS |
| Production logical backup | PASS |
| Logical restore rehearsal | PASS (erreurs non matérielles analysées) |
| Database Auth recovery | PASS (données ; configuration et clés hors dump) |
| Provider backup | FAIL (aucune) |
| PITR | FAIL (désactivé) |
| Restore operator | PASS (VERIFIED par l'opérateur dans le dashboard) |
| Vercel main auto-deploy understood | PASS |

**LOGICAL RECOVERY : PASS. PROVIDER RECOVERY : FAIL.**

**Risque à accepter explicitement** :
- La sauvegarde est un instantané au temps T (2026-10-03 16:31 UTC, à refaire juste avant le Stage 1).
- Sans PITR ni sauvegarde provider, toute écriture entre ce dump et un incident serait **perdue** en restaurant cet instantané.
- Une restauration vers un nouveau projet ne restaure pas la configuration Auth, les clés JWT, les fichiers Storage, les secrets Edge, la configuration Vercel ni les autres secrets hors base.

**Verdict : `APPROVAL A TECHNICALLY READY — EXPLICIT BACKUP RISK ACCEPTANCE REQUIRED`.**
- Aucune migration n'est lancée : l'Approbation A demande une décision écrite de l'opérateur sur ce risque.
- Au moment du Stage 1 : nouveau dump juste avant `db push`, et cible reconfirmée.
