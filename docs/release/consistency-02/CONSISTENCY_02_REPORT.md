# CONSISTENCY_02_REPORT — Aujourd'hui représente la date courante (O-32)

**Date** : 2026-10-17 · **Pour** : HPM et Louis · **Statut** : local uniquement.

Rien n'a été touché hors du poste local :
- aucun déploiement, aucun push ;
- aucune écriture en production ;
- V2, PHYS et JARVIS non touchés.

**Verdict : READY LOCAL.**

Branche `fix/consistency-02-stale-today-mission`, depuis `31ca956` (production : web `31ca956`, base 75).

## 1. Cause racine (prouvée)

Quatre défauts côté client, sur le même chemin. Les numéros de ligne renvoient à `31ca956`.

1. **La mission de la veille reste affichée** (`web/src/features/dailyPlan/DailyPlanPanel.tsx`, `restoreTodayDecision`, environ l. 147-178)
   - Au changement de date, le panneau, resté monté, relit la décision de la nouvelle date.
   - Il ne vide jamais `result`, `state`, `finalPrescriptionV2`, `invalidatedNotice` ni `freshRun`.
   - Sans décision pour le nouveau jour, la mission de la veille reste affichée comme mission du jour.
   - Avec une décision périmée, l'avis « Ta séance prévue a changé » s'affiche à côté d'elle, et le bouton reste masqué parce qu'un résultat existe.
   - L'entrée de séance guidée reçoit encore `finalPrescriptionCreated` de la veille.
2. **Les réponses tardives ne sont pas filtrées par date**
   - Une restauration (`loadLatestDecisionForDate` / `loadDecisionCurrency`) ou une analyse (`runDailyRun`) lancée pour la veille et terminée après le changement écrit son résultat.
   - La seule garde existante porte sur la révision du check-in (`latestRevisionRef`), jamais sur la date.
3. **Une page ouverte ne change jamais de jour d'elle-même** (`web/src/lib/simulationClock.ts`, `useEffectiveToday`, l. 51-57)
   - `todayLocal()` (fuseau de l'appareil) est recalculé à chaque rendu.
   - Aucune minuterie ni écoute du retour sur l'onglet : une page ouverte après minuit reste sur la veille jusqu'à un rendu fortuit, puis bascule au milieu de l'écran (défaut 1).
   - **Conséquence aggravante** : un check-in saisi le matin dans l'onglet de la veille est enregistré, et analysé, pour la date d'hier. `CheckinForm` et `runDailyRun` reçoivent `canonicalDate`, et `supabase/functions/daily-run/index.ts` accepte toute date valide, ce qui est voulu pour la simulation.
4. **Une séance guidée en cours disparaît à minuit** (`web/src/pages/GuidedSessionPage.tsx`, l. 13-14, avec `useGuidedSession.ts`, l. 56-66)
   - La date change au premier rendu après minuit, et `useGuidedSession` recharge alors le nouveau jour.
   - Une séance en cours disparaît de l'écran. Les données restent en base.

**Ce qui n'est pas en cause**
- **Le serveur** : `daily-run` ne crée une décision qu'à l'appel ; la séance guidée ne démarre que depuis une décision courante de sa date.
- **Le « +1 jour » de simulation** : il change la date en `sessionStorage`, et la page se rend à nouveau. C'est le même défaut 1, avec un déclencheur systématique.
- **La relecture de `CheckinForm`** : elle suit bien la date. Seuls son étape et son état de saisie restaient ceux de la veille.

## 2. Comportement avant / après

| Situation | Avant | Après |
|---|---|---|
| Onglet ouvert à minuit | reste sur la veille, sans limite de temps | passe au nouveau jour à minuit (minuterie locale, réarmée chaque jour) |
| Retour sur l'onglet le lendemain | reste sur la veille | nouveau jour dès que l'onglet redevient visible ou reprend le focus |
| Nouveau jour sans décision | mission de la veille affichée comme celle du jour | invitation au check-in, ou « Préparer ma séance du jour » si le check-in est fait |
| Nouveau jour, décision périmée | avis à côté de la mission de la veille, sans bouton | avis et bouton, rien de la veille |
| Restauration ou analyse de la veille terminant après minuit | affichée, et remontée comme décision du jour | ignorée. La décision existe pour sa propre date, dans l'historique |
| Check-in saisi le matin dans l'onglet de la veille | enregistré pour hier | la page est déjà sur le jour courant |
| Séance guidée en cours à minuit | disparaît de l'écran | garde son jour jusqu'à sa fin (reprise, arrêt sûr, résultats) |
| Séance prête à démarrer d'hier | pouvait démarrer depuis un écran resté ouvert | l'écran passe au nouveau jour : jamais de démarrage depuis la prescription d'hier |
| Signal santé bloquant | repos santé de la veille possiblement affiché | rien de la veille ; la suspension du jour suit les signaux ouverts, comme avant |
| Simulation « +1 jour » | mission de la veille conservée | nouveau jour simulé propre ; minuit réel ne déplace jamais la date simulée |

## 3. Règle produit appliquée

- Tout ce qu'Aujourd'hui affiche appartient à la date courante.
- Sans décision courante pour ce jour : un état explicite (check-in d'abord, ou « Préparer ma séance du jour »), jamais la mission d'un autre jour.
- Aucune opération serveur nouvelle, aucune génération automatique : `daily-run` ne part toujours qu'à l'enregistrement du check-in, au bouton, ou à la clôture d'un signal.
- Une séance guidée commencée garde son jour jusqu'à sa fin.
- Le fuseau est inchangé : celui de l'appareil, comme avant.

## 4. Fichiers modifiés

| Fichier | Changement |
|---|---|
| `web/src/lib/simulationClock.ts` | `useEffectiveToday` suit le calendrier : minuit local réarmé, `visibilitychange`, `focus`, aucun rendu le même jour. Nouvelle fonction `msUntilNextLocalMidnight` |
| `web/src/features/dailyPlan/DailyPlanPanel.tsx` | remise à zéro au rendu qui reçoit une nouvelle date ; gardes de date sur restauration et analyse |
| `web/src/pages/TodayPage.tsx` | état du jour vidé au changement de date ; `CheckinForm` et `AfterSessionEntry` remontés par date |
| `web/src/pages/GuidedSessionPage.tsx` | jour figé seulement pendant une séance en cours |
| Tests | `consistency02DateChange.test.tsx` (7), `consistency02Today.test.tsx` (6), `GuidedSessionPage.consistency02.test.tsx` (4), `TodayPage.test.tsx` (+2) |
| Docs | ADR CONSISTENCY-02, backlog, statut (CONSISTENCY-01 noté CLOSED en production), ce rapport |

## 5. Tests de reproduction avant / après

Horloge contrôlée (minuterie et `Date` simulées).

| Scénario | Avant (code `31ca956`) | Après |
|---|---|---|
| Avant et après minuit, onglet ouvert | échec | ✓ |
| Retour sur l'onglet le lendemain | échec | ✓ |
| Même jour : aucun nouveau rendu | ✓ | ✓ |
| Changement d'heure Europe/Zurich (25 h et 23 h ; nuit d'octobre traversée) | échec (2) | ✓ |
| Simulation « +1 jour » distincte du calendrier réel | ✓ (minuit réel ne la bouge pas) | ✓ |
| Décision de la veille, aucune décision aujourd'hui (sans check-in, puis avec) | échec (2) | ✓ |
| Décision périmée aujourd'hui | échec | ✓ |
| Réponse tardive de la veille | échec | ✓ |
| Analyse de la veille en cours au changement de jour | échec | ✓ |
| Repos santé (A7) de la veille et entrée de séance guidée | échec | ✓ |
| Pas de boucle ni de double lecture le même jour | ✓ | ✓ |
| Séance guidée en cours (active, en pause) à minuit | échec (2) | ✓ |
| Rien de commencé, ou tentative arrêtée : le nouveau jour | ✓ | ✓ |
| Page Aujourd'hui : calendrier réel, et « +1 jour » | échec (2) | ✓ |

Total : **14 échecs avant** (sur 19), **19/19 après**.

## 6. Résultats des suites

Pile locale identique à la production (75 migrations), fonctions Edge servies (graphes identiques à la production).

- **web** : **2303/2303** (167 fichiers, intégrations comprises) = 2284 existants + 19 nouveaux.
- **Vérification de types web** : OK. **Build web** : OK. **Lint** (`oxlint`) : code de sortie 0.
- **head-coach-engine** (serveur inchangé), fichiers liés à CONSISTENCY-01 et à la projection : **32/32**.
  - CONSISTENCY-01 10/10 ;
  - PILOT_022 ;
  - `projectTrainingPlan` ;
  - verrou du jour P0-3.
- **Graphes Edge** : identiques à la production. Aucune migration.

## 7. Risques et compatibilité avec les 75 migrations

- **Compatibilité** :
  - aucune migration, aucune fonction Edge (graphes identiques à la production) ;
  - aucune nouvelle requête : les mêmes lectures sont refaites pour le nouveau jour ;
  - compatible avec la base 75 (suites jouées sur une pile locale à 75, identique à la production).
- **CONSISTENCY-01 inchangé** : ses tests web et d'intégration passent, et aucune ancienne séance manuelle ne redevient une prescription.
- **Tous les écrans utilisant `useEffectiveToday` suivent maintenant le jour** : Programme, Historique, `/plan`, courses, premier lancement. Ils se rendent à nouveau à minuit ou au retour sur l'onglet si le jour a changé. Lecture seule ; aucun appel serveur ajouté hors des rechargements existants.
- **Une analyse de la veille terminée après minuit reste une décision de la veille** : elle est enregistrée côté serveur (append-only) et visible dans l'historique. Pendant qu'elle se termine, un clic sur « Préparer ma séance du jour » est ignoré (protection existante contre les doubles envois) : quelques secondes au plus.
- **Fuseau inchangé** : pour un rider hors du fuseau de Zurich, minuit est celui de son appareil, comme avant. L'acceptation de programme utilise toujours Europe/Zurich (inchangé).
- **Onglets en arrière-plan** : les navigateurs ralentissent leurs minuteries. Le retour au premier plan couvre ce cas.

## 8. Commit local

Voir le message de commit sur `fix/consistency-02-stale-today-mission` (sur `31ca956`). Aucun push.
