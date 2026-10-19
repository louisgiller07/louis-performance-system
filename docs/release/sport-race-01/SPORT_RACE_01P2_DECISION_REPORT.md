# SPORT_RACE_01P2_DECISION_REPORT — arbitrages et finalisation locale

**Date** : 2026-10-19 · **Pour** : HPM et Louis · **Branche** : `fix/sport-race-01` (production `79b4d19`) · **Décision traitée** : SPORT-RACE-01P.2 (SPORT-RACE-01P APPROVED WITH CONDITIONS).

**Verdict : MERGE READY**, sous trois réserves :
- la revue des diffs canoniques avant le merge ;
- la décision sur la proposition A (contrat des formats) ;
- **l'activation sportive n'est PAS prête**. Les formes « 2 jours » et « 3 jours » du formulaire appliquent à n'importe quelle compétition un protocole Hot Trail ou iXS qui n'est pas validé pour elle (§ 1).

Aucun push, merge, déploiement, changement SQL ou M1. Les doses provisoires sont inchangées.

**Preuves**
- `evidence/SPORT_RACE_01P2_VISIBLE_TEXTS_375.txt` : écrans Aujourd'hui et points d'attention du programme, web de la branche à 375 px.
- `evidence/SPORT_RACE_01P_REAL_DECISIONS_BEFORE_AFTER.txt` : décisions réelles de 01P.
- `SPORT_RACE_01P_CANON_DIFFS.md` (révisé) : diffs canoniques proposés.

---

## 1. Correspondance exacte : saisie → données → protocole

**Ce que le rider saisit** (formulaire « Tes courses », `web/src/features/races`) :
- **nom** : texte libre ;
- **format** : une liste de 3 choix ;
- **début** ;
- **fin** : imposée pour les formats 2 et 3 jours ;
- **importance** : A, B ou C.

Il n'y a ni organisateur, ni série, ni lieu, ni programme officiel jour par jour. À la création, les valeurs par défaut sont « **Course sur 2 jours** » et l'importance B.

**Ce qui est persisté** (`race_calendar`) :
- `event_name`, `start_date`, `end_date`, `priority` ;
- `race_format` : la valeur de l'énumération, telle quelle ;
- `status = planned`.

`series`, `location` et `category` existent, mais ne sont jamais saisis. Aucune donnée ne porte les jours officiels (`race_phase` n'existe pas en base).

**Comment le protocole est choisi** :
- **M1, au quotidien** (en production depuis longtemps) : par la table de `race_format`, à savoir `PRE_EVENT_TABLES[race_format]`.
- **Plan V2** (SPORT-RACE-01P) : par `raceFormat` dans le snapshot, à savoir `isRaceProtocolFormatV2`.
- Jamais par le nom, les dates, la durée ou la discipline.

| Saisie dans l'interface | `race_format` persisté | Protocole d'avant-course (M1 et plan V2) |
|---|---|---|
| « Course sur 2 jours (entraînements + course) », **présélectionnée** | `HOT_TRAIL_2DAY` | **Hot Trail** : T-7 Force haut légère, T-6 DH, T-5 endurance 30 min, T-4 et T-3 récupération, T-2 et T-1 repos |
| « Course sur 3 jours (practice officielle la veille) » | `IXS_3DAY` | **iXS** : comme Hot Trail, mais T-1 = activité officielle |
| « Autre format » | `OTHER` | aucun |
| non saisissable (ligne existante) | `SWISS_CUP`, `UCI_WC`, `UCI_WORLDS` | aucun |
| non saisissable (ligne existante NULL) | NULL : `OTHER` pour M1 (avec avertissement), absent du snapshot | aucun |

**Réponses aux questions 4 et 5** :
- **Une Swiss Cup de deux jours peut-elle recevoir automatiquement le protocole Hot Trail ? Oui.** Il suffit de la saisir avec la forme « Course sur 2 jours », ou de laisser le choix présélectionné. Preuve locale : le rider « Swiss Cup DH fictive (2 jours) » reçoit « Hot Trail, 2 jours » et « J-7… protocole de préparation standard ». Le plan applique ses jours d'avant-course. Saisie en « Autre format », elle ne reçoit rien.
- **Une course UCI de trois jours peut-elle recevoir automatiquement le protocole iXS ? Oui**, si le rider choisit « Course sur 3 jours ».
- Les valeurs `SWISS_CUP` et `UCI_WC` elles-mêmes ne reçoivent jamais de protocole. Les tests d'intégration le vérifient pour une Swiss Cup de 2 jours et une UCI de 3 jours.

**Conclusion** : le formulaire nomme les formats par leur durée et présélectionne « 2 jours ». En pratique, c'est donc **la durée choisie qui déclenche un protocole spécifique** (Hot Trail ou iXS), qui n'est validé ni pour une Swiss Cup ni pour une UCI. C'était déjà le cas au quotidien en production (M1) ; SPORT-RACE-01P l'étend au plan.

**L'activation sportive n'est pas déclarée prête.**

**Correction minimale proposée** (§ 4.4, non appliquée, sans protocole générique) :
- `race_format` désigne le format d'événement pour lequel un protocole existe, jamais une durée ;
- libellés explicites (« Format Hot Trail… », « Format iXS… ») ;
- **aucun format présélectionné** (« Autre format » par défaut) ;
- l'organisateur ou la série est noté dans `series`, colonne existante, sans effet sur le coaching ;
- l'extension d'un protocole à d'autres compétitions relève d'une validation sportive.

---

## 2. Résultats des quatre arbitrages

### AR-A — DH de J-7 sur le seul créneau vélo : appliqué

**Règle**
- M1 n'est pas contourné.
- Une séance d'un autre type, tombée sur un jour du protocole dont la séance n'est pas possible avec les créneaux de ce jour, **est retirée du plan**. M1 la remplacerait sinon par une séance que ce jour ne permet pas (Force sans créneau physique, DH sans créneau vélo).
- **Aucune séance n'est placée un jour incompatible.**

**Cas du rider à trois créneaux** (mardi et jeudi physique, samedi vélo), Hot Trail le samedi :
- **avant** : la DH de J-7 était remplacée, le jour même, par une Force haut du corps guidée sur un créneau vélo ;
- **après** : la DH est retirée du plan. J-7 n'est plus qu'un conseil sans séance guidée, et la Force n'est jamais créée.

**Identifiable** :
- une contrainte relâchée de la version : `{ placement_shortfall, race_protocol_incompatible_day, dh_technical, 2026-11-14 }` ;
- affichée dans « Voir les détails du plan » : « **1 séance DH non placée : le protocole avant la course prévoit ce jour-là une autre séance que tes créneaux ne permettent pas.** »

### AR-B — « Mettre à jour mon programme » : bloqué, non implémenté

**Vérifications**
- **Flag** : en production, `NALYNT_V2_PLAN_GENERATION_ENABLED` est OFF. Un rider affecté V2 reçoit `503 v2_generation_disabled` (testé : `v2RolloutFlag.integration.test.ts`, `planningModelRollout.test.ts`). Un rider non affecté reçoit un plan **V1**, qui ne connaît pas les jours d'avant-course.
- **Affectation** : `training_plan_model_assignments` est lue par le service seulement ; aucun privilège pour `authenticated`.
- **Le web ne peut donc pas savoir** si une génération V2 est possible. Un bouton serait inopérant en production pour les riders V2, et rien ne permettrait de le masquer.

**Ce qui fonctionne, testé en local** : ajout tardif d'une course, puis génération explicite, puis acceptation :
- les jours d'avant-course sont replanifiés ;
- les jours utilisés, les exécutions, les décisions et les prescriptions figées sont intacts ;
- la séance non réalisée du jour de régénération disparaît, car le plan commence le lendemain (BUG-V2-3, existant).

**Contrat nécessaire** (à décider ; pas de nouveau modèle ni de SQL) :
- une capacité serveur en lecture seule, par exemple `generate-training-plan` en mode vérification, qui renvoie « génération possible : oui ou non, modèle V1 ou V2 » sans rien écrire ;
- puis, seulement si elle répond oui et V2, un lien vers la génération existante, avec ce message : « Ton nouveau programme remplacera les jours à venir à partir de demain. La séance d'aujourd'hui, si tu ne l'as pas faite, ne sera plus proposée. Tes séances réalisées et leur historique restent inchangés. »

D'ici là, le message actuel (« contacte-nous ») est conservé, et aucune génération n'est jamais déclenchée automatiquement.

### AR-C — course du lundi, repos de J-2 : appliqué

- Le repos de J-2 est préservé. La DH d'affûtage qui y tombe est **retirée, jamais déplacée** (`race_protocol_rest_day`). Le seul déplacement reste celui de la DH vers T-6, déjà approuvé, impossible ici (mardi physique).
- **Même logique AR-A à J-6** : l'endurance prévue, que M1 remplacerait par une DH sans créneau vélo, est retirée (`race_protocol_incompatible_day`).
- **À valider sportivement** : pour une course le lundi, la dernière DH de ce rider est celle de la semaine spécifique (14 et 15.11, J-9 et J-8).
- Points d'attention affichés : « 1 séance aérobie non placée : le protocole… » et « 1 séance DH non placée : jour de repos du protocole avant la course ».

### AR-D — conseils et compteurs : appliqué

- Un jour sans séance prévue, où M1 ne donne qu'un conseil (`no_planned_session`), n'est plus compté dans « N séances prévues ». Son symbole n'est plus « ○ prévue » mais « · ».
- Une vraie séance prévue compte toujours.
- Les compteurs de séances réalisées et toutes les statistiques d'exécution historiques sont inchangés.
- **Constat à l'écran** (trois créneaux, J-7) : « **2 séances prévues** » (mardi et jeudi), alors qu'il y en avait 4 avant, en comptant les deux conseils du week-end.

---

## 3. Corrections locales et commits

| Commit | Contenu |
|---|---|
| `0672050` | SPORT-RACE-01 : diagnostic, test du contrat d'origine |
| `d7dce8d` | SPORT-RACE-01P : planificateur (option P), `raceFormat` dans le snapshot, présentation web |
| `ad5d759` | SPORT-RACE-01P : rapport, diffs proposés, ADR |
| **`87da636`** | **SPORT-RACE-01P.2** : AR-A, AR-C (retraits identifiables), AR-D (compteurs), tests |
| *(ce commit)* | Rapport 01P.2, diffs révisés et proposition A, addendum ADR, statut, backlog, preuves |

**Fichiers de code de 01P.2**
- `raceProtocolPlacementV2.ts` : règle de retrait, contraintes relâchées ;
- `placementReasonLabels.ts` : libellés des deux raisons ;
- `effectiveDay.ts`, `todayContext.ts`, `programPresentation.ts`, `WeekDaysPicker.tsx` : AR-D.

**Ce qui ne change pas** : M1, SQL et `daily-run` (même bundle que la v46). Seul `generate-training-plan` change.

---

## 4. Diffs canoniques exacts (proposés, non appliqués)

Texte complet et contexte dans `SPORT_RACE_01P_CANON_DIFFS.md`. Ils reprennent les décisions de 01P.2 et **n'introduisent aucune dose non approuvée** : seulement des doses d'affûtage et de récupération existantes, toutes PROVISIONAL.

### 4.1 `docs/03_COACHING_MODEL.md` §6, « Politique de dose du plan V2 »

Remplacer `  - semaine de course : aucune séance normale.` par :

```
  - jours d'avant-course (SPORT-RACE-01P, option P, HPM 2026-10-19 ; arbitrages SPORT-RACE-01P.2) : pour une course A+, A ou B dont le format déclaré a un protocole T-X (`HOT_TRAIL_2DAY`, `IXS_3DAY`, `docs/04` §3), le plan applique ce protocole aux jours de T-7 à T-1 :
    - un jour sans autre séance, il place la séance du protocole seulement quand elle a un modèle V2 et une dose existante, sur un créneau de la bonne activité, une séance par jour au plus :
      - T-7 Force haut du corps légère : dose d'affûtage, 45 min ;
      - T-6 DH technique : dose d'affûtage (légère, 60 min, 4 passages), jamais relevée ;
      - T-4 et T-3 récupération active : `recovery_active_v1`, réservée à son minimum déclaré (20 min) ;
    - il ne place rien à T-5 (« endurance courte » de 30 min : aucune endurance V2 sous 45 min), aux jours REST, à l'activité officielle de T-1 (IXS), aux jours de course ni aux deux jours qui suivent une course ;
    - une DH de la semaine d'affûtage tombée sur un jour du protocole d'un autre type va au jour DH du protocole (T-6), si ce jour est libre et a un créneau vélo assez long ; c'est le seul déplacement autorisé ;
    - une séance tombée sur un jour REST du protocole est retirée : le repos est préservé, la séance n'est jamais déplacée vers un autre jour ;
    - une séance d'un autre type, tombée sur un jour du protocole dont la séance n'est pas possible avec les créneaux de ce jour (Force sans créneau physique, DH sans créneau vélo), est retirée : M1 la remplacerait par une séance que ce jour ne permet pas. M1 n'est jamais contourné et aucune séance n'est placée sur un jour incompatible ;
    - toute séance retirée reste identifiable dans la version du plan : contrainte relâchée `placement_shortfall` (domaine, date, raison `race_protocol_rest_day` ou `race_protocol_incompatible_day`), affichée dans les points d'attention du programme ;
    - format sans protocole (`SWISS_CUP`, `UCI_WC`, `UCI_WORLDS`, `OTHER`, absent) : aucune séance d'avant-course ; la préparation spécifique n'est pas définie, et aucun protocole générique n'est supposé ;
    - valeurs PROVISIONAL (politique `race-protocol-plan-v1`), à valider par un préparateur ;
  - semaine de course : en dehors des jours d'avant-course ci-dessus, aucune séance normale.
```

### 4.2 `docs/05_DATA_MODEL.md`

**a) *Snapshot de génération v2*** (l. 232). Après « `dhTechnicalTier` (`beginner` | `intermediate` | `advanced` | `null`) », ajouter :

> « ; chaque course porte en plus `raceFormat`, le format déclaré (`race_calendar.race_format`), absent si le rider n'en a pas donné (SPORT-RACE-01P, JSON additif, aucune colonne ; un snapshot antérieur sans format ne place aucune séance d'avant-course). »

**b) Progression V2** (`dose_summary`, l. 253). Ajouter :

> « SPORT-RACE-01P : `reasonCodes` peut contenir `race_protocol_sessions` et la progression porte alors `raceProtocolPolicy` (`race-protocol-plan-v1`) ; une semaine `race` peut avoir `sessionCount` > 0, ses `targets` reprenant alors les doses d'affûtage de ce qui est placé. Une séance retirée par le protocole est une contrainte relâchée de la version (`training_plan_versions.relaxed_constraints`) : `{ constraintId: "placement_shortfall", reason: "race_protocol_rest_day" | "race_protocol_incompatible_day", domain, date }`. »

**c) Nouveau paragraphe *Séances d'avant-course (SPORT-RACE-01P)*** (après *Lignée prévu → prescription du jour*) :
- lignée et KEEP copiable, la DH plafonnée par `PLANNED_LOAD_CAP` ;
- récupération à 0 minute dans V2-L2 ;
- moteur quotidien inchangé ; jour sans séance planifiée = recommandation `no_planned_session` ;
- **conseil sans séance prévue** : ni séance prévue ni séance manquée dans les compteurs de semaine, durée M1 jamais présentée comme une prescription, statistiques d'exécution historiques inchangées ;
- **course ajoutée, déplacée ou annulée** : jamais de modification silencieuse ; seule une nouvelle génération explicite et acceptée recalcule les jours d'avant-course ; jours utilisés, exécutions, décisions et prescriptions figées jamais réécrits.

**d) Proposition A** (*race_calendar*, l. 447, décision distincte). Après « (… `OTHER` ; un format existant conservé) », ajouter :

> « `race_format` désigne le format d'événement pour lequel un protocole T-X existe, jamais une simple durée : une compétition d'un autre organisateur (Swiss Cup, UCI…) n'en hérite que si le rider la déclare explicitement sous ce format, et l'extension d'un protocole à d'autres compétitions relève d'une validation sportive. Aucun format n'est présélectionné pour une nouvelle course (« Autre format » par défaut). L'organisateur ou la série peut être noté dans `series` (colonne existante), sans effet sur le coaching. »

### 4.3 `docs/10_TEST_PLAN.md` : nouveau **T67** (après T66)

**« T67. SPORT-RACE-01P — jours d'avant-course planifiés depuis le protocole de course (HPM 2026-10-19 ; arbitrages 01P.2) »**
- **Acceptation, unitaires** : Hot Trail, IXS, AR-A, AR-C, deux courses, indisponible, course C, sans protocole, une séance par jour, contenus V2, miroir de M1.
- **Acceptation, intégration** : KEEP `created` pour les jours planifiés ; recommandations `no_planned_session` pour les autres ; Swiss Cup de 2 jours et UCI de 3 jours sans protocole ; AR-A et AR-C sur base réelle ; fatigue, douleur, Safety ; course ajoutée puis régénération explicite ; course annulée ; aucun doublon.
- **Génération V2 inaccessible** (flag OFF, `v2_generation_disabled`).
- **Non-régression** : plans sans format, quotidien, V1.
- **Web** : pas de durée M1 ; AR-D ; bandeau ; points d'attention ; traduction.

Texte exact intégral dans le fichier des diffs, § 3.

### 4.4 Interface de la proposition A (non implémentée)

- Libellés « Format Hot Trail : 2 jours (entraînements puis course) », « Format iXS : 3 jours, practice officielle la veille » et « Autre format (pas de préparation spécifique automatique) ».
- Défaut : « Autre format ».
- Champ facultatif « Série ou organisateur » (`series`).

---

## 5. Tests ciblés

| Domaine demandé | Test | Résultat |
|---|---|---|
| Hot Trail et iXS | unitaires de placement ; intégration (jours planifiés et exécutables) | ✔ |
| Swiss Cup 2 jours, UCI 3 jours | intégration : `SWISS_CUP` du samedi au dimanche, `UCI_WC` du vendredi au dimanche → semaine de course vide, aucun protocole ; preuve locale qu'une Swiss Cup saisie en « 2 jours » reçoit le protocole Hot Trail (§ 1) | ✔ (constat A) |
| Format inconnu | unitaire (empreinte identique) ; intégration (`OTHER`, NULL) ; web (bandeau) | ✔ |
| Seul créneau DH à J-7 | unitaire et intégration AR-A (contrainte relâchée persistée, J-7 sans Force guidée) ; écran (point d'attention) | ✔ |
| Course le lundi | unitaire et intégration AR-C (repos de J-2, retraits identifiables) ; écran | ✔ |
| Ajout tardif | intégration (aucun changement avant une régénération explicite, puis replanification, historique intact) | ✔ |
| Génération V2 inaccessible / flag OFF | `v2RolloutFlag.integration.test.ts`, `planningModelRollout.test.ts` | ✔ |
| Journée déjà exécutée | intégration (exécution et décision intactes, un second `daily-run` sans doublon) | ✔ |
| Conseils dans le compteur | web AR-D ; écran : « 2 séances prévues » et « · » | ✔ |
| Protections M1 et santé | intégration (fatigue C3.3, douleur `PAIN_NON_SAFETY`, fièvre A3) ; `p0_3HealthSuspendedExecution` par l'Edge local | ✔ |

**Chiffres**

| Suite | Résultat |
|---|---|
| `planning-engine`, suite complète | **1 077 réussis** |
| Intégration course + flag OFF + modèle + miroir | **38 / 38** |
| Suites liées aux courses (A04, PLANNED_LOAD_CAP, engagement, contexte, suspension santé par l'Edge, date de début) | **88 / 88** |
| Web, 60 fichiers touchés | **858 réussis** |
| `tsc` | OK |
| oxlint | 35 avertissements, identiques à la production, 0 erreur |
| Écrans à 375 px | débordement horizontal 0 |

**Incident** : un worker Vitest s'est arrêté brutalement pendant un passage groupé, avec un redémarrage de l'Edge local. Les 6 fichiers ont été rejoués un par un sur un runtime stable : 88 / 88.

**Suites étendues non relancées** : les fichiers modifiés ne le justifient pas. Le quotidien est inchangé, et les preuves de 01P (différentiel, suites complètes) restent valables pour le reste.

---

## 6. Risques sportifs toujours ouverts

1. **Formats** : la forme « 2 / 3 jours » applique un protocole Hot Trail / iXS non validé à n'importe quelle compétition, et « 2 jours » est présélectionné. Proposition A à décider. Ce risque existe aussi au quotidien en production (M1).
2. **Protocole et doses non validés** :
   - Force haut à J-7 ;
   - DH LIGHT 60 à 4 passages à J-6 (T-X : MODERATE) ;
   - deux récupérations d'affilée à J-4 et J-3, réservées à 20 min ;
   - T-5 non planifié ;
   - semaine d'affûtage à 4 séances pour une course du vendredi.
3. **Dernière DH éloignée de la course** :
   - seul créneau vélo à J-7 (AR-A) : DH retirée ;
   - course du lundi (AR-C) : dernière DH à J-8 ou J-9.

   Ce sont des choix conservateurs, à valider.
4. **Formats sans protocole** : la préparation n'est pas définie, ce qui est désormais affiché honnêtement.
5. **Course ajoutée, déplacée ou annulée** : le plan n'est replanifié qu'avec une régénération, que le rider ne peut pas lancer lui-même tant qu'AR-B est bloqué. M1 adapte au jour le jour pour les formats à protocole seulement.
6. **Hérités** : B1, B3, B4, A2 à A5 (SPORT-SAFE) ; PARTIAL-01-L1 et L2 ; seuils V2-L2 ; durées de Force et de DH non mesurées.

---

## 7. Verdict : **MERGE READY**, activation sportive NON prête

**Pourquoi MERGE READY**
- Les quatre arbitrages sont traités : AR-A, AR-C et AR-D appliqués ; AR-B bloqué et documenté, sans bouton inopérant.
- Le code est testé sur les chemins réels.
- M1, SQL et `daily-run` sont inchangés.
- Aucun effet en production tant que la génération V2 reste OFF.

**Avant le merge**
- approuver les diffs `docs/03`, `docs/05` et `docs/10` (§ 4) ;
- décider la proposition A.

**Avant toute activation sportive** (génération V2 ON pour des riders ayant une course)
- appliquer la correction des formats (proposition A, si approuvée) ;
- faire valider le protocole et les doses par le préparateur ;
- trancher le contrat AR-B.

**STOP : revue HPM attendue.**
