# INT-01 — V1 DEBRIEF SAFETY FIX REPORT

**Date** : 2026-10-13 · **Pour** : HPM (via Louis) · **Statut** : local uniquement. Aucun push, merge, déploiement, activation V2 ni écriture en production.

## 1. Versions
| Branche | HEAD | Contenu |
|---|---|---|
| Candidat `int/int-01-v2-candidate-r1` | ce commit de doc, après `b276b21` | `71c5342` SQL + test d'intégration ; `7d05327` Edge + web ; `f709f62` docs 05 / 10 / 11 ; `b276b21` fusion de la doc de C |
| C `int/int-01-compat` | `826b13d` | doc seulement : configuration de rollback |
| Candidat initial | `860f73d` | inchangé |

**Inventaire Edge.** Seul `completed-session` change par rapport au candidat précédent : `56a07981…` au lieu de `6cd39e9d…` (production). Les autres fonctions sont inchangées (`daily-run` `e00f0011…`, `generate-training-plan` `dbccafa4…`, `session-execution` `aebd17b1…`).

## 2. Migration `20261013180000_int01_completed_session_health_guard`
- **Nouvelle fonction `completed_session_health_block(athlete, date, completion_status, family)`.**
  - SECURITY DEFINER, `search_path = public, pg_temp`.
  - Exécutable par `postgres` et `service_role` seulement, ce qui est nécessaire car `persist_completed_session` s'exécute en `service_role`.
  - Elle réutilise **telle quelle** la règle P0-3 `execution_health_block` (corps et droits inchangés) et ajoute l'historique santé du jour.
- **`persist_completed_session`.**
  - Inchangés : signature, SECURITY INVOKER, `search_path`, droits, verrou consultatif commun avec `record_session_execution`, validations, upsert, contrôles d'athlète et de décision.
  - Ajout : la garde, exécutée sous le verrou, avant l'écriture.
- **Règle.**

| Débrief | Situation du jour | Résultat |
|---|---|---|
| « Terminée », « Partielle », « Remplacée » | suspension P0-3 : signal de suivi ouvert, même avant le daily-run ; commotion pour une séance DH ; dernière décision en REST Safety | 409 `health_suspended` (NX102) |
| idem | décision du jour plus à jour (check-in modifié) | 409 `daily_decision_not_current` (NX103) |
| idem | une tentative guidée arrêtée un jour ayant eu un REST Safety, signal clôturé ou non | 409 `health_suspended` (NX102) |
| « Non réalisée » | résultats guidés enregistrés, un jour suspendu ou ayant eu un REST Safety | 409 `guided_results_exist` (NX104) |
| « Non réalisée » | sans contradiction | acceptée |
| tous | jour ordinaire, repos ordinaire, tentative arrêtée hors santé, séance ouverte ou terminée | règles existantes (NX101, F-6B) |

- **Empreintes (base locale).**

| Fonction | Avant | Après |
|---|---|---|
| `persist_completed_session` | `340f2707…` (version UX-11R.9) | `2d5ec3f3…`, même mode, chemin et droits |
| `completed_session_health_block` | — | `ae7a128f…` |
| `execution_health_block` | `8c7972c7…` | `8c7972c7…` (inchangée) |

- **Rollback** (`supabase/rollbacks/int01/`) : il restaure exactement `340f2707…` et supprime la fonction d'aide. La ré-application redonne des empreintes identiques.

## 3. Reproduction avant / après (test d'intégration, Edge locale, JWT du rider)
| Situation | Scénarios 1, 5 et 6 (« Terminée » sous suspension, avant le daily-run, après clôture) | Résultat global |
|---|---|---|
| Sans la garde (avant) | **200, contournement** | 4 échecs, dont des défauts de harnais corrigés ensuite |
| Avec la garde | 409 | **7/7** |
| Fonction restaurée par le script de rollback | **200, contournement revenu** | 3 échecs |
| Ré-application | 409 | **7/7** |

## 4. Tests obligatoires
| # | Scénario | Résultat |
|---|---|---|
| 1 | Séance commencée → douleur 8/10 (A6) → arrêt → « Terminée » (aussi liée à la décision KEEP du matin) | 409 `health_suspended` |
| 2 | « Partielle », « Remplacée » ; rejeu | 409 ; rejeu identique |
| 3 | Résultats guidés conservés et visibles | base : `started>abandoned`, 2 résultats ; navigateur : historique « Séance guidée arrêtée », 2/6 passages |
| 4 | Aucun faux `completed_sessions`, aucune charge M1 | aucune ligne (M1 ne lit que `completed_sessions` et les exécutions terminées) |
| 5 | Signal ouvert un jour précédent, avant le daily-run du jour | « Terminée » 409 ; « Non réalisée » sans résultat guidé acceptée |
| 6 | Signal clôturé après l'arrêt, nouvelle décision KEEP | « Terminée », « Partielle », « Remplacée » 409 ; « Non réalisée » 409 `guided_results_exist` ; navigateur : clôture dans l'UI, « Raconter ma séance » → refus et message affichés |
| 7 | Débrief normal | « Terminée » acceptée sans séance guidée et après un arrêt hors santé ; séance ouverte toujours NX101 |
| 8 | Repos ordinaire (KEEP d'un REST planifié, sans règle Safety) | débrief accepté |
| 9 | « Non réalisée » | cohérente avec les exécutions (cas 1, 5, 6, 7) |
| 10 | Rejeu, autre rider, accès direct, concurrence | rejeu identique ; décision d'un autre rider 422 ; RPC, fonction d'aide, insertion et anonyme refusés ; débrief et démarrage concurrents : un seul gagnant (3 jours) |
| 11 | Rollback vers C | voir §5 |

**Non-régression du candidat.**
- planning-engine 883/883, prescription-engine 96/96 ;
- head-coach-engine 1361/1361 (DB et Edge ; dont l'ancien test UX-11R.9 « arrêtée → débrief accepté ») ;
- configs Edge : session-execution 24/24, completed-session 152/152, edge 57/57 ;
- longitudinal-engine 873/873 ;
- web 2235/2235 (intégrations comprises), build OK ;
- `build:release:all` OK.

## 5. Compatibilité et rollback
| SQL | Edge `completed-session` | Web | Débrief « Terminée » sous suspension |
|---|---|---|---|
| avec la garde | candidat | candidat | **409**, message clair |
| avec la garde | C / production | — | refusé (rien n'est écrit), mais **500 `persistence_failed`** (prouvé) |
| avec la garde | candidat | C | 409, message générique « Une erreur inattendue s'est produite. Réessaie. » |
| sans la garde | candidat | — | 200 (contournement) : fenêtre de l'ordre de déploiement |

- **Ordre de déploiement.** L'Edge `completed-session` d'abord (inoffensive sans les codes), puis la migration.
- **Configuration exacte de rollback vers C**, testée : T60 7/7, 0 erreur Edge.
  - SQL de sécurité **conservé** : P0-3 (3 migrations) + `20261013180000`.
  - `session-execution` et `completed-session` du **candidat conservés**.
  - `daily-run` et `generate-training-plan` → C.
  - Web candidat conservé de préférence (messages clairs) ; sinon web C (sûr, messages génériques).
- Le rollback ne réactive jamais le contournement, puisque la migration est conservée. Le script de rollback de la garde ne fait pas partie d'un rollback vers C.
- Documenté dans `docs/release/INT_01_COMPAT_RELEASE_PLAN.md` §4.2 et §6, `docs/release/P0_3_RELEASE_PLAN.md` §5, `docs/05` et l'ADR INT-01 B.

## 6. Débrief sur une date future (audit)
- **Contrat actuel, inchangé.** `session_date` n'est contrôlée que sur son format, dans l'Edge comme dans la RPC.
  - Un débrief pour un jour futur est accepté hors suspension.
  - Sous un signal ouvert, la garde le refuse, parce que la règle P0-3 ne tient pas compte de la date.
- **Ticket séparé proposé, non fait.** Borner `session_date` au jour produit (Europe/Zurich) dans l'Edge et la RPC, avec une migration et une compatibilité de rollback de même nature.

## 7. Points ouverts
- **Choix produit à confirmer.** Le signal ouvert est indépendant de la date : un débrief « Terminée » d'un jour **antérieur** au signal est refusé tant que celui-ci reste ouvert. « Non réalisée » reste possible, et le débrief est possible après la clôture. Variante possible : ne considérer que les signaux datés au plus tard du jour débriefé.
- **Interface.** Après clôture du signal, un jour ayant eu un REST Safety et une tentative arrêtée affiche encore « Raconter ma séance ». Le serveur refuse avec un message clair. Masquer l'invitation demanderait au web de connaître l'historique santé du jour : amélioration possible.
- **Limite de concurrence**, comme P0-3 : `persist_daily_run_v2` ne prend pas le verrou consultatif.
- **Messages web** : textes rédigés pour ce correctif, à relire.
- **Données existantes** : les débriefs enregistrés avant le correctif (riders de test locaux) ne sont pas modifiés.

## 8. Verdict
**READY INTEGRATION (local)** pour INT-01, dans la configuration de rollback documentée (§5).

Le contournement du débrief V1 est corrigé côté serveur, avec reproduction avant / après, rollback testé et compatibilité C prouvée. Aucun autre contrat critique n'a été modifié (`record_session_execution` et `execution_health_block` inchangées).

À trancher par l'HPM : le choix produit du §7 et le ticket de date du §6.
