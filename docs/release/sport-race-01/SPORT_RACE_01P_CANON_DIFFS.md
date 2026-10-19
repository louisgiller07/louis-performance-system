# SPORT-RACE-01P — diffs canoniques proposés (révision 01P.3, texte normatif final pour approbation avant merge)

**Pour** : HPM et Louis · **Statut** : approuvés (SPORT-RACE-01P.3, APPROVED WITH CONDITIONS) et **appliqués localement** à `docs/03`, `docs/05` et `docs/10` en SPORT-RACE-01P.4 (branche `fix/sport-race-01`, non mergée) ; validation HPM du diff normatif avant merge. T67 est inséré juste avant T66 (ordre décroissant local de `docs/10`).

**Base**
- option P, approuvée par l'HPM le 2026-10-19 ;
- décision SPORT-RACE-01P.2 (APPROVED WITH CONDITIONS) et arbitrages AR-A à AR-D, conservés tels quels ;
- proposition A (SPORT-RACE-01P.3), approuvée comme contrat fonctionnel cible : la compétition, le format et la durée sont distincts ; un protocole ne s'applique qu'à une course explicitement identifiée comme la série pour laquelle il a été écrit.

**Hors de ces diffs**
- aucune dose ni aucun seuil sportif ne change ;
- `docs/04` est inchangé (tables T-X déjà canoniques ; M1 reçoit le format sélectionné par l'adapter) ;
- M1 est inchangé ; aucune migration.

**Révision 01P.3** : § 1, § 2.1 et § 3 précisés ; § 2.4 nouveau (contrat des formats et séries, compatibilité, invariants). L'ancienne « proposition A distincte » (§ 4 de la révision 01P.2) est remplacée par § 2.4 et § 4.

---

## 1. `docs/03_COACHING_MODEL.md` §6, politique de dose du plan V2

**Remplacer**

```
  - semaine de course : aucune séance normale.
```

**par**

```
  - jours d'avant-course (SPORT-RACE-01P, option P, HPM 2026-10-19 ; arbitrages SPORT-RACE-01P.2 ; contrat des formats SPORT-RACE-01P.3) : pour une course A+, A ou B explicitement identifiée comme une compétition dont le protocole T-X existe (Hot Trail Series → `HOT_TRAIL_2DAY`, iXS → `IXS_3DAY`, `docs/04` §3 ; sélection `docs/05` §race_calendar), le plan applique ce protocole aux jours de T-7 à T-1 :
    - un jour sans autre séance, il place la séance du protocole seulement quand elle a un modèle V2 et une dose existante, sur un créneau de la bonne activité, une séance par jour au plus :
      - T-7 Force haut du corps légère : dose d'affûtage, 45 min ;
      - T-6 DH technique : dose d'affûtage (légère, 60 min, 4 passages), jamais relevée ;
      - T-4 et T-3 récupération active : `recovery_active_v1`, réservée à son minimum déclaré (20 min) ;
    - il ne place rien à T-5 (« endurance courte » de 30 min : aucune endurance V2 sous 45 min), aux jours REST, à l'activité officielle de T-1 (IXS), aux jours de course ni aux deux jours qui suivent une course ;
    - une DH de la semaine d'affûtage tombée sur un jour du protocole d'un autre type va au jour DH du protocole (T-6), si ce jour est libre et a un créneau vélo assez long ; c'est le seul déplacement autorisé ;
    - une séance tombée sur un jour REST du protocole est retirée : le repos est préservé, la séance n'est jamais déplacée vers un autre jour ;
    - une séance d'un autre type, tombée sur un jour du protocole dont la séance n'est pas possible avec les créneaux de ce jour (Force sans créneau physique, DH sans créneau vélo), est retirée : M1 la remplacerait par une séance que ce jour ne permet pas. M1 n'est jamais contourné et aucune séance n'est placée sur un jour incompatible ;
    - toute séance retirée reste identifiable dans la version du plan : contrainte relâchée `placement_shortfall` (domaine, date, raison `race_protocol_rest_day` ou `race_protocol_incompatible_day`), affichée dans les points d'attention du programme ;
    - toute autre course n'a aucune séance d'avant-course : Swiss Cup ou autre course en Suisse, Coupe ou Championnats du monde UCI, Coupe de France DH / DHI, Championnats de France DH / DHI, coupes et championnats régionaux, autre compétition, course enregistrée avant ce contrat en « 2 jours » ou « 3 jours » sans compétition identifiée, format absent. Sa préparation spécifique n'est pas définie et le rider le voit ; aucun protocole générique n'est supposé et aucun protocole n'est déduit d'une durée, d'un nom ou d'une série en texte libre ;
    - valeurs PROVISIONAL (politique `race-protocol-plan-v1`), à valider par un préparateur ;
  - semaine de course : en dehors des jours d'avant-course ci-dessus, aucune séance normale ;
  - le moteur quotidien (`daily-run`) n'invente jamais de séance d'avant-course : il garde, adapte ou remplace la séance que le plan a prévue (T-X de M1, `PLANNED_LOAD_CAP`, Safety, P0-SAFE) ; un jour du protocole sans séance prévue reste une recommandation sans prescription du jour (`no_planned_session`).
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
le snapshot v1 plus `dhTechnicalTier` (`beginner` | `intermediate` | `advanced` | `null`) ; chaque course porte en plus `raceFormat` (SPORT-RACE-01P, JSON additif, aucune colonne) : le format retenu par la sélection du protocole (§race_calendar, la même que pour M1), soit `HOT_TRAIL_2DAY` / `IXS_3DAY` seulement pour une course explicitement identifiée comme sa série, `OTHER` pour un format à protocole sans cette série, le format stocké pour `SWISS_CUP` / `UCI_WC` / `UCI_WORLDS` / `OTHER` ; absent si `race_format` est NULL. Un snapshot antérieur sans format ne place aucune séance d'avant-course ; un snapshot déjà persisté n'est jamais recalculé.
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
- **Course ajoutée, déplacée, annulée ou dont la compétition est précisée après la génération** : le plan n'est jamais modifié silencieusement. Seule une nouvelle génération, explicite et acceptée, recalcule les jours d'avant-course. Les jours utilisés, les exécutions, les décisions et les prescriptions figées ne sont jamais réécrits (projection PILOT_022, CONSISTENCY-01, verrou de jour). Sans régénération, les séances déjà planifiées restent des séances ordinaires, et M1 applique chaque jour le T-X de la course réelle telle que la sélection du protocole la lit ce jour-là.
```

### 2.4 `race_calendar` : compétition, format et durée (SPORT-RACE-01P.3)

Section `race_calendar`, ligne 447.

**Remplacer**

```
Elle écrit `event_name`, `start_date`, `end_date`, `priority` (A / B / C ; A_PLUS existant conservé) et `race_format` (`HOT_TRAIL_2DAY` / `IXS_3DAY` / `OTHER` ; un format existant conservé).
```

**par**

```
Elle écrit `event_name`, `start_date`, `end_date`, `priority` (A / B / C ; A_PLUS existant conservé), `series` et `race_format` ; une course existante garde le couple (`race_format`, `series`) stocké tant que le rider ne choisit pas une compétition de la liste.

*Compétition, format et durée* (SPORT-RACE-01P.3, proposition A, HPM 2026-10-19) : trois informations distinctes, sans migration.
- **Compétition** (`series`, colonne existante) : le circuit ou l'organisateur, un code de la liste fermée du formulaire, jamais un libellé : `HOT_TRAIL_SERIES` (Hot Trail Series, Swiss DH Cup), `IXS` (iXS European Cup, DHC), `SWISS_OTHER` (autre course en Suisse), `UCI_WORLD_CUP`, `UCI_WORLD_CHAMPS`, `FR_COUPE_DE_FRANCE_DH` (Coupe de France DH / DHI), `FR_CHAMPIONNAT_DE_FRANCE_DH` (Championnats de France DH / DHI), `FR_REGIONAL_DH` (coupes et championnats régionaux), `FR_OTHER_DH` (courses françaises indépendantes ou locales), `OTHER`. Aucune compétition n'est présélectionnée pour une nouvelle course ; le rider la choisit.
- **Format** (`race_format`) : le format d'événement pour lequel un protocole T-X existe, jamais une durée. Le formulaire le dérive de la compétition : `HOT_TRAIL_SERIES` → `HOT_TRAIL_2DAY`, `IXS` → `IXS_3DAY`, toute autre → `OTHER`.
- **Durée** : `start_date` … `end_date`, fixée seulement pour les deux formats à protocole (2 et 3 jours), libre sinon. Aucun jour officiel (practice, chrono, finale) n'est déduit ni stocké ; deux manches d'une même série ne sont pas supposées avoir le même programme.

*Sélection du protocole* (adapter, `selectRaceProtocolFormat`, seule règle, partagée par le contexte quotidien de M1 et le snapshot v2) : une course reçoit le protocole T-X de son format **seulement si** (`race_format`, `series`) vaut (`HOT_TRAIL_2DAY`, `HOT_TRAIL_SERIES`) ou (`IXS_3DAY`, `IXS`). Sinon :
- `HOT_TRAIL_2DAY` ou `IXS_3DAY` sans la série correspondante (NULL, texte libre, variante de libellé, autre code, dont une Coupe ou un Championnat de France) : ambigu ; M1 et le planificateur reçoivent `OTHER`, avec un avertissement d'adapter ;
- `SWISS_CUP`, `UCI_WC`, `UCI_WORLDS`, `OTHER` : transmis tels quels, sans protocole ;
- `race_format` NULL : `OTHER`, avec l'avertissement existant.
Une série ne crée jamais de protocole seule (`OTHER` avec `HOT_TRAIL_SERIES` : aucun). M1 (frozen) est inchangé : il reçoit le format sélectionné.

*Compatibilité des courses existantes* : aucune ligne n'est migrée ni réécrite. Une course enregistrée avant ce contrat en `HOT_TRAIL_2DAY` ou `IXS_3DAY` sans série (l'ancien choix « Course sur 2 / 3 jours », « 2 jours » présélectionné) n'a plus de protocole, ni au quotidien ni dans un plan généré ensuite, jusqu'à ce que le rider choisisse explicitement sa compétition. Elle reste enregistrée, visible (« Course sur 2 jours — compétition à préciser ») et modifiable. Les décisions, prescriptions, exécutions et versions de plan déjà enregistrées ne sont jamais réécrites ; un snapshot v2 déjà persisté garde le `raceFormat` qu'il porte.

*Sans protocole* : la course est enregistrée et visible comme toute autre ; le formulaire, la liste « Tes courses » et Aujourd'hui (7 jours avant la course) disent que la préparation spécifique n'est pas définie ; aucun protocole générique.

*Invariants* :
- aucun protocole sans la série explicite correspondante, jamais depuis une durée, un nom ou un texte libre ;
- une seule sélection pour M1 et pour la génération V2 ;
- aucune donnée historique réécrite, aucune valeur inventée pour une ligne existante ;
- doses et tables T-X inchangées ;
- aucune course refusée faute de protocole.
```

---

## 3. `docs/10_TEST_PLAN.md`, nouveau T67 (après T66)

```
### T67. SPORT-RACE-01P — jours d'avant-course planifiés depuis le protocole de course ; contrat des formats et séries (HPM 2026-10-19 ; arbitrages 01P.2 ; 01P.3)
Règles : `docs/03` §6 (jours d'avant-course), `docs/05` (§race_calendar : compétition, format, durée, sélection du protocole, compatibilité ; snapshot v2 `raceFormat` ; contraintes relâchées ; invariants des séances d'avant-course), `docs/04` §3 (T-X, inchangé).
- **Acceptation, unitaires** (`sportRace01pRaceProtocolPlacement.test.ts`, `sportRace01pProtocolMirror.test.ts`) :
  - Hot Trail Series (HOT_TRAIL_2DAY) du samedi, créneaux vélo le week-end : la DH d'affûtage passe de J-7 à J-6, même dose ; récupération à J-4 et J-3 ; rien à J-5, J-2, J-1 ni les jours de course ; rien de retiré ;
  - iXS (IXS_3DAY) du vendredi : Force haut LIGHT 45 à J-7 sur un créneau physique, DH d'affûtage à J-6, récupération à J-4 et J-3 ;
  - AR-A, un seul créneau vélo (le samedi de J-7) : la DH n'est pas déplacée et ne reste pas (M1 la remplacerait par de la Force un jour sans créneau physique) ; elle est retirée, avec une contrainte relâchée `race_protocol_incompatible_day` (DH, date) ;
  - AR-C, course du lundi : le repos de J-2 est préservé ; la DH qui y tombe est retirée, jamais déplacée (`race_protocol_rest_day`) ; à J-6 (jour DH du protocole sans créneau vélo), l'endurance prévue est retirée (`race_protocol_incompatible_day`) ;
  - deux courses rapprochées : rien les jours de la première course ni les deux jours qui suivent ;
  - jour indisponible, course C, format sans protocole : rien ; plan identique (empreinte) à celui d'une course sans format ;
  - une séance par jour au plus ; contenus V2 existants (`recovery_active_v1`, gabarit Force haut LIGHT, DH à 4 passages) ;
  - la table du planificateur est celle de M1, jour par jour (contre-preuve : les autres formats n'ont rien dans les deux).
- **Sélection du protocole, unitaires** (`raceProtocolSelection.test.ts`, `raceCalendarRow.test.ts`) :
  - (HOT_TRAIL_2DAY, HOT_TRAIL_SERIES) et (IXS_3DAY, IXS) gardent leur format, sans avertissement ;
  - HOT_TRAIL_2DAY ou IXS_3DAY avec une série NULL, en texte libre (« Hot Trail Series (Swiss DH Cup) », « iXS European Cup »), une variante de libellé (minuscules, espace), un autre code (Suisse, UCI, Coupe ou Championnat de France, régionale) ou la série de l'autre protocole : `OTHER`, avec avertissement ;
  - SWISS_CUP, UCI_WC, UCI_WORLDS, OTHER : inchangés, quelle que soit la série ; NULL : `OTHER` avec l'avertissement existant.
- **Acceptation, intégration** (`sportRace01.integration.test.ts`, chemins réels ; même sélection dans le snapshot v2 et dans la décision quotidienne de M1) :
  - Hot Trail Series et iXS explicites : les jours planifiés sont des KEEP `created` (Force à J-7, DH plafonnée LIGHT à J-6, récupération à J-4 et J-3) ; J-5, J-2 et J-1 restent des recommandations `no_planned_session` ;
  - aucun protocole, ni dans le plan (snapshot `raceFormat`, semaine de course sans séance, aucune récupération) ni au quotidien (INFERENCE_FALLBACK, jamais RACE_PROTOCOL_TX), et la course reste vue par M1, pour : ancien événement « 2 jours » (HOT_TRAIL_2DAY sans série, avertissement) ; ancien « 3 jours » (IXS_3DAY sans série, avertissement) ; série en texte libre ; variante de libellé ; Swiss Cup de deux jours (SWISS_CUP) ; autre course en Suisse de deux jours ; UCI de trois jours (UCI_WC, puis UCI_WORLD_CUP) ; Coupe de France DH de deux jours (OTHER, puis enregistrée en HOT_TRAIL_2DAY : avertissement) ; Championnats de France DH de trois jours (OTHER, puis enregistrés en IXS_3DAY : avertissement) ; régionale française d'un et de trois jours ; compétition inconnue ; sans format ;
  - AR-A et AR-C sur base réelle (contraintes relâchées persistées, aucune Force guidée un jour vélo) ;
  - fatigue et douleur adaptent la séance planifiée ; Safety prioritaire ;
  - course ajoutée : aucun changement avant une régénération explicite, puis séances d'avant-course placées, jour utilisé, exécution et décision intacts ; course annulée : séances déjà planifiées ordinaires ; aucun doublon.
- **Fixtures existantes** : toute course de test à protocole déclare sa série explicite (`HOT_TRAIL_SERIES`, `IXS`) ; les équivalences DB → M1 (`computeDailyFor.*`) restent identiques.
- **Génération V2 inaccessible** (`v2RolloutFlag.integration.test.ts`, `planningModelRollout.test.ts`) : flag OFF, un athlète affecté V2 est refusé (`v2_generation_disabled`), rien n'est écrit.
- **Non-régression** : plans sans course ou sans format identiques à la production ; quotidien inchangé hors sélection du protocole (`daily-run` : même code M1 ; différentiel flags OFF `phys00FlagsOffEquivalence.test.ts` inchangé) ; V1 inchangé.
- **Web** :
  - « Tes courses » (`RacesSection.test.tsx`, `raceForm.test.ts`) : aucune compétition présélectionnée, enregistrement refusé sans compétition ; liste des compétitions (Hot Trail Series, iXS, Suisse, UCI, Coupe de France DH / DHI, Championnats de France DH / DHI, régionale, autre course DH en France, autre) ; Hot Trail Series : protocole affiché, fin fixée, `series` écrit ; Coupe de France de deux jours : enregistrée en `OTHER` avec son code, dates libres, « préparation spécifique non définie » ; course A+ / SWISS_CUP et ancien « 2 jours » conservés tels quels à l'enregistrement, protocole seulement après le choix explicite ; chaque compétition écrit une ligne acceptée sans avertissement par l'adapter ; règle web identique à celle de l'adapter (miroir) ;
  - Aujourd'hui (`sportRace01p.test.tsx`, `todayCoachCards.test.tsx`) : un jour sans séance prévue n'affiche jamais la durée de M1 comme une prescription ; AR-D ; bandeau « Préparation spécifique non définie » à 7 jours ou moins d'une course sans protocole, ancien « 2 / 3 jours » et courses françaises compris, jamais pour une Hot Trail Series ou un iXS explicites ; un ancien « 3 jours » n'est jamais présenté comme iXS ;
  - points d'attention des séances retirées ; explication du plan traduite.
```

---

## 4. Interface « Tes courses » (`web/src/features/races`, implémentée en 01P.3, sans canon propre)

- **Champ « Compétition »** (remplace « Format ») : aucune valeur par défaut (« Choisis la compétition ») ; options :
  - « Hot Trail Series (Swiss DH Cup) — 2 jours : entraînements et chrono, puis finale » ;
  - « iXS (European Cup, DHC) — 3 jours, practice officielle la veille » ;
  - « Autre course en Suisse », « Coupe du monde UCI », « Championnats du monde UCI » ;
  - « Coupe de France DH / DHI », « Championnats de France DH / DHI », « Coupe ou championnat régional DH (France) », « Autre course DH en France » ;
  - « Autre compétition » ;
  - pour une course existante hors liste : son couple stocké « (existant) », p. ex. « Course sur 2 jours — compétition à préciser (existant) ».
- **Aide sous le champ** : « Préparation spécifique : les 7 jours avant la course suivent le protocole Hot Trail. » (ou iXS), sinon « Préparation spécifique non définie pour cette compétition : NALYNT ne planifie pas de séance les jours qui la précèdent. »
- **Liste** : compétition (ou ancien format « … — compétition à préciser »), puis « Préparation : protocole … » ou « Préparation spécifique non définie ».
- **Aujourd'hui** : le bandeau de course nomme la compétition ; 7 jours avant une course sans protocole : « Préparation spécifique non définie pour cette compétition : NALYNT ne planifie pas de séance les jours qui la précèdent. »
