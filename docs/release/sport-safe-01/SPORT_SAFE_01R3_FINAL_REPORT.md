# SPORT_SAFE_01R3_FINAL_REPORT — option B, finalisation locale

**Date** : 2026-10-19 · **Pour** : HPM et Louis · **Verdict : MERGE READY (intégration locale), sous trois réserves déclarées (§10).**

Branche `fix/sport-safe-01`, depuis `99d2add` (production). Aucun push, merge, déploiement, migration ni changement de flag.

---

## 1. Comportement A04 / A10, avant et après

**Persistance vérifiée avant de coder** — aucun changement de contrat SQL nécessaire :
- une décision `created` interdit `final_prescription_status_code` et `_detail` (contraintes CHECK) ; le refus ne peut donc pas y figurer quand une alternative existe ;
- `daily_plan` est un objet JSON libre, et `persist_daily_run_v2` n'exige que la cohérence entre action et décision ;
- **refus seul** : statut `blocked`, avec son détail, et aucune ligne de prescription ;
- **refus + alternative** : statut `created`, ligne `replace` pour la récupération, et le refus conservé dans `daily_plan.triggered_rules`.

Les traces ci-dessous viennent du vrai moteur (`runDailyFor`, pile locale), sur la production `99d2add` puis sur la branche. Fichier complet : `evidence/SPORT_SAFE_01R3_ENGINE_TRACES.txt`.

| # | Scénario | Production `99d2add` | Branche |
|---|---|---|---|
| 1 | Endurance prévue 45, fatigue C3.3, **30 min** | REPLACE récupération (A10 sur la fausse copie) | **REPLACE récupération active 20 min.** Trace `A04_MODIFY_NOT_SUPPORTED` puis `V2_TODAY_TIME_CONSTRAINT` (`adapted`) ; refus conservé |
| 2 | Même cas, **60 min** | fausse copie « allégée », `fits` | **Refus** `modify_not_supported`, `not_evaluated`, aucune séance |
| 3 | Endurance prévue **60**, C3.3 | 45 min réelles | identique : 45 min réelles (bloc principal 30, RPE 3–4) |
| 4a, 4b | Endurance manuelle MODERATE **45** ou **60**, C3.3 | fausse copie (identique au KEEP) | **Refus** |
| 4c | Endurance manuelle 45, C3.3, **30 min** | REPLACE récupération | **REPLACE récupération active**, refus tracé, origine manuelle |
| 5 | Repos de M1 (jour de repos manuel), 30 min | KEEP REST, son propre refus, `not_evaluated` | identique, aucune alternative |
| 6 | Protection santé : genou 6/10 (A6), 30 min | REST Safety, signal ouvert | identique, aucune alternative |
| 7 | Refus non admissible : puissance manuelle sans builder (flags OFF), 30 min | `manual_kind_not_supported`, `not_evaluated` | identique, aucune alternative |
| 8 | Alternative identique au document refusé | inatteignable : une récupération n'égale jamais une endurance | garde `admissibleAlternativeV2`, testée unitairement |
| 9 | Aucune alternative : endurance 45, C3.3, **15 min** | A10 → **REST** (« repos aujourd'hui ») | **Refus**, action `no_alternative`, aucune séance, jamais REST (contrat HPM : le refus n'est pas requalifié) |
| 10 | DH manuelle HEAVY 120 : KEEP, puis C3.3, puis C3.3 + 90 min | KEEP 6 passages ; MODIFY 6 passages ; « raccourcie » à 90 min | **Identique à la production** (§5) |
| 11 | Sans douleur ni fatigue (endurance 45, DH 90) | KEEP | KEEP, inchangé |
| 12, 13 | Séance guidée rechargée ; séance terminée | — | voir §6 (captures) |

---

## 2. Diffs canon exacts (normatifs, commit `949c09c`)

Périmètre décidé par l'HPM, sans aucun autre amendement :
- **`docs/04`** : l'exception limitée A04 / A10, et le refus « contenu identique » qu'elle vise ;
- **`docs/05`** : refus et alternative dans les colonnes existantes ; jamais crédités comme exécutés ; historique et seuils V2-L2 inchangés ; référence manuelle ;
- **`docs/10`** : T66 (acceptation et non-régression) et la ligne d'endurance de T39.

```diff
diff --git a/docs/04_DAILY_DECISION_ENGINE.md b/docs/04_DAILY_DECISION_ENGINE.md
index d41f754..5de3684 100644
--- a/docs/04_DAILY_DECISION_ENGINE.md
+++ b/docs/04_DAILY_DECISION_ENGINE.md
@@ -471,3 +471,3 @@ Sur le **chemin V2 uniquement**, quand le rider a indiqué un temps disponible a
 
-- **Condition :** X renseigné, et une prescription du jour V2 créée qui demande plus de X minutes (sa durée effective, ou la somme des bornes hautes de ses blocs).
+- **Condition :** X renseigné, et une prescription du jour V2 créée qui demande plus de X minutes (sa durée effective, ou la somme des bornes hautes de ses blocs) ; ou un refus A04 « contenu identique » (`modify_not_supported`, section suivante) dont la séance refusée demande plus de X minutes.
 - **Effet :** la première séance candidate qui tient en X, construite par les vrais builders et vérifiée. La charge ne monte jamais. Ordre des candidats :
@@ -480,5 +480,14 @@ Sur le **chemin V2 uniquement**, quand le rider a indiqué un temps disponible a
   - Un REST de M1 reste REST.
-  - Une prescription bloquée reste bloquée (`not_evaluated`).
+  - Une prescription bloquée reste bloquée (`not_evaluated`), sauf l'exception limitée suivante.
+  - **Exception limitée — refus A04 « contenu identique » (SPORT-SAFE-01R.3, approuvée HPM 2026-10-19)** :
+    - seulement pour ce motif : une séance qu'A04 refuse parce que son contenu serait celui de la séance de référence (`modify_not_supported`, section suivante) et qui demande plus de X minutes ;
+    - le refus n'est jamais effacé ni requalifié : il reste le résultat d'A04 et il est tracé ;
+    - une seule alternative peut être évaluée : la **récupération active** (REPLACE, candidat 4 ci-dessus), construite sous X par les vrais builders et vérifiée ; jamais une version plus courte de la séance refusée, jamais une autre famille ;
+    - elle n'est admissible que si elle tient en X et diffère du document refusé ; sinon aucune séance exécutable : le refus demeure, sans REST de remplacement ;
+    - jamais sur un REST de M1, sous une règle Safety ou un signal de santé (ils précèdent A04), ni pour une autre raison de blocage ;
+    - aucune dose nouvelle : la récupération active garde ses plages et son minimum de 20 min ;
+    - le rider voit que la séance prévue n'est pas proposée et qu'une autre séance la remplace ; jamais une « endurance légère ».
 - **Traçabilité :**
-  - règle `V2_TODAY_TIME_CONSTRAINT` (couche `ARBITRATION`) dans `triggered_rules` dès que X est renseigné : minutes, séance avant, action (`fits` / `adapted` / `rest` / `not_evaluated`), séance après ;
+  - règle `V2_TODAY_TIME_CONSTRAINT` (couche `ARBITRATION`) dans `triggered_rules` dès que X est renseigné : minutes, séance avant, action (`fits` / `adapted` / `rest` / `not_evaluated` / `no_alternative` — refus A04 sans alternative admissible), séance après ;
+  - exception limitée retenue : la règle `A04_MODIFY_NOT_SUPPORTED` (couche `ARBITRATION` : séance refusée, raison) précède `V2_TODAY_TIME_CONSTRAINT` ; la prescription du jour est celle de la récupération active ;
   - si la séance change : `decision`, `final_session` et `training` prennent la séance retenue ;
@@ -502,2 +511,8 @@ Aucune augmentation automatique, et jamais la dose prévue rebaptisée « modifi
 
+**Contenu identique (ADR SPORT-SAFE-01, SPORT-SAFE-01R.3)** : un `MODIFY` dont le contenu sportif serait exactement celui de la séance de référence ne produit pas non plus de prescription du jour V2.
+- Statut : `blocked` / `final_prescription_adaptation_not_defined` ; raison : `modify_not_supported` (détail : charge de référence, charge demandée, durée).
+- Séance de référence : la prescription prévue ; pour une séance manuelle (P0-3), le document que son KEEP recevrait (séance avant M1), seulement quand sa charge est une dose V2 (`LIGHT`, `MODERATE`). Une séance manuelle `HEAVY` n'a pas de référence : son KEEP est déjà construit plus léger que déclaré (arbitrage sportif ouvert).
+- Cas atteints : endurance prévue à la durée LIGHT de la politique (45 min, RPE du protocole fixe) ; endurance manuelle `MODERATE`.
+- Le refus est le résultat d'A04 et précède A10 ; seule l'exception limitée d'A10 (section précédente) peut lui adjoindre une récupération active.
+
 Depuis l'ADR P0 (2026-10-07), le chemin M1 normal n'atteint plus ce cas : M1 plafonne la charge d'une séance planifiée (`PLANNED_LOAD_CAP`, ci-dessous). Par exemple, le protocole T-X à T-6 (`DH_TECHNICAL MODERATE`) sur une DH d'affûtage V2 `LIGHT` donne KEEP de la DH `LIGHT`. `upward_modify_not_supported` reste dans A04 comme **garde défensive** : il bloque toute hausse qu'une régression future réintroduirait.
diff --git a/docs/05_DATA_MODEL.md b/docs/05_DATA_MODEL.md
index 462b04e..a9bbb17 100644
--- a/docs/05_DATA_MODEL.md
+++ b/docs/05_DATA_MODEL.md
@@ -287,4 +287,10 @@ Les trois tables sont en ajout seul (`reject_append_only_mutation`) et référen
 
+*SPORT-SAFE-01 / 01R.3 — refus « contenu identique » et alternative A10 (HPM 2026-10-19 ; `docs/04`)* : aucune colonne, aucune migration.
+- **Refus seul** : `decisions.final_prescription_status = 'blocked'`, code `final_prescription_adaptation_not_defined`, détail `{ reason: 'modify_not_supported', planned, final, durationMin }` ; aucune ligne `decision_final_prescriptions` : rien à démarrer ni à exécuter.
+- **Refus et alternative A10** : statut `created` ; la ligne `decision_final_prescriptions` est la récupération active (`reconciliation_action = 'replace'`, `adaptation_rule_ids` = `v2.replace.recovery_active`, `v2.time.today_limit`, précédées de `v2.manual.session` pour une séance manuelle). Le refus est conservé dans `decisions.daily_plan.triggered_rules` (règle `A04_MODIFY_NOT_SUPPORTED`, puis `V2_TODAY_TIME_CONSTRAINT`) ; les colonnes de statut ne le portent pas (contrainte : code et détail seulement pour `blocked`).
+- **Jamais créditée comme exécutée** : une prescription refusée n'a ni ligne de prescription du jour ni exécution. Seule l'alternative, si le rider la réalise, est une exécution (`session_executions`), avec les règles existantes de l'historique (P0-4), de la « séance faite », de la charge récente M1 et de l'historique V2 de la génération (V2-L2 : une récupération compte 0 minute ; un jour refusé sans exécution n'est ni volume ni séance manquée) ; aucun seuil V2-L2 modifié.
+
 *P0-3 — séance manuelle (HPM 2026-10-13, option P1, migration `20261013120000`)* : une séance ajoutée ou modifiée à la main dans `/plan` (`planned_sessions.source = 'manual'`) reçoit, sur le chemin V2, une prescription du jour construite depuis le snapshot V2 de la version courante pour le type et la charge finaux de M1 (mêmes builders que REPLACE).
 - **Origine et action** : `active_session_origin = 'manual_override_new_kind'`, `reconciliation_action` = la décision M1 (`keep` / `modify` / `replace`), `planned_prescription_id` NULL, `plan_version_id` = version courante ; `adaptation_rule_ids = []` pour `keep`, sinon `v2.manual.session` + la règle du builder (+ `v2.time.today_limit` sous A10).
+- **§6 (SPORT-SAFE-01R.3)** : un MODIFY dont le contenu serait celui du KEEP de la séance manuelle (séance avant M1, `planned_session_before`, transmise au builder) est refusé comme une séance planifiée (`docs/04`, « Contenu identique »), seulement pour une charge `LIGHT` ou `MODERATE` ; une séance manuelle `HEAVY` n'a pas de référence.
 - **`persist_daily_run_v2`** (fonction seule, aucune table modifiée) : un `keep` sans prescription prévue n'est accepté que pour cette origine ; toute prescription d'origine `manual_override_new_kind` est vérifiée côté serveur avant toute écriture : la séance source de la décision est la ligne `manual` de **cet** athlète pour la date, à la version (`updated_at`) sur laquelle la décision a été calculée ; `plan_version_id` est la version **courante** de l'athlète, en v2, dont l'horizon couvre la date ; aucune prescription prévue ; aucune règle pour un `keep`. Inchangé : `keep` généré (prescription prévue obligatoire), MODIFY / REPLACE, règle action = décision, statuts REST / bloqué. Rollback : `supabase/rollbacks/p0_3/`.
diff --git a/docs/10_TEST_PLAN.md b/docs/10_TEST_PLAN.md
index 4395394..ce78de7 100644
--- a/docs/10_TEST_PLAN.md
+++ b/docs/10_TEST_PLAN.md
@@ -705,2 +705,19 @@ Tests existants adaptés au nouveau contrat : `sessionExecution.integration.test
 
+### T66. SPORT-SAFE-01 — aucune séance identique présentée comme adaptée ; alternative A10 limitée (HPM 2026-10-19)
+Règles : `docs/04` (« Contenu identique » ; A10, exception limitée), `docs/05` (refus et alternative), ADR SPORT-SAFE-01, SPORT-SAFE-01R, SPORT-SAFE-01R.3.
+- **Acceptation** (unitaires `sportSafe01EnduranceLight.test.ts`, `sportSafe01RManualModify.test.ts`, `applyV2TodayTimeConstraint.test.ts` ; intégration `sportSafe01.integration.test.ts`, chemins réels) :
+  - endurance prévue 45 + LIGHT de M1, sans temps ou X ≥ 45 → `blocked` / `modify_not_supported`, aucune prescription ;
+  - même cas, X = 20 ou 30 → récupération active ≤ X (REPLACE), refus conservé (`refusedModify` ; `A04_MODIFY_NOT_SUPPORTED` puis `V2_TODAY_TIME_CONSTRAINT`), phrase « la séance prévue n'est pas proposée […] Autre séance à la place : récupération active. » ;
+  - même cas, X = 15 → aucune alternative admissible : refus, action `no_alternative`, aucune séance, jamais REST ;
+  - endurance prévue 60 + LIGHT → 45 min réelles ; avec X = 30 → récupération active A10 ordinaire, sans refus ;
+  - endurance manuelle `MODERATE` 45 / 60 + LIGHT → refus ; avec X = 30 → récupération active, refus conservé ;
+  - garde d'identité (`admissibleAlternativeV2`) : alternative identique au document refusé, non créée ou plus longue que X → non admissible.
+- **Non-régression** :
+  - REST de M1, REST Safety (A6, signal ouvert), autre raison de blocage (séance manuelle sans builder, MODIFY sans baisse de charge) avec X → aucune alternative, comportement inchangé ;
+  - séance manuelle `HEAVY` (DH, endurance) : aucune référence, MODIFY créé comme en production ;
+  - KEEP, REPLACE, Force et DH réellement allégées : inchangés ;
+  - différentiel flags OFF contre la production (`phys00FlagsOffEquivalence.test.ts`) : 192 cas planifiés (32 refus sans temps, 96 temps non évalué, 64 = la récupération A10 de production plus `refusedModify`) ; séance manuelle avec la séance avant M1 : endurance et récupération `MODERATE` seulement, 264 cas `HEAVY` égaux à la production ; tous les comptes épinglés.
+- **Web** (`sportSafe01RGuidance`, `sportSafe01R3Alternative`, `sportSafe01R2Message`, `guidedSessionLoader.guidance`, `sportSafe01RTagline`) : consignes de M1 avant et pendant la séance guidée, rechargement compris, jamais en lecture seule ; phrase de l'alternative ; message de refus approuvé quand aucune alternative n'existe ; pas de « prêt à performer » sur une douleur déclarée.
+- **Navigateur réel** (Chromium mobile, pile locale) : captures et textes visibles du rapport SPORT-SAFE-01R.3.
+
 ### T65. Release V2-PHYS — isolation par interrupteurs, POWER-GUARD-01, historique V2 de la génération (HPM 2026-10-18)
@@ -1036,3 +1053,3 @@ Règle : ADR PARTIAL-01 (`docs/11`). Présentation web seulement ; serveur, Edge
   - MODIFY DH (même drill, 4 passages) ;
-  - MODIFY endurance (45 min) ;
+  - MODIFY endurance : 60 → 45 min ; prévue 45 → `modify_not_supported` (T66) ;
   - MODIFY vers le haut : séance prévue LIGHT et demande MODERATE ou HEAVY (Force, DH, endurance) → `upward_modify_not_supported` ; MODIFY sans baisse de charge → `modify_not_supported` ;
```

**Écart avec le texte de l'option B du dossier R.2.** Le contrat R.3 est plus étroit, et c'est lui qui est appliqué :
- la seule alternative est la **récupération active**, jamais les autres candidats d'A10 ;
- s'il n'existe pas d'alternative admissible, **aucune séance exécutable** et pas de REST.

---

## 3. Tests et résultats (suites affectées seulement)

| Suite | Résultat |
|---|---|
| planning-engine complet, différentiel de production compris | 1 071 / 1 071 |
| `sportSafe01EnduranceLight` (alternative 20 et 30 min, refus 45, 60 et 90 min, `no_alternative` 15 min, refus non admissible, garde d'identité) | 18 / 18 |
| `sportSafe01RManualModify` (alternative manuelle, HEAVY sans référence) | 15 / 15 |
| head-coach `applyV2TodayTimeConstraint` (deux traces, phrase, `no_alternative`, A10 ordinaire inchangé) | 9 / 9 |
| head-coach `sportSafe01.integration` (vrais chemins, les 13 scénarios) | 28 / 28 |
| head-coach : A04, A10 (+ PHYS), V2 quotidien (+ PHYS), P0-3 manuel et contrat, autres unitaires `applyV2` | 94 réussis, 1 ignoré |
| Edge : bundles Deno comparés à Node | 57 / 57 |
| web ciblé (séance guidée, prescription V2, plan du jour, pages, historique, Aujourd'hui) | 1 010 réussis, 20 ignorés |
| web `sportSafe01R3Alternative` (nouveau) | 6 / 6 |
| Build web et typage (`tsc` build) | OK |

Non relancés, car leur code n'est pas touché : head-coach complet (dernier passage complet 2026-10-18 : un échec de concurrence préexistant, voir R.2 §4), web complet.

---

## 4. Comparaison flags OFF avec la production (`99d2add`)

Le différentiel compare le runtime compilé de production (`863f3fb`, identique à `99d2add` flags OFF). Tous les comptes sont épinglés dans `phys00FlagsOffEquivalence.test.ts`.

**Planifié** : 47 970 cas, dont 192 différences, toutes « endurance MODERATE→LIGHT 45 min » :

| Résultat sur la branche | Cas |
|---|---|
| Refus, sans temps | 32 |
| Refus, temps non évalué (X ≥ 45) | 96 |
| Le document A10 de récupération **de la production** + `refusedModify` | 64 |

**Manuel :**
- sans la séance avant M1 : 11 088 cas identiques à la production ;
- avec elle : 1 848 cas, dont 132 refus, uniquement pour l'endurance et la récupération `MODERATE→LIGHT` (22 sans temps, 55 temps non évalué, 55 alternatives) ;
- les **264 cas HEAVY sont identiques à la production**.

**Hors différentiel** (temps testés ≥ 20 min) : avec moins de 20 min, la production donnait REST ; la branche garde le refus (`no_alternative`). Ce cas est couvert par les tests unitaires et d'intégration.

**Livraison :**
- seul le bundle `dailyRunV2` change ; `generateTrainingPlan.bundle.js` est identique octet pour octet à `99d2add` ;
- une release toucherait `daily-run` et le web ;
- aucune migration, aucun flag.

---

## 5. Séances manuelles

- **Endurance manuelle MODERATE 45 ou 60 + LIGHT** : refus, car le builder n'a aucun levier de charge et le document serait celui du KEEP. Avec moins de temps que la séance, la récupération active est l'alternative, avec le refus tracé.
- **Séance manuelle HEAVY — conclusion ciblée :**
  - **Ce qui est réellement produit** : les builders de remplacement prennent `load = LIGHT si LIGHT, sinon MODERATE`.
    - **KEEP** : une DH HEAVY 120 donne le document MODERATE (6 passages).
    - **MODIFY** : le MODERATE de M1 donne ce même document.
  - **Règle canonique** : il n'en existe pas pour la DH (ni pour l'endurance) HEAVY manuelle. Le canon ne plafonne explicitement que la Force :
    - A04 REPLACE : « charge M1 plafonnée à MODERATE » ;
    - P0-3 : « une Force HEAVY est refusée, jamais allégée en silence ».
    - Pour la DH, la réduction HEAVY → MODERATE est implicite dans le code.
  - **Il y a donc une ambiguïté qui demande un arbitrage sportif.** La comparaison à ce KEEP déjà réduit n'est plus retenue (contrat R.3) : le MODIFY est créé comme en production. Aucune dose HEAVY n'est créée.
  - **Options possibles** :
    1. refuser explicitement une séance manuelle HEAVY dès le KEEP, comme la Force ;
    2. rendre le plafond MODERATE canonique et le dire au rider ;
    3. une dose HEAVY — exclue par l'HPM.

---

## 6. Messages réellement visibles

Web local de la branche, pile locale, riders fictifs, mobile 390×844, horloge fixée au jour du scénario. Une seule décision par rider (vérifié). Textes complets : `evidence/SPORT_SAFE_01R3_VISIBLE_TEXTS.txt` ; 26 captures PNG dans le dossier local de la session (non versionnées).

| Scénario | Aujourd'hui | Séance guidée |
|---|---|---|
| Alternative (45, C3.3, 30 min), avant démarrage | « Prévu : Aérobie base (45 min · modérée). Adapté : Récupération active. » ; « Pourquoi ? … Tu as 30 min aujourd'hui : la séance prévue n'est pas proposée (NALYNT n'en a pas de version guidée plus légère, et elle ne tient pas dans ce temps). Autre séance à la place : récupération active. » | En-tête « Récupération active », **la même phrase**, « À éviter : Réduire l'intensité globale de la séance (RPE cible réduit) — sommeil insuffisant », séance de 20 min, RPE 2–3, « Commencer la séance » |
| Alternative démarrée, page rechargée | — | « État : en cours », phrase et consignes conservées (décision de l'exécution) |
| Alternative terminée | — | « État : terminée », **ni phrase ni consignes** (lecture seule) |
| Refus avec 60 min, refus avec 15 min, endurance manuelle 60 | Décision M1 « Adapté 45 / 60 min (légère) » | « Ton état du jour demande d'adapter cette séance, mais NALYNT n'en a pas de version guidée plus légère que celle prévue : pas de séance guidée aujourd'hui. » |
| Endurance manuelle 45, 30 min | — | comme l'alternative planifiée |
| Endurance prévue 60, C3.3 | — | 45 min, RPE 3–4, sous « Réduire l'intensité globale (RPE cible réduit) » (B1, non résolu) |
| DH manuelle HEAVY | — | DH technique, 6 passages, consignes de M1 |
| Genou 6/10 + 30 min | Coaching suspendu | « Repos aujourd'hui : pas de séance guidée. » |
| Puissance manuelle (autre refus) | — | « Pas de séance guidée pour cette recommandation. » (inchangé) |
| Sans signal | — | endurance 45, aucun bloc de consignes |

---

## 7. Vérification de la branche

**Commits depuis `99d2add` :**

| Commit | Rôle | Catégorie |
|---|---|---|
| `5067a35` | refus §6, première version | moteur + tests + docs |
| `4181de5` | refus avant A10 (option A, remplacé par B) | moteur + tests + docs/11 |
| `5ea811d` | référence manuelle (`manualSession`) | moteur + adaptateur M2 + tests |
| `ab6b3a3` | A1 : consignes de M1 sur la séance guidée, slogan retiré sur une douleur | web + tests |
| `609b8d8` | ADR SPORT-SAFE-01R, rapport, preuves | docs non normatives |
| `b36317f` | message `modify_not_supported` | web + tests |
| `08fdc76` | **tests seulement** : épingle les comptes du différentiel (absent du tableau R.2) ; ses nombres sont mis à jour pour l'option B dans `c22a381` | tests |
| `619c479` | dossier R.2, portée normative de l'ADR | docs non normatives |
| `c22a381` | **option B** + manuel HEAVY sans référence | moteur + adaptateur M2 + tests |
| `570ae34` | phrase de l'alternative sur la séance guidée | web + tests |
| `949c09c` | **canon** `docs/04`, `docs/05`, `docs/10` | **normatif** |
| *(ce commit)* | ADR R.3, statut, backlog, ce rapport, preuves | docs non normatives |

**Fichiers depuis `99d2add`, par catégorie :**

| Catégorie | Fichiers |
|---|---|
| Normatif (canon) | 3 : `docs/04`, `docs/05`, `docs/10` |
| Moteur V2 / adaptateur M2 | 4 : `todayTimeLimitV2.ts`, `buildKeepFinalPrescriptionV2.ts`, `reconcileFinalPrescriptionV2.ts`, `applyV2TodayTimeConstraint.ts` |
| Web | 6 : `dayGuidance.tsx`, `guidedSessionLoader.ts`, `GuidedSessionView.tsx`, `guidedSessionCopy.ts`, `finalPrescriptionV2Copy.ts`, `DecisionHero.tsx` |
| Tests | 17 |
| Docs non normatives | `docs/00`, `docs/11`, `docs/12`, rapports et preuves |
| **Hors périmètre** | **0** |
| M1 (`src/{types,engine,rules,domains,mapping}`) | **0 ligne** |
| Migrations | **0** |

---

## 8. Limites sportives restantes (non bloquantes pour l'intégration, bloquantes pour une bêta payante)

- **B1 — vraie dose LIGHT d'endurance.**
  - « RPE cible réduit » s'affiche au-dessus d'une endurance de 45 min à RPE 3–4 (cas 60 → 45).
  - Pour l'alternative, la récupération (RPE 2–3) est cohérente avec cette consigne.
- **B3 — durée LIGHT d'une endurance manuelle.** L'endurance manuelle de 60 min est refusée, pas réduite à 45 min.
- **B4 — séance manuelle HEAVY** (§5).
- **Libellés hérités visibles sur l'alternative** (préexistants, non modifiés, à arbitrer) :
  - « Pourquoi ? » garde le motif M1 C3.3 « … nature de la séance préservée » devant la phrase « Autre séance à la place ». Le même texte existe en production pour toute récupération A10 après de la fatigue.
  - L'historique affiche « Nouveau plan — prêt à performer » sur ce remplacement dû à la fatigue (la règle A1 ne vise que la douleur).
- **Aucune alternative (moins de 20 min).** Aujourd'hui garde la décision M1 « 45 min (légère) » sans mentionner le temps déclaré. La séance guidée affiche le message de refus approuvé. La production montrait un REST avec la phrase du temps.
- **A2, A3, A4, A5** inchangés : DH sous douleur, durée, confirmation du rider, crédit V2-L2.

---

## 9. Ce qui n'a pas été fait

- Aucun merge, push, déploiement, migration ni flag.
- Aucune dose sportive modifiée. M1 inchangé.
- Aucun autre amendement canon que §2.

---

## 10. Verdict : **MERGE READY** (intégration locale, sans production)

**Ce qui est en place :**
- l'option B est implémentée au contrat R.3 près (récupération active seule, refus conservé et tracé, aucune séance sans alternative admissible) ;
- le canon est appliqué dans le périmètre décidé ;
- le différentiel est épinglé ;
- les 13 scénarios ont été contrôlés sur le vrai moteur et le vrai web.

**Réserves déclarées, à accepter ou à arbitrer par l'HPM :**
1. Le cas « moins de 20 min » diffère de la production : refus au lieu de REST, conformément au contrat.
2. Les deux libellés hérités sur l'alternative (§8).
3. B4 : séance manuelle HEAVY.

Aucun déploiement de production sans GO HPM.
