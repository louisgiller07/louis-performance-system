# SPORT_SAFE_RELEASE_01_READINESS_REPORT — finition et préparation de la mise en production

**Date** : 2026-10-19 · **Pour** : HPM et Louis · **Verdict : READY TO DEPLOY**, sous réserve du GO de publication séparé de l'HPM et de Louis.

Branche `int/sport-safe-01`, depuis la production `99d2add` (SQL 76, `daily-run` v45, `generate-training-plan` v29, web Vercel `3w1466ygTa6igF1oswc4bN2eeyBW`).

Rien n'a été exécuté en production :
- aucun push, déploiement, SQL, secret ni flag ;
- `origin/main` reste `99d2add`.

---

## 1. Contrôle UX 1 — « État du corps : Prêt »

**Contrat exact** (`web/src/features/dailyPlan/bodyStatus.ts`, P0-SAFE, HPM 2026-10-12). Trois statuts, lus uniquement depuis la décision persistée :

| Statut | Condition |
|---|---|
| `signal` | signal de santé créé, ou règle Safety A1–A7 |
| `watch` | douleur déclarée et adaptée (`PAIN_NON_SAFETY`) |
| `ready` | rien de tel |

Le test P0-SAFE le fixe explicitement : « fatigue / sleep signals only, or nothing → ready ».

**Le libellé « Prêt » ne veut donc dire que « aucun signal de santé ni douleur déclarée ».** Il ne signifie ni aptitude générale à l'entraînement, ni disponibilité physique optimale.

**Cas réel** (vrai moteur, pile locale) : un jour de fatigue systémique adapté par M1 (C3.3, MODIFY LIGHT) affichait « État du corps : PRÊT ». C'est trompeur.

**Correction** (présentation seulement, commit `d1cef44`) :
- le statut `ready` s'affiche « **Aucun signal de santé** » sur Aujourd'hui, la carte de forme et l'historique ;
- le statut lui-même, P0-SAFE et M1 sont inchangés ;
- la fatigue reste affichée là où elle l'était déjà (« Ce que ton coach a retenu », « Ton état du jour »).

## 2. Contrôle UX 2 — bande « Cette semaine »

**Contrat exact** (`todayContext.ts`, `WeekDaysPicker.tsx`, modèle « séance effective » A07) : un jour décidé montre la séance finale de sa décision (un REPLACE comme son remplacement, un REST comme repos). Les compteurs suivent la règle `weekCounts`.

**Constat avant correction** (vrai web, pile locale) :

| Cas | Affichage | Verdict |
|---|---|---|
| Refus A04 (15 et 60 min) | « Aérobie base · 45 min · Aujourd'hui » | trompeur : séance non démarrable présentée comme celle du jour |
| Endurance manuelle 60 min refusée | « 1 h · Aujourd'hui » | trompeur, idem |
| Récupération active A10 | « Récupération active · Aujourd'hui » | correct |

**Correction minimale** (commit `d1cef44`) :
- le jour effectif porte `noGuidedSession` quand sa décision est un refus `modify_not_supported`, lu dans le statut bloqué persisté ;
- Aujourd'hui et la semaine du Programme affichent alors la séance du coach avec « **Pas de séance guidée** » au lieu de « Aujourd'hui » / « Prévue » ;
- symboles, compteurs, prescriptions persistées et historique sont inchangés ;
- la récupération A10, les autres raisons de blocage et les autres jours sont inchangés.

---

## 3. Corrections de cette mission

| Commit | Contenu |
|---|---|
| `d1cef44` | `bodyStatus.ts` (libellé) ; `effectiveDay.ts`, `todayContext.ts`, `programPresentation.ts`, `WeekDaysPicker.tsx` (« Pas de séance guidée ») ; nouveau test `sportSafeRelease01.test.tsx` ; trois tests mis à jour (ancien libellé « Prêt ») |
| *(ce commit)* | ADR SPORT-SAFE-RELEASE-01, statut, backlog, preuves (`evidence/SPORT_SAFE_RELEASE_01_VISIBLE_TEXTS_375.txt`), ce rapport |

---

## 4. Validation ciblée (mission B)

| Contrôle | Résultat |
|---|---|
| `sportSafeRelease01.test.tsx` : statut et libellés, carte d'état un jour de fatigue, bande pour refus / alternative / autre refus, compteurs et symboles | 6 / 6 |
| web : plan du jour, Aujourd'hui, historique, pages, Programme, séance effective, composants, séance guidée, prescription V2 | 1 103 réussis, 20 ignorés ; `tsc` build et build Vite OK |
| **Navigateur réel à 375 px** (web de la branche, pile locale) | 30 pages, débordement horizontal 0, aucune page d'erreur |
| Liste de l'historique à 375 px | 2 pages, débordement 0 ; « AUCUN SIGNAL DE SANTÉ » tient dans l'en-tête |
| Cas visuels vérifiés | fatigue (« Aucun signal de santé »), douleur (« Douleur signalée », consignes M1), refus A04 15 et 60 min (« Aucune séance compatible » / « Pas de séance guidée »), alternative A10 à 20 et 30 min, séance guidée rechargée, séance terminée en lecture seule, historique |
| « prêt à performer » sur ces scénarios | absent |
| Mention périmée « nature de la séance préservée » | seulement sur l'endurance 60 → 45, où le type ne change pas et où elle est donc vraie |
| **13 fichiers d'intégration web**, runtime Edge local stable | **72 / 72** ; aucun redémarrage du runtime pendant le passage |
| Décisions métier | inchangées : moteur, base et canon identiques depuis `13ecf9e` ; différentiel épinglé (192 / 128 / 64) |

**Échecs intermittents, documentés et non liés au code :**
- **Intégration web.** Au passage précédent (après l'intégration R.4), 9 échecs ont suivi un redémarrage du runtime Edge local pendant le passage ; rejoué : 72 / 72. Ce passage-ci : stable, 72 / 72.
- **Concurrence head-coach.** `p0_3PlannedSessionLock` (concurrence chronométrée), préexistant, rejoué 10 / 10 (R.2 §4).
- **Démarrage du serveur web local.** Il a démarré une fois sans son URL locale (refus « configuration de développement ») ; relancé par un script qui vérifie l'URL locale.

---

## 5. HEAD final

- **Code de la release** : `d1cef44`, merge d'intégration `7f57cd6` inclus.
- **HEAD final** : le commit de ce rapport (documentation seulement ; un commit ne peut pas contenir son propre SHA, il est donné à la livraison).
- **Avance rapide possible** : `99d2add` est un ancêtre de la tête.

---

## 6. Périmètre de publication (mission C)

1. **Diff complet depuis `99d2add`** : 18 commits hors merges, 58 fichiers (+3 699 / −88). Aucun fichier hors des catégories ci-dessous.

| Catégorie | Fichiers |
|---|---|
| Canon normatif | 3 : `docs/04`, `docs/05`, `docs/10` |
| Moteur V2 | 2 : `todayTimeLimitV2.ts`, `buildKeepFinalPrescriptionV2.ts` |
| Adaptateur M2 | 2 : `reconcileFinalPrescriptionV2.ts`, `applyV2TodayTimeConstraint.ts` |
| Web (code) | 17 |
| Tests | 22 |
| Documentation non normative | 12 |

2. **Canon** : seul `949c09c` le modifie ; le patch, vérifié par `git patch-id`, est identique au diff total sur ces fichiers. **M1 : 0 ligne.**
3. **Aucune migration** : 0 fichier `supabase/`. Les deux états persistés tiennent dans le modèle actuel (contraintes CHECK des statuts, `persist_daily_run_v2` inchangé ; rapport R.3 §1). Tests d'intégration sur la pile à 76 migrations.
4. **Fonctions Edge : seule `daily-run` change.**
   - Seules `daily-run` (`dailyRunV2.bundle.js`) et `generate-training-plan` (`generateTrainingPlan.bundle.js`) chargent un bundle.
   - Aucun fichier TypeScript des 10 fonctions n'est modifié (graphe d'imports).
   - `dailyRunV2.bundle.js` : local `8202edc585b3b065…`, build de production `1ad2076d66db0f36…`.
5. **`generate-training-plan` reste identique** : `generateTrainingPlan.bundle.js` est identique octet pour octet au build de `99d2add` (`e7944713d9e04f7f…`). Pas de redéploiement.
6. **Compatibilité avec le web de production, vérifiée dans les deux sens** (pile locale, 375 px, 0 erreur de page, 0 débordement) :
   - **Web de production + nouveau `daily-run`** : 20 pages, toutes les décisions sont lues (refus, alternative, refus manuel, DH HEAVY, séance guidée en cours, historique). En revanche, ce web garde l'**ancienne présentation** : « Adapté 45 min (légère) » avec 15 min, messages génériques, mention « nature préservée », pas de consignes sur la séance guidée.
   - **Nouveau web + `daily-run` de production** : 12 pages, décisions de production lues (fausse copie, REST à 15 min, récupération A10, douleur DH). Les consignes de M1 apparaissent déjà sur la séance guidée.
   - Le web de production (`rc-99d2add`) n'a pas été modifié ; son checkout est resté propre.
7. **Ordre sûr proposé : web d'abord, puis `daily-run`** (§7). Le nouveau web est compatible avec l'ancien `daily-run`. L'inverse ferait voir, le temps de l'écart, les refus avec l'ancienne présentation trompeuse.

---

## 7. Ordre de déploiement proposé (rien d'exécuté)

| Étape | Action | Contrôles | Conditions d'arrêt |
|---|---|---|---|
| **G0** | GO de publication HPM, puis confirmation de Louis | — | absence de l'un des deux |
| **P1, précontrôles (lecture seule)** | Production toujours égale à la référence. Checkout de release `nalynt-rc-<SHA final>` propre, `npm ci`, `build:release` | SQL 76 (`migration list`) ; `daily-run` v45 (ezbr `c966c836…`) ; `generate-training-plan` v29 (ezbr `2868800a…`) ; autres fonctions inchangées ; secrets inchangés, noms seulement (Louis) ; flags PHYS / V2-L2 absents ; Vercel `3w1466yg…` ; empreintes locales `dailyRunV2` = `8202edc5…` et `generateTrainingPlan` = `e7944713…` | tout écart avec la référence ; build ou empreinte différente |
| **P2, web** | Avance rapide de `main` de `99d2add` vers le SHA final (jamais de force) → déploiement Vercel | déploiement prêt ; nouveaux assets servis ; `/login` s'affiche ; aucun smoke avec un compte réel sans GO | échec du build Vercel ; erreurs dans les logs ou rapportées |
| **P3, `daily-run`** | `functions deploy daily-run --project-ref uvolpldwwyvadlamulvr` depuis le checkout de release (une seule fonction ; jamais `--prune`, `--no-verify-jwt`, `--use-api`) | v46 ; ezbr cohérent avec le bundle local ; logs « Aucune erreur » (Louis) ; `generate-training-plan` toujours v29 | échec du déploiement ; erreurs dans les logs ; version ou empreinte inattendue |
| **P4, clôture** | Surveillance par requêtes agrégées en lecture seule (§9), exécutées par Louis, une requête à la fois | volumes de refus, d'alternatives et de statuts cohérents ; aucune erreur | erreur ou anomalie → retour arrière (§8) sur décision HPM |

---

## 8. Références de retour arrière (préparées, non exécutées)

- **Web** : Vercel instant rollback vers `3w1466ygTa6igF1oswc4bN2eeyBW` (`99d2add`, assets `index-Bmgpnwts.js`, `App-gsWmnKTX.js`, `index-Dlw4JsMN.css`). Jamais de force push sur `main`.
- **`daily-run`** : redéploiement depuis `C:/Users/Louis/nalynt-rc-99d2add` (v45 : ezbr `c966c836e0fcc488d731b7b93677eeedc5f0ee35e439ddc4c84dfc26a712bbc3`, graphe `1b31e2be…`). Le redéploiement devient une nouvelle version au contenu de v45.
- **`generate-training-plan`** : rien à faire (non redéployé).
- **SQL** : rien (aucune migration).
- **Données** : les décisions écrites pendant la fenêtre restent (ajout seul). Elles sont lisibles par le web de production (§6.6), y compris après un retour arrière.

---

## 9. Différences intentionnelles avec la production

SPORT-SAFE introduit **volontairement** des corrections actives : il **n'est pas** équivalent à la production flags OFF.

**Moteur — différentiel planifié, 47 970 cas, 192 différences, toutes « endurance MODERATE→LIGHT 45 min » :**

| Groupe | Cas | Production | Branche |
|---|---|---|---|
| Sans temps | 32 | copie de la dose prévue « allégée » | refus `modify_not_supported` |
| Temps ≥ 45 min | 96 | copie, `fits` | refus, `not_evaluated` |
| 20 ou 30 min | 64 | récupération A10 | même document de récupération, + `refusedModify` et la trace `A04_MODIFY_NOT_SUPPORTED` |

**Moteur — séances manuelles :**
- 11 088 cas identiques sans la séance avant M1 ;
- avec elle, refus ou alternative pour l'endurance (et la récupération synthétique) `MODERATE→LIGHT` seulement : 66 + 66, dont 22 sans temps, 55 temps non évalué, 55 alternatives ;
- 264 cas HEAVY identiques à la production.

**Moteur — hors différentiel** (moins de 20 min) : la production donnait REST ; la branche garde le refus (`no_alternative`), conformément au contrat HPM.

**Web, présentation seulement :**
- consignes de M1 sur la séance guidée ;
- note de l'alternative ;
- message `modify_not_supported` ;
- « Aucune séance compatible » ;
- mention C3.3 corrigée ;
- ligne neutre au lieu de « prêt à performer » ;
- « Aucun signal de santé » ;
- « Pas de séance guidée » dans la bande.

**Surveillance post-publication** — requêtes agrégées en lecture seule, sans donnée personnelle, une à la fois, par Louis (`<T0>` = heure du déploiement de `daily-run`) :

```sql
SELECT count(*) AS refusals FROM public.decisions WHERE created_at >= '<T0>' AND final_prescription_status = 'blocked' AND final_prescription_status_detail->>'reason' = 'modify_not_supported';
```
```sql
SELECT count(*) AS alternatives FROM public.decisions WHERE created_at >= '<T0>' AND daily_plan->'triggered_rules' @> '[{"rule_id":"A04_MODIFY_NOT_SUPPORTED"}]';
```
```sql
SELECT final_prescription_status, count(*) FROM public.decisions WHERE created_at >= '<T0>' GROUP BY final_prescription_status;
```

---

## 10. Risques résiduels

**Sportifs** (bloquants pour une bêta payante, pas pour cette publication) :
- B1, vraie dose LIGHT d'endurance : « RPE cible réduit » s'affiche au-dessus d'un RPE 3–4 ;
- B3, durée LIGHT d'une endurance manuelle ;
- B4, DH manuelle HEAVY ;
- A2 à A5.

**Écart de publication.** Entre P2 et P3, le nouveau web tourne avec l'ancien `daily-run` : les consignes de M1 s'affichent au-dessus des « fausses copies » encore produites (contradiction RPE de B1). L'écart est court, sans erreur.

**Tests** :
- instabilités d'environnement documentées (§4) ;
- le passage complet head-coach n'a pas été relancé dans cette mission, car le code moteur est inchangé depuis le dernier passage ciblé vert ;
- aucune suite générale relancée sans raison.

**Surveillance** : aucune métrique automatique ; requêtes manuelles (§9).

---

## 11. Verdict : **READY TO DEPLOY**

**Ce qui est fait :**
- les deux contrôles UX sont faits et corrigés en présentation ;
- validation ciblée verte, y compris les 13 fichiers d'intégration web sur un runtime stable ;
- périmètre vérifié : aucune migration ; seul `daily-run` change ; `generate-training-plan` est identique ; canon dans le périmètre approuvé ; M1 intact ;
- compatibilité vérifiée dans les deux sens ;
- ordre de déploiement et retours arrière préparés.

**Condition** : publication seulement après le GO séparé de l'HPM et de Louis, en suivant le §7. STOP.
