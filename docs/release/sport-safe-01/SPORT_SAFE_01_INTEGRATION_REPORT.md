# SPORT_SAFE_01_INTEGRATION_REPORT — finition UX (R.4) et intégration locale

**Date** : 2026-10-19 · **Pour** : HPM et Louis · **Verdict : LOCAL INTEGRATED.**

Branche d'intégration locale `int/sport-safe-01`, créée depuis `99d2add` (production) ; merge `7f57cd6` de `fix/sport-safe-01` (tête `12bc0f6`). Ce rapport est committé par-dessus.

Hors périmètre de cette mission, rien n'a été fait :
- `origin/main` n'est pas touché ;
- aucun push, migration, déploiement ;
- aucun flag ni dose modifié.

---

## 1. Les trois arbitrages HPM appliqués

Tous sont des changements de présentation : les décisions enregistrées ne sont jamais réécrites.

### 1. Moins de 20 min disponibles (refus A04, aucune alternative A10)

**Ce que montre Aujourd'hui** (carte de mission) :
- titre « Aucune séance compatible » ;
- « Prévu : Aérobie base (45 min · charge modérée) → Adapté : Aucune séance compatible » ;
- « Tu as indiqué 15 min aujourd'hui. La séance recommandée dure 45 min et NALYNT n'en a pas de version guidée plus légère : aucune séance guidée compatible aujourd'hui. »

**Garanties :**
- « Pourquoi ? » ne garde que les signaux détectés ; « la charge est ajustée » est retiré, puisqu'aucune séance n'est proposée ;
- jamais la séance de 45 min présentée comme disponible, jamais de repos ni de récupération inventée ;
- le refus A04 et l'absence d'alternative A10 sont conservés (moteur inchangé).

**Sources :** le détail du statut bloqué de la décision (`modify_not_supported`, `durationMin`) et le check-in du jour (`available_minutes_today`).

| Temps déclaré | Résultat |
|---|---|
| 15 min | « Aucune séance compatible » |
| 20 min et 30 min | l'alternative (récupération active) |
| 60 min | la décision M1 telle qu'avant ; la séance guidée affiche le message de refus approuvé |

### 2. Libellés trompeurs

**« Nature de la séance préservée » (C3.3)** :
- plus affiché quand le type de séance a réellement changé (séance prévue ≠ séance finale) ;
- il devient « Sommeil insuffisant — adaptation d'intensité. » ; le remplacement endurance → récupération active est expliqué par la phrase A10 (« la séance prévue n'est pas proposée […] Autre séance à la place : récupération active. ») ;
- type inchangé : la mention, vraie, reste ;
- s'applique à « Pourquoi ? », au héros de l'historique, à la liste des règles et à l'objectif.

**« Prêt à performer »** :
- remplacé par la ligne neutre de la décision enregistrée (« Séance maintenue », « Séance ajustée », « Séance remplacée ») dès que la décision porte un signal d'état retenu (fatigue, douleur…), une douleur déclarée ou une protection de M1 ;
- le temps déclaré seul n'est pas un signal d'état : une récupération A10 due au seul temps garde « Nouveau plan — prêt à performer » ;
- Aujourd'hui n'affichait déjà pas ce slogan (carte de mission) ; l'historique est corrigé.

### 3. DH manuelle HEAVY

- Le comportement de production est conservé : KEEP et MODIFY donnent le document MODERATE, 6 passages ; aucune dose HEAVY.
- Les tests de non-régression existent déjà : `sportSafe01RManualModify` (HEAVY → document du KEEP, MODIFY créé) et `sportSafe01.integration` (DH manuelle HEAVY + C3.3 : `created` / `modify`, 6 passages).
- **Risque ouvert** : il bloque la validation du parcours manuel concerné pour une bêta payante.

---

## 2. Fichiers modifiés (R.4)

| Commit | Rôle | Fichiers |
|---|---|---|
| `572b575` | les trois arbitrages (web) | `MissionHero.tsx`, `DailyPlanResult.tsx`, `noCompatibleSession.ts` (nouveau), `safetyPresentation.ts`, `DailyPlanView.tsx`, `DecisionHero.tsx`, `coachInsights.ts` ; tests `sportSafe01R4Presentation` (nouveau), `sportSafe01RTagline`, `todayHistoryLabels` |
| `1add834` | ADR R.4, statut, backlog, preuves à 375 px | `docs/00`, `docs/11`, `docs/12`, `evidence/SPORT_SAFE_01R4_VISIBLE_TEXTS_375.txt` |
| `70f42dd` | correctif trouvé à l'intégration (§4) | `guidedSessionLoader.ts`, test `guidedSessionLoader.guidance` |
| `12bc0f6` | trace du correctif | `docs/11` |

Moteur, base, Edge et canon `docs/04` / `05` / `10` : **aucun changement en R.4**. Le diff de ces chemins depuis `13ecf9e` est vide.

---

## 3. Tests et résultats

**Ciblés, avant l'intégration :**

| Suite | Résultat |
|---|---|
| web `sportSafe01R4Presentation` (15, 20, 30 et 60 min ; libellé C3.3 avec et sans changement de type ; câblage Aujourd'hui) | 14 / 14 |
| web libellés : `sportSafe01RTagline` et `todayHistoryLabels` | 24 / 24 |
| web : plan du jour, séance guidée, prescription V2, historique, Aujourd'hui, pages | 1 026 réussis, 20 ignorés |
| web : **13 fichiers d'intégration** (pile réelle, Edge servi) | 72 / 72, après le correctif `70f42dd` |
| Navigateur réel à **375 px** (pile locale) | 25 pages : Aujourd'hui, séance guidée (avant, en cours, rechargée, terminée en lecture seule), historique de séances adaptées pour fatigue ; **0 débordement horizontal** ; une décision par rider |
| planning-engine différentiel `phys00FlagsOffEquivalence` | 4 / 4, comptes inchangés |

**Après intégration (`7f57cd6`) :**

| Suite | Résultat |
|---|---|
| build planning-engine, head-coach (dist et bundles Edge), web (`tsc` build + Vite) | OK |
| planning-engine : `sportSafe01EnduranceLight`, `sportSafe01RManualModify`, `phys00FlagsOffEquivalence`, `finalPrescriptionV2Adapt` | 56 / 56 |
| Edge, bundles Deno comparés à Node | 57 / 57 |
| head-coach : `sportSafe01.integration`, `applyV2TodayTimeConstraint`, A04, A10, V2 quotidien, P0-3 manuel | 75 réussis, 1 ignoré |
| web unitaires ciblés | 1 026 réussis, 20 ignorés |
| web, 13 fichiers d'intégration, premier passage | **9 échecs**, causés par un redémarrage du runtime Edge local pendant le passage (conteneur relancé juste après la reconstruction des bundles) |
| même suite rejouée sur un runtime stable | **72 / 72** — même arbre que la branche corrigée, déjà à 72 / 72 avant le merge |

---

## 4. Anomalie trouvée pendant l'intégration, et sa correction

Le premier passage des tests d'intégration web s'est fait après un premier merge local (`6534e7e`). Ces tests n'étaient pas actifs dans mes passages ciblés précédents, faute du runtime Edge et de l'environnement local.

**Ce qu'ils ont révélé :** une régression introduite par A1 (`ab6b3a3`).
- Le loader de la séance guidée relisait la décision de l'exécution (`loadDecisionById`).
- Cela cassait son contrat de lectures constantes : le test UX-11C.5 voyait une requête `/rest/v1/decisions` de plus.
- Un deuxième test a échoué en cascade.

**Ce que j'ai fait :**
1. Arrêt de l'intégration.
2. Correctif sur `fix/sport-safe-01` (`70f42dd`) : la décision du jour, déjà lue pour la garde santé, est réutilisée quand c'est celle de l'exécution. Mêmes consignes, même sémantique figée. Un test unitaire couvre cette réutilisation.
3. Les 13 fichiers d'intégration à 72 / 72.
4. **Intégration refaite proprement** depuis `99d2add` : le merge local `6534e7e`, jamais poussé, est remplacé par `7f57cd6`.

---

## 5. Comparaisons avec la production (`99d2add`)

**Différentiel flags OFF (moteur inchangé en R.4)** :

| Périmètre | Résultat |
|---|---|
| Planifié, 47 970 cas | 192 différences : 128 refus (32 sans temps, 96 temps non évalué) et 64 alternatives égales à la récupération A10 de production, avec `refusedModify` en plus |
| Manuel, sans la séance avant M1 | 11 088 cas identiques |
| Manuel, avec la séance avant M1 | 1 848 cas ; refus et alternatives pour l'endurance et la récupération `MODERATE` seulement ; 264 cas HEAVY identiques à la production |
| Hors différentiel (temps < 20 min, vrai moteur) | production : REST ; branche : refus `no_alternative` |

**Aucune différence métier supplémentaire en R.4** : présentation seulement.

**Livraison :**
- seul le bundle `dailyRunV2` diffère de la production ; `generateTrainingPlan.bundle.js` est identique octet pour octet ;
- une release toucherait `daily-run` et le web ;
- aucune migration, aucun flag.

**Branche complète depuis `99d2add`** :
- canon `docs/04` / `05` / `10` : uniquement `949c09c`, patch identique (vérifié) ;
- 0 ligne dans M1, 0 fichier `supabase/` ;
- aucune fonctionnalité hors périmètre.

---

## 6. Commits et état Git

**Commits de `fix/sport-safe-01`, depuis `99d2add` :**

| Étape | Commits |
|---|---|
| SPORT-SAFE-01 | `5067a35` |
| R | `4181de5`, `5ea811d`, `ab6b3a3`, `609b8d8` |
| R.2 | `b36317f`, `08fdc76`, `619c479` |
| R.3 | `c22a381`, `570ae34`, `949c09c` (canon), `13ecf9e` |
| R.4 | `572b575`, `1add834`, `70f42dd`, `12bc0f6` |

**Branche d'intégration `int/sport-safe-01` :**
- merge `7f57cd6` (parents `99d2add`, `12bc0f6`), arbre identique à `12bc0f6` ;
- puis le commit de ce rapport ; son SHA est donné à la livraison (un commit ne peut pas contenir son propre SHA).

**Rien n'est poussé** ; `origin/main` est inchangé.

---

## 7. Risques sportifs encore ouverts (bloquants pour une bêta payante, pas pour l'intégration)

- **DH manuelle HEAVY (B4).** Le KEEP est déjà réduit implicitement à MODERATE, sans règle canonique explicite. Le parcours manuel concerné n'est pas validé.
- **B1 — vraie dose LIGHT d'endurance.** « Réduire l'intensité globale (RPE cible réduit) » s'affiche au-dessus d'une endurance de 45 min à RPE 3–4 (cas 60 → 45).
- **B3 — durée LIGHT d'une endurance manuelle.** Une endurance manuelle de 60 min est refusée, pas réduite.
- **A2 à A5** : DH sous douleur, durée, confirmation du rider, crédit V2-L2.
- **Observations hors des trois arbitrages, non modifiées :**
  - l'« État du corps : Prêt » de P0-SAFE s'affiche un jour de fatigue (il ne porte que sur les signaux de santé) ;
  - la bande « Cette semaine » montre la séance du programme prévu (« Aérobie base 45 min ») le jour d'un refus.

---

## 8. Verdict : **LOCAL INTEGRATED**

**Ce qui est fait :**
- les trois arbitrages HPM sont appliqués ;
- tous les tests ciblés passent après intégration, ainsi que les 13 fichiers d'intégration web rejoués sur un runtime stable ;
- le différentiel est inchangé ;
- l'intégration locale est faite (`int/sport-safe-01`).

**Restent bloquants pour la bêta payante :** les risques sportifs du §7.

Aucune publication en production sans nouveau GO HPM.
