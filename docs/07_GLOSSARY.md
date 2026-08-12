# 07 — Glossary

Vocabulaire canonique du Louis Performance System. Toute implémentation doit utiliser exactement ces termes. Ne pas inventer de synonymes.

## Concepts métier

**Head Coach**
Le système de décision quotidien qui combine 7 domaines de coaching. Il ne se limite pas à prescrire un workout — il choisit le levier le plus pertinent du jour.

**DailyPlan**
Sortie principale du moteur pour un jour donné. Objet structuré par domaine (`training`, `mental`, `recovery`, etc.) avec `reasoning`, `confidence`, `triggered_rules`.

**Athlete Model**
Ensemble des connaissances sur Louis : identité, contexte pro, historique physique, mental, calendrier, patterns. Document canonique : `02_ATHLETE_PROFILE.md`.

**Dimension**
Axe d'évaluation de l'état de Louis. Sept dimensions canoniques : `systemic`, `legs`, `arms_grip`, `mental`, `health`, `recent_load`, `context`.

**AthleteState**
État calculé pour un jour donné, contenant les dimensions et le contexte dérivé (mode, event, fatigue 7j, etc.).

**global_readiness_ui**
Score agrégé 0-1 destiné à l'interface utilisateur uniquement. **Ne doit pas** être utilisé comme cerveau de décision.

**Dimension Level**
`GREEN` / `AMBER` / `RED`. Utilisé par dimension, pas globalement.

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

**CausalTrace**
Structure qui enregistre les signaux utilisés par les règles pendant la décision. Empêche le double-counting : un signal marqué comme utilisé ne peut plus déclencher une seconde adaptation.

**TriggeredRule**
Trace d'une règle activée : `layer`, `step`, `detail`, éventuellement `signals_used`.

**override_reason**
Chaîne loggée quand le Head Coach déroge à une soft constraint ou à une `recommended_session` du protocole T-X. Toute dérogation doit avoir une raison explicite.

## Faits / Hypothèses / Patterns

**Fait**
Donnée mesurée ou déclarée, vérifiable. Stockée dans la DB (baseline, checkin, résultat). Ne contient jamais d'interprétation.

**Coaching Hypothesis**
Interprétation initiale, révisable. Ex : "grip endurance sous-développé", "sommeil = atout majeur". Vit dans les documents (`02_ATHLETE_PROFILE.md`, `03_COACHING_MODEL.md`), pas dans les tables de faits.

**Learned Pattern**
Corrélation confirmée avec preuves longitudinales suffisantes (quantité + durée + absence de contre-exemples). Aucun learned pattern n'est activé sans validation. Couche D vide en V0.2.

## Nutrition et récupération

**Baseline PROVISIONAL**
Cible numérique initiale non individualisée (ex : 8h sommeil, 2 L eau/jour). À personnaliser avec les données de Louis avant d'être traitée comme vérité.

## Fixtures et tests

**Fixture Louis**
Contexte réaliste préparé pour les tests, basé sur les données réelles de Louis Giller (bloc courant `RACE_CLUSTER`, courses restantes 2026, etc.).

**Test déterministe**
Test dont la sortie attendue est unique. Interdiction d'utiliser `expect().toContain([...])` sur des sorties alternatives. Si le comportement est ambigu, l'arbitrage doit être défini dans la spec avant l'écriture du test.