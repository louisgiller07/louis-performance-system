# P0-SEC-TRUNCATE — rapport de sécurité (local)

**Date** : 2026-10-13 · **Pour** : HPM (via Louis) · **Statut** : **READY LOCAL / NOT DEPLOYED**. Aucun push, merge, déploiement ni SQL en production. Non intégré à REL-01.

**Branche** : `fix/p0-sec-truncate`, depuis la production `92937a9`. Ne touchent pas à :
- le candidat figé `2f3567a` ;
- `int/int-01-release-prep` ;
- les fichiers REL-01.

**Environnements de test** :
- stack isolée `nalynt-sec` : 66 migrations de production, plus celle-ci ;
- stack candidat `nalynt-int01` : migration appliquée, puis retirée par le rollback.

Comptes et données fictifs.

## 1. Audit (stack au schéma de production)
| Point | Constat |
|---|---|
| TRUNCATE `anon` / `authenticated` | 9 tables : `athlete_baselines`, `athlete_state`, `athletes`, `daily_checkins`, `goals`, `planned_sessions`, `race_calendar`, `training_blocks`, `weekly_availability`. Entrées d'ACL directes accordées par `postgres` (baseline V0.2). |
| TRUNCATE `PUBLIC` | aucun |
| Droits hérités | `anon`, `authenticated` et `service_role` sont `NOLOGIN`. `authenticator` en est membre **sans héritage** (bascule de rôle de PostgREST seulement). `postgres` en est membre (administration). Aucun autre chemin. |
| Privilèges par défaut | `postgres` et `supabase_admin` donnent ALL (TRUNCATE, TRIGGER, REFERENCES, MAINTAIN compris) aux trois rôles sur toute nouvelle table `public`. `postgres` n'est pas membre de `supabase_admin`. |
| Propriétaires | les 39 tables `public` appartiennent à `postgres` |
| Exposition réelle avant correctif | `set role anon` / `authenticated`, puis TRUNCATE dans une transaction annulée : **4 tables vidables** (`athlete_baselines`, `goals`, `race_calendar`, `weekly_availability`). Les 5 autres n'étaient protégées que par les clés étrangères qui les référencent. Une nouvelle table recevait TRUNCATE. |
| Dépendances légitimes | aucune : aucun code applicatif ni aucune fonction `public` n'exécute TRUNCATE. Le seul SQL dynamique (`purge_athlete_account`) fait un `select count(*)` et n'est exécutable par aucun rôle d'API. La purge supprime par `DELETE` (`service_role`). PostgREST et GraphQL n'exposent pas TRUNCATE. Un seul test figeait l'ancien état (`athletesDeleteGrant`). |
| `service_role` | TRUNCATE sur 10 tables, où il détient déjà DELETE et UPDATE ; contourne RLS ; aucun trigger DELETE ni TRUNCATE sur ces tables. TRUNCATE ne lui donne aucune capacité de plus. |
| TRIGGER / REFERENCES | `anon` / `authenticated` sur les mêmes 9 tables. Inutiles à l'API et non exploitables via PostgREST. **Signalés, non modifiés.** |

## 2. Correctif : migration `20261014090000_p0_sec_truncate_api_roles.sql`
- `revoke truncate` sur les 9 tables pour `anon` et `authenticated`.
- `alter default privileges for role postgres in schema public revoke truncate on tables from anon, authenticated`.
- **Vérification fail closed** dans la migration : elle échoue (rien n'est appliqué) si une table `public` accorde encore TRUNCATE à ces rôles (par exemple une table de production hors inventaire), ou si les privilèges par défaut le font encore. Prouvé par injection, dans une transaction annulée : une table hors liste, puis des privilèges par défaut.
- **Inchangés** :
  - `service_role` ;
  - SELECT / INSERT / UPDATE / DELETE (régis par RLS) ;
  - TRIGGER et REFERENCES ;
  - les privilèges par défaut de `supabase_admin` ;
  - toute table, ligne, fonction, politique ou trigger.
- **Rollback** : `supabase/rollbacks/p0_sec/20261014090000_rollback_p0_sec_truncate_api_roles.sql`, rejoué comme nouvelle migration.

## 3. Preuves
| Contrôle | Résultat |
|---|---|
| Avant (stack au schéma de production) | `anon` et `authenticated` exécutent TRUNCATE (transaction annulée) ; nouvelle table : TRUNCATE accordé aux trois rôles |
| `p0SecTruncate.integration.test.ts`, sans la migration (contre-preuve) | 21 échecs sur 24 ; les 3 tests de non-régression passent (`service_role`, écritures du rider, purge) |
| Même test, avec la migration | **24/24** : catalogue (0 table TRUNCATE pour `anon` et `authenticated`, `service_role` inchangé, aucun droit `PUBLIC`) ; 18 tentatives refusées (`permission denied`, 2 rôles × 9 tables, transactions annulées) ; nouvelle table sans TRUNCATE mais avec SELECT ; écritures RLS du rider (insertion, mise à jour, lecture, suppression) ; `anon` ne lit rien ; purge serveur intacte, témoin intact |
| Empreinte complète des ACL | après rollback : **identique** à l'état d'origine ; ré-application : identique à l'état après migration ; 20 lignes changent en tout (9 tables et 1 entrée de privilèges par défaut, chacune avant et après) |
| Suites, stack de production + migration | planning-engine 835/835, prescription-engine 96/96 ; head-coach-engine (DB et Edge) 1319/1319, dont 16 relancés en séquence après des délais de 5 s dépassés sous charge ; web 2126/2126 ; longitudinal-engine 872/873 (voir §5) |
| Candidat INT-01 + migration (stack `int01`, Edge du candidat) | web 2248/2248 ; head-coach-engine 1360/1361, dont T59, T60 et T61 (gardes santé P0-3 et débrief INT-01). Seul échec : l'assertion de `athletesDeleteGrant` qui figeait TRUNCATE, changement attendu. Fonctions critiques inchangées (`persist_completed_session` `050ad0e4`, `record_session_execution` `90fcc5da`, `execution_health_block`, `completed_session_health_block`). Puis rollback : empreinte identique à l'origine. |
| P0-SAFE | non affecté : aucune fonction, politique ni trigger touché ; suites P0-SAFE vertes sur les deux stacks |

## 4. Effets sur REL-01 (à décider, rien n'est intégré)
1. **Horodatage.** `20261014090000` est postérieur aux migrations du candidat (`2026101312…19`). Deux options :
   - **intégrer P0-SEC au candidat** comme 6e migration de la phase D.3 (ordre naturel), recommandé ;
   - **livrer P0-SEC seul avant REL-01** : le `db push` suivant du candidat demandera alors `--include-all` pour des migrations plus anciennes que la dernière appliquée.
2. **Test du candidat.** `athletesDeleteGrant` doit recevoir la même mise à jour d'une ligne (TRUNCATE retiré pour `anon` et `authenticated`).
3. **Scripts REL-01.**
   - Après livraison, `P0_SEC_TRUNCATE_PRIVILEGES_INVENTORY.sql` doit donner 0 table pour `anon` et `authenticated`, et des privilèges par défaut `postgres` sans TRUNCATE pour ces rôles.
   - Le pré-vol compte 67 ou 72 migrations selon l'option retenue.
4. **Edge et web.** Aucun effet : inventaire Edge inchangé, aucun code n'utilise TRUNCATE.
5. **Rollback REL-01.** P0-SEC est indépendant des Edge (production, C, candidat). Il est conservé dans un rollback vers C, comme les autres protections SQL. Son propre rollback ne se fait que sur décision d'incident.
6. **Priorité.** P0-SEC lève le bloqueur de sécurité des pilotes V2 externes, une fois livré. Il reste non bloquant pour la release technique.

## 5. Constats annexes (préexistants, non corrigés)
- **Harnais codé en dur.**
  - 4 suites longitudinal-engine (`patternEvidence*`, `patternInsightReviewLedger`) et des tests web (`planningRepo` et d'autres) visent le conteneur `supabase_db_louis-performance-system` ou `127.0.0.1:54321`, quelle que soit la stack ciblée.
  - Leurs passages antérieurs sur `int01` portaient donc sur la stack de développement.
  - Pour ce rapport, je les ai pointés vers `nalynt-sec` le temps des essais (commit temporaire annulé ensuite, rien n'est conservé).
  - Lors du premier passage, avant ce constat, ces suites ont exécuté leurs fixtures de test sur la stack de développement locale.
- **Sur une stack au schéma de production**, `patternEvidenceSchema` « a forced failure on the REAL persist_pattern_evidence … rolls back » échoue (`expected 2 to be 0`), **avec et sans P0-SEC** (prouvé avec le rollback appliqué). C'est indépendant de ce ticket ; à instruire séparément.
- Les deux points sont inscrits au backlog.

## 6. Propositions pour les documents gouvernés (non appliquées)
- **`docs/05`**, section RLS / grants, ajout proposé :

  > **P0-SEC-TRUNCATE (`20261014090000`)** : `anon` et `authenticated` ne détiennent TRUNCATE sur aucune table `public`, et les privilèges par défaut de `postgres` dans `public` ne le leur accordent plus. `service_role` inchangé. Toute nouvelle migration qui accorde explicitement des droits à ces rôles n'inclut jamais TRUNCATE.

- **`docs/10`**, test proposé **T62. P0-SEC-TRUNCATE** : catalogue, refus d'exécution par rôle et par table, privilèges par défaut d'une nouvelle table, écritures RLS du rider, purge serveur, rollback avec empreinte identique, contre-preuve sans la migration.

## 7. Verdict
**P0-SEC-TRUNCATE : READY LOCAL.**
- Migration minimale avec vérification fail closed, rollback exact.
- Tests automatisés avec contre-preuve.
- Non-régression prouvée sur le schéma de production et sur le candidat INT-01, sans effet sur P0-SAFE ni INT-01.
- Aucun impact imprévu sur le fonctionnement.

Décisions HPM attendues :
- l'option d'intégration à REL-01 (§4.1) ;
- la suite TRIGGER / REFERENCES et `service_role` ;
- l'application des propositions pour `docs/05` et `docs/10`.

## 8. Addendum QA-ISOLATION-01 (2026-10-14)
- **Correction du §5.** L'affirmation « leurs passages antérieurs sur `int01` portaient sur la stack de développement » est **fausse** et retirée.
  - Le candidat (`3dbceb5`) et C (`11067a3`, `b2f7dfd`) contiennent déjà le correctif du harnais longitudinal-engine et web, et leurs passages avec `int_env.ps1` ciblaient bien `int01`. Preuve par les données : athlètes créés sur `int01` aux heures exactes de ces passages, aucun sur la stack de développement après 09:00 UTC le 13.10.
  - Seules les branches issues directement de la production `92937a9` (dont `fix/p0-sec-truncate`) gardent le harnais codé en dur.
- **Cause de l'échec `patternEvidenceSchema` (§5).** Ce n'est pas un défaut de schéma.
  - Mes deux premiers passages sur `sec` (13.10, 21:05:43 et 21:13:37 UTC) ont posé le trigger d'injection de panne par psql sur la **stack de développement** (conteneur codé en dur), alors que le RPC partait vers `sec` par l'API.
  - Sans panne, le RPC a réussi et a laissé 2 identités, 2 révisions et 2 références de provenance au rôle marqueur, en ajout seul. Le test les compte : il échouera toujours sur `sec`.
  - Sur une stack propre et bien ciblée (`nalynt-qa01`), il passe (rapport QA-ISOLATION-01). Données conservées, non nettoyées.
- **Intégration comme 6e migration.** Vérifiée sur la stack neuve `nalynt-qa01`, avec les 72 migrations dans l'ordre réel (66 de production, 5 d'INT-01, puis `20261014090000`) :
  - aucune collision de nom ni d'ordre ;
  - empreinte des droits identique à celle de `sec` après migration ;
  - P0-SEC 24/24, ainsi que P0-SAFE, P0-3, INT-01 (T60, T61), purge et Edge, sur la cible vérifiée.
- **Privilèges par défaut, comportement prouvé sur `qa01`.**
  - Une table créée par `postgres` n'accorde plus TRUNCATE à `anon` ni à `authenticated`.
  - Une table créée par `supabase_admin` l'accorde encore : résidu, car `alter default privileges for role supabase_admin` exécuté par `postgres` donne « permission denied to change default privileges ».
  - Les 39 tables `public` appartiennent à `postgres`, qui exécute aussi les migrations.
  - Le contrôle *fail closed* de la migration couvre toutes les tables existantes, quel que soit leur propriétaire. Le test catalogue (`p0SecTruncate`) détecte toute réapparition.
- **Le rollback n'est pas banal.** Il ré-accorde une permission dangereuse : après le script, `set role anon; truncate public.weekly_availability` réussit, prouvé sur `qa01`. Avertissement ajouté en tête du script. En cas de dépendance inconnue, accorder le seul droit manquant plutôt que tout rejouer.
- **Risques et dépendances non modifiés** (documentés, aucune modification) :

| Droit | Risque | Dépendance connue |
|---|---|---|
| TRUNCATE de `service_role` (10 tables) | Vide une table en contournant les triggers de ligne. Sur ces 10 tables, `service_role` détient déjà DELETE, et aucune n'a de trigger DELETE ni TRUNCATE : pas de capacité nouvelle. La clé serveur reste la frontière. | aucune (purge et Edge par DELETE et RPC) |
| TRIGGER de `anon` / `authenticated` (9 tables) | **Réel au niveau de la base, même classe que TRUNCATE.** `CREATE TRIGGER` n'exige que TRIGGER sur la table et EXECUTE sur une fonction. Sur `qa01`, dans une transaction annulée, `set role anon; create trigger … on public.goals … execute function public.set_updated_at()` réussit. `anon` peut exécuter `reject_append_only_mutation`, ce qui permettrait de bloquer toutes les écritures d'une table (déni de service persistant). Inaccessible par l'API : PostgREST et GraphQL n'exécutent pas de DDL, les rôles sont `NOLOGIN`. | aucune |
| REFERENCES de `anon` / `authenticated` (9 tables) | Créer une clé étrangère vers ces tables exige de posséder la table référençante. `anon` et `authenticated` n'ont pas CREATE sur `public` (vérifié sur `qa01`) : négligeable. Impossible via PostgREST. | aucune |

  Recommandation : traiter **TRIGGER** comme TRUNCATE, avec la même migration minimale, une vérification *fail closed*, la correction des privilèges par défaut et le même rollback. C'est la même classe de risque (SQL direct d'un rôle d'API), avec un effet persistant. REFERENCES et `service_role` relèvent du moindre privilège, non bloquant. **Décision HPM requise**, aucune modification faite.

