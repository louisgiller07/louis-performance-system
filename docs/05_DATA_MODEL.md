# 05 — Data Model

## Statut

Le schéma Supabase V0.2 est **déjà déployé et validé**. Ce document décrit :

- Les 12 tables existantes et leur rôle
- Les enums (persistance vs interne)
- La séparation `DbSessionType` (DB coarse) vs `TrainingIntervention` (interne riche)
- Le mapping entre les deux
- Les évolutions futures anticipées (additives, non-destructives)

**Aucune modification du schéma existant ne doit être faite sans discussion.** Toute évolution doit être additive et documentée dans `11_DECISION_LOG.md`.

---

## Vue d'ensemble

athletes (1)
├── goals (N)
├── training_blocks (N)
├── athlete_baselines (N — historique versionné)
├── weekly_availability (N — 1 par semaine)
├── daily_checkins (N — 1 par jour)
├── athlete_state (N — 1 par jour, dérivé)
├── planned_sessions (N)
├── completed_sessions (N)
├── decisions (N)
├── race_calendar (N)
└── health_flags (N)


12 tables. Toutes justifiées par une requête du Head Coach.

---

## Tables détaillées

### `athletes`

Racine du modèle. Un seul enregistrement en V1 (Louis).

Champs clés : `id`, `user_id` (auth), `name`, `dob`, `region`, `nationality`, `current_stage`, `discipline`.

### `goals`

Objectifs saison et bloc. Séparés par `level` (`season` / `block`).

### `training_blocks`

Périodes 3-6 semaines avec focus dominant. Un seul `is_current=true` à la fois.

Colonne `mode` de type `training_mode` : `RACE_WEEK`, `RACE_CLUSTER`, `OFF_SEASON_RECOVERY`, `OFF_SEASON_DEVELOPMENT`, `PRE_SEASON`, `IN_SEASON`, `INJURY_RECOVERY`, `OTHER`.

### `athlete_baselines`

Mesures physiques versionnées. Un seul `is_current=true` par athlète.

Champs : bodyweight, squat_1rm, deadlift_1rm, bench_1rm, pull-ups, dead_hang, FTP, HR_max, farmer_walk, etc.

Unicité logique via `(athlete_id, measurement_id)` — pas `(athlete_id, measured_date)`, pour permettre plusieurs mesures/tests le même jour.

### `weekly_availability`

Disponibilité hebdomadaire de Louis. Un enregistrement par semaine.

Champs : monday_evening, tuesday_evening, ..., friday_afternoon, saturday_full, sunday_full, week_context, travel.

### `daily_checkins`

Entrée quotidienne de Louis. Un enregistrement par jour.

Champs principaux : sleep_hours, sleep_quality, sleep_wake_ups, energy, work_stress, leg_fatigue, grip_fatigue, motivation, pain, pain_intensity, pain_new, pain_location_code (enum), suspected_concussion, fever_or_illness, free_comment.

### `athlete_state`

État dérivé, une ligne par jour. Recalculé après chaque check-in.

Champs : readiness_score, readiness_zone, fatigue_load_7d, fatigue_zone, days_since_last_dh, active_health_flags, risk_flags (JSONB), active_mode.

**Note** : le `readiness_score` et `readiness_zone` en base servent d'indicateurs UI. Les décisions du Head Coach s'appuient sur les dimensions individuelles calculées à la volée à partir du checkin, pas sur ces champs agrégés.

### `planned_sessions`

Séance prévue pour un jour donné. Une par jour maximum en V0.2.

Colonne `session_type` de type `DbSessionType` (enum coarse).

### `completed_sessions`

Séance réellement effectuée. Un enregistrement par jour.

Colonne `session_type` de type `DbSessionType`. `main_content` en JSONB pour la richesse (peut inclure `TrainingIntervention` précise, événements mécaniques, etc.).

### `decisions`

Chaque exécution du Daily Decision Engine crée une ligne. Traçabilité complète.

Champs : planned_session_before, final_session (DbSessionType), triggered_rules (JSONB), reason, confidence, stop_conditions, do_not_do, engine_version, overridden_by_user, override_reason.

**Évolution prévue V0.2** : ajout d'un champ `daily_plan JSONB` pour stocker le `DailyPlan` complet (avec la richesse multi-domaines et la représentation `TrainingIntervention`).

### `race_calendar`

Événements compétitifs. Champs : event_name, series, country, location, category, start_date, end_date, priority (`race_priority` enum : A_PLUS, A, B, C), status, race_format (`race_format` enum), notes.

Résultats stockés : result_position, result_time_seconds, result_gap_to_winner, result_field_size.

### `health_flags`

Blessures, douleurs persistantes, suspicions de commotion, maladies. Table privée séparée.

---

## Enums

### Enums de persistance (existants, ne pas modifier)

- `session_type` : `STRENGTH_A`, `STRENGTH_B`, `AEROBIC_BASE`, `AEROBIC_INTERVALS`, `DH_TECHNICAL`, `DH_PERFORMANCE`, `RECOVERY`, `REST`, `BIKE_MAINTENANCE`, `RACE_PREP`
- `race_priority` : `A_PLUS`, `A`, `B`, `C`
- `race_format` : `HOT_TRAIL_2DAY`, `IXS_3DAY`, `SWISS_CUP`, `UCI_WC`, `UCI_WORLDS`, `OTHER`
- `training_mode` : `RACE_WEEK`, `RACE_CLUSTER`, `OFF_SEASON_RECOVERY`, `OFF_SEASON_DEVELOPMENT`, `PRE_SEASON`, `IN_SEASON`, `INJURY_RECOVERY`, `OTHER`
- `readiness_zone` : `GREEN`, `AMBER`, `RED`
- `fatigue_zone` : `LOW`, `NORMAL`, `HIGH`, `VERY_HIGH`
- `pain_location_code` : 32 zones anatomiques (voir DDL)
- `completion_status`, `goal_level`, `goal_status`, `race_status`, `session_source`, `health_flag_type`, `health_flag_status`, `current_stage`

---

## Séparation DbSessionType vs TrainingIntervention

### Le principe

- La **DB** persiste avec `session_type` (enum coarse existant, 10 valeurs)
- Le **Head Coach interne** manipule une représentation plus riche `TrainingIntervention`
- Un **mapping explicite** existe entre les deux

**La richesse interne ne force pas la migration de la DB.**

### TrainingIntervention (représentation interne)

**Un simple enum est insuffisant.** Chaque `TrainingIntervention` combine au minimum :

- `kind` : nature de l'intervention
- `load_profile` : `HEAVY` / `MODERATE` / `LIGHT`

Valeurs possibles de `kind` (extensible sans impact DB) :

- `STRENGTH_LOWER`
- `STRENGTH_UPPER`
- `STRENGTH_FULL_LIGHT`
- `POWER`
- `GRIP_WORK`
- `AEROBIC_BASE`
- `AEROBIC_INTERVALS`
- `DH_TECHNICAL`
- `DH_PERFORMANCE`
- `DH_LIGHT`
- `PUMPTRACK`
- `MOBILITY`
- `RECOVERY_ACTIVE`
- `REST`
- `BIKE_MAINTENANCE`
- `RACE_ACTIVITY`

Certaines combinaisons `(kind, load_profile)` n'ont pas de sens (ex : `REST` + `HEAVY`). Le moteur ne les produit pas.

### Mapping vers DbSessionType (fonction déterministe)

Le mapping est une **fonction pure** : pour tout couple `(kind, load_profile)` valide, la sortie est **unique**.

Table de mapping canonique :

| kind | load_profile | → DbSessionType |
|---|---|---|
| `STRENGTH_LOWER` | HEAVY / MODERATE | `STRENGTH_A` |
| `STRENGTH_LOWER` | LIGHT | `STRENGTH_B` |
| `STRENGTH_UPPER` | HEAVY | `STRENGTH_A` |
| `STRENGTH_UPPER` | MODERATE / LIGHT | `STRENGTH_B` |
| `POWER` | HEAVY | `STRENGTH_A` |
| `POWER` | MODERATE / LIGHT | `STRENGTH_B` |
| `GRIP_WORK` | HEAVY | `STRENGTH_A` |
| `GRIP_WORK` | MODERATE / LIGHT | `STRENGTH_B` |
| `STRENGTH_FULL_LIGHT` | LIGHT | `STRENGTH_B` |
| `AEROBIC_BASE` | (tout) | `AEROBIC_BASE` |
| `AEROBIC_INTERVALS` | (tout) | `AEROBIC_INTERVALS` |
| `DH_TECHNICAL` | (tout) | `DH_TECHNICAL` |
| `PUMPTRACK` | (tout) | `DH_TECHNICAL` |
| `DH_PERFORMANCE` | (tout) | `DH_PERFORMANCE` |
| `DH_LIGHT` | (tout) | `RECOVERY` |
| `MOBILITY` | (tout) | `RECOVERY` |
| `RECOVERY_ACTIVE` | (tout) | `RECOVERY` |
| `REST` | (tout) | `REST` |
| `BIKE_MAINTENANCE` | (tout) | `BIKE_MAINTENANCE` |
| `RACE_ACTIVITY` | (tout) | `RACE_PREP` |

**Aucune ambiguïté.** Toute évolution de cette table doit être tracée dans `11_DECISION_LOG.md`.

### Mapping vers DbSessionType

| TrainingIntervention | DbSessionType |
|---|---|
| `STRENGTH_LOWER`, `STRENGTH_UPPER` (haut du corps lourd), `POWER` (lourd), `GRIP_WORK` (lourd) | `STRENGTH_A` |
| `STRENGTH_FULL_LIGHT`, `STRENGTH_UPPER` (léger), `POWER` (léger) | `STRENGTH_B` |
| `AEROBIC_BASE` | `AEROBIC_BASE` |
| `AEROBIC_INTERVALS` | `AEROBIC_INTERVALS` |
| `DH_TECHNICAL`, `PUMPTRACK` | `DH_TECHNICAL` |
| `DH_PERFORMANCE` | `DH_PERFORMANCE` |
| `DH_LIGHT`, `MOBILITY`, `RECOVERY_ACTIVE` | `RECOVERY` |
| `REST` | `REST` |
| `BIKE_MAINTENANCE` | `BIKE_MAINTENANCE` |
| `RACE_ACTIVITY` | `RACE_PREP` |

**Note** : le mapping `STRENGTH_UPPER` → `STRENGTH_A` ou `STRENGTH_B` dépend du volume et de l'intensité. Le mapping doit être une fonction contextuelle documentée en code, pas une table statique 1-1.

### Persistance

Quand une décision est écrite dans `decisions` :
- Le champ SQL `final_session` reçoit le `DbSessionType` (via mapping)
- Le champ `daily_plan JSONB` (à ajouter) contient la richesse complète avec `TrainingIntervention`

Ainsi la DB reste stable, mais toute la richesse est préservée dans le JSONB.

---

## Évolutions anticipées (additives)

### V0.2 → V0.3

- Ajouter `decisions.daily_plan JSONB` pour la richesse multi-domaines
- Ajouter `decisions.active_mode training_mode`
- Ajouter table `active_experiments` avec `id`, `hypothesis`, `start_date`, `intervention`, `metrics`, `review_date`, `status`

### V0.3 → v1.0

- Ajouter table `learned_patterns` pour la couche D (patterns confirmés)
- Ajouter `daily_checkins.sleep_wake_ups` **déjà fait en V0.2**

### V1.0+

- Vidéos et analyse technique DH
- Timed sections en course
- Nutrition tracking détaillé

### Requis avant connexion Supabase runtime (M2)

**Migration additive à effectuer avant M2 — pas maintenant.**

Deux options possibles pour supporter les champs douleur enrichis utilisés par SAFETY :

**Option A — Ajouter les colonnes à `daily_checkins`** :
- `pain_traumatic boolean`
- `pain_function_loss boolean`
- `pain_getting_worse boolean`

**Option B — Persister ces champs dans une source équivalente** :
- Par exemple `daily_checkins.pain_metadata JSONB`
- Ou une table dédiée liée à `daily_checkins`

Le choix entre A et B sera tranché au moment de la préparation de M2. Décision à tracer dans `11_DECISION_LOG.md`.

Contrainte canonique : la représentation choisie doit permettre au moteur d'accéder à ces champs sans ambiguïté, avec la même sémantique qu'en M1 local.

De même, le concept `active_health_flags` doit être exposé comme liste structurée `HealthFlag[]` au niveau du moteur. En M1, les fixtures fournissent cette structure directement. En M2, l'adapter Supabase construit cette liste à partir de la table `health_flags`.

---

## Ce qui n'est PAS dans le modèle (canonique)

- **`bike_setups`, `maintenance`** — hors périmètre coach setup, jamais dans la DB
- **`sponsor_crm`, `content_calendar`** — outil manager séparé, hors app athlète
- **`documents`** — utiliser Supabase Storage directement

Voir `01_PRODUCT_REQUIREMENTS.md` §Hors périmètre.

---

## Contraintes de sécurité

- **RLS activée** sur toutes les tables
- Politique unique : `athlete_id IN (SELECT id FROM athletes WHERE user_id = auth.uid())`
- `health_flags` séparée pour permettre plus tard une politique de rétention différente si besoin

---

## Contraintes canoniques

- **Ne jamais casser le schéma existant** sans discussion
- Toute évolution additive, jamais destructive
- `session_type` enum de la DB reste stable
- Ajouter des valeurs aux enums PostgreSQL possible mais tracé dans `11_DECISION_LOG.md`
- Le mapping `TrainingIntervention → DbSessionType` est une fonction de code documentée, pas une donnée en base