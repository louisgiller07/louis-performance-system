# CONSISTENCY_01_REPORT — Aujourd'hui / Programme (O-43 / O-46)

**Date** : 2026-10-16 · **Pour** : HPM et Louis · **Statut** : local uniquement.

Rien n'a été touché en dehors du poste local :
- aucune modification de la production ;
- aucun push ni merge, aucun déploiement ;
- V2, PHYS et JARVIS non touchés.

**Verdict : READY LOCAL.** Avant toute release, trois décisions HPM sont nécessaires (§6).

| | |
|---|---|
| Branche | `fix/consistency-01-today-programme` (locale), depuis `a188a1f` (production REL-01 D′) |
| Pile de test | `nalynt-gate01`, schéma identique à la production (74), puis 75 avec la migration ; données fictives ; cible vérifiée (QA-ISOLATION-01) |

## 1. Cause racine (prouvée)

Il y a **deux sources de vérité**, et la projection ne fait jamais converger les séances manuelles.

**Aujourd'hui (mission du jour)**
- `DailyPlanPanel` affiche la décision de `daily-run`.
- `runDailyFor` → `buildRawContext` (`head-coach-engine/src/supabase/buildRawContext.ts:118`) → `getPlannedSessionFor` (`repositories/plannedSessionsRepo.ts:18-36`).
- Cette lecture prend **la ligne `planned_sessions` de la date, quelle que soit sa source**.

**« Prochaine étape » et `/plan`**
- `loadTodayContext` → `loadPlannedSessions` (`web/src/features/today/todayContextRepo.ts:126`) → `nextPlannedSession` (`todayContext.ts:179-186`).
- C'est la même table `planned_sessions`.

**Programme (`/training-plan`)**
- `TrainingPlanPreviewPage` lit `training_plan_generated_sessions` de la version courante (`trainingPlanReviewRepo.ts:386`).
- Le badge « Modifiée par toi » vient de `getManualPlannedDates`, limité aux jours où le programme a une séance (`TrainingPlanPreviewPage.tsx:124-139`).
- Conséquence : un jour de repos du programme n'est jamais affiché, et un jour modifié montre le contenu du programme.

**Pourquoi une séance manuelle persiste après un changement de plan**
- `project_training_plan` (dernière version `20261013180200`) donne `skipped_manual_override` à **toute** ligne dont la source n'est pas `generated`.
- Sa réconciliation PILOT_022 (étape 1b) ne retire que les lignes `generated` d'une autre version.
- Une ligne manuelle n'est donc jamais touchée, quel que soit son âge. C'était une règle voulue (REV-03, 2026-09-24 : « Les séances manuelles ne sont jamais touchées »).
- La contrainte `unique (athlete_id, planned_date)` aggrave le cas : la ligne manuelle occupe aussi la place de la séance du programme ce jour-là.

**Rôle des différents éléments**
- **Dates** : fenêtre de projection (`p_window_start` = aujourd'hui) et horizon de la version.
- **Statuts** : un jour utilisé est verrouillé (`skipped_completed`, P0-3).
- **Identifiants de plan** : la lignée `source_plan_version_id` est ignorée pour une ligne manuelle (REV-02, F3).
- **Origine** : `source` vaut `manual` par défaut (baseline). Une ligne héritée des simulations, de la saisie V1 ou d'un programme antérieur est donc indiscernable d'une modification récente, sauf par sa date d'écriture.

**Preuve « avant »** sur le schéma de production (74), avec `consistency01TodayProgramme.integration.test.ts` : **7 tests échouent sur le défaut**.
- La ligne DH 240 min HEAVY reste la séance du jour.
- Elle reste annoncée en « Prochaine étape », même sous signal santé.
- Les champs manuels sont conservés.

Les **2 contre-épreuves passent** : modification du rider après l'acceptation, et séance guidée en cours.

## 2. Règle retenue

Elle s'appuie sur la source de vérité existante : la projection, qui fait déjà converger `planned_sessions` vers le programme (PILOT_022).

- **Référence** : `training_plan_current_version.updated_at`, le moment où le programme est devenu courant (écrit à l'acceptation ; inchangé par un rejeu idempotent).
- **Ligne manuelle écrite après ce moment** : c'est la modification du rider, qui fait partie du programme actif. Elle n'est **jamais touchée** (V06-02, UX-10B-2B, P0-3 inchangés).
- **Ligne manuelle plus ancienne**, datée à partir de la fenêtre (aujourd'hui) et dans l'horizon du programme : **remplacée par la séance du programme** (`projected`, sans reprendre engagement, intention ni note), ou **retirée** un jour de repos du programme (`removed_superseded`). C'est le traitement que PILOT_022 applique déjà aux lignes générées d'un plan remplacé.
- **Jamais touchés** :
  - un jour utilisé (séance guidée commencée ou terminée, débrief V1) ;
  - le passé (avant la fenêtre) ;
  - les dates hors horizon ;
  - les décisions, exécutions, débriefs et blocs.
- **Santé** : M1 est inchangé, Safety reste prioritaire. Une décision du jour calculée sur une ancienne ligne devient non courante (REV-01) et se recalcule.
- **Identification** : « Prochaine étape » affiche « Modifiée par toi » (fait V06-02 existant) pour une séance du rider, comme Programme et `/plan`.

## 3. Fichiers modifiés

| Fichier | Changement |
|---|---|
| `supabase/migrations/20261016120000_consistency_01_superseded_manual_projection.sql` | `create or replace` de `project_training_plan` seulement. Vocabulaire de résultats existant, donc aucun changement TypeScript ni Edge. Signature, `SECURITY DEFINER`, `search_path` et droits inchangés (vérifiés) |
| `supabase/rollbacks/consistency01/20261016120000_rollback_superseded_manual_projection.sql` | corps et droits exacts de `20261013180200` |
| `web/src/features/today/NextStepCard.tsx` | mention « Modifiée par toi » si `source = 'manual'` (donnée déjà lue) |
| `web/src/features/today/todayCoachCards.test.tsx` | +1 test |
| `head-coach-engine/tests/supabase/consistency01TodayProgramme.integration.test.ts` | nouveau, 9 scénarios |
| `head-coach-engine/tests/supabase/pilot022Consistency.integration.test.ts` | **REV-03 adapté** (§6, décision 1) |
| `docs/11_DECISION_LOG.md`, `docs/12_BACKLOG.md`, `docs/00_PROJECT_STATUS.md` | ADR CONSISTENCY-01, backlog, statut |
| `docs/release/consistency-01/` | ce rapport ; mesure d'impact en lecture seule pour la production |

**Non modifiés** :
- M1 (`src/{types,engine,rules,domains,mapping}`), les moteurs, les fonctions Edge. Les graphes `build:release:all --verify-only` sont identiques à la production D′, donc aucun redéploiement Edge.
- `docs/05_DATA_MODEL.md` : diff proposé au §7, non appliqué.

## 4. Tests avant / après

| Scénario HPM | Test | Avant (74) | Après (75) |
|---|---|---|---|
| Nouveau programme après une ancienne séance manuelle (jour de repos) | repos conservé ; ni la séance du jour ni « Prochaine étape » ne montrent la DH 4 h | échec | ✓ |
| Ancienne séance un jour du programme | séance, lignée et prescription du programme (`generated`, version courante) | échec | ✓ |
| Champs propres à la ligne manuelle | engagement, intention et note non repris | échec | ✓ |
| Séance manuelle le même jour qu'une prescription, et séance ajoutée un jour de repos, **après** l'acceptation | conservées ; prescription `manual_override_new_kind` (P0-3) | ✓ | ✓ |
| Jour de repos avec séance historique | jour passé : ligne et décision intactes ; aucun doublon ni disparition dans les décisions et débriefs | échec | ✓ |
| Changement de date | la réconciliation suit le jour du run ; l'ancienne décision devient non courante, la nouvelle suit le programme | échec | ✓ |
| Séance guidée en cours | jour verrouillé (`skipped_completed`), exécution intacte | ✓ | ✓ |
| Signal santé bloquant | REST A7 ; l'ancienne DH n'est plus annoncée | échec | ✓ |
| Hors programme actif | après l'horizon : inchangé ; appel sans fenêtre : inchangé | échec | ✓ |

**Suites après correction** (pile 75, Edge servies depuis la branche) :
- head-coach-engine **1464/1464** : suite complète 1457, plus deux fichiers relancés seuls, `pilot022Consistency` 6/6 après adaptation de REV-03 et `t17_planningE2E` 8/8 (interrompu par un crash du worker vitest) ;
- web **2275/2275** (163 fichiers, intégrations comprises) ;
- build web OK, typecheck OK.

Seul échec réel avant adaptation : REV-03 (§6).

## 5. Risques de régression

| Risque | Traitement |
|---|---|
| **Modifications du rider faites sous l'ancien programme** : dans l'horizon du nouveau, à partir d'aujourd'hui, elles sont remplacées ou retirées à l'acceptation. L'aperçu d'un brouillon ne l'annonce pas, et la promesse UX-10B-2B (« Cette journée sera conservée comme une modification de ton planning ») ne vaut plus que jusqu'au programme suivant | décision HPM (§6.1) ; un texte d'avertissement à l'acceptation est proposé en suite, non fait |
| **Écriture en production à la livraison** : au premier daily-run de chaque rider (projection configurée en production) et à toute acceptation, les anciennes lignes manuelles d'aujourd'hui à la fin de l'horizon sont remplacées ou retirées. Ces lignes futures ne sont pas restaurées par le rollback SQL | mesurer d'abord avec `CONSISTENCY_01_IMPACT_READONLY.sql` (Louis, lecture seule) |
| **Le jour de la livraison**, une décision du jour calculée sur une ancienne ligne devient non courante : Aujourd'hui affiche « Ta séance prévue a changé » et propose de relancer | comportement REV-01 voulu |
| **Transition** : avant son premier daily-run, un rider peut encore voir une ancienne ligne en « Prochaine étape » | une seule fois, jusqu'au premier check-in |
| Lignes manuelles datées après l'horizon du programme | inchangées (aucun programme pour ces dates). Le contenu V2 y est déjà refusé (`manual_session_outside_current_plan`) |
| Concurrence | même verrou par athlète (pris avant la lecture) ; verrou du jour respecté ; une requête de plus par projection |
| Plans V1 | même règle (la projection est la même) |

## 6. Décisions HPM nécessaires avant release

1. **Contrat PILOT_022 REV-03 (2026-09-24)** : « Les séances manuelles ne sont jamais touchées ».
   - La règle CONSISTENCY-01 le renverse pour une modification faite sous l'ancien programme. Le test REV-03 a été adapté dans ce sens :
     - la modification faite sous A, sur une date propre à A, est retirée à l'acceptation de B ;
     - une modification faite après B est conservée (contre-épreuve ajoutée).
   - **À confirmer.** Variante possible : ne superséder que les lignes antérieures à la **première** acceptation d'un programme du rider (lignes héritées de la saisie V1 ou des simulations). Elle préserverait REV-03, mais laisserait les modifications faites sous un ancien programme devenir la mission.
2. **Canon** : accord sur le diff de `docs/05_DATA_MODEL.md` (§7).
3. **Avertissement à l'acceptation** : l'ajouter dans un ticket séparé, ou accepter le risque.

## 7. Diff proposé pour `docs/05_DATA_MODEL.md` (non appliqué)

À ajouter dans le paragraphe P0-3, après « Lignée d'une écriture manuelle (F3) » :

```diff
+- **Séance manuelle antérieure au programme actif (CONSISTENCY-01, HPM 2026-10-16, migration `20261016120000`)** :
+  une ligne `manual` fait partie du programme actif si elle a été écrite après que ce programme est devenu courant
+  (`training_plan_current_version.updated_at`) ; elle n'est alors jamais touchée (V06-02, UX-10B-2B, P0-3). Plus
+  ancienne, datée à partir de la fenêtre de projection dans l'horizon du programme, elle est remplacée par la séance du
+  programme (`projected`, sans engagement, intention ni note) ou retirée un jour de repos du programme
+  (`removed_superseded`), comme une ligne générée d'un plan remplacé (PILOT_022). Jour utilisé (`skipped_completed`),
+  dates avant la fenêtre ou hors horizon, appels sans fenêtre : inchangés. Décisions, exécutions et débriefs ne sont
+  jamais réécrits. Rollback : `supabase/rollbacks/consistency01/`.
```

## 8. Livraison (proposée, non exécutée) et retour arrière

- **Ordre** :
  1. mesure d'impact (Louis, lecture seule) ;
  2. `db push` de la seule migration `20261016120000`, puis contrôle du corps et des droits ;
  3. web (push fast-forward de `main`, GO distinct) ;
  4. aucune fonction Edge.
- **L'ordre est libre** : le web seul ne change que la mention ; la migration seule n'exige aucun changement Edge ni web.
- **Retour arrière** :
  - rejouer le script `supabase/rollbacks/consistency01/` comme nouvelle migration (corps exact de `20261013180200`) ;
  - web par promotion Vercel ;
  - les lignes déjà remplacées ou retirées ne sont pas restaurées.

## Hors périmètre (non corrigé)

O-32 (mission de la veille), la présentation de la complétion partielle, PHYS et O-45 sont inchangés.
