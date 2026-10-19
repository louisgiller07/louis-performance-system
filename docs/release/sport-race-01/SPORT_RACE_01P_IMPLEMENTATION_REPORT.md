# SPORT_RACE_01P_IMPLEMENTATION_REPORT — planification réelle des semaines de course

**Date** : 2026-10-19 · **Pour** : HPM et Louis, puis le préparateur pour les paramètres sportifs · **Branche** : `fix/sport-race-01` (depuis la production `79b4d19`) · **Nature** : développement local ciblé.

**Verdict : LOCAL READY**, sous conditions :
- les diffs `docs/03`, `docs/05` et `docs/10` sont proposés mais non appliqués ;
- deux points sont arrêtés et décrits avec leur arbitrage exact : la DH de J-7 sur le seul créneau vélo, et le déclencheur de réévaluation après l'ajout d'une course.

Aucun push, merge, déploiement, migration ni flag.

**Rien de ce rapport n'est sportivement validé.** Les programmes cités sont des sorties réelles du moteur, avec des doses PROVISIONAL.

**Preuves**
- `evidence/SPORT_RACE_01P_REAL_DECISIONS_BEFORE_AFTER.txt` : toutes les décisions jour par jour, avant (production) puis après (branche).
- `evidence/SPORT_RACE_01P_VISIBLE_TEXTS_375.txt` : textes affichés, captures du web de la branche à 375 px.
- `SPORT_RACE_01P_CANON_DIFFS.md` : diffs canoniques proposés.

---

## 1. Modifications réellement implémentées

### 1.1 Planificateur V2 (`planning-engine`)

**Fichiers**
- `catalog/raceProtocolPlanPolicyV2.ts` (nouveau) : politique `race-protocol-plan-v1`, PROVISIONAL. Elle contient le reflet des tables T-X de M1 (`RACE_PROTOCOL_TABLES_V2`). M1 reste la source de vérité ; l'égalité est verrouillée par test.
- `sessionModelV2/orchestration/raceProtocolPlacementV2.ts` (nouveau) : `placeRaceProtocolSessionsV2`, appliqué après le pipeline partagé.

**Quelles courses** : seulement les courses A+, A et B dont le format a un protocole (`HOT_TRAIL_2DAY`, `IXS_3DAY`). Une course C ne change rien (A09).

**Ce que fait la passe, du jour T-7 au jour T-1**

1. Une DH de la semaine d'affûtage tombée sur un jour du protocole d'un autre type va au jour DH du protocole (T-6), si celui-ci est libre et a un créneau vélo assez long. Sinon elle reste à sa place.
2. Une séance tombée sur un jour REST du protocole, ou sur l'activité officielle de T-1 en IXS, est retirée.
3. Un jour du protocole resté libre reçoit la séance du protocole, avec une dose existante :

| Jour | Séance placée | Dose | Créneau exigé |
|---|---|---|---|
| T-7 | Force haut du corps LIGHT | 45 min, dose d'affûtage | physique |
| T-6 | DH technique LIGHT | 60 min, 4 passages, dose d'affûtage | vélo |
| T-4 et T-3 | récupération active `recovery_active_v1` | réservée à 20 min, son minimum déclaré | n'importe lequel |

**Ce que la passe ne fait jamais**
- placer une séance à T-5, aux jours REST, aux jours de course ou aux deux jours qui suivent une course ;
- placer une séance un jour verrouillé ou indisponible ;
- placer deux séances le même jour.

**Autres modifications**
- **Traçabilité de la semaine** : code `race_protocol_sessions`, `raceProtocolPolicy`, phrase d'explication ; compteurs mis à jour.
- **Séances planifiées** : `RECOVERY_ACTIVE` devient une séance V2 planifiable ; son contenu est le protocole existant, le même que pour un REPLACE.
- **Snapshot V2** : chaque course porte `raceFormat`, le format déclaré. L'adaptateur `buildPlanInputSnapshotV2` le reprend des lignes de course que le builder V1 lit déjà, sans requête supplémentaire.

### 1.2 Quotidien et M1

**Aucune modification.**
- Le bundle `dailyRunV2` est identique à la production v46 (`8202edc5…`), comme le graphe de `daily-run` (`cc83c059…`).
- Les séances d'avant-course sont des séances générées ordinaires. M1 les garde (même type et même charge que son T-X ; la DH MODERATE du T-X est plafonnée à la DH LIGHT prévue), puis la copie V2 les rend exécutables.
- Un jour sans séance planifiée reste une recommandation sans prescription : « aucune séance n'est inventée ».

### 1.3 Web (présentation seulement)

**Jour V2 sans séance prévue** (`blocked`, raison `no_planned_session`, hors repos et jour de course)
- La mission n'affiche plus la durée de M1. C'est elle qui donnait « DH technique 4 h », la fenêtre V1.
- Elle ajoute : « Ton programme ne prévoit pas de séance ce jour-là : c'est un conseil, sans séance guidée ni durée prescrite. »
- La bande de la semaine et le Programme indiquent « Pas de séance guidée », sans durée.

**Bandeau de course**, à 7 jours ou moins d'une course sans protocole :
- « Préparation spécifique non définie pour ce format de course : NALYNT ne planifie pas de séance les jours qui la précèdent. »

**Explication du plan** : traduction de la nouvelle phrase.

### 1.4 Tests ajoutés ou mis à jour

| Fichier | Contenu |
|---|---|
| `planning-engine/tests/unit/sportRace01pRaceProtocolPlacement.test.ts` | 10 cas |
| `head-coach-engine/tests/sportRace01pProtocolMirror.test.ts` | table du planning = T-X de M1 ; contre-preuve sur les autres formats |
| `head-coach-engine/tests/supabase/sportRace01.integration.test.ts` | 10 cas sur les chemins réels, au nouveau contrat |
| `web/src/features/today/sportRace01p.test.tsx` | 8 cas, dont une contre-preuve sur la durée |

---

## 2. Diffs canoniques proposés

Texte exact dans `SPORT_RACE_01P_CANON_DIFFS.md`, **non appliqué**.
- **`docs/03` §6** : la ligne « semaine de course : aucune séance normale » devient la règle des jours d'avant-course décrite au § 1.1. La règle « aucune séance n'est inventée » est inchangée et rappelée.
- **`docs/05`** :
  - `raceFormat` dans le snapshot v2 ;
  - `race_protocol_sessions` et `raceProtocolPolicy` dans la progression ;
  - nouveau paragraphe d'invariants des séances d'avant-course (lignée, prescription, récupération à 0 minute dans V2-L2, quotidien inchangé, aucune réécriture silencieuse après un changement de course).
- **`docs/10`** : nouveau T67 (acceptation, non-régression, web).
- **`docs/04`** : aucun changement ; les tables T-X sont déjà canoniques.
- **Textes rider proposés** : les trois phrases du § 1.3.

**Tant que ces diffs ne sont pas approuvés, le code est en avance sur le canon.**

---

## 3. Programmes V2 réels, avant et après (de J-7 à J0)

**Conditions**
- Plan généré le dimanche 2026-11-01 ; semaines 1 et 2 faites en entier ; un daily-run par jour, check-in neutre.
- Rider C : Force intermédiaire, DH avancé, salle complète ; soirées de semaine « physique », week-end « vélo ».

**Notation**
- ✔ : séance guidée exécutable.
- ✘ : recommandation sans séance guidée.
- *(conseil)* : texte affiché sans durée après la correction web.

### 3.1 HOT_TRAIL_2DAY, du samedi 21 au dimanche 22

| Jour | Avant (production) | Après (branche) |
|---|---|---|
| J-7, sam. 14 (vélo) | DH d'affûtage remplacée par **Force haut LIGHT 45** ✔, sur un créneau vélo | Force haut LIGHT ✘ *(conseil)*. La DH n'est plus là |
| J-6, dim. 15 (vélo) | DH MODERATE « 4 h » ✘ | **DH LIGHT 60, 4 passages ✔**. La DH d'affûtage, déplacée, devient la dernière DH (J-6) |
| J-5, lun. 16 | endurance 30 ✘ | endurance 30 ✘ *(conseil, pas de V2 à 30 min)* |
| J-4, mar. 17 | récupération ✘ | **récupération 20 ✔** |
| J-3, mer. 18 | récupération 20 ✘ | **récupération 20 ✔** |
| J-2 et J-1 | repos ✘ | repos ✘ (voulu) |
| J0 | course ✘ | course ✘ (voulu) |

**Ce qui change** : de 1 séance guidée (le renfo de J-7) à **3** (DH de J-6, récupérations de J-4 et J-3).
- Discipline : DH conservée à J-6, au lieu de Force à J-7.
- Créneaux respectés : DH sur vélo, récupérations sur des soirées physiques.
- Provenance : `RACE_PROTOCOL_TX` et `PLANNED_LOAD_CAP` à J-6.

### 3.2 IXS_3DAY, du vendredi 20 au dimanche 22

| Jour | Avant | Après |
|---|---|---|
| J-7, ven. 13 (physique) | Force haut LIGHT ✘ | **Force haut LIGHT 45 ✔** |
| J-6, sam. 14 | DH d'affûtage LIGHT 60 ✔ | identique ✔ |
| J-5 | endurance 30 ✘ | identique ✘ |
| J-4, J-3 | récupération ✘ | **récupération 20 ✔** (deux fois) |
| J-2 / J-1 | repos / activité officielle ✘ | identique ✘ (voulu) |

**Ce qui change** : de 1 à **4** séances guidées. La semaine d'affûtage compte 4 séances au lieu de 3 : Force bas, endurance, Force haut, DH.

### 3.3 SWISS_CUP, UCI_WC, OTHER et sans format

Sorties **strictement identiques** avant et après :
- semaine d'affûtage normale, dont la DH de J-7 (ou J-6 pour la course UCI du vendredi) ✔ ;
- de J-6 à J-1, récupération par défaut ✘ ;
- jours de course ✘.

Après la correction, l'écran le dit explicitement : bandeau « préparation spécifique non définie » et phrase de conseil, sans durée.

### 3.4 Riders demandés

| Rider | Après (sorties réelles) |
|---|---|
| **D1**, avancé, plusieurs créneaux | Comme le § 3.1 : DH LIGHT 60 à J-6 ✔, récupérations à J-4 et J-3 ✔ ; aucun doublon, une séance prévue par jour au plus |
| **D2**, intermédiaire, trois créneaux (mardi et jeudi physique, samedi vélo) | La DH de J-7 (samedi, son seul créneau vélo) **reste remplacée par du renfo haut du corps** : aucun créneau vélo à J-6 pour la déplacer (arbitrage AR-A, § 7). J-6 DH MODERATE ✘, affichée **sans « 4 h »** avec la phrase de conseil. Récupération à J-4 (mardi) ✔ ; J-3 sans créneau ✘ |
| **D3**, fatigué à l'approche | Fatigue systémique : la Force d'affûtage devient une récupération (`V2_SYSTEMIC_FLOOR`). DH LIGHT 60 à J-6 ✔. Douleur au genou 4/10 à J-4 : la récupération prévue reste ✔, avec `PAIN_NON_SAFETY`. Fièvre à J-2 : repos Safety A3, puis A7 jusqu'à la levée du signal, jours de course compris (P0-SAFE prioritaire) |
| **D4**, entraînements officiels connus | (a) IXS : J-1 = activité officielle ✘ (voulu) ; Force à J-7, DH à J-6 et récupérations ✔. (b) Course saisie depuis son premier jour officiel, format « Autre » : jours officiels = activité de course ; aucune séance d'avant-course (pas de protocole). (c) DH manuelle un jour vélo (J-6) ✔ ; DH manuelle un jour REST du protocole (J-1) : remplacée par le repos ✘ |

### 3.5 Autres scénarios

| Scénario | Résultat après |
|---|---|
| **Course déplacée** après la génération, sans régénération (du 21–22 au 28–29) | Les séances d'avant-course déjà planifiées (DH de J-6, récupérations) restent des **séances légères ordinaires** ✔. M1 applique le T-X à la nouvelle date : séances de la semaine suivante remplacées (endurance LIGHT 45, récupérations) ✔ ; ancien jour T-6 = conseil DH ✘ |
| **Course annulée** | Séances déjà planifiées ordinaires ✔ ; jours de course libérés = récupération conseillée ✘ |
| **Deux courses rapprochées** (21–22 A, 28–29 B) | Rien les jours de la première course ni les deux jours suivants ; récupération à J-3 de la seconde ✔ |
| **Course ajoutée tardivement** | Voir § 6 |
| **Course proche** (plan généré le mardi 17 pour le samedi 21) | La semaine du plan démarre le 18 et elle est la semaine de course : récupération à J-3 ✔. Les jours T-7 à T-4 sont avant le plan |
| **Semaines normales, plans sans course** | Identiques à la production (empreintes égales, § 4) |

---

## 4. Tests et résultats

| Contrôle | Résultat |
|---|---|
| Unitaires `planning-engine` (suite complète, dont 10 nouveaux cas) | **1 077 réussis**, 4 ignorés ; `tsc` OK |
| Unitaires `head-coach-engine` (hors intégration ; miroir T-X 2/2) | **1 036 réussis** ; `tsc` : 27 erreurs, **toutes préexistantes**, liste identique à la production |
| `sportRace01.integration.test.ts` (chemins réels, pile locale) | **10 / 10** |
| Toutes les suites d'intégration qui génèrent un plan V2 (52 fichiers ; risque : le snapshot V2 a changé) | **44 fichiers réussis**, 8 ignorés par leur propre condition d'environnement. Deux 502 sont dus à un redémarrage du runtime Edge local en plein passage (journal) ; les deux fichiers ont été rejoués sur un runtime stable : 11 / 11 |
| Suspension santé par l'Edge local (`p0_3HealthSuspendedExecution`, dont le REST T-2 du protocole) | **5 / 5** |
| Différentiel flags OFF contre la production (`phys00FlagsOffEquivalence`) | **4 / 4**, compteurs épinglés inchangés : le quotidien ne change pas |
| Web, suite complète (dont `sportRace01p` 8/8) | **2 380 réussis**, 61 ignorés ; build et `tsc` OK ; oxlint : 35 avertissements, identiques à la production, 0 erreur |
| Navigateur réel, 375 px (web de la branche) | Aujourd'hui, séance guidée, Programme : textes ci-dessus ; débordement horizontal 0 |
| Doublons | au plus 1 séance prévue par jour, au plus 1 prescription par décision, 1 exécution après un second `daily-run` |
| M1 / SQL | 0 ligne dans `head-coach-engine/src/{types,engine,rules,domains,mapping}` ; 0 fichier `supabase/` |
| V1 | aucun fichier V1 touché ; `raceFormat` n'est ajouté qu'au snapshot V2 |

---

## 5. Limites des formats inconnus

**Ce que le modèle actuel sait**
- `race_format` mélange deux notions :
  - des formes de calendrier : `HOT_TRAIL_2DAY` = 2 jours, entraînements + course ; `IXS_3DAY` = 3 jours, practice la veille ;
  - des organisateurs ou séries : `SWISS_CUP`, `UCI_WC`, `UCI_WORLDS`.
- Le formulaire du rider ne propose déjà que des **formes de calendrier** : « Course sur 2 jours (entraînements + course) », « Course sur 3 jours (practice officielle la veille) », « Autre format ».
- Les colonnes `series`, `category`, `location` et `country` existent, mais ne sont pas saisies.
- **Aucune donnée ne porte le calendrier effectif** : jours de reconnaissance ou d'entraînement, chrono, qualifications, finales. `race_phase` n'existe pas en base.

**Ce qui est appliqué**
- Un protocole seulement pour un format qui en a un, et seulement s'il est déclaré par le rider.
- Une Swiss Cup ou une UCI n'est jamais assimilée automatiquement à HOT_TRAIL ou IXS.
- Les formats `SWISS_CUP`, `UCI_*`, `OTHER` et sans format restent sans séance d'avant-course. L'écran le dit explicitement.

**Minimum nécessaire pour planifier correctement**
1. Le calendrier effectif : premier jour officiel sur place, et pour chaque jour officiel son type (reconnaissance, entraînement, chrono, qualification, finale).
2. Un protocole validé pour cette forme de calendrier.

Sans le second, le premier ne suffit pas.

**Plus petit changement de contrat et d'interface proposé** (non implémenté, à décider)
- **Contrat** : `race_format` désigne la forme du calendrier, et l'organisateur va dans `series`, colonne existante, sans migration. Les valeurs historiques `SWISS_CUP` et `UCI_*` sont traitées comme « Autre » tant que le rider n'a pas déclaré de forme.
- **Interface** : un champ facultatif « Série ou organisateur » (écrit dans `series`), et sous « Autre format », le texte actuel « Pas d'affûtage spécifique automatique » complété par « choisis 2 ou 3 jours si ton programme sur place correspond ».
- **Plus tard** : un calendrier jour par jour (donnée additive, SQL), seulement avec un protocole validé pour cette forme.

**Préparation spécifique non encore définie pour ces formats.** Aucun protocole générique n'a été créé, et aucun programme normal n'est réintroduit pour combler ce manque.

---

## 6. Comportement après ajout tardif d'une course

**Parcours testé** (intégration, et simulation F4) :
1. Plan V2 accepté.
2. Séances réalisées jusqu'au lundi 9.
3. Course Hot Trail ajoutée pour le samedi 21.
4. La semaine concernée contient des séances MODERATE.

**Sans action, rien ne change** (aucune régénération silencieuse)
- La semaine de course garde ses séances normales : Force MODERATE 60 lundi 16 et mardi 17, endurance MODERATE 60 mercredi 18.
- M1 les adapte au jour le jour par le T-X : remplacements exécutables (renfo léger, endurance LIGHT 45, récupération), comme en production.
- Pour une course ajoutée au format « Autre », aucune adaptation : séances MODERATE jusqu'à J-3. C'est l'avertissement existant (A09).

**Réévaluation contrôlée** : une nouvelle génération explicite, puis son acceptation (chemin existant, celui du panneau « Affiner ton profil » ou de l'équipe). La version régénérée le mardi 10 place :
- la DH d'affûtage le dimanche 15 ;
- les récupérations le mardi 17 et le mercredi 18 ;
- rien le 16 ni du 19 au 22.

Ce qui reste intact :
- **jour utilisé** : la ligne du lundi 9 ne bouge pas (`STRENGTH_LOWER MODERATE 60`) ;
- **exécutions** : celles du 2 au 9 sont inchangées ;
- **décisions** : celle du 9 aussi ; aucune prescription figée n'est réécrite.

**Limite existante (BUG-V2-3)** : le nouveau plan commence le lendemain. La séance non faite du jour de régénération (mardi 10) disparaît.

**Sous-périmètre arrêté** : le **déclencheur côté rider**. Le message actuel après l'enregistrement d'une course dit : « Pendant la bêta, contacte-nous si tu veux que nous reconstruisions aussi ta préparation » ; c'est une décision produit existante. **Arbitrage exact (AR-B)** :
- **(1)** garder la reconstruction par l'équipe pendant la bêta, ce qui ne demande aucun changement ;
- **(2)** ou, quand une course est ajoutée ou modifiée dans l'horizon du programme courant, proposer au rider « Mettre à jour mon programme pour cette course », lien vers la génération existante, avec aperçu et acceptation explicites et les avertissements CONSISTENCY-01. Il n'y aurait jamais de régénération automatique, ni de modèle ou de SQL nouveaux, seulement un texte et un lien à approuver.

Recommandation : (2), si l'HPM l'accepte. En attendant : (1).

---

## 7. Paramètres sportifs toujours provisoires

**Politique `race-protocol-plan-v1`** (PROVISIONAL) : quelles entrées du T-X sont planifiées et avec quelles doses.
- T-7 Force haut à la dose d'affûtage (45 min).
- T-6 DH à la dose d'affûtage (LIGHT 60, 4 passages), alors que le T-X dit MODERATE.
- Récupération à T-4 et T-3, réservée à 20 min, alors que le protocole va de 20 à 55 min.
- T-5 non planifié (endurance de 30 min contre 45 min minimum en V2).
- Semaine d'affûtage à 4 séances pour une course du vendredi (Force haut ajoutée à J-7).

**Hérités, non validés**
- Les tables T-X elles-mêmes (`docs/04`), doses d'affûtage et de semaine spécifique, `recovery_active_v1`.
- L'alignement des rôles par semaine : selon le jour de course, la dernière DH tombe à J-6, J-7 ou J-8.

**Arbitrages ouverts**
- **AR-A** : une DH de J-7 sur le seul créneau vélo d'un rider sans créneau vélo à J-6 est encore remplacée par du renfo haut du corps (rider D2). La préserver exige soit une règle M1 gouvernée (ADR : « une recommandation T-X ordinaire ne remplace pas une séance V2 placée pour cette course », PLANNED_LOAD_CAP maintenu, contre-preuve), soit de l'accepter. Marquer la séance « engagée » ne suffit pas : M1 la convertit en DH_LIGHT, et le refus « contenu identique » (A04 §6) bloquerait alors la séance. **Non codé.**
- **AR-B** : déclencheur de réévaluation (§ 6).
- **AR-C** : course du lundi, où la DH d'affûtage tombée sur le REST de J-2, sans créneau pour la déplacer, est retirée du plan. Le quotidien l'aurait remplacée par du repos.
- **AR-D** : compteur « N séances prévues » de la bande de la semaine. Un jour de conseil y compte comme « prévu ». Comportement préexistant ; les compteurs n'ont pas été touchés (même règle que SPORT-SAFE-RELEASE-01).

---

## 8. Impacts sur SQL, Edge, web et flags

| Couche | Impact |
|---|---|
| SQL | **aucun** : aucune migration ; `RECOVERY_ACTIVE` sans charge est déjà accepté par les contraintes ; `raceFormat` est un JSON additif du snapshot |
| Edge | **`generate-training-plan` seule** : bundle `1e760f1b…` (production `e7944713…`), graphe `025fe717…`. **`daily-run` identique** à la v46 (bundle `8202edc5…`, graphe `cc83c059…`) |
| Web | présentation : mission sans durée M1 les jours sans séance prévue, bande et Programme, bandeau de course, traduction |
| Flags | **aucun** ; aucun nouvel interrupteur. Le changement concerne toute génération V2. La génération V2 est aujourd'hui OFF en production (`NALYNT_V2_PLAN_GENERATION_ENABLED`) : les plans V2 existants ne changent qu'à leur prochaine génération |
| V1 | aucun |
| Données | aucune réécriture ; les plans, décisions et exécutions existants restent tels quels |

---

## 9. Risques avant la bêta payante

1. **Canon non approuvé** : `docs/03`, `docs/05` et `docs/10` décrivent encore l'ancien contrat.
2. **Rien n'est validé sportivement** : protocole T-X, doses d'affûtage, récupérations rapprochées, Force haut à J-7, DH LIGHT à J-6.
3. **Rider avec un seul créneau vélo** : il perd sa dernière DH à J-7 (AR-A).
4. **Formats sans protocole** (Swiss Cup ou UCI saisies en « Autre ») : semaine de course sans séance guidée. C'est désormais affiché honnêtement, mais ce n'est pas une préparation.
5. **Course ajoutée ou modifiée** : sans régénération, la semaine n'est pas replanifiée (AR-B). Course annulée ou déplacée : le plan reste celui d'avant.
6. **Durées** : la récupération est réservée à 20 min, mais son contenu va de 20 à 55 min ; la Force est estimée à 45 min. Durées non mesurées (R13).
7. **Toujours ouverts** : B1, B3, B4 et A2 à A5 (SPORT-SAFE), PARTIAL-01-L1 et -L2, et les seuils V2-L2.

**Recommandation** :
- **Avant la bêta payante** des riders ayant une course A ou B dans l'horizon :
  - approuver les diffs ;
  - trancher AR-A et AR-B ;
  - faire valider le protocole par le préparateur.
- **D'ici là** :
  - réserver la bêta aux riders dont la course est saisie en « Course sur 2 jours » ou « Course sur 3 jours » et qui ont un créneau vélo la veille de leur dernier jour d'affûtage ;
  - informer les autres que la semaine de course n'est pas planifiée.

---

## 10. Verdict : **LOCAL READY**

L'option P est implémentée et testée sur les chemins réels :
- les semaines de course d'un format à protocole ont désormais des séances planifiées et exécutables, là où le format, le jour et la disponibilité le permettent ;
- `daily-run` n'invente toujours rien ;
- M1, SQL et `daily-run` sont inchangés ;
- les formats sans protocole affichent honnêtement que leur préparation n'est pas définie.

Restent avant toute intégration :
- l'approbation des diffs canoniques ;
- les arbitrages AR-A et AR-B (sous-périmètres arrêtés), AR-C et AR-D ;
- la validation sportive.

**STOP : revue HPM attendue.**
