# REL-01 — MAINTAIN REPLAY REPORT

**Date** : 2026-10-14 · **Pour** : HPM (via Louis) · **Statut** : local. Aucun push, merge, déploiement, opération en production ni flag. Inchangés : le candidat `2f3567a` et son tag, l'assemblage de 73 migrations (`rel/rel-01-assembly` `56b604e`), C (`51e8a9d`) et les branches historiques.

**Verdict : READY LOCAL** pour l'assemblage de 74 migrations `rel/rel-01-assembly-maintain` (`90fc4b8`), avec P0-SEC-MAINTAIN en 8e migration. Ce n'est pas READY PRODUCTION : les gates REL-01 restent ouverts.

## 1. Reprise après l'incident Docker
- Louis a redémarré Docker Desktop et l'a confirmé explicitement. Le moteur répond (29.7.2).
- **Inventaire post-redémarrage** : 7 stacks, bases « healthy », nombres de migrations conformes.
- **`nalynt-qa01` et `nalynt-rel01`** : utilisées par aucune autre tâche (référencées seulement par mes worktrees `C:\nx\qa` et `C:\nx\asm`, aucun service Edge en cours). Arrêtées proprement, **volumes conservés** (3 chacune).
- **`nalynt-rel01m`** :
  - identité vérifiée : seulement `C:\nx\asm8`, 12 conteneurs, 3 volumes, 1 réseau ;
  - supprimée, avec son volume Edge non étiqueté (0 conteneur l'utilisant), puis recréée à neuf ;
  - ports 58020 à 58029 : libres, hors des plages réservées par Windows.
- **Autres stacks** (`int01`, `prodrestore-rc0`, `rehearsal-r32ref`, développement) : non touchées. Mêmes conteneurs, même heure de démarrage de base avant et après chaque opération.
- **Fichiers locaux** : le scratchpad local a été vidé pendant l'incident. `edge.env` (configuration Edge locale de test, inchangée) et l'environnement explicite de la stack ont été recréés à l'identique.

## 2. Stack et migrations
| Contrôle | Résultat |
|---|---|
| PostgreSQL | **17.6** (`server_version_num` 170006) |
| Migrations | **74 / 74**, identiques une à une et dans le même ordre que les fichiers de la branche ; les 4 dernières sont `20261013190000`, `20261014090000` (TRUNCATE), `20261014120000` (TRIGGER), `20261014150000` (MAINTAIN, **8e**) |
| Services | 12/12 conteneurs ; gateway publiée sur 58021 ; Edge servie depuis `C:\nx\asm8`, préchauffée |
| Droits (`REL_01_PG_VERSION_AND_SENSITIVE_PRIVILEGES.sql`) | `anon` et `authenticated` : TRUNCATE 0, TRIGGER 0, **MAINTAIN 0** ; REFERENCES 9 (accepté) ; `PUBLIC` 0. Privilèges par défaut de `postgres` sans TRUNCATE, TRIGGER ni MAINTAIN. Ceux de `supabase_admin` sont inchangés (limite acceptée). 39 tables, propriétaire `postgres`. |
| Inventaire Edge | identique au candidat et à l'assemblage de 73 migrations |

## 3. Suites (cible vérifiée QA-ISOLATION-01)
Chaque sortie n'imprime que `[test-target] project=nalynt-rel01m api=http://127.0.0.1:58021 (gateway supabase_kong_nalynt-rel01m publishes 58021) db=supabase_db_nalynt-rel01m — verified` (66 lignes dans head-coach-engine, 23 dans web, 17 dans longitudinal-engine).

| Suite | Résultat |
|---|---|
| head-coach-engine **complète** (142 fichiers, dont `p0SecMaintain`), **séquentiel** | **1455/1455** (1426 de l'assemblage à 73 migrations, plus 29 MAINTAIN) |
| head-coach-engine complète, **parallèle** | 1449/1455, puis 1448/1455 : échecs non déterministes, voir ci-dessous |
| Les 10 fichiers concernés, relancés **en parallèle mais seuls** (dont P0-SEC-MAINTAIN, TRIGGER, TRUNCATE, INT-01, P0-3, F-6C, `athletesDeleteGrant`) | **138/138** |
| web complète (intégrations comprises) | **2268/2268** |
| longitudinal-engine complète | **890/890** |
| planning-engine, prescription-engine | **883/883**, **96/96** |
| `build:release:all` | OK |

**Échecs en parallèle : saturation de l'Edge locale, pas un défaut de code.**
- Erreurs : `502 An invalid response was received from the upstream server` (5 fois), `fetch failed` (2 fois), délais de 5 s dépassés (2 fois).
- Le journal de l'Edge compte **14 « early termination »** (12 sur limite de temps écoulé, 2 sur temps CPU) : le runtime local tue ses workers sous la charge de 142 fichiers en parallèle, alors que 4 autres stacks tournent sur la machine.
- Aucun échec n'est une assertion de droit, de santé ou de sécurité qui change de résultat. Tout passe en séquentiel et en parallèle restreint.
- **Instabilité potentielle de l'environnement de test, signalée** : les preuves de release doivent être produites en séquentiel ou en parallèle restreint, avec une Edge préchauffée.

## 4. Protections santé et sécurité (rejouées dans les suites)
- **P0-SAFE** : continuité santé, Edge, clôture du signal.
- **P0-3** : suspension santé des séances, verrou du jour, journée conservée relancée.
- **INT-01** : T60 et T61, garde des tentatives guidées.
- **TRUNCATE** (24) et **TRIGGER** (24).
- **MAINTAIN** (29) : 21 `REINDEX` refusés ; 3 verrous exclusifs refusés pour `authenticated` sur `completed_sessions`, `decisions`, `health_flags` ; le résidu documenté reste vérifié (verrou possible via UPDATE) ; nouvelle table sans MAINTAIN ; écritures du rider et purge intactes.
- Purge serveur, séances et Edge.

## 5. Rollback et ré-application de MAINTAIN (sur `nalynt-rel01m`)
| Étape | Verrou exclusif `authenticated` sur `decisions` | `REINDEX` `anon` sur `goals` | ACL |
|---|---|---|---|
| avec la migration | permission denied | permission denied | référence |
| après le script de rollback | **LOCK TABLE** (rétabli, dangereux) | **REINDEX** (rétabli) | 26 lignes changent (12 tables et privilèges par défaut, droit `m`) |
| ré-application | permission denied | permission denied | **identique** à la référence |

Les 62 triggers restent identiques tout au long. Fail closed vérifié : un droit MAINTAIN resté sur `training_plan_versions` fait échouer la migration.

## 6. Configuration de rollback vers C (avec les 74 migrations)
Edge C servie sur `nalynt-rel01m` (57 montages depuis `C:\nx\compat`), avec `completed-session` et `session-execution` du candidat ; tout le SQL est conservé (P0-3, INT-01, TRUNCATE, TRIGGER, MAINTAIN).
- **134/134 en séquentiel** : `p0SecMaintain`, `p0SecTrigger`, `p0SecTruncate`, `athletesDeleteGrant`, `int01DebriefHealthGuard`, `p0_3HealthSuspendedExecution`, `p0_3PlannedSessionLock`, `p0SafeHealthEdge`, `p0SafeHealthContinuity`, `athletePurge`, `sessionExecution`.
- **0 erreur Edge** (ni 500 ni « early termination »).
- Worktree C restauré à l'identique : `51e8a9d`, configuration `nalynt-int01`, arbre propre.

## 7. Problème de publication des gateways (documenté séparément, aucune intervention)
- Après le redémarrage de Docker Desktop, les gateways de `int01` (port 54821), `prodrestore-rc0` (55321) et de la stack de développement (54321) tournent **sans port publié sur l'hôte** : leur API n'est pas joignable.
- **Cause établie (lecture seule)** : ces ports se trouvent désormais dans des **plages TCP réservées dynamiquement par Windows** (Hyper-V/WinNAT, recalculées au redémarrage). Les ports hors de ces plages (`rehearsal-r32ref` 62321, `rel01m` 58021) sont publiés normalement. Le premier échec de `rel01m` (port 55722) avait la même cause.
- **Pistes, pour décision de leurs responsables** : déplacer ces stacks vers des ports hors des plages réservées, ou réserver durablement leurs ports, ou réinitialiser WinNAT (opération système). Ces stacks appartiennent à d'autres tâches : aucune action de ma part.

## 8. Conclusion
- **READY LOCAL** : 74 migrations, PostgreSQL 17.6, suites complètes vertes en séquentiel avec preuve de ciblage, protections santé et sécurité vertes, configuration de rollback vers C verte, rollback et ré-application MAINTAIN prouvés.
- **À retenir** : la fiabilité en parallèle complet est limitée par la saturation de l'Edge locale (§3).
- **Pas READY PRODUCTION** : les gates REL-01 restent ouverts (T+48 et preuve Edge P0-SAFE, vérification de la production en service, reconstruction sur cette production, inventaires, GO HPM).
