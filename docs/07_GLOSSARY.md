# 07 — Glossary

Vocabulaire canonique du Louis Performance System. Toute implémentation doit utiliser exactement ces termes. Ne pas inventer de synonymes.

## Concepts métier

**Head Coach**
Le système de décision quotidien qui combine 7 domaines de coaching. Il ne se limite pas à prescrire un workout — il choisit le levier le plus pertinent du jour.

**DailyPlan**
Sortie principale du moteur pour un jour donné. Objet structuré par domaine (`training`, `mental`, `recovery`, etc.) avec `reasoning`, `confidence`, `triggered_rules`.

**RecentRecoveryContext (V0.3_008A, CLOSED / PRODUCTION ROLLOUT COMPLETE)**
Contexte factuel de récupération J-1, jamais une dimension notée ni un signal d'arbitrage. Présent sur `RawContext` et, à l'identique, persisté tel quel dans `DailyPlan.recent_recovery_context` (instantané immuable au moment de la génération). Éligibilité stricte : session complétée de la veille EXACTE (jamais « la plus récente »), `change_reason = fatigue_control`, `completion_status` ∈ `{partial, replaced, skipped}`. Ne mute jamais `DimensionState`, `SignalTrace`, `final_session` ni la décision — voir `docs/03_COACHING_MODEL.md` §3 (lecture de support non consommante) et `docs/11_DECISION_LOG.md` (2026-09-10, V0.3_008A).

**RecentTechnicalContext / prior_task_reference (V0.3_008B, CLOSED / PRODUCTION ROLLOUT COMPLETE)**
Mémoire technique factuelle historique, jamais une dimension notée ni un signal d'arbitrage — DISPLAY ONLY. `RawContext.recent_technical_context` = ce que le moteur sait (résolu dans une fenêtre strictement inter-jours `D-14 ≤ session_date < D`, jour même et futur exclus, PROVISIONAL PRODUCT-FRESHNESS CONSTANT non calibrée). `DailyPlan.dh_or_technical.prior_task_reference` = ce que le coach a réellement surfacé aujourd'hui, persisté **uniquement** quand la session finale du jour est elle-même DH-family — instantané immuable au moment de la génération (`decisions.daily_plan`), jamais recalculé si la session source est corrigée après coup. Lien source exact uniquement : `completed_sessions.decision_id → decisions.id` (jamais une inférence par date/similarité), kind performé lu depuis `completed_sessions.intervention.kind` (jamais la prescription). Ne mute jamais `focus`/`execution_task` du jour, ni `SignalTrace`, ni `final_session`, ni la décision. Aucun matching sémantique cross-kind (un fait `DH_TECHNICAL` historique peut être surfacé même si le kind final du jour diffère). Progression automatique (répéter/simplifier/progresser selon `technical_outcome`) explicitement différée — voir `docs/03_COACHING_MODEL.md` §DH Execution Guidance et `docs/11_DECISION_LOG.md` (2026-09-14, V0.3_008B).

**Athlete Model**
Ensemble des connaissances sur Louis : identité, contexte pro, historique physique, mental, calendrier, patterns. Document canonique : `02_ATHLETE_PROFILE.md`.

**Dimension**
Axe d'évaluation de l'état de Louis. Six dimensions canoniques : `systemic`, `legs`, `arms_grip`, `mental`, `health`, `recent_load`. Le `context` n'est pas une dimension mais un `ContextState` structuré séparé.

**AthleteState (MultidimensionalAthleteState)**
État calculé pour un jour donné = `AthleteDimensions` (6 dimensions) + `ContextState`.

**global_readiness_ui**
Score agrégé 0-1 destiné à l'interface utilisateur uniquement. **Ne doit pas** être utilisé comme cerveau de décision.

**Dimension Level**
`GREEN` / `AMBER` / `RED`. Utilisé par dimension, pas globalement.

**ContextState**
Contexte structuré (bloc, mode, planned session, availability, event context, life constraints). **Pas** une DimensionState — pas de score GREEN/AMBER/RED.

## Contexte course

**UpcomingRace**
Événement compétitif futur ou récent. Contient `event_start`, `event_end`, `priority`, `race_format`, éventuellement `race_phase`.

**EventContext**
Contexte enrichi d'une course pertinente à la date du jour. Contient `days_to_event`, `days_from_event`, `event_day`, `in_progress`, `phase`. Couvre pré-event, event en cours et fenêtre post-event utile.

**RacePriority**
`A_PLUS` / `A` / `B` / `C`. Détermine la force des soft constraints en approche.

**RaceFormat**
`HOT_TRAIL_2DAY` / `IXS_3DAY` / `SWISS_CUP` / `UCI_WC` / `UCI_WORLDS` / `OTHER`.

**RacePhase**
`PRE_EVENT` / `TRACKWALK` / `PRACTICE` / `PRACTICE_TIMED` / `QUALI` / `FINAL` / `RACE_DAY_GENERIC` / `POST_EVENT`.

**RaceProtocolRecommendation**
Recommandation par défaut du protocole T-X pour un jour donné. Contient `recommended_session`, `reasoning`, `soft_constraints`. **N'est jamais une session forcée** — le Head Coach peut la surcharger.

## Modes opérationnels

**TrainingMode**
Mode global du bloc en cours. Valeurs :
- `RACE_WEEK`
- `RACE_CLUSTER`
- `OFF_SEASON_RECOVERY`
- `OFF_SEASON_DEVELOPMENT`
- `PRE_SEASON`
- `IN_SEASON`
- `INJURY_RECOVERY`
- `OTHER`

Chaque mode définit des soft constraints par défaut.

## Sessions

**DbSessionType** (persistance)
Enum coarse de la DB Supabase V0.2. Valeurs : `STRENGTH_A`, `STRENGTH_B`, `AEROBIC_BASE`, `AEROBIC_INTERVALS`, `DH_TECHNICAL`, `DH_PERFORMANCE`, `RECOVERY`, `REST`, `BIKE_MAINTENANCE`, `RACE_PREP`.
Utilisé pour toute écriture en base.

**TrainingIntervention** (interne moteur)
Représentation interne riche d'une intervention d'entraînement. **Un simple enum est insuffisant.** Chaque `TrainingIntervention` combine au minimum :

- `kind` : nature de l'intervention (`STRENGTH_LOWER`, `STRENGTH_UPPER`, `POWER`, `GRIP_WORK`, `AEROBIC_BASE`, `AEROBIC_INTERVALS`, `DH_TECHNICAL`, `DH_PERFORMANCE`, `DH_LIGHT`, `PUMPTRACK`, `MOBILITY`, `RECOVERY_ACTIVE`, `REST`, `BIKE_MAINTENANCE`, `RACE_ACTIVITY`)
- `load_profile` : `HEAVY` / `MODERATE` / `LIGHT` (nécessaire pour rendre le mapping vers `DbSessionType` déterministe)

D'autres attributs peuvent être ajoutés (durée, focus, cue) mais `kind` + `load_profile` sont le minimum pour garantir un mapping déterministe.

L'implémentation TypeScript exacte (interface, record, class) est laissée à Claude Code.

Le mapping `TrainingIntervention → DbSessionType` est **une fonction pure déterministe** : pour un couple `(kind, load_profile)` donné, la sortie est unique. Voir `05_DATA_MODEL.md`.

**duration_min (session DH)** (V0.3_006B, PROVISIONAL ; wiring Planning V0.3_006C2)
Champ existant de `TrainingIntervention`, en minutes. Pour une session DH-family (`DH_PERFORMANCE`/`DH_TECHNICAL`/`DH_LIGHT`/`PUMPTRACK`), représente la **fenêtre totale de session / temps sur site** — descente, remontée mécanique, pauses, attente, reconnaissance, récupération entre runs inclus conceptuellement. **N'est jamais** le temps de pédalage/descente continu ni le temps physiologique effectif. Ne pas confondre avec un temps d'effort. Sémantique athlète (V0.3_006C2) : durée que l'athlète prévoit de consacrer à la séance — exacte si l'arbitrage ne change ni le kind ni la charge (vrai KEEP), borne supérieure sinon (jamais un plancher, voir `resolveDhDuration`). **Jamais** une pure contrainte de disponibilité maximale à elle seule — un futur concept de disponibilité pure serait distinct, non créé par ce jalon. Écrit par Planning (`web/src/features/planning/planningRepo.ts#savePlannedSession`) uniquement pour un kind DH-family en V0.3_006C2 — `planned_sessions.planned_duration_min` (colonne séparée) reste délibérément dormante, jamais activée. Voir `docs/03_COACHING_MODEL.md` §Session Prescription V1 et §DH Execution Guidance.

**execution_task** (V0.3_006C1, corrigé V0.3_008B0)
Champ optionnel de `DhTechnicalSection` (à côté de `focus`/`load_guidance`/`spot_hint`). `focus` = ce qui est travaillé (thème/attention) ; `execution_task` = comment le travailler aujourd'hui, une tâche concrète et observable. Depuis V0.3_008B0, `focus` et `execution_task` sont des concepts **indépendants** : `execution_task` est toujours le repli générique fixe par kind (`DH_GENERIC_EXECUTION_TASK`), présent dès que la session finale est DH-family, **que `technique_primary_focus` soit configuré ou non** — un focus personnel ne le suppose plus absent. Invariant inchangé et toujours strict : jamais dérivé du texte libre personnel (pas de tentative déterministe de "comprendre" un texte libre, aucun LLM, aucune inférence par mot-clé/regex/taxonomie) — la tâche reste le même texte fixe par kind quel que soit le contenu du focus. Voir `docs/03_COACHING_MODEL.md` §DH Execution Guidance et `docs/11_DECISION_LOG.md` (2026-09-13/14, V0.3_008B0).

**load_guidance** (V0.3_006C1, correction avant commit)
Champ optionnel de `DhTechnicalSection`, distinct de `focus`/`execution_task` : comment rouler selon la charge (`load_profile`) du jour, résolu depuis la session finale entièrement arbitrée. Engine-emitted et **persisté** dans `decisions.daily_plan` — jamais recalculé côté web depuis `load_profile` seul, pour qu'un `DailyPlan` legacy sans ce champ ne gagne jamais rétroactivement une instruction de coaching qu'il n'a jamais réellement portée (invariant canonique d'historique). Voir `docs/03_COACHING_MODEL.md` §DH Execution Guidance.

## Règles et couches

**Couche A — Safety Rules**
Non-contournables. Seules règles vraiment hard du système. Limitées aux critères médicaux stricts (voir `04_DAILY_DECISION_ENGINE.md`).

**Couche B — Mode + Race Context**
Contexte global du jour. Produit des soft constraints, pas des interdictions dures.

**Couche C — Coaching Heuristics**
Hypothèses initiales révisables par domaine. Marquées `PROVISIONAL` tant que non calibrées.

**Couche D — Personal Rules**
Règles apprises avec preuves longitudinales suffisantes. Vide en V0.2.

**Couche E — LLM Judgement**
Rédaction et nuance contextuelle. Ne peut pas contourner A/B/C/D. Hors V0.2.

**SoftConstraint**
Préférence de coaching avec `type`, `reason`, `weight` (`strong` / `moderate` / `weak`). Même `strong` reste soft — dérogation possible avec `override_reason` loggée.

**HardConstraint**
N'existe qu'en couche A (SAFETY). Non-contournable.

## Traçabilité

**Trace des signaux consommés**
Structure (implémentation libre) qui enregistre les signaux utilisés par les règles pendant la décision. Empêche le double-counting : un signal marqué comme utilisé ne peut plus déclencher une seconde adaptation.

**TriggeredRule**
Trace d'une règle activée : `layer`, `step`, `detail`, éventuellement `signals_used`.

**override_reason**
Chaîne loggée quand le Head Coach déroge à une soft constraint ou à une `recommended_session` du protocole T-X. Toute dérogation doit avoir une raison explicite.

## Health

**HealthFlag**
Structure représentant un état de santé actif. Contient au minimum `type` (`concussion_suspect`, `injury_suspect`, `illness`, `pain_persistent`) et `status` (`active`, `monitoring`, `resolved`). Le `active_health_flags` dans le RawContext est une liste `HealthFlag[]`, pas un simple count.

## Faits / Hypothèses / Patterns

**Fait**
Donnée mesurée ou déclarée, vérifiable. Stockée dans la DB (baseline, checkin, résultat). Ne contient jamais d'interprétation.

**Coaching Hypothesis**
Interprétation initiale, révisable. Ex : "grip endurance sous-développé", "sommeil = atout majeur". Vit dans les documents (`02_ATHLETE_PROFILE.md`, `03_COACHING_MODEL.md`), pas dans les tables de faits.

**Learned Pattern**
Corrélation confirmée avec preuves longitudinales suffisantes (quantité + durée + absence de contre-exemples). Aucun learned pattern n'est activé sans validation. Couche D vide en V0.2.

**ActiveExperiment**
Expérimentation temporaire à fenêtre de review. Contient `id`, `hypothesis`, `start_date`, `intervention`, `metrics`, `review_date`, `status`. Influence le moteur uniquement tant que `status = active`. Concept documenté en M1, implémentation runtime en P1.

## Nutrition et récupération

**Baseline PROVISIONAL**
Cible numérique initiale non individualisée (ex : 8h sommeil, 2 L eau/jour). À personnaliser avec les données de Louis avant d'être traitée comme vérité.

## Confidence

**Confidence**
Enum qualitatif en V0.2 : `LOW` / `MEDIUM` / `HIGH`. Tout score numérique de confidence est proscrit en V0.2.

## Fixtures et tests

**Fixture Louis**
Contexte réaliste préparé pour les tests, basé sur les données réelles de Louis Giller (bloc courant `RACE_CLUSTER`, courses restantes 2026, etc.).

**Test déterministe**
Test dont la sortie attendue est unique. Interdiction d'utiliser `expect().toContain([...])` sur des sorties alternatives. Si le comportement est ambigu, l'arbitrage doit être défini dans la spec avant l'écriture du test.

## Génération de plan (V0.4)

**GenerationContext** (`head-coach-engine/src/generation/generationEngine.ts`)
Enveloppe d'identité mintée par `runGenerationEngine()` au début de chaque appel : `planVersionId`, `generationRequestId`, `blockId`. Seule source de ces trois ids — jamais générés par `planning-engine` ni `prescription-engine`.

**AssembledWeek** (`head-coach-engine/src/generation/generationEngine.ts`)
Semaine assemblée par `runGenerationEngine()` : reprend les champs déjà produits par l'`OrchestratedWeek` de `planning-engine` (`weekType`, `doseSummary`, `rationale`, `relaxedConstraints`), enrichis d'un `id` et d'un `blockId` mintés par head-coach-engine, et d'un tableau d'`AssembledSession`.

**AssembledSession** (`head-coach-engine/src/generation/generationEngine.ts`)
Session assemblée par `runGenerationEngine()` : reprend les champs déjà produits par `planning-engine` (`date`, `kind`, `loadProfile`, `durationMin`, `doseTarget`, `rationale`), enrichis d'un `generatedPlanSessionId` et d'un `weekId` mintés par head-coach-engine, et d'une `prescription` optionnelle (`PrescriptionResult`) — absente pour les sessions aerobic, jamais un placeholder.

**PrescriptionRequest** (`prescription-engine/src/index.ts`)
Contrat d'entrée de `prescription-engine` : une séance unique (`kind`, `doseTarget`, `equipment`, `technicalPriorities`, `terrainAccess`, `strengthExperienceTier`, `generatedPlanSessionId`, `plannedPrescriptionId` fournis par l'appelant). Jamais un plan ou une semaine entière.

**PrescriptionResult** (`prescription-engine/src/index.ts`)
Contrat de sortie de `prescription-engine` : `{prescription: PlannedPrescription, relaxedConstraints: RelaxedConstraint[]}`. `relaxedConstraints` reste toujours `[]` en V1 — la collecte de contraintes relâchées appartient à une couche supérieure, non encore construite.

**PlannedPrescription** (`planning-engine/src/types/prescription.ts`)
Modèle canonique d'une prescription planifiée complète, appartenant à exactement une `GeneratedPlanSession`. Porte son identité propre (`id`), la référence à la session qu'elle prescrit (`generatedPlanSessionId`), ses versions (`schemaVersion`, `catalogVersion`), et le contenu métier lui-même via `structure: PrescriptionStructure`. `prescription-engine` construit le contenu (`structure`) ; `head-coach-engine` assigne l'identité (`id`, via `PrescriptionRequest.plannedPrescriptionId`) — voir `docs/11_DECISION_LOG.md` (V0.4_016/017). Utilisé par le modèle de persistance des prescriptions planifiées (`training_plan_planned_prescriptions`).

**PrescriptionStructure** (`planning-engine/src/types/prescriptionStructure.ts`)
Structure canonique du contenu d'une prescription — union fermée à deux domaines pour V1 (`StrengthPrescription | DhTechnicalPrescription`), jamais un troisième variant (les sessions aerobic n'ont pas de `PlannedPrescription` du tout). Représente uniquement le contenu métier de la séance (exercices/reps/repos pour Strength, drills/runs/consignes pour DH) — jamais son identité ni sa persistance, portées par `PlannedPrescription` qui l'englobe. Validée structurellement par `validatePrescriptionStructure()` (`planning-engine/src/validation/validatePrescription.ts`), appelée une seule fois en frontière de sortie par le point d'entrée de `prescription-engine` — jamais dans les resolvers, jamais dupliquée.
