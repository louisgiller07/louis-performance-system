# CONSISTENCY_01_FINAL_REPORT

**Date** : 2026-10-16 · **Pour** : HPM et Louis · **Statut** : local uniquement.

Rien n'a été touché hors du poste local :
- aucun push, aucun déploiement, aucune écriture en production ;
- V2, PHYS et JARVIS non touchés.

**Verdict : READY LOCAL.** NO GO production : décision HPM en attente.

Base : `50eaa18` (accepté READY LOCAL sur le fond). Branche `fix/consistency-01-today-programme`.

## 1. Règles finales implémentées

**Projection** (migration `20261016120000`, inchangée depuis `50eaa18`)
- Une séance manuelle écrite **après** l'acceptation du programme actif est une modification de ce programme : elle reste protégée.
- Une séance manuelle **plus ancienne**, future et non commencée, dans l'horizon du nouveau programme, est remplacée par la séance du programme, ou retirée un jour de repos du programme.
- Jamais touchés : le passé, un jour utilisé (séance commencée ou terminée, débrief), les dates hors horizon, les résultats.
- La santé reste prioritaire (M1 inchangé).

**Avertissement à l'acceptation** (web)
- Dans l'étape de confirmation existante, quand des modifications manuelles futures seraient remplacées :
  - le texte HPM s'affiche : « En acceptant ce nouveau programme, tes modifications manuelles des prochaines séances de l'ancien programme seront remplacées. Les séances déjà commencées ou terminées restent conservées. » ;
  - le bouton devient « Confirmer et remplacer mes modifications ».
- Sans modification concernée, rien ne change : « Confirmer », aucune étape de plus.
- Deux variantes du texte : premier programme, et vérification illisible (avertissement par prudence, fail closed).
- La confirmation reste désactivée tant que la vérification n'a pas répondu.
- La vérification (`getManualDatesReplacedByAcceptance`) applique la règle de la projection : à partir d'aujourd'hui (Europe/Zurich), dans l'horizon du brouillon, hors jours utilisés.

**Projection différée**
- Si l'acceptation ne projette pas, c'est le daily-run suivant qui remplace (le rider a déjà été averti).
- Une modification faite entre-temps est postérieure à l'acceptation, donc protégée.

**Jour de repos modifié par le rider**
- Partout où la séance apparaît, elle porte « Modifiée par toi » :
  - Aujourd'hui (mission, en KEEP / MODIFY seulement) ;
  - « Prochaine étape » ;
  - frise de la semaine d'Aujourd'hui et frise du Programme.
- La mention n'apparaît jamais après un remplacement par le coach ou un repos.
- Programme ne liste toujours que les séances générées.
- La séance du rider n'est jamais effacée.

## 2. Modifications depuis `50eaa18`

| Fichier | Changement |
|---|---|
| `web/src/features/trainingPlanReview/components/AcceptTrainingPlanButton.tsx` | vérification et avertissement dans la confirmation existante |
| `web/src/features/trainingPlanReview/trainingPlanReviewRepo.ts` | `getManualDatesReplacedByAcceptance` (lecture RLS) |
| `web/src/features/dailyPlan/MissionHero.tsx`, `DailyPlanResult.tsx`, `DailyPlanPanel.tsx`, `web/src/pages/TodayPage.tsx` | « Modifiée par toi » sur la mission |
| `web/src/features/today/todayContext.ts`, `web/src/components/WeekDaysPicker.tsx` | frise de la semaine d'Aujourd'hui |
| `web/src/features/program/programPresentation.ts`, `ProgramWeekTimeline.tsx`, `web/src/pages/TrainingPlanPreviewPage.tsx` | frise du Programme |
| Tests web | `AcceptTrainingPlanButton.test.tsx` (+5), `TrainingPlanPreviewPage.test.tsx` (lecture simulée), nouveau `consistency01RestDay.test.tsx` (4) |
| `head-coach-engine/tests/supabase/consistency01TodayProgramme.integration.test.ts` | +1 test (projection différée), jour de repos du rider servi et jamais retiré |
| `docs/05_DATA_MODEL.md` | diff approuvé appliqué |
| `docs/11_DECISION_LOG.md` | PILOT_022 REV-03 amendé ; ADR CONSISTENCY-01 complétée |
| `docs/12_BACKLOG.md`, `docs/00_PROJECT_STATUS.md` | statut mis à jour |
| `docs/release/consistency-01/CONSISTENCY_01_IMPACT_READONLY.sql` | mesure par catégorie, notes, intentions, origine des lignes |

Aucun changement de migration, de moteur ni de fonction Edge depuis `50eaa18`. Les graphes Edge restent identiques à la production.

## 3. Tests et builds

- **head-coach-engine**
  - CONSISTENCY-01 : **10/10** ;
  - suite complète de `50eaa18` : 1464/1464. Depuis, seuls des tests ont changé ;
  - fichiers liés à la projection relancés sur l'état final (CONSISTENCY-01, PILOT_022, `projectTrainingPlan`, verrou du jour P0-3, séances manuelles P0-3, flux de plan généré) : **51/51**. Un 502 transitoire du runtime Edge local, rechargé pendant la recompilation, a été suivi de 5/5 sur le fichier relancé seul ;
- **web** : **2284/2284** (164 fichiers, intégrations comprises ; 2275 + 9 nouveaux) ;
- **build web** : OK ; **lint** (`oxlint`) : code de sortie 0, aucun avertissement nouveau ;
- **vérification de types** : OK.

## 4. Vérification des jours de repos

**Défaut confirmé** : sur un jour de repos du programme où le rider a ajouté une séance après l'acceptation, la séance était présentée comme une prescription du coach :
- mission d'Aujourd'hui sans mention ;
- frise du Programme montrant la séance décidée sans marque.

**Corrigé côté présentation seulement** (§1), sans toucher à la séance.

**Prouvé**
- Serveur : `daily-run` sert la séance du rider ; une acceptation rejouée et la projection quotidienne la conservent ; le programme garde son repos.
- Web : la mention est présente dans les quatre emplacements. Elle est absente après un REPLACE, un repos santé (A7) ou pour une séance du programme. Un jour de repos futur du Programme reste vide.

## 5. Impact en production (lecture seule, Louis)

`CONSISTENCY_01_IMPACT_READONLY.sql`, exécuté par Louis le 2026-10-16 avec l'identifiant du compte de simulation : **aucune ligne**.
- Aucun rider, aucune séance future remplaçable, aucune note ni intention concernée.
- **Aucun remplacement non consenti ne serait provoqué à la transition**, à cette date.

Comptes de test et vrais comptes : seul le compte de simulation est prouvable (identifiant fourni par Louis). Le schéma n'a aucun autre marqueur ; les autres riders ne sont pas distinguables sans supposition.

## 6. Risques restants

- **La mesure dépend du moment.** Une acceptation faite en production avant la livraison, sans avertissement puisque l'ancien web est en place, crée des lignes « anciennes » non consenties. Il faut relancer la mesure juste avant la livraison et faire un STOP si elle n'est pas vide (hors compte de simulation).
- **Promesse de l'éditeur `/plan`** (UX-10B-2B, « Cette journée sera conservée comme une modification de ton planning ») : elle ne vaut plus que jusqu'au programme suivant. Elle est désormais annoncée à l'acceptation ; texte de `/plan` inchangé.
- **Le jour de la livraison**, une décision calculée sur une ancienne ligne devient non courante : Aujourd'hui affiche « Ta séance prévue a changé » (comportement REV-01). Avec une mesure à 0, aucun rider n'est concerné.
- **Rollback** : il restaure la fonction, pas les lignes déjà remplacées.

## 7. Commit local

`cb350c9` (finalisation, sur `50eaa18`), puis ce correctif de rapport. Aucun push.
