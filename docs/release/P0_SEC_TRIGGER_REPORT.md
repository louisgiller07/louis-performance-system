# P0-SEC-TRIGGER — SECURITY HARDENING REPORT

**Date** : 2026-10-14 · **Pour** : HPM (via Louis) · **Statut** : **READY LOCAL / NOT DEPLOYED**. Aucun push, merge, déploiement, migration de production ni flag. Rien n'est intégré au candidat figé ni à REL-01.

**Branches** :
- `fix/p0-sec-trigger`, depuis la production `92937a9`, indépendante de P0-SEC-TRUNCATE ;
- rejeu jetable `qa/p0-sec-trigger-replay` = harnais QA-ISOLATION-01 + P0-SEC-TRUNCATE + P0-SEC-TRIGGER, dans l'ordre REL-01 proposé.

**Stack** : `nalynt-qa01`, isolée et vérifiée par le harnais (`[test-target] project=nalynt-qa01 … — verified`). Elle porte les 66 migrations de production, les 5 d'INT-01, puis `20261014090000` (TRUNCATE) et `20261014120000` (TRIGGER) : **73 migrations dans l'ordre réel**. Comptes et données fictifs.

## 1. Audit (schéma de production + INT-01 + TRUNCATE)
| Point | Avant | Après |
|---|---|---|
| TRIGGER `anon` / `authenticated` (tables `public`) | 9 / 9 : `athlete_baselines`, `athlete_state`, `athletes`, `daily_checkins`, `goals`, `planned_sessions`, `race_calendar`, `training_blocks`, `weekly_availability` (ACL directes accordées par `postgres`) | **0 / 0** |
| TRIGGER `PUBLIC` | 0 | 0 |
| TRIGGER `service_role` | 10 tables | 10, inchangé |
| Privilèges par défaut `postgres` → `anon` / `authenticated` (nouvelles tables) | `DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,UPDATE` | `DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,UPDATE` |
| Privilèges par défaut `supabase_admin` → `anon` / `authenticated` | TRIGGER (et TRUNCATE) | **inchangés, modification impossible** (voir §4) |
| Propriétaires | les 39 tables : `postgres` (qui exécute les migrations) | idem |
| Droits hérités | `anon`, `authenticated` et `service_role` sont `NOLOGIN`. `authenticator` en est membre sans héritage (bascule de rôle de PostgREST). `postgres` en est membre (administration). | idem |
| Création réelle d'un trigger | `set role anon; create trigger … on public.goals … execute function public.reject_append_only_mutation()` → **CREATE TRIGGER** (transaction annulée). Fonctions déclencheuses exécutables par `anon` : `set_updated_at`, `reject_append_only_mutation`, etc. | **permission denied for table goals** |
| Triggers applicatifs existants | 62 (61 avec des fonctions INVOKER ; le verrou du jour P0-3 en DEFINER) | **62, empreinte identique** (nom, table, fonction, état, type) |

`NOLOGIN` et l'absence de chemin API connu ne sont pas retenus comme preuve d'innocuité : la création est possible dès qu'une session agit sous ces rôles.

**Dépendances légitimes** : aucune.
- Les migrations créent les triggers en tant que `postgres` ; le harnais de test pose son trigger de panne en `postgres`.
- RPC, Edge, purge, séances et santé ne créent jamais de trigger.
- Le droit TRIGGER n'est vérifié qu'à la **création** : la révocation n'affecte pas les triggers installés (prouvé).

## 2. Correction : migration `20261014120000_p0_sec_trigger_api_roles.sql`
- `revoke trigger` sur les 9 tables pour `anon` et `authenticated` ;
- `alter default privileges for role postgres in schema public revoke trigger on tables from anon, authenticated` ;
- **vérification fail closed** : la migration échoue si une table `public` accorde encore TRIGGER à ces rôles, ou si les privilèges par défaut de `postgres` le font encore.
- **Inchangés** : `service_role`, REFERENCES, MAINTAIN, SELECT / INSERT / UPDATE / DELETE (RLS), les droits de `supabase_admin`, tous les triggers, fonctions, politiques, tables et lignes.
- **Rollback** : `supabase/rollbacks/p0_sec/20261014120000_rollback_p0_sec_trigger_api_roles.sql`. **Il ré-accorde une permission dangereuse** (avertissement en tête du script) : sur décision d'incident HPM seulement, et de préférence en accordant le seul droit manquant.

## 3. Preuves (harnais QA-ISOLATION-01, cible vérifiée `nalynt-qa01`)
| Contrôle | Résultat |
|---|---|
| Contre-preuve : `p0SecTrigger` sans la migration | 20 échecs sur 24. Passent les 4 invariants : `service_role`, deux triggers existants, purge. |
| `p0SecTrigger.integration.test.ts` avec la migration | **24/24** : catalogue (aucun TRIGGER pour `anon` / `authenticated` / `PUBLIC`, `service_role` et REFERENCES inchangés) ; **18 créations refusées** (2 rôles × 9 tables, transactions annulées, aucun trigger résiduel) ; `service_role` peut toujours créer (annulé) ; nouvelle table de `postgres` sans TRIGGER pour `anon` / `authenticated` mais avec SELECT ; `updated_at` se met à jour sur les écritures RLS du rider ; protection en ajout seul active (UPDATE et DELETE refusés sur une version de plan) ; purge serveur intacte, témoin intact. |
| Empreintes | triggers : 62, identiques avant et après ; ACL : exactement 20 lignes changent (9 tables et 1 entrée de privilèges par défaut, chacune avant et après, seulement le droit `t`) |
| Indépendance vis-à-vis de TRUNCATE | dans une transaction annulée, avec TRUNCATE et TRIGGER retirés puis TRIGGER appliqué seul : `anon` garde TRUNCATE et perd TRIGGER |
| Fail closed | table hors inventaire (`decisions`, droit accordé à `authenticated`) → échec ; privilèges par défaut ré-accordés → échec |
| Rollback | empreinte ACL identique à l'état d'avant ; **`anon` peut de nouveau créer un trigger** (prouvé) |
| Ré-application | empreinte identique à l'état d'après ; `permission denied` ; 62 triggers intacts |
| Non-régression, configuration candidat (Edge du candidat) | head-coach-engine 21 fichiers : 213/215 en parallèle. Les 2 fichiers en échec (`p0_3PlannedSessionLock`, test de concurrence chronométré, et `ux11r9Edge`) passent seuls, **13/13 deux fois de suite**. Couverts : P0-SAFE, P0-3, INT-01 (T60, T61), P0-SEC-TRUNCATE 24/24, `athletesDeleteGrant`, purge, séances, Edge, garde de ciblage. Web **77/77** (santé, P0-3, séances guidées, débrief, planification, bootstrap) ; longitudinal-engine **136/136** (triggers en ajout seul des `pattern*`). |
| Configuration de rollback vers C (Edge C sur `qa01` ; `completed-session` et `session-execution` du candidat ; SQL conservé, TRUNCATE et TRIGGER compris) | **78/78** (`p0SecTrigger`, `p0SecTruncate`, `int01DebriefHealthGuard`, `p0_3HealthSuspendedExecution`, `p0_3PlannedSessionLock`, `p0SafeHealthEdge`, `athletePurge`), **0 erreur Edge**. Worktree C restauré à l'identique (`51e8a9d`, configuration `int01`, arbre propre). |

## 4. Blocage documenté : privilèges par défaut de `supabase_admin`
- `alter default privileges for role supabase_admin …` exécuté par `postgres` donne **« permission denied to change default privileges »** (prouvé) : `postgres` n'est pas membre de `supabase_admin`. Aucun contournement tenté.
- Effet : une table `public` créée par `supabase_admin` accorde encore TRIGGER, et TRUNCATE, à `anon` et `authenticated` (prouvé dans une transaction annulée).
- Exposition actuelle : nulle. Aucune table `public` n'appartient à `supabase_admin`, et les migrations s'exécutent en `postgres`.
- Les contrôles *fail closed* et le test catalogue détectent toute réapparition. Une correction exigerait un accès administrateur de la plateforme (support Supabase).

## 5. Risques résiduels (non modifiés, décision HPM)
| Sujet | Constat | Recommandation |
|---|---|---|
| **MAINTAIN** (PostgreSQL 17) | `anon` sur 9 tables `public`, `authenticated` sur 12 ; inclus dans les privilèges par défaut. Permet VACUUM, ANALYZE, REINDEX, CLUSTER et **LOCK TABLE** (verrou exclusif, déni de service). Même classe d'exposition que TRIGGER et TRUNCATE. | ticket distinct, après vérification de la version PostgreSQL de production (MAINTAIN n'existe qu'à partir de 17) |
| EXECUTE des fonctions déclencheuses par `anon` / `authenticated` | Défense en profondeur possible. EXECUTE n'est vérifié qu'à la création du trigger, donc une révocation n'affecterait pas les triggers en place. | à étudier avec MAINTAIN |
| TRIGGER `service_role` | 10 tables ; clé serveur, contourne RLS | inchangé (aucun GO) |
| REFERENCES `anon` / `authenticated` | 9 tables. Sans CREATE sur `public`, ces rôles ne peuvent pas créer de table référençante. | négligeable, inchangé |
| TRIGGER sur les schémas de la plateforme | `net`, `storage`, `supabase_functions` : tables de la plateforme Supabase, hors de notre propriété | hors périmètre |

## 6. Intégration proposée dans REL-01 (non effectuée)
1. **Ordre des migrations** :
   - 66 de production ;
   - 5 d'INT-01 (`20261013120000` à `20261013190000`) ;
   - `20261014090000` P0-SEC-TRUNCATE (6e) ;
   - `20261014120000` P0-SEC-TRIGGER (**7e**).

   Aucune collision : les 73 migrations sont appliquées dans cet ordre sur `qa01`.
2. **Tests au moment de l'intégration** (déjà faits sur la branche de rejeu) :
   - `athletesDeleteGrant` attend `INSERT,REFERENCES,SELECT,UPDATE` pour `anon` et `authenticated` (conflit trivial entre les deux tickets) ;
   - l'assertion « TRIGGER inchangé » de `p0SecTruncate` devient « TRIGGER aucun ».
3. **Scripts REL-01** :
   - pré-vol : 73 migrations attendues après livraison ;
   - `P0_SEC_TRUNCATE_PRIVILEGES_INVENTORY.sql` couvre déjà TRIGGER (partie A) ; attendu après livraison : 0 table pour `anon` et `authenticated`.
4. **Rollback vers C** : P0-SEC-TRUNCATE et P0-SEC-TRIGGER sont **conservés**, comme le SQL P0-3 et INT-01 (prouvé, 78/78). Leurs propres rollbacks ne s'appliquent que sur décision d'incident.
5. **Harnais QA-ISOLATION-01** dans les worktrees de validation REL-01, simulé par `git merge-tree`, sans modifier aucune branche :
   - `int/int-01-release-prep` : **propre** ;
   - C (`int/int-01-compat`) : un seul conflit, `p0_3HealthSuspension.integration.test.ts` (suite P0-3 absente de C), à résoudre en la laissant absente ;
   - lignée production (`92937a9`, P1-TXT-01, P0-SEC-TRUNCATE) : rejouer d'abord `5b3161a`, `11067a3` et `b2f7dfd` (correctifs de harnais de C, propres), puis `b1c313a`, avec le même conflit trivial.

   Application effective : sur GO HPM.

## 7. Nettoyage de `nalynt-sec` (GO conditionnel HPM)
- **Identité** : projet `nalynt-sec`, référencé seulement par `C:\nx\sec\supabase\config.toml`. 12 conteneurs, 3 volumes et 1 réseau à son nom. Aucune Edge en service, aucune tâche en cours.
- **Preuves conservées** avant suppression (`docs/release/evidence/`) : état final (67 migrations, empreinte ACL `a20eb9bb…`, 0 table TRUNCATE pour `anon`, résidus 2/2/2, 334 athlètes fictifs), inventaire et sondes d'avant P0-SEC-TRUNCATE, empreinte ACL après.
- **Suppression ciblée** : `npx supabase stop --project-id nalynt-sec --no-backup`, puis suppression du seul volume non étiqueté `supabase_edge_runtime_nalynt-sec` (0 conteneur l'utilisant). Résultat : 0 conteneur, 0 volume, 0 réseau `nalynt-sec`.
- **Autres stacks** : `qa01`, `int01`, `prodrestore-rc0`, `rehearsal-r32ref` et la stack de développement ont les mêmes conteneurs, la même heure de démarrage de base et les mêmes volumes avant et après. Aucune suppression globale.
- Le worktree git `C:\nx\sec` (branche `fix/p0-sec-truncate`) est conservé.

## 8. Propositions pour les documents gouvernés (non appliquées)
- **`docs/05`**, contraintes de sécurité, ajout proposé :

  > **P0-SEC-TRIGGER (`20261014120000`)** : `anon` et `authenticated` ne détiennent TRIGGER sur aucune table `public`, et les privilèges par défaut de `postgres` ne le leur accordent plus. Vérification *fail closed*. Les triggers existants ne sont pas concernés. `service_role` et REFERENCES sont inchangés. Limite : privilèges par défaut de `supabase_admin` non modifiables par `postgres`.

- **`docs/10`**, test proposé **T63. P0-SEC-TRIGGER** : catalogue, 18 créations refusées, nouvelle table, triggers existants actifs (`updated_at`, ajout seul), purge, rollback avec permission dangereuse rétablie, fail closed, indépendance vis-à-vis de TRUNCATE, configuration de rollback vers C.

## 9. Verdict
**P0-SEC-TRIGGER : READY LOCAL.**
- Migration minimale, fail closed, rollback exact et explicitement dangereux.
- Aucune dépendance légitime ; triggers existants intacts.
- Non-régression prouvée sur la bonne stack, en configuration candidat (P0-SAFE, P0-3, INT-01, P0-SEC-TRUNCATE) comme en configuration de rollback vers C.
- Blocage `supabase_admin` documenté, sans contournement.

Décisions HPM attendues :
- l'intégration comme 7e migration REL-01 ;
- l'intégration du harnais dans les worktrees de validation ;
- la suite donnée à MAINTAIN et à EXECUTE des fonctions déclencheuses ;
- l'application des propositions pour `docs/05` et `docs/10`.
