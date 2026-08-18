# 11 — Decision Log

Historique des **décisions structurantes** du projet. Une décision = une entrée. Uniquement les décisions qui expliquent pourquoi l'architecture actuelle est comme elle est.

Format d'entrée :

```
## YYYY-MM-DD — [Titre court de la décision]

**Contexte** : ce qui a motivé la décision.
**Décision** : ce qui a été tranché.
**Alternatives considérées** : (si pertinent)
**Impact** : quels documents / composants affectés.
**Statut** : active | superseded (par entrée du [date])
```

---

## 2026-08-11 — Architecture Head Coach multi-domaines (non générateur de workouts)

**Contexte** : Louis a explicitement demandé un système équivalent à un staff personnel de performance (~CHF 2'000/mois), pas un générateur de séances.

**Décision** : le Head Coach couvre 7 domaines (technique DH, mental, physique, sommeil/récup, nutrition, contexte de vie, analyse). La sortie est un `DailyPlan` multi-domaines, pas un session_type unique.

**Impact** : `01_PRODUCT_REQUIREMENTS.md`, `03_COACHING_MODEL.md`, `04_DAILY_DECISION_ENGINE.md`.

**Statut** : active

---

## 2026-08-11 — Suppression des chaînes de downgrade génériques

**Contexte** : La V0.1 utilisait une chaîne `STRENGTH_A → STRENGTH_B → AEROBIC → RECOVERY → REST` déclenchée par un score de readiness global. Cette approche est causalement pauvre : un mauvais sommeil et une fatigue grip produisaient la même adaptation.

**Décision** : décisions basées sur des dimensions individuelles nommées (`systemic`, `legs`, `arms_grip`, `mental`, `health`, `recent_load`). Chaque cause identifiée entraîne une adaptation appropriée.

**Alternatives considérées** : garder un readiness global comme trigger. Rejetée car ne permet pas la richesse d'un vrai coach.

**Impact** : `03_COACHING_MODEL.md`, `04_DAILY_DECISION_ENGINE.md`, tous les tests.

**Statut** : active

---

## 2026-08-11 — Prévention du double-counting

**Contexte** : sans traçabilité, un même signal (ex. `sleep_deficit`) peut déclencher plusieurs adaptations en cascade.

**Décision** : le moteur trace quels signaux ont déjà influencé la décision, empêchant leur réutilisation. Implémentation libre en TypeScript tant que les tests le couvrent.

**Impact** : `03_COACHING_MODEL.md`, `04_DAILY_DECISION_ENGINE.md`, `06_ARCHITECTURE.md`, `10_TEST_PLAN.md`.

**Statut** : active

---

## 2026-08-11 — T-X comme default framework, pas rail rigide

**Contexte** : la V0.1 imposait un `forced_session` T-X. Cela ne reflète pas la réalité (horaires officiels, voyage, état du jour, format hybride).

**Décision** : le protocole T-X produit une `recommended_session` avec soft constraints. Le Head Coach peut la surcharger si justifié. Toute dérogation est loggée avec `override_reason`.

**Impact** : `04_DAILY_DECISION_ENGINE.md`.

**Statut** : active

---

## 2026-08-11 — Support courses multi-jours (pre / in-progress / post)

**Contexte** : une course iXS commence vendredi et se termine dimanche. Le moteur ne peut pas se limiter à `event_end >= today`.

**Décision** :
- `UpcomingRace` a `event_start` + `event_end`
- Le moteur produit un `EventContext` avec `days_to_event`, `days_from_event`, `event_day`, `in_progress`, `phase`
- Fenêtre post-event utile : `days_from_event` ≤ 2 après `event_end`
- T-X sert uniquement pré-event. Une fois l'événement commencé, `event_day + race_phase` prennent le relais.
- Le programme officiel réel (si `race_phase` renseigné) prime sur le mapping T-X générique.

**Impact** : `04_DAILY_DECISION_ENGINE.md`, `05_DATA_MODEL.md`, `10_TEST_PLAN.md`.

**Statut** : active

---

## 2026-08-11 — SAFETY strictement limitée aux vraies règles médicales

**Contexte** : la V0.1 traitait `sommeil <4h + stress ≥8` comme SAFETY. Ce n'est pas une règle médicale, c'est une heuristique forte de récupération.

**Décision** : SAFETY limitée à :
- Suspicion de commotion
- Douleur nouvelle ≥ 6/10
- Fièvre / maladie
- Douleur avec critère objectif de gravité (traumatique, perte de fonction, aggravation nette)
- Retour post-commotion sans validation médicale

Les autres seuils (sommeil, stress, charge) deviennent des heuristiques fortes en couche C, arbitrables.

**Impact** : `03_COACHING_MODEL.md`, `04_DAILY_DECISION_ENGINE.md`, `10_TEST_PLAN.md`.

**Statut** : active

---

## 2026-08-11 — Soft constraints réellement soft (règle unique)

**Contexte** : ambiguïté entre "strong = obligatoire" et "strong = préférence forte".

**Décision** : règle canonique unique. Seule SAFETY est hard. Toutes les autres couches produisent des recommandations arbitrables. `strong` = préférence forte nécessitant justification forte pour override. Toute dérogation loggée avec `override_reason`.

**Impact** : `01_PRODUCT_REQUIREMENTS.md`, `03_COACHING_MODEL.md`, `04_DAILY_DECISION_ENGINE.md`.

**Statut** : active

---

## 2026-08-11 — Douleur non-SAFETY reste actionnable

**Contexte** : sans règle explicite, une douleur légère non-SAFETY était ignorée.

**Décision** : toute douleur, même non-SAFETY, doit produire :
- monitoring (observer évolution)
- protection de la zone concernée
- adaptation si la séance sollicite la zone

Elle ne doit ni être ignorée, ni annuler automatiquement l'entraînement.

**Impact** : `03_COACHING_MODEL.md`, `04_DAILY_DECISION_ENGINE.md`, `10_TEST_PLAN.md`.

**Statut** : active

---

## 2026-08-11 — Séparation DbSessionType (persistance) vs TrainingIntervention (interne)

**Contexte** : la DB Supabase V0.2 est déjà déployée avec un enum `session_type` coarse. Le Head Coach a besoin d'une représentation plus riche (STRENGTH_LOWER, STRENGTH_UPPER, GRIP_WORK, DH_LIGHT, etc.) sans devoir remigrer la DB. De plus, un simple enum riche ne suffit pas car `STRENGTH_UPPER` peut mapper vers `STRENGTH_A` ou `STRENGTH_B` selon l'intensité.

**Décision** :
- La DB conserve son enum `session_type` coarse
- Le Head Coach interne utilise `TrainingIntervention` riche combinant au minimum `kind` + `load_profile` (`HEAVY` / `MODERATE` / `LIGHT`)
- Un mapping **déterministe** existe entre les deux (fonction pure, sortie unique pour tout `(kind, load_profile)` valide)
- La persistance en `decisions.final_session` utilise le `DbSessionType`
- La richesse est stockée dans `daily_plan JSONB` (à ajouter)

**Impact** : `05_DATA_MODEL.md`, `06_ARCHITECTURE.md`, `07_GLOSSARY.md`, `10_TEST_PLAN.md`.

**Statut** : active

---

## 2026-08-11 — Le moteur part du plan existant (KEEP/MODIFY/REPLACE/REST)

**Contexte** : sans point de départ, le moteur devait tout générer, sortant du rôle de coach quotidien pour devenir un planificateur.

**Décision** : chemin normal = `season/block → planned session → daily state → KEEP / MODIFY / REPLACE / REST`. Le moteur part du `planned_session` du RawContext. Si aucun plan n'existe, fallback d'inférence marqué explicitement.

**Impact** : `03_COACHING_MODEL.md`, `04_DAILY_DECISION_ENGINE.md`, `10_TEST_PLAN.md`.

**Statut** : active

---

## 2026-08-11 — Confidence qualitative en V0.2

**Contexte** : les seuils numériques `base=0.8`, `<21 checkins`, `<15 sessions` de la V0.1 étaient arbitraires et non calibrés.

**Décision** : confidence qualitative en V0.2 (`LOW` / `MEDIUM` / `HIGH`).
- **HIGH** : SAFETY claire et non ambiguë
- **LOW** : données nécessaires manquantes ou contexte contradictoire important
- **MEDIUM** : décision normale reposant principalement sur heuristiques PROVISIONAL (cas par défaut)

Tout score numérique de confidence est proscrit en V0.2. Calibration plus fine viendra avec les données longitudinales en V0.3+.

**Impact** : `04_DAILY_DECISION_ENGINE.md`, `10_TEST_PLAN.md`.

**Statut** : active

---

## 2026-08-11 — Experiments actifs distincts des heuristiques permanentes

**Contexte** : le test "coupure liquides 21h + zéro Red Bull" avait été codé comme une règle permanente, alors qu'il s'agit d'une expérimentation avec fenêtre de review.

**Décision** : introduction d'un concept `ActiveExperiment` avec `hypothesis`, `start_date`, `intervention`, `metrics`, `review_date`, `status`. Un experiment influence le coach uniquement tant que `status = active`. Concept documenté maintenant, implémentation runtime + tests T9 sont P1 (pas M1).

**Impact** : `03_COACHING_MODEL.md`, `02_ATHLETE_PROFILE.md`, `05_DATA_MODEL.md` (évolution V0.3), `10_TEST_PLAN.md`, `12_BACKLOG.md`.

**Statut** : active

---

## 2026-08-11 — Cue "Comme à Wiriehorn" comme hypothèse, pas règle permanente

**Contexte** : la cue Wiriehorn a été identifiée comme actif mental fort à l'onboarding, mais elle ne doit pas être imposée pour toujours.

**Décision** : la cue est utilisée comme hypothèse actuellement efficace. Le modèle peut apprendre qu'une autre cue fonctionne mieux et l'ajuster.

**Impact** : `03_COACHING_MODEL.md`.

**Statut** : active

---

## 2026-08-11 — Séparation faits / hypothèses / patterns

**Contexte** : sans discipline épistémologique, les interprétations initiales de l'onboarding pouvaient être stockées comme "faits" en base.

**Décision** :
- **Faits** : mesures, déclarations, résultats vérifiables → base de données
- **Hypothèses de coaching** : interprétations initiales, révisables → documents canoniques uniquement
- **Learned Patterns** : confirmés par preuves longitudinales → couche D, vide en V0.2

Aucun learned pattern n'est activé sans preuves suffisantes. Pas de seuil universel type "N ≥ 30" — chaque candidat évalué individuellement.

**Impact** : `02_ATHLETE_PROFILE.md`, `03_COACHING_MODEL.md`.

**Statut** : active

---

## 2026-08-11 — Provenance obligatoire dans athlete_profile

**Contexte** : sans provenance, Claude Code peut prendre des données reconstruites comme vérité.

**Décision** : chaque bloc factuel de `02_ATHLETE_PROFILE.md` doit citer sa source (onboarding + date, table Supabase, déclaration Louis + date). Sans source claire → `À VÉRIFIER`.

**Impact** : `02_ATHLETE_PROFILE.md`.

**Statut** : active

---

## 2026-08-11 — Événements mécaniques loggés comme contexte

**Contexte** : le coaching setup vélo est hors périmètre, mais un dérailleur cassé peut expliquer un mauvais chrono qu'il serait erroné d'attribuer au physique ou au mental.

**Décision** : les événements mécaniques sont loggés dans `completed_sessions.main_content` ou `race_calendar.notes` comme contexte, sans que le moteur ne fasse de recommandation setup.

**Impact** : `04_DAILY_DECISION_ENGINE.md`, `05_DATA_MODEL.md`.

**Statut** : active

---

## 2026-08-11 — active_health_flags structuré (pas simple count)

**Contexte** : la règle "retour post-commotion sans validation médicale" nécessite de connaître le type et le statut du flag actif, pas seulement leur nombre.

**Décision** : `active_health_flags` dans le RawContext est une liste structurée `HealthFlag[]` avec au minimum `type` et `status`. En M1, les fixtures fournissent cette structure directement. En M2, l'adapter Supabase construit cette liste à partir de `health_flags`.

**Impact** : `04_DAILY_DECISION_ENGINE.md`, `05_DATA_MODEL.md`, `07_GLOSSARY.md`.

**Statut** : active

---

## 2026-08-11 — Champs douleur enrichis en RawContext, migration DB reportée à M2

**Contexte** : SAFETY utilise `pain_traumatic`, `pain_function_loss`, `pain_getting_worse`, mais ces champs n'existent pas dans la table `daily_checkins` de Supabase V0.2.

**Décision** : pour M1 (local), ces champs vivent dans le `RawContext` et les fixtures. Avant M2 (connexion Supabase runtime), une migration additive sera appliquée. Deux options (colonnes dédiées ou JSONB) à trancher en début de M2. Ne pas modifier la DB maintenant.

**Impact** : `04_DAILY_DECISION_ENGINE.md`, `05_DATA_MODEL.md`, `12_BACKLOG.md`.

**Statut** : active

---

## 2026-08-12 — Workflow GitHub + Claude Code + Claude Project

**Contexte** : jusqu'ici toute la conception vivait dans les conversations Claude Project. Louis souhaite un vrai repository GitHub comme source de vérité partagée.

**Décision** :
- Repo `louisgiller07/louis-performance-system` = source de vérité partagée
- `/docs` = intention canonique (métier + architecture)
- Code = implémentation
- Tests = contrats exécutables
- Supabase = état persistant
- Claude Code implémente dans le repo
- Claude Project = architecte + Head Coach + gardien des docs canoniques
- Claude Code ne modifie pas de sa propre initiative les documents canoniques (sauf status, decision log, backlog)

**Impact** : `CLAUDE.md`, tout le workflow projet.

**Statut** : active

---

## 2026-08-13 — M1 implémenté : interprétations retenues (non bloquantes)

**Contexte** : implémentation de la vertical slice locale (`head-coach-engine/`) selon `04_DAILY_DECISION_ENGINE.md` et `10_TEST_PLAN.md`. Aucune contradiction bloquante trouvée entre documents, mais plusieurs zones sous-spécifiées ont nécessité une interprétation explicite, documentée ici pour traçabilité (à valider par Louis / l'architecte).

**Décisions retenues** :
- **`recent_load.level` reste `GREEN`/`AMBER`/`RED`** (vocabulaire canonique de `07_GLOSSARY.md`), malgré la prose `HIGH`/`VERY_HIGH` de `04_DAILY_DECISION_ENGINE.md` §4 (qui reprend la terminologie du champ DB `athlete_state.fatigue_zone`). Mapping documenté dans `src/engine/recentLoad.ts` : `GREEN ≈ LOW/NORMAL`, `AMBER ≈ HIGH`, `RED ≈ VERY_HIGH`.
- **Champ `decision: 'KEEP'|'MODIFY'|'REPLACE'|'REST'` ajouté explicitement à `DailyPlan`.** Le pseudo-schéma de `04_DAILY_DECISION_ENGINE.md` §6 ne le liste pas (il le décrit comme implicite via `planned_session_before`/`final_session`), mais `10_TEST_PLAN.md` T7.1-T7.4 teste ces 4 libellés directement — le champ explicite rend l'arbitrage testable sans ambiguïté.
- **Seuils numériques par dimension** (ex. `sleep_hours < 6 → RED`) centralisés et documentés `PROVISIONAL` dans `src/engine/provisionalThresholds.ts` — aucun n'est calibré sur les données longitudinales de Louis, conformément au principe #10 de `01_PRODUCT_REQUIREMENTS.md`.
- **Classification MODIFY vs REPLACE** : `AEROBIC_INTERVALS → AEROBIC_BASE` (dimension `mental` RED) est traité comme MODIFY (même discipline, intensité/structure réduite), conformément à `10_TEST_PLAN.md` T1.3, malgré le changement de `kind`.
- **Détection de contradiction (confidence LOW, T10.2)** : implémentée comme vérification explicite "contrainte de mode `strong` vs `planned_session` sans cause dimensionnelle corroborante" (ex. `no_grip_heavy` strong + `planned_session=GRIP_WORK`), portée volontairement minimale (scope M1), extensible en V0.3+.

**Impact** : `head-coach-engine/src/`, `10_TEST_PLAN.md` (aucune modification du document lui-même, tests écrits conformes).

**Statut** : superseded partiellement par l'entrée du 2026-08-13 (round 1) ci-dessous (revue Louis) — les points "détection de contradiction" et "seuils systemic" ont été corrigés.

---

## 2026-08-13 — Corrections post-revue Louis sur M1 (round 1)

**Contexte** : revue de l'implémentation M1 par Louis. Quatre comportements jugés incorrects par rapport à l'intention canonique.

**Décisions** :
1. **Soft constraint `strong` reste réellement soft.** La détection de "contradiction" `no_grip_heavy`/`no_dh_intense` (strong) vs `planned_session` a été supprimée de `buildDailyPlan.ts` : un conflit entre le plan et une soft constraint, même `strong`, est un arbitrage normal (le plan est maintenu si rien ne le justifie autrement) et ne dégrade plus `confidence` à `LOW`. Idem dans `fallbackInference.ts` : `no_development` (strong) ne force plus silencieusement `RECOVERY_ACTIVE`. Seule SAFETY reste hard.
2. **`recent_load` RED + `systemic` GREEN devient l'unique détecteur de contradiction M1** (confidence LOW) : c'est une vraie incohérence de données (deux dimensions se contredisent sur l'état de récupération réel), pas un désaccord plan/préférence. `10_TEST_PLAN.md` T10.2 réinterprété en ce sens (l'exemple alternatif du document — conflit `no_grip_heavy`/`GRIP_WORK` — est désormais couvert par un test démontrant explicitement l'absence de dégradation de confidence).
3. **Le protocole T-X participe à l'arbitrage même si `planned_session` existe.** `buildDailyPlan.ts` utilise désormais `raceProtocol.recommended_session` comme baseline dès qu'un événement pertinent existe, avant `planned_session` — un plan générique qui n'a pas anticipé la course ne prime plus automatiquement sur T-X. `planned_session_before` continue de refléter le plan réel pour la traçabilité. Tout override réel du RaceProtocol (session finale ≠ recommandation T-X) porte désormais garantie un `override_reason` non vide.
4. **Signaux `systemic` causaux séparés.** `computeSystemic()` ne fusionne plus toute anomalie sous `sleep_deficit` : signaux distincts `sleep_deficit` (durée), `sleep_quality_low`, `energy_low`, `sleep_fragmented` (nouveau seuil PROVISIONAL `amberMinWakeUps` sur `sleep_wake_ups`). Chaque signal est consommé indépendamment par C3.3.
5. **SAFETY A5 toujours tracée.** `triggered_rules` contient désormais systématiquement la règle A5 et `protection.do_not_do` signale toujours l'interdiction DH dès qu'un flag `concussion_suspect` non résolu est actif — que la séance finale soit du DH (remplacée) ou non (maintenue).

**Impact** : `head-coach-engine/src/engine/buildDailyPlan.ts`, `src/domains/fallbackInference.ts`, `src/engine/computeDimensions.ts`, `src/engine/provisionalThresholds.ts`, `src/domains/training.ts`, tests associés.

**Statut** : superseded partiellement par l'entrée du 2026-08-13 (round 2) ci-dessous — le point 2 (détecteur de contradiction `systemic`/`recent_load`) et le comportement no-op des soft constraints `strong` (conséquence non voulue du point 1) ont été corrigés.

---

## 2026-08-13 — Corrections post-revue Louis sur M1 (round 2)

**Contexte** : deuxième revue de Louis sur les corrections du 2026-08-13. Deux points encore incorrects.

**Décisions** :

1. **`systemic GREEN` + `recent_load RED` n'est PAS une contradiction.** Un athlète peut être frais aujourd'hui malgré une charge 7 jours très élevée — les deux états coexistent normalement. `CONTRADICTION_SYSTEMIC_VS_RECENT_LOAD` est supprimé. **La seule source de `confidence = LOW` en M1 devient une incohérence STRUCTURELLE des données** (donnée impossible, pas un désaccord entre dimensions valides) : deux courses `upcoming_races` marquées "en cours" (`in_progress`) le même jour — impossible pour un seul athlète. Nouvelle fonction `hasOverlappingInProgressRaces()` dans `engine/eventContext.ts`, nouveau `T10.2` avec un calendrier synthétique volontairement invalide. Aucune relation d'exclusivité artificielle n'est créée entre dimensions.

2. **Les soft constraints `strong` ne doivent pas devenir des no-op.** La correction du 2026-08-13 (point 1) avait supprimé toute conséquence des contraintes `strong` du mode, les rendant invisibles dans l'arbitrage — ce qui n'est pas non plus correct : `strong` = forte préférence de coaching, **toujours overridable, mais qui doit réellement participer à la décision**. Nouveau mécanisme dans `rules/modes.ts` (`describeStrongConstraintViolation`) + `buildDailyPlan.ts` :
   - Si la séance finale enfreint une contrainte `strong` et qu'**aucune justification** n'est déclarée (`RawContext.planned_intent` absent) → la contrainte s'applique réellement (la séance est adaptée), tracé `SOFT_CONSTRAINT_STRONG_APPLIED`.
   - Si une justification est déclarée (`planned_intent` renseigné) → le plan initial est conservé malgré la contrainte, tracé `SOFT_CONSTRAINT_STRONG_OVERRIDDEN`.
   - Dans les deux cas, l'issue est explicitement tracée dans `triggered_rules` (raison, contrainte, mode, changement de séance le cas échéant).
   - SAFETY reste la seule couche réellement hard/non-overridable ; l'arbitrage des soft constraints `strong` se fait avant SAFETY A5 (ZERO_DH), qui garde le dernier mot.
   - `planned_intent` (champ déjà existant dans `RawContext`, "notes du planificateur sur pourquoi cette séance était prévue") est réutilisé comme mécanisme de justification plutôt que d'inventer un nouveau champ.

**Impact** : `head-coach-engine/src/engine/eventContext.ts`, `src/engine/buildDailyPlan.ts`, `src/rules/modes.ts`, tests associés (`tests/t10_confidence.test.ts`, `tests/modesConstraints.test.ts`).

**Statut** : superseded partiellement par l'entrée du 2026-08-13 (round 3) ci-dessous — `SOFT_CONSTRAINT_STRONG_OVERRIDDEN` ne loggait pas encore `override_reason`.

---

## 2026-08-13 — Corrections post-revue Louis sur M1 (round 3)

**Contexte** : troisième revue de Louis sur les corrections du round 2. Un point métier + une erreur de date dans la documentation.

**Décisions** :

1. **Une dérogation réelle à une soft constraint `strong` doit être loggée avec `override_reason`, pas seulement tracée dans `triggered_rules`.** Le canon (`docs/07_GLOSSARY.md` §override_reason) exige explicitement une chaîne loggée pour toute dérogation à une soft constraint. Le détail de la règle `SOFT_CONSTRAINT_STRONG_OVERRIDDEN` est reformulé au format `Override <constraint.type> (strong): <planned_intent>` et cette valeur alimente désormais `DailyPlan.override_reason` — y compris quand aucun override du RaceProtocol n'a lieu par ailleurs. Quand les deux se produisent ensemble (RaceProtocol ET soft constraint), le même champ `override_reason` combine les raisons pertinentes, sans duplication (la logique existante du RaceProtocol n'est pas modifiée : elle inclut déjà naturellement `SOFT_CONSTRAINT_STRONG_OVERRIDDEN`/`APPLIED`, qui sont de layer `ARBITRATION`).
2. **Correction de date** : toutes les références à "2026-08-14" dans le code et les commentaires (introduites par erreur lors du round 2) sont corrigées en "2026-08-13" — nous sommes le 2026-08-13. Les entrées de ce journal datées du même jour sont désormais explicitement numérotées (round 1 / round 2 / round 3) pour rester distinguables.

**Impact** : `head-coach-engine/src/engine/buildDailyPlan.ts`, `src/rules/modes.ts` (commentaire), `src/engine/eventContext.ts` (commentaire), `tests/t10_confidence.test.ts` (commentaire + nouveau test), ce document.

**Statut** : active.

---

## 2026-08-13 — M1 APPROVED, frozen

**Contexte** : revue architecte du vertical slice M1 après 3 rounds de corrections. Tous les points canoniques (SAFETY A1-A5, dimensions séparées, prévention du double-counting, KEEP/MODIFY/REPLACE/REST, soft constraints strong overridables via `planned_intent`, RaceProtocol/T-X, multi-day races, mapping déterministe `TrainingIntervention → DbSessionType`, confidence qualitative) sont conformes. 75/75 tests verts, type-check et build clean.

**Décision** : M1 APPROVED. Les dossiers `head-coach-engine/src/{types,engine,rules,domains,mapping}` sont **frozen** sauf bug métier réel découvert ultérieurement. M2 n'y touche pas.

**Impact** : `CLAUDE.md`, `docs/00_PROJECT_STATUS.md`, contrainte structurante pour toute la conception M2.

**Statut** : active

---

## 2026-08-13 — M2 : Option A retenue pour les champs douleur enrichis (colonnes `NULL` sur legacy)

**Contexte** : les champs `pain_traumatic`, `pain_function_loss`, `pain_getting_worse` utilisés par SAFETY A4 vivaient localement dans `RawContext.checkin` en M1. Deux options envisagées pour la persistance Supabase : (A) trois colonnes booléennes dédiées dans `daily_checkins`, (B) un JSONB `pain_metadata`.

**Décision** : **Option A retenue**. Migration `M2_001` : trois colonnes `boolean NULL` **sans default** dans `daily_checkins`. Une row pré-M2 n'a jamais collecté ces critères : `NULL = inconnu`, pas `false`. Toute nouvelle row M2 (créée via le DAL) doit fournir explicitement `true` ou `false` pour chacun des trois champs. L'adapter Supabase (`buildRawContextFromSupabase`) **rejette** un checkin courant M2 dont un des trois critères est `NULL`, plutôt que de convertir silencieusement en `false`. Le moteur M1 reste inchangé et reçoit toujours des booleans valides (ou aucun contexte du tout).

**Justifications** : homogénéité canonique (les autres champs `pain`, `pain_intensity`, `pain_new` sont déjà scalaires), zéro indirection entre M1 et M2 (copie de champs à champs), JSONB non justifié pour 3 booléens fixés par la spec.

**Alternatives considérées** :
- Option B (JSONB `pain_metadata`) — rejetée pour hétérogénéité de style et sur-ingénierie.
- `boolean NOT NULL DEFAULT false` — rejeté car fabrique une donnée historique (assume que les rows legacy avaient `false` pour ces trois critères, alors qu'ils n'ont simplement jamais été collectés).

**Impact** : `docs/05_DATA_MODEL.md`, `CLAUDE.md`, migration `M2_001_daily_checkins_pain_criteria.sql`, comportement obligatoire de l'adapter M2.

**Statut** : active

---

## 2026-08-13 — M2 : `decisions.daily_plan JSONB` + `decisions.active_mode` NULL sur legacy

**Contexte** : le `DailyPlan` produit par M1 est plus riche que le schéma `decisions` V0.2 (sections multi-domaines, `TrainingIntervention` riche, `event_context`, `decision` KEEP/MODIFY/REPLACE/REST, `overrode_race_protocol`, `health_flag_to_create`). Il faut le persister sans casser les rows historiques.

**Décision** : migration `M2_002` ajoute deux colonnes à `decisions` :
- `daily_plan JSONB NULL` (source de vérité)
- `active_mode training_mode NULL` (projection SQL)

**Pas de valeur par défaut fabriquée pour les rows historiques.** Les rows antérieures à M2 restent `NULL` — on ne sait pas ce que valaient ces champs au moment où la décision a été prise, il n'y a rien à inventer. Les nouvelles rows M2 les remplissent toujours via le DAL. Les colonnes historiques (`final_session`, `planned_session_before`, `reason`, `confidence`, `do_not_do`, `override_reason`, `engine_version`) deviennent des **projections dénormalisées** du JSONB.

**Alternatives considérées** : `DEFAULT '{}'::jsonb` et `DEFAULT 'IN_SEASON'` — rejetés car fabriquent des données historiques inexistantes.

**Impact** : `docs/05_DATA_MODEL.md`, `CLAUDE.md`, migration `M2_002_decisions_daily_plan.sql`.

**Statut** : active

---

## 2026-08-13 — M2 : `planned_sessions.intervention JSONB` + `planned_intent TEXT` + inversion partielle documentée

**Contexte** : le mapping `TrainingIntervention → DbSessionType` est **surjectif** (plusieurs `(kind, load_profile)` mappent vers le même `DbSessionType`). Impossible de reconstruire proprement la richesse à la lecture sans information supplémentaire. Par ailleurs, `RawContext.planned_intent` existe et participe désormais à l'arbitrage des soft constraints strong (voir round 2 du 2026-08-13 ci-dessus) — il doit donc être persisté et lu.

**Décision** : migration `M2_003` ajoute à `planned_sessions` :
- `intervention JSONB NULL` — conserve la `TrainingIntervention` riche à la lecture
- `planned_intent TEXT NULL` — notes du planificateur, mappé explicitement vers `RawContext.planned_intent` par l'adapter

Nullable assumé : lignes historiques → `intervention = NULL`. Comportement de l'adapter :
- **Inversion partielle appliquée uniquement pour les mappings mathématiquement non ambigus** :
  - `REST` → `{ kind: "REST" }`
  - `BIKE_MAINTENANCE` → `{ kind: "BIKE_MAINTENANCE" }`
  - `RACE_PREP` → `{ kind: "RACE_ACTIVITY" }`
- **Tout autre `DbSessionType`** (`STRENGTH_A`, `STRENGTH_B`, `AEROBIC_BASE`, `AEROBIC_INTERVALS`, `DH_TECHNICAL`, `DH_PERFORMANCE`, `RECOVERY`) → `planned_session = null` + warning adapter. Le moteur active alors le fallback M1 T6.1 (inférence).

**Aucune reconstruction inventée du `kind` ou du `load_profile`.**

`planned_intent` **n'est jamais inféré** automatiquement depuis `primary_objective` ou tout autre champ existant. L'adapter mappe uniquement la valeur explicite de la colonne.

Pour `completed_sessions` : audit préalable au début de M2 pour vérifier si `main_content` contient déjà de façon canonique la `TrainingIntervention`. Si oui, réutiliser tel quel. Si non, migration additionnelle `M2_004` sur le même modèle. Décision à tracer en son temps.

**Alternatives considérées** :
- Mapping inverse "meilleur effort" pour tous les `DbSessionType` — rejeté (introduit de la fiction).
- Inférence de `planned_intent` depuis `primary_objective` — rejetée (fabrication d'une justification qui n'a pas été explicitement formulée).
- Ne rien changer, tout inférer via `main_content` — rejeté pour `planned_sessions` (n'a pas d'équivalent), à valider pour `completed_sessions`.

**Impact** : `docs/05_DATA_MODEL.md`, `docs/06_ARCHITECTURE.md` (§Fallback d'intervention en lecture), `CLAUDE.md`, migration `M2_003_planned_sessions_intervention.sql`, éventuellement `M2_004`.

**Statut** : active

---

## 2026-08-13 — M2 : `decisions` append-only, pas d'upsert

**Contexte** : question ouverte en début M2 — une décision par jour (upsert sur `(athlete_id, decision_date)`) ou historique complet des exécutions ?

**Décision** : **append-only**. Aucune contrainte d'unicité sur `(athlete_id, decision_date)`, aucun `ON CONFLICT`, aucun upsert destructif. Plusieurs décisions par jour sont autorisées si le contexte change en cours de journée (nouveau checkin, événement en cours, override manuel plus tard). La décision courante est la plus récente (`ORDER BY created_at DESC LIMIT 1`).

Champs `supersedes_decision_id`, `revision`, `is_current` pourront être ajoutés plus tard si l'audit fin devient nécessaire (P2+).

**Alternatives considérées** : upsert avec contrainte unique — rejeté car écrase l'historique intra-journée et complique le raisonnement causal futur.

**Impact** : `docs/05_DATA_MODEL.md`, `docs/06_ARCHITECTURE.md`, `docs/10_TEST_PLAN.md`, `CLAUDE.md`.

**Statut** : active

---

## 2026-08-13 — M2 : persistance atomique via RPC PostgreSQL + idempotence health_flags garantie par contrainte DB

**Contexte** : SAFETY A1/A2/A3/A4 produit un `health_flag_to_create` dans le `DailyPlan`. SAFETY A5 (`04_DAILY_DECISION_ENGINE.md §2`) requiert un flag `concussion_suspect` non résolu **pré-existant** en base pour se déclencher. Sans persistance atomique du flag et de la décision, le cycle A1 (jour N) → A5 (jour N+1) risque d'être cassé en cas d'échec partiel.

De plus, l'idempotence garantie uniquement par un pattern SELECT-then-INSERT applicatif est fragile en cas d'appels concurrents ou multiples.

**Décision** :

1. **Contrainte / index unique partiel PostgreSQL** sur `health_flags` empêchant deux flags ouverts `(athlete_id, type)` simultanément (`status IN ('active','monitoring')`), tout en autorisant un nouveau flag après résolution. Idempotence garantie côté DB, pas seulement par le code applicatif. DDL réel à auditer en début de M2 avant application de la migration correspondante.
2. **Fonction PostgreSQL / RPC `persist_daily_run`** qui exécute, **dans le même appel** (transaction unique implicite d'une `FUNCTION` PostgreSQL) :
   - upsert éventuel du `health_flag_to_create` (via `INSERT ... ON CONFLICT DO NOTHING` s'appuyant sur la contrainte ci-dessus)
   - insert append-only de la row `decisions`
   - toute erreur non capturée fait échouer l'appel et annule les écritures de cet appel (contrat de sécurité RPC précisé dans l'entrée 2026-08-14 correspondante)

**Aucune logique de coaching côté SQL.** La RPC est un pur enregistreur transactionnel. Toute décision reste dans le moteur TypeScript.

3. **Séparation stricte calcul / persistance** côté TypeScript :
   - `computeDailyFor(client, athleteId, today)` → construit `RawContext`, appelle M1, retourne `{rawContext, dailyPlan}`. **Zéro écriture.**
   - `runDailyFor(client, athleteId, today)` → appelle `computeDailyFor`, invoque la RPC `persist_daily_run`, retourne les identifiants.

Le "dry-run" est `computeDailyFor` — pas de flag `--dry-run` sur `runDailyFor`.

Tests obligatoires : cycle A1 (jour N) → A5 (jour N+1) prouvé en intégration (M2.C.1 + M2.C.2), idempotence sous appels concurrents/multiples prouvée par la contrainte DB (M2.C.4).

**Impact** : `docs/05_DATA_MODEL.md`, `docs/06_ARCHITECTURE.md`, `docs/10_TEST_PLAN.md`, migrations M2 pour la contrainte + la RPC, `src/supabase/computeDailyFor.ts` et `src/supabase/runDailyFor.ts`.

**Statut** : active

---

## 2026-08-13 — M2 : décisions infra (Supabase CLI local + clé serveur env-only)

**Contexte** : deux décisions d'infrastructure à trancher avant que Claude Code démarre M2.

**Décisions** :

1. **Tests d'intégration** : Supabase CLI local (Postgres + auth + storage bundlés). Migrations versionnées (`supabase/migrations/M2_*.sql`) appliquées automatiquement au démarrage. Seed reproductible contenant Louis + scénarios canoniques M1 transposés en rows SQL. Chaque suite de tests part d'un état DB déterministe (reset + seed).
2. **Authentification M2** : clé serveur uniquement. Préférer la **Secret Key Supabase actuelle**, supporter le **legacy `SUPABASE_SERVICE_ROLE_KEY`** si le projet actuel l'utilise encore. Secret lu depuis l'environnement (`SUPABASE_URL` + clé serveur), **jamais commité**. Pas de JWT athlète en M2 (CLI serveur, pas de contexte utilisateur — le JWT sera introduit à M3 avec l'Edge Function).

**Impact** : `docs/06_ARCHITECTURE.md`, `docs/10_TEST_PLAN.md`, `docs/12_BACKLOG.md`, `.env.example` (à créer), `.gitignore` (à vérifier).

**Statut** : active

---

## 2026-08-13 — M2 : audit DDL réel obligatoire avant toute migration

**Contexte** : la spec canonique `05_DATA_MODEL.md` décrit les tables au niveau conceptuel (champs principaux, enums, contraintes de sécurité). Le DDL réel déployé peut contenir des détails (noms exacts de colonnes, contraintes existantes, valeurs par défaut, types précis, triggers) non exhaustivement documentés. Écrire des migrations M2 sans auditer le DDL réel risque de produire des migrations incohérentes avec l'existant (ex : dupliquer une contrainte, se tromper sur le nom exact d'une colonne `location_code` de `health_flags`, méconnaître un trigger).

**Décision** : **la première tâche M2** est un audit du DDL réel des tables et enums touchés par M2 (`daily_checkins`, `decisions`, `planned_sessions`, `completed_sessions`, `health_flags`, enums `training_mode`, `health_flag_type`, `health_flag_status`, `session_type`). L'audit est tracé (résumé bref + décisions dérivées) avant l'écriture des migrations. En particulier, la clé exacte d'idempotence des `health_flags` (`type` seul ou `type + location_code`) est déterminée à ce moment.

**Impact** : `docs/00_PROJECT_STATUS.md` (critère de sortie M2), `docs/12_BACKLOG.md` (tâche P0 en premier).

**Statut** : active

---

## 2026-08-14 — M2 : audit DDL réel effectué (via MCP Supabase)

**Contexte** : la première tâche M2 (audit DDL du schéma déployé) a été réalisée à distance via un MCP Supabase. Résultats factuels différents de plusieurs anticipations documentaires.

**Faits confirmés** :
1. `health_flags` : la colonne discriminante réelle est **`flag_type`** (pas `type`). Aucun discriminateur `location_code`. Clé d'idempotence retenue : **`(athlete_id, flag_type)`** filtré sur `status IN ('active','monitoring')`.
2. `completed_sessions.main_content` : JSONB **libre**, table **vide**, sans convention canonique. La `TrainingIntervention` riche ne peut pas y vivre. Décision : **`M2_004` REQUIRED** (plus conditionnel).
3. `decisions.confidence` réel : **`numeric(3,2)`**, incompatible avec les valeurs qualitatives `LOW|MEDIUM|HIGH` produites par le moteur M1 frozen.
4. `decisions.overridden_by_user` réel : **`NOT NULL DEFAULT false`**, contrairement à la spec qui annonçait `NULL` en M2. En M2 il conserve son default DB (`false`).
5. La DB distante ne possède **aucun historique de migrations Supabase** à ce jour.

**Impact** : modifications canoniques des sections `decisions`, `completed_sessions`, `health_flags` de `docs/05_DATA_MODEL.md`, mise à jour de `docs/06_ARCHITECTURE.md`, refonte de l'ordre canonique des migrations M2 dans `docs/12_BACKLOG.md`, ajustement des critères de sortie dans `docs/00_PROJECT_STATUS.md`.

**Statut** : active

---

## 2026-08-14 — M2 : `confidence_level` intégré dans `M2_002`, pas de `M2_007`

**Contexte** : l'audit a révélé que `decisions.confidence` en base est `numeric(3,2)`, alors que le moteur M1 frozen produit un enum qualitatif `LOW|MEDIUM|HIGH`. Deux options ouvertes : écraser/convertir la colonne legacy, ou ajouter une nouvelle colonne enum à côté.

**Décision** : nouvelle colonne enum ajoutée à côté, avec deux précisions structurantes :

1. **Aucune migration `M2_007`** : puisque l'ordre canonique des migrations M2 n'a pas encore été appliqué (ni en local, ni en remote), la nouvelle colonne + enum sont intégrés directement à **`M2_002`** (aux côtés de `daily_plan` et `active_mode`). Ordre canonique final : baseline V0.2, `M2_001`, `M2_002` (`daily_plan`, `active_mode`, `confidence_level`), `M2_003`, `M2_004`, `M2_005`, `M2_006`.
2. **Colonne legacy `confidence numeric(3,2)` conservée intacte**, non écrite par le DAL M2 — reste `NULL` pour les nouvelles rows M2 et garde ses valeurs historiques pour les rows pré-M2. La nouvelle colonne `decisions.confidence_level confidence_level NULL` (enum PostgreSQL `confidence_level ('LOW','MEDIUM','HIGH')`) est **obligatoire via DAL** pour toute nouvelle décision M2.

**Alternatives considérées** :
- Écraser la colonne `confidence` numeric par un enum — rejeté (destructif, perd les valeurs historiques).
- Convertir la valeur qualitative en scalaire numérique — rejeté (fabrication d'un score numérique, contraire à la décision canonique du 2026-08-11 "Confidence qualitative en V0.2").
- Créer une migration `M2_007` séparée — rejeté puisque `M2_002` n'est pas encore appliqué.

**Impact** : `docs/05_DATA_MODEL.md` §decisions, `docs/06_ARCHITECTURE.md` (signature RPC), `docs/12_BACKLOG.md` (contenu de `M2_002`), mapping `dailyPlanToDecisionRow` côté DAL.

**Statut** : active

---

## 2026-08-14 — M2 : baseline V0.2 strictement read-only via `db dump --linked --schema public`

**Contexte** : la DB distante n'a aucun historique de migrations Supabase à ce jour. Il faut néanmoins figer l'état existant comme point de départ des migrations M2, sans jamais le rejouer et sans effet de bord côté remote.

**Décision** :

1. **Capture initiale** : `supabase db dump --linked --schema public > supabase/migrations/20260814095000_baseline_v0_2.sql`. Timestamp réel de capture (2026-08-14 09:50:00 UTC), antérieur à toute migration M2 dans l'ordre lexicographique. Toutes les migrations M2 (`M2_001` à `M2_006`) portent des timestamps de nom strictement postérieurs.
2. **Read-only strict** : versionné pour référence factuelle et reconstruction locale, mais **jamais réédité manuellement** et **jamais poussé** via `db push`.
3. **Aucun `db push`, aucun `migration repair`, aucune modification remote** pendant tout le développement local. Le développement local applique la baseline + les migrations M2 sur l'instance Supabase locale uniquement.
4. **Avant le premier `supabase db push` M2** vers la DB Louis, la baseline devra être marquée comme **déjà appliquée** dans l'historique de migrations distant (via `supabase migration repair` ou méthode équivalente documentée), afin qu'elle ne soit jamais rejouée sur le schéma existant. À exécuter une seule fois, hors développement, uniquement après revue Louis.

**Alternatives considérées** :
- `supabase db pull` — peut générer une migration depuis le schéma distant et peut également proposer une synchronisation de l'historique de migrations distant. Nous choisissons `db dump --linked` pour garder la capture initiale strictement read-only vis-à-vis du schéma **et** de l'historique remote — aucune écriture, aucune synchronisation, aucun effet de bord côté DB Louis.
- Reconstruction manuelle des DDL à partir de l'audit MCP — rejeté (fragile, sujet à erreurs de transcription).

**Impact** : `docs/05_DATA_MODEL.md` §Décisions M2, `docs/06_ARCHITECTURE.md` §Baseline read-only et stratégie tests, `docs/12_BACKLOG.md` §Infra + §Validation, `docs/00_PROJECT_STATUS.md` critères de sortie.

**Statut** : active

---

## 2026-08-14 — M2 : contrat de sécurité de la RPC `persist_daily_run`

**Contexte** : la fonction `persist_daily_run` est le seul mécanisme d'écriture M2 sur `health_flags` et `decisions`. Elle doit être verrouillée dès sa création pour empêcher tout usage non prévu, en particulier depuis une future UI cliente.

**Décision** : contrat de sécurité canonique de la fonction, fixé par la migration `M2_006` :

- `SECURITY INVOKER` (pas `SECURITY DEFINER`) — la fonction s'exécute avec les droits du rôle appelant, pas ceux du créateur.
- Aucune exposition à `PUBLIC`, `anon` ou `authenticated`.
- `EXECUTE` accordé **uniquement** au rôle serveur utilisé par M2 (`service_role` ou équivalent serveur validé lors de l'implémentation).
- **Jamais appelable directement depuis une future UI cliente sans nouvelle décision architecte tracée dans ce journal.** L'ouverture éventuelle à un JWT athlète (M3+) devra passer par une couche intermédiaire (Edge Function) validant les entrées, jamais par un `GRANT EXECUTE ... TO authenticated`.

Également : aucun `COMMIT` ni `ROLLBACK` explicite dans le corps de la fonction. `persist_daily_run` est une `FUNCTION` (pas une `PROCEDURE`), donc s'exécute intrinsèquement dans une transaction unique. Toute erreur non capturée annule les écritures de cet appel.

**Impact** : `docs/06_ARCHITECTURE.md` §Persistance idempotente + atomique, `docs/12_BACKLOG.md` (contenu de `M2_006`).

**Statut** : active

---

## 2026-08-16 — M2 : read path — normalisations de boundary (pain_intensity, race_format, race_phase)

**Contexte** : revue du read path M2 (`buildRawContext`/`computeDailyFor`). Trois champs requis par les types M1 frozen n'ont pas de source DB directement compatible (colonne nullable ou absente). Décisions tranchées pour lever les interprétations précédemment signalées comme non actées.

**Décisions** :

- `pain=false` + `daily_checkins.pain_intensity IS NULL` → `DailyCheckin.pain_intensity = 0` côté M1. Normalisation de représentation à la frontière M2, pas une donnée clinique inventée : la contrainte SQL `pain_intensity_requires_pain` impose `pain=false ⟺ pain_intensity IS NULL` (l'intensité n'est pas un fait inconnu, elle n'existe pas), le type M1 `pain_intensity: number` ne peut pas représenter "non applicable", et tous les sites de lecture M1 (`safety.ts`, `computeDimensions.ts`, `painNonSafety.ts`) ne déréférencent `pain_intensity` que derrière un garde `pain===true`. `pain=true` + `pain_intensity` NULL/invalide reste rejeté sans exception.
- `race_calendar.race_format IS NULL` → `UpcomingRace.race_format = "OTHER"` **et un warning explicite est émis** (porté par `buildRawContext`/`computeDailyFor`, pas par `DailyPlan`/M1). La course reste présente dans le contexte, aucun protocole T-X n'est déclenché par `"OTHER"` (comportement déjà identique à tout format non couvert par `PRE_EVENT_TABLES`), et le warning conserve la trace que la donnée source était inconnue. Une valeur `race_format` non-null mais non reconnue n'est **jamais** repliée sur `"OTHER"` : elle est rejetée explicitement (`InvalidRaceCalendarRowError`).
- `race_phase` reste toujours absent (`undefined`) côté M2 : aucune colonne DB ne le porte. Le fallback déjà existant de M1 (`?? "RACE_DAY_GENERIC"`, `src/engine/eventContext.ts`) s'applique sans changement.

**Alternatives considérées** :
- Rejeter tout checkin avec `pain=false` + `pain_intensity` NULL comme incomplet — rejeté : la contrainte SQL montre que ce NULL est la représentation correcte et attendue de "non applicable", pas une omission.
- Convertir silencieusement tout `race_format` inconnu (NULL ou valeur non reconnue) en `"OTHER"` — rejeté pour le cas "valeur non reconnue" : une valeur non-null hors vocabulaire n'est pas une absence de donnée, la masquer en `"OTHER"` perdrait un signal de schéma potentiellement significatif.

**Impact** : `head-coach-engine/src/supabase/mapping/dailyCheckinRow.ts`, `head-coach-engine/src/supabase/mapping/raceCalendarRow.ts`, `head-coach-engine/src/supabase/buildRawContext.ts`, tests associés. Aucun impact sur `head-coach-engine/src/{types,engine,rules,domains,mapping}` (frozen, non modifiés).

**Statut** : active

---

## 2026-08-16 — M2 : clôture locale — Supabase persistence + integration = DONE (local)

**Contexte** : passe d'audit/clôture final du milestone M2 (baseline V0.2 + `M2_001` à `M2_006` + adapter read/write). Objectif : vérifier factuellement, pas réimplémenter, que M2 satisfait ses critères de sortie canoniques (`docs/00_PROJECT_STATUS.md`, `docs/10_TEST_PLAN.md` §Critères d'acceptation M2) avant toute review Louis / déploiement remote.

**Constats factuels de l'audit** :

- **Migrations** : `baseline_v0_2.sql`, `M2_001` à `M2_006` rejouent sans erreur sur `supabase db reset --local --no-seed`, dans l'ordre canonique, aucune `M2_007`. Chaque fichier de migration a exactement **un seul commit** dans son historique Git (celui de sa création) — aucune modification postérieure.
- **M1 strictement intact** : `git diff --stat` entre le commit d'implémentation M1 (`eab2072`) et `HEAD` sur `head-coach-engine/src/{types,engine,rules,domains,mapping}` est **vide**. 75/75 tests M1 toujours verts, isolément vérifiés (`tests/*.test.ts`, hors `tests/supabase/`).
- **Read path** (`buildRawContext`/`computeDailyFor`) : zéro écriture confirmée par test d'intégration réel (comptage avant/après sur `decisions`/`health_flags`/`planned_sessions`/`completed_sessions`/`daily_checkins`) et par audit statique (aucun `.insert`/`.update`/`.delete`/`.upsert`, aucun import de `persistDailyRun`/`runDailyFor`).
- **Write path** (`runDailyFor`/`persistDailyRun`) : `computeDailyFor` appelé exactement une fois, `persist_daily_run` invoqué exactement une fois par run (un seul appel `client.rpc`, aucun `.insert`/`.update`/`.delete` applicatif reproduisant la transaction côté TypeScript).
- **Cycle longitudinal A1→A5→résolution** prouvé avec le vrai moteur M1, le vrai `buildRawContext`, le vrai `computeDailyFor`, le vrai `runDailyFor`, la vraie RPC `persist_daily_run`, sur la vraie DB locale — aucun mock sur cette chaîne (vérifié : aucune occurrence de `vi.fn`/mock dans les fichiers de test correspondants). Idempotence A1 répétée prouvée de la même façon : même `health_flag_id` réutilisé, decisions distinctes, jamais de doublon de flag ouvert.
- **Atomicité côté TypeScript** prouvée sans contourner `persistDailyRun` : payload santé valide + `decisionRow` volontairement invalide → RPC échoue, aucune trace en base (ni flag, ni decision).
- **Équivalence fixture M1 ↔ Supabase** : démontrée par égalité structurelle stricte (`toEqual`) sur **19 scénarios canoniques réels** de `head-coach-engine/src/cli/runExample.ts` (`t1-grip-red`, `t1-legs-red`, `t1-mental-red`, `t1-sleep-deficit`, `t3-concussion`, `t3-pain-non-safety`, `t3-pain-safety-traumatic`, `t4-tx-respected`, `t4-tx-vs-planned`, `t5-race-in-progress`, `t5-post-event`, `t6-fallback`, `t7-keep`, `t10-overlapping-races`, `t10-plausible-not-contradiction`, `soft-constraint-applied`, `soft-constraint-overridden`, `a5-dh-planned`, `a5-non-dh-planned`). Aucun scénario canonique n'a été trouvé irreprésentable depuis le schéma M2 actuel.
- **Correctif d'infrastructure de test découvert pendant l'audit** : `tests/supabase/testDb.ts` utilisait un checkin neutre (`NEUTRAL_CHECKIN`) dont les valeurs par défaut différaient numériquement de `fixtures/louis.ts` `baseCheckin()` (ex. `sleep_hours` 7.5 vs 8). Les deux jeux de valeurs retombaient par coïncidence dans la même bande de classification (`PROVISIONAL_THRESHOLDS`), ce qui masquait le risque plutôt que l'éliminer. Aligné pour être numériquement identique à `baseCheckin()` — fichier de test uniquement, aucun impact sur `src/` ni sur M1.
- **Confidence qualitative uniquement** : aucune occurrence de mapping `LOW/MEDIUM/HIGH → nombre` dans `src/supabase/` (vérifié par grep) ; `decisions.confidence` (legacy numeric) n'est jamais écrit par le DAL M2.
- **Secrets** : `git grep "sb_secret_"` ne retourne aucune occurrence. `git grep "service_role"` ne retourne que des noms de rôle/grants SQL et de la prose documentaire — aucune clé littérale versionnée.
- **`decisions` append-only / current decision** : prouvé par les tests d'idempotence et le cycle longitudinal (plusieurs decisions par jour/par athlète, jamais d'écrasement). Convention `ORDER BY created_at DESC LIMIT 1` documentée dans `docs/05_DATA_MODEL.md` §decisions. **Aucun code M2 actuel ne lit la "decision courante"** (aucune requête sur `decisions` dans `src/` — vérifié par grep) : aucun repository n'a été créé pour cette lecture, conformément au principe "ne pas construire pour un besoin théorique".

**Décision** : **M2 Supabase persistence + integration = DONE (local)**. Résumé : baseline locale capturée + `M2_001` → `M2_006` appliquées et inchangées depuis leurs commits respectifs ; read path (`computeDailyFor`) et write path (`runDailyFor`) implémentés, testés unitairement et en intégration réelle contre la stack Supabase locale ; RPC `persist_daily_run` atomique et sécurisée (`SECURITY INVOKER`, `service_role` uniquement) ; cycle longitudinal A1→A5 et idempotence health flag prouvés avec la chaîne complète réelle ; équivalence fixture ↔ Supabase démontrée sur 19 scénarios canoniques.

**Important — portée de cette clôture** : **M2 DONE signifie DONE localement, pas déployé.** Le déploiement Supabase distant (`supabase migration repair` puis premier `supabase db push` vers la DB Louis) reste une **opération séparée, non effectuée**, explicitement conditionnée à une review Louis préalable (voir `docs/00_PROJECT_STATUS.md` critères de sortie M2). CLI `compute:daily`/`run:daily`, résolution applicative des health flags, et toute nouvelle table/colonne/RPC restent hors scope de cette clôture.

**Alternatives considérées** :
- Créer `athletesRepo`, `trainingBlocksRepo.getCurrentBlock` (complet), `weeklyAvailabilityRepo` pour satisfaire littéralement l'inventaire de repositories initialement esquissé dans `docs/12_BACKLOG.md` — rejeté : aucun n'est consommé par le moteur M1 (vérifié par grep exhaustif sur `src/{engine,rules,domains}`), les construire aurait été du code mort maintenu pour rien.
- Mettre à jour `docs/00_PROJECT_STATUS.md` dans cette même passe — rejeté : cette clôture ne modifie que les fichiers de suivi explicitement dans son mandat (`11_DECISION_LOG.md`, `12_BACKLOG.md`) ; `00_PROJECT_STATUS.md` reste à mettre à jour séparément (ses critères de sortie mentionnent aussi la review Louis et le déploiement remote, non encore effectués).

**Impact** : `docs/12_BACKLOG.md` (checklist M2 mise à jour). Aucun impact sur `docs/05_DATA_MODEL.md`, `docs/06_ARCHITECTURE.md`, `docs/00_PROJECT_STATUS.md` (non modifiés dans cette passe), ni sur `head-coach-engine/src/{types,engine,rules,domains,mapping}`.

**Statut** : active

---

## 2026-08-17 — Déploiement remote M2

**Contexte** : M2 étant DONE localement (clôture 2026-08-16) et l'architecture ayant reçu l'approbation de Claude Project pour le déploiement remote, la baseline V0.2 et les migrations `M2_001`→`M2_006` ont été déployées sur le projet Supabase distant `uvolpldwwyvadlamulvr` ("LOUIS PERFORMANCE SYSTEM", eu-central-1/Frankfurt), suivant strictement la procédure déjà documentée (`docs/06_ARCHITECTURE.md` §Baseline read-only, `docs/05_DATA_MODEL.md` §Déploiement remote).

**Décision / constats** :

- **Preflight strictement read-only** effectué avant tout déploiement : `supabase/preflight/m2_remote_preflight.sql` (uniquement des `SELECT`, versionné pour audit), exécuté via une connexion MCP confirmée serveur-enforced read-only (`transaction_read_only=on`, rôle `supabase_read_only_user`). Résultat : les 7 tables baseline présentes, aucun objet M2 prématurément présent, 0 doublon open `health_flags`, `decisions.confidence` toujours `numeric(3,2)` intact.
- **Remote schema = baseline** : `supabase db dump --linked --schema public` comparé à `supabase/migrations/20260814095000_baseline_v0_2.sql` — **identique caractère pour caractère** (`diff --strip-trailing-cr` exit 0 ; seule différence brute constatée avant normalisation : terminaisons de ligne CRLF/LF, non-sémantique). Aucun schema drift réel sur tables, colonnes, types/enums, contraintes, index, fonctions, triggers, RLS/policies.
- **Zéro duplicate open health_flags** confirmé avant et après déploiement (requête `GROUP BY athlete_id, flag_type HAVING count(*) > 1` → 0 ligne), condition nécessaire à l'application sans conflit de l'index unique partiel `health_flags_open_unique` (M2_005).
- **`migration repair` utilisé uniquement pour la baseline** `20260814095000` — marquée comme déjà appliquée dans l'historique de migrations remote **sans rejouer son SQL** (conformément à la décision du 2026-08-14 : la baseline capture un état déjà existant sur `uvolpldwwyvadlamulvr`, la rejouer aurait tenté de recréer des objets déjà présents).
- **`db push` utilisé uniquement pour `M2_001`→`M2_006`** — ces 6 migrations, elles, exécutent réellement leur SQL additif contre le schéma remote.
- **Post-deploy audit PASS**, strictement read-only, exécuté après déploiement :
  - `migration list --linked` : les 7 timestamps LOCAL alignés avec REMOTE, aucun écart.
  - `db push --linked --dry-run` → `"Remote database is up to date."`
  - M2_001 à M2_006 vérifiés individuellement (colonnes, enum `confidence_level` = exactement `LOW`/`MEDIUM`/`HIGH`, index `health_flags_open_unique` avec le predicate exact, fonction `persist_daily_run` inspectée via `pg_get_functiondef` — corps **identique** au fichier de migration local, `SECURITY INVOKER` confirmé (`prosecdef=false`), `search_path=public`, ACL `{postgres=X,service_role=X}` sans `PUBLIC`/`anon`/`authenticated`).
  - Données préexistantes (`athletes`, `goals`, `training_blocks`, `race_calendar`, `athlete_baselines`, `weekly_availability`) : comptages identiques avant/après déploiement — aucune perte.
- **Aucune `M2_007`** : exactement les 7 fichiers de migration prévus, aucun ajout.

**Impact** : `docs/00_PROJECT_STATUS.md` (statut M2 DONE local + remote), `docs/12_BACKLOG.md` (cases Review Louis / migration repair / premier db push cochées). Aucune modification de `supabase/migrations/`, aucune modification de `head-coach-engine/src/{types,engine,rules,domains,mapping}`, aucune écriture métier sur le remote (seules les migrations DDL M2_001→M2_006 ont écrit du schéma ; aucune donnée métier insérée/modifiée/supprimée par ce déploiement).

**Statut** : active

---

## 2026-08-17 — M3_001 : frontière de build prouvée pour l'Edge Runtime (source TS incompatible, `dist/*.js` compilé compatible)

**Contexte** : M3 doit exposer `runDailyFor` (M2) via une Edge Function Supabase (Deno). Tout le code M1/M2 utilise la convention TypeScript `NodeNext` : imports relatifs suffixés `.js` pointant vers des fichiers source `.ts` (résolus par Node au moment du build, jamais littéralement). Il fallait déterminer expérimentalement, sans supposer, si Deno peut consommer directement cette source ou nécessite un artefact compilé.

**Constats factuels (spike local, `supabase functions serve`, sans aucun déploiement remote)** :

- **Import direct de la source TypeScript** (`head-coach-engine/src/supabase/runDailyFor.ts`) → **échec reproductible**. Deno résout chaque import relatif `.js` **littéralement** : il cherche un fichier réellement nommé `x.js` et échoue (`failed to read file: open .../persistDailyRun.js: no such file or directory`) dès le premier import interne du graphe, pas seulement au point d'entrée. Ce n'est pas un bug M1/M2 — c'est la preuve attendue de l'incompatibilité de la convention `.js`-suffixe-vers-`.ts` avec la résolution Deno.
- **Import du JavaScript compilé** (`head-coach-engine/dist/supabase/runDailyFor.js`, produit par `npm run build` = `tsc -p tsconfig.build.json`) → **fonctionne proprement** dans `supabase functions serve` local (Deno v2.1.4 / edge-runtime 1.74.3). Le graphe transitif complet (engine/rules/domains/types/mapping/repositories compilés) charge sans erreur, sans aucune duplication de code, sans copie du moteur dans `supabase/functions/`.
- **`head-coach-engine/src/{types,engine,rules,domains,mapping}` (M1, frozen) et `head-coach-engine/src/supabase/` (M2) strictement non modifiés** par ce spike.
- **`dist/` reste gitignored, non versionné, généré à la demande** (`npm run build`) — jamais commité.
- **`--unstable-sloppy-imports`** évalué explicitement comme option de contournement et **rejeté** comme solution production (autorisé seulement en diagnostic, jamais retenu).

**Décision** : la frontière de build retenue est `npm run build → head-coach-engine/dist/*.js → import Deno`. L'Edge Function importe exclusivement le JavaScript compilé, jamais la source `.ts` de `src/`.

**Important — ce qui n'a PAS été prouvé par M3_001** : aucun déploiement remote n'a eu lieu. `supabase functions deploy --use-api` (packaging remote de `dist/` hors du dossier `supabase/functions/`, `dist/` étant gitignored) **n'a jamais été exécuté**. Le portability spike ne couvre que `supabase functions serve` **local**. Le packaging remote reste **pending first canary** — voir `docs/00_PROJECT_STATUS.md` et `docs/12_BACKLOG.md`.

**Impact** : architecture de `supabase/functions/daily-run/` (M3_002, M3_003). Aucun impact sur `docs/05_DATA_MODEL.md`, aucune migration.

**Statut** : active

---

## 2026-08-17 — M3_002 : boundary d'authentification — JWT utilisateur → RLS → athlete propre

**Contexte** : `supabase/functions/daily-run` doit résoudre l'athlete du seul utilisateur authentifié, jamais un `athlete_id` fourni par le client, avant de brancher le moteur (M3_003).

**Décision** : chaîne d'authentification et de résolution, via `@supabase/server@1.4.1` (`withSupabase({ auth: "user" })`) :

1. `Authorization: Bearer <JWT utilisateur>` → vérifié par `@supabase/server` (JWKS local, gateway `verify_jwt` par défaut à `true`, aucune modification de `supabase/config.toml` nécessaire).
2. `ctx.supabase` (client scopé RLS, jamais `ctx.supabaseAdmin` à ce stade) → `SELECT id FROM athletes` sans filtre client → la policy `athletes_own_data` (`USING/WITH CHECK (user_id = auth.uid())`, seule policy sur `athletes`, `athletes.user_id UNIQUE`) garantit qu'au plus une ligne — celle de l'utilisateur — est jamais visible.
3. `ctx.supabaseAdmin` (client privilégié) est disponible dans le contexte mais **volontairement pas utilisé** pour la résolution de l'athlete en M3_002 — réservé au futur moteur (branché en M3_003).

**Contrat request/erreurs stub (M3_002)** : body strict `{ "date": "YYYY-MM-DD" }`, toute propriété inconnue (`athlete_id`, `athleteId`, `user_id`, `userId`, ou autre) → `400 invalid_request`, jamais transmise ni utilisée. `0` athlete → `403 no_athlete_for_user`. `>1` athlete (défensif, normalement inatteignable vu `UNIQUE`) → `500 internal_error` plutôt qu'un choix arbitraire. Méthode ≠ `POST` → `405 method_not_allowed` + header `Allow: POST`.

**Tests prouvés (local, JWT scratch réels, DB locale, aucun mock sur le chemin critique)** :
- JWT absent/invalide → `401` (géré par la couche auth, avant le handler).
- Aucun athlete pour l'utilisateur → `403 no_athlete_for_user`.
- Injection `athlete_id`/`athleteId`/`user_id`/`userId` dans le body → `400 invalid_request`, jamais `200`.
- Isolation RLS croisée prouvée : avec le JWT d'un utilisateur A, seul l'athlete A est visible via le même client RLS que celui utilisé par la fonction ; l'athlete B est invisible.
- Zéro écriture métier (`decisions`, `health_flags`, `completed_sessions`, `planned_sessions`, `daily_checkins` inchangés avant/après).

**Impact** : `supabase/functions/daily-run/index.ts` (créé). Aucune migration, aucun impact M1/M2.

**Statut** : active

---

## 2026-08-17 — M3_003 : branchement réel de `runDailyFor` + mapping d'erreurs HTTP

**Contexte** : après M3_002 (boundary d'auth prouvée) et M3_001 (frontière de build prouvée), brancher réellement le moteur M2 sur l'Edge Function, sans dupliquer ni modifier M1/M2.

**Décision** : après résolution de l'athlete via `ctx.supabase`/RLS (M3_002, inchangé), l'appel devient :

```
ctx.supabaseAdmin → runDailyFor(ctx.supabaseAdmin, athlete.id, date) — appelé une fois par requête réussie
```

`athlete.id` provient exclusivement de la ligne résolue par `ctx.supabase` (RLS) — jamais de `body`/`query`/header client. Import via `head-coach-engine/dist/supabase/runDailyFor.js` (frontière prouvée en M3_001), jamais la source `.ts`, jamais `head-coach-engine/src/supabase/client.ts`.

**Réponse HTTP 200** — mapping exact depuis `RunDailyForResult` (noter la correction factuelle par rapport à une hypothèse initiale erronée : `persistence` expose `decision_id`/`health_flag_id` en snake_case, pas camelCase) :

```json
{ "dailyPlan": <DailyPlan M1 exact>, "decisionId": <persistence.decision_id>, "healthFlagId": <persistence.health_flag_id>, "warnings": <warnings[]> }
```

Jamais renvoyé : `rawContext`, `athleteId`, `userId`, JWT, secrets, rows DB internes.

**Mapping d'erreurs** (`supabase/functions/daily-run/errorMapping.ts`, aucune logique métier/M1/persistance) :

| Erreur (classe réelle) | HTTP | code |
|---|---|---|
| `NoCurrentCheckinError` | 422 | `no_checkin_for_date` |
| `NoCurrentTrainingBlockError` | 422 | `no_current_training_block` |
| `IncompleteCheckinPainCriteriaError` | 422 | `pain_criteria_missing` |
| `IncompleteDailyCheckinError` | 422 | `checkin_incomplete` |
| `PersistDailyRunRpcError` | 500 | `persistence_failed` |
| `InvalidPersistDailyRunResultError`, `DailyPlanDateMismatchError`, toute autre erreur/invariant cassé (`InvalidHealthFlagRowError`, `InvalidRaceCalendarRowError`, `InvalidCompletedSessionRowError`, `InvalidTrainingInterventionJsonError`, `InvalidTrainingModeError`, `MissingSupabaseServerConfigError`, imprévu) | 500 | `internal_error` |

Jamais renvoyé en HTTP : message d'erreur brut, SQL, stack trace, nom de colonne, payload Supabase interne. Logs serveur : nom de classe + code uniquement, jamais JWT/secret.

**Tests prouvés (local, vrai moteur M1, vraie DB, vraie RPC `persist_daily_run`, aucun mock sur le chemin succès critique)** : run neutre réel (200, `daily_plan` DB == réponse HTTP, `confidence` legacy NULL, `confidence_level` renseigné), SAFETY A1 réel (`healthFlagId` = vraie row ouverte), appels répétés (decisions distinctes, append-only, même flag ouvert réutilisé), les 4 mappings 422 provoqués avec de vraies fixtures DB, isolation cross-user (JWT A ne consomme jamais les données de B), injection `athlete_id` → 400, audit d'écriture (`decisions`/`health_flags` seuls modifiés). Suites : `npm test` = 226/226 (dont 75/75 M1), `npm run test:edge` = 9/9 (mapping d'erreurs, unitaire, isolé de `dist/` via config vitest dédiée), `npm run test:m3:http` = 26/26, répété deux fois avec succès (stabilité prouvée, y compris nettoyage complet des fixtures scratch).

**Aucune migration DB. Aucun changement M1. Aucun changement M2** (`head-coach-engine/src/{types,engine,rules,domains,mapping,supabase}` strictement non modifiés).

**Important — portée non couverte par M3_003** : aucun déploiement remote, aucun test du packaging `supabase functions deploy --use-api`. Voir l'entrée M3_001 ci-dessus.

**Impact** : `supabase/functions/daily-run/index.ts`, `errorMapping.ts` (modifiés/créés), `head-coach-engine/tests/edge/` (nouveaux tests dédiés), `head-coach-engine/package.json` (`test:edge`, `test:m3:http`), `head-coach-engine/vitest.config.ts`/`vitest.edge.config.ts` (nouveaux). Aucun impact sur `docs/05_DATA_MODEL.md`, `docs/06_ARCHITECTURE.md` (diff proposé séparément, non encore appliqué).

**Statut** : active
