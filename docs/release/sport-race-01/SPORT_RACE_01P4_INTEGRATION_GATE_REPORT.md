# SPORT_RACE_01P4_INTEGRATION_GATE_REPORT — clôture canon et préparation de l'intégration

**Pour** : HPM et Louis · **Date** : 2026-10-19 · **Branche** : `fix/sport-race-01` (production `79b4d19`) · **Verdict** : **MERGE READY**, sous réserve de la validation HPM du diff normatif appliqué (§ 1) et de l'amendement proposé (§ 5.3). La publication attend l'inventaire de Louis et un GO distinct.

Aucun push, merge, déploiement, migration, SQL de production ni changement de flag.

---

## 1. Diff canonique exact appliqué

Les diffs approuvés (`SPORT_RACE_01P_CANON_DIFFS.md`, révision 01P.3) ont été appliqués **tels quels**, extraits du fichier approuvé et non recopiés à la main, dans le commit `73fd4cc` :
- `docs/03` §6 : jours d'avant-course, autres courses sans séance d'avant-course, `daily-run` n'invente aucune séance ;
- `docs/05` : snapshot v2 `raceFormat`, progression `race_protocol_sessions`, invariants des séances d'avant-course, `race_calendar` (compétition, format, durée, sélection du protocole, compatibilité, invariants) ;
- `docs/10` : T67.

Rien d'autre n'a changé : ni dose, ni M1, ni SQL, ni contrat de santé. T67 est inséré juste avant T66, parce que cette partie de `docs/10` est en ordre décroissant (T66 précède T65).

Diff exact (`git diff -U1 b4b48e4 73fd4cc -- docs/03_COACHING_MODEL.md docs/05_DATA_MODEL.md docs/10_TEST_PLAN.md`) :

```diff
diff --git a/docs/03_COACHING_MODEL.md b/docs/03_COACHING_MODEL.md
index 8db4882..2936ab7 100644
--- a/docs/03_COACHING_MODEL.md
+++ b/docs/03_COACHING_MODEL.md
@@ -402,3 +402,16 @@ L'échauffement (3 à 4 exercices légers) et le retour au calme (mobilité, res
   - semaine d'affûtage : Force légère en 45 min, DH légère en 60 min et 4 passages, endurance fondamentale légère en 45 min ;
-  - semaine de course : aucune séance normale.
+  - jours d'avant-course (SPORT-RACE-01P, option P, HPM 2026-10-19 ; arbitrages SPORT-RACE-01P.2 ; contrat des formats SPORT-RACE-01P.3) : pour une course A+, A ou B explicitement identifiée comme une compétition dont le protocole T-X existe (Hot Trail Series → `HOT_TRAIL_2DAY`, iXS → `IXS_3DAY`, `docs/04` §3 ; sélection `docs/05` §race_calendar), le plan applique ce protocole aux jours de T-7 à T-1 :
+    - un jour sans autre séance, il place la séance du protocole seulement quand elle a un modèle V2 et une dose existante, sur un créneau de la bonne activité, une séance par jour au plus :
+      - T-7 Force haut du corps légère : dose d'affûtage, 45 min ;
+      - T-6 DH technique : dose d'affûtage (légère, 60 min, 4 passages), jamais relevée ;
+      - T-4 et T-3 récupération active : `recovery_active_v1`, réservée à son minimum déclaré (20 min) ;
+    - il ne place rien à T-5 (« endurance courte » de 30 min : aucune endurance V2 sous 45 min), aux jours REST, à l'activité officielle de T-1 (IXS), aux jours de course ni aux deux jours qui suivent une course ;
+    - une DH de la semaine d'affûtage tombée sur un jour du protocole d'un autre type va au jour DH du protocole (T-6), si ce jour est libre et a un créneau vélo assez long ; c'est le seul déplacement autorisé ;
+    - une séance tombée sur un jour REST du protocole est retirée : le repos est préservé, la séance n'est jamais déplacée vers un autre jour ;
+    - une séance d'un autre type, tombée sur un jour du protocole dont la séance n'est pas possible avec les créneaux de ce jour (Force sans créneau physique, DH sans créneau vélo), est retirée : M1 la remplacerait par une séance que ce jour ne permet pas. M1 n'est jamais contourné et aucune séance n'est placée sur un jour incompatible ;
+    - toute séance retirée reste identifiable dans la version du plan : contrainte relâchée `placement_shortfall` (domaine, date, raison `race_protocol_rest_day` ou `race_protocol_incompatible_day`), affichée dans les points d'attention du programme ;
+    - toute autre course n'a aucune séance d'avant-course : Swiss Cup ou autre course en Suisse, Coupe ou Championnats du monde UCI, Coupe de France DH / DHI, Championnats de France DH / DHI, coupes et championnats régionaux, autre compétition, course enregistrée avant ce contrat en « 2 jours » ou « 3 jours » sans compétition identifiée, format absent. Sa préparation spécifique n'est pas définie et le rider le voit ; aucun protocole générique n'est supposé et aucun protocole n'est déduit d'une durée, d'un nom ou d'une série en texte libre ;
+    - valeurs PROVISIONAL (politique `race-protocol-plan-v1`), à valider par un préparateur ;
+  - semaine de course : en dehors des jours d'avant-course ci-dessus, aucune séance normale ;
+  - le moteur quotidien (`daily-run`) n'invente jamais de séance d'avant-course : il garde, adapte ou remplace la séance que le plan a prévue (T-X de M1, `PLANNED_LOAD_CAP`, Safety, P0-SAFE) ; un jour du protocole sans séance prévue reste une recommandation sans prescription du jour (`no_planned_session`).
   - **Courses et macro-plan V2** (A09, HPM 2026-10-07) : une course A+, A ou B structure le plan (semaine spécifique deux semaines avant, affûtage la semaine d'avant, semaine de course) ; une course **C** ne crée ni semaine de course, ni affûtage, ni semaine spécifique. Elle reste connue du moteur quotidien (jour de course, récupération).
diff --git a/docs/05_DATA_MODEL.md b/docs/05_DATA_MODEL.md
index a9bbb17..8629d74 100644
--- a/docs/05_DATA_MODEL.md
+++ b/docs/05_DATA_MODEL.md
@@ -231,3 +231,3 @@ Les lignes v1 restent inchangées et non exécutables. Les lecteurs doivent dist
 
-*Snapshot de génération v2* (`training_plan_versions.input_snapshot`, `input_snapshot_schema_version = 'v2'` ; constructeur runtime `buildPlanInputSnapshotV2` depuis UX-11A.5b.5a, qui reprend le snapshot v1 sans le modifier et lit le profil une seule fois) : le snapshot v1 plus `dhTechnicalTier` (`beginner` | `intermediate` | `advanced` | `null`). `technicalPriorities.priorityAreas`, déjà figé dans son ordre, reste la seule source des priorités DH : pas de `dhPriorityAreas`. Tout ce qui influence le contenu vient du snapshot et de la version du plan, jamais d'une relecture du profil vivant. **Ordre canonique** (v1 et v2, correctif de déterminisme) : les collections lues sans ordre garanti et dont la position n'a aucun sens sont triées avant la construction du snapshot — fenêtres (jour, début, fin, libellé, activité — BUG-V2-1), exceptions (date), dates verrouillées (date), séances récentes (date) — de sorte que le snapshot persisté et son hash sont identiques pour les mêmes données ; les courses (déjà triées par la requête) et les tableaux du profil (ordre stocké ; l'ordre de `priorityAreas` a un sens) ne sont pas retriés. `strengths` et `weaknesses` ne sélectionnent jamais de contenu.
+*Snapshot de génération v2* (`training_plan_versions.input_snapshot`, `input_snapshot_schema_version = 'v2'` ; constructeur runtime `buildPlanInputSnapshotV2` depuis UX-11A.5b.5a, qui reprend le snapshot v1 sans le modifier et lit le profil une seule fois) : le snapshot v1 plus `dhTechnicalTier` (`beginner` | `intermediate` | `advanced` | `null`) ; chaque course porte en plus `raceFormat` (SPORT-RACE-01P, JSON additif, aucune colonne) : le format retenu par la sélection du protocole (§race_calendar, la même que pour M1), soit `HOT_TRAIL_2DAY` / `IXS_3DAY` seulement pour une course explicitement identifiée comme sa série, `OTHER` pour un format à protocole sans cette série, le format stocké pour `SWISS_CUP` / `UCI_WC` / `UCI_WORLDS` / `OTHER` ; absent si `race_format` est NULL. Un snapshot antérieur sans format ne place aucune séance d'avant-course ; un snapshot déjà persisté n'est jamais recalculé. `technicalPriorities.priorityAreas`, déjà figé dans son ordre, reste la seule source des priorités DH : pas de `dhPriorityAreas`. Tout ce qui influence le contenu vient du snapshot et de la version du plan, jamais d'une relecture du profil vivant. **Ordre canonique** (v1 et v2, correctif de déterminisme) : les collections lues sans ordre garanti et dont la position n'a aucun sens sont triées avant la construction du snapshot — fenêtres (jour, début, fin, libellé, activité — BUG-V2-1), exceptions (date), dates verrouillées (date), séances récentes (date) — de sorte que le snapshot persisté et son hash sont identiques pour les mêmes données ; les courses (déjà triées par la requête) et les tableaux du profil (ordre stocké ; l'ordre de `priorityAreas` a un sens) ne sont pas retriés. `strengths` et `weaknesses` ne sélectionnent jamais de contenu.
 
@@ -252,3 +252,3 @@ Les lignes v1 restent inchangées et non exécutables. Les lecteurs doivent dist
 **BUG-V2-2 — progression d'un bloc V2** (aucune migration, branche `feat/bug-v2-2-progression`, non déployée) :
-- `training_plan_weeks.dose_summary` (jsonb objet, inchangé) reçoit, pour un plan V2 seulement, une clé additive `progression` : `{ model, role, cycle, reasonCodes, targets: { forceDoseStep, forceDurationMin, dhDurationMin, dhPasses, aerobicDurationMin }, sessionCount, physicalMinutes, ridingMinutes }`. `role` ∈ `introduction | build | build_plus | consolidation | race_specific | taper | race` ; c'est un rôle, pas un nouveau `week_type` : l'enum `plan_week_type` est inchangé (consolidation → `deload`, race_specific → `development`).
+- `training_plan_weeks.dose_summary` (jsonb objet, inchangé) reçoit, pour un plan V2 seulement, une clé additive `progression` : `{ model, role, cycle, reasonCodes, targets: { forceDoseStep, forceDurationMin, dhDurationMin, dhPasses, aerobicDurationMin }, sessionCount, physicalMinutes, ridingMinutes }`. `role` ∈ `introduction | build | build_plus | consolidation | race_specific | taper | race` ; c'est un rôle, pas un nouveau `week_type` : l'enum `plan_week_type` est inchangé (consolidation → `deload`, race_specific → `development`). SPORT-RACE-01P : `reasonCodes` peut contenir `race_protocol_sessions` et la progression porte alors `raceProtocolPolicy` (`race-protocol-plan-v1`) ; une semaine `race` peut avoir `sessionCount` > 0 (séances d'avant-course du protocole), ses `targets` reprenant alors les doses d'affûtage de ce qui est placé. Une séance retirée par le protocole est une contrainte relâchée de la version (`training_plan_versions.relaxed_constraints`) : `{ constraintId: "placement_shortfall", reason: "race_protocol_rest_day" | "race_protocol_incompatible_day", domain, date }`.
 - Les plans V1 et les plans V2 antérieurs n'ont pas cette clé ; aucun lecteur ne l'exige (le web ignore les clés inconnues de `dose_summary`).
@@ -327,2 +327,9 @@ Les trois tables sont en ajout seul (`reject_append_only_mutation`) et référen
 
+*Séances d'avant-course (SPORT-RACE-01P)* : ce sont des séances générées ordinaires de la version courante.
+- **Lignée et prescription** : KEEP copiable (le T-X de M1 a le même type et la même charge ; la DH MODERATE du protocole est plafonnée à la DH LIGHT prévue par `PLANNED_LOAD_CAP`). Prescription du jour, exécution, verrou de jour utilisé, suspension santé et historique : règles existantes, sans exception.
+- **Récupération** (type `RECOVERY_ACTIVE`, sans charge) : 0 minute dans l'historique V2 de la génération (V2-L2), comme toute récupération.
+- **Moteur quotidien inchangé** : un jour du protocole sans séance planifiée reste une recommandation sans prescription (`no_planned_session`) ; fatigue, douleur, Safety et P0-SAFE adaptent ou remplacent la séance planifiée comme toute autre.
+- **Conseil sans séance prévue** (SPORT-RACE-01P.2) : un jour où le plan ne prévoit rien et où M1 ne donne qu'une recommandation n'est ni une séance prévue ni une séance manquée dans les compteurs de semaine. Sa durée M1 n'est jamais présentée comme une prescription. Les statistiques d'exécution historiques sont inchangées.
+- **Course ajoutée, déplacée, annulée ou dont la compétition est précisée après la génération** : le plan n'est jamais modifié silencieusement. Seule une nouvelle génération, explicite et acceptée, recalcule les jours d'avant-course. Les jours utilisés, les exécutions, les décisions et les prescriptions figées ne sont jamais réécrits (projection PILOT_022, CONSISTENCY-01, verrou de jour). Sans régénération, les séances déjà planifiées restent des séances ordinaires, et M1 applique chaque jour le T-X de la course réelle telle que la sélection du protocole la lit ce jour-là.
+
 **Activité réalisée d'une séance d'endurance (UX-11B.2.5, migration appliquée en production le 2026-10-04, Stage 1)** : `session_activity_results` — `id` (appareil), `execution_id`, `athlete_id` (clé composite vers `session_executions`), `activity_id`, `duration_seconds` (durée **réelle**, entier > 0, jamais ramenée à la durée prescrite), `distance_m` (mètres, entier ≥ 0, facultatif), `rpe_actual` (1–10, même échelle que les séries), `comment` (≤ 500), `supersedes_id`, `occurred_at`, `recorded_at`. Ajout seul (triggers), RLS lecture du pilote, aucun droit d'écriture direct ; écriture par `record_session_execution` (clé facultative `activities`). Pas un élément prescrit : ni `prescription_item_id` ni `exercise_id` ; la lignée est exécution → sa prescription du jour → `activitySelection`. Règles : l'`activity_id` doit figurer dans `activitySelection.activityIds` de la prescription de **cette** exécution (v2, `restricted`), sinon `activity_not_allowed_by_prescription` (Force et DH, sans `activitySelection`, sont donc refusées) ; une seule activité par séance : au plus un original par exécution (index unique), sinon `activity_result_exists` ; correction = nouvelle ligne `supersedes_id` d'un original, une seule fois, jamais une correction de correction (comme les séries) ; résultat actif = la ligne qu'aucune autre ne remplace ; idempotence par identifiant. Pas de nouvelle vérification de décision courante sur une exécution déjà commencée. **Invariant de fin** : une exécution dont la prescription propose un choix d'activité ne peut recevoir `completed` sans résultat d'activité (enregistré avant ou dans le même lot), sinon `activity_result_required` et tout le lot est annulé.
@@ -446,3 +453,25 @@ Résultats stockés : result_position, result_time_seconds, result_gap_to_winner
 
-**Écriture par le rider (A09)** : l'UI « Tes courses » (Affiner ton profil) crée, modifie et supprime les courses du rider, via la RLS existante `race_calendar_own_data` (le rider ne gère que ses propres lignes). Elle écrit `event_name`, `start_date`, `end_date`, `priority` (A / B / C ; A_PLUS existant conservé) et `race_format` (`HOT_TRAIL_2DAY` / `IXS_3DAY` / `OTHER` ; un format existant conservé).
+**Écriture par le rider (A09)** : l'UI « Tes courses » (Affiner ton profil) crée, modifie et supprime les courses du rider, via la RLS existante `race_calendar_own_data` (le rider ne gère que ses propres lignes). Elle écrit `event_name`, `start_date`, `end_date`, `priority` (A / B / C ; A_PLUS existant conservé), `series` et `race_format` ; une course existante garde le couple (`race_format`, `series`) stocké tant que le rider ne choisit pas une compétition de la liste.
+
+*Compétition, format et durée* (SPORT-RACE-01P.3, proposition A, HPM 2026-10-19) : trois informations distinctes, sans migration.
+- **Compétition** (`series`, colonne existante) : le circuit ou l'organisateur, un code de la liste fermée du formulaire, jamais un libellé : `HOT_TRAIL_SERIES` (Hot Trail Series, Swiss DH Cup), `IXS` (iXS European Cup, DHC), `SWISS_OTHER` (autre course en Suisse), `UCI_WORLD_CUP`, `UCI_WORLD_CHAMPS`, `FR_COUPE_DE_FRANCE_DH` (Coupe de France DH / DHI), `FR_CHAMPIONNAT_DE_FRANCE_DH` (Championnats de France DH / DHI), `FR_REGIONAL_DH` (coupes et championnats régionaux), `FR_OTHER_DH` (courses françaises indépendantes ou locales), `OTHER`. Aucune compétition n'est présélectionnée pour une nouvelle course ; le rider la choisit.
+- **Format** (`race_format`) : le format d'événement pour lequel un protocole T-X existe, jamais une durée. Le formulaire le dérive de la compétition : `HOT_TRAIL_SERIES` → `HOT_TRAIL_2DAY`, `IXS` → `IXS_3DAY`, toute autre → `OTHER`.
+- **Durée** : `start_date` … `end_date`, fixée seulement pour les deux formats à protocole (2 et 3 jours), libre sinon. Aucun jour officiel (practice, chrono, finale) n'est déduit ni stocké ; deux manches d'une même série ne sont pas supposées avoir le même programme.
+
+*Sélection du protocole* (adapter, `selectRaceProtocolFormat`, seule règle, partagée par le contexte quotidien de M1 et le snapshot v2) : une course reçoit le protocole T-X de son format **seulement si** (`race_format`, `series`) vaut (`HOT_TRAIL_2DAY`, `HOT_TRAIL_SERIES`) ou (`IXS_3DAY`, `IXS`). Sinon :
+- `HOT_TRAIL_2DAY` ou `IXS_3DAY` sans la série correspondante (NULL, texte libre, variante de libellé, autre code, dont une Coupe ou un Championnat de France) : ambigu ; M1 et le planificateur reçoivent `OTHER`, avec un avertissement d'adapter ;
+- `SWISS_CUP`, `UCI_WC`, `UCI_WORLDS`, `OTHER` : transmis tels quels, sans protocole ;
+- `race_format` NULL : `OTHER`, avec l'avertissement existant.
+Une série ne crée jamais de protocole seule (`OTHER` avec `HOT_TRAIL_SERIES` : aucun). M1 (frozen) est inchangé : il reçoit le format sélectionné.
+
+*Compatibilité des courses existantes* : aucune ligne n'est migrée ni réécrite. Une course enregistrée avant ce contrat en `HOT_TRAIL_2DAY` ou `IXS_3DAY` sans série (l'ancien choix « Course sur 2 / 3 jours », « 2 jours » présélectionné) n'a plus de protocole, ni au quotidien ni dans un plan généré ensuite, jusqu'à ce que le rider choisisse explicitement sa compétition. Elle reste enregistrée, visible (« Course sur 2 jours — compétition à préciser ») et modifiable. Les décisions, prescriptions, exécutions et versions de plan déjà enregistrées ne sont jamais réécrites ; un snapshot v2 déjà persisté garde le `raceFormat` qu'il porte.
+
+*Sans protocole* : la course est enregistrée et visible comme toute autre ; le formulaire, la liste « Tes courses » et Aujourd'hui (7 jours avant la course) disent que la préparation spécifique n'est pas définie ; aucun protocole générique.
+
+*Invariants* :
+- aucun protocole sans la série explicite correspondante, jamais depuis une durée, un nom ou un texte libre ;
+- une seule sélection pour M1 et pour la génération V2 ;
+- aucune donnée historique réécrite, aucune valeur inventée pour une ligne existante ;
+- doses et tables T-X inchangées ;
+- aucune course refusée faute de protocole.
 
diff --git a/docs/10_TEST_PLAN.md b/docs/10_TEST_PLAN.md
index ce78de7..9459a0f 100644
--- a/docs/10_TEST_PLAN.md
+++ b/docs/10_TEST_PLAN.md
@@ -705,2 +705,31 @@ Tests existants adaptés au nouveau contrat : `sessionExecution.integration.test
 
+### T67. SPORT-RACE-01P — jours d'avant-course planifiés depuis le protocole de course ; contrat des formats et séries (HPM 2026-10-19 ; arbitrages 01P.2 ; 01P.3)
+Règles : `docs/03` §6 (jours d'avant-course), `docs/05` (§race_calendar : compétition, format, durée, sélection du protocole, compatibilité ; snapshot v2 `raceFormat` ; contraintes relâchées ; invariants des séances d'avant-course), `docs/04` §3 (T-X, inchangé).
+- **Acceptation, unitaires** (`sportRace01pRaceProtocolPlacement.test.ts`, `sportRace01pProtocolMirror.test.ts`) :
+  - Hot Trail Series (HOT_TRAIL_2DAY) du samedi, créneaux vélo le week-end : la DH d'affûtage passe de J-7 à J-6, même dose ; récupération à J-4 et J-3 ; rien à J-5, J-2, J-1 ni les jours de course ; rien de retiré ;
+  - iXS (IXS_3DAY) du vendredi : Force haut LIGHT 45 à J-7 sur un créneau physique, DH d'affûtage à J-6, récupération à J-4 et J-3 ;
+  - AR-A, un seul créneau vélo (le samedi de J-7) : la DH n'est pas déplacée et ne reste pas (M1 la remplacerait par de la Force un jour sans créneau physique) ; elle est retirée, avec une contrainte relâchée `race_protocol_incompatible_day` (DH, date) ;
+  - AR-C, course du lundi : le repos de J-2 est préservé ; la DH qui y tombe est retirée, jamais déplacée (`race_protocol_rest_day`) ; à J-6 (jour DH du protocole sans créneau vélo), l'endurance prévue est retirée (`race_protocol_incompatible_day`) ;
+  - deux courses rapprochées : rien les jours de la première course ni les deux jours qui suivent ;
+  - jour indisponible, course C, format sans protocole : rien ; plan identique (empreinte) à celui d'une course sans format ;
+  - une séance par jour au plus ; contenus V2 existants (`recovery_active_v1`, gabarit Force haut LIGHT, DH à 4 passages) ;
+  - la table du planificateur est celle de M1, jour par jour (contre-preuve : les autres formats n'ont rien dans les deux).
+- **Sélection du protocole, unitaires** (`raceProtocolSelection.test.ts`, `raceCalendarRow.test.ts`) :
+  - (HOT_TRAIL_2DAY, HOT_TRAIL_SERIES) et (IXS_3DAY, IXS) gardent leur format, sans avertissement ;
+  - HOT_TRAIL_2DAY ou IXS_3DAY avec une série NULL, en texte libre (« Hot Trail Series (Swiss DH Cup) », « iXS European Cup »), une variante de libellé (minuscules, espace), un autre code (Suisse, UCI, Coupe ou Championnat de France, régionale) ou la série de l'autre protocole : `OTHER`, avec avertissement ;
+  - SWISS_CUP, UCI_WC, UCI_WORLDS, OTHER : inchangés, quelle que soit la série ; NULL : `OTHER` avec l'avertissement existant.
+- **Acceptation, intégration** (`sportRace01.integration.test.ts`, chemins réels ; même sélection dans le snapshot v2 et dans la décision quotidienne de M1) :
+  - Hot Trail Series et iXS explicites : les jours planifiés sont des KEEP `created` (Force à J-7, DH plafonnée LIGHT à J-6, récupération à J-4 et J-3) ; J-5, J-2 et J-1 restent des recommandations `no_planned_session` ;
+  - aucun protocole, ni dans le plan (snapshot `raceFormat`, semaine de course sans séance, aucune récupération) ni au quotidien (INFERENCE_FALLBACK, jamais RACE_PROTOCOL_TX), et la course reste vue par M1, pour : ancien événement « 2 jours » (HOT_TRAIL_2DAY sans série, avertissement) ; ancien « 3 jours » (IXS_3DAY sans série, avertissement) ; série en texte libre ; variante de libellé ; Swiss Cup de deux jours (SWISS_CUP) ; autre course en Suisse de deux jours ; UCI de trois jours (UCI_WC, puis UCI_WORLD_CUP) ; Coupe de France DH de deux jours (OTHER, puis enregistrée en HOT_TRAIL_2DAY : avertissement) ; Championnats de France DH de trois jours (OTHER, puis enregistrés en IXS_3DAY : avertissement) ; régionale française d'un et de trois jours ; compétition inconnue ; sans format ;
+  - AR-A et AR-C sur base réelle (contraintes relâchées persistées, aucune Force guidée un jour vélo) ;
+  - fatigue et douleur adaptent la séance planifiée ; Safety prioritaire ;
+  - course ajoutée : aucun changement avant une régénération explicite, puis séances d'avant-course placées, jour utilisé, exécution et décision intacts ; course annulée : séances déjà planifiées ordinaires ; aucun doublon.
+- **Fixtures existantes** : toute course de test à protocole déclare sa série explicite (`HOT_TRAIL_SERIES`, `IXS`) ; les équivalences DB → M1 (`computeDailyFor.*`) restent identiques.
+- **Génération V2 inaccessible** (`v2RolloutFlag.integration.test.ts`, `planningModelRollout.test.ts`) : flag OFF, un athlète affecté V2 est refusé (`v2_generation_disabled`), rien n'est écrit.
+- **Non-régression** : plans sans course ou sans format identiques à la production ; quotidien inchangé hors sélection du protocole (`daily-run` : même code M1 ; différentiel flags OFF `phys00FlagsOffEquivalence.test.ts` inchangé) ; V1 inchangé.
+- **Web** :
+  - « Tes courses » (`RacesSection.test.tsx`, `raceForm.test.ts`) : aucune compétition présélectionnée, enregistrement refusé sans compétition ; liste des compétitions (Hot Trail Series, iXS, Suisse, UCI, Coupe de France DH / DHI, Championnats de France DH / DHI, régionale, autre course DH en France, autre) ; Hot Trail Series : protocole affiché, fin fixée, `series` écrit ; Coupe de France de deux jours : enregistrée en `OTHER` avec son code, dates libres, « préparation spécifique non définie » ; course A+ / SWISS_CUP et ancien « 2 jours » conservés tels quels à l'enregistrement, protocole seulement après le choix explicite ; chaque compétition écrit une ligne acceptée sans avertissement par l'adapter ; règle web identique à celle de l'adapter (miroir) ;
+  - Aujourd'hui (`sportRace01p.test.tsx`, `todayCoachCards.test.tsx`) : un jour sans séance prévue n'affiche jamais la durée de M1 comme une prescription ; AR-D ; bandeau « Préparation spécifique non définie » à 7 jours ou moins d'une course sans protocole, ancien « 2 / 3 jours » et courses françaises compris, jamais pour une Hot Trail Series ou un iXS explicites ; un ancien « 3 jours » n'est jamais présenté comme iXS ;
+  - points d'attention des séances retirées ; explication du plan traduite.
+
 ### T66. SPORT-SAFE-01 — aucune séance identique présentée comme adaptée ; alternative A10 limitée (HPM 2026-10-19)
```

## 2. Commits locaux

| Commit | Contenu |
|---|---|
| `0672050` … `a8b9158` | SPORT-RACE-01, 01P, 01P.2 (déjà revus) |
| `ab117c5`, `b4b48e4` | 01P.3 : sélection explicite du protocole, formulaire « Compétition », rapport (déjà revus) |
| **`73fd4cc`** | **01P.4 : canon `docs/03`, `docs/05`, `docs/10` appliqué** |
| **`1870f84`** | **01P.4 : message « compétition à préciser » pour les anciennes courses ambiguës (web, tests)** |
| commit docs suivant | 01P.4 : inventaire SQL complété, preuve du périmètre, ce rapport, `docs/00`, `docs/11` (addendum 01P.4), `docs/12` |

## 3. Tests ciblés

Depuis 01P.3, seul le web a changé (`1870f84`). Le code de head-coach-engine et de planning-engine est inchangé, donc leurs suites ne sont pas relancées : les résultats 01P.3 restent valables (head-coach 1042 unitaires ; `sportRace01` 12/12 dont la matrice de 16 cas ; 132 intégrations touchées ; P0-3 Edge 5/5 ; rollout et génération V2 OFF 41/41 ; planning-engine 1077 ; web complet 2388).

| Contrôle 01P.4 | Résultat |
|---|---|
| Web ciblé : `src/features/races`, `src/features/today`, `TodayPage.test.tsx` | **111 / 111** |
| Web lint (oxlint), `tsc -b tsconfig.build.json` | OK |
| `npm run build:release:all` | OK, rien déployé |
| Inventaire SQL : 3 requêtes, chacune dans `begin transaction read only … rollback` (pile locale) | OK. Un défaut trouvé et corrigé : avec `series` NULL, `not ((… and series = '…') or …)` vaut NULL et excluait les anciennes lignes ; la requête utilise maintenant `is distinct from`. Cohérence vérifiée : Q2 = somme des lignes « perd_protocole » à venir de Q1 = nombre de lignes de Q3. |
| Snapshot de génération V1, 13 riders fictifs, runtime de production contre branche | **13 / 13 identiques** |
| Graphe d'imports des 10 fonctions Edge, production contre branche | 8 identiques ; `daily-run` et `generate-training-plan` changent (§ 6) |

Preuves : `evidence/SPORT_RACE_01P4_PUBLICATION_SCOPE.txt`.

## 4. Inventaire des anciennes compétitions

**Il attend Louis.** Rien n'a été exécuté à distance. Le fichier `SPORT_RACE_01P3_LEGACY_RACES_COUNT.sql` contient trois `SELECT` indépendants, strictement en lecture seule : aucun DDL, aucun DML, aucune fonction à effet de bord, aucune table temporaire. Chacun s'exécute seul dans l'éditeur SQL de Supabase. Aucune donnée personnelle n'est retournée : ni identifiant, ni nom de course, ni texte libre.

| Question HPM | Réponse fournie par |
|---|---|
| Combien d'événements en ancien format 2 ou 3 jours sans série explicite | Q1 : `changement = perd_protocole`, avec format et état de la série (`serie_null`, `texte_libre`, autre code) |
| Combien sont futurs | Q1 : `moment` (`passee`, `en_cours`, `a_venir_7_jours`, `a_venir_plus_tard`), avec le statut pris en compte ou non (annulée ou sautée) ; Q2 : `courses_dans_7_jours` |
| Combien de riders | Q1 et Q2 : `riders` (distincts) |
| Plans V1 et V2 potentiellement touchés | Q2 et Q3 : séances déjà projetées dans la fenêtre T-7…T-1, ventilées par origine (plan V1, plan V2, hors plan), et affectation du rider pour la prochaine génération (`v1` par défaut, `v2`) |
| Quels événements pourraient changer de protocole | Q3 : une ligne par course concernée (dates, durée, format, état de la série, priorité, statut, jours avant le début, modèle, séances T-7…T-1), avec un numéro de rider arbitraire |

Lecture des résultats :
- **Aucun plan n'est réécrit.** Les plans V1 et V2 existants restent tels quels. Ce qui change, ce sont les décisions quotidiennes de M1 sur les jours T-7…T-1 de ces courses (plus de T-X).
  - Sur un jour avec une séance de plan : la séance prévue est gardée au lieu d'être remplacée ou plafonnée par le T-X. Exemple : la DH de J-7 n'est plus remplacée par une Force haut du corps.
  - Sur un jour sans séance : la recommandation par défaut remplace la recommandation T-X.
- Aucun plan V2 de production ne contient de séance d'avant-course : l'option P n'est pas déployée et la génération V2 est OFF. Un plan V2 généré plus tard appliquera la nouvelle sélection.
- La production peut contenir des athlètes de test ; les requêtes ne les distinguent pas.

Contenu complet, prêt à copier : voir le fichier, reproduit dans le message de livraison.

## 5. Contrat de compatibilité des anciens événements

### 5.1 Cas confirmés par les tests existants

| Cas HPM | Résultat | Couverture |
|---|---|---|
| Hot Trail identifiée explicitement | protocole Hot Trail (plan V2 et M1) | `raceProtocolSelection.test.ts`, `sportRace01.integration.test.ts` (Hot Trail Series), `raceForm.test.ts` (contrat, miroir) |
| iXS identifiée explicitement | protocole iXS | mêmes suites (iXS) |
| Swiss Cup | aucun protocole Hot Trail tiré de la durée | matrice d'intégration (`SWISS_CUP` sur 2 jours, `SWISS_OTHER` sur 2 jours) |
| UCI | aucun protocole iXS tiré de la durée | matrice (`UCI_WC` et `UCI_WORLD_CUP` sur 3 jours) |
| Coupe de France DH, Championnats de France, régionales | enregistrables, sans protocole inventé | matrice (OTHER et couples stockés incohérents), `RacesSection.test.tsx` (création d'une Coupe de France) |
| Ancien événement ambigu | prudent : `OTHER` et avertissement, sans réécriture ; couple stocké conservé à l'enregistrement | matrice (anciens 2 et 3 jours, texte libre, variante), `raceCalendarRow.test.ts`, `RacesSection.test.tsx` |
| Historique, séances et prescriptions figées | inchangés | aucune écriture sur l'historique ; `sportRace01` (course tardive : jour utilisé, exécution et décision intacts) ; aucune migration |

### 5.2 Message visible et parcours de correction (01P.4)

**Constat** : en 01P.3, une ancienne course « 2 jours » sans compétition affichait « Course sur 2 jours — compétition à préciser » et la phrase générique « Préparation spécifique non définie pour cette compétition… ». Cette phrase ne disait ni que le rider pouvait corriger, ni comment.

**Parcours existant réutilisé** : Profil › Affiner ton profil › Tes courses › Modifier › Compétition. Aucune fonctionnalité de migration n'est ajoutée. Seuls les textes changent (commit `1870f84`) :
- **Aujourd'hui**, dès que la course est la prochaine et à moins de 120 jours (compte à rebours), à la place de la phrase générique : « Compétition à préciser dans Profil › Affiner ton profil › Tes courses. D'ici là, NALYNT ne planifie pas de préparation spécifique pour cette course. »
- **Liste « Tes courses »** : « Préparation spécifique non définie tant que la compétition n'est pas précisée ».
- **Formulaire** (couple stocké « (existant) ») : « Compétition à préciser : choisis-la dans la liste. D'ici là, NALYNT ne planifie pas de préparation spécifique pour cette course. »

Les autres courses sans protocole gardent la phrase générique dans les 7 jours. Hot Trail Series et iXS explicites n'affichent ni l'une ni l'autre.

### 5.3 Écart avec le canon appliqué : amendement proposé, non appliqué

Le T67 appliqué mentionne encore les anciennes courses « 2 / 3 jours » dans le bandeau générique. Pour aligner le canon sur 5.2 :

**`docs/10` T67, puce Aujourd'hui** : remplacer

```
bandeau « Préparation spécifique non définie » à 7 jours ou moins d'une course sans protocole, ancien « 2 / 3 jours » et courses françaises compris, jamais pour une Hot Trail Series ou un iXS explicites ;
```

par

```
bandeau « Préparation spécifique non définie » à 7 jours ou moins d'une course sans protocole, courses françaises comprises, jamais pour une Hot Trail Series ou un iXS explicites ; ancien « 2 / 3 jours » sans compétition (01P.4) : à la place, dès qu'elle est la prochaine course à moins de 120 jours, invitation à préciser la compétition par Profil › Affiner ton profil › Tes courses ;
```

**`docs/10` T67, puce « Tes courses »** : remplacer

```
course A+ / SWISS_CUP et ancien « 2 jours » conservés tels quels à l'enregistrement, protocole seulement après le choix explicite ;
```

par

```
course A+ / SWISS_CUP et ancien « 2 jours » conservés tels quels à l'enregistrement, protocole seulement après le choix explicite ; ancien « 2 jours » : « Préparation spécifique non définie tant que la compétition n'est pas précisée » dans la liste, « Compétition à préciser » dans le formulaire ;
```

**`docs/05` §race_calendar, *Compatibilité des courses existantes*** : après « Elle reste enregistrée, visible (« Course sur 2 jours — compétition à préciser ») et modifiable. », ajouter :

```
Aujourd'hui (dès qu'elle est la prochaine course, à moins de 120 jours), la liste et le formulaire invitent le rider à préciser la compétition par le formulaire existant (Profil › Affiner ton profil › Tes courses) ; aucune migration ni correction automatique.
```

Alternative, si l'HPM refuse l'amendement : annuler `1870f84` pour revenir au texte de 01P.3.

## 6. Composants à publier

| Composant | Change ? | Actif sur V1 | Inactif tant que la génération V2 est OFF |
|---|---|---|---|
| **Web** (Vercel) | oui | formulaire « Compétition » sans défaut ; liste ; bandeau Aujourd'hui (compétition, « non définie », « à préciser ») ; jours de conseil sans durée M1 (01P) et hors compteurs (01P.2, AR-D) ; écriture et lecture de `series` | libellés des séances retirées par le protocole et explication du plan V2 (aucun plan concerné en production) |
| **`daily-run`** | oui, 3 fichiers de l'adapter : `raceCalendarRow.js`, `raceProtocolSelection.js` (nouveau), `raceCalendarRepo.js`. `dailyRunV2.bundle.js` est identique. Graphe `cc83c059…` → `01e3062c…` | sélection du protocole pour tous les riders : anciennes courses ambiguës sans T-X ; avertissement d'adapter enregistré comme `daily_run_warning`, de J-14 à J+2 de ces courses | — |
| **`generate-training-plan`** | oui, `generateTrainingPlan.bundle.js` seul. Graphe `de40112e…` → `3a0e6d90…` | aucun effet : snapshot V1 identique (13/13), catalogue V1 inchangé | placement d'avant-course (option P, AR-A, AR-C), `raceFormat` du snapshot v2 |
| 8 autres fonctions | **non**, graphes identiques à `79b4d19` | — | — |
| SQL | **non**, aucune migration ; `series` existe et le rider peut l'écrire (RLS existante, test a09) | — | — |
| Documentation | oui | — | — |

**Ordre de publication conseillé** (compatible dans les deux sens ; à exécuter seulement sur GO) :
1. **Web**, d'abord : les riders peuvent préciser leur compétition avant que le protocole des lignes ambiguës ne disparaisse.
2. **`daily-run`**, dans la même fenêtre, quelques minutes après.
3. **`generate-training-plan`**, ensuite ou plus tard : aucun effet tant que la génération V2 est OFF.

**Effets transitoires** :

| Combinaison | Effet | Gravité |
|---|---|---|
| Nouveau web + ancien `daily-run` (fenêtre 1→2, ou retour arrière de `daily-run` seul) | Courses neuves cohérentes : Hot Trail ou iXS explicites gardent le protocole ; les compétitions françaises et autres n'en ont pas, comme avant. Ancienne course ambiguë : le web dit « compétition à préciser, pas de préparation spécifique » alors que l'ancien `daily-run` applique encore le T-X (carte du jour « … protocole de préparation standard »). | message contradictoire, temporaire |
| Ancien web + nouveau `daily-run` (onglet resté ouvert, ou retour arrière du web seul) | L'ancien formulaire écrit encore « 2 jours » par défaut, sans série : course sans protocole, et l'ancien web ne l'annonce pas. Le rider ne peut pas préciser la compétition avant le rechargement. Une ligne déjà dotée d'un code garde sa série : l'ancien web ne l'écrit pas, donc ne l'efface pas. | prudent, temporaire |
| Retour arrière du web après des écritures de `series` | L'ancien web lit seulement `race_format` : « Autre format » pour une Coupe de France, « Course sur 2 jours » pour une Hot Trail explicite. Aucune erreur, aucune donnée perdue. | affichage moins précis |

**Retour arrière** : Vercel, déploiement précédent ; `daily-run` et `generate-training-plan` redéployés depuis le checkout `79b4d19`. Aucune donnée à restaurer : les codes `series` écrits restent valides et sont ignorés par l'ancien code.

## 7. Risques résiduels

- **Perte du protocole pour les anciennes courses ambiguës**, V1 compris, dès la publication de `daily-run`. Voulu (prudence), mais à dimensionner avec l'inventaire. Décider comment prévenir les riders concernés. La seule communication automatique est le message « compétition à préciser ».
- **Hausse des `daily_run_warning`** : un avertissement par run, de J-14 à J+2 de chaque course ambiguë. Il contient le nom de la course, comme l'avertissement existant pour un format NULL. Les requêtes de surveillance qui comptent ces événements le verront.
- **Fenêtre de déploiement** : messages contradictoires entre le web et `daily-run` (§ 6). À réduire en publiant les deux dans la même fenêtre.
- **Plans déjà générés** : une compétition précisée après génération ne replace pas de séances d'avant-course sans une régénération explicite. AR-B est toujours bloqué et la génération V2 est OFF. Au quotidien, M1 applique le T-X dès que la compétition est précisée.
- **Validation sportive** : doses `race-protocol-plan-v1` PROVISIONAL ; protocole Hot Trail ou iXS appliqué à toutes les manches de ces séries ; aucun protocole pour les compétitions françaises, UCI et régionales.
- **Athlètes de test** en production : ils sont inclus dans l'inventaire.

## 8. Verdict

**MERGE READY**, sous réserve de la validation HPM :
- du diff normatif appliqué (§ 1) ;
- de l'amendement proposé pour le message de clarification (§ 5.3), ou de son refus, auquel cas `1870f84` est annulé.

Le code, les tests ciblés, le canon et les preuves sont sur `fix/sport-race-01` : M1 inchangé, aucune migration, doses inchangées, AR-A à AR-D conservés.

**La publication n'est pas couverte par ce verdict.** Elle attend :
1. l'inventaire en lecture seule exécuté par Louis ;
2. la décision HPM sur la communication aux riders ;
3. un GO de déploiement distinct (web, puis `daily-run`, puis `generate-training-plan`).

Aucun merge automatique. STOP pour décision HPM.
