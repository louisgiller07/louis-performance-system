# UX-11R.1 — Release candidate & rollout hardening

> Rien n'est déployé. Ce document prépare un déploiement futur : il ne l'autorise pas. Toute action distante (backup, `db push`, déploiement Edge, activation V2) reste une décision humaine explicite, étape par étape.

## 1. Référence

| Élément | Valeur |
|---|---|
| Base production | `ba59239` (`main` / `origin/main`) |
| Entrée fonctionnelle du RC | `7bdd9d8` (`feat/ux11c5-closure`, UX-11C core complete locally) |
| Durcissement | branche `feat/ux11r1-rollout-hardening`, commits de UX-11R.1 au-dessus de `7bdd9d8` |
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

## 3. Migrations non poussées (ordre de déploiement)

1. `20260930120000_ux11b2_execution_schema`
2. `20260930120500_ux11b2_record_session_execution`
3. `20260930130000_ux11a5a2b_dh_technical_tier`
4. `20261001090000_ux11b23_pass_measure_contract`
5. `20261001120000_ux11a5c2_v2_daily_persistence`
6. `20261001140000_ux11b25_session_activity_results`
7. `20261002090000_ux11b26_execution_result_integrity`
8. `20261002120000_ux11r1_athlete_account_purge` (UX-11R.1)

**Toutes additives pour le V1 :**
- colonnes nullables seulement : `athlete_performance_profiles.dh_technical_tier`, colonnes de statut V2 de `decisions` ;
- contraintes CHECK qui acceptent NULL ;
- nouvelles tables d'exécution ;
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

**Identité Auth.** `athletes.user_id` cascade depuis `auth.users`. L'ordre est donc : purge applicative, **puis** `auth.admin.deleteUser` (helper serveur `purgeAthleteAccount`). Si l'Auth échoue après la purge, il suffit de relancer la suppression Auth.

**Tests** (pile de développement, base vierge et base type production) :
- athlète complet purgé ;
- témoin strictement identique ;
- identité Auth supprimée ;
- appel par un rider refusé ;
- marqueur forgé refusé ;
- échec provoqué au dernier pas → aucune suppression.

**Hors périmètre.** L'appel produit (écran « supprimer mon compte », Edge dédiée, confirmation) n'existe pas : seul le contrat serveur est prêt.

**Observation, non modifiée.** Les rôles `authenticated` et `anon` ont un GRANT DELETE sur `athletes` (filtré par RLS « own data »). Un rider sans plan pourrait donc supprimer sa ligne et cascader une partie de ses données, sans passer par la purge. À trancher.

## 6. Déployabilité Edge (sans déploiement)

**Commande de release** (depuis un checkout propre, sans aucun `dist`) : `cd head-coach-engine && npm ci && npm run build:release`.
- Elle construit `planning-engine`, puis `prescription-engine` (qui dépend du premier), puis `head-coach-engine/dist` et les bundles Edge.
- `npm ci` est aussi requis dans `planning-engine` et `prescription-engine`.
- Vérifié sur un worktree propre : sortie 0, artefacts **identiques octet pour octet** au build de développement.
- Le graphe d'imports des 3 fonctions ne contient aucun fichier manquant ni hors de `supabase/functions` et `head-coach-engine/dist`.

| Fonction | Entrée / imports | RPC / tables | V1 / V2 | Bundling local eszip (image edge-runtime v1.74.3, sans envoi) |
|---|---|---|---|---|
| `generate-training-plan` | `index.ts` → `dist/edge/generateTrainingPlan.bundle.js`, `dist/supabase/observability/pilotEvents.js`, `@supabase/server@1.4.1` | RPC de persistance du plan (V1), `pilot_observability_events` | **V1 uniquement**. Corps limité à `generationRequestId` et `durationWeeks` (clés inconnues refusées) : un client ne peut pas demander V2. | OK (code 0) |
| `daily-run` | `index.ts` → 73 fichiers `dist/supabase/**`, `import()` paresseux de `dist/edge/dailyRunV2.bundle.js` | `persist_daily_run` (V1), `persist_daily_run_v2`, lectures plan / décisions | Suit les données : plan V2 courant → chemin V2, sinon V1 | OK (code 0), bundle V2 **inclus** |
| `session-execution` | `index.ts`, `validation.ts`, `@supabase/server` | `record_session_execution` (migrations 1, 2, 4, 5, 6, 7) | Uniquement pour une prescription du jour V2 | OK (code 0) |

- Variables d'environnement : uniquement celles injectées par Supabase (`SUPABASE_URL`, clés publishable et secret) via `withSupabase` ; aucune variable propre au projet.
- Hygiène, non bloquante : `runDailyFor.js` garde, pour Node, un `import()` paresseux de `reconcileFinalPrescriptionV2.js`, qui contient le spécificateur nu `planning-engine/session-model-v2/daily`. Le bundler le signale « non mappé » sans échouer, et `daily-run` ne l'exécute jamais (il injecte le bundle).

## 7. Activation V2 côté serveur

**Seam existant.**
- `generateAndPersistTrainingPlanV2` exige `planningModel: "v2"`, une option serveur.
- L'Edge publique n'appelle que `generateAndPersistTrainingPlan` (V1) et refuse toute clé inconnue : aucune auto-activation par le client.
- `daily-run` et `session-execution` suivent les données (plan V2, prescription du jour V2) : **le seul point d'activation est la génération du plan.**

**Mécanisme de flag.** Aucun n'existe : pas de table d'allowlist ni de cohorte. `VITE_SIMULATION_ATHLETE_ID` n'est qu'une garde d'interface.

**Contrat minimal proposé (non implémenté, ticket suivant) :**
- table serveur `athlete_planning_model_assignments (athlete_id PK, planning_model 'v2', assigned_by, assigned_at, note)`, lisible par `service_role` seulement ;
- interrupteur global Edge `NALYNT_V2_GENERATION_ENABLED` (absent = désactivé) ;
- `generate-training-plan` choisit V2 seulement si l'interrupteur est actif **et** l'athlète est assigné ;
- défaut V1 ; **aucun repli automatique** (un échec V2 reste un échec, jamais un plan V1 silencieux) ;
- inclure `generateAndPersistTrainingPlanV2` dans le bundle de génération ;
- tracer le modèle dans `plan_generation_succeeded` (métadonnée).

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

**Trous restants :**
- la génération ne trace pas le modèle V1/V2 (ce sera le cas avec le flag) ;
- aucun événement serveur ne compte les refus `session-execution` en base (seulement dans les logs Edge, durée de conservation à vérifier) ;
- aucune alerte n'est configurée.

## 9. Runbook de déploiement (à exécuter par un humain, étape par étape)

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
- Déployer `daily-run`, `generate-training-plan` (toujours V1), `session-execution` (déployée mais sans prescription V2 à servir) et le web (l'entrée « séance guidée » n'apparaît que pour une prescription V2 `created`).
- Smoke V1 complet.
- *Justification* : aucun plan V2 ne peut être créé, donc tous les chemins V2 restent inertes. Le web reste fail-closed.

**Stage 3 — interne**
- **Prérequis non disponible** : le flag serveur (§7).
- Assigner V2 au seul compte de test `41f21027-…`, puis activer l'interrupteur.
- Jusqu'au flag, ce stage est **BLOQUÉ**. Ne pas contourner par une génération V2 manuelle en production.

**Stage 4 — observation** (au moins une semaine de séances réelles sur le compte interne). Critères :
- génération V2 sans échec ;
- Daily V2 : `created` / `not_required` / `blocked` cohérents ;
- séances Force, DH et endurance complétées ;
- retour M1 visible au Daily suivant ;
- 0 erreur 5xx ;
- refus `session-execution` limités aux codes attendus.

**Stage 5 — déploiement contrôlé**
- Seulement après le sign-off coaching (§10) et des critères techniques verts.
- Élargissement athlète par athlète par assignation, réversible.

## 10. Stratégie de retour arrière

- **Retour arrière principal : V2 désactivé (flag) et code conservé.**
  - Les nouvelles générations repassent en V1.
  - Les données V2 sont **conservées** (append-only) ; rien n'est supprimé.
  - Les lecteurs restent fail-closed : version non prise en charge → pas de rendu partiel.
- **Athlète ayant déjà un plan V2 courant :**
  - Daily suit les données et reste en V2 tant que ce plan est courant.
  - Pour sortir un athlète du V2 : générer et accepter un plan **V1** pour lui. C'est une action serveur, qui suppose le flag en place.
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
| Ancien code + nouveau schéma | SUPPORTED | Répétition : Daily V1, génération, acceptation par le code de `ba59239` sur le schéma migré ; 0 ligne V1 modifiée |
| Nouveau code + ancien schéma | UNSUPPORTED | Le nouveau code lit les nouvelles colonnes et RPC (statut V2 des décisions, `persist_daily_run_v2`, `record_session_execution`). Le schéma doit passer d'abord. |
| Nouveau code + nouveau schéma + V2 désactivé | SUPPORTED | Suite RC sur la base migrée ; Daily RC sur l'athlète V1 historique (chemin V1) ; HTTP V1 M3 27/28 (le seul échec est le nettoyage, §5, résolu par la purge) ; M5 97/97 ; daily-run « pas de plan → V1 » |
| Nouveau code + nouveau schéma + V2 interne | SUPPORTED en local, PENDING en production | UX-11C core local (Force, DH, endurance, M1), daily-run V2 HTTP 9/9 sous Deno. Le flag de production manque (§7). |
| Plans V1 historiques | SUPPORTED | Intacts après migration ; chemin V1 |
| Plans V2 existants après V2 désactivé (nouveau code) | SUPPORTED | Daily et séances guidées continuent ; seule la génération est coupée |
| Plans V2 existants + ancien code (retour Edge ou web) | UNSUPPORTED | Répétition : l'ancien daily-run sert le document V2 comme V1 |

## 12. Release gates

| Domaine | Gate | Statut | Preuve |
|---|---|---|---|
| Database | Répétition sur base vierge | PASS | §4 : 58/58, suite 1098/1098 |
| Database | Upgrade type production | PASS | §4 : 0 ligne V1 modifiée ; ancien et nouveau code OK |
| Database | V1 après migrations | PASS | §4 et §11 |
| Database | Purge | PASS (contrat serveur) | §5 : 5/5 sur trois bases. **Le parcours produit de suppression de compte n'existe pas** (PENDING). |
| Runtime | Build Edge propre | PASS | §6 : checkout propre, octets identiques, eszip local OK pour les 3 fonctions |
| Runtime | Démarrage à froid | PENDING | Démarrage à froid local de `functions serve` OK ; non vérifié avec un eszip déployé |
| Runtime | Runtime V1 | PASS (local) | M3 27/28 (nettoyage seul), M5 97/97, daily-run V1 |
| Runtime | Runtime V2 interne | PASS (local), PENDING (production) | daily-run V2 HTTP 9/9 ; suites guidées sur l'Edge locale |
| Product | Force / DH / Endurance | PASS (local) | UX-11C.2 à C.5 |
| Product | Retour M1 | PASS (local) | Test croisé UX-11C.5 |
| Coaching | Sign-off du contenu | PENDING | `docs/release/COACHING_CONTENT_SIGNOFF.md` : 275 entrées `pending` |
| Operations | Observabilité | PARTIAL | §8 : ajouts en place ; génération V1/V2 non tracée, aucune alerte |
| Operations | Runbook de retour arrière | PASS (écrit), non répété | §10 |
| Operations | Runbook de déploiement | PASS (écrit), Stage 3 bloqué | §9 : le flag manque |
| Operations | Flag serveur V2 | PENDING | §7 : contrat proposé, non implémenté |

## 12bis. Fragilités connues du harnais local

- `supabase functions serve` peut redémarrer le runtime sur des événements de fichiers parasites au premier chargement (Windows / Docker), ce qui coupe des requêtes en cours (503). Observé encore une fois ; une relance repasse au vert.
- `test:m3:http` et `test:m5:completed-session:http` lancent toujours leur propre `functions serve` et arrêtent le runtime à leur sortie (contrat historique, désormais annoncé). Lancés alors qu'un runtime tourne, ils peuvent entrer en conflit avec lui (502 partout) : les lancer sans runtime actif.
