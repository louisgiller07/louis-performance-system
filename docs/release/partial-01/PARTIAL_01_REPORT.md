# PARTIAL_01_REPORT — Cohérence des séances partielles

**Date** : 2026-10-18 · **Pour** : HPM et Louis · **Statut** : local uniquement.

Rien n'a été touché hors du poste local :
- aucun push, aucune migration, aucun déploiement ;
- aucune écriture en production ;
- V2, PHYS, ART-02 et JARVIS non touchés.

**Verdict : READY LOCAL.**

Branche `fix/partial-01-partial-sessions`, depuis `940bb75` (production : web `940bb75`, base 75).

## 1. Investigation (code réel `940bb75`)

| Question | Constat |
|---|---|
| Comment une séance est marquée terminée | Événement `completed` dans `execution_events`, via `record_session_execution`. Le serveur exige au moins une série de travail réalisée (Force, F-6C), un passage (DH) ou une activité (endurance). Quand des séries ou des passages manquent, l'écran demande « Terminer quand même ? ». Une séance partielle se termine donc en `completed`, comme une séance complète : c'est voulu (`docs/05`, « Terminée garde son sens »). |
| Comment séries et exercices sont enregistrés | Une ligne `exercise_set_results` par série ou passage : exercice prescrit, numéro, `done`, mesure. Les lignes ne sont jamais modifiées ; une correction en remplace une (`supersedes_id`). L'activité d'endurance est dans `session_activity_results`. La prescription de l'exécution est figée dans `decision_final_prescriptions`. |
| États persistés distinguant complet / partiel / abandonné | **V2** : `completed`, `abandoned` ou ouverte ; aucun statut « partielle ». La partialité se déduit de la prescription figée et des résultats actifs, avec les règles mêmes de l'écran (`strengthProgress` / `dhProgress`). Le motif d'arrêt n'est pas persisté. **V1** : `completion_status` explicite (`done` / `partial` / `skipped` / `replaced`). |
| Moteurs de coaching et de progression | Aucun ne lit `exercise_set_results` ni `session_activity_results`. M1 (charge récente) compte une séance partielle comme réalisée, par conception (V0.3_007B). Le pont V2 → M1 transmet la séance **prescrite** avec `completion_status: "done"`. La génération de plan et le moteur longitudinal ne lisent que les débriefs V1. **Aucun défaut moteur au regard de la spec actuelle** (voir § 6). |

**Écrans avant correction**

| Situation | Bandeaux de semaine (Aujourd'hui, Programme) | Carte du Programme | Historique (carte, ligne, détail) | Aujourd'hui (entrée, « Après ta séance ») |
|---|---|---|---|---|
| Séance guidée terminée en partie | « Réalisée » ✗ | « Réalisée » ✗ | « ✓ Séance guidée terminée » ✗ | « Séance terminée » / « Séance guidée terminée » ✗ |
| Débrief V1 « Partielle » | « Réalisée » ✗ | « Partielle » ✓ | « ◐ Séance partiellement réalisée » ✓ | — |
| Tentative arrêtée | « Prévue, non enregistrée » ✗ | « Arrêtée » ✓ | « Séance guidée arrêtée » ✓ | ✓ |
| Séance non commencée | « Prévue, non enregistrée » ✓ | ✓ | ✓ | ✓ |

Le calendrier `/plan` n'affiche aucun statut de réalisation : il n'est pas concerné.

## 2. Cause racine

**Présentation seulement.** Les écrans ne recevaient que le statut terminal (`completed`) et le traduisaient par « réalisée » ou « terminée ». Aucune lecture ne comparait les résultats à la prescription. Le bandeau de semaine ignorait aussi le statut V1 `partial` et les tentatives arrêtées.

## 3. Correction (web seulement)

**Règle**
- **Séance guidée** : sa prescription figée est comparée à ses résultats actifs, corrections appliquées.
  - Force : toutes les séries de travail prévues réalisées → complète, sinon partielle.
  - DH : tous les passages prévus enregistrés → complète, sinon partielle.
  - Endurance, récupération, mobilité : complète une fois terminée (aucun nombre d'unités n'est prescrit).
- **Débrief V1** : `partial` → partielle ; `done` / `replaced` → réalisée. Les libellés V1 existants sont inchangés.
- **Réalisation illisible** (lecture en échec ou incomplète, prescription non décodable, résultats ambigus) → « Terminée », jamais « Réalisée ».
- **Rien d'inventé** : ni série, ni motif d'arrêt, ni statut serveur.

**Écrans après correction**

| Situation | Bandeaux de semaine | Carte du Programme | Historique | Aujourd'hui |
|---|---|---|---|---|
| Guidée complète | ✓ Réalisée | Réalisée | ✓ Séance guidée terminée | inchangé |
| Guidée partielle | ◐ Partiellement réalisée | Partiellement réalisée | ◐ Séance guidée partiellement réalisée | note « Partiellement réalisée : une partie de la séance prévue n'a pas été enregistrée. » ; « Séance guidée partiellement réalisée » |
| Guidée, réalisation illisible | ✓ Terminée | Terminée | ✓ Séance guidée terminée | inchangé |
| V1 « Partielle » | ◐ Partiellement réalisée | Partielle | inchangé | — |
| Tentative arrêtée | Arrêtée | Arrêtée | inchangé | inchangé |
| Non commencée | Prévue, non enregistrée | inchangé | inchangé | inchangé |

La légende des bandeaux devient « ✓ réalisée · ◐ partielle · ● aujourd'hui · ○ prévue · ⚑ course ».

**Lecture**
- `loadExecutionsForDates` lit en plus, pour les seules exécutions terminées :
  - leurs prescriptions ;
  - leurs séries.
- Ces lectures sont groupées par 50 exécutions, sous RLS, sans requête par séance.
- Les séries sont lues page par page et comparées à un comptage exact, pour qu'un plafond de lignes du serveur (`max_rows`) ne fasse jamais apparaître de fausses séries manquantes.
- Un échec n'empêche jamais l'écran de s'afficher.

## 4. Fichiers modifiés

| Fichier | Changement |
|---|---|
| `web/src/features/completion/guidedRealisation.ts` (nouveau) | règle pure, sur `strengthProgress` / `dhProgress` |
| `web/src/features/completion/guidedRealisationRepo.ts` (nouveau) | lectures groupées et paginées, au mieux |
| `web/src/features/history/historyRepo.ts` | `loadExecutionsForDates` porte la `realisation` des exécutions terminées |
| `web/src/features/guidedSession/executionRepo.ts` | colonnes et normalisation des séries exportées (comportement inchangé) |
| `web/src/features/effectiveSession/effectiveDay.ts`, `completion/dayCompletion.ts` | `EffectiveDay.realisation` (V2 ou V1) |
| `web/src/features/today/todayContext.ts`, `program/programPresentation.ts` | `WeekDay.realisation` / `stopped` |
| `web/src/components/WeekDaysPicker.tsx`, `today/WeekStrip.tsx`, `program/ProgramWeekTimeline.tsx` | libellés, symbole ◐, légende |
| `web/src/features/program/ProgramSessionCard.tsx` | statut de la carte |
| `web/src/features/history/HistoryDayCard.tsx`, `HistoryGuidedRealisation.tsx`, `guidedHistory.ts` | Historique : carte, ligne, détail |
| `web/src/features/guidedSession/DaySessionEntryCard.tsx`, `pages/TodayPage.tsx` | note partielle sur l'entrée d'Aujourd'hui |
| `web/src/features/afterSession/AfterSessionEntry.tsx`, `afterSessionPresentation.ts` | « Après ta séance » |
| Tests | 5 nouveaux fichiers (21 tests) ; 2 attentes adaptées (§ 5) |
| Docs | ADR PARTIAL-01 (`docs/11`), backlog et statut (CONSISTENCY-02 noté CLOSED en production), ce rapport |

## 5. Tests

**Reproduction avant / après**

| Test | Avant (`940bb75`) | Après |
|---|---|---|
| Bandeau Aujourd'hui, 7 cas (complète, partielle, illisible, arrêtée, non commencée, V1 partielle, V1 faite) | échec : partielle, illisible et V1 partielle « Réalisée » ; arrêtée « Prévue, non enregistrée » | ✓ |
| Bandeau Programme, mêmes 7 cas | échec (idem) | ✓ |
| Carte du Programme, partielle / complète | échec (« Réalisée ») | ✓ |
| Historique, partielle / complète | échec (« ✓ Séance guidée terminée ») | ✓ |
| Entrée d'Aujourd'hui, partielle / complète | échec | ✓ |
| « Après ta séance », partielle | échec | ✓ |
| « Après ta séance », complète ou illisible | ✓ | ✓ |
| Règle de réalisation (Force, DH, endurance, corrections) : 5 tests | module absent | ✓ |
| Lecture : complète, partielle, arrêtée ignorée, aucune lecture sans séance terminée, pages successives, lecture incomplète, échec, prescription non décodable : 6 tests | module absent | ✓ |
| **Intégration, pile locale à 75 migrations, RLS réelle** : Force complète → « complete », Force à 1 série → « partial », détail de l'Historique réel, autre rider : rien de lisible (3 tests) | module absent | ✓ |

**Deux attentes existantes adaptées.** `HistoryDetailPage.test.tsx` et `p0_4GuidedHistory.integration.test.tsx` enregistrent chacun une séance Force **partielle** : 2 séries d'un seul exercice, sur une prescription qui en compte davantage. Elles attendaient « ✓ Séance guidée terminée », c'est-à-dire le défaut lui-même. Elles attendent maintenant « ◐ Séance guidée partiellement réalisée ». Rien d'autre n'y change.

**Suites**
- **web** : **2324/2324** (172 fichiers, intégrations comprises) = 2303 existants + 21 nouveaux. Pile locale à 75 migrations, identique à la production ; fonctions Edge servies.
- **Vérification de types web** : build OK. `tsconfig.app.json` signale les mêmes 17 fichiers de test que `940bb75`, aucun nouveau.
- **Build web** : OK ; le bundle contient les nouveaux libellés.
- **Lint** (`oxlint`) : code de sortie 0, aucun avertissement sur les fichiers modifiés.
- **Moteurs, Edge, SQL** : aucun fichier modifié (`git diff` limité à `web/` et `docs/`).

## 6. Risques et compatibilité

- **Compatibilité** :
  - aucune migration, aucune fonction Edge, aucun moteur modifié ;
  - lectures de tables existantes déjà ouvertes au rider par RLS (`decision_final_prescriptions`, `exercise_set_results`) ;
  - compatible avec la base 75.
- **Coût** : deux lectures de plus, seulement s'il y a des séances guidées terminées dans la période affichée.
  - Une semaine (Aujourd'hui, Programme) : quelques exécutions.
  - L'Historique : 120 décisions au plus, environ 3 à 4 Ko de prescription par séance.
- **Échec de lecture** : « Terminée » au lieu de « Réalisée » dans les bandeaux et la carte du Programme ; ailleurs, les libellés d'avant.
- **Données historiques** :
  - les séances V2 passées sont qualifiées dès que leur prescription figée se décode avec le catalogue actuel ;
  - sinon elles restent neutres (« Terminée ») ;
  - les débriefs V1 gardent leur `completion_status` explicite ;
  - aucune donnée n'est réécrite ni complétée.
- **Cas limite** : un exercice de travail mesuré en distance ne peut pas être saisi dans l'écran Force (repli fermé existant). Une telle séance serait toujours partielle, comme l'écran le dit déjà au moment de terminer. Le catalogue actuel n'en contient aucun.
- **Préservés** :
  - P0-SAFE et suspensions santé : écrans et libellés inchangés ;
  - CONSISTENCY-01 et -02 ;
  - verrou d'une séance principale par jour ;
  - historique réel ;
  - séances guidées déjà terminées : aucune écriture ;
  - compatibilité V1 / V2.

## 7. Points à arbitrer (HPM)

1. **Charge M1 d'une séance V2 partielle.** Le pont transmet la séance prescrite en `done`. M1 compte une séance partielle comme faite par conception (V0.3_007B) : c'est donc conforme. La charge réelle d'une séance très incomplète est cependant surestimée. Une pondération serait une évolution du moteur gelé, par ADR. Aucun changement ici.
2. **Moteur longitudinal et génération de plan** : ils ne lisent que les débriefs V1, jamais les exécutions V2. C'est une limite existante, inchangée.
3. **Compteur « N réalisées »** de la semaine : il compte toujours une séance partielle, comme avant et comme M1. À confirmer, ou à remplacer par « N réalisées, dont 1 partielle ».
4. **Libellés** à valider : « Partiellement réalisée » (◐), « Terminée » quand la réalisation est illisible, « Arrêtée » pour une tentative arrêtée, et la note « Partiellement réalisée : une partie de la séance prévue n'a pas été enregistrée. ».
5. **`docs/10_TEST_PLAN.md`** : je propose d'y ajouter les scénarios du § 5 (complet, partiel, arrêté, non commencé, illisible), après accord.

## 8. Commit local

Voir le message de commit sur `fix/partial-01-partial-sessions` (sur `940bb75`). Aucun push.
