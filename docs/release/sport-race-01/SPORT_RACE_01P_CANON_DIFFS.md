# SPORT-RACE-01P — diffs canoniques proposés (révision 01P.2, pour approbation avant merge)

**Pour** : HPM et Louis · **Statut** : proposés, **non appliqués** à `docs/03`, `docs/05` et `docs/10` ; soumis à revue avant merge.

**Base**
- option P, approuvée par l'HPM le 2026-10-19 ;
- décision SPORT-RACE-01P.2 (APPROVED WITH CONDITIONS) et arbitrages AR-A à AR-D.

**Hors de ces diffs**
- aucune dose ni aucun seuil sportif ne change ;
- `docs/04` est inchangé (tables T-X déjà canoniques) ;
- M1 est inchangé.

**Proposition distincte (§ 4)** : la correction du contrat des formats demandée au point A, à décider séparément.

---

## 1. `docs/03_COACHING_MODEL.md` §6, politique de dose du plan V2

**Remplacer**

```
  - semaine de course : aucune séance normale.
```

**par**

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

**Inchangé**, et rappelé explicitement dans la même section :

> « Un KEEP sans séance prévue (récupération par défaut, protocole avant course) n'a pas de prescription du jour : aucune séance n'est inventée. »

Les séances d'avant-course viennent du plan, jamais du moteur quotidien.

---

## 2. `docs/05_DATA_MODEL.md`

### 2.1 Snapshot de génération v2

Section *Snapshot de génération v2*, ligne 232.

**Remplacer**

```
le snapshot v1 plus `dhTechnicalTier` (`beginner` | `intermediate` | `advanced` | `null`).
```

**par**

```
le snapshot v1 plus `dhTechnicalTier` (`beginner` | `intermediate` | `advanced` | `null`) ; chaque course porte en plus `raceFormat`, le format déclaré (`race_calendar.race_format`), absent si le rider n'en a pas donné (SPORT-RACE-01P, JSON additif, aucune colonne ; un snapshot antérieur sans format ne place aucune séance d'avant-course).
```

### 2.2 Progression V2

`training_plan_weeks.dose_summary`, ligne 253. **Ajouter** à la fin du paragraphe :

```
SPORT-RACE-01P : `reasonCodes` peut contenir `race_protocol_sessions` et la progression porte alors `raceProtocolPolicy` (`race-protocol-plan-v1`) ; une semaine `race` peut avoir `sessionCount` > 0 (séances d'avant-course du protocole), ses `targets` reprenant alors les doses d'affûtage de ce qui est placé. Une séance retirée par le protocole est une contrainte relâchée de la version (`training_plan_versions.relaxed_constraints`) : `{ constraintId: "placement_shortfall", reason: "race_protocol_rest_day" | "race_protocol_incompatible_day", domain, date }`.
```

### 2.3 Invariants des séances d'avant-course

Nouveau paragraphe, après *Lignée prévu → prescription du jour* :

```
*Séances d'avant-course (SPORT-RACE-01P)* : ce sont des séances générées ordinaires de la version courante.
- **Lignée et prescription** : KEEP copiable (le T-X de M1 a le même type et la même charge ; la DH MODERATE du protocole est plafonnée à la DH LIGHT prévue par `PLANNED_LOAD_CAP`). Prescription du jour, exécution, verrou de jour utilisé, suspension santé et historique : règles existantes, sans exception.
- **Récupération** (type `RECOVERY_ACTIVE`, sans charge) : 0 minute dans l'historique V2 de la génération (V2-L2), comme toute récupération.
- **Moteur quotidien inchangé** : un jour du protocole sans séance planifiée reste une recommandation sans prescription (`no_planned_session`) ; fatigue, douleur, Safety et P0-SAFE adaptent ou remplacent la séance planifiée comme toute autre.
- **Conseil sans séance prévue** (SPORT-RACE-01P.2) : un jour où le plan ne prévoit rien et où M1 ne donne qu'une recommandation n'est ni une séance prévue ni une séance manquée dans les compteurs de semaine. Sa durée M1 n'est jamais présentée comme une prescription. Les statistiques d'exécution historiques sont inchangées.
- **Course ajoutée, déplacée ou annulée après la génération** : le plan n'est jamais modifié silencieusement. Seule une nouvelle génération, explicite et acceptée, recalcule les jours d'avant-course. Les jours utilisés, les exécutions, les décisions et les prescriptions figées ne sont jamais réécrits (projection PILOT_022, CONSISTENCY-01, verrou de jour). Sans régénération, les séances déjà planifiées restent des séances ordinaires, et M1 applique chaque jour le T-X de la course réelle.
```

---

## 3. `docs/10_TEST_PLAN.md`, nouveau T67 (après T66)

```
### T67. SPORT-RACE-01P — jours d'avant-course planifiés depuis le protocole de course (HPM 2026-10-19 ; arbitrages 01P.2)
Règles : `docs/03` §6 (jours d'avant-course), `docs/05` (snapshot v2 `raceFormat`, contraintes relâchées, invariants des séances d'avant-course), `docs/04` §3 (T-X, inchangé).
- **Acceptation, unitaires** (`sportRace01pRaceProtocolPlacement.test.ts`, `sportRace01pProtocolMirror.test.ts`) :
  - HOT_TRAIL_2DAY du samedi, créneaux vélo le week-end : la DH d'affûtage passe de J-7 à J-6, même dose ; récupération à J-4 et J-3 ; rien à J-5, J-2, J-1 ni les jours de course ; rien de retiré ;
  - IXS_3DAY du vendredi : Force haut LIGHT 45 à J-7 sur un créneau physique, DH d'affûtage à J-6, récupération à J-4 et J-3 ;
  - AR-A, un seul créneau vélo (le samedi de J-7) : la DH n'est pas déplacée et ne reste pas (M1 la remplacerait par de la Force un jour sans créneau physique) ; elle est retirée, avec une contrainte relâchée `race_protocol_incompatible_day` (DH, date) ;
  - AR-C, course du lundi : le repos de J-2 est préservé ; la DH qui y tombe est retirée, jamais déplacée (`race_protocol_rest_day`) ; à J-6 (jour DH du protocole sans créneau vélo), l'endurance prévue est retirée (`race_protocol_incompatible_day`) ;
  - deux courses rapprochées : rien les jours de la première course ni les deux jours qui suivent ;
  - jour indisponible, course C, format sans protocole : rien ; plan identique (empreinte) à celui d'une course sans format ;
  - une séance par jour au plus ; contenus V2 existants (`recovery_active_v1`, gabarit Force haut LIGHT, DH à 4 passages) ;
  - la table du planificateur est celle de M1, jour par jour (contre-preuve : les autres formats n'ont rien dans les deux).
- **Acceptation, intégration** (`sportRace01.integration.test.ts`, chemins réels) :
  - les jours planifiés sont des KEEP `created` (Force à J-7, DH plafonnée LIGHT à J-6, récupération à J-4 et J-3) ; J-5, J-2 et J-1 restent des recommandations `no_planned_session` ;
  - Swiss Cup de deux jours (`SWISS_CUP`), UCI de trois jours (`UCI_WC`), `OTHER` et sans format : semaine de course sans séance, jamais le protocole Hot Trail ni iXS ;
  - AR-A et AR-C sur base réelle (contraintes relâchées persistées, aucune Force guidée un jour vélo) ;
  - fatigue et douleur adaptent la séance planifiée ; Safety prioritaire ;
  - course ajoutée : aucun changement avant une régénération explicite, puis séances d'avant-course placées, jour utilisé, exécution et décision intacts ; course annulée : séances déjà planifiées ordinaires ; aucun doublon.
- **Génération V2 inaccessible** (`v2RolloutFlag.integration.test.ts`, `planningModelRollout.test.ts`) : flag OFF, un athlète affecté V2 est refusé (`v2_generation_disabled`), rien n'est écrit.
- **Non-régression** : plans sans course ou sans format identiques à la production ; quotidien inchangé (`daily-run` : même bundle ; différentiel flags OFF `phys00FlagsOffEquivalence.test.ts` inchangé) ; V1 inchangé.
- **Web** (`sportRace01p.test.tsx`) :
  - un jour sans séance prévue n'affiche jamais la durée de M1 (« 4 h ») comme une prescription ;
  - AR-D : il ne compte pas comme séance prévue et n'est pas « ○ prévue » ; une vraie séance prévue compte ;
  - bandeau « Préparation spécifique non définie » à 7 jours ou moins d'une course sans protocole ;
  - points d'attention des séances retirées ; explication du plan traduite.
```

---

## 4. Proposition A, contrat des formats (décision distincte, non appliquée)

**Constat** : le formulaire « Tes courses » présente `HOT_TRAIL_2DAY` comme « Course sur 2 jours (entraînements + course) » et `IXS_3DAY` comme « Course sur 3 jours (practice officielle la veille) ». « 2 jours » est **présélectionné** pour une nouvelle course.

**Conséquence** : une Swiss Cup ou une UCI saisie avec la forme correspondante (ou laissée au défaut) reçoit le protocole Hot Trail ou iXS :
- au quotidien, comme M1 le fait déjà en production ;
- dans le plan, avec SPORT-RACE-01P.

Ce protocole n'est pas validé pour ces compétitions.

### 4.1 `docs/05`, race_calendar (ligne 447)

**Remplacer**

```
et `race_format` (`HOT_TRAIL_2DAY` / `IXS_3DAY` / `OTHER` ; un format existant conservé).
```

**par**

```
et `race_format` (`HOT_TRAIL_2DAY` / `IXS_3DAY` / `OTHER` ; un format existant conservé). `race_format` désigne le format d'événement pour lequel un protocole T-X existe, jamais une simple durée : une compétition d'un autre organisateur (Swiss Cup, UCI…) n'en hérite que si le rider la déclare explicitement sous ce format, et l'extension d'un protocole à d'autres compétitions relève d'une validation sportive. Aucun format n'est présélectionné pour une nouvelle course (« Autre format » par défaut). L'organisateur ou la série peut être noté dans `series` (colonne existante), sans effet sur le coaching.
```

### 4.2 Interface (`web/src/features/races`, non implémentée)

- **Libellés** :
  - « Format Hot Trail : 2 jours (entraînements puis course) » ;
  - « Format iXS : 3 jours, practice officielle la veille » ;
  - « Autre format (pas de préparation spécifique automatique) ».
- **Défaut d'une nouvelle course** : « Autre format ».
- **Champ facultatif** « Série ou organisateur » (`series`).

Aucune migration ni aucun protocole nouveau ; M1 inchangé.
