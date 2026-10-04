# UX-11R — Release candidate & rollout hardening (R.1, R.2, R.3, R.3.1)

> Rien n'est déployé. Ce document prépare un déploiement futur : il ne l'autorise pas. Toute action distante (backup, `db push`, déploiement Edge, activation V2) reste une décision humaine explicite, étape par étape.

## 1. Référence

| Élément | Valeur |
|---|---|
| Base production | `ba59239` (`main` / `origin/main`) |
| Entrée fonctionnelle du RC | `7bdd9d8` (`feat/ux11c5-closure`, UX-11C core complete locally) |
| Durcissement | branche `feat/ux11r1-rollout-hardening`, commits de UX-11R.1 au-dessus de `7bdd9d8` (HEAD `4c9c88b`) |
| Flag serveur V2 | branche `feat/ux11r2-v2-server-rollout`, commits de UX-11R.2 au-dessus de `4c9c88b` (HEAD `db1bbb8`) |
| Preflight Stage 0 | branche `feat/ux11r3-production-preflight`, commits de UX-11R.3 au-dessus de `db1bbb8` (HEAD `be83f44`) ; commandes, gates et approbations : `docs/release/UX-11R_STAGE0_PREFLIGHT.md` |
| DELETE révoqué, gate distant | branche `feat/ux11r31-athlete-delete-merge-gate`, commits de UX-11R.3.1 au-dessus de `be83f44` |
| Gate, Stage 1, préparation de l'Approbation B | branche `feat/ux11r32-readonly-gate-completion` (UX-11R.3.2 à UX-11R.4) |
| **Stage 1** | **PASS, 2026-10-04** : les 10 migrations UX appliquées en production (60/60), smoke V1 avec l'ancien code PASS. Code de production toujours V1 (`ba59239`) |
| Constante de version | aucune : le dépôt n'a pas de convention de numéro de release, rien n'est créé |

## 2. Audit du diff `ba59239..7bdd9d8`

233 fichiers, 41 commits linéaires, tous rattachés à un ticket UX-11 :
- DB : 7 migrations.
- Planning V2 : `planning-engine/src`, 32 fichiers.
- Daily et prescription du jour : `head-coach-engine/src/supabase/dailyV2`, `runDailyFor`.
- Exécution : migrations UX-11B et Edge `session-execution`.
- Empaquetage Edge : `build:edge`, bundles.
- Web lecture seule : `finalPrescriptionV2`, `dailyPlan`, `history`, `program`, `trainingPlanReview`.
- Séances guidées : `web/src/features/guidedSession`.
- Infrastructure de test.
- Documentation : 00, 03, 05, 11.

Anomalies :
- **Aucun secret, jeton, URL de production ni compte réel** dans le diff. Seuls des `.env.example` sont versionnés.
- **Fichiers générés versionnés volontairement** : miroir de textes `coachingTextsV1_0.generated.ts` (avec garde de dérive), fixture `finalPrescriptionV2.json`, snapshots de non-régression.
- **`ROLL_OUT_CHECKLIST.md`** : non suivi mais non ignoré. Ajouté à `.git/info/exclude` (local, non versionné).
- **Défaut corrigé** : le build Edge ne fonctionnait que si les `dist` de `planning-engine` et `prescription-engine` existaient déjà localement (sortie de build non versionnée). Corrigé par `npm run build:release` (§6).

## 3. Migrations UX (appliquées en production le 2026-10-04, Stage 1)

1. `20260930120000_ux11b2_execution_schema`
2. `20260930120500_ux11b2_record_session_execution`
3. `20260930130000_ux11a5a2b_dh_technical_tier`
4. `20261001090000_ux11b23_pass_measure_contract`
5. `20261001120000_ux11a5c2_v2_daily_persistence`
6. `20261001140000_ux11b25_session_activity_results`
7. `20261002090000_ux11b26_execution_result_integrity`
8. `20261002120000_ux11r1_athlete_account_purge` (UX-11R.1)
9. `20261003090000_ux11r2_training_plan_model_assignments` (UX-11R.2) : table d'assignation serveur (§7), `purge_athlete_account` redéfinie pour la vider aussi. N'assigne personne.
10. `20261003120000_ux11r31_revoke_direct_athlete_delete` (UX-11R.3.1) : `revoke delete on public.athletes from anon, authenticated`. Retire un privilège client, n'ajoute ni ne modifie aucune donnée.

**Toutes additives pour le V1 :**
- colonnes nullables seulement : `athlete_performance_profiles.dh_technical_tier`, colonnes de statut V2 de `decisions` ;
- contraintes CHECK qui acceptent NULL ;
- nouvelles tables d'exécution, table d'assignation du modèle de planification (vide) ;
- RPC nouvelles ou redéfinies seulement côté V2 : `record_session_execution`, `persist_daily_run_v2` ;
- aucune RPC V1 modifiée ;
- `reject_append_only_mutation` est redéfinie (migration 8, §5) sans changer son comportement normal.

**Gardes de données :**
- migration 5 : refus si une décision a plusieurs prescriptions du jour ;
- migration 7 : refus s'il existe des originaux en double par emplacement.

Aucune ne supprime de données.

## 4. Répétitions de migration (local uniquement, piles jetables)

Méthode : piles Supabase **locales jetables** (`project_id` et ports 55xxx–57xxx distincts, seuls base / auth / REST / passerelle actifs). La pile de développement n'est jamais réinitialisée.

| Répétition | Résultat |
|---|---|
| **Base vierge** (toutes les migrations du dépôt depuis zéro) | 57 migrations appliquées sans intervention SQL, puis 58 avec la purge. Suite d'intégration head-coach complète : 1092/1092, puis 1098/1098 avec la purge (génération V1 et V2, Daily V1 et V2, prescription du jour, exécutions Force/DH/endurance, intégrité, pont M1, purge). |
| **Upgrade type production** | Schéma `ba59239` (50 migrations), données V1 créées **par le code de `ba59239`** (worktree) : 2 athlètes, plans V1 générés et acceptés, projections, 7 décisions, completed_sessions. Puis 7 migrations UX via `migration up`. |
| ↳ intégrité V1 | Instantané des 34 tables `public` avant / après : **0 ligne supprimée, réécrite ou ajoutée**. Colonnes V2 de toutes les décisions V1 à NULL. 0 prescription du jour, 0 exécution, 0 plan V2. |
| ↳ ancien code / nouveau schéma | Code de `ba59239` sur le schéma migré : Daily V1 (athlètes existants), génération, acceptation et Daily d'un nouvel athlète : OK. |
| ↳ nouveau code | Suite head-coach du RC sur la base migrée : 1098/1098, avec nouvelles données V2 et parcours complet. Daily du RC sur l'athlète V1 historique : chemin V1, aucun champ V2. |
| ↳ migration 8 + purge | Appliquée sur la base migrée ; purge de l'athlète V1 historique OK, témoin identique ; test de purge 5/5. |
| **Garde « un original par emplacement »** | Doublon créé volontairement (transaction annulée) : la migration refuse avec un message explicite et ne supprime rien. Sans doublon : elle passe. |
| **Base vierge, UX-11R.2** | Nouvelle pile jetable : 59/59 migrations sans intervention ; table d'assignation vide, RLS active, droits `service_role` seuls. Suite head-coach complète sur cette pile : 1121/1121 (dont flag V2, rollback, sécurité, purge). |
| **Upgrade type production, UX-11R.2** | Pile « upgrade » (schéma `ba59239` + données V1 créées par l'ancien code + 8 migrations) : migration 9 via `migration up`, 59 enregistrées. Table vide → athlète historique résolu en V1 (`default_v1`) même interrupteur actif ; nouvelle génération V1 ; son plan courant reste celui de l'ancien code ; Daily V1 sans champ V2 ; purge d'un autre athlète historique OK. |
| ↳ intégrité des données | Seconde pile peuplée (145 athlètes, 143 versions de plan, 103 décisions) : empreinte md5 des 38 tables `public` et de `auth.users` avant / après la migration 9 → **identiques**, seule différence la nouvelle table vide. |
| **Réapplication** | Un second `migration up` n'applique rien (`applied: []`) ; les versions restent enregistrées (57, puis 58). Les migrations ne sont pas présentées comme rejouables : c'est le registre `schema_migrations` qui empêche le rejeu. |

Les suites d'intégration ciblent une pile de répétition avec `SUPABASE_URL`, `LOCAL_SUPABASE_API_PORT` (port local supplémentaire explicite) et `LOCAL_SUPABASE_DB_CONTAINER` (conteneur `supabase_db_*` local explicite). Deux suites web (`athleteBootstrapRepo`, `openHealthFlagsRepo`) épinglent leur client sur le port de la pile de développement et ne peuvent viser une autre pile : c'est une limite du harnais, pas du schéma.

## 5. Purge de compte (production blocker résolu localement)

**Cause.** La suppression d'un athlète échouait sur des FK `RESTRICT` (`training_plan_versions`, `training_plan_current_version`, `session_executions`, `pattern_*`, `decision_final_prescriptions` → `decisions`, `decision_outcomes` → `decisions`) et sur les triggers append-only de 17 tables. Le test HTTP historique M3 montre le même blocage : ses athlètes de test ne peuvent pas être supprimés.

**Contrat (ADR UX-11B.2.1 §11, implémenté en migration 8)** : `purge_athlete_account(p_athlete_id)`.
- Fonction SECURITY DEFINER, exécution réservée à `service_role`.
- Une seule transaction, tout ou rien.
- Ordre des dépendances : chaînes `supersedes` en commençant par les feuilles, structure de plan avant versions, issues et journaux `pattern_*` avant décisions, exécutions avant prescriptions du jour, `pilot_observability_events` (sans FK). Ensuite la ligne `athletes` (les autres tables suivent en CASCADE), puis une vérification qu'aucune ligne de l'athlète ne subsiste.
- **Aucun trigger désactivé** : `reject_append_only_mutation` refuse toujours tout UPDATE, et tout DELETE sauf celui exécuté dans la transaction de purge (marqueur local `nalynt.athlete_purge_txid` lié à `txid_current()`).
- Aucun rôle API n'a DELETE sur une table append-only (vérifié).
- UX-11R.2 : la purge supprime aussi l'assignation de modèle de l'athlète (`training_plan_model_assignments`, compteur dans le résultat) ; l'assignation d'un autre athlète reste intacte (testé).

**Identité Auth.** `athletes.user_id` cascade depuis `auth.users`. L'ordre est donc : purge applicative, **puis** `auth.admin.deleteUser` (helper serveur `purgeAthleteAccount`). Si l'Auth échoue après la purge, il suffit de relancer la suppression Auth.

**Tests** (pile de développement, base vierge et base type production) :
- athlète complet purgé ;
- témoin strictement identique ;
- identité Auth supprimée ;
- appel par un rider refusé ;
- marqueur forgé refusé ;
- échec provoqué au dernier pas → aucune suppression.

**Hors périmètre.** L'appel produit (écran « supprimer mon compte », Edge dédiée, confirmation) n'existe pas : seul le contrat serveur est prêt.

**DELETE client sur `athletes` : révoqué (UX-11R.3.1, migration 10).**
- Constat de l'audit R.3 : un rider sans plan pouvait supprimer sa propre ligne, et la cascade effaçait un historique qu'il ne peut pas supprimer directement.
- Désormais, rider (propre ligne, avec ou sans plan), autre athlète et `anon` reçoivent 42501 ; ni rider ni `anon` ne peuvent appeler la purge.
- SELECT, INSERT, UPDATE et la policy sont inchangés.
- **Seul chemin de suppression : purge serveur, puis API Admin.** Aucun usage produit du DELETE direct (recherche statique).
- Détail : preflight §17.

## 6. Déployabilité Edge (sans déploiement)

**Commande de release complète (UX-11R.3)** : à la racine, `npm run build:release:all`, après `npm ci` à la racine et dans les 5 paquets.
- Elle construit les moteurs, les bundles Edge, `longitudinal-engine` et le web.
- Elle vérifie que chaque import de chaque Edge Function résout vers un fichier construit, et imprime l'inventaire sha256.
- `--verify-only` vérifie sans reconstruire. Détail : preflight §3–4.

**Commande UX-11 seule** (historique R.1) : `cd head-coach-engine && npm ci && npm run build:release`.
- Elle construit `planning-engine`, puis `prescription-engine` (qui dépend du premier), puis `head-coach-engine/dist` et les bundles Edge.
- `npm ci` est aussi requis dans `planning-engine` et `prescription-engine`.
- Vérifié sur un worktree propre : sortie 0, artefacts **identiques octet pour octet** au build de développement.
- Le graphe d'imports des 3 fonctions ne contient aucun fichier manquant ni hors de `supabase/functions` et `head-coach-engine/dist`.

| Fonction | Entrée / imports | RPC / tables | V1 / V2 | Bundling local eszip (image edge-runtime v1.74.3, sans envoi) |
|---|---|---|---|---|
| `generate-training-plan` | `index.ts` → `dist/edge/generateTrainingPlan.bundle.js` (contient le pipeline V2 depuis UX-11R.2), `dist/supabase/observability/pilotEvents.js`, `@supabase/server@1.4.1` | RPC de persistance du plan (V1 et V2), `training_plan_model_assignments` (lecture), `pilot_observability_events` | **Choix serveur** (§7) : V1 par défaut, V2 seulement interrupteur actif + athlète assigné. Corps limité à `generationRequestId` et `durationWeeks` (clés inconnues refusées) : un client ne peut pas demander V2. | OK (code 0) ; R.2 : OK depuis un checkout propre |
| `daily-run` | `index.ts` → 73 fichiers `dist/supabase/**`, `import()` paresseux de `dist/edge/dailyRunV2.bundle.js` | `persist_daily_run` (V1), `persist_daily_run_v2`, lectures plan / décisions | Suit les données : plan V2 courant → chemin V2, sinon V1 | OK (code 0), bundle V2 **inclus** |
| `session-execution` | `index.ts`, `validation.ts`, `@supabase/server` | `record_session_execution` (migrations 1, 2, 4, 5, 6, 7) | Uniquement pour une prescription du jour V2 | OK (code 0) |

- Variables d'environnement : celles injectées par Supabase (`SUPABASE_URL`, clés publishable et secret) via `withSupabase`, plus, depuis UX-11R.2, le secret Edge `NALYNT_V2_PLAN_GENERATION_ENABLED` (lu par `generate-training-plan` seulement ; absent = V2 désactivé).
- UX-11R.2, checkout propre : `build:release` sortie 0, bundles identiques octet pour octet au build de développement ; eszip local de `generate-training-plan` et `daily-run` OK ; harnais HTTP de rollout 26/26 sur le runtime Deno servant ce checkout. En local, `functions serve` charge toutes les fonctions : `longitudinal-engine` doit aussi être construit (`npm ci && npm run build`), ce que `build:release` ne couvre pas (fonctions `get-insights`, `refresh-longitudinal`, `submit-review`, inchangées depuis `ba59239`).
- Hygiène, non bloquante : `runDailyFor.js` garde, pour Node, un `import()` paresseux de `reconcileFinalPrescriptionV2.js`, qui contient le spécificateur nu `planning-engine/session-model-v2/daily`. Le bundler le signale « non mappé » sans échouer, et `daily-run` ne l'exécute jamais (il injecte le bundle).

## 7. Activation V2 côté serveur (implémentée en UX-11R.2)

**Mécanisme.**
- **Interrupteur global** : secret Edge `NALYNT_V2_PLAN_GENERATION_ENABLED`. Seule la valeur exacte `true` l'active ; absent, vide, `TRUE`, `1`, `yes`, ` true` → désactivé. Aucune variable `VITE_*` : rien côté navigateur.
- **Assignation** : table `public.training_plan_model_assignments` (`athlete_id` PK → `athletes`, `planning_model` `v1` ou `v2`, `note` optionnelle ≤ 500 caractères, `created_at`, `updated_at`).
  - RLS active, aucune policy.
  - `anon` et `authenticated` : aucun droit (testé : select / insert / update / delete d'un rider → 42501).
  - `service_role` seul : SELECT, INSERT, UPDATE, DELETE.
  - La migration n'assigne personne.
- **Résolution** (`resolvePlanningModelForAthlete`, avec code de raison) :
  - interrupteur inactif → V1 (`global_v2_disabled`) ; l'assignation n'est même pas lue ;
  - actif, aucune ligne → V1 (`default_v1`) ;
  - actif, `v1` → V1 (`assigned_v1`) ;
  - actif, `v2` → V2 (`assigned_v2`).
  - Une assignation illisible fait échouer la génération, jamais un V1 silencieux.
- **`generate-training-plan`** décide après l'authentification et la résolution de l'athlète depuis l'identité de l'appelant.
  - Corps public inchangé : `generationRequestId`, `durationWeeks` ; toute autre clé (`planningModel`, `useV2`…) → 400, rien n'est généré.
  - Réponse inchangée (`planVersionId`, `idempotentReplay`) : le modèle n'est pas révélé.
  - V1 : chemin existant, exact et inchangé. V2 : `generateAndPersistTrainingPlanV2`, le pipeline validé, aucun second pipeline.
  - **Aucun repli** : V2 bloqué → 422 avec le code stable Session Model V2 (ex. `missing_dh_technical_tier`) ; V2 en échec → 500. Jamais un plan V1 à la place. Le web affiche pour ces codes son message générique « configuration incomplète ».
- **Portée** : le flag ne gouverne que les **nouvelles** générations. Daily, prescriptions du jour, séances guidées et exécutions suivent les données persistées.
- **Idempotence** :
  - même requête rejouée (V1 ou V2) → même version, `idempotentReplay: true` ;
  - même `generationRequestId` avec un autre modèle (flag ou assignation changés entre deux tentatives) → environnement de génération différent → refus (500 `internal_error`), aucune version réécrite.
- **Écarts avec le contrat proposé en R.1** :
  - nom de table `training_plan_model_assignments` ;
  - nom de flag `NALYNT_V2_PLAN_GENERATION_ENABLED` ;
  - `created_at` / `updated_at` et `note` au lieu de `assigned_by` / `assigned_at`, pour ne pas inventer d'auteur (l'opérateur peut se nommer dans `note`) ;
  - la valeur `v1` est aussi acceptée, pour un retour individuel explicite.

**Activation (ordre, décision humaine à chaque étape).**
1. Interrupteur absent ou `false` (défaut).
2. Code compatible déployé (Stage 2) : tout le monde reste V1.
3. Assignation, en SQL serveur (service role / éditeur SQL), jamais depuis le client :
   ```sql
   insert into public.training_plan_model_assignments (athlete_id, planning_model, note)
   values ('<athlete_id>', 'v2', '<opérateur> — pilote interne')
   on conflict (athlete_id) do update set planning_model = excluded.planning_model, note = excluded.note;
   ```
   Prérequis : profil V2 de l'athlète (palier technique DH, priorités DH, terrains…). Sinon la génération répond 422 avec le code manquant.
4. Interrupteur global : `NALYNT_V2_PLAN_GENERATION_ENABLED=true` (secret Edge).
5. La **prochaine** génération de l'athlète assigné produit un plan V2. Il devient courant une fois accepté. Vérification : `plan_generation_succeeded` avec `planningModel = v2`.

**Désactivation.**
- **Globale** : interrupteur à `false` (ou supprimé). Toutes les nouvelles générations repassent en V1, assignations conservées.
- **Individuelle** : `update public.training_plan_model_assignments set planning_model = 'v1' where athlete_id = '<athlete_id>'` (ou `delete`). La prochaine génération de cet athlète est V1.
- Dans les deux cas, **un plan V2 courant continue d'être lu en V2** (Daily, séances guidées) jusqu'à ce qu'un nouveau plan V1 soit généré **et accepté**. Les données V2 restent (append-only).

**Limite.** Tant que le sign-off coaching est `pending` (`docs/release/COACHING_CONTENT_SIGNOFF.md`), l'assignation V2 est réservée aux comptes internes / de test (en production : `41f21027-…` seulement). Le Stage 5 n'est pas READY.

**Preuves locales.**
- Unitaires : parsing, matrice de résolution, dispatcher (pas de lecture d'assignation interrupteur inactif, pas de repli, erreur relancée telle quelle).
- Intégration (`v2RolloutFlag`, 9/9) : OFF/ON, rejeux V1 et V2, changement de modèle sur la même requête refusé sans réécriture, rollback global et individuel, sécurité, purge.
- HTTP réel sous Deno (`npm run test:generate-plan:rollout:http`, 26/26) : le harnais possède le runtime et le redémarre interrupteur OFF, ON, puis OFF.
  - Athlètes : pilote A (assigné V2), témoin B (non assigné), pilote C bloqué.
  - Corps forgés, rejeu, acceptation, Daily V2, séance guidée démarrée puis complétée avec résultat.
  - Après OFF : Daily de A toujours V2, nouvelle génération de A en V1, plan courant de A toujours V2, retour M1.

## 8. Observabilité

**Existant** : `pilot_observability_events`, best-effort. Types : génération (succès / bloqué / échec), acceptation, daily-run (succès / avertissement / échec), séance V1 complétée. La liste est fermée par une contrainte CHECK.

**Ajouts UX-11R.1, sans migration ni PII :**
- `daily_run_succeeded.metadata.finalPrescriptionStatus` (`created`, `not_required` ou `blocked`) et `finalPrescriptionStatusCode`, sur le chemin V2 seulement.
- `session-execution` écrit une ligne JSON par lot dans les logs Edge : `recorded` (événements de cycle de vie nouveaux par type, nombre de séries et d'activités, rejeux) ou `rejected` (code stable et statut HTTP). Aucun identifiant ni valeur.

Vérifié en local : 128 lignes, 0 UUID ; événements V2 `created` / `blocked` / `not_required` présents.

**Suivi par requêtes** (aucun nouveau système) :
- plans V2 : `training_plan_versions.prescription_schema_version = 'v2'` ;
- chemins Daily V2 : `decisions.final_prescription_status` ;
- séances : `execution_events` par `event_type` ;
- retour M1 : `computeDailyFor` ou `daily_run_succeeded`.

**Ajout UX-11R.2, sans toucher à la liste fermée des types :** `plan_generation_succeeded`, `plan_generation_blocked` et `plan_generation_failed` portent `metadata.planningModel` (`v1` / `v2`) et `metadata.rolloutReason` (code de résolution, §7) ; absents si l'échec précède la résolution. Best-effort, sans PII. Requête : `metadata->>'planningModel'` par athlète et par jour.

**Trous restants :**
- aucun événement serveur ne compte les refus `session-execution` en base (seulement dans les logs Edge, durée de conservation à vérifier) ;
- aucune alerte n'est configurée.

## 9. Runbook de déploiement (à exécuter par un humain, étape par étape)

> Commandes exactes, gates, approbations A à D, conditions d'arrêt et kill switch : `docs/release/UX-11R_STAGE0_PREFLIGHT.md` (UX-11R.3). En cas d'écart, ce document fait foi pour l'exécution.

**Stage 0 — sauvegarde et vérifications (lecture seule)**
- Confirmer la sauvegarde DB (PITR ou dump récent) et le commit en production (`ba59239`).
- `supabase migration list` doit montrer les 50 migrations jusqu'à `20260924110000` et aucune des 8.
- Vérifier en production que `decision_final_prescriptions` n'a aucun doublon par `decision_id` (garde de la migration 5) et que les tables d'exécution n'existent pas encore.
- Noter les versions Edge déployées (`supabase functions list`).
- Smoke V1 : génération, daily-run, completed-session sur le compte de test `41f21027-…`.
- *Justification* : point de retour connu, et préconditions des gardes de migration vérifiées avant d'écrire.

**Stage 1 — schéma**
- Appliquer les 8 migrations (`db push`).
- V2 reste inaccessible : l'Edge déployée est celle de `ba59239`, la génération est V1, `session-execution` n'est pas déployée.
- Smoke V1 identique au Stage 0. Les comptes de lignes V1 ne doivent pas changer.
- *Justification* : prouvé par la répétition « ancien code / nouveau schéma » (§4). Le schéma passe d'abord parce que le nouveau code lit les nouvelles colonnes : nouveau code + ancien schéma n'est pas pris en charge.

**Stage 2 — code compatible, V2 désactivé**
- `build:release` depuis le RC.
- Ne **pas** définir `NALYNT_V2_PLAN_GENERATION_ENABLED` (ou le laisser à `false`). La table d'assignation est vide (migration 9).
- Déployer `daily-run`, `generate-training-plan` (V1 tant que l'interrupteur est inactif), `session-execution` (déployée mais sans prescription V2 à servir) et le web (l'entrée « séance guidée » n'apparaît que pour une prescription V2 `created`).
- Smoke V1 complet.
- *Justification* : aucun plan V2 ne peut être créé, donc tous les chemins V2 restent inertes. Le web reste fail-closed.

**Stage 3 — interne** (débloqué techniquement par UX-11R.2, §7)
- Assigner V2 au seul compte de test `41f21027-…` (SQL §7), vérifier son profil V2, puis activer l'interrupteur.
- Générer, accepter, puis vérifier `plan_generation_succeeded` (`planningModel = v2`), Daily V2 et une séance guidée.
- Les autres athlètes restent V1 (non assignés), interrupteur actif ou non.
- Retour : interrupteur à `false` ou assignation `v1` (§7, §10).
- Ne jamais contourner par une génération V2 manuelle hors de l'Edge.

**Stage 4 — observation** (au moins une semaine de séances réelles sur le compte interne). Critères :
- génération V2 sans échec ;
- Daily V2 : `created` / `not_required` / `blocked` cohérents ;
- séances Force, DH et endurance complétées ;
- retour M1 visible au Daily suivant ;
- 0 erreur 5xx ;
- refus `session-execution` limités aux codes attendus.

**Stage 5 — déploiement contrôlé**
- Seulement après le sign-off coaching (`COACHING_CONTENT_SIGNOFF.md`) et des critères techniques verts. **Non READY.**
- Élargissement athlète par athlète par assignation, réversible.

## 10. Stratégie de retour arrière

- **Retour arrière principal : V2 désactivé (flag) et code conservé.** Global : `NALYNT_V2_PLAN_GENERATION_ENABLED=false`. Individuel : assignation `v1` ou supprimée (§7).
  - Les nouvelles générations repassent en V1.
  - Les données V2 sont **conservées** (append-only) ; rien n'est supprimé.
  - Les lecteurs restent fail-closed : version non prise en charge → pas de rendu partiel.
- **Athlète ayant déjà un plan V2 courant :**
  - Daily suit les données et reste en V2 tant que ce plan est courant.
  - Pour sortir un athlète du V2 : désactiver (global ou individuel), puis générer et accepter un plan **V1** pour lui. Testé en local (intégration et HTTP).
  - Les exécutions passées restent en historique.
- **Retour arrière Edge vers `ba59239` : interdit dès qu'un plan V2 existe en production.**
  - Répétition : l'ancien `daily-run` transmet alors le document V2 comme prescription « V1 » (`schemaVersion: "v2"`) au web de `ba59239`, qui n'a pas les gardes de lecture (UX-11A.5b.1).
  - Avant tout plan V2, ce retour reste possible : ancien code + nouveau schéma est pris en charge.
- **Retour arrière DB** : pas de migration descendante. Le schéma additif reste en place ; ne jamais supprimer les données V2 pour « revenir en arrière ».
- **Retour arrière web** : redéployer le build précédent n'est sûr qu'avant tout plan V2. Après, garder le web RC, qui est fail-closed.

## 11. Matrice de compatibilité

| Combinaison | Statut | Preuve / raison |
|---|---|---|
| Ancien code + ancien schéma | SUPPORTED | Production actuelle |
| Ancien code + nouveau schéma | SUPPORTED — **état de la production depuis le 2026-10-04** (smoke V1 PASS) | Répétition : Daily V1, génération, acceptation par le code de `ba59239` sur le schéma migré ; 0 ligne V1 modifiée. Rejoué en R.3.1 avec les 10 migrations. L'ancien code ne supprime jamais de ligne `athletes` côté client. |
| Nouveau code + ancien schéma | UNSUPPORTED | Le nouveau code lit les nouvelles colonnes et RPC (statut V2 des décisions, `persist_daily_run_v2`, `record_session_execution`). Le schéma doit passer d'abord. |
| Nouveau code + nouveau schéma + V2 désactivé | SUPPORTED | Interrupteur absent / `false` → V1 pour tous, même assignés (HTTP rollout et intégration) ; suite RC sur la base migrée ; Daily RC sur l'athlète V1 historique (chemin V1) ; HTTP V1 M3 27/28 (le seul échec est le nettoyage, §5, résolu par la purge) ; M5 97/97 ; daily-run « pas de plan → V1 » |
| Nouveau code + nouveau schéma + V2 interne | SUPPORTED en local, PENDING en production | Flag serveur (§7) : HTTP rollout 26/26 sous Deno, intégration 9/9 ; UX-11C core local (Force, DH, endurance, M1), daily-run V2 HTTP 9/9. Production : non déployé, sign-off coaching pending. |
| Interrupteur actif + athlète non assigné | SUPPORTED | V1 (`default_v1`), y compris avec un profil V2 complet ; corps forgé → 400 |
| Interrupteur actif + migration 9 sur données historiques | SUPPORTED | Table vide → V1 ; répétition type production (§4) |
| Plans V1 historiques | SUPPORTED | Intacts après migration ; chemin V1 |
| Plans V2 existants après V2 désactivé (nouveau code) | SUPPORTED | Daily et séances guidées continuent ; seule la génération est coupée (HTTP rollout : OFF après plan V2 → Daily V2, nouvelle génération V1) |
| Plans V2 existants + ancien code (retour Edge ou web) | UNSUPPORTED | Répétition : l'ancien daily-run sert le document V2 comme V1 |

## 12. Release gates

| Domaine | Gate | Statut | Preuve |
|---|---|---|---|
| Database | Répétition sur base vierge | PASS | R.3.1 : 60/60, suite 1128/1128 (V1, V2 assigné, Daily, exécution guidée, purge, DELETE révoqué) |
| Database | Upgrade type production | PASS | R.3.1, depuis `ba59239` + données V1 de l'ancien code + 10 migrations : colonnes d'origine identiques octet pour octet, nouvelles colonnes NULL ; ancien code OK ; DELETE direct refusé ; purge OK ; table d'assignation vide → V1 ; suite 1128/1128 |
| Database | V1 après migrations | PASS | §4 et §11 |
| Database | Purge | PASS (contrat serveur) | §5 : 5/5 sur trois bases ; assignation incluse (R.2). **Le parcours produit de suppression de compte n'existe pas** (PENDING). |
| Runtime | Build Edge propre | PASS | §6 : checkout propre, octets identiques, eszip local OK pour les 3 fonctions ; R.2 : bundle de génération avec V2, testé sous Deno depuis un checkout propre (26/26) ; R.3 : `build:release:all` (toutes les fonctions et le web), échecs explicites prouvés, build web isolé OK |
| Runtime | Démarrage à froid | PENDING | Démarrage à froid local de `functions serve` OK ; non vérifié avec un eszip déployé |
| Runtime | Runtime V1 | PASS (local) | M3 27/28 (nettoyage seul), M5 97/97, daily-run V1 |
| Runtime | Runtime V2 interne | PASS (local), PENDING (production) | daily-run V2 HTTP 9/9 ; rollout HTTP 26/26 ; suites guidées sur l'Edge locale |
| Product | Force / DH / Endurance | PASS (local) | UX-11C.2 à C.5 |
| Product | Retour M1 | PASS (local) | Test croisé UX-11C.5 |
| Coaching | Sign-off du contenu | PENDING | `docs/release/COACHING_CONTENT_SIGNOFF.md` : 275 entrées `pending` |
| Operations | Observabilité | PARTIAL | §8 : génération tracée V1/V2 avec raison (R.2) ; aucune alerte |
| Operations | Runbook de retour arrière | PASS (écrit) ; flag répété en local | §10 : retours global et individuel répétés en local ; retour Edge vers `ba59239` toujours UNSUPPORTED après un plan V2 |
| Operations | Runbook de déploiement | PASS (écrit) | §9 : Stage 3 débloqué techniquement (comptes internes seulement) ; Stage 5 non READY |
| Operations | Flag serveur V2 | PASS (local) | §7 : migration 9, résolveur, Edge, sécurité, rejeux, rollback, purge, HTTP 26/26 ; non déployé |
| Operations | Parcours produit de suppression de compte | PENDING (Stage 5) | Backend prêt ; procédure opérateur de purge en production à écrire et répéter ; non bloquant pour le Stage 3 (preflight §18) |
| Security | DELETE direct sur `athletes` | PASS (local) | Révoqué par la migration 10 ; tests 7/7 et purge 5/5 sur trois bases (preflight §17) |
| Operations | Preflight Stage 0 | PRÉPARÉ (local), exécution PENDING | Cible identifiée sans accès distant, commandes Stage 0 à 3, approbations A à D ; gate distant en lecture seule R1 à R8 préparé (preflight §21) ; sauvegarde / PITR : TO VERIFY AT APPROVAL GATE |
| Operations | Merge / push sur `main` | `AUTO_DEPLOY_ON_MAIN = TRUE` : INTERDIT avant le Stage 1 ; étape 2.6 de l'Approbation B, après les Edge Functions | Gate R7 (API Vercel, déploiements GitHub) ; preflight §19, §20 |
| Operations | Gate distant en lecture seule | PASS (2026-10-03) | Historique 50 = `ba59239`, exactement 10 pending ; dérive non matérielle expliquée ; grants et comptages capturés (preflight §24) |
| Database | Stage 1 (10 migrations) | PASS (2026-10-04) | 60/60 appliquées, 0 en attente, dérive après migration = bruit connu, 0 baisse de comptage, smoke V1 ancien code PASS (preflight §25) |
| Operations | Préparation de l'Approbation B | READY (local) | Build propre, eszip local des 3 fonctions, déploiement en bundling Docker, vérification par `functions download` (preflight §26) |
| Operations | Sauvegarde / restauration | LOGICAL PASS, PROVIDER FAIL (risque accepté par écrit le 2026-10-04) | Dump de production restauré dans une pile locale vide : 0 écart de comptage, Auth en données, V1 46/46 ; aucune sauvegarde provider, PITR désactivé. **Approval A : TECHNICALLY READY — EXPLICIT BACKUP RISK ACCEPTANCE REQUIRED** (preflight §24) |

## 12bis. Fragilités connues du harnais local

- `supabase functions serve` peut redémarrer le runtime sur des événements de fichiers parasites au premier chargement (Windows / Docker), ce qui coupe des requêtes en cours (503). Observé encore une fois ; une relance repasse au vert.
- `test:m3:http` et `test:m5:completed-session:http` lancent toujours leur propre `functions serve` et arrêtent le runtime à leur sortie (contrat historique, désormais annoncé). Lancés alors qu'un runtime tourne, ils peuvent entrer en conflit avec lui (502 partout) : les lancer sans runtime actif.
