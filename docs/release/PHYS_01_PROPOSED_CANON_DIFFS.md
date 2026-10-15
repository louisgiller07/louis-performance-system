# PHYS-01.1 + PHYS-02 / PHYS-02.1 + PHYS-03 — PROPOSITIONS CANONIQUES (non appliquées)

**Pour** : HPM et Louis. **Statut** : proposition, révisée par PHYS-02.1 et son correctif douleur (2026-10-15). Principe de `V2_INTERVALS_LIGHT_FALLBACK` approuvé par HPM ; paramètres sportifs PROVISIONAL.
- Conformément à CLAUDE.md, aucun document canonique n'est modifié avant accord.
- Ne décrit que le comportement implémenté et testé en local : Force (`feat/phys-01-physical-coaching`, `5466df3`, base technique acceptée par HPM) et endurance (`feat/phys-02-endurance`).
- Trois parties distinctes : **A** architecture technique, **B** comportements du jour, **C** paramètres sportifs PROVISIONAL. Puis **D** décisions ouvertes, **E** l'exception proposée à l'ADR UX-11A.5a.3 §5, et les diffs par document.

## A. Architecture technique (implémentée, testée)

1. **Format inchangé.** Session Model `session-model-v2.6`, mêmes versions de composants, aucune clé de manifeste nouvelle. Le web de D lit toutes les prescriptions produites.
2. **Plans.** Sans l'option fractionné, un plan est identique, octet pour octet, à celui de D (démontré sur le code de D). Avec l'option, seule la séance d'endurance des semaines de surcharge change de type (`AEROBIC_INTERVALS`, protocole existant `endurance_intervals_3min`).
3. **Fractionné dans le format existant.** `PrescriptionV2` n'a que des éléments exercice / drill : les répétitions du protocole sont des blocs `main` existants — un bloc par répétition (durée, RPE, consigne de travail), un bloc par récupération entre deux répétitions (durée, consigne facile), `items: []`.
4. **Ajouts quotidiens, jamais au plan**, tracés par leur version, hors manifeste (comme A04 / A10) :
   - Force : retour au calme (`strength-daily-v1`) et conseil de charge `loadGuidance` (`strength-load-guidance-v1`, sur l'exercice) ;
   - endurance : guidage `enduranceGuidance` (`endurance-guidance-v1`, à la racine de la prescription finale).
   Les deux conseils sont validés à cet endroit seulement (`forbidden_load_field` inchangé ailleurs ; jamais de fréquence cardiaque, FTP, watt ni zone), consultatifs (un échec de lecture ne bloque jamais la décision : avertissements `phys01_load_guidance_*`, `phys02_endurance_guidance_*`), exclus de l'empreinte sport, ignorés par le web de D.
5. **Politiques hors manifeste** : `endurance-intervals-plan-v1` (placement du fractionné) et `endurance-guidance-v1` choisissent un type de séance ou un conseil, jamais le contenu d'une prescription, qui vient toujours du catalogue v2.6.
6. **Option serveur** `NALYNT_V2_ENDURANCE_INTERVALS_ENABLED` (secret Edge de `generate-training-plan`, seule la valeur exacte `true` l'active ; jamais lue depuis la requête). Absente : plans de D.
7. **Points d'extension** : `SessionDoseModel.refineSessionKind` (optionnel ; absent pour V1 et pour V2 sans option) ; règles du jour `v2.time.strength_shortened`, `v2.modify.intervals_to_base`, `v2.replace.intervals`, `v2.modify.intervals_light_to_base`.
8. **Garde-fou douleur du repli** (PHYS-02.1) : le repli propose des activités (vélo, home-trainer, course). Aucune donnée ne relie une activité à une zone du corps (pas de règle par activité ; les limitations déclarées ne sont lues par aucun builder V2). Le repli n'est donc proposé que si la douleur du jour, s'il y en a une, est libérée par la **règle douleur existante** (zones de `PAIN_NON_SAFETY`, M1, appelée en lecture seule) : zone haut du corps / préhension, que l'endurance ne sollicite pas. Sinon (membres inférieurs, douleur sans localisation, zone non classée : dos, cou…) : aucune activité proposée, décision de M1 conservée, prescription bloquée `intervals_fallback_pain_not_cleared` (avec la catégorie de zone), trace `V2_INTERVALS_LIGHT_FALLBACK` « repli non proposé ». Aucune règle médicale nouvelle.
9. **Transformation V2 tracée `V2_INTERVALS_LIGHT_FALLBACK`** (PHYS-02.1, couche ARBITRATION, après A10 et avant A07) : quand la prescription du jour porte `v2.modify.intervals_light_to_base`, la décision persistée garde MODIFY et LIGHT de M1, et prend le type `AEROBIC_BASE` de la séance effective (A07 refuse un écart de type). Séance et règles de M1 dans le détail, phrase pour le rider dans `decision_reasoning` et `training.objective`. Aucun signal consommé. M1 inchangé.
10. **Compatibilité et rollback.** Aucune migration, M1 inchangé.
   - Sans option : retour vers D sûr dans les deux sens (plan, KEEP, MODIFY, lecture web, données relues).
   - Avec des plans à fractionné acceptés : D sert tous les jours de ces plans **sauf** un jour de fractionné baissé à LIGHT (erreur de contrat, rien n'est persisté). Le retour complet de `daily-run` vers D exige `intervals_sessions_ahead = 0` (`docs/release/phys02-rollback/ROLLBACK_TO_D_PRECONDITION.sql`, lecture seule, agrégée).
   - Désactiver l'option = retirer le secret : aucun plan n'est modifié ; les plans existants restent servis par ce runtime.

## B. Comportements du jour implémentés

### B1. Force
- KEEP = contenu prévu repris à l'identique + retour au calme ; aucune règle d'adaptation.
- A10 à dose constante : la durée est l'estimation du contenu ; retour au calme réduit à sa mobilité, puis derniers exercices accessoires retirés (le principal est toujours gardé), puis récupération active, puis REST. Jamais un repos raccourci ni un échauffement amputé ; filiation par exercice.
- Conseil de charge : double progression sur les séries réellement enregistrées du même exercice (règles en C).

### B2. Endurance
- **Endurance fondamentale** : inchangée (KEEP, MODIFY LIGHT 45 min, A10 par paliers de 15 min jusqu'à 45). L'échelle A10 atteint 45 min depuis une durée hors grille (53 min).
- **Fractionné, une seule dose** :
  - KEEP : copie du fractionné prévu ;
  - MODIFY vers LIGHT (C3.3, C3.6 ; séance prévue ou manuelle) : **repli** sur l'endurance fondamentale du catalogue à la dose LIGHT (45 min, activités prévues), règle `v2.modify.intervals_light_to_base`, décision MODIFY et charge LIGHT conservées, type persisté `AEROBIC_BASE`, tracé (`V2_INTERVALS_LIGHT_FALLBACK`). Puis A10 (45 min ou moins : récupération active, puis REST) ;
  - même jour avec une douleur non libérée par la règle existante (genou, cheville, hanche…, sans localisation, dos, cou…) : **aucune activité proposée** (A.8), décision de M1 conservée et visible, raison tracée ; une douleur du haut du corps ne change rien au repli ;
  - toute autre variation de charge d'un fractionné : non définie (`intervals_load_not_supported`) ; un fractionné manuel choisi en LIGHT par le rider : refusé (`manual_load_not_supported`) ;
  - MODIFY fractionné → endurance fondamentale (MENTAL_RED, famille engagée : paire de même nature de M1) : séance d'endurance fondamentale avec les activités prévues, à la durée prévue (LIGHT : 45 min) ;
  - REPLACE ou séance manuelle `AEROBIC_INTERVALS` : la séance du catalogue en MODERATE seulement ; autre charge refusée ;
  - A10 : jamais coupé ; s'il ne tient pas, l'endurance fondamentale qui tient (45 min), puis récupération active — la même règle que le planificateur quand aucun créneau ne tient le fractionné.
- **Guidage** : la dernière séance terminée du même protocole, telle qu'enregistrée (activité, durée, distance, RPE). En endurance fondamentale, un RPE noté au-dessus de la cible du jour est rappelé avec le test de la parole. Le RPE d'une séance de fractionné (toute la séance) n'est jamais comparé au RPE des répétitions.
- **Santé** : P0-SAFE inchangé et prioritaire (une douleur traumatique → aucune séance).

## C. Paramètres sportifs PROVISIONAL (validation qualifiée requise)

| Domaine | Paramètre | Valeur actuelle | Fichier |
|---|---|---|---|
| Force | Retour au calme | bas : `hip_flexor_mobility` ; haut : `cat_cow` ; puis `breathing_long_exhale` | `strengthDailyCatalogV2.ts` |
| Force | Estimation des durées | 4 s / répétition, 10 s de mise en place, 60 s de transition, montée 2 × (30 + 60 s), bornes hautes des repos | `strengthDailyCatalogV2.ts` |
| Force | Ordre de l'échelle A10 | dose gardée, retour au calme réduit, accessoires retirés depuis la fin | `todayTimeLimitV2.ts` |
| Force | Conseil de charge | 56 jours lus, référence ≤ 28 jours, −1 cran si RPE ≥ cible + 2 ou série sous la fourchette, +1 cran si toutes les séries au haut, crans 2,5 / 4 / 2 (par haltère) kg | `strengthLoadGuidancePolicyV2.ts` |
| Force | Signaux M1 qui retiennent une hausse | douleur, C3.3, C3.5, C3.6, C3.7 | `todayLoadHold.ts` |
| Endurance | Semaines du fractionné | `build_plus` (surcharge) uniquement | `enduranceIntervalsPlanPolicyV2.ts` |
| Endurance | Fractionné sans créneau de 53 min | endurance fondamentale ≤ 45 min | `blockProgressionV2.ts` |
| Endurance | Fractionné et temps du jour | endurance fondamentale 45 min, puis récupération | `todayTimeLimitV2.ts` |
| Endurance | Fractionné un jour LIGHT (repli) | endurance fondamentale LIGHT, 45 min, activités prévues | `buildFinalPrescriptionV2.ts` |
| Endurance | Zones libérant le repli | haut du corps / préhension (règle douleur existante) ; jamais une zone non classée | `enduranceFallbackPainGate.ts` |
| Endurance | Phrase du repli (rider) | « Ton état du jour demande une séance légère… endurance fondamentale légère à la place » | `applyV2IntervalsLightFallback.ts` |
| Endurance | Fractionné → fondamentale | durée prévue (53), LIGHT 45 | `buildFinalPrescriptionV2.ts` |
| Endurance | Guidage | 28 jours, même protocole ; rappel si RPE noté > cible max | `enduranceGuidancePolicyV2.ts` |
| Endurance | Mots de l'échelle RPE (web) | ≤ 2 très facile ; ≤ 4 phrases complètes ; ≤ 6 phrases courtes ; ≤ 8 quelques mots ; > 8 proche du maximum | `enduranceCoachingCopy.ts` |

Les contenus du catalogue (6 × 3 min à RPE 8, échauffement 15 min, retour au calme 10 min, activités) restent ceux de l'ADR UX-11A.5a.3, déjà PROVISIONAL.

## D. Décisions ouvertes et conflits signalés

1. **Conflit — « fractionné adapté au niveau »** (demande HPM PHYS-02) contre ADR UX-11A.5a.3 §5 : « aucun sélecteur 4 / 6, aucune règle de fatigue, de niveau ou de phase ». Implémenté : l'intensité au RPE (relative au rider) et le guidage par l'historique ; aucun niveau d'endurance n'existe au profil. Une adaptation au niveau demande de lever §5 et de choisir une donnée de niveau.
2. **Fractionné un jour LIGHT** : implémenté par le repli (PHYS-02.1) ; l'exception canonique est proposée en E.
3. **Activation de l'option** et règle de rollback associée (A.10). La génération 6 × 3 min reste PROVISIONAL et non activée.
4. **Résultats par répétition** : non enregistrés (aucune table ; durée, distance et RPE de la séance seulement).
5. **Force** : créneaux du planificateur ou durée du contenu affichée ; charges disponibles au profil ; progression au poids du corps ; correspondances entre variantes ; affichage des avertissements de guidage.
6. **Compatibilité activité / douleur** : aucune donnée ne dit quelle activité d'endurance ménage une zone. La lever (ex. table activité → zones sollicitées, validée par un professionnel) permettrait de proposer une activité compatible au lieu de l'état sûr. Même constat pour l'endurance fondamentale prévue un jour de douleur (comportement de D inchangé : activités prévues) et pour un fractionné KEEP avec une douleur non classée (règle M1).

## E. Exception proposée à l'ADR UX-11A.5a.3 §5 (PHYS-02.1)

**Conflit.** §5 : « La variante 4 × 3 min reste documentée (`autoSelectable: false`) ; aucun moteur ne peut la choisir, aucun sélecteur 4 / 6 n'existe et aucune règle de fatigue, de niveau ou de phase ne doit être inventée. » Un jour où M1 baisse le fractionné à LIGHT, aucune séance n'était donc exécutable.

**Exception minimale proposée** (texte à ajouter sous §5) :

```diff
 5. **Intervalles** : le protocole générable est **6 × 3 min à RPE 8, 2 min faciles entre les répétitions** (28 min, sans récupération après la dernière répétition). La variante 4 × 3 min reste documentée (`autoSelectable: false`) ; aucun moteur ne peut la choisir, aucun sélecteur 4 / 6 n'existe et aucune règle de fatigue, de niveau ou de phase ne doit être inventée.
+   **Exception unique (ADR PHYS-02.1)** : quand M1 baisse un fractionné à LIGHT, il n'est pas allégé ; il est **remplacé** par la séance d'endurance fondamentale du catalogue à la dose LIGHT (règle `v2.modify.intervals_light_to_base`). Aucune autre règle de fatigue, aucune règle de niveau ou de phase, aucun sélecteur 4 / 6.
```

- **Règle technique** (architecture, A.9) : transformation tracée `V2_INTERVALS_LIGHT_FALLBACK`, décision et charge de M1 conservées, type effectif aligné pour A07. Exception au principe « la décision de M1 n'est pas changée », au même titre que `V2_SYSTEMIC_FLOOR` et `V2_TODAY_TIME_CONSTRAINT`.
- **Paramètres sportifs provisoires** (C) : la séance de remplacement (endurance fondamentale), sa durée (45 min), la phrase au rider.
- **Condition** : le repli n'est proposé que pour une douleur libérée par la règle douleur existante (A.8).
- **Hors exception** : niveau d'endurance (aucune donnée au profil), variante 4 × 3, fractionné raccourci, choix d'une activité selon la douleur.

## docs/03_COACHING_MODEL.md

### §5 Prescription

```diff
-**Aucune fausse précision en V1** : jamais de charge en kg, de % de 1RM, de zone de fréquence cardiaque ni de % de FTP, même si des valeurs déclarées existent au profil. La charge utilisée sera une donnée apportée par le pilote, pas une cible calculée.
+**Aucune fausse précision** : jamais de % de 1RM, de 1RM estimé, de zone de fréquence cardiaque ni de % de FTP, même si des valeurs déclarées existent au profil.
+
+**Conseils tirés de l'historique (PROVISIONAL)** : la prescription **du jour** peut porter un conseil tiré uniquement de ce que le pilote a réellement enregistré — conseil de charge sur un exercice de travail de Force chargé (même exercice ; haltères : par haltère), rappel de la dernière séance du même protocole en endurance. Consultatifs : ni la décision, ni le contenu, ni la dose ne changent.
```

```diff
 - Intervalles : échauffement, séries structurées (ex. 6 × 3 min à RPE 8, 2 min faciles entre), retour au calme.
+  Le fractionné généré est la séance de chaque semaine de surcharge (option serveur), jamais raccourcie ; chaque répétition et chaque récupération est un bloc de la séance. L'intensité est expliquée en mots (échelle RPE, test de la parole).
```

### §6 Adaptation

```diff
+*Fractionné (PHYS-02, PHYS-02.1)* : une seule dose. Un jour où M1 le baisse à LIGHT, il est remplacé par l'endurance fondamentale LIGHT du catalogue (activités prévues), la décision et la charge de M1 étant conservées et le remplacement tracé — sauf douleur que la règle douleur existante ne libère pas pour l'endurance : aucune activité n'est alors proposée. Quand M1 décide lui-même l'endurance fondamentale (paire de même nature), elle suit son propre modèle, avec les activités prévues. Toute autre variation de charge du fractionné reste non définie.
```

### §7 Progression

```diff
-Les semaines d'affûtage avant course gardent la structure et réduisent le volume. Jamais « tu as réussi, donc +10 kg ». Une progression fondée sur la performance réelle demandera des données de réalisation et une décision séparée.
+Les semaines d'affûtage avant course gardent la structure et réduisent le volume. Jamais « tu as réussi, donc +10 kg » : la charge progresse d'**un cran de matériel au plus**, selon la double progression du conseil de charge. **Une seule progression à la fois** : quand la semaine augmente déjà la dose (séries ou RPE cible), la charge attend. Aucune hausse un jour de douleur déclarée ou de fatigue détectée par M1.
+
+Endurance : la durée de l'endurance fondamentale progresse par cycle (politique de plan) ; la semaine de surcharge apporte le fractionné, à dose fixe. Aucune hausse automatique tirée des résultats.
```

### §10 Limites

```diff
-- Pas de charge en kg, de 1RM, de % de 1RM, de zone cardiaque ni de % de FTP. Les niveaux léger, modéré et lourd de la famille Force sont des intentions de séance, pas des charges.
-- Pas de progression fondée sur la performance réelle.
+- Pas de 1RM, de % de 1RM, de zone cardiaque ni de % de FTP. Les niveaux léger, modéré et lourd sont des intentions de séance ; seul le conseil de charge (§5), tiré de l'historique du pilote, porte des kilogrammes.
+- Progression fondée sur la performance réelle : la charge des exercices de Force chargés seulement. L'endurance montre la dernière séance enregistrée sans rien adapter ; ni le poids du corps ni la DH ne s'adaptent aux résultats.
```

### Modèle de séance Force

```diff
+**Retour au calme** : chaque séance de Force **du jour** se termine par la mobilité de la zone chargée, puis une respiration à expiration longue. Il n'est pas inscrit dans le plan. Aucun résultat n'est demandé.
```

## docs/04_DAILY_DECISION_ENGINE.md — A10 et prescription du jour

```diff
-  1. **Force** → dose LIGHT 45 min (mêmes exercices). Aucune Force plus courte.
+  1. **Force** → **même dose** que celle décidée par M1 : retour au calme réduit à sa mobilité, puis retrait du dernier exercice accessoire, puis du suivant (le principal est toujours gardé). Jamais un repos raccourci, jamais un échauffement amputé, jamais une dose plus légère pour une raison de temps. La durée d'une Force est l'estimation de son contenu.
-  3. **Endurance** → même protocole et même activité, par paliers de 15 min, minimum 45.
+  3. **Endurance** → même protocole et même activité, par paliers de 15 min, minimum 45 (atteint aussi depuis une durée hors grille). **Fractionné** : jamais coupé ; l'endurance fondamentale qui tient (45 min), comme le planificateur quand aucun créneau ne le tient.
```

```diff
+- **Ajouts du jour (PHYS-01.1, PHYS-02)** : après A04 / A10, une prescription de Force reçoit son retour au calme et le conseil de charge de ses exercices chargés (séries des exécutions terminées, 56 jours, retenu un jour de douleur ou de fatigue M1) ; une prescription d'endurance reçoit le rappel de la dernière séance terminée du même protocole (28 jours). Consultatifs ; M1 n'est pas modifié.
+- **Fractionné (PHYS-02, PHYS-02.1)** : KEEP = copie ; MODIFY vers LIGHT = endurance fondamentale LIGHT 45 min (`v2.modify.intervals_light_to_base`) si la douleur du jour éventuelle est libérée par la règle `PAIN_NON_SAFETY` (zone haut du corps), sinon aucune activité (`intervals_fallback_pain_not_cleared`, tracé) ; la décision persistée gardant MODIFY et LIGHT et prenant le type `AEROBIC_BASE`, tracé `V2_INTERVALS_LIGHT_FALLBACK` (ARBITRATION) ; MODIFY vers `AEROBIC_BASE` (paire de même nature) = endurance fondamentale, durée prévue, LIGHT 45 min (`v2.modify.intervals_to_base`) ; REPLACE / manuelle = la séance du catalogue en MODERATE (`v2.replace.intervals`), une séance manuelle LIGHT décidée par le rider étant refusée. Ordre : P0-SAFE, M1, `V2_SYSTEMIC_FLOOR`, prescription, A10, repli, A07.
```

## docs/05_DATA_MODEL.md

```diff
-*Charge* : la charge observée appartient à l'exécution, pas à la prescription. `load_kg` est une donnée réalisée, facultative, saisie par le pilote ; jamais une prescription, un objectif automatique ni une charge calculée par NALYNT.
+*Charge* : la charge observée appartient à l'exécution. `load_kg` est une donnée réalisée, facultative, saisie par le pilote (haltères : par haltère). Elle alimente le **conseil de charge** de la prescription du jour (`loadGuidance` sur l'exercice de travail, dans `decision_final_prescriptions.structure`, avec la version de sa règle et sa référence). Il n'existe jamais dans une prescription planifiée.
+
+*Endurance* : l'activité réalisée (`session_activity_results` : activité, durée réelle, distance, RPE) alimente le **guidage** de la prochaine séance du même protocole (`enduranceGuidance` à la racine de la prescription finale d'endurance). Le fractionné est encodé avec les blocs existants (un bloc `main` par répétition et par récupération). Aucune table, colonne ni version de catalogue nouvelle.
```

```diff
-- **Règles générales** : … aucun kg, %1RM, zone cardiaque, FTP ni watt …
+- **Règles générales** : … aucun kg, %1RM, zone cardiaque, FTP ni watt, sauf le `loadGuidance` d'un exercice de travail d'une prescription **finale** de Force, validé à cet endroit seulement ; `enduranceGuidance` seulement à la racine d'une prescription **finale** d'endurance …
```

```diff
-KEEP = copie verbatim de la prescription planifiée.
+KEEP = copie verbatim du contenu planifié, plus, pour une Force, le retour au calme et le conseil de charge ; pour une endurance, le guidage. Aucune règle d'adaptation.
```

```diff
+- `training_plan_weeks.dose_summary.progression` (clés additives, plans générés avec l'option fractionné seulement) : raison `endurance_intervals`, `targets.aerobicSessionKind = "AEROBIC_INTERVALS"`, `intervalsPolicy`.
```

## docs/07_GLOSSARY.md

```diff
+**Conseil de charge** (`loadGuidance`) — Charge à utiliser aujourd'hui sur un exercice de travail de Force, tirée uniquement des charges que le pilote a enregistrées pour ce même exercice (double progression, un cran au plus, une seule progression à la fois). Modes : calibration, repère, cible (éventuellement retenue). Consultatif ; jamais un 1RM.
+
+**Séance raccourcie** — Séance de Force adaptée au temps du jour : même dose, retour au calme réduit, puis derniers exercices accessoires retirés.
+
+**Fractionné** — Séance `AEROBIC_INTERVALS` du protocole `endurance_intervals_3min` : échauffement, répétitions à RPE 8 séparées par des récupérations faciles, retour au calme. Une seule dose, jamais raccourcie.
+
+**Repli du fractionné** — Remplacement d'un fractionné que M1 baisse à LIGHT par l'endurance fondamentale LIGHT du catalogue ; la décision (MODIFY) et la charge (LIGHT) de M1 sont conservées, le remplacement est tracé (`V2_INTERVALS_LIGHT_FALLBACK`).
+
+**Guidage d'endurance** (`enduranceGuidance`) — Rappel, dans la séance du jour, de la dernière séance terminée du même protocole telle que le pilote l'a enregistrée ; en endurance fondamentale, rappel du test de la parole si l'effort noté dépassait la cible.
```

## docs/10_TEST_PLAN.md

```diff
+### T64. PHYS-01.1 — coaching Force exécutable
+
+- **Compatibilité** : plan identique à celui du runtime précédent ; le runtime précédent fait KEEP et MODIFY sur les données ; le web précédent lit toutes les prescriptions ; les séries enregistrées sous le runtime précédent sont relues.
+- **Durée et A10** : chaque gabarit × matériel × dose tient dans son créneau ; dose de M1 conservée ; « jamais plus que le temps donné » de 15 à 120 min.
+- **Conseil de charge** : table de règles et validation de forme ; bout en bout sur 6 semaines ; chemin Edge `daily-run`.
+
+### T65. PHYS-02 — endurance et fractionné
+
+- **Format** : fractionné du catalogue dans les champs existants (53 min, 6 répétitions, jamais la variante) ; lu bloc par bloc par le web précédent.
+- **Plan** : sans option, plan identique au runtime précédent ; avec option, fractionné en semaine de surcharge seulement ; jamais raccourci (sans créneau : fondamentale 45) ; retenue, course et affûtage : fondamentale.
+- **Jour** : KEEP copie ; T1.3 (mental RED) → fondamentale 53 min ; A10 50 → 45 min, 40 → récupération ; douleur traumatique → aucune séance.
+- **Repli LIGHT (PHYS-02.1)** : nuit courte, jambes fatiguées → endurance fondamentale LIGHT 45 min, MODIFY et LIGHT conservés, tracé ; douleur au genou, sans localisation ou non classée → aucune activité, état bloqué tracé, même sans créneau vélo et sous A10 ; douleur au poignet → repli inchangé ; avec 30 min → récupération, 15 min → REST ; signal santé (A4, A6 → A7) → aucune séance ; REST reste REST ; séance manuelle (MODIFY → repli, LIGHT choisi → refus) ; séance suivante guidée par le repli réalisé.
+- **Guidage** : même protocole, 28 jours, rappel d'effort en fondamentale seulement ; forme stricte ; jamais de fréquence cardiaque.
+- **Rollback** : le runtime précédent sert un plan à fractionnés tous les jours sauf un fractionné baissé à LIGHT (erreur, rien de persisté) ; séance manuelle refusée proprement ; la requête de précondition compte exactement ces jours ; désactiver l'option ne modifie aucun plan (vérifié sur le runtime Edge, secret ON et OFF) ; ses séances d'endurance sont relues par le guidage.
+- **Bout en bout** : plan → check-in → séance → guidage → résultat → séance suivante, sur 6 semaines ; génération et daily-run sur le runtime Edge Deno local, option ON puis OFF.
```

## F. PHYS-03 — Puissance / explosivité (implémenté, local)

### F.1 Architecture technique
- Famille `power`, kind `POWER`, intention `corner_exit_power`, format `session-model-v2.6` inchangé, aucun texte ni exercice nouveau. Builder `powerPrescriptionV2.ts` ; l'échauffement est celui du builder Force (`strengthTemplateWarmUpBlockV2`, gabarit bas du corps), le retour au calme celui de `strengthDailyCatalogV2`.
- Politiques hors manifeste : `power-session-v1` (composition), `power-plan-v1` (placement), tracées sur la semaine (`powerPolicy`, raison `power_session`, phrase).
- Option serveur `NALYNT_V2_POWER_ENABLED` (secret de `generate-training-plan`, valeur exacte `true`) ; absente = plans de D.
- Règles du jour : `v2.time.power_shortened`, `v2.replace.power` ; raisons `power_load_not_supported`, `power_fatigue_not_cleared`, `no_compatible_power_exercise` ; trace `V2_POWER_FATIGUE_HOLD` (ARBITRATION, décision de M1 inchangée). La retenue lit seulement C3.6 / C3.5 de M1 (`powerFatigueGate.ts`) ; C3.7 reste informatif.
- Web : module guidé Force réutilisé (séries enregistrées, aucun champ de charge pour la puissance) ; résumé « exercices explosifs · séries · repos complet » et consigne de qualité.
- Compatibilité : D lit et sert ces séances sans erreur ; rollback complet seulement sans séance de puissance à venir.

### F.2 Comportements implémentés
- KEEP = copie, durée effective = estimation du contenu ; LIGHT de M1 = non défini (décision conservée) ; A10 : 4 → 3 exercices explosifs, jamais moins, repos jamais raccourcis, puis récupération, puis REST ; séance manuelle en MODERATE (niveau intermédiaire et plus) ; fatigue jambes / préhension signalée par M1 → pas de séance de puissance, tracé ; P0-SAFE et REST inchangés.

### F.3 Paramètres sportifs PROVISIONAL

| Paramètre | Valeur actuelle | Fichier |
|---|---|---|
| Exercices explosifs | 3 à 4, ordre du catalogue (squat sauté, saut en longueur, sauts du patineur, swing / pompes pliométriques) | `powerSessionPolicyV2.ts` |
| Séries | minimum de la plage du catalogue (3) | `powerPrescriptionV2.ts` |
| Échauffement | gabarit Force bas du corps + `pogo_hops` | `powerSessionPolicyV2.ts` |
| Retour au calme | bas du corps (PHYS-01.1) | `strengthDailyCatalogV2.ts` |
| Placement | semaines `build`, séance de Force bas du corps, jamais le lendemain d'une séance de développement | `powerSessionPolicyV2.ts` |
| Durée | estimateur de la Force (59 min pour 4 exercices, 51 pour 3) | `strengthDailyCatalogV2.ts` |
| Retenue fatigue | C3.6, C3.5 | `powerFatigueGate.ts` |
| Mots au rider | consigne de vitesse / qualité / arrêt ; messages de refus | `strengthSummary.ts`, `finalPrescriptionV2Copy.ts` |

### F.4 Décisions ouvertes et conflits
1. **Puissance un jour LIGHT** : non définie (comme une Force déjà LIGHT). Option : moins d'exercices ou de séries — règle à valider.
2. **Débutants** : aucun exercice explosif à leur niveau dans le catalogue ; une initiation demanderait des exercices validés.
3. **M1 sans branche `POWER` pour C3.5 / C3.6** : comblé par la retenue V2 ; une branche M1 demanderait une décision HPM.
4. **`strength_warm_up_v1`** ne liste pas `POWER` (échauffement réutilisé via le gabarit Force) : à aligner lors d'une prochaine version du catalogue.
5. **Garde serveur de complétion** : aucune série exigée par le serveur pour une séance de puissance (le web l'exige) ; un garde comme `strength_set_required` demanderait une migration.
6. **Durée affichée** : estimation pour la puissance, créneau pour la Force (voir D.5).
7. **« Jamais après une séance fatigante » au jour même** : appliqué au plan (lendemain d'une séance de développement prévue) et aux signaux M1 du jour ; la séance réellement faite la veille n'est pas relue.

### F.5 Diffs proposés
- **docs/03 §5 Puissance** : « Séance générée (PHYS-03, PROVISIONAL) : échauffement de Force bas du corps puis activation pliométrique ; 3 à 4 exercices explosifs du catalogue selon niveau et matériel ; séries au minimum de la plage ; repos complet ; consigne d'arrêt ; retour au calme. Aucun kg, aucune hauteur. Un débutant n'a pas de séance de puissance. »
- **docs/04 (prescription du jour)** : « Puissance : KEEP = copie ; LIGHT non défini ; A10 = retrait des derniers exercices explosifs (jamais sous trois) ; fatigue C3.5 / C3.6 → pas de séance de puissance, décision conservée, `V2_POWER_FATIGUE_HOLD`. »
- **docs/05** : « `POWER` peut figurer dans un plan V2 (option serveur) ; prescription `power` au format v2.6 ; résultats = séries en répétitions, jamais de charge. »
- **docs/07** : « **Séance de puissance** — séance `POWER` : échauffement, 3–4 exercices explosifs à qualité maximale et repos complet, arrêt dès que la vitesse baisse, retour au calme. »
- **docs/10 T66** : contenu par niveau et matériel ; placement ; KEEP / LIGHT / A10 / fatigue / manuel ; P0-SAFE ; bout en bout plan → check-in → séance → séries → historique ; D (KEEP, LIGHT, A10, manuel, écart de fatigue, précondition) ; web de D en lecture seule.
