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

---

## 2026-08-21 — M5_002B : timeline longitudinale déterministe, `longitudinal-engine/src/timeline/**` (LOCAL, aucune migration, jamais poussé remote)

**Contexte** : M5_002A fournit les faits source (5 familles) et un adapter Supabase lecture seule. Il manquait la structure intermédiaire entre "faits bruts" et un futur détecteur/calculateur : une manière déterministe, pure, sans interprétation, de relier ces faits entre eux sur un axe temporel — check-ins, décisions, séances complétées, outcomes et health flags d'un même athlète, organisés en jours calendaires et en fils (`DecisionThread`, `HealthFlagThread`). M5_002B implémente exactement cette structure, rien de plus : **aucun seuil, aucun score, aucune moyenne, aucune métrique glissante, aucune interprétation sommeil/douleur/adhérence, aucun calcul d'outcome, aucune corrélation, aucune détection de pattern, aucune recommandation, aucune règle de sécurité, aucun LLM.**

**Décision** : nouveau module pur `longitudinal-engine/src/timeline/**` (14 fichiers : `types.ts`, `constants.ts`, `linking.ts`, `ordering.ts`, `range.ts`, `athleteScoping.ts`, `partitioning.ts`, `healthContext.ts`, `assembleDay.ts`, `decisionThread.ts`, `healthFlagThread.ts`, `provenance.ts`, `buildTimeline.ts`, `index.ts`), ré-exporté depuis `src/index.ts`. Zéro I/O, zéro horloge (`TIMELINE_BUILDER_VERSION` est une constante fixe, jamais un timestamp de build), zéro aléatoire, zéro accès Supabase — `buildTimeline(input)` est une fonction pure qui prend en entrée les 5 tableaux de faits source déjà récupérés (`TimelineSources`) + `athleteId` + `range`, et retourne un `AthleteTimeline` structuré. Réutilise intégralement les types `DailyCheckinSource`/`DecisionSource`/`CompletedSessionSource`/`DecisionOutcomeSource`/`HealthFlagSource`/`DateRange` de M5_002A — aucune redéfinition.

**Range-scoping des pools canoniques (corrigé en revue finale, voir plus bas)** : `checkins`/`decisions`/`completedSessions` sont chacun filtrés sur leur propre colonne de date (`checkinDate`/`decisionDate`/`sessionDate` ∈ `range`) **avant** toute construction de jour ou résolution de lien — une décision dont `decisionDate` est hors `range` n'obtient **aucun** `DecisionThread`, même si elle est présente dans `sources.decisions` brut ; un lien qui résoudrait vers une ligne hors `range` revient `absent/source_missing_in_pool`, exactement comme s'il pointait vers une ligne réellement absente. `health_flags` reste la seule famille délibérément non filtrée par date — M5_002A la fournit déjà par chevauchement de lifecycle, pas par un simple `date ∈ range`. `provenance.sourceCounts` continue de rapporter les longueurs brutes, non filtrées, de chaque tableau source fourni.

**Structure produite** : `AthleteTimeline` = `{ athleteId, range, days: AthleteDay[], decisionThreads: DecisionThread[], healthFlagThreads: HealthFlagThread[], provenance }`.
- `AthleteDay` — un par date calendaire de `range` (matérialisé même sans fait primaire ce jour-là ; peut ne contenir que `activeHealthContext`) : `checkins`/`decisions`/`completedSessions` (avec lien `Link<DecisionSource>` par séance)/`healthEventsCreated`/`healthEventsResolved`/`activeHealthContext`.
- `DecisionThread` — un par décision (jamais collapsé/dédupliqué, même plusieurs décisions le même jour — `decisions` reste réellement append-only) : `linkedSourceCheckin` (`Link<DailyCheckinSource>`), `linkedCompletedSessions` (réciproque `completed_sessions.decision_id`, cardinalité 0..N, jamais réduite à une seule séance), `outcomesByHorizon` (les 3 clés `J_PLUS_1`/`J_PLUS_3`/`J_PLUS_7` toujours présentes, même vides ; **toutes** les variantes `calculatorId`/`calculatorVersion` préservées, jamais de sélection "dernière"/"courante"/"préférée").
- `HealthFlagThread` — un par flag : `openedOn`/`resolvedOn` + `linkedSourceCheckin`.
- `Link<T>` = `{ kind: "explicit", ref: T } | { kind: "absent", reason: "fk_null" | "source_missing_in_pool" }` — modélise exactement les 3 FK nullable réelles (`completed_sessions.decision_id`, `decisions.source_checkin_id`, `health_flags.source_checkin_id`), jamais le lien inverse decision→sessions (plain array) ni le lifecycle santé (voir plus bas — délibérément pas un `Link` générique).

**Invariant fail-loud décisif** : `decision_outcomes.decision_id` est `NOT NULL` (contrairement aux 3 FK ci-dessus) et son appartenance à `range` est déjà ancrée sur `decisions.decision_date` par l'adapter M5_002A — un outcome présent dont le `decisionId` ne résout à aucune décision du pool fourni est donc une incohérence d'entrée, pas un cas normal de lien hors-plage. `buildDecisionThreads` vérifie chaque outcome contre le pool de décisions **avant** toute construction et lève `OrphanedDecisionOutcomeError` (déterministe, propre au package) plutôt que de silencieusement l'ignorer. Le pool contre lequel cette vérification a lieu est le pool **range-scoped** (voir ci-dessus) : un outcome référençant une décision présente dans `sources.decisions` brut mais dont `decisionDate` tombe hors `range` échoue tout aussi bruyamment — ce cas pathologique n'arrive jamais en usage production réel (M5_002A empêche déjà cette combinaison incohérente puisque les outcomes sont récupérés selon la date de leur decision source), mais reste testé explicitement ici en entrée directe.

**Lifecycle santé** : dérivation `flag.flagDate <= D AND (flag.resolvedAt == null OR D <= flag.resolvedAt)` (`healthContext.ts`, comparaison de chaînes pures — les dates canoniques `YYYY-MM-DD` zero-paddées ont un ordre lexicographique identique à l'ordre calendaire, aucun objet `Date` nécessaire). Par jour : `healthEventsCreated` = `flagDate == jour` ; `healthEventsResolved` = `resolvedAt == jour` ; `activeHealthContext` = chevauchement de lifecycle (peut inclure un flag ouvert **avant** `range.fromDate` — c'est l'exception documentée à la règle générale d'exclusion primaire par plage : les faits primaires (check-ins/décisions/séances) hors `range` n'apparaissent dans aucun `AthleteDay`, mais le contexte santé actif, lui, doit rester visible). Modélisé en tableaux plats, délibérément pas en `Link` générique.

**Validation de plage** : `range.ts` ne suppose jamais que l'interface TypeScript `DateRange` garantit une valeur runtime valide. À la frontière de `buildTimeline` : format canonique `YYYY-MM-DD` strict, date calendaire réellement possible (vérifiée par round-trip exact via `Date.UTC`/`getUTC*` — jamais l'API `Date` locale, donc indépendant du fuseau horaire de la machine hôte), `fromDate <= toDate` (égalité = plage d'un seul jour, valide). Toute violation lève `InvalidDateRangeError`. L'arithmétique de matérialisation des jours est une simple addition de millisecondes UTC — les franchissements de mois/année et le 29 février bissextile en découlent naturellement, sans cas particulier ; le 29 février d'une année non bissextile est rejeté par le round-trip (normalisé en 1er/2 mars par `Date.UTC`, donc différent de l'entrée).

**Ordre déterministe** : chaque site de tri (`ordering.ts`, `byFields`) enchaîne assez de champs de départage jusqu'à `id` pour que l'ordre du tableau d'entrée n'affecte jamais la sortie — jours (`date ASC`), check-ins/jour (`submittedAt ASC, id ASC`), décisions/jour (`computedAt ASC, id ASC`), séances/jour (`id ASC`), événements santé créés/résolus (`id ASC`), contexte santé actif (`flagDate ASC, id ASC`), fils de décision (`decisionDate ASC, computedAt ASC, id ASC`), séances liées (`id ASC`), outcomes par horizon (`calculatedAt ASC, calculatorId ASC, calculatorVersion ASC, id ASC`), fils santé (`id ASC`). Prouvé empiriquement par un test qui inverse chaque tableau source d'entrée et vérifie une sortie `deepEqual` identique.

**Scoping athlète** : `buildTimeline` reçoit `athleteId` explicitement et vérifie, en **une seule passe** couvrant les 5 familles source à la fois (`athleteScoping.ts`), que chaque ligne lui appartient. Toute violation lève `TimelineAthleteMismatchError` — dont le contrat porte `expectedAthleteId` et `offendingSources` (un `Record<famille, ids[]>` listant **chaque** famille en défaut, pas seulement la première trouvée, chaque liste plafonnée à 10 ids), avant toute autre construction. Tableaux vides toujours valides.

**Provenance déterministe** (aucun `builtAt`) : `provenance.builderVersion` (contrat public verrouillé — pas `timelineBuilderVersion` ; valeur = `TIMELINE_BUILDER_VERSION`, constante fixe), `rangeDaysMaterialized`, `sourceCounts` (les 5 familles, **longueurs brutes non filtrées par range** — voir plus haut), `linkCounts.{explicit,absent}` (compte exactement les 3 sites `Link<T>` réels : `CompletedSessionOnDay.linkedDecision`, `DecisionThread.linkedSourceCheckin`, `HealthFlagThread.linkedSourceCheckin`), `linkedCompletedSessionsMatched` (le lien inverse decision→séances, compté séparément car ce n'est pas un `Link<T>`). Exactitude des compteurs prouvée par un test dédié construisant un scénario dont chaque compte est calculé à la main.

**Hygiène de la surface publique** (`timeline/index.ts`) : n'expose que `buildTimeline`, les types publics, les 3 erreurs propres au package (`InvalidDateRangeError`, `TimelineAthleteMismatchError`, `OrphanedDecisionOutcomeError`) et les 2 constantes réellement utiles (`TIMELINE_BUILDER_VERSION`, `DECISION_OUTCOME_HORIZONS`). Les fonctions d'assemblage internes (`assertAthleteScoped`, `materializeDateRange`, et tout ce qui vit dans `linking.ts`/`ordering.ts`/`partitioning.ts`/`healthContext.ts`/`assembleDay.ts`) restent non ré-exportées — les tests y accèdent par import relatif direct, ce qui reste légitime pour du code interne au même package.

**Tests locaux (purs, aucune intégration Supabase nécessaire pour cette tranche)** : 75 tests sous `tests/unit/timeline/**` (`constants`, `range`, `linking`, `athleteScoping`, `healthContext`, `assembleDay`, `decisionThread`, `healthFlagThread`, `buildTimeline`) couvrant au minimum : constantes d'horizon exactes ; jour unique, plage de 30 jours, franchissement de mois, franchissement d'année, 29 février bissextile, date calendaire impossible, plage inversée ; résolution FK explicite / `fk_null` / `source_missing_in_pool` ; isolement athlète, rejet multi-familles (chaque famille en défaut listée, pas seulement la première), plafond de 10 ids par famille, entrées vides ; contexte santé actif démarré avant la plage, flag actif non résolu, flag résolu, ouverture/résolution le même jour, flags concurrents ; décisions multiples le même jour + ordre déterministe ; séance sans décision / séance liée / plusieurs séances vers la même décision ; lien check-in source (décision et health flag) ; les 3 horizons d'outcome, plusieurs versions de calculateur, ordre déterministe des outcomes, decision manquante pour un outcome → échec bruyant ; **exclusion primaire par plage stricte** (décision hors-plage → aucun `DecisionThread` mais toujours comptée dans `sourceCounts` ; séance en-plage → decision hors-plage → lien absent ; decision en-plage → check-in source hors-plage → lien absent ; séance hors-plage → decision en-plage → jamais dans `linkedCompletedSessions` ; outcome → decision hors-plage → échec bruyant même si cette decision est présente dans les sources brutes) vs. exception de chevauchement santé ; `provenance.builderVersion` (pas `timelineBuilderVersion`) ; tableaux d'entrée mélangés → sortie identique ; construction répétée → `deepEqual` ; compteurs de provenance exacts.

**Régressions existantes (avec Docker)** : `longitudinal-engine` `npx vitest run tests/unit/` = **100/100** (25 unit M5_002A + 75 unit M5_002B timeline) ; `npm test` (unit + intégration M5_002A) = **116/116** (100 unit + 16 intégration M5_002A) ; `npm run build` = succès propre. `head-coach-engine` `npm test` = **226/226** ; `npm run test:edge` = **9/9** ; `npm run test:m3:http` = **26/26** (propre du premier coup dans cette passe de correction, aucun retry nécessaire). `web` `npm test -- --run` = **163/163**. Aucun changement `head-coach-engine/src/**`, `web/**`, `supabase/functions/**`, `supabase/migrations/**`, `docs/03*`/`05*`/`06*`.

**Remote** : aucune écriture, aucune migration (M5_002B est un module TypeScript pur, aucun changement de schéma). `supabase migration list --linked --project-ref uvolpldwwyvadlamulvr` reste à 13 migrations, aucune dérive attendue ni introduite.

**Frontière package re-vérifiée** : zéro import/require pointant vers `head-coach-engine` dans `longitudinal-engine/src/timeline/**` ou `tests/unit/timeline/**` (grep sur les spécificateurs d'import, pas sur la prose des commentaires). Zéro appel `.insert/.update/.upsert/.delete/.rpc`, zéro `Date.now()`/`new Date()` sans argument (seule construction déterministe `new Date(msExplicite)` pour l'arithmétique de plage), zéro `Math.random`, zéro accès filesystem/réseau/Supabase dans `src/timeline/**`.

**Décision** : **M5_002B est COMPLETE.** `longitudinal-engine/src/timeline/**` fournit une reconstruction de timeline purement déterministe (jours matérialisés, fils de décision, fils de flags santé) au-dessus des faits source M5_002A, sans aucune interprétation, détection, calcul d'outcome ou influence sur `daily-run`. Ceci ne couvre que la structure temporelle — aucun calculateur d'outcome réel, aucun détecteur de pattern, aucune table `learned_patterns`/`pattern_evidence`, aucun job, aucune Edge Function, aucune UI n'existent encore. **M5 dans son ensemble reste en cours, non complet.**

**Impact** : `longitudinal-engine/src/timeline/**` (nouveau), `longitudinal-engine/src/index.ts` (ré-export ajouté), `longitudinal-engine/tests/unit/timeline/**` (nouveau), cette entrée. Aucun changement `head-coach-engine/src/**`, `web/**`, `supabase/functions/**`, `supabase/migrations/**`, `docs/03*`/`05*`/`06*`, aucune migration.

**Statut** : active (M5_002B complet, non déployé — module local pur uniquement ; M5 dans son ensemble reste en cours)

---

## 2026-08-21 — M5_003 : flux authentifié post-séance, `supabase/functions/completed-session` (CLOSED — déployé en production, aucune migration)

**Contexte** : jusqu'ici `completed_sessions` n'avait aucun chemin d'écriture accessible à l'athlète — M5_001A avait verrouillé les écritures directes et créé `persist_completed_session` (RPC `service_role` uniquement), en anticipant explicitement "une future Edge Function M5_003". Cette tranche construit exactement cette Edge Function (`GET`/`PUT`) et la carte minimale Today associée, pour que Louis puisse reporter sa séance réellement faite (statut, durée, RPE, fatigue, douleur nouvelle) sans jamais toucher `completed_sessions` directement depuis le navigateur.

**Décision** : `supabase/functions/completed-session/` (nouveau, 3 fichiers : `deno.json`, `validation.ts`, `index.ts`), suivant exactement les conventions déjà prouvées par `daily-run` (M3) — `withSupabase({ auth: "user" })`, résolution d'athlete via `ctx.supabase`/RLS uniquement (jamais un id fourni par le client), erreurs `{ error: { code, message } }`.

**Contrats frozen re-vérifiés avant implémentation, jamais modifiés** : `persist_completed_session(uuid, jsonb)` (`20260819210000_persist_completed_session_rpc.sql`) — retourne exactement `{ completed_session_id }`, `SECURITY INVOKER`, `EXECUTE` `service_role` seul ; `compute_session_load()` (corrigé en M5_001A par `20260819213000_fix_compute_session_load_null_reset.sql`) — `session_load = actual_duration_min * rpe / 10.0` si les deux sont non-null, sinon `NULL` explicitement (vérifié empiriquement : 42×7/10=29.4, reset à `NULL` en passant à `skipped`) ; policy `completed_sessions_own_select` (M5_001A) — `authenticated` = `SELECT` seul, aucune écriture directe possible. Le preflight existant `supabase/preflight/completed_sessions_upsert_only_security_check.sql` a été **exécuté, jamais dupliqué ni modifié** — toutes les sections A–L reviennent vides (sain), confirmant qu'aucune régression n'a été introduite.

**Découverte empirique décisive — CORS/OPTIONS** : avant d'écrire le moindre code CORS, `daily-run` a été sondé directement (`curl -i -X OPTIONS .../daily-run` avec les en-têtes `Access-Control-Request-*`) : la gateway Kong répond déjà `200` avec `Access-Control-Allow-Origin: *` et tous les verbes/en-têtes autorisés, **avant même d'atteindre le code de la fonction** — `daily-run/index.ts` ne contient aucun code CORS. `completed-session` ne contient donc lui non plus **aucun code CORS/OPTIONS** — comportement identique par construction, prouvé et non supposé.

**Écart de contrat déterminant — `free_notes`** : `persist_completed_session` exige la clé `free_notes` présente à chaque appel (texte ou `null` explicite, comme les 8 autres clés nullable requises), mais le contrat client M5_003 (`validation.ts`, exemple de body du lock spec) **ne l'inclut pas du tout** dans son ensemble canonique de 12 clés. Résolu ainsi, documenté explicitement dans `validation.ts` et `index.ts` : `free_notes` n'appartient pas à la surface API M5_003 — un client qui l'envoie reçoit `400 unknown_field` (même traitement qu'un typo), jamais exposé/éditable côté browser. Aucune modification de la RPC frozen.

**Correctif décisif — préservation `free_notes` côté serveur (revue finale)** : la première implémentation envoyait `free_notes: null` à la RPC à **chaque** appel PUT — correct en création, mais destructeur en édition : `persist_completed_session` est un full-replacement strict, donc un `null` systématique aurait silencieusement écrasé toute valeur `free_notes` existante (par exemple posée par un futur outil côté coach) à la première modification d'un champ visible comme le RPE. Corrigé : avant l'appel RPC, une lecture RLS-scopée (`ctx.supabase`, lecture seule) sur `completed_sessions` filtrée par `athlete_id`+`session_date` détermine si une ligne existe déjà — absente (création) → `free_notes = null` ; présente (édition) → sa valeur exacte existante, verbatim. Le navigateur ne choisit ni ne voit jamais cette valeur. Preuve empirique dédiée dans `orchestrate.ts` : une ligne seedée directement avec `free_notes = "preserve-me"`, un PUT changeant uniquement le RPE, puis une requête DB confirmant `free_notes` toujours exactement `"preserve-me"` **et** `rpe` bien mis à jour ; preuve séparée qu'une création fraîche stocke bien `free_notes = null`.

**Correctif décisif — aucun défaut `RECOVERY` (revue finale)** : la première implémentation par défaut de `emptyCompletedSessionForm` fixait `session_type: "RECOVERY"` pour toute nouvelle séance sans decision liée — un bug potentiellement dangereux pour une future logique recommandation-vs-réel (ex. `decision.final_session = STRENGTH_A`, `completion_status = done`, `session_type` réel `RECOVERY` jamais choisi explicitement par l'athlète). Corrigé : `DailyPlanPanel` calcule maintenant, à chaque nouveau résultat `daily-run`, non seulement `decisionId` mais aussi le `session_type` coarse réellement associé — via `web/src/features/dailyPlan/trainingInterventionToSessionType.ts`, **mirror exact et vérifié** de la fonction canonique `head-coach-engine/src/mapping/trainingInterventionToDbSessionType.ts` (celle-là même utilisée par `dailyPlanToDecisionRow.ts` pour calculer `decisions.final_session` lors de la persistance réelle — confirmé par lecture directe du code de production, pas supposé). Résultat exposé via `onLiveContextChange({ decisionId, sessionType } | null)` (remplace l'ancien `onDecisionIdChange`). `emptyCompletedSessionForm(liveContext)` : `liveContext` présent → `decision_id`/`session_type` préremplis exactement ; absent → `decision_id = null` **et** `session_type = ""` (état "non sélectionné" explicite, jamais `RECOVERY` ni aucun autre type réel par défaut). `validateCompletedSessionForm` rejette `session_type === ""` — Save reste désactivé tant qu'un type n'a pas été choisi explicitement. Pour une ligne existante, `record.session_type`/`record.decision_id` l'emportent toujours sur `liveContext` (jamais écrasés en édition).

**Correctif décisif — sémantique REST : aucune charge d'entraînement inventée (revue finale n°2)** : la validation appliquait indistinctement la matrice numérique d'entraînement (durée/RPE requis) à `session_type = REST` — forçant l'athlète à inventer une durée et un RPE pour une journée de repos, alors que le contrat DB/RPC frozen M5_001A autorise déjà ces deux champs `null`. Corrigé dans `validation.ts` (`validateStatusDependentNumbers`, désormais paramétrée par `sessionType` en plus de `completion_status`) : pour `REST` + (`done` | `replaced`) → `actual_duration_min`/`rpe` doivent être `null` (fatigue optionnelle, `null` ou 0..10) ; pour `REST` + `partial` → rejeté (`400 invalid_body_for_status`, "repos partiel" n'étant pas un état M5 significatif) ; `REST` + `skipped` conserve la règle globale `skipped` inchangée (indépendante du type de séance). **Délibérément non généralisé** à `BIKE_MAINTENANCE` ni à aucun autre type de séance — seul `REST` reçoit ce traitement. Miroir client exact dans `completedSessionValidation.ts`. Côté UI (`CompletedSessionCard.tsx`) : durée/RPE masqués quand `session_type = REST` (comme pour `skipped`), fatigue reste visible et optionnelle, libellé douleur bascule sur le wording jour ("Any new pain today?") plutôt que séance. `session_load` reste `null` naturellement via le trigger DB existant (aucune modification du trigger). Preuves : 9 tests unitaires Edge, 5 tests unitaires web, 4 scénarios HTTP d'intégration (`REST + done` valide avec `session_load` `null` vérifié en DB, rejet durée non-null, `REST + replaced` valide, rejet `partial`), 3 tests composant (masquage champs, Save valide sans valeur numérique inventée, préselection REST depuis un plan `daily-run` vivant).

**Correctif décisif — cohérence decision/session_type planifié-vs-réel (revue finale n°2, corrigé une seconde fois en revue finale n°3)** : le preflight de liaison de décision ne vérifiait que l'existence et la date de la décision, jamais la cohérence entre le `session_type` soumis et le `final_session` réellement planifié par cette décision — permettant, par exemple, de reporter `decision.final_session = STRENGTH_A` comme `completion_status = done` avec `session_type = RECOVERY`, sans qu'aucune incohérence ne soit détectée. Corrigé : le même preflight RLS-scopé existant (`ctx.supabase`, aucun ajout de requête) sélectionne désormais aussi `final_session` (colonne DB réelle, déjà coarse — aucun import ni appel `head-coach-engine`). Règle appliquée uniquement quand `decision_id != null` : pour `done`/`partial`/`skipped` (session_type = ce qui était planifié/tenté) → `body.session_type === decision.final_session` requis, sinon `422 decision_session_mismatch`. **Pour `replaced`, aucune comparaison n'est faite du tout** — une première version exigeait `body.session_type !== decision.final_session`, corrigée après revue car trop stricte : `decisions.final_session` et `completed_sessions.session_type` sont tous deux des types coarse, et plusieurs `TrainingIntervention` riches distincts peuvent se projeter sur le même type coarse (ex. planifié `MOBILITY` → `decision.final_session = RECOVERY` ; remplacement réel `DH_LIGHT` → `completed_session.session_type = RECOVERY` : un remplacement légitime malgré l'égalité coarse). M5_003 ne capture pas assez de détail riche pour distinguer ces cas, et `completion_status = replaced` est déjà la déclaration explicite de l'athlète — jamais remise en cause sur la seule égalité de type coarse. `decision_session_mismatch` reste distinct et jamais confondu avec `decision_link_invalid` (réservé exclusivement à "décision inexistante/étrangère/mauvaise date"). Aucun appel RPC, aucune écriture dans les cas rejetés. `decision_id = null` continue de n'appliquer aucune comparaison. Côté client : `decision_session_mismatch` mappé comme 422 "user_fixable" (jamais `session_issue`, jamais de `signOut()`), message *"Le statut et le type de séance ne correspondent pas à la séance liée."*, formulaire préservé. Aucune récupération d'historique ni de décision supplémentaire côté client à des fins de validation — seule `liveContext.sessionType` (déjà connue) peut informer l'UX, la validation Edge restant seule autorité. Preuve empirique dédiée (`orchestrate.ts`, decision réelle avec `final_session = STRENGTH_A`), matrice finale : `done`/`partial`/`skipped` + `STRENGTH_A` → `200` ; `done`/`partial`/`skipped` + `RECOVERY` → `422 decision_session_mismatch` + zéro ligne écrite (vérifié par requête DB) ; `replaced` + `RECOVERY` → `200` ; `replaced` + `STRENGTH_A` (même type coarse que le plan) → **`200`** — ce dernier cas prouve spécifiquement qu'un remplacement à type coarse identique reste représentable, contrairement à la règle initiale trop stricte.

**Correctif — ton du rappel douleur (revue finale)** : le rappel affiché quand `new_pain = true` utilisait un style d'avertissement rouge (`border-red`/`bg-red`/`text-red`) et le texte anglais "Mention this in your next check-in…" — contraire au contrat verrouillé (informationnel seulement, jamais une implication d'escalade/traitement Safety). Corrigé : style neutre (gris, même langage visuel que le reste de l'app), texte français : *"Tu as indiqué une nouvelle douleur."* puis *"Pense à la mentionner dans ton prochain check-in afin qu'elle fasse partie des informations de readiness."* Aucune mention de "flagged"/"escalated"/"coach notified"/"plan adjusted"/Safety.

**Correctif — garde de réponse pour les champs opaques (revue finale)** : `completedSessionRepo.ts`'s `isCompletedSessionRecord` ne validait pas du tout `intervention`/`main_content` (bug — un flux d'édition qui round-trippe aveuglément ces valeurs dans un PUT full-replacement aurait pu propager une valeur malformée, voire effacer un état par ailleurs valide). Corrigé : `intervention`/`main_content` doivent être `null` ou un objet JSON simple — un tableau (ou toute autre forme) est rejeté comme `invalid_response`, jamais fait confiance tel quel.

**Correctif — séquence `persistence_readback_missing` testable (revue finale)** : ce chemin défensif n'est pas déclenchable de façon déterministe via HTTP (comme le cas ">1 athlete" de `daily-run`). Un seau minimal a été extrait — `supabase/functions/completed-session/apiErrors.ts` exporte `classifyMissingReadback()`, une fonction pure sans argument (donc rien de dynamique ne peut y fuiter — ni `athleteId`, ni `completed_session_id`, ni SQL, ni texte d'exception RPC) que `index.ts` appelle pour cette branche précise. Testée directement (Node/vitest, aucun hook de production ajouté) : forme exacte `{status:500, code:"persistence_readback_missing", message}`, et absence de toute chaîne interdite dans la sérialisation de la réponse.

**Comportement 401 audité, réutilisé, jamais dupliqué (revue finale)** : `RequireAuth.tsx` redirige déjà vers `/login` dès que `AuthContext.session` devient `null` — mais un `401` d'appel Edge Function ne modifie **pas** automatiquement cette session côté SDK ; c'est l'appel explicite `signOut()` qui la vide et déclenche la redirection (mécanisme déjà utilisé par `DailyPlanPanel` sur `action === "session_issue"`). `CompletedSessionCard` ne le faisait pas du tout. Corrigé : `useAuth().signOut()` appelé sur `action === "session_issue"`, aussi bien au chargement (`GET`) qu'à la sauvegarde (`PUT`) — même mécanisme existant, aucun second système d'authentification inventé.

**Validation stricte (`validation.ts`, portable — zéro API Deno, zéro import `npm:`/`jsr:`, testable directement par un runner Node/vitest)** : full-replacement, 12 clés canoniques toutes requises-présentes ; 7 clés interdites (`athlete_id`, `session_load`, `planned_session_id`, `id`, `created_at`, `updated_at`, `submitted_at`) détectées **avant** la classification "clé inconnue" générique (code dédié `forbidden_field`) ; matrice statut→numériques exacte (`done`/`partial`/`replaced` : `actual_duration_min` entier > 0, `rpe`/`post_leg_fatigue`/`post_grip_fatigue` entiers 0..10, tous requis ; `skipped` : `actual_duration_min`/`rpe` doivent être `null`, fatigue `null` ou 0..10) ; forme douleur (`new_pain` booléen requis, `new_pain_note` string non-vide 1..500 caractères trimmés ssi `new_pain=true`, `null` ssi `false`) ; `intervention`/`main_content` traités comme JSON opaque (objet ou `null`, jamais inspectés — aucune duplication de `TrainingIntervention` M1, aucun import `head-coach-engine`).

**Liaison de décision — aucune supposition** : `decision_id` (clé requise, `UUID | null`). Si non-null, avant tout appel RPC : requête RLS-scopée (`ctx.supabase`) `decisions` filtrée sur `id` ET `decision_date = session_date` — la présence de la ligne prouve à la fois la visibilité (RLS) et l'exactitude de la date. Absence de ligne → `422 decision_link_invalid`, **aucun appel RPC**. La RPC revalide de toute façon en autorité côté `service_role` (défense en profondeur). **Jamais** de parsing du texte d'exception PostgreSQL pour classifier une erreur — un échec RPC après un preflight local réussi devient uniformément `500 persistence_failed`, le détail brut ne sortant jamais des logs serveur.

**Lecture canonique après écriture** : après RPC réussie, relecture RLS-scopée (`ctx.supabase`, jamais fabriquée depuis le body de la requête) filtrée sur `id = completed_session_id` ET `session_date = body.session_date` (+ `athlete_id`, défense en profondeur) — absence de ligne → `500 persistence_readback_missing` (chemin défensif, non déclenché empiriquement via HTTP, comme le cas ">1 athlete" de `daily-run` lui-même). Réponse : `{ completedSession: {...15 colonnes canoniques...}, warnings: [] }`.

**`GET /functions/v1/completed-session?date=YYYY-MM-DD`** : `date` absent → `400 missing_date` (distinct de `400 invalid_date_format` pour une date malformée). Absence normale de ligne → `200 { completedSession: null }`, **jamais** `404`. Utilise `supabase.functions.invoke(\`completed-session?date=${date}\`, { method: "GET" })` (pas un `fetch` brut) — vérifié directement dans `@supabase/functions-js@2.112.3` : `functionName` est concaténé puis parsé via `new URL(...)`, donc une query string qui y est intégrée est correctement analysée ; `FunctionInvokeOptions` supporte nativement `method: "GET"`. C'est le plus petit mécanisme compatible avec le SDK déjà installé — jamais de `fetch` manuel avec en-têtes d'auth reconstruits à la main.

**UI Today** : nouvelle carte `CompletedSessionCard` sous la section Daily Plan. États empty/filled/editing/saving/error. Preselection de `decision_id` **et** `session_type` strictement limitée au contexte exact de la réponse `daily-run` **actuellement affichée dans le cycle de vie en mémoire de la page Today courante** (voir le correctif "aucun défaut RECOVERY" ci-dessus) — `DailyPlanPanel` expose `onLiveContextChange({ decisionId, sessionType } | null)`, remonté par `TodayPage` dans un state `liveContext`, remis à `null` dès que le plan affiché n'est plus courant (nouvelle génération, check-in invalidé, échec). **Aucune** recherche de "dernière décision"/historique, **aucune** persistance dans `localStorage`/`sessionStorage`. Sur édition d'une ligne existante, `record.decision_id`/`record.session_type` (les valeurs persistées) l'emportent toujours sur `liveContext`. Aucun éditeur JSON — `intervention`/`main_content` sont portés opaquement dans `CompletedSessionFormState` et toujours renvoyés verbatim dans le PUT full-replacement, jamais affichés ni modifiés.

**Tests locaux (comptes finaux, après les deux passes de correction)** :
- `head-coach-engine/tests/edge/completedSession/validation.test.ts` (70, dont 9 nouveaux — sémantique REST) + `apiErrors.test.ts` (3 — classification `persistence_readback_missing`) — **73/73**, unitaires purs (aucun Docker/Deno), important les modules par chemin relatif direct (portables) — configuration dédiée `vitest.completedSession.config.ts` + script `npm run test:completed-session`, **délibérément séparés** de `npm test` (226) et `npm run test:edge` (9) pour ne jamais en gonfler les comptes verrouillés (`vitest.edge.config.ts` resserré sur `tests/edge/errorMapping.test.ts` exactement, au lieu du glob `tests/edge/**` qui aurait sinon absorbé le nouveau dossier — conservé après revue explicite de ce diff, réellement nécessaire).
- `head-coach-engine/tests/edge/completedSession/orchestrate.ts` — **70/70**, intégration HTTP réelle contre `supabase functions serve` (nouveau helper `insertDecision` ajouté à `testDb.ts`), modélisé sur `tests/edge/http/orchestrate.ts` de `daily-run` mais **délibérément non fusionné** avec lui (aucune modification de son comportement frozen). Couvre auth/méthode/forme, les 4 matrices de statut, les 3 cas de forme douleur, les 5 cas de liaison de décision (dont "aucune ligne écrite" après un 422), create/update/id stable/`session_load` calculé par trigger/reset à `null`, lecture canonique complète, `GET` existant/absent/isolation croisée, préservation opaque bout-en-bout, préservation `free_notes` bout-en-bout (seed direct → PUT ne touchant que le RPE → DB : `free_notes` inchangé, `rpe` mis à jour ; plus une création fraîche vérifiée `null`), 4 scénarios REST (`done`/`replaced` valides avec `session_load` `null` vérifié en DB, rejet durée non-null, rejet `partial`), et la matrice finale de cohérence decision/session_type (`STRENGTH_A` planifié) : `done`/`partial`/`skipped` + `STRENGTH_A` → `200` ; `done`/`partial`/`skipped` + `RECOVERY` → `422 decision_session_mismatch` + zéro écriture (3 assertions dédiées) ; `replaced` + `RECOVERY` → `200` ; `replaced` + `STRENGTH_A` (même type coarse que le plan) → **`200`** (preuve du remplacement à type coarse identique, revue finale n°3). Deux bugs de fixture de test découverts et corrigés pendant la revue n°2 (jamais dans le code applicatif) : une décision de test sans `final_session` explicite déclenchait un faux `decision_session_mismatch` sur un scénario sans rapport, et une date de scénario de cohérence collisionnait avec la date déjà utilisée par le test `GET absent` existant — corrigés par un `final_session` explicite et l'intervalle de dates dédié `2026-09-04`..`2026-09-11`.
- `web/src/features/completedSession/completedSessionValidation.test.ts` + `CompletedSessionCard.test.tsx` + `completedSessionRepo.test.ts` — **73/73** (dont 10 nouveaux — sémantique REST côté client et `decision_session_mismatch`), couvrant état vide/rempli/édition, rappel douleur neutre (jamais rouge, jamais "flagged"/"escalated"/Safety), visibilité conditionnelle des champs par statut **et par `session_type` (REST masque durée/RPE comme `skipped`)**, bouton Save désactivé jusqu'à validité **et jusqu'à un `session_type` explicitement choisi**, libellés douleur conditionnels (séance vs jour, REST inclus), succès → résumé persisté, erreur 401/422 (`decision_link_invalid` et `decision_session_mismatch`)/500 (401 → `signOut()` réutilisé, jamais un second système ; les deux 422 → formulaire préservé, jamais de `signOut()`), champs opaques `null`/objet acceptés, tableau/chaîne rejetés comme `invalid_response`, `decision_id`/`session_type` par défaut `null`/non-sélectionné sans plan en mémoire, préselection exacte des deux quand disponible (y compris un plan REST vivant), valeurs persistées d'une ligne existante toujours prioritaires sur le contexte en mémoire.
- `DailyPlanPanel.test.tsx` (+3 tests) et `TodayPage.test.tsx` (+3 tests) — nouveau câblage `onLiveContextChange`/`liveContext` (`{decisionId, sessionType}`), tous les tests M4 existants préservés intacts.

**Régressions existantes (avec Docker)** : `head-coach-engine` `npm test` = **226/226** ; `npm run test:edge` = **9/9** ; `npm run test:m3:http` = **26/26**. `longitudinal-engine` `npm test` = **116/116** ; `npm run build` = succès propre. `web` `npm test -- --run` = **242/242** (163 existants M4 + 79 nouveaux/étendus M5_003). `web` `npm run build` = succès propre (typecheck inclus). Aucun changement `head-coach-engine/src/**`, `longitudinal-engine/src/**`, `supabase/migrations/**`, `docs/03*`/`05*`/`06*`.

**Sécurité** : preflight `completed_sessions_upsert_only_security_check.sql` exécuté localement (copié via `docker exec` dans le conteneur Postgres local, `psql` n'étant pas installé sur l'hôte) — sections A–L toutes vides (sain), section informative confirmant `authenticated`=`SELECT` seul, `service_role` conserve ses privilèges baseline complets, `persist_completed_session` reste `SECURITY INVOKER`/`service_role`-only exactement comme avant cette tranche.

**Remote** : aucune écriture, aucune migration (M5_003 n'ajoute aucune colonne/table/RPC — uniquement une Edge Function et du code applicatif). `supabase migration list --linked --project-ref uvolpldwwyvadlamulvr` reconfirme les 13 migrations local==remote, aucune dérive.

**Décision** : **M5_003 CLOSED.** `supabase/functions/completed-session` fournit un flux `GET`/`PUT` authentifié, validé strictement, sans jamais réinterpréter les exceptions RPC ni deviner une liaison de décision, au-dessus du chemin d'écriture déjà verrouillé par M5_001A — inchangé. La carte Today associée ne préselectionne un `decision_id`/`session_type` que depuis le cycle de vie en mémoire réel de la session courante (jamais un historique, jamais `RECOVERY` ou un autre type par défaut, jamais un stockage local). `free_notes` — hors surface API M5_003 — est préservé côté serveur à travers chaque édition full-replacement, jamais écrasé silencieusement. Le rappel douleur reste strictement informationnel, visuellement neutre. `REST` peut être reporté sans qu'aucune durée/RPE ne soit inventée (`done`/`replaced` → durée/RPE/`session_load` `null`). Le `session_type` soumis doit être sémantiquement cohérent avec le `final_session` de toute décision liée pour `done`/`partial`/`skipped` (égalité coarse requise) ; pour `replaced`, aucune comparaison n'est faite (voir le correctif dédié ci-dessus — l'égalité coarse ne prouve pas l'absence de remplacement). Violation → `422 decision_session_mismatch`, distinct de `decision_link_invalid`. `intervention`/`main_content` restent opaques (jamais inspectés). `completed_sessions.new_pain` reste un fait brut stocké — **aucune règle Safety n'est automatiquement déclenchée depuis `completed_sessions.new_pain` dans M5_003**, le rappel affiché n'étant qu'informationnel. `decision_id` n'est jamais inféré/déduit d'une "dernière décision" — uniquement la liaison exacte fournie par le client, revalidée côté serveur. Ceci ne couvre que le report post-séance — aucun calcul d'outcome, aucune règle Safety, aucun changement `daily-run`, aucun changement `head-coach-engine`/`longitudinal-engine`. **M5 dans son ensemble reste en cours, non complet** (milestones M5 restants non implémentés).

**État de clôture — preuves empiriques de production (revue finale n°4 — clôture)** : commit d'implémentation `c35c558` (`feat: add authenticated post-session flow`), poussé sur `origin/main`. Déploiement Supabase : `completed-session` déployée sur `uvolpldwwyvadlamulvr` via `supabase functions deploy --use-api` (même convention que `daily-run`, sans `--no-verify-jwt`) — statut `ACTIVE`, `verify_jwt: true` ; `daily-run` non retouchée ; migrations `local == remote = 13/13`, aucune dérive, aucune migration M5_003. Garde de production non authentifiée : `GET /functions/v1/completed-session` sans en-tête → `401 UNAUTHORIZED_NO_AUTH_HEADER`, avant tout accès au handler. Déploiement Vercel : scope `nalynt` / projet `louis-performance-system`, déploiement `READY`/`production`, domaine `https://louis-performance-system.vercel.app` accessible (`200`, bundle JS `200`). Smoke technique production : page/bundle chargés sans erreur. **Smoke authentifié réel, exécuté manuellement par Louis depuis l'UI de production** : connexion (PASS), carte post-séance visible (PASS), préremplissage depuis le plan vivant (PASS), sauvegarde initiale (PASS), persistance après rafraîchissement (PASS), édition + sauvegarde (PASS), persistance après rafraîchissement final (PASS), sémantique REST/charge ou séance normale (PASS), UX douleur neutre (PASS). Aucune donnée athlète de test fabriquée — uniquement la saisie réelle et véridique de Louis. Cette entrée est désormais **CLOSED**.

**Impact** : `supabase/functions/completed-session/**` (dont `apiErrors.ts`, nouveau), `head-coach-engine/tests/edge/completedSession/**` (dont `apiErrors.test.ts`, nouveau), `head-coach-engine/vitest.completedSession.config.ts` (nouveau), `head-coach-engine/vitest.edge.config.ts` (resserré, conservé après revue), `head-coach-engine/package.json` (2 scripts ajoutés), `head-coach-engine/tests/supabase/testDb.ts` (`insertDecision` ajouté), `web/src/features/completedSession/**` (dont `completedSessionRepo.test.ts`, nouveau), `web/src/features/dailyPlan/trainingInterventionToSessionType.ts` (nouveau — mirror de mapping canonique), `web/src/features/dailyPlan/DailyPlanPanel.tsx`/`.test.tsx` (`onLiveContextChange`), `web/src/pages/TodayPage.tsx`/`.test.tsx` (carte câblée avec `liveContext`), cette entrée. Aucun changement `head-coach-engine/src/**`, `longitudinal-engine/src/**`, `supabase/migrations/**`, `docs/03*`/`05*`/`06*`, aucune migration.

**Statut** : **CLOSED** — committé (`c35c558`), poussé sur `origin/main`, `completed-session` déployée et `ACTIVE` sur `uvolpldwwyvadlamulvr`, production web déployée (`nalynt`/`louis-performance-system`, `READY`), smoke test authentifié réel exécuté et PASS par Louis ; M5 dans son ensemble reste en cours (milestones M5 restants non implémentés)

---

## 2026-08-23 — M5_004 : calculateur d'outcomes de décision déterministe, `longitudinal-engine/src/calculators/**` + `src/supabase/outcomeOrchestrator.ts` (CLOSED, aucun déploiement — par conception)

**Contexte** : `decision_outcomes`/`persist_decision_outcome` (M5_001B) et `AthleteTimeline` (M5_002A/B) existaient déjà, mais aucun calculateur ne produisait encore d'observation réelle. M5_004 ajoute un calculateur pur, déterministe, répondant uniquement à « que s'est-il passé après cette décision » — jamais « était-ce une bonne décision », jamais une interprétation planifié-vs-réel (réservée à M5_005), jamais un score composite.

**Unité de calcul et ancrage** : `decision.decisionDate` (jamais `computedAt`). Trois sémantiques temporelles distinctes et versionnées, jamais une fenêtre unique : réponse subjective (check-in) = jour calendaire exact `targetDate = decisionDate + {1,3,7}` ; exécution = relation explicite `decision_id` (pas de date/fenêtre), anchée sur `decisionDate`, donc identique pour J+1/J+3/J+7 d'une même décision (comportement attendu, pas une redondance) ; contexte santé = fenêtre cumulative `(decisionDate, targetDate]` plus deux lectures ponctuelles.

**Sémantique de liaison d'exécution — correction déterminante (revue finale de verrouillage)** : la première conception traitait « aucun lien explicite » comme `missing_observation`, ce qui aurait ignoré qu'une vraie séance same-day non liée (`completed_sessions.decision_id = null`, autorisé par M5_003) est un fait different de « rien n'a été rapporté ». Corrigé en quatre états de relation bruts, jamais interprétés comme adhérence : `explicit` / `no_completed_session` / `same_day_session_unlinked` / `same_day_session_linked_elsewhere` — dérivés en croisant deux vues canoniques indépendantes (`AthleteDay(decisionDate).completedSessions`, datée, et `DecisionThread.linkedCompletedSessions`, par `decision_id`), jamais l'une sans l'autre. Tout désaccord entre les deux vues échoue fort (`InconsistentExecutionLinkError`), jamais réparé en choisissant l'une des deux. `deferred_beyond_horizon` (état initial pour « lié mais daté après l'horizon ») est supprimé : sous le contrat gelé M5_001A/M5_003, une session explicitement liée a toujours `session_date === decision_date` — une date différente est un état source incohérent (`InconsistentExecutionDateError`), jamais un état légitime.

**Résolution du calculateur — jamais une identité de référence JS (revue finale)** : l'API accepte `decisionId` (chaîne) et `observedThroughDate`, jamais un `DecisionThread` pré-résolu par l'appelant. Résolution interne par égalité de valeur (`thread.decision.id === decisionId`) sur `timeline.decisionThreads`, jamais `.includes()` ni comparaison de référence — `DecisionNotFoundInTimelineError` si absent, `DuplicateDecisionThreadError` si plus d'un match (structurellement improbable, gardé en défense).

**`observedThroughDate` remplace `asOfDate` (revue finale)** : signifie « dernière date que l'appelant déclare entièrement close/observable », jamais « aujourd'hui » — jamais dérivé de l'horloge dans ce package. Maturité : `targetDate <= observedThroughDate`. Validé comme une vraie date calendaire via un primitif réutilisé de `timeline/range.ts` (`parseCanonicalDateUtc`/`formatUtcMs`/`MS_PER_DAY`, désormais exportés pour réutilisation interne, comportement inchangé) plutôt que réécrit — rejet déterministe (`InvalidObservedThroughDateError`) pour une date malformée/impossible.

**Correctif — ordre de validation dans l'orchestrateur (reprise post-Docker)** : `calculateDecisionOutcomeSnapshot` validait déjà `observedThroughDate`, mais `calculateAndPersistOutcomes` appelait `isHorizonMature(targetDate, observedThroughDate)` en pré-filtre **avant** tout appel au calculateur — une date malformée/non-canonique pouvait donc être silencieusement absorbée par une simple comparaison de chaînes et finir comptée `skippedImmature`, sans jamais atteindre la validation. Corrigé : `calculateAndPersistOutcomes` appelle désormais `validateObservedThroughDate(observedThroughDate)` en tout premier, avant toute itération decision/horizon, toute comparaison de maturité, tout court-circuit d'existence et tout appel RPC — une entrée invalide lève `InvalidObservedThroughDateError` directement (zéro calcul tenté, zéro appel RPC, zéro écriture), jamais convertie en `skippedImmature` ni en entrée `errors[]` (c'est une erreur globale d'entrée appelant, pas un état par item). Preuve dédiée, sans Docker : `tests/unit/supabase/outcomeOrchestrator.validation.test.ts`, un client Supabase factice dont `rpc()` lève si jamais appelé.

**Invariant de couverture du timeline (revue finale)** : avant toute classification d'un signal ancré sur `targetDate`, `targetDate` doit être dans `timeline.range` — sinon `OutcomeTimelineCoverageError`, jamais une conversion silencieuse en `missing_observation` (l'absence de donnée n'est prouvée que si elle a réellement été chargée). Le contexte d'exécution est exempté par construction (ancré sur `decisionDate`, déjà garanti dans le range par l'existence même du `DecisionThread`). Garde structurelle additionnelle : une fois `targetDate` prouvée dans le range, exactement un `AthleteDay` doit exister pour cette date (M5_002B en matérialise un par date) — zéro ou plusieurs est un timeline malformé (`InconsistentTimelineDayError`), jamais traité comme « zéro check-in ».

**Baseline — jamais une recherche de proximité (revue finale)** : exactement `DecisionThread.linkedSourceCheckin`, jamais « le check-in le plus proche ». Un lien explicite dont le `checkinDate` diffère de `decisionDate` échoue fort (`InconsistentBaselineCheckinError`) plutôt que de produire un delta trompeur calculé depuis un autre jour.

**Signaux de réponse V1** : `energy`, `legFatigue`, `gripFatigue`, `motivation`, `workStress`, `pain`, `painIntensity`, `illness` (← `feverOrIllness`), `suspectedConcussion`, **`sleepHours`/`sleepQuality`/`sleepWakeUps`** (ajoutés en verrouillage final — faits descriptifs bruts, aucun score de sommeil, aucun delta de sommeil en V1). Aucun score de readiness composite nulle part. `false`/`0` sont toujours préservés comme `observed`, jamais confondus avec `missing_observation`.

**Deltas** : `energyDelta`/`legFatigueDelta`/`gripFatigueDelta`/`painIntensityDelta`, calculés seulement si baseline ET cible sont `observed` avec valeur numérique ; sinon `unavailable` avec une raison explicite (`baseline_missing`/`baseline_field_null`/`target_missing`/`target_field_null`) — jamais `0` par défaut.

**Contexte santé** : `activeOnTargetDate`/`newSinceDecision`/`unresolvedAtTarget`, strictement dérivés des dates (`flagDate`/`resolvedAt`), **jamais** du `status` courant/live du flag (inclus dans le snapshot comme simple fait brut, jamais utilisé pour la classification historique). `unresolvedAtTarget` est un sous-ensemble intentionnel de `activeOnTargetDate`. Aucun nouvel export public sur `timeline/index.ts` pour réutiliser `isFlagActiveOnDay` — consommé par import relatif interne (même package), surface publique de M5_002B inchangée.

**Identité du calculateur** : `calculator_id = "post_decision_snapshot"` (nom challengé et changé depuis l'exemple `longitudinal_response` du brief — couvre exécution + réponse + santé, pas seulement la réponse), `calculator_version = "1.0.0"`, `outcome_signals.schemaVersion = 1`. Jamais dérivés de `package.json`, d'un hash git, de la date courante, ou d'une révision de ligne source.

**Politique snapshot immuable / source éditable (verrouillée)** : une ligne `decision_outcomes` persistée est un instantané historique immuable des faits disponibles au **premier calcul mature réussi** — pas nécessairement les faits qui existaient à l'instant exact où l'horizon est devenu mature (M5_004 n'a aucun scheduler automatique ; si la première persistance survient plus tard, elle capture la vérité source telle que fournie à ce moment-là). Si une source est éditée après coup : la ligne persistée ne change jamais, aucun recalcul automatique, **aucun bump artificiel de `calculator_version`** pour représenter une édition de donnée athlète — cette identité reste réservée à un changement réel de sémantique de calcul. `input_snapshot` + `calculated_at` (géré par la DB) constituent l'unique enregistrement d'audit. Un futur modèle correction-aware nécessiterait un vrai schéma de révision/supersession — explicitement hors périmètre M5_004, **aucune migration**.

**Orchestration — `src/supabase/outcomeOrchestrator.ts`** : seul module du package touchant Supabase pour les outcomes ; ne recharge jamais les faits sources, ne reconstruit jamais le timeline (fournis par l'appelant), n'écrit jamais directement `decision_outcomes` (uniquement via la RPC gelée `persist_decision_outcome`). Court-circuit d'existence via le timeline canonique lui-même (`DecisionThread.outcomesByHorizon[horizon]`, déjà chargé par M5_002B) — **aucun SELECT Supabase redondant** ajouté pour ce test. Pré-filtrage de maturité par simple comparaison de dates (`targetDateForHorizon`/`isHorizonMature`, réutilisés — jamais un contrôle de flux par exception). Identité athlète unique : `timeline.athleteId`, jamais un second paramètre `athleteId` fourni par l'appelant. Résultat nommé `writeSucceeded` (pas `persisted`/`inserted`) — une RPC réussie ne prouve pas nécessairement un INSERT frais (le chemin idempotent de la RPC peut renvoyer succès pour un rejeu exact). `>1` outcomes déjà persistés pour la même clé dans le timeline fourni échoue fort (`DuplicatePersistedOutcomeError`, structurellement impossible via la contrainte DB mais gardé en défense) — jamais résolu en choisissant un doublon.

**Aucun déclencheur (verrouillé)** : ni scheduler, ni cron, ni hook `daily-run`, ni hook post-check-in, ni Edge Function utilisateur, ni calcul paresseux navigateur. M5_004 fournit une capacité de calcul/persistance appelable — **pas encore** de garantie de peuplement automatique en production ; le câblage d'un déclencheur réel est explicitement une tranche future.

**Tests** : `longitudinal-engine` non-DB = **162/162** (100 M5_002B existants inchangés + 59 `tests/unit/calculators/decisionOutcomeSnapshot.test.ts`, dont le nouveau test isolant `linkedCompletedSessions.length > 1` via de vraies fixtures `buildTimeline` — deux sessions liées à la même décision sur des jours différents, jamais reliées via une manipulation à la main — + 3 `tests/unit/supabase/outcomeOrchestrator.validation.test.ts` prouvant `InvalidObservedThroughDateError` avant tout accès Supabase). Couverture : résolution de décision, bornes exactes J+1/J+3/J+7, validation `observedThroughDate`, maturité, couverture de range, garde structurelle de jour, cardinalité de check-in cible, fidélité brute des signaux de réponse (`false`/`0` préservés), sommeil, baseline (absente/champ null/valide/date incohérente), deltas (calculé + 4 raisons `unavailable`), les 4 états d'exécution, 6 scénarios de cohérence d'exécution (5 timelines volontairement malformés à la main + 1 cardinalité `reverseLinked` via de vraies fixtures), contexte santé (y compris `status` live délibérément contredit par les dates), décisions multiples le même jour, déterminisme après mélange des tableaux sources. `npm run build` : succès propre. `npx tsc --noEmit` (src + tests) : succès propre.

**Preuve DB-dépendante — CONFIRMÉE, après réparation Docker/WSL (reprise de session)** : Docker Desktop et WSL ont été réparés côté machine entre les deux tranches de cette entrée (`wsl --list --verbose` → `docker-desktop` `Running` ; `docker info` répond intégralement). `npx supabase start` + `npx supabase db reset` : 13 migrations appliquées proprement, aucune écriture remote. `tests/supabase/outcomeOrchestrator.integration.test.ts` : **9/9** (aucune maturité → zéro écriture ; J+1 seul → un outcome ; J+1+J+3 → deux ; les trois horizons → trois ; court-circuit sur outcome déjà présent dans le timeline chargé, aucune écriture redondante ; ré-appel de l'orchestrateur → idempotent, aucun doublon ; doublon persistant sur timeline synthétique → `DuplicatePersistedOutcomeError` surfacé, écriture refusée pour cette clé ; rejet cross-athlete par la RPC gelée elle-même ; isolation athlète confirmée). Suite complète `longitudinal-engine` `npm test` = **187/187** (162 non-DB + 16 `adapter.integration.test.ts` M5_002A existants + 9 nouveaux orchestrateur), `npm run build` = succès.

**Régressions confirmées (Docker disponible)** : `head-coach-engine` `npm test` (M1/M2) = **226/226** (les 37 échecs de la tentative précédente confirmés purement infrastructurels, disparus après réparation) ; `npm run test:edge` = **9/9** ; `npm run test:m3:http` = **26/26** (premier passage flaky sur conteneur edge-runtime venant de démarrer après un `db reset` frais — pattern déjà documenté pour ce harness — vert au second passage, aucune modification de code) ; `npm run test:completed-session` = **73/73** ; `npm run test:m5:completed-session:http` = **70/70**. `web` `npm test -- --run` = **242/242**, `npm run build` = succès. Aucun changement `head-coach-engine/src/**`/`web/**` dans cette tranche (confirmé par `git status`) — toutes ces suites étaient déjà vertes avant M5_004, reconfirmées inchangées.

**Sécurité — preflight exécuté (local, réel)** : `supabase/preflight/decision_outcomes_append_only_security_check.sql` — toutes les sections de détection de problème reviennent vides (0 ligne). Grants confirmés exactement : `authenticated` = `SELECT` seul (aucun `INSERT`/`UPDATE`/`DELETE`) ; `service_role` = `INSERT` + `SELECT` seuls (jamais `UPDATE`/`DELETE`). `persist_decision_outcome` : `security_definer = false` (SECURITY INVOKER confirmé), `anon_can_execute = false`, `authenticated_can_execute = false`, `service_role_can_execute = true`. Contrat M5_001B intact, rien modifié. **Sécurité statique** (inchangée depuis la première passe) : scan `calculators/**` pour `Date.now`/`new Date(`/`Math.random`/`process.env`/`@supabase`/`fetch`/accès fichier — zéro occurrence réelle ; `tests/unit/boundaries.test.ts` reconfirme zéro import `head-coach-engine` dans tout `src/**` ; scan de secrets — rien trouvé ; `git diff --check` propre ; périmètre de fichiers modifiés strictement conforme, aucun chemin protégé touché.

**Migrations — parité remote reconfirmée, lecture seule** : projet lié reconfirmé exactement `uvolpldwwyvadlamulvr` (`supabase/.temp/project-ref`). `npx supabase migration list --linked --project-ref uvolpldwwyvadlamulvr` : **13/13**, `local == remote` pour chacune, aucune dérive. Aucun `db push`, aucune migration déployée, aucune écriture SQL remote.

**Décision** : **M5_004 CLOSED.** Commit d'implémentation `f4fcb16` (`feat: add deterministic decision outcomes`), poussé sur `origin/main`. Le calculateur (`longitudinal-engine/src/calculators/**`) et l'orchestrateur de persistance (`src/supabase/outcomeOrchestrator.ts`) implémentent l'architecture verrouillée : identité `calculator_id = "post_decision_snapshot"` / `calculator_version = "1.0.0"` / `schemaVersion = 1` ; ancrage `decisionDate` ; quatre états d'exécution bruts jamais interprétés comme adhérence (`explicit`/`no_completed_session`/`same_day_session_unlinked`/`same_day_session_linked_elsewhere`), dérivés en croisant `AthleteDay(decisionDate).completedSessions` et `DecisionThread.linkedCompletedSessions` — tout désaccord entre les deux vues échoue fort ; invariant de couverture de timeline ; validation `observedThroughDate` en tout premier dans l'orchestrateur, avant toute itération decision/horizon, toute comparaison de maturité, tout court-circuit d'existence et tout appel RPC ; baseline exclusivement `DecisionThread.linkedSourceCheckin`, jamais une inférence de proximité ; faits de réponse bruts indépendants (dont le sommeil), aucun score de readiness/sommeil ; deltas avec raisons `unavailable` explicites, jamais `0` par défaut ; cycle de vie santé strictement dérivé des dates, jamais du `status` courant.

**Politique de snapshot immuable (rappel de clôture)** : **les `decision_outcomes` persistées sont des instantanés historiques immuables, jamais des vues automatiquement synchronisées sur des lignes sources éditées ultérieurement.** Aucun recalcul automatique après édition de source, aucun bump artificiel de `calculator_version`. Un futur modèle correction-aware nécessiterait un vrai schéma de révision/supersession — hors périmètre M5_004.

**Portée de clôture — absence intentionnelle de déclencheur automatique** : contrairement à M5_003, M5_004 n'a **aucun** point de contrôle de déploiement production — c'est voulu. Le périmètre gelé fournit un calculateur pur déterministe + un orchestrateur de persistance service-role testé ; il ne fournit explicitement **pas** de scheduler automatique, de déclencheur de peuplement production, d'Edge Function utilisateur, ni d'intégration `daily-run`. L'absence de peuplement automatique en production est une limite de périmètre documentée, **pas** un blocage de clôture — la clôture ne dépend que de : commit d'implémentation sur `origin/main`, toutes les preuves empiriques enregistrées, dépôt propre. Ces trois conditions sont remplies. **M5 dans son ensemble reste EN COURS** — M5_005+ restent à implémenter, aucune sémantique d'interprétation (détecteurs, evidence, recommandation-vs-réel), aucun changement Safety.

**Preuves empiriques finales** : `longitudinal-engine` — calculateur unitaire 59/59, non-DB 162/162, intégration orchestrateur 9/9, suite complète 187/187, build PASS. Régressions gelées avec Supabase disponible : M1/M2 = 226/226, edge = 9/9, M3 HTTP = 26/26 (premier passage flaky sur conteneur edge-runtime venant de démarrer après un `db reset` frais, vert au second passage sans aucune modification de code — non classé comme régression produit), completed-session unit = 73/73, completed-session HTTP = 70/70, web = 242/242, web build = PASS. `decision_outcomes_append_only_security_check.sql` = PASS (toutes sections vides, grants exacts, RPC `SECURITY INVOKER`/`service_role`-only confirmés). Migrations `local == remote = 13/13`, aucune dérive, projet lié reconfirmé `uvolpldwwyvadlamulvr`, aucune migration ajoutée, aucune écriture remote.

**Impact** : `longitudinal-engine/src/calculators/**` (nouveau), `longitudinal-engine/src/supabase/outcomeOrchestrator.ts` (nouveau, validation `observedThroughDate` en tête de fonction), `longitudinal-engine/src/supabase/index.ts` (exports ajoutés), `longitudinal-engine/src/index.ts` (export ajouté), `longitudinal-engine/src/timeline/range.ts` (3 primitifs internes exportés pour réutilisation, comportement inchangé — `timeline/index.ts` non touché), `longitudinal-engine/tests/unit/calculators/**` (nouveau, 59 tests), `longitudinal-engine/tests/unit/supabase/outcomeOrchestrator.validation.test.ts` (nouveau, 3 tests), `longitudinal-engine/tests/supabase/outcomeOrchestrator.integration.test.ts` (nouveau, 9 tests, exécutés et verts), cette entrée. Aucun changement `head-coach-engine/src/**`, `web/**`, `supabase/functions/**`, `supabase/migrations/**`, `docs/03*`/`05*`/`06*`, aucune migration.

**Statut** : **CLOSED** — committé (`f4fcb16`), poussé sur `origin/main`, toutes les preuves empiriques (pures + DB-dépendantes) au vert, aucune migration ajoutée, **aucun déploiement production — par conception** (pas de scheduler, pas de déclencheur de peuplement automatique, pas d'Edge Function utilisateur, pas d'intégration `daily-run` : périmètre M5_004 volontairement limité au calculateur + à l'orchestrateur de persistance testé) ; M5 dans son ensemble reste EN COURS (M5_005+ restants non implémentés)

---

## 2026-08-23 — M5_005 : détecteur recommandation-vs-exécution réelle, `longitudinal-engine/src/detectors/**` + extraction `src/relations/**` (CLOSED, aucune persistance — par conception, différée à M5_006)

**Contexte** : M5_004 a démontré comment observer objectivement ce qui s'est passé après une décision. M5_005 ajoute la première couche d'interprétation déterministe : « l'exécution enregistrée soutient-elle, contredit-elle, ou est-elle neutre vis-à-vis de la recommandation » — jamais « était-ce une bonne décision », jamais une recommandation de coaching, jamais un agrégat/pattern (réservé à M5_006+).

**Extraction du résolveur d'exécution partagé — zéro changement de sémantique M5_004** : la logique `resolveExecution` de M5_004 (cardinalités same-day/reverse-link, invariant de date du lien explicite, cohérence bidirectionnelle, classification à 4 états) a été extraite verbatim vers `longitudinal-engine/src/relations/executionRelationship.ts` (`resolveExecutionRelationship({timeline, decisionId})`), avec deux primitives partagées associées (`resolveDecisionThreadById`, `resolveUniqueDay`, également déplacées depuis leurs équivalents privés M5_004). `ExecutionSignal`, `InconsistentExecutionLinkError`, `InconsistentExecutionDateError`, `InconsistentTimelineDayError`, `DecisionNotFoundInTimelineError` et `DuplicateDecisionThreadError` ont déménagé vers `relations/types.ts`/`relations/errors.ts` (domaine partagé calculateur ↔ détecteur) et sont ré-exportés verbatim (même identité de classe, `instanceof` toujours valide) depuis `calculators/types.ts`/`calculators/errors.ts` — **aucune rupture de la surface d'import M5_004 existante**, aucun consommateur en aval cassé, aucune dépendance circulaire (`relations/**` n'importe jamais `calculators/**`). Preuve empirique : suite calculateur **59/59** et suite complète **187/187** identiques avant et après l'extraction (baseline pré-refactor puis post-refactor, aucune régression), `calculator_id`/`calculator_version`/`schemaVersion` inchangés (`post_decision_snapshot`/`1.0.0`/`1`), aucun bump de version.

**Résolution de décision réutilisée, jamais divergente** : le détecteur résout sa propre `DecisionThread` via `resolveDecisionThreadById` (pour `decision.athleteId`/`decisionDate`/`finalSession`), puis appelle `resolveExecutionRelationship` (qui refait en interne la même résolution partagée, par construction jamais divergente) — un petit doublon de calcul volontaire plutôt que d'accepter un `DecisionThread` pré-résolu en paramètre public (rejeté explicitement, même discipline que M5_004 : jamais un objet complexe fourni par l'appelant, seulement `decisionId`).

**Identité du détecteur** : `detectorRuleId = "recommendation_vs_actual_execution"`, `detectorRuleVersion = "1.0.0"`. Jamais dérivés de `package.json`, d'un hash git, de la date courante, ou d'une révision de ligne source.

**Correctif — noms publics de constantes non génériques (revue finale)** : la première implémentation exposait `DETECTOR_RULE_ID`/`DETECTOR_RULE_VERSION` comme noms publics — génériques et donc voués à collisionner dès qu'un second détecteur rejoindrait `detectors/**`. Corrigé : noms publics spécifiques `RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID`/`RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_VERSION` (valeurs runtime inchangées : `"recommendation_vs_actual_execution"`/`"1.0.0"`), avec un alias local générique (`RULE_ID`/`RULE_VERSION`, via `import ... as`) strictement interne au module détecteur lui-même. Vérifié par scan statique : aucune occurrence de `DETECTOR_RULE_ID`/`DETECTOR_RULE_VERSION` nulle part dans `src/**`/`tests/**` hors commentaires de documentation expliquant le rejet de ce nom.

**Correctif — type de résultat public canonique (revue finale)** : le type d'union `RecommendationVsActualResult` renommé `RecommendationVsActualDetection` — le nom canonique verrouillé par l'architecture, adopté directement (aucun alias de compatibilité nécessaire, rien n'étant encore committé).

**Correctif — `detectorRuleId` littéral, pas `string` (revue finale)** : `RecommendationVsActualEvidence.detectorRuleId` et `RecommendationVsActualNoEvidence.detectorRuleId` typés `RecommendationVsActualRuleId` (`"recommendation_vs_actual_execution"` littéral), plus fort que `string` — un appelant ne peut plus construire de valeur à la compilation avec un `detectorRuleId` incorrect. `detectorRuleVersion` reste `string` (une version future changera de valeur, contrairement à l'id de règle).

**Matrice de classification (exacte, verrouillée)** : `explicit`+`done`+type correspondant → `supporting` ; `explicit`+`partial`+type correspondant → `neutral` ; `explicit`+`skipped`+type correspondant → `contradicting` ; `explicit`+`replaced` → toujours `contradicting`, que le type corresponde ou non (aucune exigence d'inégalité — un type identique reste un remplacement légitime, cf. M5_003). Pour `done`/`partial`/`skipped`, une incohérence de type (`sessionType !== decision.finalSession`) est une **erreur structurelle** (`CompletionStatusTypeMismatchError`), **jamais une preuve** — seul `replaced` tolère un désaccord de type.

**Sémantique no_evidence (exacte)** : `no_completed_session`/`same_day_session_unlinked`/`same_day_session_linked_elsewhere` se traduisent chacun en `{kind:"no_evidence", reason:<même nom d'état>}` — jamais un `eventType`, jamais neutre, jamais une contradiction, jamais une preuve de pattern. Une session same-day non liée dont le type correspond au recommandé n'est **jamais** interprétée comme un lien implicite — le rattachement `decision_id` reste la seule source de vérité.

**Zéro consommation santé/course/plan** : le détecteur ne touche **que** `decision.id`/`athleteId`/`decisionDate`/`finalSession` et (si état `explicit`) `execution.completedSessionId`/`sessionType`/`completionStatus`. Aucun accès à `dailyPlan`, `activeMode`, `confidenceLevel`, aux check-ins, aux health flags, aux `decision_outcomes` — prouvé par test dédié (dailyPlan/activeMode/checkins/health flags variés → résultat `deep-equal`).

**Schémas exacts (verrouillés)** : evidence = exactement 9 champs top-level (`kind`, `detectorRuleId`, `detectorRuleVersion`, `evaluationKey`, `evidenceKey`, `eventType`, `eventDate`, `observedValue`, `sourceRefs`) ; `observedValue` = exactement 8 champs (dont `executionState` toujours littéral `"explicit"`, `typeMatchesRecommendation` booléen) ; `sourceRefs` = exactement 2 champs (`decisionId`, `completedSessionId`). no_evidence = exactement 6 champs (`kind`, `detectorRuleId`, `detectorRuleVersion`, `evaluationKey`, `eventDate`, `reason`) — jamais `evidenceKey`/`observedValue`/`sourceRefs`/`eventType`.

**Sémantique des clés** : `evaluationKey = "decision:${decision.id}"` (présent sur les deux formes de résultat) ; `evidenceKey = "decision:${decision.id}:completion:${completedSessionId}"` (evidence uniquement). Jamais de hash, jamais l'état/type/timestamp dans la clé.

**Sémantique d'édition de source — prouvée, jamais résolue par M5_005** : `skipped → done` sur la même relation produit `evaluationKey` identique, `evidenceKey` identique, `eventType`/`observedValue` **différents** (prouvé par test). Une édition de champs non consommés (rpe, durée, fatigue, douleur, `intervention`/`mainContent`, notes) produit un résultat **strictement `deep-equal`**. Si la relation explicite disparaît (`decision_id` mis à `null`), le résultat bascule `evidence → no_evidence` avec `evaluationKey` inchangé. **M5_005 n'implémente aucune politique de persistance pour ces variations** — c'est une question explicitement laissée à M5_006.

**Question ouverte M5_006 — persistance append-only non résolue** : M5_005 expose délibérément le fait qu'une même `evidenceKey` peut correspondre à un `eventType`/`observedValue` différent selon le moment du calcul (après édition de la source). M5_006 **devra** choisir une politique de persistance compatible append-only avant d'écrire la moindre evidence en base — options ouvertes : gel de la première valeur (freeze-first, même politique que `decision_outcomes`/M5_001B), un schéma de révision/supersession explicite, ou une autre conception compatible append-only. M5_005 n'implémente **aucune** de ces options — aucun `sourceRevision`, aucun compteur de révision, aucun hash de contenu, aucune table de persistance, aucune RPC.

**Tests** : suite calculateur M5_004 inchangée **59/59** (pré- et post-refactor identiques, également reconfirmée après la revue de correctifs finale). Tests résolveur partagé `tests/unit/relations/executionRelationship.test.ts` = **15/15** (4 états canoniques, retour brut `CompletedSessionOnDay` en `sameDaySession`, désaccord reverse-link, date explicite erronée, `>1` same-day, `>1` reverse-link, résolution par valeur jamais par référence). Tests détecteur `tests/unit/detectors/recommendationVsActualExecution.test.ts` = **31/31** (29 initiaux + 2 ajoutés en revue finale : non-consommation explicite de `sessionLoad`, non-consommation explicite de `decision_outcomes`) — couvrant la matrice de classification complète, 3 erreurs structurelles de type, 4 cas no_evidence, décisions multiples le même jour, décision absente/dupliquée/hors-scope athlète, ensembles de clés exacts pour evidence/observedValue/sourceRefs/no_evidence, édition de source `skipped→done` et `done→skipped→done`, édition de champs non consommés (dont `sessionLoad`), disparition de la relation explicite, zéro consommation santé/plan/check-in/`decision_outcomes`, tableaux sources mélangés **et** réordonnancement post-construction de `decisionThreads`/`days`/`linkedCompletedSessions`/`completedSessions` du timeline canonique lui-même, appels répétés identiques. `npm run build` (`longitudinal-engine`) : succès propre. `npx tsc --noEmit` : succès propre. Suite complète `longitudinal-engine` `npm test` = **233/233** (208 non-DB + 16 intégration adapter M5_002A + 9 intégration orchestrateur M5_004, tous préexistants et inchangés).

**Régressions gelées (Supabase disponible, reconfirmées après la revue de correctifs finale)** : M1/M2 = **226/226**, edge = **9/9**, M3 HTTP = **26/26**, completed-session unit = **73/73**, completed-session HTTP = **70/70**, web = **242/242**, web build = PASS. M5_005 n'ajoute aucun comportement DB — aucun nouveau preflight de sécurité requis. Migrations `local == remote = 13/13` reconfirmées en lecture seule, projet lié `uvolpldwwyvadlamulvr`, aucune migration ajoutée, aucune écriture remote.

**Sécurité statique** : scan `relations/**`/`detectors/**` pour `Date.now`/`new Date(`/`Math.random`/`process.env`/`@supabase`/`fetch`/accès fichier/`crypto` — zéro occurrence réelle (mentions en commentaires de documentation uniquement). Scan de secrets — rien trouvé. `git diff --check` propre. Périmètre de fichiers modifiés strictement conforme, aucun chemin protégé touché.

**Décision** : **M5_005 CLOSED.** Commit d'implémentation `f445fb0` (`feat: add recommendation execution detector`), poussé sur `origin/main`. Le résolveur partagé (`relations/**`) et le détecteur (`detectors/**`) implémentent l'architecture verrouillée : identité `post_decision_snapshot`/`1.0.0` M5_004 inchangée, identité détecteur publique spécifique (`RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID`/`_VERSION` = `"recommendation_vs_actual_execution"`/`"1.0.0"`, jamais un nom générique `DETECTOR_RULE_*`), type de résultat public canonique `RecommendationVsActualDetection`, `detectorRuleId` typé littéral à la compilation, matrice de classification exacte, sémantique no_evidence jamais confondue avec une preuve, zéro consommation santé/plan/check-in/`decision_outcomes` (`sessionLoad` inclus dans les champs non consommés prouvés), clés `evaluationKey`/`evidenceKey` déterministes.

**Portée de clôture — absence intentionnelle de persistance** : M5_005 ne nécessite **aucune** migration, écriture DB, déploiement Edge/Vercel, smoke production, ni scheduler — c'est voulu. Le périmètre gelé fournit un résolveur d'exécution partagé + un détecteur pur déterministe ; il ne persiste rien. L'absence de persistance des evidences n'est **pas** un blocage de clôture — la clôture ne dépend que de : commit d'implémentation sur `origin/main`, toutes les preuves empiriques enregistrées, dépôt propre. Ces trois conditions sont remplies.

**Question ouverte M5_006 — toujours explicitement NON résolue** : la même `evidenceKey` peut correspondre à un `eventType`/`observedValue` différent selon le moment du calcul, si le contenu source est édité après coup (`skipped → done` par exemple). **M5_006 devra choisir une politique de persistance compatible append-only avant d'écrire la moindre evidence en base** — options ouvertes : gel de la première valeur (freeze-first, même politique que `decision_outcomes`/M5_001B), un schéma de révision/supersession explicite, ou une autre conception compatible append-only. Cette question n'est **pas** résolue par la clôture de M5_005 — elle reste entièrement ouverte pour M5_006.

**M5 dans son ensemble reste EN COURS** — M5_006+ restants (persistance des evidences, agrégation, patterns).

**Impact** : `longitudinal-engine/src/relations/**` (nouveau — `types.ts`, `errors.ts`, `decisionLookup.ts`, `dayLookup.ts`, `executionRelationship.ts`, `index.ts`), `longitudinal-engine/src/detectors/**` (nouveau — `constants.ts`, `errors.ts`, `types.ts`, `recommendationVsActualExecution.ts`, `index.ts`), `longitudinal-engine/src/calculators/decisionOutcomeSnapshot.ts` (refactorée pour consommer le résolveur partagé, zéro changement de comportement), `longitudinal-engine/src/calculators/errors.ts`/`types.ts` (ré-exports de compatibilité), `longitudinal-engine/src/index.ts` (export `detectors/**` ajouté ; `relations/**` délibérément non ré-exporté au niveau racine pour éviter une collision de star-export avec les mêmes noms déjà ré-exportés via `calculators/index.ts`), `longitudinal-engine/tests/unit/relations/**` (nouveau, 15 tests), `longitudinal-engine/tests/unit/detectors/**` (nouveau, 31 tests), cette entrée. Aucun changement `head-coach-engine/src/**`, `web/**`, `supabase/functions/**`, `supabase/migrations/**`, `docs/03*`/`05*`/`06*`, aucune migration.

**Statut** : **CLOSED** — committé (`f445fb0`), poussé sur `origin/main`, toutes les preuves empiriques (pures + DB-dépendantes) au vert, aucune migration ajoutée, **aucune persistance — par conception, différée à M5_006** (question de politique append-only explicitement laissée ouverte, non résolue par cette clôture) ; M5 dans son ensemble reste EN COURS (M5_006+ restants non implémentés)

---

## 2026-08-25 — M5_006A : fondation de persistance des evidences détecteur, `pattern_evidence_identities/_revisions/_source_refs` + `persist_pattern_evidence` + `longitudinal-engine/src/persistence/**` (CLOSED — déployé sur `uvolpldwwyvadlamulvr`)

**Contexte** : M5_005 a répondu à la question ouverte qu'il avait lui-même posée — « comment persister une evidence de détecteur de façon compatible append-only quand la même relation peut produire un `eventType`/`observedValue` différent après édition de la source ». M5_006A implémente la réponse : un schéma en trois tables (identité stable + révisions immuables numérotées + provenance normalisée), une RPC atomique unique, trois vues de lecture, et l'adaptateur de persistance pour M5_005 exclusivement. Explicitement **hors périmètre** : détecteurs sommeil-énergie/douleur/grip, agrégation, patterns appris, transitions de revue, Edge Function, scheduler, intégration `daily-run`, UI.

**Modèle identité / révision / provenance** : `pattern_evidence_identities` porte la clé stable `(athlete_id, detector_rule_id, detector_rule_version, evidence_key)` — `evaluation_key` y vit **exactement une fois**, jamais répété sur les révisions. `pattern_evidence_revisions` porte une chaîne linéaire immuable de révisions numérotées (`revision_number`, `supersedes_id`) — jamais de fork, jamais un `UPDATE`. `pattern_evidence_source_refs` normalise la provenance en lignes typées (une FK réelle par nature de source parmi `decisions`/`completed_sessions`/`daily_checkins`/`health_flags`/`decision_outcomes`, exactement une non-nulle par ligne — `CHECK` dédié). `athlete_id` sur `pattern_evidence_identities` utilise délibérément `ON DELETE RESTRICT` (pas `CASCADE`, contrairement à la quasi-totalité des autres `athlete_id` de ce schéma) — l'evidence est une donnée dérivée à valeur d'audit ; une suppression d'athlète ne doit jamais l'effacer silencieusement. Conséquence directe et acceptée : un athlète ayant de l'evidence persistée devient structurellement non-supprimable (même `service_role`, qui n'a de toute façon aucun privilège `DELETE`) — les suites de test de ce lot n'appellent donc plus `deleteTestAthlete` sur les athlètes utilisés, s'appuyant sur `supabase db reset` pour le nettoyage, comme documenté explicitement dans chaque fichier de test concerné.

**Correctif décisif — verrou de concurrence, écart empirique au lock initial** : l'architecture verrouillée décrivait littéralement `SELECT identity FOR UPDATE` comme mécanisme de verrouillage. Preuve empirique directe (testé avec `SET ROLE service_role`) : `SELECT ... FOR UPDATE` exige le privilège `UPDATE` en PostgreSQL, même quand aucune colonne n'est jamais réellement modifiée — en contradiction frontale avec l'exigence de moindre privilège du même verrou (`service_role` ne doit jamais recevoir `UPDATE`). Résolu par un verrou advisory transactionnel (`pg_advisory_xact_lock`, clé = hash d'un encodage du quadruplet `(athlete_id, detector_rule_id, detector_rule_version, evidence_key)`), acquis avant l'insertion-ou-lecture de l'identité, relâché automatiquement à la fin de la transaction de l'appel — aucune fuite possible, aucun `unlock` explicite requis. Vérifié ne nécessiter aucun privilège supplémentaire (`pg_advisory_xact_lock` reste exécutable par `service_role` sans aucun `GRANT` dédié, reconfirmé par le preflight de sécurité : `service_role` n'a que `SELECT`+`INSERT`, jamais `UPDATE`). Sémantique de sérialisation strictement identique à celle décrite dans le lock (deux appels concurrents sur la même clé naturelle se sérialisent), preuve reconfirmée par test de concurrence réel (voir plus bas) — seul le mécanisme physique a changé, jamais le comportement observable. Toute mention résiduelle de `SELECT ... FOR UPDATE` dans le code/les commentaires est désormais exclusivement historique, explicitement étiquetée comme la conception initiale rejetée (jamais présentée comme le mécanisme actif).

**Correctif — encodage non ambigu de la clé du verrou (revue finale)** : la première version concaténait les quatre composants avec un simple séparateur `|` (`athlete_id || '|' || detector_rule_id || '|' || ...`) — une ambiguïté structurelle réelle : si `detector_rule_id` contenait lui-même un caractère `|`, deux quadruplets **différents** pouvaient produire la **même** chaîne pré-hachage (ex. `detector_rule_id="foo|bar"`/`detector_rule_version="1.0.0"` collisionne octet pour octet avec `detector_rule_id="foo"`/`detector_rule_version="bar|1.0.0"`) — une collision garantie, pas seulement probabiliste. Corrigé par un encodage à préfixe de longueur (`"<longueurEnOctets>:<valeur>"` pour chaque composant avant concaténation) — non ambigu quel que soit le contenu réel des champs. Une collision de hachage 64 bits entre deux encodages non ambigus différents reste théoriquement possible mais reste sans danger : son seul effet serait une sérialisation superflue entre deux identités sans rapport, jamais une donnée incorrecte — la contrainte d'unicité réelle de la table (`pattern_evidence_identities_unique_key`) reste la garantie de correction, ce verrou n'ayant besoin que d'être un point de sérialisation fiable.

**Durcissement chaîne de prédécesseur** : trigger `BEFORE INSERT` dédié (`check_pattern_evidence_revision_predecessor`) sur `pattern_evidence_revisions`, indépendant de la RPC — rejette toute révision 1 avec `supersedes_id` non nul, toute révision N>1 sans prédécesseur immédiat exact (même `evidence_identity_id`, `revision_number = N-1`). Ce trigger ne fait **jamais** d'allocation — il valide uniquement ce que la RPC propose ; l'allocation reste exclusivement de la responsabilité de la RPC sous le verrou advisory.

**Immuabilité forte — double couche** : les trois tables sont protégées à la fois par les `GRANT`/`REVOKE` (aucun privilège `UPDATE`/`DELETE`/`TRUNCATE` pour `service_role`, aucun pour `authenticated`) **et** par un trigger générique partagé (`reject_append_only_mutation`, attaché en `BEFORE UPDATE`/`BEFORE DELETE` sur les trois tables) — un régresserait, l'autre tiendrait quand même. Preuve empirique : les deux couches testées indépendamment (grants via requête directe sur `information_schema.role_table_grants`, triggers via tentative d'`UPDATE`/`DELETE` réelle avec le client `service_role`).

**Égalité sémantique — exacte** : une nouvelle observation égale la révision courante (jamais une révision plus ancienne) seulement si `event_type`, `event_date`, `observed_value` (égalité `jsonb` native de PostgreSQL — insensible à l'ordre des clés d'objet, sensible à l'ordre des tableaux, jamais un hash/canonicaliseur d'aucune sorte) **et** l'ensemble de provenance (triplets `role`/`source_kind`/`source_id`, non-ordonné) concordent tous. Prouvé empiriquement : réordonnancement de clés d'objet JSON → `unchanged` ; réordonnancement d'un tableau JSON → `superseded` ; réordonnancement de l'ordre d'entrée de la provenance → `unchanged`.

**Validation de provenance — stricte, avant toute écriture** : rôle non-vide (≤64 car.), `source_kind` reconnu, `source_id` présent (uuid valide), aucun triplet dupliqué dans le même appel (`pattern_evidence_provenance_duplicate_payload`), la ligne source référencée doit exister (`pattern_evidence_provenance_source_missing`) et appartenir à `p_athlete_id` (`pattern_evidence_provenance_cross_athlete`) — validé indépendamment pour les cinq natures de source, RLS n'étant pas pertinent ici puisque la fonction s'exécute en `service_role`. Provenance vide rejetée (`pattern_evidence_provenance_empty`). `evaluation_key` incohérent avec l'identité déjà existante rejeté (`pattern_evidence_evaluation_key_mismatch`).

**Correctif — forme exacte du contrat de provenance, normalisation snake_case (revue finale round 2, avant commit)** : la première implémentation acceptait `{role, sourceKind, sourceId}` (camelCase) — en écart avec le contrat verrouillé de l'architecture, qui fige exactement `{role, source_kind, source_id}` (snake_case). Corrigé : chaque entrée de `p_provenance` est désormais validée par une comparaison exacte de l'ensemble trié de ses clés (`array_agg(k order by k) = array['role','source_id','source_kind']`) — un seul contrôle structurel qui rejette d'un coup les six cas malformés (clé `role`/`source_kind`/`source_id` manquante, clé en trop, ancien payload camelCase, élément scalaire, élément tableau) sous une seule famille d'erreur nouvelle : `pattern_evidence_provenance_invalid_shape`. Les erreurs existantes (`pattern_evidence_provenance_empty`/`_duplicate_payload`/`_source_missing`/`_cross_athlete`, `pattern_evidence_evaluation_key_mismatch`) restent inchangées. L'adaptateur M5_005 (`recommendationVsActualAdapter.ts`) mappe désormais `source_kind`/`source_id` dans son payload RPC — le contrat TypeScript du détecteur M5_005 lui-même (`RecommendationVsActualEvidence.sourceRefs.decisionId`/`.completedSessionId`) n'est **pas** touché, seule la traduction adaptateur→RPC a changé. 10 nouveaux tests dédiés (`persistPatternEvidenceRpc.integration.test.ts`, describe "exact provenance object shape").

**Atomicité — prouvée sur le VRAI chemin RPC (revue finale)** : un seul appel de fonction plpgsql partage la même frontière de rollback qu'un bloc de transaction — toute exception (y compris une violation de contrainte sur `pattern_evidence_source_refs`) annule l'intégralité de l'appel, identité et révision candidates incluses. Preuve initiale (transaction SQL manuelle imitant la séquence) jugée insuffisante en revue finale — remplacée par une injection de faute directement sur le chemin réel : un trigger `BEFORE INSERT` jetable posé sur `pattern_evidence_source_refs` (schéma `public`, jamais `pg_temp` — une session `pg_temp` créée via `docker exec psql` ne serait pas visible d'un appel RPC routé via le pool de connexions PostgREST), qui échoue uniquement pour un rôle-marqueur unique (`__m5006a_force_provenance_failure__`), la vraie RPC `persist_pattern_evidence` étant alors appelée normalement (athlète/décision/session réels, provenance par ailleurs valide). Constaté : l'appel échoue exactement à l'étape d'insertion de provenance (après création réussie de l'identité et de la révision candidates), et l'identité, la révision et la ligne de provenance sont toutes absentes après coup — zéro ligne orpheline. Le trigger et sa fonction jetables sont retirés en `finally` (jamais dans une migration) ; leur absence après le test est reconfirmée indépendamment.

**Vues de lecture** : `pattern_evidence_current` (une ligne par identité, `revision_number` maximal — jamais de notion de « dernier tous détecteurs/versions confondus », puisque chaque version de détecteur possède déjà sa propre identité, par construction), `pattern_evidence_history` (toutes les révisions), `pattern_evidence_current_with_provenance` (jointure avec la provenance). Toutes en `WITH (security_invoker = true)` — sans quoi une vue s'exécuterait avec les privilèges du propriétaire de la vue, contournant silencieusement le RLS déjà posé sur les tables sous-jacentes. Prouvé avec un vrai utilisateur authentifié (JWT réel, pas `service_role`) : l'athlète A voit ses propres lignes via les vues, l'athlète B ne les voit jamais.

**Adaptateur de persistance M5_005 — `longitudinal-engine/src/persistence/**`** : `persistRecommendationVsActualEvidence(client, {athleteId, detection})` — aucun sérialiseur générique, aucun registre de plugins, exactement ce détecteur, exactement deux lignes de provenance (`role="evaluation_decision"` → `decision`, `role="linked_completed_session"` → `completed_session`). `no_evidence` ne touche jamais la base — court-circuit local pur, `{action:"skipped_no_evidence"}`, zéro appel RPC (prouvé par un client factice dont `rpc()` lève une exception s'il est appelé). Frontière DB strictement confinée à `persistence/**` — `detectors/**`/`relations/**` restent purs, seul un import de **type** (`RecommendationVsActualDetection`) traverse la frontière, jamais une valeur runtime, jamais de cycle.

**Correctif — erreurs RPC propagées non enveloppées (revue finale)** : la première implémentation enveloppait toute erreur RPC dans une classe `PatternEvidencePersistenceError` maison (résumant `code`/`message`) — en écart avec le contrat verrouillé de l'adaptateur (« les erreurs RPC se propagent NON enveloppées »). Corrigé : l'objet d'erreur exact retourné par le client Supabase est directement relancé (`throw error`), jamais parsé, jamais réduit, jamais recréé — `persistence/errors.ts` (devenu inutile) supprimé, plus aucune référence à `PatternEvidencePersistenceError` nulle part dans le paquet. Preuve dédiée : test d'**identité** d'objet (`.rejects.toBe(rpcError)`, pas seulement une égalité de message), plus la confirmation que le RPC n'est appelé qu'une seule fois pour une evidence et jamais pour `no_evidence`.

**Preuve de cycle de vie M5_005 complète (bout-en-bout, détecteur réel → DB réelle)** : `skipped` → `contradicting` → identité créée, révision 1 ; corrigé en `done` → `supporting` → même identité, révision 2, `supersedes` révision 1 ; rejeu identique → `unchanged`, révision 2 inchangée ; reverti en `skipped` → `contradicting` → révision 3, `supersedes` révision 2. Historique final : 1 identité, 3 révisions, `pattern_evidence_current` pointant exactement sur la révision 3.

**Tests** : `longitudinal-engine` — 5 tests unitaires purs (adaptateur, aucun Docker), 22 tests d'intégration schéma/durcissement/sécurité (enum, unicités, chaîne de prédécesseur × 4 cas malformés, contrainte exactement-une-source, unicités partielles de provenance × 5 natures, append-only × 6, moindre privilège, rollback atomique), **32** tests d'intégration RPC (premier écrit/rejeu/supersession × 4 dimensions, égalité sémantique × 3, incohérence `evaluation_key`, validation de provenance × 3, cross-athlète × 5 natures, concurrence × 4 scénarios, **+ 10 nouveaux couvrant la forme exacte `{role, source_kind, source_id}`** : forme exacte acceptée, ensemble réordonné accepté, clé en trop/rôle manquant/`source_kind` manquant/`source_id` manquant/ancien payload camelCase/élément scalaire/élément tableau tous rejetés sous `pattern_evidence_provenance_invalid_shape`, zéro ligne identité/révision/provenance créée pour toute forme malformée), 5 tests d'intégration vues (RLS réelle via JWT authentifié, `security_invoker`), 5 tests d'intégration bout-en-bout (détecteur réel × 4 issues + `no_evidence` + cycle de vie complet skipped→done→done→skipped). Total M5_006A = **69** (5+22+32+5+5). `npm run build` : succès propre. `npx tsc --noEmit` : succès propre.

**Régressions confirmées (Supabase disponible)** : `longitudinal-engine` non-DB = **213/213**, suite complète `npm test` = **302/302** (213 non-DB + 22 + 32 + 5 + 5 = 277 tests M5_006A/M5_005/M5_004 non-DB inclus, **+ 9** `tests/supabase/outcomeOrchestrator.integration.test.ts` (M5_004) **+ 16** `tests/supabase/adapter.integration.test.ts` (M5_002A), tous préexistants et inchangés = 302). M1/M2 = **226/226**, edge = **9/9**, M3 HTTP = **26/26**, completed-session unit = **73/73**, completed-session HTTP = **70/70**, web = **242/242**, web build = PASS. M5_006A n'a modifié aucun code `head-coach-engine`/`web` — ces suites étaient déjà vertes, reconfirmées inchangées.

**Sécurité — preflight exécuté (local, réel)** : `supabase/preflight/pattern_evidence_append_only_security_check.sql` — toutes les sections de détection de problème reviennent vides. Confirmé : `authenticated` = `SELECT` seul sur les trois tables et les trois vues ; `anon` = zéro privilège partout ; `service_role` = exactement `SELECT`+`INSERT` sur les trois tables (jamais `UPDATE`/`DELETE`/`TRUNCATE`, deux couches indépendantes) ; `persist_pattern_evidence` = `SECURITY INVOKER`, `anon`/`authenticated` ne peuvent pas l'exécuter, `service_role` le peut ; triggers append-only et de chaîne de prédécesseur tous présents ; les trois vues confirmées `security_invoker = true`.

**Migrations — locales, puis déployées remote (voir rollout ci-dessous)** : 5 nouvelles migrations locales (`20260825090000` à `20260825092000`), d'abord validées via `supabase db reset` local uniquement, puis appliquées au projet remote lié dans une passe de rollout dédiée.

**Rollout remote — passe dédiée, lecture seule + `db push` unique** : projet cible confirmé exactement `uvolpldwwyvadlamulvr` (jamais `evynmzyjhobdpmxdiwsy`). Avant rollout : `remote = 13` migrations, les 5 migrations M5_006A pendantes. `npx supabase db push --project-ref uvolpldwwyvadlamulvr` a appliqué exactement les 5 migrations attendues, aucune autre. Après rollout : `local = 18`, `remote = 18`, `pending = 0`. Vérification structurelle post-rollout (lecture seule, via `supabase db dump`/`supabase db query`, aucune écriture) : les 3 tables présentes avec RLS activé, les 3 vues présentes avec `security_invoker = true`, la RPC `persist_pattern_evidence` présente en `SECURITY INVOKER` avec exécution restreinte à `service_role`, les grants exacts (`authenticated` = SELECT seul, `service_role` = SELECT+INSERT seuls, `anon` = zéro privilège), les 7 triggers attendus (6 append-only + 1 chaîne de prédécesseur), les 2 contraintes UNIQUE + l'unicité partielle sur `supersedes_id` + les 5 index uniques partiels de provenance + la contrainte CHECK exactement-une-source, les 9 FK attendues toutes en `ON DELETE RESTRICT`, le contrat de colonnes exact des 3 tables (aucune colonne `updated_at`, aucun `observed_value_hash`, aucune colonne `jsonb` de provenance sur `source_refs`, aucun membre d'enum `no_evidence`). Ledger remote confirmé vide immédiatement après rollout : `pattern_evidence_identities` = 0, `pattern_evidence_revisions` = 0, `pattern_evidence_source_refs` = 0 — aucune ligne d'evidence de démonstration/smoke créée. Aucun déploiement Edge Function, aucun déploiement Vercel, aucune intégration `daily-run` — le rollout ne couvre que le schéma/RPC/vues ; aucun peuplement automatique de production n'existe à ce stade. Les compteurs exacts des tables sources pré-existantes (`athletes`/`daily_checkins`/`decisions`/`completed_sessions`/`health_flags`/`decision_outcomes`) n'ont **pas** été capturés avant le rollout — une comparaison avant/après exacte n'est donc **pas disponible** ; vérifié en lecture seule après rollout que les 6 tables existent toujours et restent accessibles avec des lignes valides, et confirmé par lecture directe des 5 fichiers de migration qu'aucun ne contient de `UPDATE`/`DELETE`/`TRUNCATE`/`INSERT` visant une table source pré-existante (les seuls `insert into` du lot ciblent exclusivement les nouvelles tables `pattern_evidence_*`, à l'intérieur du corps de la RPC, jamais exécutés au moment de la migration elle-même).

**Durcissement post-rollout — nettoyage du trigger d'injection de faute** : lors de la vérification post-rollout, une exécution complète de la suite locale a montré une fois un trigger et une fonction scratch (`__m5006a_test_force_provenance_failure_trigger`/`_function`) laissés en place après le test de rollback atomique. Cause : l'aide `removeFaultTrigger()` du test appelait l'helper `runPsql` non vérifié et ignorait entièrement sa sortie — ni le code de sortie `spawnSync`, ni une éventuelle erreur du `DROP`, n'étaient jamais inspectés, si bien qu'un échec de nettoyage aurait pu passer complètement silencieux. **Cause exacte non établie avec certitude** : une contention de verrou DDL sur `pattern_evidence_source_refs` (le `DROP TRIGGER`/`DROP FUNCTION` exige un verrou ACCESS EXCLUSIVE, potentiellement retardé par l'écriture concurrente d'autres fichiers de test tournant en parallèle lors d'un `npm test` complet) est une explication plausible et cohérente avec le fait que l'échec n'a jamais été reproduit en exécution isolée du fichier — mais ceci reste une hypothèse plausible, **pas une cause empiriquement prouvée**. Corrigé côté harnais de test uniquement (aucun changement SQL/RPC/migration) : `runPsqlChecked()` (lève une exception sur échec de spawn ou code de sortie non nul) et `psqlScalarCount()` (sortie machine-lisible `-t -A`, plus de regex sur une sortie humaine formatée) remplacent le chemin non vérifié ; `removeFaultTrigger()` exécute chaque `DROP` comme un appel vérifié séparé et lève immédiatement en cas d'échec ; invariants explicites ajoutés (0 avant installation, 1 après installation, 0 après nettoyage). Preuve de non-régression : 10 exécutions consécutives isolées du test de rollback atomique = **10/10 PASS**, objets scratch = 0 après chacune, sans nettoyage manuel entre exécutions ; 3 exécutions consécutives de la suite complète `longitudinal-engine` = **302/302** à chaque fois, objets scratch = 0 après chacune. Fichiers modifiés : uniquement `longitudinal-engine/tests/supabase/patternEvidenceSchema.integration.test.ts` — commit dédié `test: harden pattern evidence rollback cleanup` (`97b7e8cd65a39a7ab3e39c09f9ffe07135130dd0`), aucun changement de schéma/RPC/migration.

**Correctif documentaire — comptage de tests (revue avant commit d'implémentation)** : une valeur intermédiaire erronée (`277/277`) avait été portée pour la suite complète `longitudinal-engine`, omettant 25 tests d'intégration Supabase préexistants (`tests/supabase/outcomeOrchestrator.integration.test.ts` M5_004 = 9, `tests/supabase/adapter.integration.test.ts` M5_002A = 16). Corrigé à la valeur exacte **302/302** (voir paragraphe « Régressions confirmées » ci-dessus).

**Incident de sécurité — exposition accidentelle lors de la vérification post-rollout, résolu** : lors de la vérification en lecture seule du déploiement remote, une commande `supabase db dump --dry-run` a affiché le mot de passe réel de la base de données remote dans la sortie de session, et un dump de données mal ciblé (portée schéma non restreinte à `public`) a brièvement contenu des lignes du schéma `auth` Supabase. Le fichier temporaire concerné a été supprimé immédiatement, sa suppression reconfirmée. Aucune mutation de schéma ou de donnée de production n'a résulté de cet incident — uniquement des opérations de lecture locales/temporaires. Avant la clôture de M5_006A : le mot de passe de la base de données remote a été **rotationné**, et les sessions Auth potentiellement affectées ont été **révoquées** (actions confirmées par l'architecte). Aucune valeur de mot de passe, jeton, email utilisateur, hash, chaîne de connexion, ni contenu de ligne `auth.*` n'est reproduit dans cette entrée.

**Architecture verrouillée (résumé canonique de clôture)** : identité d'evidence stable (`pattern_evidence_identities`, clé naturelle `(athlete_id, detector_rule_id, detector_rule_version, evidence_key)`) → chaîne de révisions immuables numérotées (`pattern_evidence_revisions`, `revision_number`/`supersedes_id`) → provenance typée par FK immuable (`pattern_evidence_source_refs`, une FK réelle parmi `decisions`/`completed_sessions`/`daily_checkins`/`health_flags`/`decision_outcomes`) → révision effective courante = `revision_number` maximal par identité (`pattern_evidence_current`). RPC unique `persist_pattern_evidence(...)`. Trois vues de lecture : `pattern_evidence_current`, `pattern_evidence_history`, `pattern_evidence_current_with_provenance`. Types d'evidence exactement : `supporting`/`contradicting`/`neutral` — `no_evidence` n'est **jamais** persisté (court-circuit local pur côté adaptateur). Contrat de provenance exactement `{role, source_kind, source_id}` (snake_case, forme stricte). Cinq natures de source de provenance : `decision`/`completed_session`/`daily_checkin`/`health_flag`/`decision_outcome`. Égalité sémantique sur `event_type`+`event_date`+`observed_value` (égalité `jsonb` native) + ensemble de provenance non-ordonné : un rejeu identique de la révision courante ne crée **aucune** nouvelle révision (`unchanged`) ; une récurrence d'un contenu historique (différent de la révision courante, même si déjà vu à une révision antérieure) crée une **nouvelle** révision (jamais de retour en arrière vers une révision existante). Concurrence via `pg_advisory_xact_lock`, clé dérivée du quadruplet identité naturelle par encodage à préfixe de longueur (non ambigu). La conception initiale verrouillée (`SELECT ... FOR UPDATE`) a été rejetée après preuve empirique directe : PostgreSQL exige le privilège `UPDATE` pour ce verrou même sans écriture de colonne, en contradiction frontale avec l'exigence de moindre privilège du même lock (`service_role` ne doit jamais recevoir `UPDATE`) — voir le correctif détaillé plus haut dans cette entrée. Sécurité : RPC `SECURITY INVOKER`, exécution `service_role` seul ; `authenticated` = SELECT sur ses propres lignes uniquement (RLS), écritures directes refusées ; `anon` = aucun accès ; `service_role` = SELECT+INSERT, jamais UPDATE/DELETE/TRUNCATE ; triggers de mutation append-only sur les trois tables ; trigger de validation de chaîne de prédécesseur ; les trois vues en `security_invoker = true`.

**Décision** : **M5_006A = CLOSED.** Le schéma (`pattern_evidence_identities`/`_revisions`/`_source_refs`), la RPC (`persist_pattern_evidence`), les trois vues, et l'adaptateur de persistance M5_005 (`longitudinal-engine/src/persistence/**`) sont déployés sur le projet Supabase remote `uvolpldwwyvadlamulvr` et implémentent intégralement l'architecture verrouillée, avec un seul écart empirique documenté et justifié (verrou advisory au lieu de `SELECT ... FOR UPDATE`). Aucun changement de sémantique M5_004/M5_005. Aucun détecteur supplémentaire, aucune agrégation, aucun scheduler, aucune intégration `daily-run`, aucun déploiement Edge Function, aucun déploiement Vercel, aucun changement `head-coach-engine`/`web`/`supabase/functions`. Migrations : `local = 18`, `remote = 18`, `pending = 0`. Ledger remote vide (0/0/0), aucune donnée de démonstration. **M5 dans son ensemble reste EN COURS** — M5_006B (détecteurs sommeil-énergie) et suivants restent à implémenter.

**Preuves empiriques finales de clôture** : M5_006A = **69/69** (5+22+32+5+5) ; `longitudinal-engine` suite complète = **302/302** ; build = PASS. M5_004 calculateur = **59/59** ; résolveur partagé = **15/15** ; M5_005 détecteur = **31/31**. Régressions gelées : M1/M2 = **226/226**, edge = **9/9**, M3 HTTP = **26/26**, completed-session unit = **73/73**, completed-session HTTP = **70/70**, web = **242/242**, web build = PASS. Durcissement post-rollout : rollback atomique isolé × 10 = **10/10 PASS** (objets scratch = 0 après chaque exécution, aucun nettoyage manuel), suite complète `longitudinal-engine` × 3 exécutions consécutives = **302/302** à chaque fois (objets scratch = 0 après chacune).

**Impact** : `supabase/migrations/20260825090000_M5_006A_pattern_evidence_identities.sql`, `supabase/migrations/20260825090500_M5_006A_pattern_evidence_revisions.sql`, `supabase/migrations/20260825091000_M5_006A_pattern_evidence_source_refs.sql`, `supabase/migrations/20260825091500_M5_006A_persist_pattern_evidence_rpc.sql`, `supabase/migrations/20260825092000_M5_006A_pattern_evidence_views.sql` (les 5 déployées sur `uvolpldwwyvadlamulvr`), `supabase/preflight/pattern_evidence_append_only_security_check.sql`, `longitudinal-engine/src/persistence/**` (`types.ts`, `recommendationVsActualAdapter.ts`, `index.ts`), `longitudinal-engine/src/index.ts` (export `persistence/**` ajouté), `longitudinal-engine/tests/unit/persistence/**` (5 tests), `longitudinal-engine/tests/supabase/patternEvidenceSchema.integration.test.ts` (22 tests, durci post-rollout), `longitudinal-engine/tests/supabase/persistPatternEvidenceRpc.integration.test.ts` (32 tests), `longitudinal-engine/tests/supabase/patternEvidenceViews.integration.test.ts` (5 tests), `longitudinal-engine/tests/supabase/recommendationVsActualPersistence.integration.test.ts` (5 tests), cette entrée. Aucun changement `head-coach-engine/src/**`, `web/**`, `supabase/functions/**`, `docs/03*`/`05*`/`06*`.

**Statut** : **CLOSED** — commit d'implémentation `36d7d7f1732cb2c87d7fcd784b1a66c674415143` (`feat: add append-only pattern evidence ledger`), commit de durcissement `97b7e8cd65a39a7ab3e39c09f9ffe07135130dd0` (`test: harden pattern evidence rollback cleanup`), les 5 migrations déployées sur `uvolpldwwyvadlamulvr` (`local = remote = 18`, `pending = 0`), toutes les preuves empiriques (pures + DB-dépendantes + durcissement + vérification structurelle remote) au vert, ledger remote vide, incident de sécurité de vérification post-rollout résolu (mot de passe rotationné, sessions Auth révoquées) ; **aucun déploiement Edge/Vercel, aucun peuplement automatique de production** — périmètre volontairement limité au schéma/RPC/vues/adaptateur ; M5 dans son ensemble reste EN COURS (M5_006B et suivants restent à implémenter)

---

## 2026-08-26 — M5_006B : retrait de cycle de vie de l'evidence + détecteur sommeil-énergie même-jour, `pattern_evidence_lifecycle_transitions` + `transition_pattern_evidence_lifecycle` + `persist_active_pattern_evidence` + `longitudinal-engine/src/detectors/sleepQualityToSameDayEnergyCorrelation.ts` (LOCAL uniquement — migrations locales, non déployé remote, non clos)

**Contexte** : M5_006A a figé le modèle identité/révision/provenance pour une evidence de détecteur, mais n'avait aucune notion de « cette evidence reste-t-elle d'actualité » — une fois une révision persistée, elle reste indéfiniment dans `pattern_evidence_current`/`pattern_evidence_current_with_provenance`, même si une réévaluation ultérieure ne trouve plus de preuve (`no_evidence`). M5_006B ajoute cet axe orthogonal (tranche A — cycle de vie actif/retiré) puis livre le premier détecteur qui en dépend réellement : la corrélation même-jour qualité-de-sommeil/énergie (tranche B). Explicitement **hors périmètre** : M5_006C/D (agrégation, patterns appris), Edge Function, scheduler, intégration `daily-run`, UI, modification de `persist_pattern_evidence`/du schéma M5_006A existant.

### Tranche A — cycle de vie de l'evidence

**Modèle** : `pattern_evidence_lifecycle_transitions` porte une chaîne linéaire immuable de transitions numérotées (`transition_number`, `supersedes_id`) par identité `pattern_evidence_identities`, **totalement indépendante** de `pattern_evidence_revisions` — le cycle de vie (actif/retiré) et le contenu de l'evidence (quelle révision) sont deux axes orthogonaux, jamais confondus. Une identité **sans aucune ligne de cycle de vie** est, par construction, **active par défaut** (`transition_pattern_evidence_lifecycle` ne matérialise jamais de ligne « active implicite »). Colonnes/contraintes calquées exactement sur `pattern_evidence_revisions` (M5_006A) : `id`/`evidence_identity_id` (FK `ON DELETE RESTRICT`)/`transition_number`/`supersedes_id` (FK vers sa propre table, `ON DELETE RESTRICT`)/`state` (`active`/`withdrawn`)/`reason_code`/`context` (jsonb)/`created_at`. Contraintes : `UNIQUE(evidence_identity_id, transition_number)`, unicité partielle sur `supersedes_id`, `transition_number=1 ⟺ supersedes_id IS NULL`, forme figée par état (`active` ⟹ `reason_code IS NULL ∧ context='{}'`, `withdrawn` ⟹ `reason_code` non-vide 1-128 caractères). Trigger de chaîne de prédécesseur dédié (`check_pattern_evidence_lifecycle_predecessor`, même rigueur que `check_pattern_evidence_revision_predecessor`), triggers append-only réutilisant tel quel `reject_append_only_mutation()` (M5_006A, générique). RLS/grants identiques au reste du ledger : `authenticated` = SELECT sur ses propres lignes, `service_role` = SELECT+INSERT seuls, `anon` = aucun accès.

**`transition_pattern_evidence_lifecycle` RPC** : `SECURITY INVOKER`, exécution `service_role` seul. Verrou de concurrence : **exactement le même algorithme** que `persist_pattern_evidence` — même quadruplet `(athlete_id, detector_rule_id, detector_rule_version, evidence_key)`, même encodage à préfixe de longueur, même `hashtextextended`, jamais `SELECT ... FOR UPDATE` (l'écart empirique M5_006A — `service_role` n'a toujours aucun privilège `UPDATE`). Matrice de comportement exacte (verrouillée) : `withdrawn` + aucune identité → `skipped_no_prior` (aucune écriture) ; `active` + aucune identité → erreur structurelle (`pattern_evidence_lifecycle_no_identity`, jamais une activation silencieuse d'une identité qui n'a jamais existé) ; `active` + déjà actif (implicite ou explicite) → `unchanged` ; `active` + `withdrawn` → nouvelle transition active ; `withdrawn` + actif → nouvelle transition withdrawn ; `withdrawn` + déjà `withdrawn` avec **même** `reason_code` et **contexte jsonb-égal** → `unchanged` ; `withdrawn` + `withdrawn` avec `reason_code`/`context` différent → nouvelle transition. Aucun SELECT-puis-INSERT côté application — la décision est prise et exécutée entièrement sous le verrou, dans l'appel.

**`persist_active_pattern_evidence` RPC — composite** : `SECURITY INVOKER`, `service_role` seul, mêmes 9 paramètres que `persist_pattern_evidence` (aucun paramètre de cycle de vie — l'activation est implicite et fixe). À l'intérieur d'une **seule transaction**, appelle `persist_pattern_evidence` (inchangée, jamais dupliquée/réimplémentée) puis `transition_pattern_evidence_lifecycle(..., target_state='active', ...)`, et retourne la fusion des deux résultats (`identity_id`/`revision_id`/`revision_number`/`evidence_action`/`lifecycle_action`/`lifecycle_transition_id`/`lifecycle_transition_number`). Aucune coordination de verrou supplémentaire nécessaire : `pg_advisory_xact_lock` est **scopé à la transaction**, pas à l'appel de fonction — le verrou acquis par `persist_pattern_evidence` reste donc tenu par la même session jusqu'à la fin de la transaction englobante (tout le corps de la RPC composite), ce qui empêche structurellement un retrait concurrent de s'intercaler entre l'écriture d'evidence et l'activation du cycle de vie — propriété intrinsèque du mécanisme, pas un ajout de code.

**Vues** : `pattern_evidence_current`/`_history`/`_current_with_provenance` (M5_006A) **non modifiées**. Ajout de `pattern_evidence_current_state` (tête d'evidence courante + dernière transition de cycle de vie, `lifecycle_state='active'`/champs de transition `NULL` quand aucune transition n'existe) et `pattern_evidence_current_effective` (uniquement les têtes d'evidence dont l'état effectif est `active`, même forme de colonnes qu'`pattern_evidence_current` — **contrat verrouillé pour M5_006D** : toute agrégation future doit lire `pattern_evidence_current_effective`, jamais `pattern_evidence_current` directement, pour ne jamais réintégrer silencieusement une evidence retirée). Les deux en `security_invoker = true`.

**Preuve de cycle de vie T1-T6 (exacte, verrouillée)** : T1 `supporting` inséré (révisions=1, cycle de vie=0 ligne, effectif=rév1) ; T2 `supporting` identique (evidence `unchanged`, cycle de vie toujours 0 ligne) ; T3 `no_evidence` → retrait transition #1 (révisions toujours 1, effectif=AUCUN) ; T4 retrait identique → `unchanged` (toujours transition #1) ; **T5 (obligatoire)** contenu `supporting` **identique à T1** → RPC d'evidence `unchanged` (révision **toujours** 1, même `revision_id` qu'en T1), transition active #2, cycle de vie=2 lignes, effectif=rév1 **à nouveau** (réactivation sans toucher à la révision) ; T6 `contradicting` → nouvelle révision #2, cycle de vie déjà actif → `unchanged`, effectif=rév2. Prouvé à la fois via SQL brut direct et via le détecteur réel M5_006B sur une base réelle (bout-en-bout). Concurrence contrôlée prouvée : retrait+retrait simultanés (exactement une transition, aucune fourche), evidence/réactivation puis retrait séparé (numéros denses, aucune fourche), retrait puis evidence/réactivation simultanés (numéros denses, aucune transition sémantique dupliquée).

### Tranche B — détecteur `sleep_quality_to_same_day_energy_correlation`

**Identité** : `detectorRuleId = "sleep_quality_to_same_day_energy_correlation"`, `detectorRuleVersion = "1.0.0"`. API pure : `detectSleepQualityToSameDayEnergyCorrelation({timeline, evaluationCheckinId})` — aucun Supabase, aucune horloge, aucun aléatoire, comme tout le reste de `detectors/**`.

**Sémantique temporelle — même-jour, verrouillée** : `sleepQuality` sur la date D = le sommeil précédant immédiatement D (déjà porté par la ligne de check-in de D elle-même — le schéma ne modélise pas de colonne « date de sommeil » séparée) ; `energy` sur D = l'énergie vécue pendant D. L'observation est donc strictement `C.sleepQuality ↔ C.energy` sur la **même** ligne de check-in — **aucun** regard vers le jour suivant, sous quelque forme que ce soit (aucun concept `N`/`nextDayCheckin`/`plusOneDay`/`no_next_day_checkin`). `eventDate = C.checkinDate`.

**Clés** : `evaluationKey = evidenceKey = "checkin:" + C.id + ":sleep-energy"` — portées par **Evidence ET NoEvidence** (contrairement à M5_005, où seule `Evidence` porte `evidenceKey`).

**Couverture de timeline — stricte, avant toute logique de densité** : `[C-60j, C]` requis exactement ; `timeline.range.fromDate <= C-60j` et `timeline.range.toDate >= C`, sinon `InsufficientTimelineCoverageError` — **jamais** `no_evidence` (un timeline sous-chargé est une violation de contrat de l'appelant, pas une absence de corrélation observée).

**Invariant de date dupliquée** : pour chaque date consommée dans `[C-60, C]`, 0 check-in = absent, 1 = valide, >1 = `DuplicateCheckinDateError` — défense en profondeur contre un timeline synthétique malformé (la vraie DB porte `UNIQUE(athlete_id, checkin_date)`).

**Baseline** : fenêtre `C-60` à `C-1` inclus (C exclu), distributions **indépendantes** (une ligne contribue à `sleep` ssi `sleepQuality !== null`, à `energy` ssi `energy !== null`). Minimum **21 observations chacune** (`<21` → `no_evidence/insufficient_baseline_data`), minimum **2 valeurs distinctes chacune** (sinon `no_evidence/baseline_variance_insufficient`).

**Rang empirique — `empirical_midrank_v1`, verrouillé** : pour une valeur candidate v, `L` = nb de valeurs baseline < v, `E` = nb de valeurs baseline = v, `N` = taille baseline ; `percentile = (L + 0.5*E) / N` (valeur JS brute, **aucun arrondi d'affichage**, **jamais R7** — la méthode R7 collapserait l'exemple de régression verrouillé `15×7 + 6×8`/candidat `7` en `Q4` au lieu du `Q2` correct ; `L=0, E=15, N=21 → p=7.5/21≈0.357 → Q2`, prouvé exactement). Buckets : `p<.20`→Q1, `.20≤p<.40`→Q2, `.40≤p<.60`→Q3, `.60≤p<.80`→Q4, `p≥.80`→Q5.

**Classification** : `bottom`=Q1/Q2, `middle`=Q3, `top`=Q4/Q5 ; `bottom+bottom`/`top+top` → `supporting` ; `bottom+top`/`top+bottom` → `contradicting` ; **tout Q3** (l'un ou l'autre) → `neutral`. Les 25 cellules Q×Q prouvées individuellement. Corrélation **descriptive uniquement, jamais causale**.

**Confondeurs** : `feverOrIllness===true` ou `suspectedConcussion===true` force `eventType='neutral'` (jamais annulé après coup) et ajoute la raison correspondante à `confounderReasons`, ordre déterministe fixe `[fever_or_illness, suspected_concussion]`. Une donnée manquante/insuffisante produit toujours `NoEvidence` **avant** toute neutralisation — un confondeur n'affecte jamais un résultat `NoEvidence`. `workStress` explicitement **jamais consommé** en V1 (prouvé par test de non-consommation), aucun seuil de stress absolu.

**`observedValue` — exactement 18 champs (verrouillé)** : `evaluationCheckinId`/`evaluationCheckinDate`/`sleepQuality`/`energy`/`sleepPercentile`/`energyPercentile`/`sleepBucket`/`energyBucket`/`baselineWindowStartDate`/`baselineWindowEndDate`/`sleepBaselineObservationCount`/`energyBaselineObservationCount`/`sleepBaselineDistinctValueCount`/`energyBaselineDistinctValueCount`/`sleepBaselineHistogram`/`energyBaselineHistogram` (11 bins, index 0-10, la plage `CHECK` réelle de `daily_checkins.sleep_quality`/`.energy`)/`rankingMethod`/`confounderReasons`. Invariants prouvés : `sum(histogram) = observationCount`, `bins non-nuls = distinctValueCount`.

**`sourceRefs`/provenance** : exactement `evaluationCheckinId` + `baselineCheckinIds` (union distincte des check-ins ayant contribué `sleepQuality` OU `energy`, triée ascendante, jamais de doublon). Provenance persistée : `evaluation_checkin`/`daily_checkin`/`C.id`, puis `baseline_checkin`/`daily_checkin`/chaque id de baseline.

**`NoEvidence`** — exactement 8 champs (`kind`/`detectorRuleId`/`detectorRuleVersion`/`evaluationKey`/`evidenceKey`/`eventDate`/`evaluationCheckinId`/`reason`), raisons exactes `evaluation_checkin_missing_sleep_quality`/`evaluation_checkin_missing_energy`/`insufficient_baseline_data`/`baseline_variance_insufficient`.

**Adaptateur** (`longitudinal-engine/src/persistence/sleepEnergyAdapter.ts`) : `Evidence` → `persist_active_pattern_evidence` (provenance = `evaluation_checkin` + N × `baseline_checkin`, tous `daily_checkin`). `NoEvidence` → `transition_pattern_evidence_lifecycle(target_state='withdrawn', reason_code=detection.reason, context={evaluation_checkin_id, evaluation_date})`. Résultats de retrait remappés vers des noms sémantiques propres au détecteur : `transitioned`→`withdrawn`, `unchanged`→`unchanged_withdrawal`, `skipped_no_prior`→`skipped_no_evidence_no_prior`. Erreurs RPC propagées **non enveloppées**, même discipline que tout le reste de `persistence/**`.

### Tests, régressions, sécurité, migrations

**Tests M5_006B** : tranche A = **37** (6 tests unitaires purs adaptateur cycle de vie + 31 tests d'intégration schéma/RPC/vues, dont T1-T6 exact et les 3 scénarios de concurrence contrôlée). Tranche B = **70** (58 tests unitaires détecteur — sémantique même-jour, couverture, dates dupliquées, densité/variance de baseline, rang empirique dont l'exemple de régression verrouillé et les cas de percentile 0/1, les 25 cellules de classification, confondeurs, non-consommation `workStress`, forme exacte `observedValue`/`sourceRefs`, invariance d'ordre, stabilité des clés + 9 tests unitaires adaptateur + 3 tests d'intégration bout-en-bout dont T1-T6 avec le vrai détecteur). **Total M5_006B = 107.**

**Régressions confirmées** : `longitudinal-engine` suite complète = **409/409** (302 + 107), build = PASS, reconfirmé sur 2 exécutions consécutives fraîches. M5_004 calculateur = **59/59**, résolveur partagé = **15/15**, M5_005 détecteur = **31/31** (tous inchangés, inclus dans les 302). M1/M2 = **226/226**, edge = **9/9**, M3 HTTP = **26/26**, completed-session unit = **73/73**, completed-session HTTP = **70/70** (premier passage flaky sur conteneur edge-runtime venant de démarrer, vert au second passage sans modification de code — pattern déjà documenté pour ce harnais), web = **242/242**, web build = PASS.

**Correctif — durcissement de timeout du test de rollback atomique M5_006A (revue avant commit)** : les nouveaux fichiers de test tranche A/B ajoutent une charge d'écriture concurrente réelle sur `pattern_evidence_source_refs` pendant une exécution complète parallèle de `npm test` — le test de rollback atomique M5_006A (`patternEvidenceSchema.integration.test.ts`), dont les `DROP TRIGGER`/`DROP FUNCTION` exigent un verrou `ACCESS EXCLUSIVE` sur cette même table, s'est mis à dépasser occasionnellement le timeout par défaut de vitest (5000ms) sous cette charge accrue. Corrigé en portant le timeout de ce seul test à 20000ms — **aucun changement sémantique, aucune assertion modifiée, aucune migration touchée** ; les garanties déjà prouvées (rollback atomique réel, nettoyage vérifié bruyamment — durcissement de la revue post-rollout M5_006A) restent identiques.

**Sécurité — preflight étendu** : `supabase/preflight/pattern_evidence_append_only_security_check.sql` étendu avec 12 nouvelles sections (M-W) couvrant la table de cycle de vie (RLS, policy, grants, triggers append-only, trigger de chaîne de prédécesseur) et les deux nouvelles RPC + les deux nouvelles vues (signature exacte, `SECURITY INVOKER`, grants d'exécution exacts, `security_invoker=true`). Toutes les sections M5_006A existantes (A-L) **inchangées et vertes**. Confirmé : `service_role` = exactement `SELECT`+`INSERT` sur la table de cycle de vie, `anon` = zéro privilège partout, les deux RPC `service_role`-seul.

**Migrations — locales uniquement, aucune écriture remote** : 4 nouvelles migrations locales (`20260826090000` à `20260826091500`), jamais appliquées côté remote dans cette passe. Comptage : **local = 22, remote = 18, pending = 4** — état attendu, pas une dérive. Aucune migration existante (`<= 20260825092000`) modifiée.

**Décision** : **M5_006B implémentation locale VALIDÉE — PAS COMPLETE/CLOSED, PAS déployée remote, PAS committée en clôture.** Le modèle de cycle de vie (`pattern_evidence_lifecycle_transitions` + les deux RPC + les deux vues) et le détecteur sommeil-énergie (`longitudinal-engine/src/detectors/sleepQualityToSameDayEnergyCorrelation.ts` + son adaptateur) implémentent intégralement l'architecture verrouillée, sans aucun écart empirique cette fois (le verrou advisory M5_006A est réutilisé tel quel, jamais `SELECT ... FOR UPDATE`). Aucun changement à `persist_pattern_evidence`/au schéma M5_006A existant, aucune agrégation, aucun scheduler, aucune intégration `daily-run`, aucun déploiement Edge/Vercel, aucun changement `head-coach-engine`/`web`/`supabase/functions`. **M5 dans son ensemble reste EN COURS.**

**Impact** : `supabase/migrations/20260826090000..091500_M5_006B_*.sql` (4 nouvelles), `supabase/preflight/pattern_evidence_append_only_security_check.sql` (étendu), `longitudinal-engine/src/persistence/lifecycleAdapter.ts`/`lifecycleTypes.ts`/`sleepEnergyAdapter.ts` (nouveaux), `longitudinal-engine/src/persistence/index.ts` (exports ajoutés), `longitudinal-engine/src/detectors/sleepEnergyConstants.ts`/`sleepEnergyErrors.ts`/`sleepEnergyTypes.ts`/`sleepQualityToSameDayEnergyCorrelation.ts` (nouveaux), `longitudinal-engine/src/detectors/index.ts` (exports ajoutés), `longitudinal-engine/tests/unit/persistence/lifecycleAdapter.test.ts`/`sleepEnergyAdapter.test.ts` (nouveaux), `longitudinal-engine/tests/unit/detectors/sleepQualityToSameDayEnergyCorrelation.test.ts` (nouveau), `longitudinal-engine/tests/supabase/patternEvidenceLifecycle.integration.test.ts`/`sleepEnergyPersistence.integration.test.ts` (nouveaux), `longitudinal-engine/tests/supabase/patternEvidenceSchema.integration.test.ts` (timeout élargi uniquement), `longitudinal-engine/tests/supabase/testDb.ts` (`CheckinOverrides` étendu pour les fixtures sommeil-énergie), cette entrée. Aucun changement `head-coach-engine/src/**`, `web/**`, `supabase/functions/**`, `docs/03*`/`05*`/`06*`, aucune migration existante modifiée.

**Statut** : implémentation locale validée à l'époque de cette entrée ; **déployée remote et CLOSED depuis** — voir l'entrée de clôture ci-dessous (2026-08-26, après rollout).

---

## 2026-08-26 — M5_006B : durcissement de l'isolation des tests DB (`vitest.config.ts` + `patternEvidenceSchema.integration.test.ts`), aucun changement de production

**Contexte** : la revue finale avant rollout remote de M5_006B a demandé d'investiguer en profondeur un fait déjà observé pendant l'implémentation — le test de rollback atomique M5_006A dépasse occasionnellement le timeout `it()` sous la charge d'écriture concurrente accrue introduite par les nouvelles suites d'intégration M5_006B. Le simple élargissement du timeout (5s→20s, appliqué pendant l'implémentation) a été explicitement jugé insuffisant et non acceptable comme correctif final — à raison : ce n'était qu'un pansement sur un mécanisme réellement non borné.

**Cause racine — reproduite empiriquement, pas une hypothèse** : `runPsqlChecked` (l'aide de test qui exécute `docker exec ... psql`) utilise `spawnSync`, un appel **synchrone et bloquant au niveau du thread**. Preuve directe : un verrou `ACCESS EXCLUSIVE` maintenu délibérément sur `pattern_evidence_source_refs` depuis une session psql séparée a laissé un test dont le timeout `it()` était fixé à 3 secondes tourner sans jamais être interrompu ni signalé pendant plus de 30 secondes — la minuterie de timeout de vitest, purement JS/asynchrone, ne peut tout simplement pas s'exécuter tant que le thread est bloqué dans un appel natif synchrone. Le processus vitest entier reste donc gelé pour toute la durée de l'attente de verrou, quelle que soit la valeur du timeout configuré. Si, pendant cette attente non bornée, un mécanisme externe (budget de temps d'un job CI, interruption manuelle, script d'orchestration) tue le processus, l'enfant `docker exec`/psql détaché peut **continuer et terminer** son `CREATE TRIGGER`/`CREATE FUNCTION` en arrière-plan, sans qu'aucun code JS ne reste en vie pour jamais appeler le nettoyage — orphelinage réel, reproduit et confirmé (trigger + fonction scratch présents après un kill externe forcé pendant l'expérience de diagnostic).

**Pourquoi l'élargissement du timeout seul était insuffisant** : la contrainte violée n'est pas « le timeout JS était trop court » — c'est que `spawnSync` n'a **aucune borne intrinsèque**, et qu'un timeout `it()` JS est structurellement incapable d'en imposer une pendant que le thread est bloqué dans l'appel natif. Un timeout plus grand ne fait que retarder le moment où le même mécanisme d'orphelinage peut se produire, jamais l'éliminer.

**Correctif — élimine la course, puis borne le pire cas en défense en profondeur** :
1. **`vitest.config.ts` — `test.fileParallelism = false`.** Toutes les suites `tests/supabase/**` partagent une unique instance Postgres locale ; désactiver le parallélisme de fichiers garantit qu'aucun autre fichier d'intégration n'écrit plus jamais sur `pattern_evidence_source_refs` pendant que ce test de fault-injection y exécute son DDL — la contention à la source disparaît. Coût mesuré : négligeable (suite complète toujours ~20s, 27 fichiers, 409 tests).
2. **`SET lock_timeout` (8s) + `BEGIN`/`COMMIT` explicite** dans `installFaultTrigger()`/`removeFaultTrigger()` (`patternEvidenceSchema.integration.test.ts`) — défense en profondeur pour toute contention résiduelle/future : le DDL échoue maintenant vite et fort (`ERROR: canceling statement due to lock timeout`, capturé et relancé tel quel par `runPsqlChecked`) plutôt que de bloquer indéfiniment. **Correctif supplémentaire découvert pendant la validation** : `installFaultTrigger()` exécutait `CREATE FUNCTION` puis `CREATE TRIGGER` comme deux instructions autocommit séparées — un échec du second après succès du premier laissait la fonction orpheline malgré l'exception levée. Enveloppées dans une transaction explicite (`begin; ... commit;`) : soit les deux DDL réussissent, soit aucun n'est retenu (confirmé empiriquement sous contention forcée : trigger=0, function=0 après un échec `lock_timeout`, alors qu'avant ce correctif la fonction seule restait orpheline).
3. Timeout `it()` remonté de 20s à **15s** — non pas agrandi pour absorber la contention (celle-ci est désormais éliminée/bornée), mais fixé à une marge réaliste au-dessus de `lock_timeout` (8s) + la charge normale d'installation/RPC/suppression.

**Aucune invariant affaibli** : le contrôle préalable (trigger/fonction scratch = 0 avant toute installation) reste inchangé et continue d'échouer fort sur tout résidu — aucun nettoyage automatique silencieux n'a été ajouté. Les assertions de rollback atomique (identité/révision/provenance orphelines = 0) sont inchangées.

**Preuves empiriques** : rollback atomique isolé × 10 exécutions consécutives depuis un reset frais = **10/10 PASS**, objets scratch = 0/0 après chacune, aucun nettoyage manuel. Suite complète `longitudinal-engine` × 3 exécutions consécutives = **409/409** à chaque fois (comptage inchangé — aucun test ajouté, seul le harnais a changé), objets scratch = 0/0 après chacune. Build = PASS. Régressions gelées reconfirmées : M5_004=59/59, résolveur=15/15, M5_005=31/31, M1/M2=226/226, edge=9/9, M3 HTTP=26/26, completed-session unit=73/73, completed-session HTTP=70/70, web=242/242, web build=PASS.

**Portée** : `longitudinal-engine/tests/supabase/**` et `longitudinal-engine/vitest.config.ts` uniquement. **Aucun changement** aux 4 migrations M5_006B, à `persist_pattern_evidence`, à `transition_pattern_evidence_lifecycle`, à `persist_active_pattern_evidence`, à quelque schéma ou RPC de production que ce soit — aucun défaut de contrat de production découvert. Migrations toujours `local=22`, `remote=18`, `pending=4`, aucune écriture remote.

---

## 2026-08-26 — M5_006B : CLOSED (rollout remote complet)

**Contexte** : les trois commits M5_006B (`95a47eaf` lifecycle, `cb770169` détecteur, `f94477bc` durcissement) sont poussés sur `origin/main`, la revue de durcissement a produit une cause racine reproduite empiriquement (voir l'entrée précédente), et les quatre migrations ont été appliquées avec succès au projet Supabase remote `uvolpldwwyvadlamulvr`.

**Rollout remote — preuve** : `npx supabase db push --project-ref uvolpldwwyvadlamulvr` a appliqué exactement `20260826090000`/`090500`/`091000`/`091500`, aucune autre. Post-push : `local = remote = 22`, `pending = 0`. Vérification structurelle post-déploiement (lecture seule, `supabase db query` — jamais de mot de passe/connexion brute manipulé) : enum `pattern_evidence_lifecycle_state` = exactement `active`/`withdrawn` ; les 8 colonnes exactes de `pattern_evidence_lifecycle_transitions` (aucun `updated_at`) ; les deux FK `ON DELETE RESTRICT` ; les 3 triggers (prédécesseur + append-only ×2) ; RLS activé ; grants exacts (`authenticated`=SELECT seul, `service_role`=SELECT+INSERT seuls, `anon`=zéro) ; les deux RPC `transition_pattern_evidence_lifecycle`/`persist_active_pattern_evidence` en `SECURITY INVOKER`, `search_path=public`, exécution `service_role` seul, corps confirmé contenant `pg_advisory_xact_lock`/`hashtextextended` et jamais `FOR UPDATE` ; la RPC composite confirmée déléguant à `persist_pattern_evidence` (inchangée) et `transition_pattern_evidence_lifecycle` ; les 5 vues (3 M5_006A + 2 nouvelles) toutes `security_invoker=true`. Ledger remote confirmé vide après déploiement : `pattern_evidence_identities`/`_revisions`/`_source_refs`/`_lifecycle_transitions` = 0 partout — aucune ligne de démonstration créée.

**Décision** : **M5_006B = CLOSED.** Le modèle de cycle de vie M5_006B est déployé au niveau schéma/RPC sur `uvolpldwwyvadlamulvr`. Le détecteur pur `sleep_quality_to_same_day_energy_correlation` est implémenté, testé et verrouillé dans `longitudinal-engine`, mais n'est ni déployé comme runtime distant ni invoqué automatiquement en production. Aucun déploiement Edge Function, aucun déploiement Vercel, **aucun peuplement automatique de production** — ni `daily-run`, ni scheduler, ni intégration n'appelle ce détecteur ou ces RPC en production ; leur exécution reste entièrement manuelle/hors ligne à ce stade. **Aucun pattern appris n'influence `daily-run` en M5.** Safety A1-A5 inchangée. M1-M4 restent frozen. **M5 dans son ensemble reste EN COURS.**

**Prochain jalon (gelé, non entamé)** : **M5_006C — détecteur de persistance de la douleur.** Suivi ultérieurement de M5_006D (agrégation déterministe d'evidence, consommant obligatoirement `pattern_evidence_current_effective` — jamais `pattern_evidence_current` directement) puis M5_007 (insights / revue humaine). Aucun de ces jalons n'est implémenté ou architecturé par cette entrée.

**Impact** : aucun fichier de code — clôture documentaire uniquement. Migrations remote désormais `local = remote = 22`.

**Statut** : **CLOSED.** Commits : lifecycle `95a47eafc2216b1211b4fdc45f6f45f80552cf8c`, détecteur `cb7701692aec53a5d75e329ec10393005ec12936`, durcissement `f94477bcce318b4d08161b2b74c3ca0133eac406`. Déployé sur `uvolpldwwyvadlamulvr`. M5 dans son ensemble reste EN COURS — M5_006C et suivants restent à implémenter.

---

## 2026-08-26 — M5_006C : détecteur de persistance de la douleur, `longitudinal-engine/src/detectors/painPersistenceAcrossRecentCheckins.ts` (LOCAL uniquement — zéro migration, non déployé remote, non clos)

**Contexte** : M5_006B a livré le premier détecteur consommant le cycle de vie de l'evidence (sommeil-énergie). M5_006C livre le second détecteur, sur un axe totalement différent (persistance de la douleur d'un check-in à l'autre), réutilisant **exactement** l'infrastructure M5_006A/M5_006B (identité/révision/provenance, cycle de vie actif/retiré, `persist_active_pattern_evidence`/`transition_pattern_evidence_lifecycle`) sans ajouter la moindre migration. Explicitement **hors périmètre** : M5_006D (agrégation), Edge Function, scheduler, intégration `daily-run`, modification de Safety A1-A5 (strictement gelée) ou de `head-coach-engine/src/**`.

**Identité** : `detectorRuleId = "pain_persistence_across_recent_checkins"`, `detectorRuleVersion = "1.0.0"`. API pure : `detectPainPersistenceAcrossRecentCheckins({timeline, evaluationCheckinId})` — aucun Supabase, aucune horloge, aucun aléatoire.

**Observation — exacte, verrouillée** : `P` = le check-in observé le plus récent parmi `C-1`, `C-2`, `C-3`, recherché **dans cet ordre exact** — dès qu'un est présent, la recherche s'arrête ; **aucun check-in antérieur à `C-3` n'est jamais consommé**. « Supporting » signifie **uniquement** : la même douleur (même localisation) est encore rapportée au check-in observé suivant, au plus 3 jours calendaires après — **jamais** une affirmation de douleur continue sur des dates manquantes.

**Couverture de timeline — stricte, avant toute logique de recherche de `P`** : `[C-3, C]` requis exactement ; `timeline.range.fromDate <= C-3` et `timeline.range.toDate >= C`, sinon `InsufficientTimelineCoverageError` — jamais `no_evidence`. Invariant de date dupliquée sur les 4 dates `C-3..C` : 0=absent, 1=valide, >1=`DuplicateCheckinDateError`. **Réutilisation, aucune duplication** : `CheckinNotFoundInTimelineError`, `InsufficientTimelineCoverageError`, `DuplicateCheckinDateError` sont importées telles quelles depuis `sleepEnergyErrors.ts` (M5_006B) — déjà génériques (aucune formulation spécifique au sommeil-énergie), une seule identité pour ces trois invariants dans tout `detectors/**`.

**Clés — stables, verrouillées** : `evaluationKey = evidenceKey = "checkin:" + C.id + ":pain-persistence"`, portées par Evidence **et** NoEvidence. Dérivées uniquement de `C.id` — jamais affectées par un backfill/une correction de `P`, ce qui est précisément ce que la preuve T1→T2→T3 (voir plus bas) démontre empiriquement.

**Invariant structurel douleur/intensité — jamais normalisé** : le vrai schéma impose `pain=false ⟺ pain_intensity IS NULL`, `pain=true ⟺ pain_intensity IS NOT NULL ∈ [0,10]` (`daily_checkins_pain_intensity_check`/`pain_intensity_requires_pain`, M2_001 baseline). Le détecteur valide `P` et `C` contre cet invariant — un timeline synthétique qui le viole lève `InconsistentPainStateError` (nouvelle erreur, propre à ce détecteur). **Jamais de normalisation** : `pain=false` + intensité `NULL` n'est jamais réinterprété comme une intensité `0` — la sémantique de la source est préservée exactement.

**Ancrage « pas de douleur préalable »** : aucun `P` trouvé → `NoEvidence/no_recent_prior_checkin`, `previousCheckinId`/`previousCheckinDate = null`. `P.pain === false` → `NoEvidence/prior_checkin_has_no_pain`, **que `C` ait ou non de la douleur** — un nouvel épisode de douleur (`P` sans douleur → `C` avec douleur) n'est **jamais** interprété comme une contradiction de persistance (il n'y avait rien à persister).

**Classification — exacte, verrouillée, une fois `P.pain === true`** : `C.pain === false` → `contradicting`/`resolved`, aucune ambiguïté. Même localisation (les deux non-nulles et égales) : `C.painNew === false` → `supporting` ; `C.painNew === true` → `neutral`/`["current_marked_new"]` ; `C.painNew === null` → `neutral`/`["current_pain_new_unknown"]`. Localisations différentes (les deux non-nulles, distinctes) → `neutral`/`different_location` — **jamais** une inférence que la douleur de `P` a disparu. Localisation inconnue (l'une des deux `null`) → `neutral`/`location_unknown`. L'intensité (`intensityDelta` en hausse/baisse/stable) **n'affecte jamais** `eventType` — snapshot brut uniquement (`previousPainIntensity`/`evaluationPainIntensity`/`intensityDelta`, ce dernier `null` quand `C` n'a pas de douleur).

**Zéro consommation Safety/contexte** : le détecteur ne lit jamais `painTraumatic`/`painFunctionLoss`/`painGettingWorse`/`suspectedConcussion`/`feverOrIllness`, ni `sleepHours`/`sleepQuality`/`energy`/`workStress`/`motivation`/`legFatigue`/`gripFatigue`, ni `decisions`/`completed_sessions`/`decision_outcomes`/`health_flags` — Safety A1-A5 reste strictement séparée et gelée, aucun signal de second ordre n'est dérivé du même check-in douleur déjà lu par Safety. Prouvé par test dédié (deux timelines ne différant que sur ces champs → résultat `deep-equal`).

**`observedValue` — exactement 15 champs (verrouillé)** : `evaluationCheckinId`/`evaluationCheckinDate`/`previousCheckinId`/`previousCheckinDate`/`gapDays`/`previousPain`/`evaluationPain`/`previousPainLocationCode`/`evaluationPainLocationCode`/`previousPainIntensity`/`evaluationPainIntensity`/`intensityDelta`/`evaluationPainNew`/`transitionKind`/`ambiguityReasons`. `sourceRefs` — exactement `evaluationCheckinId`/`previousCheckinId`. `NoEvidence` — exactement 10 champs (incluant `evidenceKey`, `previousCheckinId`, `previousCheckinDate`, `reason` parmi `no_recent_prior_checkin`/`prior_checkin_has_no_pain`).

**Adaptateur** (`longitudinal-engine/src/persistence/painPersistenceAdapter.ts`, miroir exact de `sleepEnergyAdapter.ts`) : `Evidence` → `persist_active_pattern_evidence` (provenance = exactement `evaluation_checkin` + `previous_checkin`, tous deux `daily_checkin`). `NoEvidence` → `transition_pattern_evidence_lifecycle(target_state='withdrawn', reason_code=detection.reason, context={evaluation_checkin_id, evaluation_date, previous_checkin_id, previous_checkin_date})` — contexte à **4 champs** (vs 2 pour le sommeil-énergie), les deux derniers `null` pour `no_recent_prior_checkin`. Résultats de retrait remappés : `transitioned`→`withdrawn`, `unchanged`→`unchanged_withdrawal`, `skipped_no_prior`→`skipped_no_evidence_no_prior`. Erreurs RPC propagées **non enveloppées**.

**Preuve backfill/cycle de vie T1→T2→T3 (obligatoire, bout-en-bout, vrai détecteur → vraie DB)** : T1 — `C-3` = douleur même localisation, `C` = douleur même localisation `painNew=false` → `supporting`, evidence insérée, active (implicite, 0 ligne de cycle de vie). T2 — backfill de `C-1` avec `pain=false` → `P` devient `C-1` (plus proche) → `NoEvidence/prior_checkin_has_no_pain` → **même identité d'evidence RETIRÉE** (`pattern_evidence_current_state.lifecycle_state = 'withdrawn'`). T3 — suppression du backfill (delete de la ligne `C-1`) → `P` redevient `C-3` → détection **strictement `deep-equal`** à T1 → `persist_active_pattern_evidence` : `evidence_action = 'unchanged'` (**même `revision_id`** qu'à T1, aucune nouvelle révision), `lifecycle_action = 'transitioned'` (réactivation) → `pattern_evidence_current_effective` pointe à nouveau sur cette même révision. Les clés (`evaluationKey`/`evidenceKey`) restent identiques sur les trois passes, dérivées uniquement de `C.id`.

**Tests** : 39 tests unitaires détecteur (couverture/duplication/sélection de `P`/ancrage sans douleur préalable/classification complète/intensité non-classifiante/invariant structurel × 4 cas/non-consommation × 2/forme exacte `observedValue`/`sourceRefs`/`NoEvidence`/clés stables × 2/invariance d'ordre), 10 tests unitaires adaptateur (provenance exacte, mapping de réponse, contexte de retrait à 4 champs dont le cas sans `P`, remappage des 3 actions, erreurs non enveloppées), 3 tests d'intégration bout-en-bout (evidence réelle supporting, `no_evidence` sans `P`, T1→T2→T3 complet). **Total M5_006C = 52** (39+10+3). `npm run build` : succès propre.

**Régressions confirmées** : `longitudinal-engine` suite complète = **461/461** après un reset local frais, reconfirmé identique sur une seconde exécution consécutive sur ce même état (pas un second reset frais — preuve de stabilité valide, pas une preuve multi-reset), build = PASS. M5_004 calculateur = **59/59**, résolveur partagé = **15/15**, M5_005 détecteur = **31/31** (inchangés, inclus dans les 409). M1/M2 = **226/226**, edge = **9/9**, M3 HTTP = **26/26**, completed-session unit = **73/73**, completed-session HTTP = **70/70**, web = **242/242**, web build = PASS.

**Migrations — ZÉRO ajoutée** : M5_006C ne touche aucun schéma/RPC — réutilisation intégrale de l'infrastructure M5_006A/M5_006B. `local = remote = 22`, `pending = 0`, inchangé.

**Décision** : **M5_006C implémentation locale VALIDÉE — PAS COMPLETE/CLOSED, aucune migration, aucune écriture remote.** Le détecteur pur (`painPersistenceAcrossRecentCheckins.ts`) et son adaptateur sont implémentés, testés et verrouillés dans `longitudinal-engine`, mais ne sont ni déployés comme runtime distant ni invoqués automatiquement en production. Aucun changement `head-coach-engine/src/**`, `web/**`, `supabase/functions/**`, aucune migration. Safety A1-A5 inchangée, M1-M4 restent frozen. **Aucun pattern appris n'influence `daily-run` en M5.** **M5 dans son ensemble reste EN COURS.**

**Impact** : `longitudinal-engine/src/detectors/painPersistenceConstants.ts`/`painPersistenceErrors.ts`/`painPersistenceTypes.ts`/`painPersistenceAcrossRecentCheckins.ts` (nouveaux), `longitudinal-engine/src/detectors/index.ts` (exports ajoutés), `longitudinal-engine/src/persistence/painPersistenceAdapter.ts` (nouveau), `longitudinal-engine/src/persistence/index.ts` (exports ajoutés), `longitudinal-engine/tests/unit/detectors/painPersistenceAcrossRecentCheckins.test.ts` (39 tests), `longitudinal-engine/tests/unit/persistence/painPersistenceAdapter.test.ts` (10 tests), `longitudinal-engine/tests/supabase/painPersistencePersistence.integration.test.ts` (3 tests), `longitudinal-engine/tests/supabase/testDb.ts` (`CheckinOverrides.pain_new` ajouté), cette entrée. Aucun changement `head-coach-engine/src/**`, `web/**`, `supabase/functions/**`, `docs/03*`/`05*`/`06*`, aucune migration.

**Statut** : implémentation locale validée à l'époque de cette entrée ; **durcie puis CLOSED depuis** — voir l'entrée de clôture ci-dessous (2026-08-27).

---

## 2026-08-27 — M5_006C : CLOSED (implémentation locale + durcissement, aucun déploiement)

**Contexte** : les deux commits M5_006C (`34242ec7` implémentation, `ff2d3062` durcissement — validation entière/finie de l'intensité de douleur, preuves de non-consommation complètes sur `P` et sur les pools de timeline non liés au check-in) sont poussés sur `origin/main`, toutes les preuves empiriques sont au vert, et il n'y a — par conception — aucune étape de déploiement pour ce milestone : M5_006C n'ajoute **aucune migration**, ne touche ni `head-coach-engine/src/**`, ni `web/**`, ni `supabase/functions/**`. Contrairement à M5_006B (dont le modèle de cycle de vie a été déployé au niveau schéma/RPC sur `uvolpldwwyvadlamulvr`), M5_006C ne réutilise que l'infrastructure déjà déployée par M5_006A/M5_006B — il n'y a rien à pousser en remote.

**Décision** : **M5_006C = CLOSED.** Le détecteur pur `pain_persistence_across_recent_checkins@1.0.0` et son adaptateur de persistance sont implémentés, testés et verrouillés dans `longitudinal-engine` uniquement — aucun runtime distant, aucune invocation automatique en production, aucun scheduler, aucune intégration `daily-run`. **Aucun pattern appris n'influence `daily-run` en M5.** Safety A1-A5 inchangée. M1-M4 restent frozen. **M5 dans son ensemble reste EN COURS.**

**Preuves empiriques finales** : tests détecteur = **50/50**, adaptateur = **10/10**, intégration bout-en-bout = **3/3** (dont la preuve obligatoire de backfill/réactivation T1→T2→T3 — voir l'entrée d'implémentation ci-dessus pour le détail). `longitudinal-engine` suite complète = **472/472**, build = PASS. Régressions gelées : M5_004 = **59/59**, résolveur = **15/15**, M5_005 = **31/31**, M1/M2 = **226/226**, edge = **9/9**, M3 HTTP = **26/26**, completed-session unit = **73/73**, completed-session HTTP = **70/70**, web = **242/242**, web build = PASS. Migrations : **local = remote = 22**, `pending = 0`, inchangé — zéro migration ajoutée par ce milestone. Aucune écriture remote, aucun déploiement Edge/Vercel.

**Prochain jalon (gelé, non entamé)** : **M5_006D — agrégation déterministe d'evidence.** Contrat d'entrée verrouillé : consomme obligatoirement `pattern_evidence_current_effective` (jamais `pattern_evidence_current` directement) — doit agréger uniquement l'evidence dont l'état de cycle de vie effectif est actif. Suivi ultérieurement de M5_007 (insights / revue humaine). Aucun de ces jalons n'est implémenté ou architecturé par cette entrée.

**Impact** : aucun fichier de code — clôture documentaire uniquement.

**Statut** : **CLOSED.** Commits : implémentation `34242ec72935e62e708750bef602709a835e1be9` (`feat: add pain persistence detector`), durcissement `ff2d306206bfe3dfd944d9ebc64a5fc06dc964db` (`test: harden pain persistence invariants`). Aucun déploiement, aucune écriture remote. M5 dans son ensemble reste EN COURS — M5_006D et suivants restent à implémenter.

---

## 2026-08-27 — M5_006D : agrégation déterministe d'evidence effective, `longitudinal-engine/src/aggregation/**` (LOCAL uniquement — zéro migration, non déployé remote, non clos)

**Contexte** : M5_006A/B/C ont livré le ledger d'evidence append-only, le cycle de vie actif/retiré, et deux détecteurs (sommeil-énergie, persistance de la douleur). M5_006D livre le premier consommateur du contrat de lecture verrouillé à la clôture de M5_006B : agréger **uniquement** l'evidence dont l'état de cycle de vie effectif est actif (`pattern_evidence_current_effective`), jamais `pattern_evidence_current` directement. Explicitement **hors périmètre** : décider qu'un pattern est confirmé, calculer un score de confiance ou une significativité statistique, inférer une causalité, activer une règle de coaching, interpréter `observedValue` (spécifique à chaque détecteur — opaque ici), ou influencer `daily-run`. Ces interprétations restent réservées à M5_007 (insights / revue humaine).

**API pure** : `aggregateEffectivePatternEvidence({athleteId, range, evidence})` — aucun Supabase, aucune horloge, aucun aléatoire. `range` est un `DateRange` inclusif réutilisé tel quel (`src/types/adapter.js`, verrouillé M5_002A). La validation de bonne formation de `range` réutilise `parseCanonicalDateUtc` (`timeline/range.ts`, M5_002B) plutôt que de réimplémenter un parseur de date.

**Groupement — exact, verrouillé** : uniquement par `(athleteId, detectorRuleId, detectorRuleVersion)` — deux versions du même détecteur ne sont **jamais** fusionnées. Aucun groupement par ni interprétation de `observedValue` (localisation de douleur, intensité, bucket de sommeil, type de séance) — le type `PatternEvidenceCurrentEffectiveRow.observedValue` est typé `unknown` (pas `Record<string, unknown>`) précisément pour qu'aucun accès de propriété ne compile sans cast explicite, verrouillant la non-consommation au niveau du système de types, pas seulement par discipline de code.

**Sortie exacte** : `PatternEvidenceAggregate` — exactement 17 champs (`athleteId`/`detectorRuleId`/`detectorRuleVersion`/`rangeFromDate`/`rangeToDate`/`evidenceCount`/`supportingCount`/`contradictingCount`/`neutralCount`/`directionalEvidenceCount`/`supportingRatio`/`contradictingRatio`/`neutralRatio`/`evidenceBalance`/`firstEventDate`/`lastEventDate`/`sourceEvidenceRefs`) — **aucun** champ `confidence`/`score`/`significance`/`recommendation`/état d'activation ou d'acceptation. `PatternEvidenceAggregateSourceRef` — exactement 7 champs. Arithmétique exacte, verrouillée : `evidenceCount = supportingCount + contradictingCount + neutralCount` ; `directionalEvidenceCount = supportingCount + contradictingCount` ; `supportingRatio`/`contradictingRatio` = `null` si `directionalEvidenceCount = 0`, sinon division exacte (**aucun arrondi**) ; `neutralRatio` toujours calculé sur `evidenceCount` (jamais sur `directionalEvidenceCount`). `evidenceBalance` — étiquette arithmétique **descriptive uniquement, jamais une validation de pattern** : `neutral_only`/`supporting_only`/`contradicting_only`/`supporting_majority`/`contradicting_majority`/`balanced` (égalité `support = contradiction > 0`).

**Entrée vide** : `evidence = []` → `[]` — jamais un agrégat fantôme à compteurs zéro.

**Invariants structurels — fail loud, verrouillés** : chaque ligne fournie doit satisfaire `range.fromDate <= eventDate <= range.toDate`, sinon `EvidenceOutsideAggregationRangeError` (jamais un filtrage silencieux). Chaque ligne doit appartenir à `athleteId`, sinon `AggregationAthleteScopeMismatchError` (nouvelle erreur, propre à l'agrégation — la forme du constructeur de `AthleteScopeMismatchError` existante, M5_005, était spécifique au couple decision/thread et ne correspondait pas à la forme requise ici ; réutiliser aurait été un mésusage plutôt qu'une vraie réutilisation). Doublon d'`identityId` (portée globale — une identité n'appartient structurellement qu'à un seul groupe) → `DuplicateEffectiveEvidenceIdentityError`. Doublon d'`evidenceKey` **au sein du même groupe** `(detectorRuleId, detectorRuleVersion)` → `DuplicateEffectiveEvidenceKeyError` (le même `evidenceKey` textuel dans deux groupes différents est explicitement autorisé — prouvé par test dédié). Aucune déduplication silencieuse nulle part. `CheckinNotFoundInTimelineError`/`InsufficientTimelineCoverageError`/`DuplicateCheckinDateError` (M5_006B) ne sont **pas** réutilisées ici — elles concernent la recherche de checkin dans un `AthleteTimeline`, un domaine sans rapport avec l'agrégation d'evidence effective.

**Ordonnancement déterministe** : agrégats triés par `detectorRuleId` ASC puis `detectorRuleVersion` ASC ; `sourceEvidenceRefs` triés par `eventDate` ASC, `evidenceKey` ASC, `identityId` ASC, `revisionId` ASC. Mélanger le tableau `evidence` en entrée produit une sortie **strictement `deep-equal`** (prouvé par test dédié, y compris l'ordre complet de `sourceEvidenceRefs`).

**Adaptateur Supabase en lecture seule** : `SupabasePatternEvidenceAggregationAdapter.getCurrentEffectivePatternEvidence(athleteId, range)` (`longitudinal-engine/src/supabase/patternEvidenceAggregationAdapter.ts`) — une classe **séparée** de `SupabaseLongitudinalSourceAdapter` (qui implémente l'interface fermée `LongitudinalSourceAdapter`, M5_002A, sans rapport avec cette vue). Interroge **exclusivement** `pattern_evidence_current_effective` (`.eq("athlete_id", athleteId).gte("event_date", range.fromDate).lte("event_date", range.toDate)`), jamais `pattern_evidence_current`/`_history`/`_current_state`. Aucune écriture, aucun appel RPC — grep dédié du fichier pour confirmer l'absence de `.insert(`/`.update(`/`.upsert(`/`.delete(`/`.rpc(`, même discipline que `adapter.ts` (M5_002A). Nouveau mapper `mapPatternEvidenceCurrentEffectiveRow` (`rowMapping.ts`) — `observed_value` transmis tel quel, jamais validé/interprété (contrairement à `input_snapshot`/`outcome_signals` qui exigent un objet JSON réel : ici, aucune exigence de forme n'est même imposée, puisque l'agrégation ne le lit jamais).

**Preuve d'intégration cycle de vie (bout-en-bout, vraie DB, zéro logique de cycle de vie dans M5_006D lui-même)** : T1 — evidence effective A = `supporting`, B = `contradicting` → agrégat `support=1, contradiction=1, balance=balanced`. T2 — retrait de A via `transition_pattern_evidence_lifecycle` (RPC M5_006B existante, non modifiée) → `pattern_evidence_current_effective` exclut A → agrégat `support=0, contradiction=1, balance=contradicting_only`. T3 — réactivation de A → `pattern_evidence_current_effective` contient A à nouveau → agrégat `support=1, contradiction=1, balance=balanced`. Preuve tête-de-révision-uniquement : identité X, révision 1 `supporting` puis révision 2 `contradicting` → `pattern_evidence_current_effective` n'expose **que** la révision 2 → l'agrégation compte `supporting=0, contradicting=1`, **aucun double comptage historique**. Preuve de portée de l'adaptateur : une identité retirée est absente des lignes de l'adaptateur alors qu'elle demeure présente dans `pattern_evidence_current` — preuve que l'adaptateur ne bascule jamais silencieusement sur cette dernière vue.

**Tests** : 33 tests unitaires purs (entrée vide, cas à une seule evidence, matrice complète de balance, ratios exacts sans arrondi, groupement multi-règles et séparation de version — dont le scénario verrouillé `ruleA@1.0.0`/`ruleA@2.0.0`/`ruleB@1.0.0` → exactement 3 agrégats —, bornes inclusives de plage, échecs forts hors-plage/hors-athlète/doublons × 2, ordonnancement déterministe × 3 dont l'invariance par mélange, non-consommation d'`observedValue`, formes exactes de sortie × 2, dates première/dernière, absence d'agrégat fantôme), 3 tests d'intégration bout-en-bout (T1→T2→T3 cycle de vie, tête-de-révision-uniquement, portée exacte de l'adaptateur). **Total M5_006D = 36.** `npm run build` : succès propre.

**Régressions confirmées** : `longitudinal-engine` suite complète = **508/508** (472 + 36) après un reset local frais, reconfirmé identique sur une seconde exécution consécutive sur ce même état, build = PASS. M5_004 calculateur = **59/59**, résolveur partagé = **15/15**, M5_005 détecteur = **31/31**, M5_006C détecteur = **50/50**, adaptateur = **10/10**, intégration = **3/3** (tous inchangés, inclus dans les 472). M1/M2 = **226/226**, edge = **9/9**, M3 HTTP = **26/26** (premier passage flaky après un restart complet de la stack locale, vert au second passage sans modification de code — pattern déjà documenté pour ce harnais), completed-session unit = **73/73**, completed-session HTTP = **70/70**, web = **242/242**, web build = PASS.

**Migrations — ZÉRO ajoutée** : M5_006D ne touche aucun schéma/RPC — lecture pure via la vue `pattern_evidence_current_effective` déjà déployée par M5_006B. `local = remote = 22`, `pending = 0`, inchangé.

**Décision** : **M5_006D implémentation locale VALIDÉE — PAS COMPLETE/CLOSED, aucune migration, aucune écriture remote.** L'agrégation pure (`aggregateEffectivePatternEvidence.ts`) et son adaptateur de lecture sont implémentés, testés et verrouillés dans `longitudinal-engine`, mais ne sont invoqués par aucun runtime distant, aucun scheduler, aucune intégration `daily-run`. Aucun changement `head-coach-engine/src/**`, `web/**`, `supabase/functions/**`, aucune migration. Safety A1-A5 inchangée, M1-M4 restent frozen. **Aucun pattern appris n'influence `daily-run` en M5.** **M5 dans son ensemble reste EN COURS.**

**Impact** : `longitudinal-engine/src/aggregation/types.ts`/`errors.ts`/`aggregateEffectivePatternEvidence.ts`/`index.ts` (nouveaux), `longitudinal-engine/src/supabase/patternEvidenceAggregationAdapter.ts` (nouveau), `longitudinal-engine/src/supabase/rowMapping.ts` (`requireNumber` + `mapPatternEvidenceCurrentEffectiveRow` ajoutés), `longitudinal-engine/src/supabase/index.ts` (export ajouté), `longitudinal-engine/src/index.ts` (export `aggregation/**` ajouté), `longitudinal-engine/tests/unit/aggregation/aggregateEffectivePatternEvidence.test.ts` (33 tests), `longitudinal-engine/tests/supabase/patternEvidenceAggregation.integration.test.ts` (3 tests), cette entrée. Aucun changement `head-coach-engine/src/**`, `web/**`, `supabase/functions/**`, `docs/03*`/`05*`/`06*`, aucune migration.

**Statut** : implémentation locale validée, toutes les preuves empiriques (pures + DB-dépendantes) au vert, **zéro migration, aucune écriture remote, aucune clôture** ; revue de clôture M5_006D reste une étape distincte, non entamée ; M5 dans son ensemble reste en cours
