# REL-01 — FINAL SECURITY REVIEW REPORT

**Date** : 2026-10-14 · **Pour** : HPM (via Louis) · **Statut** : local uniquement. Aucun push, merge, déploiement, SQL distant ni flag. Le candidat `2f3567a` (et son tag), C, la préparation REL-01 et les branches historiques sont inchangés.

## 1. Synthèse
| Sujet | Verdict |
|---|---|
| Assemblage REL-01 (INT-01, P0-SEC-TRUNCATE, P0-SEC-TRIGGER, harnais QA-ISOLATION-01, docs) | **READY LOCAL** : 73 migrations, suites complètes vertes sur une stack neuve vérifiée, configuration de rollback vers C verte |
| MAINTAIN (PostgreSQL 17) | **risque concret** (disponibilité) : correction minimale **prête en local**, non intégrée (`fix/p0-sec-maintain`), sur GO HPM après vérification de la version de production |
| EXECUTE des fonctions déclencheuses | **risque accepté, aucun changement** : inutilisable (aucune fonction déclencheuse appelable, aucune exposée en RPC, création de trigger déjà interdite) |
| REFERENCES | **risque accepté, aucun changement** : inutilisable (aucun CREATE sur un schéma ; une table temporaire ne peut pas référencer une table permanente) |
| Fiabilité en parallèle | aucun échec sur l'assemblage (3 passages complets) ; instabilité potentielle documentée (§5) |

## 2. MAINTAIN
- **Version testée** : PostgreSQL **17.6** (`server_version_num` 170006) sur toutes les stacks locales. MAINTAIN n'existe qu'à partir de 17.
- **Version de production** : inconnue. À relever en lecture seule avec `docs/review/REL_01_PG_VERSION_AND_SENSITIVE_PRIVILEGES.sql` : un seul `SELECT`, compatible PostgreSQL 15 à 17, qui donne aussi l'état de TRUNCATE, TRIGGER, MAINTAIN et REFERENCES, les privilèges par défaut et les propriétaires. Testé en lecture seule sur `int01` (état type production) et sur `rel01` (état après REL-01).

**Audit** (schéma production + INT-01 + TRUNCATE + TRIGGER) :

| Point | Constat |
|---|---|
| `anon` | MAINTAIN sur les 9 tables de la baseline |
| `authenticated` | MAINTAIN sur 12 : les 9, plus **`completed_sessions`, `decisions`, `health_flags`**, où son seul autre droit est SELECT |
| `PUBLIC`, héritage | aucun ; `pg_maintain` sans membre ; rôles d'API `NOLOGIN`, `authenticator` sans héritage |
| Privilèges par défaut | `postgres` et `supabase_admin` accordent MAINTAIN à `anon` et `authenticated` sur les nouvelles tables |
| Propriétaires | 39 tables, toutes `postgres` |
| Dépendances légitimes | **aucune** : aucune fonction, migration, Edge, purge ni code applicatif n'utilise VACUUM, ANALYZE, REINDEX, CLUSTER ou LOCK sous ces rôles (autovacuum en superutilisateur, migrations en `postgres`) |
| Exploitabilité réelle (local, sessions brèves, petites tables, aucune autre stack touchée) | `anon` : `REINDEX` et `VACUUM FULL` sur `goals` réussissent. `authenticated` : `LOCK TABLE decisions IN ACCESS EXCLUSIVE MODE` réussit (transaction annulée), alors que SELECT seul ne permet qu'un verrou partagé. Impact : disponibilité (verrous exclusifs, réécritures), pas de perte de données. Chemin : SQL direct sous ces rôles, pas l'API. |

**Proposition P0-SEC-MAINTAIN** (`fix/p0-sec-maintain` `a39e7bf`, depuis la production ; **non intégrée**) :
- migration `20261014150000` protégée par la version : sans effet sur PostgreSQL inférieur à 17 ;
- `revoke maintain` pour `anon` (9 tables) et `authenticated` (12 tables), et retrait des privilèges par défaut de `postgres` ;
- vérification *fail closed* ;
- inchangés : `service_role`, REFERENCES, droits régis par RLS ;
- rollback exact et explicitement dangereux.

**Preuves** (branche de rejeu `qa/p0-sec-maintain-replay`, stack `nalynt-qa01` à 74 migrations, harnais QA-ISOLATION-01, cible vérifiée) :
- contre-preuve : 26 échecs sur 29 sans la migration ;
- avec la migration :
  - **29/29**, dont 21 `REINDEX` refusés et 3 verrous exclusifs refusés pour `authenticated` ;
  - nouvelle table sans MAINTAIN ;
  - écritures du rider et purge intactes ;
- non-régression 121/121 (P0-SEC-TRUNCATE, P0-SEC-TRIGGER, P0-SAFE, P0-3, INT-01, purge, séances) et web 18/18 ;
- 62 triggers identiques ;
- 26 lignes d'ACL changent (droit `m` seul) ;
- fail closed prouvé ;
- rollback : verrou exclusif de nouveau possible (dangereux) ; ré-application identique.

**Résidu documenté et inhérent** : un rôle qui détient UPDATE ou DELETE (`anon` sur les 9 tables de la baseline) garde la possibilité de `LOCK TABLE` en mode fort. Ce droit est indissociable des écritures RLS ; il est vérifié et affirmé par le test.

**Recommandation** :
- relever d'abord la version de production ;
- si elle est 17 ou plus, intégrer P0-SEC-MAINTAIN comme **8e migration**, sur GO HPM ; en dessous de 17, il n'y a aucune exposition aujourd'hui ;
- après toute montée de version majeure, relancer le script d'inventaire.

Ce n'est **pas bloquant pour la release technique** (même exposition que TRUNCATE et TRIGGER avant correction : SQL direct sous un rôle d'API, et un impact sur la disponibilité seulement). C'est **recommandé avant un pilote externe**.

## 3. Fonctions déclencheuses (EXECUTE) et REFERENCES
- **Fonctions déclencheuses** (10 dans `public`) :
  - 9 sont INVOKER et exécutables par `anon` et `authenticated` ; 1 est DEFINER (`enforce_planned_session_day_lock`, verrou du jour P0-3) et **n'est exécutable par aucun rôle d'API** ;
  - un appel direct donne « trigger functions can only be called as triggers » ; PostgREST `/rpc/reject_append_only_mutation` répond 404 (PGRST202) ;
  - EXECUTE n'est vérifié qu'à la création d'un trigger, que P0-SEC-TRIGGER interdit déjà à ces rôles. Retirer EXECUTE n'apporterait rien de démontrable.
- **Aucune fonction `SECURITY DEFINER`** de `public` n'est exécutable par `anon` ou `authenticated` : pas de surface RPC privilégiée.
- **REFERENCES** (`anon` et `authenticated`, 9 tables) : `anon` et `authenticated` n'ont CREATE sur aucun schéma. Ils ont TEMP, mais `create temp table … references public.athletes` donne « constraints on temporary tables may reference only temporary tables » (prouvé). Ce droit est inutilisable.
- **Décision proposée** : accepter ces deux points en l'état, sans aucun retrait de droit (aucune inutilité démontrable de leur retrait, aucun risque exploitable).

## 4. Worktree d'assemblage
**Branche** `rel/rel-01-assembly` (worktree `C:\nx\asm`), depuis `2f3567a` sans le modifier. Commits, dans l'ordre :

| Commit | Contenu |
|---|---|
| `d3dc04a` | harnais QA-ISOLATION-01 |
| `d3cc781` | rapport, ADR et backlog QA-ISOLATION-01 |
| `37205fc` | P0-SEC-TRUNCATE (migration `20261014090000`, rollback, tests) |
| `bcd1b9f`, `ad2bb49`, `fd5bc19` | documentation P0-SEC-TRUNCATE (rapport, addendum, TRIGGER) |
| `155d448` | rapport P0-SEC-TRIGGER, ADR, preuves `nalynt-sec` |
| `9dce54e` | `docs/05` et T62 (P0-SEC-TRUNCATE) |
| `111130e` | P0-SEC-TRIGGER (migration `20261014120000`, rollback, tests). Ajustements de tests : `athletesDeleteGrant` sans TRUNCATE ni TRIGGER ; `p0SecTruncate` « TRIGGER aucun ». |
| `8b53df4` | `docs/05`, contrainte P0-SEC-TRIGGER, et T63 |
| ce commit | rapport final, script de version et de droits, backlog, statut |

- Conflits rencontrés : seulement dans `docs/10`, `docs/11` et `docs/12`, résolus par union, et dans `athletesDeleteGrant` (combinaison des deux révocations).
- Le code est identique à la branche de rejeu testée (`673eb54`), à un commentaire d'avertissement près dans le rollback TRUNCATE.
- **Inventaire Edge identique au candidat** : `completed-session` `b1b067cf`, `daily-run` `e00f0011`, `generate-training-plan` `dbccafa4`, `session-execution` `aebd17b1`. Seuls le SQL, les tests, le harnais et la documentation changent.
- **Migrations : 73 attendues avant tout nouveau correctif, 73 constatées** : 66 de production, 5 d'INT-01, `20261014090000`, `20261014120000`. P0-SEC-MAINTAIN en ferait 74.

## 5. Tests et preuves de ciblage (stack neuve `nalynt-rel01`, 73 migrations, Edge de l'assemblage)
Chaque exécution a imprimé exclusivement `[test-target] project=nalynt-rel01 api=http://127.0.0.1:55121 … db=supabase_db_nalynt-rel01 — verified` (65 lignes dans head-coach-engine par passage, 23 dans web, 17 dans longitudinal-engine).

| Suite | Parallèle | Séquentiel |
|---|---|---|
| head-coach-engine **complète** (141 fichiers, base et Edge) | **1426/1426**, puis **1426/1426** au 2e passage | **1426/1426** |
| web complète (intégrations comprises) | **2268/2268** | — |
| longitudinal-engine complète | **890/890** | — |
| planning-engine, prescription-engine | 883/883, 96/96 | — |
| Rollback vers C (Edge C sur `rel01` ; `completed-session` et `session-execution` du candidat ; SQL conservé) | — | **105/105** (P0-SEC-TRIGGER, P0-SEC-TRUNCATE, `athletesDeleteGrant`, INT-01, P0-3, P0-SAFE, purge, séances), 0 erreur Edge. Worktree C restauré à l'identique. |

`build:release:all` OK.

**Fiabilité en parallèle, distinguée de la réussite séquentielle** :
- Sur l'assemblage : 0 échec sur 2 passages parallèles complets. Les Edge étaient préchauffées et aucune autre suite ne tournait.
- Sur les stacks de rejeu, sous charge (plusieurs stacks et suites simultanées), des échecs ont été observés en parallèle, tous verts en séquentiel :
  - `ux11r9Edge` : délai de 5 s dépassé au premier appel de l'Edge (démarrage à froid), deux fois ;
  - `p0_3PlannedSessionLock` : test de concurrence chronométré (« the other connection ended first »), une fois ;
  - 16 délais de 5 s sur `sec` lors d'un passage très chargé.
- **Ce sont des instabilités potentielles du harnais**, liées à la charge et au démarrage à froid. Aucun échec déterministe n'a été observé.
- Recommandation, sans nouveau chantier : préchauffer l'Edge et ne pas lancer plusieurs suites lourdes en même temps pour toute preuve de release. Ces deux tests restent signalés.

## 6. Risques résiduels (classés selon l'exposition réelle)
| Risque | Exposition | Classement |
|---|---|---|
| MAINTAIN de `anon` / `authenticated` | SQL direct sous un rôle d'API ; disponibilité | **moyen** : correction prête (P0-SEC-MAINTAIN), GO HPM après relevé de version |
| LOCK fort via UPDATE / DELETE (9 tables) | idem ; inhérent aux écritures RLS | faible, accepté |
| Privilèges par défaut de `supabase_admin` (TRUNCATE, TRIGGER, MAINTAIN) | seulement pour une table `public` créée par `supabase_admin` ; aucune aujourd'hui | faible : détecté par les tests et le script ; correction impossible sans accès administrateur de la plateforme |
| TRIGGER, MAINTAIN, REFERENCES et TRUNCATE de `service_role` | clé serveur ; contourne déjà RLS | accepté |
| EXECUTE des fonctions déclencheuses, REFERENCES | inutilisables (§3) | accepté |
| Fiabilité parallèle sous charge (§5) | harnais seulement | faible, documenté |
| Branches historiques (production, P1-TXT-01, C) sans harnais QA-ISOLATION-01 | preuves de ces branches à refaire sur l'assemblage ou après intégration | plan au rapport P0-SEC-TRIGGER §6 |

## 7. Recommandations
1. **GO (sécurité) sur l'assemblage REL-01** (73 migrations) comme candidat technique de sécurité pour la suite du runbook REL-01. **Aucun GO de déploiement** : les gates REL-01 restent ouverts (T+48 et preuve Edge P0-SAFE, vérification de la production en service, reconstruction sur cette production avec P1-TXT-01 si livré, inventaires de production).
2. **Relevé de la version PostgreSQL de production**, par Louis, avec le nouveau script, avant toute décision MAINTAIN. Ensuite, GO HPM ou non pour P0-SEC-MAINTAIN en 8e migration.
3. **EXECUTE et REFERENCES** : accepter, sans changement.
4. **Clore le hardening sécurité** : aucun autre risque significatif démontré. Reprendre le produit et la validation sportive V2.

**Verdict : REL-01 sécurité READY LOCAL. P0-SEC-MAINTAIN READY LOCAL (proposition). Déploiement BLOCKED par les gates REL-01 existants.**
