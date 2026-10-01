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

Modèle d'exécution V1 (UX-11B, ADR acceptée, non migré — voir §Modèle d'exécution V1) :

```
training_plan_planned_prescriptions → decision_final_prescriptions → session_executions
                                                                        ├── execution_events
                                                                        └── exercise_set_results
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
- `intervention JSONB NULL` — `TrainingIntervention` riche (`kind` + `load_profile` + éventuels `focus`/`cue`/`duration_min`). Nécessaire car le mapping `TrainingIntervention → DbSessionType` est surjectif et non inversible sans information supplémentaire. Nullable : les rows antérieures à M2 ont `intervention = NULL`. Comportement de l'adapter dans ce cas : inversion appliquée uniquement pour les mappings mathématiquement non ambigus (`REST` → `{kind: "REST"}`, `BIKE_MAINTENANCE` → `{kind: "BIKE_MAINTENANCE"}`, `RACE_PREP` → `{kind: "RACE_ACTIVITY"}`). Pour tout autre `DbSessionType` (`STRENGTH_A`, `STRENGTH_B`, `AEROBIC_BASE`, `AEROBIC_INTERVALS`, `DH_TECHNICAL`, `DH_PERFORMANCE`, `RECOVERY`), l'adapter retourne `planned_session = null` et émet un warning — le moteur active alors le fallback M1 T6.1 (inférence). **Aucune reconstruction inventée du `kind` ou du `load_profile`.** **`duration_min` (V0.3_006C2)** : seul champ de `intervention` désormais activement écrit par Planning au-delà de `kind`/`load_profile`, et DH-family uniquement (`DH_PERFORMANCE`/`DH_TECHNICAL`/`DH_LIGHT`/`PUMPTRACK`) — l'UNIQUE source de vérité pour la durée prévue par l'athlète, déjà consommée sans aucun changement moteur par `resolveDhDuration` (V0.3_006B). Absent (non sélectionné, ou explicitement effacé) : la clé `duration_min` n'apparaît pas du tout dans le JSONB, jamais `duration_min: null`.
- `planned_intent TEXT NULL` — notes du planificateur sur pourquoi cette séance était prévue. Participe à l'arbitrage des soft constraints strong côté moteur (voir `04_DAILY_DECISION_ENGINE.md` §Head Coach Arbitration et `11_DECISION_LOG.md` round 2 du 2026-08-13). **Jamais inféré automatiquement** depuis `primary_objective` ou tout autre champ existant : l'adapter mappe uniquement la valeur explicite de cette colonne vers `RawContext.planned_intent`.

Colonne ajoutée en V0.3_005A (NAL-001, migration `20260904100000`) :
- `is_committed BOOLEAN NOT NULL DEFAULT FALSE` — l'athlète marque une séance comme réellement engagée (par opposition à une intention flexible). Purement additive, aucun changement RLS/GRANT (couverte par la policy `FOR ALL` existante `planned_sessions_own_data`). Toute row antérieure à cette migration reste `FALSE` (comportement historique/flexible inchangé) — jamais rétro-inféré depuis le type de séance, le jour de la semaine, la proximité d'une course ou l'athlète. Consommée par `RawContext.planned_session_committed` (métadonnée de planification, jamais fusionnée dans `TrainingIntervention`) — voir `04_DAILY_DECISION_ENGINE.md` §Activité engagée et `11_DECISION_LOG.md` (V0.3_005A).

**V0.3_003 (Planning / Session Intent) : COMPLETE (2026-09-02)** : V0.3_003A (architecture, verrouillée 2026-08-31) → **V0.3_003B (data-access/write path) CLOSED LOCALLY (2026-08-31)** — `web/src/features/planning/planningRepo.ts` implémente réellement ce contrat : écriture authentifiée directe sous la policy RLS `planned_sessions_own_data` déjà existante (`FOR ALL`, athlète propre — aucune nouvelle policy, aucun nouveau GRANT). Toute row écrite par `savePlannedSession` : `intervention` systématiquement renseigné (jamais le chemin d'inversion legacy — validé en amont, `RACE_ACTIVITY` rejeté déterministiquement), `planned_intent` explicitement remis à `NULL`, `primary_objective`/`planned_duration_min`/`planned_time_of_day`/`notes`/`training_block_id` hors périmètre v1 (non lus par le moteur — voir `getPlannedSessionFor`, qui ne sélectionne que `session_type, intervention, planned_intent`) et préservés tels quels sur conflit (`OMIT AND PRESERVE`, désormais régression permanente réelle contre une stack Supabase locale — voir `docs/06_ARCHITECTURE.md` §V0.3_003 et `docs/11_DECISION_LOG.md`). **V0.3_006C2** active `intervention.duration_min` (DH-family uniquement) sans toucher à cette liste : `planned_duration_min` (la colonne séparée) reste exactement dans cet état hors-périmètre/dormant — voir `docs/06_ARCHITECTURE.md` §V0.3_006C2. → **V0.3_003C (web planning workflow) CLOSED LOCALLY (2026-08-31)** — la route authentifiée `/plan` (`web/src/pages/PlanPage.tsx`, horizon aujourd'hui→J+6) expose désormais ce chemin d'écriture à l'athlète, **implémentée sur `origin/main`** : aucune action de déploiement Vercel explicite n'a eu lieu dans ce jalon — l'état effectif servi en production n'a pas été vérifié (à faire en V0.3_003E). Une row legacy `intervention=NULL` (pré-M2_003) est gérée sans jamais fabriquer d'intention riche — voir `docs/06_ARCHITECTURE.md` §V0.3_003. → **V0.3_003D (Today integration + e2e réel local) CLOSED LOCALLY (2026-08-31)** — `web/src/features/planning/TodayPlanningSummary.tsx` expose une lecture seule de cette même row sur `/today` (aucune écriture) ; `head-coach-engine/tests/supabase/t17_planningE2E.integration.test.ts` prouve empiriquement, contre une vraie stack Supabase locale, que la chaîne `planned_sessions → RawContext.planned_session → arbitrage → DailyPlan.planned_session_before → decisions.daily_plan.planned_session_before` (rich JSONB) et sa projection `decisions.planned_session_before` (coarse, non équivalente) se comportent exactement comme documenté ci-dessus — y compris que l'intention riche athlète survit intacte, append-only, même quand le protocole de course l'emporte sur l'arbitrage réel (`final_session` = `RACE_ACTIVITY`, coarse persisté `RACE_PREP`). Aucun changement de schéma. → **V0.3_003E (rollout production + clôture) CLOSED / PRODUCTION ROLLOUT COMPLETE (2026-09-02)** — Planning est désormais production-proven de bout en bout : l'écriture authentifiée RLS confirmée localement en V0.3_003B a été reconfirmée en production par un canary sur athlète scratch (jamais l'athlète réel) — écriture `planned_sessions` par le client authentifié scratch sous la policy `planned_sessions_own_data` réelle (jamais `service_role`), relecture propre, puis `daily-run` de production invoqué sous JWT scratch réel confirmant le même contrat rich/coarse documenté ci-dessus (`decisions.daily_plan.planned_session_before` JSONB et sa projection coarse `decisions.planned_session_before`, non équivalentes). Nettoyage scratch complet vérifié (zéro résidu sur toutes les tables touchées), zéro écriture sur l'athlète réel. Parité de migration reconfirmée : 26 locales/26 remote/0 en attente. Aucun changement de schéma sur l'ensemble de V0.3_003.

### `completed_sessions`

Séance réellement effectuée. Un enregistrement par jour.

**UX-11B** : `completed_sessions` devient le **résumé** Après séance du jour et la compatibilité historique ; elle n'est plus la source de vérité détaillée de la réalisation (voir §Modèle d'exécution V1). Son contrat actuel (une ligne par jour, remplacement complet via `persist_completed_session`) reste une exception historique liée au contrat existant.

Colonne `session_type` de type `DbSessionType`. `main_content` en JSONB pour la richesse (peut inclure `TrainingIntervention` précise, événements mécaniques, etc.).

**Décision M2 (audit DDL 2026-08-14)** : `main_content` est un JSONB **libre**, table **vide**, sans convention canonique établie. La `TrainingIntervention` riche ne peut pas y vivre. Décision : migration **`M2_004` REQUIRED** ajoutant `completed_sessions.intervention JSONB NULL` (même logique que `planned_sessions.intervention`, mêmes règles d'inversion partielle pour les rows legacy). `main_content` reste disponible pour d'autres usages libres (événements mécaniques, notes, etc.), mais la `TrainingIntervention` riche vit dans `intervention` uniquement.

**Fallback legacy** : une session complétée sans richesse `TrainingIntervention` récupérable (ni via `intervention`, ni couverte par l'inversion non ambiguë) ne contribue **pas** à `recent_load` avec la granularité `load_profile` — le moteur ne compte que les sessions qui ont l'information. Aucune reconstruction inventée.

**V0.3_007B (Performed Session Correctness Foundation) — CLOSED / PRODUCTION ROLLOUT COMPLETE** : `intervention` cesse d'être une colonne dormante et devient le **seul fait athlète-authored** pour une session réellement effectuée. Contrat, appliqué côté serveur (`supabase/functions/completed-session/validation.ts`, jamais côté client seul) :
- `completion_status IN ('done','partial','replaced')` → `intervention` **requis** (jamais `NULL`), validé strictement contre le même vocabulaire riche que Planning (`STRENGTH_LOWER`, `STRENGTH_UPPER`, `STRENGTH_FULL_LIGHT`, `POWER`, `GRIP_WORK`, `AEROBIC_BASE`, `AEROBIC_INTERVALS`, `DH_TECHNICAL`, `DH_PERFORMANCE`, `DH_LIGHT`, `PUMPTRACK`, `MOBILITY`, `RECOVERY_ACTIVE`, `REST`, `BIKE_MAINTENANCE`) **plus `RACE_ACTIVITY`** — seule divergence délibérée avec `PLANNABLE_FIXED_LOAD_KINDS` : jamais un plan valide, mais une réalité effectuée légitime (« j'ai couru aujourd'hui »). `session_type` (colonne coarse) est **toujours** exactement `mapTrainingInterventionToSessionType(intervention)` — jamais une valeur indépendante fournie par le client, même si le client la calcule déjà correctement côté web (`completedSessionValidation.ts`) : la validation serveur est la seule couche qui fait autorité (`session_type_mismatch` si incohérent, `invalid_intervention` si la forme/`kind`/`load_profile` est invalide).
- `completion_status = 'skipped'` → `intervention` **toujours `NULL`** (aucun fait de performance à enregistrer) ; `session_type` garde son sens pré-existant (type coarse de la séance qui n'a pas été faite, librement choisi par l'athlète, non dérivé) — dérivé et **verrouillé** (non éditable) tant qu'une décision reste liée (V0.3_007B final review).
- Aucun backfill, aucune inversion coarse→riche n'est ajouté pour les rows legacy : le fallback ci-dessus reste inchangé et continue de s'appliquer tel quel.
- `recent_load` (moteur) : `done`/`partial`/`replaced` comptent tous en utilisant le `load_profile` de l'intervention **réellement effectuée** (jamais celle prescrite) ; `skipped` est exclu explicitement (garde ceinture-et-bretelles dans `recentLoad.ts`, en plus de l'exclusion en amont par le mapper). Aucune pondération fractionnaire, aucun nouveau modèle de charge basé durée/RPE.
- Ambiguïté de liaison même-jour : nouvelle lecture dédiée `loadValidDecisionsForDate` (RLS-scoped, toutes les décisions valides du jour) remplace l'ancien mécanisme `onLiveContextChange`/`LiveDailyPlanContext` (supprimé) — 0 décision → lien `NULL` automatique, 1 → lien + préremplissage automatique (visible et corrigible, sans tap forcé), 2+ → sélecteur explicite obligatoire (aucune présélection pour une nouvelle row ; la valeur persistée reste présélectionnée à l'édition, corrigeable sans jamais altérer rétroactivement la performance déjà enregistrée). Sélectionner/changer le plan lié ne doit **jamais** écraser une activité performée déjà saisie non-vide — le préremplissage depuis la prescription reste une pure convenance pour un champ vide (hotfix de production, voir `docs/11_DECISION_LOG.md` V0.3_007B).
- Aucune migration/évolution RPC : `persist_completed_session` (M5_001A, frozen) acceptait déjà `intervention` sans l'inspecter — seule la couche Edge Function (`validation.ts`) durcit le contrat.

Voir `docs/11_DECISION_LOG.md` (V0.3_007B) pour le détail complet et `docs/06_ARCHITECTURE.md` §V0.3_007B pour le flux de liaison décision/session.

**V0.3_007C (Athlete Debrief Fields) — CLOSED / PRODUCTION ROLLOUT COMPLETE (2026-09-10)** : trois nouveaux champs athlete-reported nullables, additifs, sans backfill (migration `20260910090000_v0_3_007c_completed_sessions_debrief_fields.sql`, déployée en production sur `uvolpldwwyvadlamulvr`, parité 31/31) :
- `technical_outcome public.technical_outcome NULL` (`'yes' | 'partial' | 'no'`, nouvel enum Postgres) — répond exclusivement à « l'athlète a-t-il réussi la tâche technique SPÉCIFIQUE prescrite par la décision LIÉE » (jamais une note générale de technique). Applicable uniquement pour `completion_status IN ('done','partial')`, avec `decision_id` non-`NULL`, avec le `daily_plan` persisté de cette décision contenant un `dh_or_technical.execution_task` réel (jamais fabriqué depuis `focus`/texte libre personnel — même invariant que V0.3_006C1), **et** l'`intervention` réellement performée elle-même DH-family (`DH_PERFORMANCE`/`DH_TECHNICAL`/`DH_LIGHT`/`PUMPTRACK` — une tâche de pilotage DH ne peut pas être évaluée par une séance de force/aérobie/récupération ; règle appliquée aussi bien côté serveur, `technical_outcome_not_applicable`, que côté web). **Relation-dependent** : remis à `NULL` à chaque changement de lien décision ou de statut, jamais une valeur périmée réexposée.
- `change_reason public.change_reason NULL` (`'coach_criterion' | 'fatigue_control' | 'pain' | 'mechanical' | 'weather_terrain' | 'time_life' | 'motivation' | 'activity_change' | 'other'`, nouvel enum Postgres) — répond à « pourquoi la séance n'a pas été un DONE ordinaire ». Rejeté (non `NULL`) pour `completion_status = 'done'` ; `'coach_criterion'` exige `decision_id` non-`NULL` (une séance libre ne peut pas prétendre avoir suivi un critère d'arrêt NALYNT précis). **Décrit l'événement réel, pas le lien** : préservé à travers un changement de décision liée, sauf `'coach_criterion'` spécifiquement lorsque le lien devient `NULL` (redevient sémantiquement impossible). `'pain'` et `daily_checkins`/`new_pain` restent des faits **délibérément indépendants** — « la douleur a affecté l'exécution » vs « une NOUVELLE douleur est apparue » répondent à des questions différentes, jamais couplés, aucune synchronisation cachée, aucune politique Safety nouvelle.
- `change_reason_note text NULL` — précision courte (500 caractères max, même limite que `new_pain_note`), jamais réutilise `free_notes` (relation sémantique distincte) ; non-vide exige `change_reason` non-`NULL`. **Requise quand `change_reason = 'other'`** (revue finale, décision V1 : « autre » seul ne porte presque aucune information utile) — `change_reason_note_required` si absente ; aucune autre catégorie n'exige de note. Contextuelle au motif **actuellement sélectionné** : côté web, changer `change_reason` vers une valeur différente vide systématiquement la note existante (elle ne doit jamais survivre silencieusement rattachée à un nouveau motif) ; un changement de lien décision qui préserve le motif lui-même préserve aussi la note.
- **Serveur jamais strict sur la présence** (contrairement à tout le reste du contrat `completed_sessions`) : les trois clés sont **optionnelles** dans le corps de requête Edge Function — absentes, elles se normalisent en `NULL` avant l'appel RPC, pour la compatibilité d'un client web antérieur à V0.3_007C qui ignore leur existence. Le serveur ne **rejette qu'une valeur présente incohérente** ; il n'exige jamais leur présence pour `partial`/`skipped`/`replaced` (cette exigence reste strictement UI-only, côté web). L'exigence de note pour `'other'` ne casse aucun ancien client par construction : elle ne se déclenche que si `change_reason = 'other'` est explicitement envoyé, ce qu'un client pré-007C ne fait jamais.
- RPC `persist_completed_session` étendue. **Exception délibérée et unique au contrat FULL REPLACEMENT strict** : contrairement à tout le reste du contrat (13 clés existantes, toutes requises-présentes-mais-nullables, ex. `decision_id`/`main_content`), les trois nouvelles clés debrief sont **optionnelles au niveau RPC lui-même** — absentes, elles se résolvent en `NULL` en interne. Nécessaire pour la sécurité du rollout : prouvé empiriquement que l'Edge Function V0.3_007B actuellement déployée en production (qui n'envoie jamais ces 3 clés) aurait vu **tous** ses écrits rejetés par la RPC post-migration si elles étaient restées requises-présentes, pendant toute la fenêtre entre le déploiement de la migration et celui de la nouvelle Edge Function. Aucune autre clé du contrat n'est concernée — rejet des clés inconnues, présence stricte des 13 clés existantes, contrôles ownership/date/decision inchangés. Ordre de déploiement sûr et prouvé : (1) migration/RPC — l'ancienne Edge Function doit continuer à fonctionner contre elle ; (2) nouvelle Edge Function ; (3) nouveau web — un onglet navigateur resté sur l'ancien bundle doit continuer à fonctionner contre la nouvelle Edge Function. Aucune validation de cohérence métier dans la RPC — reste la responsabilité de l'Edge Function, comme pour le reste du contrat M5_003/V0.3_007B.
- **Toujours hors périmètre** (V0.3_007C, réservé à une tranche future) : aucune consommation moteur (`RawContext`/`recentLoad`/Safety/arbitrage inchangés, `ENGINE_VERSION` inchangé), aucune consommation longitudinale (`recommendationVsActualExecution`/pattern evidence inchangés), pas de carte « Réalisé » en History.

Voir `docs/11_DECISION_LOG.md` (V0.3_007C) pour le détail complet et `docs/06_ARCHITECTURE.md` §V0.3_007C pour le flux de visibilité/dérivation.

### `decisions`

Chaque exécution du Daily Decision Engine crée une **nouvelle** row. Traçabilité complète, **append-only**.

Champs historiques V0.2 : `planned_session_before` (DbSessionType), `final_session` (DbSessionType), `triggered_rules` (JSONB), `reason`, `confidence`, `stop_conditions`, `do_not_do`, `engine_version`, `overridden_by_user`, `override_reason`.

Champs ajoutés en M2 (migration `M2_002`) :
- `daily_plan JSONB NULL` — **source de vérité** du `DailyPlan` produit par le moteur. Contient toute la richesse multi-domaines : `TrainingIntervention` riche, sections mental/recovery/nutrition/sleep, `event_context`, `decision` (`KEEP`/`MODIFY`/`REPLACE`/`REST`), `overrode_race_protocol`, `health_flag_to_create`. Toujours renseigné pour les nouvelles rows M2, `NULL` pour les rows antérieures (information inconnue, aucune reconstruction fabriquée).
- `active_mode training_mode NULL` — projection SQL du `TrainingMode` actif au moment de la décision, pour requêtes/index natifs. Toujours renseigné pour les nouvelles rows M2, `NULL` pour les rows antérieures.
- `confidence_level confidence_level NULL` — nouvel enum PostgreSQL `confidence_level ('LOW','MEDIUM','HIGH')` créé par la même migration `M2_002`. Contient la confidence qualitative produite par M1. Toujours renseigné pour les nouvelles rows M2 via le DAL, `NULL` pour les rows antérieures. La colonne legacy `confidence numeric(3,2)` est **conservée intacte** — le mapping M1 → SQL ne l'écrit pas : elle reste `NULL` pour les nouvelles rows et garde ses valeurs historiques pour les rows pré-M2. Voir `11_DECISION_LOG.md` (2026-08-14 — `confidence_level`).

Les colonnes historiques (`final_session`, `planned_session_before`, `reason`, `do_not_do`, `override_reason`, `engine_version`) sont, en M2, des **projections dénormalisées** du `daily_plan` JSONB, remplies par le DAL pour ergonomie SQL. `stop_conditions` reste `NULL` en M2 (non produit par le moteur). `overridden_by_user` conserve son default DB (`NOT NULL DEFAULT false`) : reste **`false`** en M2 (pas d'UI, aucune correction humaine possible), pas `NULL`.

Statut durable de la prescription du jour (UX-11A.5c.2, migration locale `20261001120000`, non poussée) : `final_prescription_status` (`created` | `not_required` | `blocked`, texte + CHECK), `final_prescription_status_code` (texte ouvert, non NULL ssi `blocked` ; taxonomie applicative extensible sans migration) et `final_prescription_status_detail` (jsonb objet, seulement pour `blocked`, ex. `{ "reason": "upward_modify_not_supported" }`). `NULL` partout : décision du chemin V1 ou antérieure au contrat V2. Écrits uniquement par `persist_daily_run_v2`.

**Aucune contrainte d'unicité sur `(athlete_id, decision_date)`. Aucun upsert.** Plusieurs décisions par jour sont autorisées si le contexte change en cours de journée (nouveau checkin, événement en cours, correction manuelle plus tard). La décision courante est la plus récente **valide** (`ORDER BY created_at DESC`, puis premier `daily_plan` passant la validation canonique côté client — voir V0.3_005 ci-dessous) — pas simplement la plus récente au sens strict : une row plus récente mais malformée/legacy ne doit jamais masquer une décision plus ancienne réellement valide le même jour. Si un audit fin devient nécessaire plus tard, des champs `supersedes_decision_id`, `revision` ou `is_current` pourront être ajoutés (P2+).

**V0.3_005 (NAL-003, Persisted Daily Decision Restore) : COMPLETE (2026-09-08)** : `/today` restaure automatiquement la décision déjà persistée pour l'athlète et la date courante au lieu de la faire disparaître à chaque navigation/rechargement — `daily-run` n'est jamais invoqué merely pour afficher un plan déjà généré. `web/src/features/history/historyRepo.ts#loadLatestDecisionForDate` réutilise le chemin RLS existant (`decisions_own_select`) et implémente la sélection "plus récente valide" ci-dessus. Une erreur de lecture reste distincte d'une absence de décision (jamais présentée comme "aucun plan, génère-en un"). Voir `docs/11_DECISION_LOG.md` (V0.3_005, NAL-003).

**Atomicité écriture (M2)** : la persistance d'une nouvelle row `decisions` et l'éventuel upsert du health flag associé sont effectués dans **le même appel** de la fonction PostgreSQL `persist_daily_run` (invoquée via RPC). Une fonction PostgreSQL s'exécute intrinsèquement dans une transaction unique : les deux écritures aboutissent ensemble, ou aucune ne persiste. Toute erreur non capturée fait échouer l'appel et annule les écritures de cet appel. Voir `06_ARCHITECTURE.md` §Persistance idempotente + atomique.

### Modèle d'exécution V1 (UX-11B, ADR acceptée — non migré)

> **Statut** : conception validée par l'ADR UX-11B.1 « NALYNT Execution Model V1 » (`11_DECISION_LOG.md`). **Aucune des nouvelles entités ci-dessous n'existe encore en base.** Les noms d'entités sont des noms conceptuels ; les noms de tables et les champs seront validés lors de UX-11B.2.
>
> **Règle** : NALYNT ne remplace jamais l'historique de décision par le résultat final. Le prévu, le demandé aujourd'hui et le réalisé restent trois couches séparées et immuables. Une correction crée un nouvel événement ou une nouvelle version, jamais un écrasement.

```
training_plan_planned_prescriptions   prévu (existe, immuable)
        ↓ planned_prescription_id
decision_final_prescriptions          demandé aujourd'hui (existe, immuable, jamais écrite à ce jour)
        ↓ final_prescription_id (facultatif)
session_executions                    exécution (nouvelle, insertion seule)
        ├── execution_events                started / paused / resumed / completed / abandoned (nouvelle, insertion seule)
        └── exercise_set_results            une ligne par série (nouvelle, insertion seule)

completed_sessions                    résumé Après séance du jour (existe, inchangée)
```

**Tables existantes concernées** (V0.4, jusqu'ici non décrites dans ce document) :

| Table | Rôle | Propriétés |
|---|---|---|
| `training_plan_planned_prescriptions` | Prescription d'une séance du plan (`structure` JSONB versionnée par `schema_version` et `catalog_version`) | Une par séance générée ; modification et suppression rejetées par trigger |
| `decision_final_prescriptions` | Prescription du jour attachée à une décision : origine (`generated`, `manual_override_same_kind`, `manual_override_new_kind`, `no_canonical_plan`), action (`keep`, `modify`, `replace`), `adaptation_rule_ids`, `structure` | Référence la prescription du plan quand elle en dérive ; modification et suppression rejetées par trigger ; **aucun code ne l'écrit à ce jour** (écriture prévue en UX-11A.5) |

**Identifiants d'éléments prescrits.** À partir du format de séance V1 (`03_COACHING_MODEL.md` §Modèle de séance NALYNT V1), chaque exercice prescrit dans `structure` porte un `prescription_item_id` (UUID) à côté de son `exercise_id` de catalogue. Un élément gardé ou réduit dans la prescription du jour conserve la référence de l'élément du plan dont il dérive. Les `structure` au format actuel n'ont pas d'identifiants et n'en reçoivent jamais a posteriori : anciennes séances → historique uniquement ; nouvelles prescriptions au format UX-11A → exécutables.

**Une exécution référence la prescription du jour affichée au pilote, et non uniquement le plan d'origine** : si le plan prévoit squat 4 × 8 et que NALYNT adapte en 3 × 6, l'exécution pointe vers 3 × 6.

**Nouvelles entités (conceptuelles)** :

| Entité | Champs principaux | Règles |
|---|---|---|
| `session_executions` | `id` (UUID généré par l'appareil) · `athlete_id` · `session_date` · `final_prescription_id` (facultatif) · `decision_id` (facultatif) · `started_at` (appareil) · `recorded_at` (serveur) · `comment` (facultatif) | Insertion seule. 0 à N exécutions par prescription du jour ; les historiques peuvent contenir plusieurs tentatives, mais **une seule exécution peut être active pour une journée donnée** en V1 |
| `execution_events` | `id` (UUID appareil) · `execution_id` · `event_type` (`started`, `paused`, `resumed`, `completed`, `abandoned`) · `occurred_at` (appareil) · `recorded_at` (serveur) | Insertion seule. L'état courant d'une exécution est celui de son dernier événement ; aucune colonne de statut modifiée |
| `exercise_set_results` | `id` (UUID appareil) · `execution_id` · `prescription_item_id` (facultatif) · `other_exercise_name` + `comment` (quand ce n'est pas un élément prévu) · `set_number` · `done` · une seule mesure : `reps`, `duration_s`, `distance_m` ou passage DH · `load_kg` (facultatif, saisi par le pilote) · `rpe_actual` (facultatif) · `success` (facultatif, quand un critère existe) · `supersedes_id` (facultatif) · `occurred_at` (appareil) · `recorded_at` (serveur) | Insertion seule. Une correction est une nouvelle ligne avec `supersedes_id` ; la valeur courante est la dernière non remplacée. Aucun total stocké |

**Intégrité.** `prescription_item_id` doit exister dans la `structure` de la prescription du jour de l'exécution ; une clé JSONB ne pouvant pas porter de clé étrangère, ce contrôle appartient au chemin d'écriture serveur. Une exécution sans prescription (séance libre, sans plan, format ancien) n'a que des événements et un commentaire, sans série liée à un élément.

**Accès.** RLS : lecture par le pilote de ses propres lignes (politique standard). Écriture uniquement via un chemin serveur validé (RPC / Edge Function, même principe que `persist_completed_session`), jamais de privilège d'écriture direct.

**Compatibilité future hors ligne (non implémentée)** : identifiants générés par l'appareil (un renvoi ne crée jamais de doublon), double horodatage appareil / serveur, données en ajout seulement (fusion par union). Seule la règle « une exécution active » demandera une résolution de conflit lors de la synchronisation.

**Schéma d'exécution V1 (ADR UX-11B.2.1 acceptée, non migré).** Traduction du modèle ci-dessus en schéma ; migration en UX-11B.2.2, mise en production seulement avec UX-11C.

*Source de l'exécution* : `decision_final_prescriptions` (option A). Une ligne par décision = une version de la prescription du jour ; aucune table de versions dédiée.

*Format de prescription v2* (verrouillé par l'ADR UX-11A.5b.0.1 ; aucune prescription v2 n'est encore générée) : les détails restent dans `structure`, avec `schema_version = 'v2'` (valeur exacte exigée par `record_session_execution`).
- **En-tête** : `schemaVersion: "v2"`, `family`, `sessionKind`, `intentId`, `protocolId` (facultatif), `templateId` (obligatoire pour la famille `strength`, absent sinon : identifiant du template Force qui a produit la composition), `activitySelection` (séance d'endurance uniquement, voir ci-dessous) et un manifeste de catalogue `catalog: { aggregate, exercises, drills, intents, protocols, texts, templates, strengthDoses, planDosePolicy }`. Toutes les clés sont des versions non vides. `aggregate` est la version Session Model V2 (`session-model-v2.5` depuis le verrouillage de l'autorité de charge V2), distincte des versions legacy, qui restent inchangées. Versions actuelles : `exercises` = `session-exercises-v2.1`, `templates` = `strength-templates-v2.1`, `strengthDoses` = `strength-doses-v2.1`, `planDosePolicy` = `plan-dose-policy-v2.3`. Chaque composant est tracé séparément.
- **Blocs ordonnés** : chacun a un `blockId`, un rôle (`brief`, `warm_up`, `main`, `complementary`, `application` ou `cool_down`), des consignes, puis une durée, un RPE cible et une zone ou partie ciblée facultatifs.
- **Élément exercice** : `prescriptionItemId`, `exerciseId`, rôle d'exercice, `sets` = nombre **exact** de séries (fourni par le modèle de contenu, jamais choisi dans une plage), mesure (répétitions, durée ou distance ; la cible peut être une plage min–max), repos, RPE cible, `cueId`, vigilances. L'élément principal de Force peut porter `rampUp` : `instructionId` + une à deux séries. `rampUp` n'a pas de `prescriptionItemId` propre, ne porte ni charge ni RPE, n'utilise jamais `derivedFromItemId` et n'est pas enregistré série par série.
- **Élément exercice technique DH** : `kind = "drill"`, `prescriptionItemId`, `drillId`, **aucun rôle d'élément** (le bloc `main` porte la place de l'exercice dans la séance), mesure `{ type: "pass", count }` (entier de 4 à 8), `cueId`, `successCriterionId`. **Format canonique, y compris stocké** : jamais d'alias `exerciseId = drillId` (ADR UX-11A.5b.2.1). `record_session_execution` enregistre alors le passage avec `exercise_id = null` ; l'exercice DH réalisé se retrouve par `prescription_item_id`. `exercise_id` n'est jamais rempli avec un exercice DH ; si UX-11E a besoin d'un accès direct, un vrai `drill_id` sera décidé.
- **Règles générales** : jamais de valeur choisie au milieu d'une plage ; aucun kg, %1RM, zone cardiaque, FTP ni watt ; les consignes, critères et vigilances sont stockés par identifiant ; un plan est entièrement v1 ou entièrement v2.
- **`derivedFromItemId`** est réservé à la prescription du jour (UX-11A.5c) : élément quotidien → élément du plan d'origine. KEEP conserve les `prescriptionItemId` du plan ; MODIFY en crée de nouveaux avec `derivedFromItemId` (règle complète ci-dessous).
- **Identifiants** : `blockId` et `prescriptionItemId` sont des UUID attribués par l'orchestration après le contenu sportif. Deux versions de plan ont des identifiants différents. Le déterminisme porte sur l'**empreinte sportive**, calculée avant l'attribution des identifiants : même snapshot, même horizon, même version du planificateur et même manifeste donnent la même empreinte.
- **Mesure** (UX-11B.2.3) : `measure.type` utilise exactement le vocabulaire des séries enregistrées, `reps`, `duration`, `distance` ou `pass` (jamais `passes`). Exercice technique DH : `{ type: "pass", count }`, avec `count` entier de 4 à 8. `record_session_execution` refuse (`invalid_prescribed_measure`) toute série rattachée à un élément dont la mesure est absente ou inconnue : elle ne désactive jamais le contrôle `measure_mismatch`.
- **Modalité d'endurance** (ADR UX-11A.5b.2.1) : **pas un élément**. Le pilote choisit une activité une seule fois pour toute la séance (échauffement, bloc principal, retour au calme) : `activitySelection: { mode: "restricted", activityIds }` au niveau de la séance, sur une séance de famille `endurance` uniquement. La liste est non vide, sans doublon, avec des identifiants `ENDURANCE_ACTIVITIES_V2`, et dérivée du protocole (jamais une seconde liste). Seul « restricted » existe : pas de choix libre générable, une liste vide ne signifie jamais « libre ». Les blocs d'endurance portent durée, RPE, test de la parole et consignes, avec `items: []` : pas de faux élément pour obtenir un `prescriptionItemId`. La réalisation va dans `session_activity_results` (UX-11B.2.5, migration locale `20261001140000`, non poussée) : voir ci-dessous.

Les lignes v1 restent inchangées et non exécutables. Les lecteurs doivent distinguer « v1 pris en charge », « v2 pris en charge » et « format non pris en charge par ce lecteur » (UX-11A.5b.1), sans jamais interpréter un v2 comme un v1 ni le masquer.

*Snapshot de génération v2* (`training_plan_versions.input_snapshot`, `input_snapshot_schema_version = 'v2'` ; constructeur runtime `buildPlanInputSnapshotV2` depuis UX-11A.5b.5a, qui reprend le snapshot v1 sans le modifier et lit le profil une seule fois) : le snapshot v1 plus `dhTechnicalTier` (`beginner` | `intermediate` | `advanced` | `null`). `technicalPriorities.priorityAreas`, déjà figé dans son ordre, reste la seule source des priorités DH : pas de `dhPriorityAreas`. Tout ce qui influence le contenu vient du snapshot et de la version du plan, jamais d'une relecture du profil vivant. **Ordre canonique** (v1 et v2, correctif de déterminisme) : les collections lues sans ordre garanti et dont la position n'a aucun sens sont triées avant la construction du snapshot — fenêtres (jour, début, fin, libellé), exceptions (date), dates verrouillées (date), séances récentes (date) — de sorte que le snapshot persisté et son hash sont identiques pour les mêmes données ; les courses (déjà triées par la requête) et les tableaux du profil (ordre stocké ; l'ordre de `priorityAreas` a un sens) ne sont pas retriés. `strengths` et `weaknesses` ne sélectionnent jamais de contenu.

*Génération V2 (UX-11A.5b.5a, en mémoire seulement)* : le chemin V2 n'est déclenché que par un choix explicite (`planningModel: "v2"`) ; V1 reste le défaut. La politique de dose V2 fixe les durées **avant** le placement (point d'injection `sessionDoseModel` du planificateur partagé), et aucune réduction legacy liée à l'historique n'est appliquée. Chaque séance d'un plan V2 porte exactement une prescription v2 valide. **Persistance V2 locale (UX-11A.5b.5b)** : un plan V2 complet et validé est écrit **en local uniquement**, par un seul appel à la RPC transactionnelle existante `generate_training_plan_version`, sans migration. Rien n'est écrit si le plan est bloqué ou si un invariant échoue. Version : `input_snapshot_schema_version = 'v2'`, `prescription_schema_version = 'v2'`, `catalog_version` = version agrégée Session Model. Chaque prescription prévue : `schema_version = 'v2'`. Pour un plan V2, la **prescription prévue structurée est l'autorité de dose** : le `dose_target` des séances n'est qu'une métadonnée de compatibilité. Le `load_profile` de chaque séance générée (Force, DH, AEROBIC_BASE) vient uniquement de la politique de dose V2 (`plan-dose-policy-v2.3`), jamais de la charge de base legacy. Une séance non placée n'a ni séance ni prescription ; son diagnostic reste dans `relaxed_constraints`. Idempotence : contrat existant de `generation_request_id` (reprise identique → version existante ; autre environnement, V1 compris → refus). Aucune colonne `planningModel`, aucune empreinte sportive stockée. L'Edge Function publique reste V1 : **V2 est inaccessible en production**.

| Table | Colonnes | Contraintes |
|---|---|---|
| `session_executions` | `id` uuid (appareil) · `athlete_id` · `session_date` · `decision_id` · `final_prescription_id` · `started_at` · `recorded_at` · `comment` (≤ 500) | Clés composites `(decision_id, athlete_id)` → `decisions`, `(final_prescription_id, athlete_id)` → `decision_final_prescriptions` ; prescription ⇒ décision |
| `execution_events` | `id` uuid (appareil) · `execution_id` · `athlete_id` · `event_type` (`started`, `paused`, `resumed`, `completed`, `abandoned`) · `occurred_at` · `recorded_at` | Un seul événement `started` logique par exécution (renvoi du même identifiant sans effet, nouveau `started` refusé) |
| `exercise_set_results` | `id` uuid (appareil) · `execution_id` · `athlete_id` · `prescription_item_id` ou `other_exercise_name` (≤ 80) · `exercise_id` (recopié par le serveur) · `set_number` · `done` · `measure_type` (`reps`, `duration`, `distance`, `pass`) · `measure_value` · `load_kg` · `rpe_actual` (1–10) · `success` · `comment` (≤ 500) · `supersedes_id` · `occurred_at` · `recorded_at` | Élément prescrit **ou** autre exercice ; une ligne remplacée au plus une fois |

Les trois tables sont en ajout seul (`reject_append_only_mutation`) et référencent `athletes` en `ON DELETE RESTRICT`. Seule évolution d'une table existante : `unique (id, athlete_id)` **ajoutée** sur `decision_final_prescriptions`.

*Vérifié par la fonction d'écriture* : le client ne choisit jamais librement `prescription_item_id` (chaîne exécution → prescription du jour → élément vérifiée par le serveur, `exercise_id` recopié depuis l'élément) ; décision cohérente avec la prescription ; une seule exécution active par pilote et par jour (sous verrou) ; ordre des événements ; corrections par `supersedes_id` sur la même série, une correction ne pouvant pas elle-même être corrigée ; cycle de vie verrouillé après `completed` / `abandoned`, séries toujours possibles après la fin ; idempotence (même identifiant et même contenu → sans effet ; contenu différent → refus).

*Charge* : la charge observée appartient à l'exécution, pas à la prescription. `load_kg` est une donnée réalisée, facultative, saisie par le pilote ; jamais une prescription, un objectif automatique ni une charge calculée par NALYNT.

*Mesure* : le modèle permet l'ajout futur de nouvelles mesures (réussite technique, côté gauche / droit, amplitude, score qualitatif…) sans migration destructrice : uniquement par ajouts (valeurs d'énumération, colonnes facultatives), jamais en réinterprétant un champ existant.

*Identité d'une exécution* : un pilote + un jour + la prescription affichée, pas uniquement une décision. *Règle client* : le client ne choisit jamais un exercice ou un `prescriptionItemId` arbitraire ; toute référence est validée côté serveur. *Historique* : les anciennes prescriptions ne deviennent jamais des séances exécutables. *Progression* : ces données préparent la progression, mais aucune adaptation du moteur ne les utilise encore.

*Écriture* : Edge Function (authentification, pilote, validation) → fonction SQL exécutable côté serveur uniquement, en lot (événements et séries). Aucun droit d'écriture direct pour `authenticated` ni `anon`.

*Prescription du jour* (contrat UX-11A.5c.0 ; couche DB UX-11A.5c.2, **locale, pas encore appelée par `runDailyFor`**) : écrite avec la décision dans **une même transaction** par `persist_daily_run_v2(p_athlete_id, p_health_flag, p_decision_row, p_final_prescription_outcome)` (`SECURITY DEFINER`, `search_path = public, pg_temp`, exécution réservée à `service_role`). `persist_daily_run` reste inchangée pour V1.
- `p_decision_row` : même contenu que pour V1, plus un `id` fourni par l'appelant (la prescription du jour, construite avant l'appel, le référence).
- `p_final_prescription_outcome` : **un seul** objet : `{ status: "created", final_prescription }` (exactement une ligne), `{ status: "not_required" }` (décision REST uniquement), `{ status: "blocked", code, detail? }` (aucune ligne). Tout autre cas (statut absent ou NULL, prescription en trop ou manquante, code manquant, REST non respecté, schéma non v2, `catalog_version` ≠ `structure.catalog.aggregate`, autre pilote, autre décision, `keep` sans `planned_prescription_id`, prescription prévue non v2, action ≠ décision) est refusé et **rien** n'est écrit.
- Tout ou rien : health flag éventuel, décision, statut et prescription du jour. Le document est stocké tel quel (identifiants de l'appelant, aucun recalcul) ; la validation sportive reste en TypeScript avant l'appel.
- `decision_final_prescriptions` : `unique (decision_id)` (aucun doublon trouvé avant migration) ; aucun droit d'insertion direct, même pour `service_role`.
- *Chemin quotidien V1 / V2* (**UX-11A.5c.3, code local non fusionné**) : choisi une fois, avant M1, par `prescription_schema_version` de la **version de plan courante** — aucune version ou `v1` → chemin historique inchangé (`persist_daily_run`) ; `v2` → chemin V2, y compris un jour sans séance prévue ; autre → refus (`unsupported_plan_prescription_schema`), rien n'est calculé ni écrit. Jamais déduit de la lignée du jour, du profil ou de `dhTechnicalTier`.
- *Même observation* (5c.3) : la lecture unique de `planned_sessions` qui alimente M1 porte aussi l'identité et la lignée de la ligne (`id`, `source`, `source_plan_version_id`, `source_generated_session_id`, `updated_at`), exposées à la couche d'intégration comme `PlannedSessionObservation` ; M1 reçoit exactement le même contexte. Le chemin V2 ne relit jamais `planned_sessions` ; la séance générée et sa prescription prévue sont lues **dans la version courante uniquement**.
- *Chemin V2* (5c.3) : M1 inchangé → identifiant de décision créé **après** M1 → réconciliation pure (5c.1) → personnalisation du `reasoning` (comme en V1) → **un seul** appel `persist_daily_run_v2`. Correspondance : KEEP copiable → `created` + une prescription du jour ; REST → `not_required` ; KEEP sans lignée → `blocked` / `final_prescription_no_lineage` ; MODIFY → `blocked` / `final_prescription_adaptation_not_defined` (`modify_not_supported` ou `upward_modify_not_supported`) ; REPLACE → `blocked` / `final_prescription_adaptation_not_defined` (`replace_not_supported`) ; prescription prévue d'un agrégat plus ancien que le runtime ne sait plus valider → `blocked` / `final_prescription_catalog_mismatch`. **MODIFY et REPLACE ne produisent aucune prescription du jour** (non implémentés). La réponse de `daily-run` ajoute, sur le chemin V2 seulement, `finalPrescriptionStatus`, `finalPrescriptionStatusCode`, `finalPrescriptionStatusDetail` et `finalPrescription` ; le web ne les affiche pas encore (5c.4) et son lecteur reste fermé (`executablePrescription` nul). **Edge Function `daily-run` (UX-11A.5c.3.1)** : le chemin V2 y charge, à la demande, le bundle esbuild `head-coach-engine/dist/edge/dailyRunV2.bundle.js` (même source, point d'entrée minimal `planning-engine/session-model-v2/daily`) ; le chemin V1 ne le charge jamais. Artefact non versionné, reconstruit par `npm run build && npm run build:edge` dans `head-coach-engine`. **Web, lecture seule (UX-11A.5c.4, code local non fusionné)** : Aujourd'hui affiche la prescription du jour V2 depuis la réponse de `daily-run` puis, après rechargement, depuis la base — décision courante (plus récente valide du jour, `daily_decision_currency`, et pour une décision V2 : la plus récente du jour, comme `record_session_execution`), ses colonnes `final_prescription_status*`, et seulement si `created` sa ligne `decision_final_prescriptions` (aucune reconstruction depuis le plan). Version supportée : manifeste complet `session-model-v2.5` uniquement ; toute autre version → « non prise en charge », sans résoudre un seul identifiant. Aucune exécution guidée.

*Lignée prévu → prescription du jour (UX-11A.5c.0)* :
- **KEEP copiable** : séance prévue issue de la version générée courante (`planned_sessions.source = 'generated'`, version courante, `source_generated_session_id` présent) ; prescription prévue v2 de **cette** séance générée ; `kind` et `load_profile` finaux identiques à ceux prévus ; toute durée portée par la séance finale égale à la durée prévue. Sinon, pas de copie (`final_prescription_no_lineage` sans lignée, `final_prescription_adaptation_not_defined` si la décision cache un écart). La lignée doit venir de la même ligne `planned_sessions` que la provenance de la décision (`source_planned_session_id`).
- **Origine et action** : `active_session_origin = 'generated'`, `reconciliation_action = 'keep'`, `adaptation_rule_ids = []`, `planned_prescription_id` et `plan_version_id` renseignés.
- **REST** : aucune ligne. **MODIFY / REPLACE** : aucune ligne avant UX-11A.5c.5. Aucun repli (v2 → v1, MODIFY → KEEP, REPLACE → prescription prévue).
- **Identité des éléments** :
  - KEEP : `blockId` et `prescriptionItemId` du plan conservés, aucun `derivedFromItemId` ;
  - MODIFY : **tous** les éléments reçoivent un nouveau `prescriptionItemId` ; chaque élément qui a un correspondant prévu porte `derivedFromItemId` = son identifiant prévu, même s'il n'a pas changé ; un nouvel élément n'en a pas ; un élément retiré est absent ;
  - REPLACE : tous les identifiants sont nouveaux, aucun `derivedFromItemId`.
- **Manifeste** : KEEP et MODIFY utilisent exactement le manifeste de la prescription prévue, jamais les catalogues courants (`final_prescription_catalog_mismatch` si le runtime ne sait plus l'appliquer) ; REPLACE pourra utiliser le manifeste courant. `catalog_version` = `structure.catalog.aggregate`.
- **Empreinte sportive** : même algorithme ; KEEP → empreinte finale = empreinte prévue. Aucune colonne.
- **Unicité** : au plus une prescription du jour par décision (`unique (decision_id)`, à ajouter en UX-11A.5c.2).
- **Exécution** (UX-11A.5c.2) : `record_session_execution` n'accepte une nouvelle exécution liée à une prescription du jour que si sa décision a le statut `created` (sinon `not_executable`) **et** est la décision courante du pilote pour cette date : la plus récente (`created_at` décroissant, puis `id`) **et** `is_current` dans `daily_decision_currency`. Sinon `final_prescription_not_current` (HTTP 409 dans l'Edge Function `session-execution`). Les deux conditions sont nécessaires : deux décisions calculées sur les mêmes entrées sont toutes deux « à jour » dans la vue, seule la dernière est celle du jour. Une nouvelle décision (append-only) rend donc l'ancienne prescription non exécutable ; aucun repli vers la prescription prévue. Une exécution déjà commencée garde ses événements et séries.
- **Identité des blocs** (décidée, non implémentée) : KEEP conserve les `blockId` ; MODIFY crée de nouveaux `blockId` et un futur `derivedFromBlockId` pour les blocs dérivés ; REPLACE crée de nouveaux `blockId` sans lignée. `derivedFromBlockId` sera ajouté avec MODIFY.
- **Suppression de compte** (audit UX-11A.5c.2) : la suppression d'un utilisateur échoue dès qu'une décision possède une prescription du jour (`decision_final_prescriptions_decision_fk`, `ON DELETE RESTRICT`, plus le trigger d'ajout seul). Ce n'est pas nouveau : `training_plan_versions`, `training_plan_current_version`, `decision_outcomes`, `pattern_*` et les tables d'exécution bloquent déjà. Traitement : la procédure de purge unique décidée en UX-11B.2 §11 (ticket séparé).

**Activité réalisée d'une séance d'endurance (UX-11B.2.5, migration locale non poussée)** : `session_activity_results` — `id` (appareil), `execution_id`, `athlete_id` (clé composite vers `session_executions`), `activity_id`, `duration_seconds` (durée **réelle**, entier > 0, jamais ramenée à la durée prescrite), `distance_m` (mètres, entier ≥ 0, facultatif), `rpe_actual` (1–10, même échelle que les séries), `comment` (≤ 500), `supersedes_id`, `occurred_at`, `recorded_at`. Ajout seul (triggers), RLS lecture du pilote, aucun droit d'écriture direct ; écriture par `record_session_execution` (clé facultative `activities`). Pas un élément prescrit : ni `prescription_item_id` ni `exercise_id` ; la lignée est exécution → sa prescription du jour → `activitySelection`. Règles : l'`activity_id` doit figurer dans `activitySelection.activityIds` de la prescription de **cette** exécution (v2, `restricted`), sinon `activity_not_allowed_by_prescription` (Force et DH, sans `activitySelection`, sont donc refusées) ; une seule activité par séance : au plus un original par exécution (index unique), sinon `activity_result_exists` ; correction = nouvelle ligne `supersedes_id` d'un original, une seule fois, jamais une correction de correction (comme les séries) ; résultat actif = la ligne qu'aucune autre ne remplace ; idempotence par identifiant. Pas de nouvelle vérification de décision courante sur une exécution déjà commencée. **Invariant de fin** : une exécution dont la prescription propose un choix d'activité ne peut recevoir `completed` sans résultat d'activité (enregistré avant ou dans le même lot), sinon `activity_result_required` et tout le lot est annulé.

**Cycle de vie d'une séance guidée côté web (UX-11C.1, code local non fusionné)** : aucune nouvelle table ni colonne. Une séance guidée ne peut commencer que depuis une ligne `decision_final_prescriptions` d'une décision **courante** (dernière du jour et `daily_decision_currency.is_current`) avec `final_prescription_status = created` et un catalogue pris en charge ; jamais depuis `training_plan_planned_prescriptions` ni `planned_sessions`, jamais pour un REST, un statut `blocked`, une prescription manquante ou une décision V1. Démarrer = un seul lot `record_session_execution` (exécution + événement `started`, identifiants générés par l'appareil une fois par action logique et renvoyés tels quels en cas de nouvel essai). L'état affiché est une **projection** de `session_executions` + `execution_events` (dernier événement par `event_seq` : `started`/`resumed` → active, `paused` → en pause, `completed`, `abandoned` ; aucune exécution → pas commencée), relue après chaque écriture confirmée, jamais un état optimiste. La prescription d'une exécution est **figée** : c'est sa `final_prescription_id`, relue par identifiant ; une décision plus récente ne la remplace jamais. La vérification « prescription courante » n'a lieu qu'au **démarrage** (refus `final_prescription_not_current`) ; pause, reprise et arrêt d'une exécution ouverte restent acceptés. Rafraîchir reprend l'exécution ouverte du jour (au plus une, `active_execution_exists`) et n'en crée jamais une seconde. Une exécution dont la prescription n'est plus lisible par l'application (catalogue non pris en charge) n'est ni détruite ni rendue partiellement.

**Séries d'une séance Force guidée (UX-11C.2, code local non fusionné)** : aucune nouvelle table ni colonne ; écriture par `record_session_execution` (clé `sets`), lecture des résultats embarquée dans la lecture de l'exécution (une requête). Uniquement `STRENGTH_LOWER` / `STRENGTH_UPPER` ; DH et endurance restent en lecture seule. Source : l'exécution et **sa** prescription du jour (jamais la prescription planifiée, une décision plus récente ou un `doseTarget`). Seuls les éléments `exercise` des blocs `main` et `complementary` reçoivent des résultats ; échauffement et montée en charge restent des consignes. Un résultat = une ligne `exercise_set_results` (`prescription_item_id`, `set_number` de 1 à `sets` prescrit, `done = true`, `measure_type` = mesure prescrite — `reps`, ou `duration` en secondes, jamais convertie —, `measure_value` entier ≥ 1, `rpe_actual` 1–10 facultatif, `load_kg` facultatif). Une mesure prescrite non prise en charge sur un élément de travail : saisie fermée pour cet élément. `perSide` : une seule ligne par série, valeur par côté (pas de colonne côté). **Réalisé ≠ prescrit** : une série prévue sans ligne n'a pas de résultat (jamais 0, « sautée » ni « faite ») ; aucune ligne vide n'est créée. **Correction** : nouvelle ligne `supersedes_id` = original (même élément, même numéro), une seule fois, jamais une correction de correction ; résultat actif d'une série = ligne qu'aucune autre ne remplace, la plus récemment enregistrée si plusieurs. **Fin** : au moins un résultat actif réalisé sur un élément de travail ; si des séries prévues n'ont pas de résultat, confirmation explicite, puis `completed` avec les seuls résultats enregistrés (une saisie valide non encore envoyée part dans le **même lot** que `completed`). **Arrêt** : terminal, les séries restent dans l'historique, aucune entrée dans l'historique récent de M1. **Recommencer** (après un arrêt seulement, même jour, prescription toujours courante, aucune autre exécution ouverte) : une **nouvelle** exécution + `started`, nouveaux identifiants ; l'ancienne reste dans l'historique.

**Charge récente de M1 (UX-11B.2.4, code local non fusionné)** : `session_executions` est la vérité des exécutions V2, `completed_sessions` le résumé legacy du jour ; aucune ligne n'est recopiée de l'un à l'autre. La couche d'intégration (`buildRawContext`) construit `RawContext.recent_sessions` depuis les deux sources, dans la même forme et la même fenêtre qu'avant (`[aujourd'hui − 7 j, aujourd'hui]`) : une exécution compte si elle a un événement `completed` (terminal, exclusif d'`abandoned`), son intervention est le `final_session` de sa décision, son statut `done` ; un jour qui a une ligne `completed_sessions` ne prend aucune entrée V2 (une séance principale par jour) ; plusieurs exécutions terminées identiques d'un même jour comptent une fois ; des interventions différentes le même jour ne sont pas comptées (avertissement `recent_history_v2_conflicting_completions`). Aucun `skipped` ni `replaced` n'est déduit d'une absence d'exécution. Le noyau M1 est inchangé.

**Limites V1** : une séance principale par jour ; « autre exercice réalisé » en nom libre sans lien au catalogue ; résultats de série non lus par le moteur de décision ; aucune progression automatique (UX-11E) ; suppression, anonymisation et conservation des données du pilote (RGPD) : sujet distinct, traité en UX-11B.2.

### `race_calendar`

Événements compétitifs. Champs : event_name, series, country, location, category, start_date, end_date, priority (`race_priority` enum : A_PLUS, A, B, C), status, race_format (`race_format` enum), notes.

Résultats stockés : result_position, result_time_seconds, result_gap_to_winner, result_field_size.

**`status`** (`race_status` enum : `planned`/`registered`/`confirmed`/`completed`/`cancelled`/`skipped`, défaut `planned`) — aucun chemin applicatif ne l'écrit à ce jour (valeur figée à la création ou éditée manuellement). Deux consommateurs, deux définitions distinctes et volontairement différentes (V0.3_005, voir `04_DAILY_DECISION_ENGINE.md` §Statut de la course et `11_DECISION_LOG.md` V0.3_005B/NAL-007A) :
- **Pertinence coaching** (`head-coach-engine`, adapter uniquement, M1 reste sans connaissance du statut) : `cancelled`/`skipped` exclus de toute phase (PRE_EVENT/IN_PROGRESS/POST_EVENT) ; `completed` exclus de PRE_EVENT/IN_PROGRESS mais **inclus** pour POST_EVENT (aucun writer ne transitionne jamais vers `completed`, l'exiger désactiverait silencieusement la récupération post-course) ; `planned`/`registered`/`confirmed` toujours inclus.
- **Overlay Planning** (`web`, lecture seule, V0.3_005/NAL-007) : seuls `planned`/`registered`/`confirmed` sont affichés dans l'horizon `/plan` (aujourd'hui→J+6) — reprend la définition déjà existante de l'index partiel `idx_race_calendar_upcoming`. Différence intentionnelle avec le moteur : un événement `completed` n'a pas besoin d'apparaître comme "à venir" dans Planning tout en restant coaching-pertinent pour POST_EVENT.

Le Race Calendar reste la seule source de vérité — l'overlay Planning est strictement lecture seule et n'écrit jamais dans `planned_sessions` ; `RACE_ACTIVITY` reste exclusivement dérivé du moteur/Race Protocol, jamais athlete-plannable.

### `health_flags`

Blessures, douleurs persistantes, suspicions de commotion, maladies. Table privée séparée.

Audit DDL M2 (2026-08-14) : la colonne discriminante réelle est **`flag_type`** (pas `type`). Aucun discriminateur `location_code` sur cette table. La clé d'idempotence retenue est **`(athlete_id, flag_type)`** pour les flags ouverts (`status IN ('active','monitoring')`). L'objet domaine `HealthFlag` côté moteur conserve son champ `type` — la traduction se fait dans le mapping SQL → domaine de l'adapter.

**RLS/grants (V0.3_006A1, `20260909090000_v0_3_006a1_health_flags_select_only_security.sql`)** : la policy baseline `health_flags_own_data` (`FOR ALL`, sans clause explicite) combinée au `GRANT ALL` baseline vers `authenticated` permettait à un athlète authentifié de résoudre directement son propre flag (`status = 'resolved'`) via PostgREST — hors de tout workflow produit, et suffisant pour désactiver silencieusement le suivi Safety A5 (`rules/safety.ts`). Corrigé selon le même schéma que `decisions_append_only_security` (2026-08-19) : policy remplacée par `health_flags_own_select` (`FOR SELECT` uniquement, `authenticated`), `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER` révoqués pour `authenticated`, tout privilège révoqué pour `anon`. Aucune colonne/enum/index modifié. Le seul chemin d'écriture légitime reste `persist_daily_run` (RPC `SECURITY INVOKER`, `EXECUTE` accordé uniquement à `service_role`, invoquée exclusivement via `ctx.supabaseAdmin` dans `supabase/functions/daily-run/index.ts`) — inchangé par ce durcissement. `web/src/features/healthFlags/openHealthFlagsRepo.ts` est le seul lecteur web (`SELECT` scope-own, lecture seule, aucune écriture) ; il alimente un bandeau `/today` scopé exclusivement à `concussion_suspect` (seul type consommé par une règle Safety persistante, A5 — voir `04_DAILY_DECISION_ENGINE.md`). Voir `11_DECISION_LOG.md` (2026-09-09 — V0.3_006A/V0.3_006A1).

### `athlete_coaching_profiles` (V0.3_004A, DONE local + remote)

Contenu de coaching personnel, scopé par athlète, consommé aujourd'hui par les domaines Technique et Mental. `athlete_id uuid PRIMARY KEY REFERENCES athletes(id) ON DELETE CASCADE` — au plus une ligne par athlète (configuration courante mutable, pas un historique daté). Absence de ligne = absence de personnalisation, **jamais** une erreur ni une valeur générique fabriquée.

Champs : `technique_primary_focus text NULL`, `mental_pre_race_cue text NULL`, `created_at`/`updated_at timestamptz`. Deux `CHECK` (`_not_blank`) interdisent une chaîne vide/blanche mais acceptent `NULL` — un `NULL` reste `NULL` ("pas encore configuré"), une valeur présente doit être un contenu réel. V1 délibérément minimal : uniquement les deux valeurs textuellement consommées par le moteur aujourd'hui — aucun champ sans consommateur runtime (pas de dump de profil général : objectifs/équipement/disponibilité/notes hors périmètre).

RLS : policy `athlete_coaching_profiles_own_data` (`FOR ALL`, `USING`/`WITH CHECK` via `athlete_id IN (SELECT id FROM athletes WHERE user_id = auth.uid())`), même famille que `weekly_availability_own_data`/`training_blocks_own_data` — l'athlète édite directement sous RLS, pas de RPC. Grants : `authenticated` → `SELECT, INSERT, UPDATE, DELETE` ; `service_role` → `SELECT, INSERT, UPDATE` (délibérément **pas** `DELETE` — aucun chemin ne supprime une ligne en gardant l'athlète ; la suppression n'existe que via le `ON DELETE CASCADE` de la FK) ; `anon` → aucun grant.

Avant V0.3_004A, ces deux valeurs vivaient dans un singleton de code mono-athlète (`head-coach-engine/src/config/athleteCoachingProfile.ts`, retiré par ce jalon) qui se serait appliqué tel quel à n'importe quel second athlète. Le repository `getCoachingProfileFor` (read-only) peuple `RawContext.coaching_profile` **uniquement** si une ligne existe ; `domains/technique.ts`/`domains/mental.ts` reçoivent le focus/cue comme paramètre pur — absence de profil ou champ `NULL` individuel ⇒ section correspondante simplement absente, jamais un texte par défaut, jamais le contenu d'un autre athlète. Voir `06_ARCHITECTURE.md` §V0.3_004 et `11_DECISION_LOG.md` (2026-09-04 — V0.3_004A).

**Production** : ligne réelle de Louis peuplée en V0.3_004D (2026-09-04) avec ses deux valeurs approuvées. Preuve empirique de l'isolation cross-athlète (aucune fuite du contenu de Louis vers un second athlète) exécutée en production réelle contre deux utilisateurs scratch — voir `11_DECISION_LOG.md` (2026-09-04 — V0.3_004D).

### `pilot_observability_events` (PILOT_008 — observabilité pilote, hors modèle coaching)

Table technique append-only, écrite best-effort par les Edge Functions `generate-training-plan`, `accept-training-plan`, `daily-run` et `completed-session`. **Jamais lue** par le planning engine, le prescription engine, le Head Coach ni aucune logique de génération ou de décision quotidienne.

| Colonne | Type | Note |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `created_at` | `timestamptz` | `now()` |
| `event_type` | `text` | `CHECK` : 11 valeurs (`plan_generation_*`, `plan_acceptance_*`, `daily_run_*`, `session_completion_*`) |
| `severity` | `text` | `CHECK` : `info` / `warning` / `error` ; fixée par le type d'événement côté helper |
| `athlete_id` | `uuid NOT NULL` | pas de FK, volontairement |
| `plan_version_id`, `generation_request_id`, `decision_id`, `generated_session_id`, `completed_session_id` | `uuid NULL` | références vers les tables métier, jamais de copie |
| `event_date` | `date NULL` | date métier (daily-run / completion) |
| `metadata` | `jsonb` | codes techniques, warnings bornés (5 × 300 car.) ; jamais de check-in, santé, prescription, plan ou donnée utilisateur |

Accès : RLS activée sans policy ; `service_role` = `INSERT` uniquement ; aucun accès `anon` / `authenticated` ; lecture support via rôle SQL admin. Index : `(athlete_id, created_at desc)`, `(event_type, created_at desc)`. Voir `11_DECISION_LOG.md` (2026-09-24 — ADR PILOT_008).

### `athlete_onboarding_profiles` — consentement données de santé (PILOT_012, additif)

Deux colonnes ajoutées par `20260924100000_pilot_002_health_data_consent.sql` :

| Colonne | Type | Note |
|---|---|---|
| `privacy_notice_version` | `text NULL` | version de la notice acceptée, écrite par le client ; `CHECK` non blanche |
| `health_data_consent_at` | `timestamptz NULL` | posée **uniquement** par le trigger `trg_athlete_onboarding_profiles_health_data_consent_at` (`now()` quand la version change) ; toute valeur client est ignorée |

Contraintes : `athlete_onboarding_profiles_consent_pair` (les deux colonnes sont `NULL` ensemble ou renseignées ensemble) ; `athlete_onboarding_profiles_completed_requires_consent` (`onboarding_completed_at IS NULL OR privacy_notice_version IS NOT NULL`, **`NOT VALID`** : les lignes antérieures restent `NULL`, jamais de backfill ; elles sont gérées par la barrière de consentement web). RLS et grants existants inchangés (ligne propre uniquement). Voir `11_DECISION_LOG.md` (2026-09-24 — ADR PILOT_012).

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
- **Doubles séances** (UX-11B) — V1 supporte une séance principale par jour. Les doubles séances nécessitent une évolution du modèle de planification.

Voir `01_PRODUCT_REQUIREMENTS.md` §Hors périmètre.

---

## Contraintes de sécurité

- **RLS activée** sur toutes les tables
- Politique unique : `athlete_id IN (SELECT id FROM athletes WHERE user_id = auth.uid())`
- `health_flags` séparée pour permettre plus tard une politique de rétention différente si besoin
- **Suppression des données d'un pilote (ADR UX-11B.2.1)** : suppression physique de toutes ses lignes, sans anonymisation ni conservation agrégée en V1, par une procédure de purge unique réservée au serveur qui lève la protection « ajout seul » uniquement pendant sa transaction. **Non implémentée** (ticket séparé, après UX-11C) : aujourd'hui, les tables en ajout seul existantes empêchent toute suppression sans intervention manuelle en base.

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
- **Prescriptions et réalisations ne sont jamais écrasées (UX-11B).** Le prévu, le demandé aujourd'hui et le réalisé restent trois couches séparées ; une correction crée un nouvel événement ou une nouvelle version. Les nouvelles données détaillées sont append-only ; `completed_sessions` reste une exception historique liée au contrat existant.
- **`decisions` est append-only.** Aucune contrainte d'unicité sur `(athlete_id, decision_date)`, aucun upsert destructif. La décision courante est la plus récente.
- **`health_flag_to_create` produit par M1 est persisté** dans `health_flags` par la fonction PostgreSQL `persist_daily_run` (invoquée via RPC), **avant** l'insertion de la row `decisions`, dans le même appel de fonction (transaction unique implicite). Idempotence garantie par un index unique partiel PostgreSQL sur les flags ouverts **`(athlete_id, flag_type)`** (nom réel de la colonne discriminante confirmé par l'audit DDL 2026-08-14).
