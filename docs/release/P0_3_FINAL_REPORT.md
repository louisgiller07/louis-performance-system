# P0-3 — rapport final (local)

**Statut : PASS LOCAL / NOT DEPLOYED** — HPM, 2026-10-13. Branche `fix/p0-3-manual-sessions` (depuis la production P0-SAFE `92937a9`). Aucun push, merge, déploiement ni écriture en production.

## Périmètre livré en local
| Volet | Décision HPM | Livraison |
|---|---|---|
| Séances manuelles V2 (F1) | option P1 | builder V2 de la séance manuelle ; migration `20261013120000` (`persist_daily_run_v2` : `keep` sans prescription prévue pour la seule origine manuelle, vérifiée côté serveur) |
| V1 honnête, lignée manuelle (F2, F3) | GO | mentions V1, lignée vidée à l'écriture manuelle |
| Contrainte de temps sur séance manuelle (A10) | GO | R4 : DH 90 + 30 min → récupération active |
| Verrou serveur `planned_sessions` | L1 | migration `20261013140000` : triggers sous le verrou de `record_session_execution` ; `project_training_plan` garde un jour utilisé (`skipped_completed`) |
| Suspension santé des séances guidées | GO correction serveur | migration `20261013160000` : `record_session_execution` refuse toute action d'entraînement (`health_suspended`, `daily_decision_not_current`) ; Edge `session-execution` ; Aujourd'hui et `/today/session` |
| Arrêt sous suspension | **O1** | `abandoned` est l'arrêt sûr ; `completed` refusé ; O2 / O3 non retenus |

## Décision O1 — effets
- Une séance interrompue sous suspension **conserve ses résultats** ; aucune nouvelle activité, série, reprise ni fin n'est acceptée après la suspension.
- Elle n'est jamais comptée comme terminée : la distinction avec une séance terminée normalement est préservée (historique, progression, adhérence, M1 ne lisent que `completed`).
- **Charge** : elle ne contribue **actuellement pas** à la charge récente calculée par M1. Les règles de charge M1 ne sont pas modifiées ici ; ticket produit distinct à traiter avant commercialisation (docs/12).

## Risques résiduels
- **Concurrence santé / résultat** : la suspension prend effet au commit de la décision ou du signal de santé. `persist_daily_run_v2` ne prend pas le verrou consultatif de `record_session_execution` : un résultat validé par la RPC d'exécution avant ce commit (même quasi simultanément) est enregistré comme antérieur à la suspension. Les tests prouvent le refus de toute action vérifiée après le commit, pas une atomicité absolue entre la persistance santé et l'enregistrement d'un résultat ; la fermer imposerait de modifier une autre fonction critique (non fait).
- **Décision périmée** : blocage volontairement strict (`daily_decision_not_current`) jusqu'au nouveau daily-run, relancé automatiquement par le web après un check-in.
- **A5 sur Aujourd'hui** : la famille de la séance n'y est pas connue ; `/today/session` et le serveur bloquent une séance DH sous commotion ouverte.
- **Règle miroir web** (`healthBlock.ts`) : le serveur reste l'autorité.
- Hors P0-3 : privilèges TRUNCATE à réexaminer (signalé séparément) ; deux tests d'intégration web avec une URL codée en dur.

## Preuves (locales, schéma de production + migrations P0-3)
- head-coach-engine : 1333 / 1333 (intégration et Edge locale) ; web : 2130 réussis, 56 ignorés, build OK ; intégrations web réelles vertes.
- Concurrence du verrou `planned_sessions` : deux connexions PostgreSQL, attente observée sur le verrou consultatif, 0 interblocage sur 40 écritures simultanées.
- Suspension : Edge réelle avec le JWT du rider, lignes persistées vérifiées (A1–A4, A6, signal ouvert avant daily-run, décision périmée, REST ordinaire, séance terminée, jour gardé).
- Rollbacks des trois migrations testés (corps exacts restaurés, aux fins de ligne près).

## Commits
`cf099f3` diagnostic · `fab261f` WIP (à écraser à l'intégration) · `fed16e5` F1 + migration · `72fa777` docs · `53fd456` diagnostic projection · `07a64c7` verrou · `3a1d146` docs · `7fe7d2a` contre-preuve jour gardé · `7bfcb14` audit santé · `000a4ca` suspension santé + web · `08fad6d` docs · (ce commit) finalisation O1.

## Release
Plan, ordre et rollback : docs/release/P0_3_RELEASE_PLAN.md ; conditions de release : §7. Aucun changement de production sans GO HPM explicite.
