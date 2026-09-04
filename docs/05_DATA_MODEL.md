# 05 — Data Model

## Statut

Le schéma Supabase V0.2 est **déjà déployé et validé**. Ce document décrit :

- Les 12 tables existantes et leur rôle
- Les enums (persistance vs interne)
- La séparation `DbSessionType` (DB coarse) vs `TrainingIntervention` (interne riche)
- Le mapping déterministe entre les deux
- Les évolutions futures anticipées (additives, non-destructives)

**Aucune modification du schéma existant ne doit être faite sans discussion.** Toute évolution doit être additive et documentée dans `11_DECISION_LOG.md`.

---

## Vue d'ensemble

```
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
   ├── health_flags (N)
   └── athlete_coaching_profiles (0 ou 1 — V0.3_004A)
```

13 tables (12 + `athlete_coaching_profiles`, V0.3_004A). Toutes justifiées par une requête du Head Coach.

---

## Tables détaillées

### `athletes`

Racine du modèle. Un seul enregistrement en V1 (Louis).

Champs clés : `id`, `user_id` (auth), `name`, `dob`, `region`, `nationality`, `current_stage`, `discipline`.

### `goals`

Objectifs saison et bloc. Séparés par `level` (`season` / `block`).

### `training_blocks`

Périodes 3-6 semaines avec focus dominant. Un seul `is_current=true` à la fois.

Colonne `mode` de type `training_mode` : `RACE_WEEK`, `RACE_CLUSTER`, `OFF_SEASON_RECOVERY`, `OFF_SEASON_DEVELOPMENT`, `PRE_SEASON`, `IN_SEASON`, `INJURY_RECOVERY`, `OTHER`, `UNSPECIFIED` (V0.3_004C — voir plus bas).

### `athlete_baselines`

Mesures physiques versionnées. Un seul `is_current=true` par athlète.

Champs : bodyweight, squat_1rm, deadlift_1rm, bench_1rm, pull-ups, dead_hang, FTP, HR_max, farmer_walk, etc.

Unicité logique via `(athlete_id, measurement_id)` — pas `(athlete_id, measured_date)`, pour permettre plusieurs mesures/tests le même jour.

### `weekly_availability`

Disponibilité hebdomadaire de Louis. Un enregistrement par semaine.

Champs : monday_evening, tuesday_evening, ..., friday_afternoon, saturday_full, sunday_full, week_context, travel.

### `daily_checkins`

Entrée quotidienne de Louis. Un enregistrement par jour.

Champs principaux : sleep_hours, sleep_quality, sleep_wake_ups, energy, work_stress, leg_fatigue, grip_fatigue, motivation, pain, pain_intensity, pain_new, pain_location_code (enum), pain_traumatic, pain_function_loss, pain_getting_worse, suspected_concussion, fever_or_illness, free_comment.

Les trois champs `pain_traumatic`, `pain_function_loss`, `pain_getting_worse` ont été ajoutés en M2 (migration `M2_001`). Ils alimentent SAFETY A4. **Type : `boolean NULL` sans valeur par défaut.** Les rows antérieures à M2 n'ont jamais collecté ces critères : `NULL = inconnu`, pas `false`. Toute nouvelle row M2 (créée via le DAL) doit fournir explicitement `true` ou `false` pour chaque critère. L'adapter Supabase (`buildRawContextFromSupabase`) **rejette** un checkin courant dont un des trois critères est `NULL`, plutôt que de convertir silencieusement en `false` — le moteur M1 reçoit toujours des booleans valides ou aucun contexte du tout. Voir `11_DECISION_LOG.md` (2026-08-13 — Option A, correction NULL).

### `athlete_state`

État dérivé, une ligne par jour. Recalculé après chaque check-in.

Champs : readiness_score, readiness_zone, fatigue_load_7d, fatigue_zone, days_since_last_dh, active_health_flags, risk_flags (JSONB), active_mode.

**Note** : le `readiness_score` et `readiness_zone` en base servent d'indicateurs UI. Les décisions du Head Coach s'appuient sur les dimensions individuelles calculées à la volée à partir du checkin, pas sur ces champs agrégés.

### `planned_sessions`

Séance prévue pour un jour donné. Une par jour maximum (contrainte `UNIQUE (athlete_id, planned_date)`, `unique_planned_per_day`, présente depuis la baseline V0.2).

Colonne `session_type` de type `DbSessionType` (enum coarse).

Colonnes ajoutées en M2 (migration `M2_003`) :
- `intervention JSONB NULL` — `TrainingIntervention` riche (`kind` + `load_profile` + éventuels `focus`/`cue`/`duration_min`). Nécessaire car le mapping `TrainingIntervention → DbSessionType` est surjectif et non inversible sans information supplémentaire. Nullable : les rows antérieures à M2 ont `intervention = NULL`. Comportement de l'adapter dans ce cas : inversion appliquée uniquement pour les mappings mathématiquement non ambigus (`REST` → `{kind: "REST"}`, `BIKE_MAINTENANCE` → `{kind: "BIKE_MAINTENANCE"}`, `RACE_PREP` → `{kind: "RACE_ACTIVITY"}`). Pour tout autre `DbSessionType` (`STRENGTH_A`, `STRENGTH_B`, `AEROBIC_BASE`, `AEROBIC_INTERVALS`, `DH_TECHNICAL`, `DH_PERFORMANCE`, `RECOVERY`), l'adapter retourne `planned_session = null` et émet un warning — le moteur active alors le fallback M1 T6.1 (inférence). **Aucune reconstruction inventée du `kind` ou du `load_profile`.**
- `planned_intent TEXT NULL` — notes du planificateur sur pourquoi cette séance était prévue. Participe à l'arbitrage des soft constraints strong côté moteur (voir `04_DAILY_DECISION_ENGINE.md` §Head Coach Arbitration et `11_DECISION_LOG.md` round 2 du 2026-08-13). **Jamais inféré automatiquement** depuis `primary_objective` ou tout autre champ existant : l'adapter mappe uniquement la valeur explicite de cette colonne vers `RawContext.planned_intent`.

**V0.3_003 (Planning / Session Intent) : COMPLETE (2026-09-02)** : V0.3_003A (architecture, verrouillée 2026-08-31) → **V0.3_003B (data-access/write path) CLOSED LOCALLY (2026-08-31)** — `web/src/features/planning/planningRepo.ts` implémente réellement ce contrat : écriture authentifiée directe sous la policy RLS `planned_sessions_own_data` déjà existante (`FOR ALL`, athlète propre — aucune nouvelle policy, aucun nouveau GRANT). Toute row écrite par `savePlannedSession` : `intervention` systématiquement renseigné (jamais le chemin d'inversion legacy — validé en amont, `RACE_ACTIVITY` rejeté déterministiquement), `planned_intent` explicitement remis à `NULL`, `primary_objective`/`planned_duration_min`/`planned_time_of_day`/`notes`/`training_block_id` hors périmètre v1 (non lus par le moteur — voir `getPlannedSessionFor`, qui ne sélectionne que `session_type, intervention, planned_intent`) et préservés tels quels sur conflit (`OMIT AND PRESERVE`, désormais régression permanente réelle contre une stack Supabase locale — voir `docs/06_ARCHITECTURE.md` §V0.3_003 et `docs/11_DECISION_LOG.md`). → **V0.3_003C (web planning workflow) CLOSED LOCALLY (2026-08-31)** — la route authentifiée `/plan` (`web/src/pages/PlanPage.tsx`, horizon aujourd'hui→J+6) expose désormais ce chemin d'écriture à l'athlète, **implémentée sur `origin/main`** : aucune action de déploiement Vercel explicite n'a eu lieu dans ce jalon — l'état effectif servi en production n'a pas été vérifié (à faire en V0.3_003E). Une row legacy `intervention=NULL` (pré-M2_003) est gérée sans jamais fabriquer d'intention riche — voir `docs/06_ARCHITECTURE.md` §V0.3_003. → **V0.3_003D (Today integration + e2e réel local) CLOSED LOCALLY (2026-08-31)** — `web/src/features/planning/TodayPlanningSummary.tsx` expose une lecture seule de cette même row sur `/today` (aucune écriture) ; `head-coach-engine/tests/supabase/t17_planningE2E.integration.test.ts` prouve empiriquement, contre une vraie stack Supabase locale, que la chaîne `planned_sessions → RawContext.planned_session → arbitrage → DailyPlan.planned_session_before → decisions.daily_plan.planned_session_before` (rich JSONB) et sa projection `decisions.planned_session_before` (coarse, non équivalente) se comportent exactement comme documenté ci-dessus — y compris que l'intention riche athlète survit intacte, append-only, même quand le protocole de course l'emporte sur l'arbitrage réel (`final_session` = `RACE_ACTIVITY`, coarse persisté `RACE_PREP`). Aucun changement de schéma. → **V0.3_003E (rollout production + clôture) CLOSED / PRODUCTION ROLLOUT COMPLETE (2026-09-02)** — Planning est désormais production-proven de bout en bout : l'écriture authentifiée RLS confirmée localement en V0.3_003B a été reconfirmée en production par un canary sur athlète scratch (jamais l'athlète réel) — écriture `planned_sessions` par le client authentifié scratch sous la policy `planned_sessions_own_data` réelle (jamais `service_role`), relecture propre, puis `daily-run` de production invoqué sous JWT scratch réel confirmant le même contrat rich/coarse documenté ci-dessus (`decisions.daily_plan.planned_session_before` JSONB et sa projection coarse `decisions.planned_session_before`, non équivalentes). Nettoyage scratch complet vérifié (zéro résidu sur toutes les tables touchées), zéro écriture sur l'athlète réel. Parité de migration reconfirmée : 26 locales/26 remote/0 en attente. Aucun changement de schéma sur l'ensemble de V0.3_003.

### `completed_sessions`

Séance réellement effectuée. Un enregistrement par jour.

Colonne `session_type` de type `DbSessionType`. `main_content` en JSONB pour la richesse (peut inclure `TrainingIntervention` précise, événements mécaniques, etc.).

**Décision M2 (audit DDL 2026-08-14)** : `main_content` est un JSONB **libre**, table **vide**, sans convention canonique établie. La `TrainingIntervention` riche ne peut pas y vivre. Décision : migration **`M2_004` REQUIRED** ajoutant `completed_sessions.intervention JSONB NULL` (même logique que `planned_sessions.intervention`, mêmes règles d'inversion partielle pour les rows legacy). `main_content` reste disponible pour d'autres usages libres (événements mécaniques, notes, etc.), mais la `TrainingIntervention` riche vit dans `intervention` uniquement.

**Fallback legacy** : une session complétée sans richesse `TrainingIntervention` récupérable (ni via `intervention`, ni couverte par l'inversion non ambiguë) ne contribue **pas** à `recent_load` avec la granularité `load_profile` — le moteur ne compte que les sessions qui ont l'information. Aucune reconstruction inventée.

### `decisions`

Chaque exécution du Daily Decision Engine crée une **nouvelle** row. Traçabilité complète, **append-only**.

Champs historiques V0.2 : `planned_session_before` (DbSessionType), `final_session` (DbSessionType), `triggered_rules` (JSONB), `reason`, `confidence`, `stop_conditions`, `do_not_do`, `engine_version`, `overridden_by_user`, `override_reason`.

Champs ajoutés en M2 (migration `M2_002`) :
- `daily_plan JSONB NULL` — **source de vérité** du `DailyPlan` produit par le moteur. Contient toute la richesse multi-domaines : `TrainingIntervention` riche, sections mental/recovery/nutrition/sleep, `event_context`, `decision` (`KEEP`/`MODIFY`/`REPLACE`/`REST`), `overrode_race_protocol`, `health_flag_to_create`. Toujours renseigné pour les nouvelles rows M2, `NULL` pour les rows antérieures (information inconnue, aucune reconstruction fabriquée).
- `active_mode training_mode NULL` — projection SQL du `TrainingMode` actif au moment de la décision, pour requêtes/index natifs. Toujours renseigné pour les nouvelles rows M2, `NULL` pour les rows antérieures.
- `confidence_level confidence_level NULL` — nouvel enum PostgreSQL `confidence_level ('LOW','MEDIUM','HIGH')` créé par la même migration `M2_002`. Contient la confidence qualitative produite par M1. Toujours renseigné pour les nouvelles rows M2 via le DAL, `NULL` pour les rows antérieures. La colonne legacy `confidence numeric(3,2)` est **conservée intacte** — le mapping M1 → SQL ne l'écrit pas : elle reste `NULL` pour les nouvelles rows et garde ses valeurs historiques pour les rows pré-M2. Voir `11_DECISION_LOG.md` (2026-08-14 — `confidence_level`).

Les colonnes historiques (`final_session`, `planned_session_before`, `reason`, `do_not_do`, `override_reason`, `engine_version`) sont, en M2, des **projections dénormalisées** du `daily_plan` JSONB, remplies par le DAL pour ergonomie SQL. `stop_conditions` reste `NULL` en M2 (non produit par le moteur). `overridden_by_user` conserve son default DB (`NOT NULL DEFAULT false`) : reste **`false`** en M2 (pas d'UI, aucune correction humaine possible), pas `NULL`.

**Aucune contrainte d'unicité sur `(athlete_id, decision_date)`. Aucun upsert.** Plusieurs décisions par jour sont autorisées si le contexte change en cours de journée (nouveau checkin, événement en cours, correction manuelle plus tard). La décision courante est la plus récente (`ORDER BY created_at DESC LIMIT 1`). Si un audit fin devient nécessaire plus tard, des champs `supersedes_decision_id`, `revision` ou `is_current` pourront être ajoutés (P2+).

**Atomicité écriture (M2)** : la persistance d'une nouvelle row `decisions` et l'éventuel upsert du health flag associé sont effectués dans **le même appel** de la fonction PostgreSQL `persist_daily_run` (invoquée via RPC). Une fonction PostgreSQL s'exécute intrinsèquement dans une transaction unique : les deux écritures aboutissent ensemble, ou aucune ne persiste. Toute erreur non capturée fait échouer l'appel et annule les écritures de cet appel. Voir `06_ARCHITECTURE.md` §Persistance idempotente + atomique.

### `race_calendar`

Événements compétitifs. Champs : event_name, series, country, location, category, start_date, end_date, priority (`race_priority` enum : A_PLUS, A, B, C), status, race_format (`race_format` enum), notes.

Résultats stockés : result_position, result_time_seconds, result_gap_to_winner, result_field_size.

### `health_flags`

Blessures, douleurs persistantes, suspicions de commotion, maladies. Table privée séparée.

Audit DDL M2 (2026-08-14) : la colonne discriminante réelle est **`flag_type`** (pas `type`). Aucun discriminateur `location_code` sur cette table. La clé d'idempotence retenue est **`(athlete_id, flag_type)`** pour les flags ouverts (`status IN ('active','monitoring')`). L'objet domaine `HealthFlag` côté moteur conserve son champ `type` — la traduction se fait dans le mapping SQL → domaine de l'adapter.

### `athlete_coaching_profiles` (V0.3_004A, DONE local + remote)

Contenu de coaching personnel, scopé par athlète, consommé aujourd'hui par les domaines Technique et Mental. `athlete_id uuid PRIMARY KEY REFERENCES athletes(id) ON DELETE CASCADE` — au plus une ligne par athlète (configuration courante mutable, pas un historique daté). Absence de ligne = absence de personnalisation, **jamais** une erreur ni une valeur générique fabriquée.

Champs : `technique_primary_focus text NULL`, `mental_pre_race_cue text NULL`, `created_at`/`updated_at timestamptz`. Deux `CHECK` (`_not_blank`) interdisent une chaîne vide/blanche mais acceptent `NULL` — un `NULL` reste `NULL` ("pas encore configuré"), une valeur présente doit être un contenu réel. V1 délibérément minimal : uniquement les deux valeurs textuellement consommées par le moteur aujourd'hui — aucun champ sans consommateur runtime (pas de dump de profil général : objectifs/équipement/disponibilité/notes hors périmètre).

RLS : policy `athlete_coaching_profiles_own_data` (`FOR ALL`, `USING`/`WITH CHECK` via `athlete_id IN (SELECT id FROM athletes WHERE user_id = auth.uid())`), même famille que `weekly_availability_own_data`/`training_blocks_own_data` — l'athlète édite directement sous RLS, pas de RPC. Grants : `authenticated` → `SELECT, INSERT, UPDATE, DELETE` ; `service_role` → `SELECT, INSERT, UPDATE` (délibérément **pas** `DELETE` — aucun chemin ne supprime une ligne en gardant l'athlète ; la suppression n'existe que via le `ON DELETE CASCADE` de la FK) ; `anon` → aucun grant.

Avant V0.3_004A, ces deux valeurs vivaient dans un singleton de code mono-athlète (`head-coach-engine/src/config/athleteCoachingProfile.ts`, retiré par ce jalon) qui se serait appliqué tel quel à n'importe quel second athlète. Le repository `getCoachingProfileFor` (read-only) peuple `RawContext.coaching_profile` **uniquement** si une ligne existe ; `domains/technique.ts`/`domains/mental.ts` reçoivent le focus/cue comme paramètre pur — absence de profil ou champ `NULL` individuel ⇒ section correspondante simplement absente, jamais un texte par défaut, jamais le contenu d'un autre athlète. Voir `06_ARCHITECTURE.md` §V0.3_004 et `11_DECISION_LOG.md` (2026-09-04 — V0.3_004A).

**Production** : ligne réelle de Louis peuplée en V0.3_004D (2026-09-04) avec ses deux valeurs approuvées. Preuve empirique de l'isolation cross-athlète (aucune fuite du contenu de Louis vers un second athlète) exécutée en production réelle contre deux utilisateurs scratch — voir `11_DECISION_LOG.md` (2026-09-04 — V0.3_004D).

---

## Enums

### Enums de persistance (existants, ne pas modifier)

- `session_type` : `STRENGTH_A`, `STRENGTH_B`, `AEROBIC_BASE`, `AEROBIC_INTERVALS`, `DH_TECHNICAL`, `DH_PERFORMANCE`, `RECOVERY`, `REST`, `BIKE_MAINTENANCE`, `RACE_PREP`
- `race_priority` : `A_PLUS`, `A`, `B`, `C`
- `race_format` : `HOT_TRAIL_2DAY`, `IXS_3DAY`, `SWISS_CUP`, `UCI_WC`, `UCI_WORLDS`, `OTHER`
- `training_mode` : `RACE_WEEK`, `RACE_CLUSTER`, `OFF_SEASON_RECOVERY`, `OFF_SEASON_DEVELOPMENT`, `PRE_SEASON`, `IN_SEASON`, `INJURY_RECOVERY`, `OTHER`, `UNSPECIFIED` (ajoutée par `ALTER TYPE ... ADD VALUE`, migration `20260904090000_v0_3_004c_training_mode_unspecified.sql` — signifie "aucune ligne `training_blocks` courante pour cet athlète", jamais une phase devinée ; voir §V0.3_004 ci-dessous)
- `readiness_zone` : `GREEN`, `AMBER`, `RED`
- `fatigue_zone` : `LOW`, `NORMAL`, `HIGH`, `VERY_HIGH`
- `pain_location_code` : 32 zones anatomiques (voir DDL)
- `completion_status`, `goal_level`, `goal_status`, `race_status`, `session_source`, `health_flag_type`, `health_flag_status`, `current_stage`

---

## Séparation DbSessionType vs TrainingIntervention

### Le principe

- La **DB** persiste avec `session_type` (enum coarse existant, 10 valeurs)
- Le **Head Coach interne** manipule une représentation plus riche `TrainingIntervention`
- Un **mapping déterministe explicite** existe entre les deux

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

### Décisions M2 (à appliquer)

Les migrations M2 sont additives et non-destructives. Ordre canonique d'application, tracé dans `11_DECISION_LOG.md` (entrées 2026-08-13 et 2026-08-14) :

0. **Baseline V0.2** : capture initiale du schéma déployé via `supabase db dump --linked --schema public > supabase/migrations/20260814095000_baseline_v0_2.sql`. Timestamp réel de capture (2026-08-14 09:50:00 UTC), antérieur à toute migration M2. Fichier versionné, **strictement read-only** — jamais réédité, jamais poussé. Voir `06_ARCHITECTURE.md` §Baseline read-only.
1. **`M2_001`** : trois colonnes douleur `boolean NULL` (sans default) dans `daily_checkins`. `NULL = inconnu` sur legacy. L'adapter rejette un checkin courant M2 incomplet.
2. **`M2_002`** : `decisions.daily_plan JSONB NULL` (source de vérité) + `decisions.active_mode training_mode NULL` (projection SQL) + création de l'enum PostgreSQL `confidence_level ('LOW','MEDIUM','HIGH')` et de la colonne `decisions.confidence_level confidence_level NULL`. La colonne legacy `confidence numeric(3,2)` reste intacte, non écrite par M2. Aucune valeur par défaut fabriquée sur legacy.
3. **`M2_003`** : `planned_sessions.intervention JSONB NULL` + `planned_sessions.planned_intent TEXT NULL`.
4. **`M2_004`** (**REQUIRED** — audit DDL 2026-08-14) : `completed_sessions.intervention JSONB NULL`. `main_content` est JSONB libre sans convention canonique, ne peut pas héberger la richesse.
5. **`M2_005`** : index unique partiel sur `health_flags` couvrant **`(athlete_id, flag_type)`** filtré sur `status IN ('active','monitoring')`. Autorise un nouveau flag après résolution. Idempotence garantie côté PostgreSQL.
6. **`M2_006`** : fonction PostgreSQL `persist_daily_run` — upsert éventuel du health flag + insert append-only de la décision, dans le même appel de fonction (transaction unique implicite). `SECURITY INVOKER`, aucune exposition à `PUBLIC`/`anon`/`authenticated`, `EXECUTE` accordé uniquement au rôle serveur utilisé par M2. Aucune logique de coaching côté SQL.

Toutes les migrations M2 (`M2_001` à `M2_006`) ont des timestamps de nom strictement postérieurs à celui de la baseline.

L'`active_health_flags` du `RawContext` reste une liste structurée `HealthFlag[]` au niveau du moteur. En M2, l'adapter Supabase la construit à partir de la table `health_flags` (filtrée sur `status != 'resolved'`), en mappant la colonne réelle `flag_type` vers le champ domaine `type`.

**Déploiement remote** : avant le premier `supabase db push` M2 vers la DB Louis, la baseline V0.2 devra être marquée comme **déjà appliquée** dans l'historique de migrations distant (via `supabase migration repair` ou méthode équivalente documentée), afin qu'elle ne soit jamais rejouée sur le schéma existant. À exécuter une seule fois, hors développement.

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
- Mapping déterministe : pour tout `(kind, load_profile)` valide → sortie unique
- **Aucune donnée historique fabriquée.** Les colonnes ajoutées après le déploiement initial d'une table restent `NULL` sur les rows antérieures quand l'information réelle n'est pas connue. Les valeurs par défaut ne sont utilisées **que** quand elles reflètent une réalité factuelle (jamais pour combler un vide historique arbitraire).
- **Inversion `DbSessionType → TrainingIntervention` limitée aux mappings mathématiquement non ambigus** (`REST`, `BIKE_MAINTENANCE`, `RACE_PREP`). Tous les autres `DbSessionType` (ambigus) → `planned_session = null` + warning adapter. Ne jamais inventer `kind` ou `load_profile`.
- **`decisions` est append-only.** Aucune contrainte d'unicité sur `(athlete_id, decision_date)`, aucun upsert destructif. La décision courante est la plus récente.
- **`health_flag_to_create` produit par M1 est persisté** dans `health_flags` par la fonction PostgreSQL `persist_daily_run` (invoquée via RPC), **avant** l'insertion de la row `decisions`, dans le même appel de fonction (transaction unique implicite). Idempotence garantie par un index unique partiel PostgreSQL sur les flags ouverts **`(athlete_id, flag_type)`** (nom réel de la colonne discriminante confirmé par l'audit DDL 2026-08-14).
