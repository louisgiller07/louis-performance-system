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

---

## 2026-08-18 — M3_005 : canary de packaging remote `--use-api` — external `dist` graph prouvé

**Contexte** : M3_001 avait prouvé la frontière de build `npm run build → head-coach-engine/dist/*.js` uniquement en local (`supabase functions serve`). Le packaging remote (comment `supabase functions deploy` embarque un import externe pointant hors de `supabase/functions/`, vers un dossier gitignored) n'avait jamais été testé. Avant tout déploiement réel de `daily-run`, une fonction canary jetable a été déployée pour isoler ce risque.

**Constats factuels (projet `uvolpldwwyvadlamulvr`, canary temporaire, jamais commitée)** :

- `supabase/functions/daily-run-canary/index.ts` : importe uniquement `head-coach-engine/dist/supabase/runDailyFor.js`, **n'appelle jamais `runDailyFor`** (seulement `typeof runDailyFor === "function"`), aucun client Supabase, aucun accès DB, aucun secret.
- `npx supabase functions deploy daily-run-canary --use-api --no-verify-jwt --project-ref uvolpldwwyvadlamulvr` : le CLI a **automatiquement découvert et uploadé tout le graphe transitif compilé** (~40 fichiers : `runDailyFor.js`, `computeDailyFor.js`, `persistDailyRun.js`, tout `engine/`, `rules/`, `domains/`, `types/`, `mapping/`, `repositories/`), en plus des fichiers de la fonction elle-même — sans copie manuelle, sans modification de `supabase/functions/`.
- Invocation remote (`POST https://uvolpldwwyvadlamulvr.supabase.co/functions/v1/daily-run-canary`) → **HTTP 200**, `{"ok":true,"runDailyForLoaded":true}` — le runtime Deno distant a réellement chargé et résolu le module compilé.
- **`--no-verify-jwt` utilisé uniquement pour cette canary temporaire** (aucune donnée, aucun secret, aucun accès DB, réponse statique sur chargement de module) — jamais retenu comme configuration pour `daily-run`.
- Canary supprimée immédiatement après le test : `supabase functions delete daily-run-canary --project-ref uvolpldwwyvadlamulvr`, confirmé absente (`404 NOT_FOUND` en réinvoquant), fichier local supprimé, jamais commitée.

**Décision** : le packaging remote `--use-api` est validé pour l'import externe `head-coach-engine/dist/**` — aucune modification d'architecture nécessaire. Ouvre la voie au déploiement réel de `daily-run` (voir entrée M3_006 ci-dessous).

**Impact** : aucun fichier versionné modifié par cette entrée elle-même (canary jetable, jamais commitée). Aucune migration, aucun changement M1/M2.

**Statut** : active

---

## 2026-08-18 — M3_006 : premier déploiement remote réel de `daily-run` — run authentifié complet prouvé

**Contexte** : après M3_005 (packaging remote prouvé via canary), déploiement réel de la fonction `daily-run` (celle utilisée en local depuis M3_002/M3_003) sur `uvolpldwwyvadlamulvr`, avec un run utilisateur authentifié complet, de bout en bout, sur la vraie infrastructure remote.

**Déploiement** : `npx supabase functions deploy daily-run --use-api --project-ref uvolpldwwyvadlamulvr` (sans `--no-verify-jwt` — `daily-run` garde la vérification JWT par défaut du gateway). Fonction confirmée `ACTIVE`, `verify_jwt: true` via `supabase functions list`.

**Chaîne prouvée réellement remote** : `Authorization: Bearer <JWT>` → gateway (`verify_jwt=true`) → `withSupabase({auth:"user"})` → `ctx.supabase`/RLS `athletes_own_data` → athlete propre → `ctx.supabaseAdmin` → `runDailyFor(admin, athlete.id, date)` → RPC `persist_daily_run`.

**Preuves empiriques (un seul athlete/user scratch créé, jamais un vrai compte Louis)** :

- Sans `Authorization` → `401`. JWT invalide → `401`. Aucune requête n'atteint le handler.
- User scratch réel créé (`auth.admin.createUser` + `signInWithPassword`), JWT réel obtenu.
- Avant tout checkin : `{"date":"2026-08-18"}` avec le JWT réel → `422 no_checkin_for_date`, **zéro** `decisions`/`health_flags` créés pour l'athlete scratch (vérifié par requête DB directe).
- Après insertion d'un seul checkin neutre complet (`pain=false`, les trois critères douleur `false`, `suspected_concussion=false`, `fever_or_illness=false`, tous les scalaires requis renseignés) : même appel → **`200`**, `dailyPlan` réel présent, `decisionId` UUID, `healthFlagId=null`, `warnings` array.
- Vérifié côté DB (client admin) : **exactement 1** `decisions` row pour l'athlete scratch, `id` == `decisionId` HTTP, `athlete_id` == athlete scratch, `daily_plan` **deep-equal** au `dailyPlan` HTTP, `confidence` (legacy) `NULL`, `confidence_level` renseigné (`MEDIUM`), `health_flags` = 0.
- Réponse de succès vérifiée sans fuite : aucune occurrence de `rawContext`, `athleteId`, `userId`, `Authorization`, du JWT, ni d'aucune clé API dans le corps de la réponse.
- **Un seul run de succès effectué** (pas de deuxième run redondant sur le remote, conformément à la consigne de minimiser les écritures réelles).

**Gestion des clés remote** : les clés nouveau format `sb_publishable_*`/`sb_secret_*` (préférence initiale) étaient listées par `supabase projects api-keys` mais **rejetées** par ce projet (`Invalid API key` sur PostgREST et l'API Auth Admin — pas encore activées côté gateway pour ce projet). **Fallback vers les clés legacy `anon`/`service_role`** utilisé pour le harnais temporaire — comme prévu et documenté à l'avance. Clés lues depuis un fichier temporaire local, jamais affichées, jamais commitées, jamais loguées ; fichier et harnais (`.m3006-remote-smoke.mjs`) supprimés immédiatement après usage.

**Cleanup remote** : `decisions`, `health_flags` (aucun créé), `daily_checkins`, `training_blocks`, `athletes` (scratch), `auth.users` (scratch) tous supprimés individuellement puis vérifiés absents par requête directe. Aucune donnée réelle de Louis consultée, modifiée ou énumérée (toutes les requêtes de vérification étaient scopées par `athlete_id`/`user_id` scratch spécifiques, jamais de requête large).

**Décision** : **M3 remote validation complete.** `daily-run` reste déployée sur `uvolpldwwyvadlamulvr` (aucune raison de la supprimer — tous les tests sont passés). M3 est considéré **DONE local + remote**.

**Impact** : aucun fichier versionné modifié par le run lui-même. Voir `docs/00_PROJECT_STATUS.md` et `docs/12_BACKLOG.md` pour la clôture M3.

**Statut** : active

---

## 2026-08-19 — SECURITY FIX : `decisions` rendue réellement append-only (RLS + grants)

**Contexte** : pendant l'audit sécurité pré-commit de M4_006 (`/history`, lecture seule côté frontend), inspection des catalogues PostgreSQL réels de `public.decisions` (policy `decisions_own_data` du baseline, `CREATE POLICY ... USING (...) WITH CHECK (...)` sans clause `FOR`) a révélé qu'elle est traitée par PostgreSQL comme `FOR ALL`, combinée au `GRANT ALL ON TABLE decisions TO anon, authenticated` du baseline (jamais restreint depuis).

**Risque** : un utilisateur `authenticated` pouvait — via son propre client Supabase RLS-scopé, donc y compris **depuis le frontend M4_006 lui-même si un bug l'y avait un jour poussé** — insérer, modifier ou supprimer directement ses propres lignes `decisions`, contournant entièrement `persist_daily_run` (seul chemin d'écriture légitime, `SECURITY INVOKER`, `EXECUTE` réservé à `service_role`). Ceci violait l'invariant append-only : l'historique de coaching (`/history`, M4_006) n'était pas réellement immuable.

**Preuve empirique locale (stack Docker locale, fixtures scratch uniquement, jamais remote)** avant fix : `SET ROLE authenticated` + JWT `sub` d'un athlete scratch → `INSERT`, `UPDATE`, `DELETE` directs sur `decisions` **tous réussis** (RLS `WITH CHECK` satisfaite par l'ownership réelle). Fixtures scratch nettoyées immédiatement après (0 ligne restante vérifié).

**Décision** :
1. `decisions_own_data` (`FOR ALL`) supprimée, remplacée par `decisions_own_select` — `FOR SELECT TO authenticated` uniquement, avec **exactement la même expression d'ownership** que le baseline (`athlete_id` appartient à un `athletes` dont `user_id = auth.uid()`), non réinventée.
2. `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.decisions FROM authenticated` (ne conserve que `SELECT`, least privilege).
3. `REVOKE ALL PRIVILEGES ON public.decisions FROM anon` (aucun accès direct, aucune policy ne le ciblait de toute façon).
4. `persist_daily_run` **non modifiée** — reste l'unique chemin d'écriture (`SECURITY INVOKER`, `EXECUTE` refusé à `anon`/`authenticated`, autorisé à `service_role` uniquement).

**Migration** : `supabase/migrations/20260819200000_decisions_append_only_security.sql` (additive, ne touche aucune colonne/table, uniquement policy + grants).

**Preuve empirique locale post-fix** (stack Docker fraîche, `supabase db reset`, deux athlètes scratch A/B) : `authenticated` (athlete A) `SELECT` de sa propre décision → 1 ligne ; `authenticated` (athlete B) `SELECT` des décisions de l'athlete A → 0 ligne (RLS cross-athlete confirmée) ; `INSERT`/`UPDATE`/`DELETE` directs (athlete A, sur sa propre ligne) → **`ERROR: permission denied for table decisions`** dans les trois cas (échec au niveau `GRANT`, avant même l'évaluation RLS — pas un simple rejet de contrainte). Appel réel de `persist_daily_run` sous `service_role` → succès, ligne persistée et vérifiée en base, puis nettoyée. Toutes les fixtures scratch (2 users, 2 athletes, 2 decisions dont celle créée par le RPC) supprimées, 0 ligne restante vérifié.

**Preuve empirique remote (`uvolpldwwyvadlamulvr` uniquement — jamais `evynmzyjhobdpmxdiwsy`)** : état pré-migration vérifié identique au baseline vulnérable attendu (`decisions_own_data`/`FOR ALL`, `authenticated`/`anon` avec `INSERT`/`UPDATE`/`DELETE`/`SELECT`, `persist_daily_run` déjà correctement restreinte à `service_role`) — aucune dérive de schéma. Migration appliquée via `supabase db push --linked --project-ref uvolpldwwyvadlamulvr` (dry-run préalable confirmant une seule migration en attente), confirmée appliquée exactement une fois (`supabase migration list` local == remote sur les 8 migrations). Post-migration, catalogues remote re-vérifiés en lecture seule : `decisions_own_select`/`SELECT` seule policy, `authenticated` = `SELECT` uniquement, `anon` = aucun privilège, `persist_daily_run` inchangée. **Aucun test destructif (INSERT/UPDATE/DELETE scratch) exécuté sur le remote** — la preuve remote repose uniquement sur les catalogues (`pg_policy`, `information_schema.role_table_grants`, `has_function_privilege`), la dénégation d'écriture ayant déjà été prouvée empiriquement en local.

**Régression future** : `supabase/preflight/decisions_append_only_security_check.sql` (nouveau, lecture seule, suit le pattern `m2_remote_preflight.sql`) — sections A-C doivent rester vides ; vérifié vide en local et en remote après application.

**Impact** : `supabase/migrations/20260819200000_decisions_append_only_security.sql`, `supabase/preflight/decisions_append_only_security_check.sql`. Aucun changement `head-coach-engine/**`, aucun changement de colonne/table, aucun impact sur `docs/05_DATA_MODEL.md`. Le frontend M4_006 (`web/src/features/history/**`) n'écrivait déjà jamais dans `decisions` (confirmé par grep avant et après ce fix) — ce correctif ferme un accès qui existait au niveau DB indépendamment du frontend, pas une régression introduite par lui.

**Statut** : active

---

## 2026-08-19 — M4_007 : déploiement production HTTPS (Vercel) + polish mobile — M4 COMPLETE

**Contexte** : après M4_001→M4_006 (client web fonctionnel en local, historique en lecture seule sécurisé), dernière étape M4 avant utilisation quotidienne réelle : ergonomie mobile, séparation stricte production/debug, et déploiement HTTPS accessible depuis le téléphone de Louis.

**Mobile polish** : corrections ciblées, aucune refonte de design system — cibles tactiles portées à ≥44px sur les contrôles les plus sollicités (`AppNav`, boutons `LoginPage`/`CheckinForm`, lien retour `HistoryDetailPage`), `text-base` explicite sur tous les champs de saisie (évite le zoom automatique iOS Safari au focus, déclenché par tout `<input>`/`<select>`/`<textarea>` sous 16px), piste de `RatingSlider` élargie, `aria-label` ajouté au `<textarea>` commentaire (seul contrôle sans label explicite trouvé). Séparation production/debug reconfirmée : `import.meta.env.DEV` élimine bien le panneau "Détails techniques"/JSON brut du bundle de production (grep sur le build réel).

**Déploiement Vercel** : projet dédié `louis-performance-system` créé dans le scope Vercel du même nom (`npx vercel link --scope louis-performance-system --project louis-performance-system`), root = `web/`, framework Vite auto-détecté, build `npm run build` → `dist`. Scope `graviacoach` (projet `gravia-coach`, `https://www.graviacoach.ch`) **jamais touché** — vérifié avant et après (`vercel project ls --scope graviacoach` inchangé). `web/vercel.json` créé avec le rewrite SPA catch-all officiel (`{"source": "/(.*)", "destination": "/index.html"}`, syntaxe vérifiée contre la documentation Vercel actuelle) — permet le refresh direct de `/today`, `/history`, `/history/:id` sans 404. `.vercel/` ajouté à `web/.gitignore` avant tout link.

**Variables d'environnement** : uniquement `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` (noms réels lus dans `src/lib/supabase.ts`), configurées pour Preview et Production via stdin (`vercel env add ... < valeur`, jamais affichées), confirmées par `vercel env ls` (noms uniquement). Aucune variable `service_role`/secret/JWT/mot de passe DB.

**Déploiement** : le tout premier déploiement d'un projet Vercel est automatiquement assigné à `production` par la plateforme, quel que soit le flag (`npx vercel deploy` sans `--prod` a été aliasé à `https://louis-performance-system.vercel.app` avec `target: production`) — comportement de plateforme, pas un choix. Vérifié aussi rigoureusement qu'un preview avant validation : `/`, `/login`, `/today`, `/history`, `/history/<id réel>` → `200`, shell SPA présent, zéro 404 Vercel (curl direct + Playwright réel pour les redirections côté client `/today`→`/login` sans session). Bundle de production réellement servi grepé : `evynmzyjhobdpmxdiwsy` = 0 occurrence, `uvolpldwwyvadlamulvr` = 1 (attendu), `service_role` = 0, `sb_secret_` = 1 (classificateur interne `@supabase/supabase-js`, pas une valeur secrète).

**Supabase Auth** : Site URL du projet `uvolpldwwyvadlamulvr` mise à jour manuellement par Louis (Dashboard) vers `https://louis-performance-system.vercel.app`, conformément aux étapes fournies — `supabase config push` délibérément **non exécuté** (aurait synchronisé tout `config.toml`, dont `[auth].site_url` local `http://127.0.0.1:3000`, vers le projet remote sans portée réduite possible).

**Smoke réel** : Louis a testé l'URL de production sur son téléphone réel — login, `/today`, check-in, `/history`, détail d'une décision, refresh direct sur route profonde, navigation mobile portrait, logout/relogin. **Tous PASS.**

**Décision** : **M4 est COMPLETE.** Premier client de production réellement utilisable au quotidien.

**Validation finale** : `npm test` = 163/163, `npm run build` = PASS, `git diff --check` = PASS.

**Impact** : `web/**` (polish mobile, `web/vercel.json`, `web/.gitignore`), `docs/00_PROJECT_STATUS.md`, `docs/12_BACKLOG.md`. Aucun changement `head-coach-engine/**`, aucune migration DB dans cette entrée (le correctif DB fait l'objet de l'entrée M4_006 ci-dessus).

**Statut** : active

---

## 2026-08-19 — M5_001A : chemin d'écriture contrôlé pour `completed_sessions` (DÉPLOYÉ, `uvolpldwwyvadlamulvr`)

**Contexte** : suite à l'audit M5_001 (2026-08-19, même journée), `completed_sessions` présentait exactement la même faille que `decisions` avant M4_006 : policy `completed_sessions_own_data` (`FOR ALL`, sans clause `FOR`) + `GRANT ALL ... TO anon/authenticated` du baseline → un `authenticated` pouvait écrire directement ses propres lignes. Contrairement à `decisions` (append-only), `completed_sessions` est intentionnellement UPSERT-shaped (`UNIQUE (athlete_id, session_date)`, préservée, non modifiée) : l'architecture cible est `browser JWT → future Edge Function M5_003 → athlete propre résolu via RLS → client service_role → RPC persist_completed_session → UPSERT`.

**Implémenté (local uniquement, jamais poussé remote)** :
- `supabase/migrations/20260819210000_persist_completed_session_rpc.sql` — nouvelle fonction `public.persist_completed_session(p_athlete_id uuid, p_row jsonb) RETURNS jsonb`, `SECURITY INVOKER`, `EXECUTE` réservé à `service_role` (`anon`/`authenticated` explicitement `REVOKE`). `UPSERT` sur `(athlete_id, session_date)` (contrainte existante, non touchée). `p_athlete_id` est l'unique source de vérité d'ownership. `session_load` n'est jamais lu ni écrit explicitement — reste exclusivement dérivé par le trigger existant `trg_compute_session_load`. Si `decision_id` est non-null, validation DB-side inline dans la RPC : la decision doit appartenir au même athlete ET sa `decision_date` doit être strictement égale au `session_date` fourni — sinon exception. `submitted_at` n'est jamais réécrit sur un upsert ultérieur ; `updated_at` reste auto-maintenue par `trg_completed_sessions_updated_at`. `planned_session_id` reste hors périmètre du contrat (clé interdite) — sur un premier appel elle prend son défaut colonne (`NULL`), sur un upsert ultérieur elle est préservée telle quelle (absente de la clause `SET`, comportement natif Postgres).
  **Contrat d'update : FULL REPLACEMENT STRICT, pas PATCH.** Ensemble canonique de clés fermé : `session_date`/`session_type`/`completion_status`/`new_pain` (requis, non-null) + `decision_id`/`actual_duration_min`/`rpe`/`main_content`/`intervention`/`free_notes`/`post_leg_fatigue`/`post_grip_fatigue`/`new_pain_note` (clé requise, valeur nullable). Toute clé absente du contrat → exception (jamais interprétée comme `NULL` ou "ne pas toucher"). Toute clé inconnue/typo → exception dédiée. Clés explicitement interdites, chacune avec un message dédié : `id`, `session_load`, `submitted_at`, `created_at`, `updated_at` (gérées par la DB), `athlete_id` (redondant avec `p_athlete_id`, source de confusion sans bénéfice), `planned_session_id` (hors périmètre). Réponse minimale et stable : `{"completed_session_id": "<uuid>"}` — pas de distinction `INSERT`/`UPDATE` exposée (retrait du `(xmax = 0)` initialement prévu, l'appelant n'en a pas besoin).
- `supabase/migrations/20260819211500_completed_sessions_upsert_only_security.sql` — remplace `completed_sessions_own_data` (`FOR ALL`) par `completed_sessions_own_select` (`FOR SELECT TO authenticated`, expression d'ownership réutilisée verbatim). `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` pour `authenticated` (conserve `SELECT`). `REVOKE ALL` pour `anon`. `service_role` **non touché**.
- `supabase/migrations/20260819213000_fix_compute_session_load_null_reset.sql` — **correction d'invariant** : `compute_session_load()` (baseline, non éditée — `CREATE OR REPLACE` additif) ne remettait jamais `session_load` à `NULL` quand `actual_duration_min` ou `rpe` redevenait `NULL` sur un `UPDATE`. Corrigé : recalcul dans les deux sens. Trigger existant non modifié.
- `supabase/preflight/completed_sessions_upsert_only_security_check.sql` — preflight lecture seule durci (suit le pattern `decisions_append_only_security_check.sql`) : RLS activée, policy `completed_sessions_own_select` exacte (nom + `FOR SELECT` + rôle `authenticated` via `polroles`, pas de string-matching sur l'expression `USING`), aucune autre policy (deux vérifications complémentaires : nom différent, ET count total = 1), `authenticated` a `SELECT` et rien d'autre, `anon` zéro privilège, `service_role` conserve `SELECT` sur `decisions` + `SELECT/INSERT/UPDATE` sur `completed_sessions`, signature exacte `persist_completed_session(uuid,jsonb)` via `to_regprocedure` (pas un simple filtre `proname`, pour qu'une future surcharge ne rende jamais le preflight ambigu), `SECURITY INVOKER`, `EXECUTE` refusé à `anon`/`authenticated`, accordé à `service_role`.

**Preuve empirique locale : EXÉCUTÉE, tout PASS.** Docker Desktop redevenu disponible (troisième tentative, RAM libre remontée à un niveau suffisant). Stack locale fraîche (`supabase start` + `supabase db reset`, les 3 migrations M5_001A appliquées avec succès). Preflight local : 15 sections, **toutes vides** (sain). Fixtures scratch : 2 athlètes (A, B), 3 decisions (A/2026-08-19, A/2026-08-18, B/2026-08-19).

Matrice complète (détail dans le rapport de tâche) : `authenticated` SELECT propre = 1 ligne ; cross-athlete = 0 ligne ; INSERT/UPDATE/DELETE directs = `permission denied for table completed_sessions` (échec au niveau `GRANT`, avant RLS) ; `anon` SELECT + `EXECUTE` RPC = refusés ; `authenticated` `EXECUTE` RPC = refusé. RPC via `service_role` : INSERT (payload canonique complet) = succès, `session_load` 60×8=48 correct ; UPSERT (même athlete/date, valeurs différentes) = même `completed_session_id`, **1 seule ligne** (confirmé par `GROUP BY athlete_id, session_date`), `session_load` recalculé à 30×6=18 ; `rpe=NULL` → `session_load=NULL` ; `duration=NULL` → `session_load=NULL` ; restauration 40×5=20. `planned_session_id` fixé manuellement puis préservé après un upsert RPC changeant d'autres champs — confirmé inchangé. Contrat strict : payload complet = succès ; clé canonique manquante (`decision_id` omis) = exception ; clé inconnue/typo (`decisionId`) = exception ; `session_load`/`id`/`created_at`/`athlete_id`/`planned_session_id` dans le payload = exception dédiée pour chacun. Liaison `decision_id` : valide (même athlete, même date) = succès ; decision d'un autre athlète = exception ; decision d'une autre date = exception ; decision inexistante = exception.

Nettoyage : suppression des 2 `auth.users` scratch (cascade → athletes/decisions/completed_sessions/planned_sessions), **0 ligne restante** vérifié sur les 5 tables concernées. Stack locale arrêtée.

**Régressions existantes (avec Docker)** : `head-coach-engine` — `npm test` (M1+M2, clé serveur locale via `supabase status -o env`) = **226/226** (dont 75/75 M1) ; `npm run test:edge` = **9/9** ; `npm run test:m3:http` = **26/26** (un premier run a montré 2 échecs isolés — `502` sur un cas puis un `fetch failed` transitoire sur la connexion Auth — confirmés être une instabilité passagère de la stack Docker fraîchement redémarrée, pas une régression : re-exécution immédiate → 26/26 propre, et aucun fichier `daily-run`/`head-coach-engine/src/**` n'a été modifié dans cette tranche). `web` = **163/163**.

**Déploiement remote (`uvolpldwwyvadlamulvr` exclusivement, jamais `evynmzyjhobdpmxdiwsy`)** : après validation locale complète, preflight remote AVANT écriture confirmant l'état vulnérable attendu (`completed_sessions_own_data`/`FOR ALL`, `authenticated`/`anon` avec grants d'écriture complets), et re-confirmation que `decisions_append_only_security_check.sql` restait sain sur remote (aucune dérive M4). Dry-run (`supabase db push --dry-run`) confirmant exactement les 3 migrations attendues, rien d'autre. Les 3 migrations appliquées via `supabase db push --linked --project-ref uvolpldwwyvadlamulvr` :
- `20260819210000_persist_completed_session_rpc.sql`
- `20260819211500_completed_sessions_upsert_only_security.sql`
- `20260819213000_fix_compute_session_load_null_reset.sql`

**Postflight remote (lecture seule, immédiatement après)** : les 15 sections du preflight `completed_sessions_upsert_only_security_check.sql` exécutées individuellement contre remote — **toutes vides** (RLS activée, policy `completed_sessions_own_select` exacte SELECT-only/rôle `authenticated`, aucune autre policy, `authenticated`=SELECT uniquement, `anon`=zéro privilège, `service_role` conserve `SELECT` sur `decisions` + `SELECT/INSERT/UPDATE` sur `completed_sessions`, RPC signature exacte `SECURITY INVOKER`, `anon`/`authenticated` EXECUTE refusés, `service_role` EXECUTE autorisé). Source de `compute_session_load()` récupérée sur remote (`pg_get_functiondef`) : la branche `else new.session_load := null` est confirmée présente. `decisions_append_only_security_check.sql` re-exécuté sur remote après ce déploiement — toujours sain, aucune dérive M4. `supabase migration list --linked` : les 11 migrations (baseline → M5_001A) sont désormais local == remote, aucune dérive.

**Contraintes notées pour les tranches M5 suivantes (non implémentées ici)** : `decision_outcomes` devra snapshotter/versionner les inputs du calculateur (les `daily_checkins` sont éditables) ; les FK source des futures preuves de pattern devraient préférer `ON DELETE RESTRICT`/`NO ACTION` plutôt que `CASCADE` ; la future persistance pattern + evidence + evidence_sources devra être atomique/idempotente ; les futures RPC de transition de revue humaine devront gérer concurrence/idempotence.

**Décision** : **M5_001A est COMPLETE et déployée sur `uvolpldwwyvadlamulvr`.** `completed_sessions` n'accepte plus d'écriture directe depuis le navigateur — `persist_completed_session` (service_role uniquement) est désormais l'unique chemin d'écriture légitime, en attendant la future Edge Function authentifiée (M5_003) qui l'invoquera. Ceci ne couvre que M5_001A — le reste de M5 (pattern tables, `decision_outcomes`, `longitudinal-engine`, Edge Function M5_003) reste non implémenté.

**Impact** : `supabase/migrations/20260819210000_persist_completed_session_rpc.sql`, `supabase/migrations/20260819211500_completed_sessions_upsert_only_security.sql`, `supabase/migrations/20260819213000_fix_compute_session_load_null_reset.sql`, `supabase/preflight/completed_sessions_upsert_only_security_check.sql`, cette entrée. Aucun changement `head-coach-engine/**`, `web/**`, `supabase/functions/**`.

**Statut** : active (M5_001A complet et déployé ; M5 dans son ensemble reste en cours)

---

## 2026-08-19 — M5_001B : fondation append-only `decision_outcomes` (DÉPLOYÉ, `uvolpldwwyvadlamulvr`)

**Contexte** : première brique du futur bouclage recommandation → séance réelle → réponse observée → issue auditable (voir l'audit M5_001). Cette tranche n'implémente **aucun calculateur** — uniquement le schéma append-only capable de stocker de futurs résultats déterministes, plus sa RPC de persistance.

**Pourquoi une nouvelle table plutôt que `decisions.reviewed_after_days`/`decisions.outcome_note`** : ces deux colonnes legacy existent toujours dans le schéma mais sont **explicitement non utilisées** par ce design. `decisions` est réellement append-only depuis M4_006 (authenticated = SELECT seul, `persist_daily_run` ne fait jamais d'UPDATE) ; les réutiliser exigerait un UPDATE sur une ligne existante, contredisant directement cet invariant. Une décision peut aussi avoir plusieurs observations dans le temps (J+1, J+3, J+7), ce qu'une paire de colonnes scalaires sur `decisions` ne peut pas représenter sans écrasement.

**Implémenté (local uniquement, jamais poussé remote)** :
- `supabase/migrations/20260819220000_decision_outcomes_table.sql` — nouvel enum `decision_outcome_horizon` (`J_PLUS_1`/`J_PLUS_3`/`J_PLUS_7`) et table `public.decision_outcomes` : `id`, `athlete_id` (FK → `athletes`, `ON DELETE CASCADE`, cohérent avec le reste du schéma), `decision_id` (FK → `decisions`, **`ON DELETE RESTRICT`** — pas `CASCADE` : `decision_outcomes` est une preuve dérivée de la decision qu'elle observe, on ne veut jamais qu'une suppression future de `decisions` fasse disparaître silencieusement les observations qui en dépendent), `horizon`, `calculator_id`/`calculator_version` (texte libre, aucun calculateur n'existe encore donc pas d'enum fermé prématuré), `input_snapshot jsonb` (voir ci-dessous), `outcome_signals jsonb` (résultats déterministes futurs — delta énergie, delta fatigue jambes/grip, delta motivation, apparition/persistance douleur, état maladie, complétion de séance, RPE... — aucun résumé en langage naturel, aucun score de confiance arbitraire), `calculated_at`, `created_at`. **Délibérément aucune colonne `updated_at`, aucun trigger `set_updated_at`** — l'absence de la colonne exprime elle-même l'immutabilité, pas seulement une discipline de code. Contrainte `UNIQUE (athlete_id, decision_id, horizon, calculator_id, calculator_version)` — l'invariant d'idempotence. RLS activée, policy `decision_outcomes_own_select` (`FOR SELECT TO authenticated`, expression d'ownership standard du schéma).
  **`input_snapshot`** : `daily_checkins`/`completed_sessions` sont éditables — un futur calculateur J+3 qui lirait les tables live verrait son résultat devenir irreproductible si l'athlète corrige son check-in après coup. `input_snapshot` fige donc les faits sources déterministes réellement consommés au moment du calcul — un objet JSON canonique et restreint (jamais un dump complet de lignes), pas une FK vers des lignes encore mutables (une FK ne protégerait pas contre une édition ultérieure). Le contenu exact (quels champs) est laissé au futur calculateur ; cette tranche impose seulement que ce soit un objet JSON non-null présent (`CHECK jsonb_typeof(...) = 'object'`).
  **Découverte réelle pendant l'implémentation (corrigée avant la première application locale)** : ce projet Supabase a des `ALTER DEFAULT PRIVILEGES` configurés sur le schéma `public` (rôles `postgres` et `supabase_admin`) qui `GRANT ALL` automatiquement à `anon`/`authenticated`/`service_role` sur **toute nouvelle table créée** — le même mécanisme qui avait rendu `decisions`/`completed_sessions` trop permissives au baseline. Une première tentative locale (`db reset`) a confirmé empiriquement que `decision_outcomes` héritait de `anon`/`authenticated` avec accès complet et `service_role` avec `UPDATE`/`DELETE` en trop, malgré l'attente initiale (erronée) qu'une table neuve démarre sans privilège. Corrigé avant tout déploiement : `REVOKE ALL PRIVILEGES ... FROM anon/authenticated/service_role` explicite avant les `GRANT` ciblés (`authenticated`→`SELECT` seul, `service_role`→`SELECT, INSERT` seuls, `anon`→ rien).
- `supabase/migrations/20260819220500_persist_decision_outcome_rpc.sql` — `public.persist_decision_outcome(p_athlete_id uuid, p_row jsonb) RETURNS jsonb`, `SECURITY INVOKER`, `EXECUTE` réservé à `service_role`. Contrat FULL REPLACEMENT strict : ensemble canonique fermé `decision_id`/`horizon`/`calculator_id`/`calculator_version`/`input_snapshot`/`outcome_signals`, **toutes requises** (aucun champ optionnel — contrairement à `persist_completed_session`, aucune valeur n'est auto-reportée par l'athlète ici, tout vient d'un calculateur qui connaît déjà chaque valeur), clé inconnue/typo → exception, clés interdites (`id`, `athlete_id`, `created_at`, `calculated_at`) → exception dédiée. Ownership validée : `decision_id` doit exister et appartenir à `p_athlete_id`.
  **Idempotence/conflit** : clé d'unicité `(athlete_id, decision_id, horizon, calculator_id, calculator_version)`. Absente → `INSERT`. Présente + `input_snapshot`/`outcome_signals` jsonb-égaux (égalité profonde native, insensible à l'ordre des clés) → retour de l'id existant, **aucune écriture**. Présente + contenu différent → exception explicite ("outcomes are immutable, use a new calculator_version instead") — **jamais d'UPDATE silencieux**. Une nouvelle `calculator_version` crée une nouvelle ligne immuable distincte, les anciennes ne sont jamais modifiées. Course concurrente gérée par un bloc `BEGIN/EXCEPTION WHEN unique_violation` qui relit et applique la même logique égalité-ou-conflit — l'idempotence tient aussi sous concurrence réelle, pas seulement en séquentiel. Aucun `UPDATE` n'existe nulle part dans la fonction.
- `supabase/preflight/decision_outcomes_append_only_security_check.sql` — preflight lecture seule (même pattern que `completed_sessions_upsert_only_security_check.sql`) : RLS activée, policy exacte (nom + `FOR SELECT` + rôle via `polroles`), aucune autre policy, `authenticated`=`SELECT` et rien d'autre (y compris pas d'`INSERT` — contrairement à `completed_sessions`, `authenticated` n'a ici aucun chemin d'écriture légitime), `anon`=zéro privilège, `service_role`=`SELECT`+`INSERT` exactement (vérification explicite que `service_role` n'a PAS `UPDATE`/`DELETE`), signature exacte RPC via `to_regprocedure`, `SECURITY INVOKER`, `EXECUTE` refusé `anon`/`authenticated`, accordé `service_role`.

**Preuve empirique locale : COMPLÈTE, tout PASS.** Docker Desktop, indisponible en fin de session précédente, redevenu disponible après une nouvelle tentative. Stack fraîche (`supabase start` + `supabase db reset`), les 13 migrations (baseline → M5_001B) appliquées avec succès depuis zéro. Preflight local (12 sections) : **toutes vides** (sain) — confirme que le correctif de privilèges par défaut documenté plus haut tient bien : `authenticated`=`SELECT` seul, `service_role`=`SELECT`+`INSERT` exactement (ni `UPDATE` ni `DELETE`), `anon`=absent de la liste des privilèges (zéro accordé).

Fixtures scratch : 2 athlètes (A, B), decisions pour chacun. Matrice complète :
- **Sécurité** : `authenticated` (A) SELECT propre → 2 lignes visibles ; `authenticated` (B) SELECT cross-athlete → 0 ligne ; INSERT/UPDATE/DELETE directs (A, sur sa propre ligne) → `permission denied for table decision_outcomes` (échec au niveau `GRANT`, avant RLS) ; `anon` SELECT + `EXECUTE` RPC → refusés ; `authenticated` `EXECUTE` RPC → refusé.
- **RPC/idempotence** : INSERT via `service_role` (payload canonique complet) → succès. **Rejeu exact** (mêmes valeurs, mais `input_snapshot` avec les clés JSON dans un ORDRE DIFFÉRENT, délibérément, pour prouver l'égalité jsonb réelle) → même `decision_outcome_id`, **1 seule ligne** (`count(*)=1` vérifié), `calculated_at`/`created_at` **strictement inchangés** (comparaison exacte avant/après, aucune mutation). **Rejeu avec `input_snapshot` différent** → exception ("outcomes are immutable..."). **Rejeu avec `outcome_signals` différent** → exception, même message. **`calculator_version` v2, même decision/horizon** → nouvelle ligne immuable créée, la ligne v1 reste inchangée (vérifié par requête directe listant les deux versions).
- **Identité du calculateur** : `calculator_id` vide, `calculator_id` espaces-seulement, `calculator_version` vide, `calculator_version` espaces-seulement → les 4 cas rejetés par la RPC avec message dédié, avant même d'atteindre la contrainte `CHECK` de la table.
- **Liaison decision** : decision d'un autre athlète → exception ; decision inexistante → exception.
- **FK `decision_id ON DELETE RESTRICT` — test empirique critique (deux scénarios distincts)** :
  1. Suppression complète d'un athlète (`DELETE FROM auth.users` → cascade `athletes` → `decisions` ET `decision_outcomes`, tous deux enfants directs de `athletes`) avec un graphe athlete→decision→decision_outcome intact → **réussit proprement**, graphe entier supprimé (0 ligne restante vérifié sur les 4 tables). `RESTRICT` ne bloque PAS ce cas car `decision_outcomes` est supprimée dans le même balayage de cascade que `decisions` (les deux référencent directement `athletes.id`), donc au moment où `RESTRICT` serait évalué sur `decision_id`, aucune ligne `decision_outcomes` référençant cette decision ne "survit" à l'opération.
  2. Suppression **isolée** d'une seule ligne `decisions` (sans passer par `athletes`) alors qu'une ligne `decision_outcomes` la référence toujours → **bloquée** : `ERROR: update or delete on table "decisions" violates foreign key constraint "decision_outcomes_decision_id_fkey"`. C'est exactement la protection voulue — la RPC/l'app actuelle n'a de toute façon aucun chemin qui supprime une `decisions` isolément.
  **Conclusion : le design FK est correct tel quel, aucune correction nécessaire.** Les deux comportements (cascade complète autorisée, suppression isolée bloquée) sont exactement ceux recherchés.

Nettoyage : tous les fixtures scratch supprimés (3 users/athletes distincts utilisés au total sur les différents sous-tests), **0 ligne restante** vérifiée sur `auth.users`/`athletes`/`decisions`/`decision_outcomes` (`count(*) global sur decision_outcomes = 0` après nettoyage). Stack locale arrêtée.

**Régressions existantes (avec Docker)** : `head-coach-engine` — `npm test` (M1+M2) = **226/226** (dont 75/75 M1) ; `npm run test:edge` = **9/9** ; `npm run test:m3:http` = **26/26** (propre du premier coup cette fois, aucun retry nécessaire). `web` = **163/163**. `decision_outcomes` confirmée toujours à 0 ligne après ces suites (aucune ne la touche). Aucun changement `head-coach-engine/src/**`, `web/**`, `supabase/functions/**`.

**Déploiement remote (`uvolpldwwyvadlamulvr` exclusivement, jamais `evynmzyjhobdpmxdiwsy`)** : après validation locale complète, preflight remote AVANT écriture confirmant l'état pré-M5_001B attendu (`decision_outcomes`/`persist_decision_outcome` inexistants, `decisions`/`completed_sessions` toujours sains). Dry-run (`supabase db push --dry-run`) confirmant exactement les 2 migrations attendues, `seeds`/`roles` vides, rien d'autre en attente. Les 2 migrations appliquées via `supabase db push --linked --project-ref uvolpldwwyvadlamulvr` :
- `20260819220000_decision_outcomes_table.sql`
- `20260819220500_persist_decision_outcome_rpc.sql`

**Postflight remote (lecture seule, sections vérifiées individuellement, pas seulement le dernier résultat d'une requête multi-statements)** : RLS activée ; exactement 1 policy (`decision_outcomes_own_select`, `FOR SELECT`, rôle `authenticated` via `polroles`) ; `authenticated`=`SELECT` et rien d'autre ; `anon`=zéro privilège ; `service_role`=`SELECT`+`INSERT` présents, `UPDATE`/`DELETE` absents ; RPC signature exacte `persist_decision_outcome(uuid,jsonb)` confirmée existante, `SECURITY INVOKER`, `anon`/`authenticated` EXECUTE refusés, `service_role` EXECUTE autorisé — **toutes sections saines**.

**Inspection du schéma live remote** : enum `decision_outcome_horizon` = `J_PLUS_1`/`J_PLUS_3`/`J_PLUS_7` (confirmé) ; 10 colonnes exactement, toutes `NOT NULL`, **aucune colonne `updated_at`** ; contraintes confirmées via `pg_get_constraintdef` : `athlete_id FK → athletes ON DELETE CASCADE`, `decision_id FK → decisions ON DELETE RESTRICT`, `calculator_id`/`calculator_version` CHECK non-blank, `input_snapshot`/`outcome_signals` CHECK objet JSON, `UNIQUE (athlete_id, decision_id, horizon, calculator_id, calculator_version)`.

**Inspection de la RPC live remote** : `pg_get_functiondef` récupéré et comparé — la fonction déployée correspond **exactement** au fichier de migration testé localement (validation stricte du payload canonique, validation d'ownership de la decision, comparaison jsonb pour l'idempotence, exception sur conflit, aucun `UPDATE`, timestamps gérés par la DB).

**Régression M4/M5_001A post-déploiement (remote)** : `decisions_append_only_security_check.sql` re-exécuté après ce déploiement — toujours sain (aucune policy non-SELECT, aucun privilège d'écriture `authenticated`/`anon`). `completed_sessions_upsert_only_security_check.sql` re-exécuté — toujours sain (policy exacte, grants exacts, `anon` sans privilège). **M5_001B n'a affaibli ni M4 ni M5_001A.**

**Synchronisation finale** : `supabase migration list --linked` confirme les 13 migrations (baseline → M5_001B) toutes local == remote, aucune dérive.

**Contraintes notées pour les tranches M5 suivantes (non implémentées ici)** : FK source des futures `pattern_evidence` → préférer `ON DELETE RESTRICT`/`NO ACTION` (déjà appliqué et **empiriquement validé** ici pour `decision_outcomes.decision_id` — le pattern "cascade complète OK, suppression isolée bloquée" est directement reproductible) ; future persistance `pattern` + `evidence` + `evidence_sources` → atomique ; `detector_rule_id`/`detector_version` → obligatoires sur toute future ligne d'evidence ; futures RPC de transition de revue humaine → append-only + sûres en concurrence/idempotence (le bloc `EXCEPTION WHEN unique_violation` de `persist_decision_outcome` est un exemple concret réutilisable, déjà prouvé fonctionnel pour le chemin séquentiel — la course concurrente réelle elle-même n'a pas été simulée, seul le chemin séquentiel identique/conflictuel l'a été).

**Décision** : **M5_001B est COMPLETE et déployée sur `uvolpldwwyvadlamulvr`.** `decision_outcomes` est active et réellement append-only (aucune écriture directe possible depuis le navigateur, aucun chemin d'`UPDATE`/`DELETE` nulle part — ni au niveau RPC, ni au niveau GRANT). Le rejeu exact est idempotent (même id, aucune ligne dupliquée, timestamps inchangés) ; un rejeu avec un contenu différent pour la même clé d'unicité est rejeté (jamais un écrasement silencieux) ; une nouvelle `calculator_version` coexiste proprement avec les versions antérieures, toutes immuables. Ceci ne couvre que M5_001B — le reste de M5 (pattern tables, `longitudinal-engine`, calculateurs réels, Edge Function M5_003) reste non implémenté.

**Impact** : `supabase/migrations/20260819220000_decision_outcomes_table.sql`, `supabase/migrations/20260819220500_persist_decision_outcome_rpc.sql`, `supabase/preflight/decision_outcomes_append_only_security_check.sql`, cette entrée. Aucun changement `head-coach-engine/**`, `web/**`, `supabase/functions/**`.

**Statut** : active (M5_001B complet et déployé ; M5 dans son ensemble reste en cours)

---

## 2026-08-21 — M5_002A : squelette `longitudinal-engine` + adapter Supabase lecture seule (LOCAL, jamais poussé remote)

**Contexte** : suite de l'audit M5_001 (recommandation "Option A : nouveau package sibling top-level"). Cette tranche pose la première vraie frontière d'architecture du moteur longitudinal : un package **totalement indépendant** de `head-coach-engine`, capable de relire les faits déjà persistés (check-ins, decisions, completed_sessions, decision_outcomes, health_flags) pour l'analyse longitudinale future. Aucun calculateur, aucun détecteur, aucune table `learned_patterns`/`pattern_evidence`, aucun job, aucune Edge Function, aucune UI implémentés ici. **Aucune information apprise ne peut influencer `daily-run`.**

**Décision** : création de `longitudinal-engine/` en package npm sibling top-level (`package.json`/`tsconfig`/`vitest.config`/build/tests propres), au même niveau que `head-coach-engine/`. Frontière stricte, vérifiée statiquement par un test (`tests/unit/boundaries.test.ts`) qui grep tout `src/**` à la recherche d'un `import ... from`/`require(...)` pointant vers `head-coach-engine` (zéro trouvé) : `longitudinal-engine/**` n'importe jamais `head-coach-engine/src/**`, et cette tranche ne modifie ni `head-coach-engine/src/**`, ni `web/**`, ni `supabase/functions/**`.

**Implémenté** :
- `src/types/sources.ts` — 5 familles de types source (`DailyCheckinSource`, `DecisionSource`, `CompletedSessionSource`, `DecisionOutcomeSource`, `HealthFlagSource`), **pas des alias/imports des types `head-coach-engine`** : reconstruits indépendamment, limités aux champs réellement consommables, avec le vocabulaire DB exact (vérifié contre `supabase/migrations/20260814095000_baseline_v0_2.sql` et les migrations M2/M5 pertinentes, jamais inventé depuis la prose d'architecture). Chaque champ legacy exclu (`pain_location`, `decisions.reviewed_after_days`/`outcome_note`/`reason`/`triggered_rules`/`do_not_do`/`readiness_score`/etc.) porte sa justification en commentaire. `dailyPlan`/`intervention`/`mainContent`/`inputSnapshot`/`outcomeSignals` restent des `Record<string, unknown>` opaques — jamais retypés vers les formes riches de `head-coach-engine`/`web` (respecte à la fois la frontière d'import et le principe "aucune interprétation").
- `src/types/adapter.ts` — interface `LongitudinalSourceAdapter` (5 méthodes `get*`), `DateRange` **inclusif des deux bornes** (`fromDate`/`toDate`, jamais de fenêtre relative "N derniers jours" calculée en interne).
- `src/supabase/rowMapping.ts` — mapping ligne PostgREST brute → type source, échec **bruyant** (`InvalidSourceRowError`) sur champ manquant, type erroné, ou valeur d'enum non reconnue — jamais de coercition silencieuse vers une valeur par défaut.
- `src/supabase/adapter.ts` — `SupabaseLongitudinalSourceAdapter`, injection de dépendance (reçoit un `SupabaseClient` déjà construit, ne possède/construit jamais son propre client, aucun secret en dur). Chaque méthode = exactement un `.select()` (aucun `.insert/.update/.upsert/.delete/.rpc` nulle part dans le fichier — vérifié par grep et par `tests/unit/boundaries.test.ts`). Chaque requête filtre explicitement `.eq("athlete_id", athleteId)`, même si le client visé est `service_role` (qui contourne RLS) — l'ownership n'est jamais implicite au niveau requête.

**Colonne d'ancrage de `range` par table** — `daily_checkins` → `checkin_date` ; `decisions` → `decision_date` ; `completed_sessions` → `session_date` (les trois directes, sans ambiguïté) ; `decision_outcomes` → `decisions.decision_date` de la décision source (via jointure, pas `calculated_at`) ; `health_flags` → chevauchement de cycle de vie (pas `flag_date` seul). Les deux derniers cas sont détaillés ci-dessous — ni l'un ni l'autre n'a été accepté tel quel par défaut :
1. **`health_flags`** : filtrage initial envisagé sur `flag_date` seul, **rejeté** après relecture de `20260816212000_M2_005_health_flags_open_unique.sql` (index unique partiel `(athlete_id, flag_type) WHERE status IN ('active','monitoring')`, confirmant qu'un flag a un vrai cycle de vie `[flag_date, resolved_at]`, potentiellement ouvert). Un flag ouvert avant `range.fromDate` et toujours actif pendant `range` est exactement le signal qu'une lecture longitudinale de cette période doit voir (ex. "blessure non résolue pendant ce bloc d'entraînement") — un filtre `flag_date`-seul le ferait disparaître silencieusement dès que la fenêtre ne contient plus sa date de départ. **Décision finale** : chevauchement d'intervalle — `flag_date <= range.toDate AND (resolved_at IS NULL OR resolved_at >= range.fromDate)`, implémenté via `.lte("flag_date", ...).or("resolved_at.is.null,resolved_at.gte....")`. `resolved_at` est un `date` simple (même type que `flag_date`), donc aucune conversion de fuseau horaire nécessaire ici.
2. **`decision_outcomes`** : filtrage initial envisagé sur `calculated_at` (bornes UTC de jour), **rejeté** après relecture du commentaire de sa propre migration ("`calculated_at` : quand ce calcul a réellement tourné, **peut différer de `created_at` si un futur rejeu differé existe**"). `calculated_at` est un timestamp opérationnel, pas la date-timeline de l'athlète que `range` représente — une lecture longitudinale de "ce qui s'est passé autour de `decision_date` X" ne doit ni perdre silencieusement un outcome calculé en retard, ni intégrer un outcome recalculé pendant `range` pour une décision hors `range`. **Décision finale** : appartenance à `range` ancrée sur `decisions.decision_date` via jointure interne PostgREST (`decisions!inner(decision_date)` + filtre `.gte/.lte("decisions.decision_date", ...)`). **Limite documentée acceptée** : postgrest-js documente explicitement que trier (`.order()`) par une colonne de table référencée n'affecte pas l'ordre des lignes parentes (seul le filtrage via `!inner` le fait) — le tri retombe donc sur `calculated_at ASC` (+ `decision_id`/`horizon`/`calculator_id`/`calculator_version`/`id` comme départage), toujours pleinement déterministe, simplement pas trié par `decision_date`.

**Tests locaux** :
- `tests/unit/rowMapping.test.ts` — 23 tests : mapping valide par famille source, enums exacts, préservation des champs nullable, préservation JSON (imbrication + unicode), rejet des enums non reconnus / champs manquants / mal typés via `InvalidSourceRowError`.
- `tests/unit/boundaries.test.ts` — 2 tests : zéro import `head-coach-engine` dans `src/**` ; zéro appel `.insert/.update/.upsert/.delete/.rpc` dans `adapter.ts` (prose des commentaires exclue du grep).
- `tests/supabase/adapter.integration.test.ts` — 16 tests contre stack Supabase locale réelle (`supabase start` + `db reset`, 13 migrations appliquées proprement) : 2 athlètes scratch, check-ins/decisions/completed_session/decision_outcome/health_flag multiples, dates dedans/dehors de la fenêtre `2026-08-10..2026-08-15`. Preuves empiriques : isolement athlète strict (aucune fuite croisée sur les 5 getters) ; bornes inclusives des deux côtés ; ordre déterministe (`decisions` avec deux lignes à la même `decision_date`, départagées par `computed_at ASC` puis `id`, prouvant que l'ordre n'est jamais l'ordre d'insertion) ; préservation nullable/JSON (unicode, imbrication) ; relation `completed_sessions.decision_id`/`decision_outcomes.decision_id` préservée exactement ; **preuve à deux volets** de la sémantique `decision_outcomes` (un outcome dont la decision est dans `range` mais `calculated_at` très en dehors → inclus ; un outcome dont la decision est hors `range` mais `calculated_at` dedans → exclu) ; **preuve à quatre volets** de la sémantique `health_flags` (flag ouvert avant `range` et toujours actif → inclus ; flag résolu avant `range` → exclu ; flag ouvert dans `range` → inclus ; flag après `range` → exclu) ; nettoyage complet vérifié (`count(*) = 0` sur les 5 tables après suppression de l'athlète, cascade FK confirmée y compris `decision_outcomes`).

**Régressions existantes (avec Docker)** : `head-coach-engine` `npm test` = **226/226** ; `npm run test:edge` = **9/9** ; `npm run test:m3:http` = **26/26** (1 échec `502` sur le tout premier appel au premier essai — course de démarrage du edge-runtime, confirmée environnementale par un second essai propre du premier coup) ; `web` `npm test -- --run` = **163/163**. `longitudinal-engine` `npm test` = **41/41** (25 unit + 16 integration) ; `npm run build` = succès propre (`tsc -p tsconfig.build.json`, aucune erreur). Aucun changement `head-coach-engine/src/**`, `web/**`, `supabase/functions/**`.

**Remote** : aucune écriture, aucune migration. `supabase migration list --linked --project-ref uvolpldwwyvadlamulvr` reconfirme les 13 migrations local==remote, aucune dérive.

**Décision** : **M5_002A est COMPLETE.** `longitudinal-engine/` existe comme package sibling totalement indépendant, avec un adapter Supabase lecture seule prouvé (statiquement et empiriquement) sans écriture, scoping athlète explicite sur chaque requête, bornes de date inclusives documentées et testées, ordre déterministe par table, et deux corrections de sémantique temporelle (`health_flags` en chevauchement de cycle de vie, `decision_outcomes` ancré sur `decision_date`) tranchées après inspection du schéma réel plutôt qu'assumées. Ceci ne couvre que le squelette + la lecture — aucun calculateur, détecteur, table de pattern, job, Edge Function ou UI n'existe encore. **M5 dans son ensemble reste en cours, non complet.**

**Impact** : `longitudinal-engine/**` (nouveau package), cette entrée. Aucun changement `head-coach-engine/src/**`, `web/**`, `supabase/functions/**`, aucune migration.

**Statut** : active (M5_002A complet, non déployé — package local uniquement ; M5 dans son ensemble reste en cours)
