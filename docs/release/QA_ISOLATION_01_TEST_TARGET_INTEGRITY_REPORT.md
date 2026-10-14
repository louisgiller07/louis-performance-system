# QA-ISOLATION-01 — TEST TARGET INTEGRITY REPORT

**Date** : 2026-10-14 · **Pour** : HPM (via Louis) · **Statut** : local uniquement. Aucun push, merge, déploiement, flag ni écriture distante. Aucune donnée existante modifiée ni nettoyée.

## 1. Verdict
**PASS (local).**
- Les suites qui ignoraient la cible sont identifiées et corrigées : elles prouvent maintenant leur stack avant toute écriture et refusent toute cible inconnue, distante, ambiguë ou différente de celle demandée.
- Les validations P0-SAFE, P0-3, INT-01 (T60, T61), P0-SEC, RPC, Edge, purge et rollback sont rejouées sur une stack neuve et identifiée (`nalynt-qa01`), avec la cible effective imprimée.
- **P0-SEC est compatible avec INT-01 sur la bonne stack**, dans la configuration candidat comme dans la configuration de rollback vers C.

Anomalies résiduelles au §8, aucune bloquante pour ce ticket.

## 2. Audit : suites qui ignoraient l'environnement demandé
| Défaut | Suites | Lignes de code concernées |
|---|---|---|
| **Conteneur psql codé en dur** (`supabase_db_louis-performance-system`) | longitudinal-engine : `patternEvidenceLifecycle`, `patternEvidenceSchema`, `patternEvidenceViews`, `patternInsightReviewLedger`, `reviewAdvisoryLock` | production `92937a9` et branches qui en partent sans correctif : `fix/p0-sec-truncate`, `fix/p1-txt-01-v1-offcamber-copy`, hotfix, p02 à p04. Corrigé dans le candidat (`3dbceb5`) et dans C (`11067a3`) le 13.10, mais avec un repli. |
| **Client rider codé en dur** (`127.0.0.1:54321`) | longitudinal-engine : `patternEvidenceViews`, `patternInsightReviewLedger` ; web : `athleteBootstrapRepo`, `openHealthFlagsRepo`, `planningRepo` | mêmes branches ; corrigé dans C et le candidat (`5b3161a`, `b2f7dfd`) |
| **Repli silencieux sur la stack de développement** quand l'environnement manque | head-coach-engine `testDb` (URL → 54321) ; longitudinal-engine `testDb` (URL → 54321, conteneur → développement) ; 11 suites d'intégration web (URL → 54321) ; 5 orchestrateurs HTTP (URL → 54321) | **toutes les branches, candidat et C compris** |
| **Suites non conditionnées à `RUN_LOCAL_SUPABASE_INTEGRATION`** | les 4 suites `pattern*` de longitudinal-engine : lancées sans environnement, elles exécutent leur SQL sur le conteneur par défaut | toutes les branches |
| **Décalage possible API / psql** | longitudinal-engine : URL et conteneur choisis indépendamment. head-coach-engine : conteneur explicite, mais URL par défaut si `SUPABASE_URL` manque. | toutes les branches |

## 3. Cibles réellement utilisées (preuves)
**Preuve par les données** : chaque test crée des athlètes. Athlètes créés par heure (UTC) le 13.10 :
- `int01` : 14 h, 16 h, 18 h, 19 h, 21 h ;
- `sec` : 20 h, 21 h ;
- stack de développement : **0 après 09:00**.

| Passages | Environnement | Cible effective |
|---|---|---|
| Validations INT-01 et C : head-coach-engine, web, longitudinal-engine, T60, T61, simulations T59 (13.10, 14:20 → 21:30 UTC) | `int_env.ps1` (URL **et** conteneur `int01`) ; harnais du candidat ou de C ; commandes SQL avec `docker exec supabase_db_nalynt-int01` explicite | **`int01`** pour l'API et le SQL. Preuve : athlètes créés sur `int01` aux heures de passage, aucun sur la stack de développement. Ces preuves restent valides. |
| P0-SEC sur `sec`, head-coach-engine (20:52 → 21:07 UTC) | `sec_env.ps1` ; harnais head-coach-engine respectant l'environnement | **`sec`** |
| P0-SEC sur `sec`, longitudinal-engine et web, 1er passage et relance des 4 fichiers (20:55 → 21:14 UTC) | harnais de production codé en dur | **mal ciblé** : API vers `sec`, psql vers la **stack de développement**, client rider vers `54321` (injoignable). Résidus §6. |
| P0-SEC sur `sec`, longitudinal-engine et web relancés (21:15 UTC) | constantes remplacées temporairement par `sec` (commit temporaire annulé) | `sec` |
| Passages longitudinal-engine sans environnement (13.10 : 08:18 `txt01`, 14:09 et 14:30 `int01`, 18:11 `compat-txt`, 19:13 `int01`, 21:28 `sec`) | aucun | SQL des suites `pattern*` sur la **stack de développement**. Jamais utilisés comme preuve (résultats écartés). |
| P0-SAFE (12.10) et P0-2 (13.10 matin) | stack de développement **déclarée** (URL par défaut et conteneur de développement explicite) ; stack `nalynt-p0safe` déclarée (54421 et son conteneur) | cohérent avec la cible déclarée |

**Stack de développement** (lecture seule, rien nettoyé) :
- depuis le redémarrage de son serveur (13.10, 15:27 UTC) : 2 insertions dans `pattern_insight_identities` et 2 dans `pattern_insight_reviews`, **toutes annulées ou refusées** (aucune ligne créée après 08:01 UTC) ;
- le trigger d'injection de panne y a été créé puis supprimé : aucun objet résiduel ;
- les lignes du 13.10 entre 06:00 et 09:00 UTC (844 athlètes, 3 identités `pattern`) viennent de passages qui **déclaraient** cette stack.

**Incident évité (14.10)** : un `supabase start` lancé par erreur avec le `project_id` de la stack de développement. Elle a été trouvée déjà démarrée : statut affiché seulement, aucun redémarrage (même heure de démarrage du serveur), aucune migration (78 inchangées). Corrigé, puis la stack `nalynt-qa01` a été démarrée.

## 4. Correction (`qa/qa-isolation-01`, commit `b1c313a`, depuis le candidat figé `2f3567a` sans le modifier)
**Garde `verifyLocalTestTarget`**, même règle dans les 3 paquets (`tests/supabase/testTarget.ts`, `web/src/test/testTarget.ts`) :
1. `SUPABASE_URL` est obligatoire : **plus de stack par défaut** ;
2. l'URL doit être en boucle locale (`http`) avec un port explicite, sinon refus (distante ou inconnue) ;
3. un seul gateway local `supabase_kong_<projet>` doit publier ce port. Aucun : cible inconnue. Plusieurs : cible ambiguë. Ce gateway nomme le projet réellement derrière l'URL ;
4. `LOCAL_SUPABASE_PROJECT_ID` et `LOCAL_SUPABASE_DB_CONTAINER`, s'ils sont fournis, doivent correspondre à ce projet, sinon refus ;
5. le SQL direct (psql) passe **toujours** par `supabase_db_<projet>` : API et psql ne peuvent plus viser deux stacks ;
6. avant toute écriture, la base répond (`select 1`) et l'API répond (`/auth/v1/health`) ;
7. la ligne `[test-target] project=… api=… db=… — verified` est imprimée une fois par processus.

**Points d'application** :
- head-coach-engine : `createTestClient`, `getAthleteAuthClient`, `localDbContainer` (plus d'auto-détection), les 4 orchestrateurs HTTP ;
- longitudinal-engine : `testSupabaseUrl()` et `testDbContainer()` remplacent les constantes à défaut, dans les 4 suites `pattern*`, `reviewAdvisoryLock` et l'orchestrateur HTTP ;
- web : `integrationApiUrl()` dans les 11 suites d'intégration. Quand l'intégration n'est pas demandée, il renvoie une URL factice jamais contactée, et les suites sont ignorées comme avant.

**Compatibilité** :
- `int_env.ps1`, `sec_env.ps1` et `qa_env.ps1` fonctionnent sans changement ;
- aucune assertion de test produit modifiée ;
- `testDbSafety` documente la suppression du défaut ;
- le module web est exclu du build de production (`tsconfig.build.json`) ;
- `build:release:all` OK ; erreurs TypeScript web identiques au candidat.

**Changement voulu** : lancées sans cible, les suites `pattern*` échouent clairement au lieu d'écrire sur la stack de développement. C'est déjà le cas des autres suites longitudinal-engine sans clé.

**Tests de la garde** (docker simulé) : head-coach-engine 17, longitudinal-engine 17, web 20, avec `testDbSafety` (34 au total dans head-coach-engine).

**Refus prouvés sur les vraies stacks**, avec un vrai test d'écriture (`p0SecTruncate`) :

| Cible | Résultat | Écritures |
|---|---|---|
| pas de `SUPABASE_URL` | `TestTargetError` « SUPABASE_URL is not set » | aucune |
| `127.0.0.1:54321` (stack de développement sans port publié) | « No running local Supabase gateway publishes port 54321 » | aucune |
| URL `qa01` et conteneur `int01` (décalage) | « reaches project nalynt-qa01 …, not the requested LOCAL_SUPABASE_DB_CONTAINER » | aucune |
| URL `qa01` et projet `nalynt-sec` | « not the requested LOCAL_SUPABASE_PROJECT_ID » | aucune |
| URL de production | refus « not local » (garde existante) | aucune |

Nombre d'athlètes inchangé sur les 4 stacks ; code de sortie 1 (`FAIL`).

## 5. Rejeu sur une stack neuve et identifiée
**Stack** : `nalynt-qa01` (ports 550xx), démarrée depuis `qa/qa-isolation-01-p0sec-replay` (`637aa63` = `b1c313a` + P0-SEC choisi depuis `fix/p0-sec-truncate`).
- **72 migrations dans l'ordre réel** : 66 de production, 5 d'INT-01, puis `20261014090000`.
- Edge du candidat servie depuis ce worktree.
- Cible effective imprimée à chaque passage : `[test-target] project=nalynt-qa01 api=http://127.0.0.1:55021 (gateway supabase_kong_nalynt-qa01 publishes 55021) db=supabase_db_nalynt-qa01 — verified`.

| Validation | Suites | Résultat |
|---|---|---|
| P0-SAFE | `p0SafeHealthContinuity` (unitaire et intégration), `p0SafeHealthEdge` ; web `openHealthFlagsRepo` | vert |
| P0-3 et garde santé | `p0_3HealthSuspendedExecution`, `p0_3KeptDayRerun`, `p0_3ManualSessions`, `p0_3PersistContract`, `p0_3PlannedSessionLock`, `p0_3Repro` ; web `p0_3HealthSuspension` | vert |
| INT-01 T60 / T61 | `int01DebriefHealthGuard` (7 scénarios) ; web `a11AfterSession` | vert |
| P0-SEC | `p0SecTruncate` **24/24**, `athletesDeleteGrant` | vert |
| RPC, Edge, purge | `athletePurge`, `sessionExecution`, `ux11r9Edge`, `ux11r9Hardening`, `ux11r9WriteSuspension`, `f6cStrengthCompletion` ; web `guidedSession`, `guidedSessionCrossFamily` | vert |
| **Totaux** | head-coach-engine **191/191** (`ux11r9Edge` relancé seul après un délai de 5 s dépassé au démarrage à froid de l'Edge : 3/3) ; web **42/42** ; longitudinal-engine (`pattern*`, garde) **136/136** | PASS |
| **Rollback vers C** (Edge C sur `qa01` ; `completed-session` et `session-execution` du candidat ; SQL P0-3, INT-01 et P0-SEC conservés) | `int01DebriefHealthGuard`, `p0_3HealthSuspendedExecution`, `p0SafeHealthEdge`, `p0SecTruncate`, `athletePurge` | **44/44**, 0 erreur Edge. Worktree C restauré à l'identique (`51e8a9d`). |
| **Rollback P0-SEC** | empreinte complète des droits | après rollback : identique à l'état d'avant P0-SEC, et `anon` peut de nouveau vider `weekly_availability`. Ré-application : identique, `permission denied`. |

**Non rejoués, car la preuve de ciblage existe déjà** :
- suites complètes du candidat et de C passées avec `int_env.ps1` (§3) ;
- tests unitaires et différentiel de T59 (purs, sans stack) ;
- simulations T59 (commandes avec `int01` explicite).

## 6. `patternEvidenceSchema` : cause de l'échec (indépendante de P0-SEC)
- Test « a forced failure on the REAL persist_pattern_evidence … rolls back », ligne 588 : il attend 0 référence de provenance au rôle marqueur et en trouve 2.
- **Cause : le décalage API / psql du harnais de production.**
  - Lors des deux passages mal ciblés sur `sec` (21:05:43 et 21:13:37 UTC), le trigger de panne a été posé par psql sur la **stack de développement**, alors que le RPC partait vers `sec`.
  - Sans panne, le RPC a réussi : 2 identités, 2 révisions et 2 références de provenance sur `sec`, en ajout seul, avec un rôle marqueur constant. Le test échouera donc toujours sur `sec`.
- **Contre-preuves** : le même test passe sur `int01` (harnais du candidat) et sur `qa01` (stack neuve). Sur `sec`, il échoue même avec le harnais du candidat, à cause des données.
- Aucun défaut de schéma ni de fonction. **Aucun correctif à apporter au test**, seulement au ciblage (fait). Données de `sec` conservées.

## 7. Préparation de l'intégration de P0-SEC (rien n'est intégré)
- **Nom et ordre** : `20261014090000` vient après `20261013190000`, sans collision. Prouvé par l'application des 72 migrations sur `qa01`.
- **Privilèges par défaut** (prouvé sur `qa01`) :
  - une table créée par `postgres` n'accorde plus TRUNCATE ;
  - une table créée par `supabase_admin` l'accorde encore (résidu) ;
  - `postgres` ne peut pas modifier les privilèges par défaut de `supabase_admin` (« permission denied ») ;
  - les 39 tables `public` appartiennent à `postgres`, qui exécute les migrations.
- **Le rollback n'est pas banal** : il ré-accorde une permission dangereuse. Avertissement ajouté en tête du script (`fix/p0-sec-truncate` `dc23166`).
- **`service_role`, TRIGGER, REFERENCES** : risques et dépendances documentés dans le rapport P0-SEC §8, sans modification. **Nouveau constat** : TRIGGER de `anon` / `authenticated` est un risque réel au niveau de la base, de la même classe que TRUNCATE (création d'un trigger prouvée dans une transaction annulée), mais inaccessible par l'API. Recommandation : le traiter comme TRUNCATE, sur décision HPM.
- **Documents gouvernés** : ajouts à `docs/05` et T62 préparés sur `docs/p0-sec-truncate-canon` (`02bc77c`), non reportés dans les branches figées.

## 8. Anomalies résiduelles
1. **Branches issues directement de la production** (`fix/p0-sec-truncate`, `fix/p1-txt-01-v1-offcamber-copy`, hotfix, p02 à p04) : elles gardent l'ancien harnais tant que la garde n'y est pas intégrée. Les preuves longitudinal-engine et web de P0-SEC sur `sec` sont remplacées par le rejeu sur `qa01`.
2. **Résidus sur `sec`** : 6 lignes en ajout seul, conservées. `sec` est une stack jetable, à supprimer sur décision.
3. **Limite de la garde** : l'identité API ↔ base repose sur la convention de nommage de la CLI Supabase locale (`supabase_kong_<id>` et `supabase_db_<id>` dans le même réseau), plus une réponse effective des deux. Ce n'est pas une preuve cryptographique.
4. **Hors périmètre** : `scripts/release/prod-readonly-gate.mjs` utilise le conteneur de développement comme **client** psql vers la production en lecture seule. Ce n'est pas une cible de test d'écriture, mais c'est à revoir si ce conteneur change.
5. **Correction de rapport** : mon rapport P0-SEC §5 affirmait à tort que les passages sur `int01` visaient la stack de développement (corrigé, addendum §8). Les rapports INT-01 et C restent valides.
6. **Intégration de la garde** dans REL-01, C et la production : décision HPM.

## 9. Branches et stacks
| Élément | Référence | État |
|---|---|---|
| Candidat figé | `2f3567a`, tag `int-01-ready-integration` | inchangé |
| Préparation REL-01 | `int/int-01-release-prep` `249c415` | inchangé |
| C | `int/int-01-compat` `51e8a9d` | inchangé, worktree restauré |
| Correctif QA | `qa/qa-isolation-01` | `b1c313a`, plus ce rapport |
| Rejeu (jetable) | `qa/qa-isolation-01-p0sec-replay` `637aa63` | P0-SEC choisi pour le rejeu seulement |
| P0-SEC | `fix/p0-sec-truncate` `caf16a6` | addendum et avertissement de rollback |
| Documents canoniques proposés | `docs/p0-sec-truncate-canon` `02bc77c` | en attente de validation HPM |
| Stacks locales | `nalynt-qa01` (rejeu), `nalynt-sec`, `nalynt-int01`, stack de développement | démarrées ; aucune donnée nettoyée |
