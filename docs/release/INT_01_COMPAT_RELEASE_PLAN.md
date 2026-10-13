# INT-01 R2 — Version de compatibilité du catalogue V2 (C) : plan de release

**Statut** : PASS LOCAL / NOT DEPLOYED. Branche `int/int-01-compat` depuis la production P0-SAFE `92937a9`. Décision : ADR INT-01 R2 (`docs/11_DECISION_LOG.md`).

**Objet** : lire, adapter et afficher le contenu que la release V2 suivante ajoute sous `session-model-v2.6`, sans jamais le générer. Ce contenu comprend le drill `cornering_advanced_line_exit` et ses textes, l'intent `dh_corner_line_control`, les terrains compatibles et `off_camber_section`. C est livrable seule, avant le candidat V2. Elle devient la cible de rollback du candidat.

## 1. Contenu
| Couche | Changement | Production inchangée |
|---|---|---|
| planning-engine | catalogue (drill v2_only exclu de la sélection, textes, intent non sélectionnable, `compatibleTerrains` en lecture), `dhDrillForLoad`, `canonicalDhDrill`, `off_camber_section` accepté dans le snapshot | génération et adaptations des plans de production (différentiel : 0 écart) |
| Edge | `daily-run` (graphe `c9df7832…`), `generate-training-plan` (`b8815db1…`) | les 8 autres fonctions, graphes identiques à `92937a9` (dont `session-execution` `0702b514…`) |
| Web | libellé et textes du drill, conservation d'un terrain enregistré non proposé | tout le reste |
| SQL, flags | aucun | — |

## 2. Ordre de déploiement
1. Checkout du commit RC, `npm ci`, `npm run build:release:all`, puis `--verify-only`.
   - Attendu : seuls `daily-run` et `generate-training-plan` changent par rapport à l'inventaire production.
2. Edge `daily-run`, puis Edge `generate-training-plan`, une fonction nommée à la fois.
3. Web (Vercel).

C ne modifie aucune donnée. L'ordre entre les trois étapes est libre : la production n'a encore aucun contenu de la release suivante.

## 3. Smoke
Compte de test jetable, plan V2 de production.
- Aujourd'hui, daily-run, séance guidée DH et historique sont identiques à la production.
- Profil : enregistrer la section terrain sans régression.

## 4. Rollback
| Situation | Cible | Pourquoi |
|---|---|---|
| C déployée, candidat jamais déployé | production `92937a9` (Edge et web) | aucun contenu de la release suivante n'existe |
| Candidat déployé, puis retiré | **C**, jamais `92937a9` | la production renvoie 500 sur un jour DH portant le drill v2_only, 500 à la régénération d'un profil avec `off_camber_section` ; son web n'affiche pas ces séances |

Rollback du candidat vers C, selon l'ordre du plan P0-3 (`docs/release/P0_3_RELEASE_PLAN.md` §5, cible C au lieu de la release précédente) :
1. Edge `daily-run` → C.
2. SQL P0-3 rejoués comme nouvelles migrations : `20261013160000`, puis `20261013140000`, puis `20261013120000`, jamais avant l'étape 1.
3. Edge `generate-training-plan` → C.
4. Edge `session-execution` : graphe de production, identique dans C. À retirer seulement après le rollback de `20261013160000`, sinon les refus de santé remontent en 500.
5. Web → C.

Avant toute décision de rollback, mesurer par requête les données concernées : drill `cornering_advanced_line_exit` dans `training_plan_planned_prescriptions` ou `decision_final_prescriptions`, `off_camber_section` dans `athlete_performance_profiles` ou dans `training_plan_versions.input_snapshot`.

## 5. Preuves locales (2026-10-13)
- **Tests** :
  - planning-engine 842/842, prescription-engine 96/96 ;
  - head-coach-engine 1295/1295 (DB + Edge C) ;
  - web 2130/2130 (dont intégrations), build OK ;
  - longitudinal-engine 873/873.
- **Différentiel C / production** : 32 256 constructions DH, 588 plans complets et 264 000 adaptations quotidiennes, 0 écart.
- **Simulation réelle** (Edge et web servis tour à tour, JWT des riders) : production → C → candidat (le drill généré pour de vrai) → rollback vers C.
  - Sous C : aucun 500 ; toutes les exécutions antérieures sont intactes.
  - Le rider au drill v2_only obtient `created` pour : relance du jour, KEEP, REPLACE DH léger (fatigue), A10 60 min et A10 30 min. Il réalise une nouvelle séance guidée avec ce drill, consultée dans le web C.
  - Une séance ouverte avant le rollback se termine sous C.
  - La régression LIGHT d'un drill « allure de course » accordé sur terrain compatible est `created` (production : bloquée `no_light_dh_drill`).
  - La régénération d'un profil avec dévers renvoie 200 (production : 500), et l'enregistrement du profil conserve le terrain.
- **Contre-épreuve sur les mêmes données avec l'Edge et le web de production** : `daily-run` 500, `generate-training-plan` 500, séance « non prise en charge ».
