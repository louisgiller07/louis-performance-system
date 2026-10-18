# SPORT_SAFE_01_REPORT — adaptations quotidiennes et sécurité sportive

**Date** : 2026-10-18 · **Pour** : HPM et Louis · **Statut** : READY LOCAL pour l'anomalie 2 ; anomalie 1 en attente d'arbitrage.

Tout s'est fait sur le poste local. Branche `fix/sport-safe-01`, créée depuis `99d2add` ; pile locale `nalynt-gate01` (76 migrations).

La production n'a pas été touchée :
- main `99d2add`, SQL 76, `daily-run` v45, `generate-training-plan` v29 ;
- interrupteurs PHYS et V2-L2 absents ;
- aucune écriture, aucune migration, aucun déploiement, aucun flag, aucun push.

---

## 1. Cause exacte des deux anomalies

### Anomalie 1 — DH avec douleur au genou 4/10 (DH LIGHT, 4 passages, 90 min)

J'ai reproduit la chaîne en intégration : vraie M1, vrai plan V2, check-in réel. **Chaque étape applique une règle approuvée : ce n'est pas un bug de code.**

1. **Safety ne se déclenche pas** (`rules/safety.ts`). Une douleur de 4/10 sans critère objectif reste une douleur non-SAFETY. Aucun signal de santé n'est créé. Les règles de Safety sur la douleur :
   - **A2** : douleur nouvelle ≥ 6/10 ;
   - **A4** : un critère objectif (traumatique, perte de fonction, aggravation nette) ;
   - **A6** : douleur ≥ 6/10 (`SEVERE_PAIN_MIN_INTENSITY`). Ce seuil est PROVISIONAL : ce n'est pas un seuil clinique validé (P0-SAFE).
2. **M1 applique `PAIN_NON_SAFETY`** (`rules/painNonSafety.ts`) :
   - le genou est classé en zone « lower », et la DH sollicite cette zone (`LOWER_SOLICITING_KINDS`) ;
   - la charge est donc abaissée deux fois : MODERATE → LIGHT ;
   - protection : « Éviter toute charge sollicitant fortement … » et « Réduire l'intensité de la séance pour protéger … » ;
   - surveillance : « Pendant la séance, arrête la partie DH si la douleur augmente clairement ou si ton contrôle se dégrade. »
3. **Durée.** `resolveDhDuration` = min(90 prévues ; 180, table provisoire DH_TECHNICAL LIGHT) = **90 min**.
4. **Document V2** (ADR A04, approuvé). Le MODIFY DH garde le même drill, ramené à **4 passages**, et la fenêtre de M1 : « c'est la densité qui baisse ».
5. **Serveur.** La garde P0-3 de `record_session_execution` ne bloque qu'un signal de santé ouvert ou un REST de Safety. La séance guidée démarre donc.

**Le manque est double : un contrat d'affichage et un choix sportif.**
- Le document du jour V2 et l'écran guidé DH ne portent **aucun contexte de douleur**.
- La protection et la surveillance n'apparaissent que dans la vue du jour (« À éviter », « À surveiller », parfois repliées).
- Le rider voit « Ajusté — prêt à performer », puis roule 90 minutes sans aucun rappel de sa douleur ni de la règle d'arrêt.

**Douleur, signal de santé bloquant et fatigue : ce qui distingue chaque signal (canon actuel)**

| Signal | Règle | Effet |
|---|---|---|
| Douleur < 6/10 sans critère objectif | M1 `PAIN_NON_SAFETY` (`docs/04` §Douleur non-SAFETY) | Surveillance et protection ; adaptation si la séance sollicite la zone. **Jamais d'annulation automatique.** |
| Douleur ≥ 6/10, critère objectif ou douleur nouvelle ≥ 6/10 | Safety A6 / A4 / A2 | REST, signal de santé, propositions suspendues, avis d'un professionnel de santé |
| Signal de santé ouvert | A7 et garde serveur P0-3 | REST jusqu'à la clôture par le rider ; le serveur refuse le démarrage d'une séance |
| Fatigue (systémique, jambes, grip) | C3.x | MODIFY ou REPLACE ; jamais de signal de santé |

**Rouler est conservé, modifié ou remplacé** (comportement mesuré, flags OFF) :
- **Conservé (KEEP)** quand la zone n'est pas sollicitée. Exemple : poignet 4/10 un jour d'endurance.
- **Modifié** quand la zone est sollicitée, ou que la zone n'est pas précisée : DH LIGHT, 90 min, 4 passages. Exemples : genou, poignet sur une DH.
- **Remplacé** pour la fatigue seulement. Exemple : jambes 9/10 → DH_LIGHT LIGHT, 90 min, 4 passages (C3.6). Une douleur < 6/10 ne remplace jamais la séance par de la récupération.
- **REST** pour une douleur ≥ 6/10 ou avec un critère objectif.

### Anomalie 2 — l'endurance LIGHT est identique au plan

- M1 décide MODIFY LIGHT, 45 min, dans trois cas :
  - fatigue systémique (C3.3) ;
  - jambes (C3.6) ;
  - douleur non-SAFETY sur une zone sollicitée ou non précisée.
- A04 adapte l'endurance ainsi : même protocole, mêmes activités, durée = min(durée prévue ; 45). **Le RPE du protocole est fixe (3–4).**
- Pour une endurance **prévue à 45 min** (semaine build), le document « modifié » est donc la dose prévue à l'identique : même contenu sportif, même empreinte. Il porte pourtant la règle `v2.modify.endurance_light_duration`.
- **La variable attendue est la durée**, le seul levier approuvé (A04 : « durée LIGHT de la politique (45 min) »). L'intensité est fixée par le protocole et le contenu ne change pas. Pour une séance déjà à 45 min, **aucune dose plus légère n'est approuvée**.
- Ce comportement viole l'ADR A04 §6 (« jamais un document « modifié » qui ne serait que la dose prévue ») et `docs/04` (« jamais la dose prévue rebaptisée « modifiée » »).
- Le différentiel le mesure : 128 cas sur 47 970.

---

## 2. Contrats et canon concernés

- `docs/04` :
  - §Douleur non-SAFETY : surveillance, protection, adaptation ; pas d'annulation automatique ;
  - §A10 : la contrainte de temps passe après A04 ; « une prescription bloquée reste bloquée (`not_evaluated`) » ;
  - §MODIFY vers le haut : « jamais la dose prévue rebaptisée « modifiée » ».
- `docs/03` §5 : la douleur, citée par `painNonSafety.ts`.
- ADR :
  - A04 §6 (2026-10-06) ;
  - P0-SAFE (A6 / A7, 2026-10-12) ;
  - P0-3 (garde serveur, séances manuelles) ;
  - calibration A10 (2026-10-07).
- `docs/05` : statut `final_prescription_*`, sans changement.
- `docs/10` : T39.

---

## 3. Correction faite sans nouveau choix sportif (anomalie 2)

**Code.** `planning-engine/src/sessionModelV2/final/todayTimeLimitV2.ts`, fonction `refuseUnchangedModifyV2` : 22 lignes, rien d'autre en source.

Au point d'entrée quotidien (`buildFinalPrescriptionWithinTodayTimeV2`, seul appelant de production), un MODIFY créé dont le contenu sportif (`canonicalSportContent`) est celui de la prescription prévue devient :
- statut `blocked` / `final_prescription_adaptation_not_defined` ;
- détail `{ reason: "modify_not_supported", planned, final, durationMin }`.

**Comportement avant / après**

| Cas | Avant (production `99d2add`) | Après |
|---|---|---|
| Endurance prévue 45 + LIGHT de M1, sans temps donné ou temps ≥ 45 min | Créée ; document = plan, règle « durée LIGHT » | **Bloquée** `modify_not_supported`, temps `not_evaluated`, aucun document |
| Endurance prévue 60 + LIGHT de M1 | Créée, 45 min (bloc principal 30 au lieu de 45) | Identique |
| Endurance prévue 45 + LIGHT + 30 min disponibles | A10 : séance réelle ≤ 30 min | Identique |
| DH MODIFY LIGHT | 4 passages | Identique |
| KEEP, REPLACE, REST, séances manuelles, V1 | — | Identiques |

**Ce que voit le rider** :
- la décision et les consignes de M1, inchangées : « Réduire l'intensité globale… », surveillance ;
- dans « Ta séance », le message existant « L'adaptation détaillée n'est pas disponible pour cette recommandation. » ;
- aucune séance guidée à démarrer ce jour-là, donc rien à exécuter sous un faux libellé « allégé ».

**Interprétation à confirmer (HPM).** `docs/04` place A10 après A04 : lue strictement, une endurance refusée le resterait même avec 30 min disponibles. J'ai retenu une autre option : le refus ne porte que sur le document final quand le temps ne l'a pas changé.
- **Option retenue** : la vraie adaptation au temps est conservée (récupération active ≤ 30 min), comme en production aujourd'hui. Aucune régression.
- **Alternative stricte** : blocage aussi avec 30 min. Le rider perdrait la récupération qu'il reçoit aujourd'hui.

**Diffs canon proposés, non appliqués** :

`docs/04`, section « Prescription du jour V2 et MODIFY vers le haut », à la suite de « Aucune augmentation automatique… » :
```diff
+Un `MODIFY` dont le contenu sportif serait exactement celui de la prescription prévue ne produit pas non plus de prescription du jour V2 (ADR SPORT-SAFE-01) :
+- statut : `blocked` / `final_prescription_adaptation_not_defined` ; raison : `modify_not_supported` ;
+- cas atteint : endurance prévue à la durée LIGHT de la politique (45 min, RPE du protocole fixe) et LIGHT de M1 ;
+- le refus porte sur le document du jour : quand le temps disponible (A10) construit une autre séance réelle, elle est retenue.
```

`docs/04` §A10, « Priorité » :
```diff
   - Une prescription bloquée reste bloquée (`not_evaluated`).
+  - Un MODIFY sans contenu plus léger (SPORT-SAFE-01) est refusé s'il tient dans le temps (`not_evaluated`) ; sinon A10 s'applique.
```

`docs/10` T39 :
```diff
-  - MODIFY endurance (45 min) ;
+  - MODIFY endurance : 60 → 45 min ; prévue 45 → `modify_not_supported` au point d'entrée quotidien (SPORT-SAFE-01, `sportSafe01EnduranceLight.test.ts`, `sportSafe01.integration.test.ts`) ;
```

---

## 4. Arbitrages nécessitant une validation qualifiée (non codés)

Aucun seuil médical n'a été inventé : 6/10 reste PROVISIONAL. Toute modulation entre 4 et 5/10 demande l'avis d'un professionnel ou du préparateur.

**Anomalie 1 — contrat prudent proposé**

Objectif : une séance qui sollicite une zone douloureuse n'est jamais présentée comme automatiquement sûre.

- **A1 — contrat d'affichage, sans règle nouvelle. Je le recommande en premier.**
  - La protection et la surveillance de M1, déjà calculées, suivent la séance : document du jour V2, départ de la séance guidée, rappel de la règle d'arrêt pendant la DH.
  - Il faut un champ additif (`docs/05`) ou une lecture web de `daily_plan.monitoring` / `protection`, et la validation du texte par HPM.
- **A2 — choix sportif (préparateur ou professionnel de santé).** Avec une douleur de 4 à 5/10 à un membre inférieur, deux options :
  - garder la DH LIGHT, comme le canon actuel (adapter, ne pas annuler) ;
  - la remplacer par une récupération ou une endurance douce. `docs/04` permet une « substitution partielle », mais c'est un choix de dose.
- **A3 — dosage.** Durée de la DH LIGHT sous douleur : la fenêtre de M1 (90 min, ADR A04) ou une fenêtre plus courte (par exemple 60 min). C'est une nouvelle règle de dosage.
- **A4 — confirmation du rider avant le départ.** Exemple : « Ta douleur au genou est à 4/10 : démarre seulement si… ». Côté UX, éventuellement une garde serveur non bloquante.
- **A5 — V2-L2.** Faut-il créditer comme les autres une séance réalisée un jour de douleur ?

**Anomalie 2 — résiduels**

- **B1 — une vraie dose LIGHT d'endurance**, à choisir par le préparateur :
  - (i) 45 min, RPE 2–3 ;
  - (ii) 30 min ;
  - (iii) récupération active.
- **B2 — un message rider dédié au refus.** Proposition : « Ton état du jour demande d'alléger, et cette endurance est déjà à sa durée la plus courte : NALYNT ne construit pas de version plus légère. Suis les consignes du jour. » Le texte relève du web et doit être validé par HPM.
- **B3 — séances manuelles (P0-3).** Le contenu d'une endurance manuelle est construit depuis la séance finale de M1. Une modification vers LIGHT à durée égale donnerait en principe le même contenu qu'un KEEP. Il n'y a pas de prescription prévue à comparer : la garde ne s'applique pas. Non vérifié par un test ici ; à arbitrer.
- **B4 — canon** : diffs `docs/04` et `docs/10` (§3).

---

## 5. Tests avant / après

| Suite | Avant correction | Après correction |
|---|---|---|
| `planning-engine/tests/unit/sportSafe01EnduranceLight.test.ts` (nouveau, point d'entrée de production) | 5 échecs / 13 (l'anomalie) | 13 / 13 |
| `head-coach-engine/tests/supabase/sportSafe01.integration.test.ts` (nouveau, vrais chemins, pile locale) | 3 échecs / 15 (C3.3, C3.6, douleur au genou sur l'endurance de 45 min) | 15 / 15 |
| planning-engine complet, avec différentiel de production (`PHYS011_PREVIOUS_RUNTIME_ROOT`) | — | 1051 / 1051 (52 fichiers) |
| Différentiel flags OFF contre la production (`phys00FlagsOffEquivalence`) | — | 47 970 cas planifiés : 128 refus, tous « AEROBIC_BASE MODERATE→LIGHT 45 min », vérifiés exactement ; 11 088 cas manuels identiques ; contre-preuve verte |
| head-coach complet (pile locale) | — | 1594 réussis. Les fichiers Edge échouaient faute de runtime Edge local ; rejoués avec le runtime : 6 fichiers, 25 / 25. `a04ModifyReplace` : 10 / 10 après mise à jour du test I |
| Edge (bundle Deno de `daily-run` comparé à Node) | — | 57 / 57 |
| TypeScript | — | `tsc` planning-engine propre. head-coach : aucune erreur dans les fichiers touchés ; erreurs préexistantes dans `src/cli/runExample.ts` et des tests non touchés |

**Le test d'intégration compare les prescriptions réelles** (profil d'exploration de SPORT-VALIDATION-01) :

| Scénario | Jour | Résultat |
|---|---|---|
| Plan | — | endurance MODERATE 45 (bloc principal 30 min, RPE 3–4) ; endurance MODERATE 60 ; DH MODERATE 90 (6 passages) ; jour sans séance |
| Sans douleur ni fatigue | endurance 45 | KEEP, document identique au plan (même empreinte) |
| Fatigue légère (sommeil 6,5 h, qualité 6, énergie 6) | endurance 45 | KEEP, document identique au plan |
| Fatigue forte : systémique / jambes 9 | endurance 45 | MODIFY LIGHT 45 → refus `modify_not_supported`, aucun document, protection de M1 présente |
| Douleur au genou 4/10 | endurance 45 | MODIFY LIGHT 45 → refus `modify_not_supported`, aucun document, protection de M1 présente |
| Fatigue forte (systémique) | endurance 60 | MODIFY, document de 45 min (bloc principal 30 min, RPE 3–4), règle `endurance_light_duration` |
| Fatigue forte + 30 min disponibles | endurance 45 | A10 : document réel ≤ 30 min, différent du plan |
| 30 min disponibles, sans fatigue | endurance 45 | REPLACE RECOVERY_ACTIVE ≤ 30 min |
| Sans douleur | DH | KEEP DH MODERATE 90, 6 passages |
| Douleur au genou 4/10 | DH | MODIFY DH LIGHT 90, 4 passages, `dh_light_passes` ; textes de protection et de règle d'arrêt présents ; aucun signal de santé |
| Douleur au genou 6/10 | DH | REST, un signal de santé ouvert, aucun document |
| Jambes 9 | DH | REPLACE DH_LIGHT LIGHT 90, 4 passages |
| Jour de repos | jour sans séance | aucun document (`final_prescription_no_lineage`) |
| Données insuffisantes (sans check-in) | — | `runDailyFor` refuse de décider |

**Tests mis à jour, avec la trace ADR SPORT-SAFE-01.** Chacun verrouillait l'anomalie :
- `v2DailyIntegration` et sa variante PHYS : le jour du 16.10 attend désormais le refus ;
- `a04ModifyReplace` I : relit maintenant un document A10 réel ;
- `phys00FlagsOffEquivalence` : exception exacte et comptée ;
- `finalPrescriptionV2Adapt` : annoté (le constructeur seul est inchangé).

---

## 6. Risques de régression

- **Comportement flags OFF modifié pour ce seul cas, volontairement.** Ces jours-là, le rider n'a plus de séance guidée d'endurance. Il ne peut donc pas enregistrer une séance guidée V2 ce jour-là ; il garde les consignes de M1.
- **Release.** Seul le bundle `dailyRunV2` change. `generateTrainingPlan.bundle.js` est identique octet pour octet au build `99d2add`. Aucune migration, aucun web, aucun flag. Une release se limiterait à `daily-run` (v46).
- **Jour du déploiement.** Les décisions sont en append-only et l'historique est figé : les décisions déjà « créées » restent intactes. Une nouvelle exécution du même jour produirait une décision bloquée. Une exécution déjà commencée reste attachée à sa prescription figée (R9-UI-01).
- **Invariants vérifiés :**
  - M1 (`src/{types,engine,rules,domains,mapping}`), V1, le web et la base sont inchangés ;
  - une seule séance principale par jour ;
  - CONSISTENCY-01/02 et PARTIAL-01 ne sont pas touchés : aucun changement web, Aujourd'hui lit toujours la décision courante ;
  - P0-SAFE : A6 / A7 et la garde serveur sont inchangés (test douleur 6/10 vert).
- **Message générique.** Le texte affiché (« L'adaptation détaillée n'est pas disponible… ») est honnête mais peu précis : voir B2.

---

## 7. Commit local

Branche `fix/sport-safe-01` (depuis `99d2add`), sans push. Le hash est donné à la livraison.

Fichiers indexés un par un :
- source : `planning-engine/src/sessionModelV2/final/todayTimeLimitV2.ts` ;
- tests planning-engine : `sportSafe01EnduranceLight.test.ts` (nouveau), `phys00FlagsOffEquivalence.test.ts`, `finalPrescriptionV2Adapt.test.ts` ;
- tests head-coach : `sportSafe01.integration.test.ts` (nouveau), `v2DailyIntegration.integration.test.ts`, `v2DailyIntegration.physDaily.integration.test.ts`, `a04ModifyReplace.integration.test.ts` ;
- documentation : `docs/11` (ADR SPORT-SAFE-01), `docs/12`, `docs/00`, ce rapport.

---

## 8. Verdict

- **Anomalie 2 : READY LOCAL.**
  - La correction découle de l'ADR A04 §6, déjà approuvé.
  - Elle est couverte par des tests, y compris une contre-preuve.
  - Le différentiel est limité au seul cas visé.
  - Confirmations attendues : l'interprétation A10 (§3) et les diffs canon.
- **Anomalie 1 : BLOCKED en attente d'arbitrage.**
  - Aucune correction sûre n'est possible sans choix sportif ni contrat d'affichage approuvé.
  - Les arbitrages A1 à A5 sont à trancher avant une bêta payante. A1 est recommandé en premier : il ne demande aucune règle nouvelle.
