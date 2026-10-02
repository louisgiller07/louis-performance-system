# UX-11R.3 — Stage 0 production preflight (mis à jour UX-11R.3.1)

> **Rien n'a été exécuté contre la production.** Ce document prépare le déploiement réel et s'arrête **avant le Stage 1**. Chaque commande ci-dessous est à lancer par un humain, au moment prévu, après l'approbation qui la couvre (§15). La première étape distante est le gate en lecture seule du §21, qui demande sa propre autorisation. Aucune approbation n'en autorise implicitement une autre.
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
- Web : en 2026-09 (V0.3_003E), le projet Vercel a été **constaté** non relié à Git, et `npx vercel deploy --prod --scope nalynt` depuis `web/` était le seul mécanisme. C'est un constat historique, **pas une preuve de la configuration actuelle** : voir §19, qui conclut `REMOTE CONFIGURATION MUST BE VERIFIED BEFORE MERGE`.

## 2. Source de la release

- Commit de release : la tête de la pile UX-11 approuvée (actuellement `feat/ux11r31-athlete-delete-merge-gate`). `main` = `origin/main` = `ba59239` (production).
- **Aucun merge ni push avant le Stage 1** tant que le §19 n'a pas été levé par une vérification distante en lecture seule. L'ordre est verrouillé au §20.
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

**Verdict : `REMOTE CONFIG VERIFICATION REQUIRED`**, à traiter par défaut comme **`DO NOT MERGE BEFORE STAGE 1`**.
- Un déploiement automatique du nouveau web ou de nouvelles Edge Functions sur l'ancien schéma serait **new code + old schema = UNSUPPORTED**.
- Une application automatique des migrations court-circuiterait l'Approbation A.
- Statut Vercel : `REMOTE CONFIGURATION MUST BE VERIFIED BEFORE MERGE` (§21, R7).
- Statut Supabase : à vérifier aussi (§21, R8).

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

**Merge / push :**
- **Si R7 et R8 prouvent qu'aucun système ne déploie au push** : le merge / push peut précéder le Stage 1. Le déploiement reste manuel, depuis un checkout propre.
- **Si un déploiement automatique existe (ou si R7 / R8 ne concluent pas)** : le push est un déploiement.
  - Il se place **après le Stage 1** et **sous l'Approbation B**.
  - Pour le web, après le déploiement des 3 Edge Functions (2.1 à 2.3) : la combinaison nouveau web + anciennes Edge n'a pas été répétée.
  - Une intégration Supabase qui appliquerait les migrations au merge doit être désactivée ou vérifiée inactive **avant** tout push.

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
6. **avant toute décision de merge** : comportement Git de Vercel et de Supabase (R7, R8).
