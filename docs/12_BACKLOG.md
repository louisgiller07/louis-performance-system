# 12 — Backlog

## Statut actuel

**Phase** : M2 — Connexion Supabase read/write locale (conception validée 2026-08-13, implémentation à venir)
**Prochain milestone** : M2 — livrable Claude Code

---

## M1 — DONE (frozen 2026-08-13)

- [x] Repository GitHub créé (`louisgiller07/louis-performance-system`)
- [x] Docs canoniques poussés
- [x] `head-coach-engine/` initialisé (Node LTS 24, TypeScript strict, Vitest)
- [x] Structure de dossiers `src/{types,engine,rules,domains,mapping,cli}`, `tests/`, `fixtures/`
- [x] Types : `RawContext`, `AthleteDimensions`, `ContextState`, `DailyPlan`, `TrainingIntervention` (discriminated union `kind` + `load_profile`), `DbSessionType`
- [x] 6 dimensions individuelles
- [x] `global_readiness_ui` (UI seulement)
- [x] Traçabilité des signaux consommés (`SignalTrace`)
- [x] Couche A — SAFETY A1-A5 (A5 toujours tracée)
- [x] Couche B — Modes opérationnels + Event context (pre/in-progress/post)
- [x] Couche B — Race protocol T-X (HOT_TRAIL_2DAY + IXS_3DAY), overridable via `planned_intent`
- [x] Couche C — Domaine Training (KEEP/MODIFY/REPLACE) + douleur non-SAFETY
- [x] Couche C — Domaine Recovery
- [x] Head Coach arbitration + soft constraints strong overridables + `override_reason` garanti
- [x] Mapping `TrainingIntervention → DbSessionType` (fonction pure déterministe)
- [x] Assembleur `buildDailyPlan()`
- [x] Fixtures Louis réalistes
- [x] Tests M1 : 75/75 verts, tous déterministes
- [x] CLI `npm run run:example <scenario>`
- [x] `npm run build` sans erreur
- [x] Review Louis, verdict architecte : APPROVED
- [x] Commit + push

**Résultat** : `head-coach-engine/src/{types,engine,rules,domains,mapping}` est **frozen** sauf bug métier réel découvert ultérieurement.

---

## P0 — Requis pour M2 (Connexion Supabase read/write locale)

### 0. Audit préalable (obligatoire, en premier)

- [ ] Auditer le DDL réel des tables et enums touchés par M2 : `daily_checkins`, `decisions`, `planned_sessions`, `completed_sessions`, `health_flags`, enums `training_mode`, `health_flag_type`, `health_flag_status`, `session_type`.
- [ ] Déterminer la clé exacte d'idempotence des `health_flags` (`type` seul ou `type + location_code`) selon le DDL réel.
- [ ] Vérifier si `completed_sessions.main_content` contient déjà de façon canonique la `TrainingIntervention` riche. Décider en conséquence de la nécessité de `M2_004`.
- [ ] Tracer l'audit + décisions dérivées dans `11_DECISION_LOG.md`.

### 1. Infra tests d'intégration

- [ ] Supabase CLI local installé et opérationnel
- [ ] Structure `supabase/migrations/M2_*.sql` versionnée
- [ ] Seed reproductible (`supabase/seed.sql` ou script TypeScript) — Louis + scénarios canoniques M1 transposés en rows SQL
- [ ] Reset + seed déterministe avant chaque suite de tests
- [ ] `.env.example` avec `SUPABASE_URL` + placeholder clé serveur ; `.gitignore` vérifié pour ne jamais commiter la vraie clé

### 2. Migrations DB additives (non-destructives)

- [ ] `M2_001_daily_checkins_pain_criteria.sql` : `pain_traumatic`, `pain_function_loss`, `pain_getting_worse` en `boolean NULL` **sans default** (NULL = inconnu sur legacy)
- [ ] `M2_002_decisions_daily_plan.sql` : `daily_plan JSONB NULL` + `active_mode training_mode NULL` (aucune valeur par défaut sur legacy)
- [ ] `M2_003_planned_sessions_intervention.sql` : `intervention JSONB NULL` + `planned_intent TEXT NULL`
- [ ] `M2_004_completed_sessions_intervention.sql` (conditionnel) : ajouter `intervention JSONB NULL` uniquement si l'audit de `main_content` le justifie
- [ ] `M2_005_health_flags_unique_open.sql` : contrainte / index unique partiel sur `health_flags` empêchant deux flags ouverts `(athlete_id, type[, location_code selon DDL])` avec `status IN ('active','monitoring')` simultanés
- [ ] `M2_006_persist_daily_run_rpc.sql` : fonction PostgreSQL `persist_daily_run` (upsert health flag éventuel + insert append-only decision, dans une seule transaction, aucune logique de coaching côté SQL)

### 3. DAL — repositories `src/supabase/repositories/`

- [ ] `client.ts` : construction du client Supabase depuis env (Secret Key préférée, fallback service_role legacy), injecté par argument
- [ ] `athletesRepo` : `getAthleteById`
- [ ] `dailyCheckinsRepo` : `getCheckinFor` — l'adapter downstream rejette explicitement un checkin courant avec un des 3 critères douleur à `NULL`
- [ ] `trainingBlocksRepo` : `getCurrentBlock`
- [ ] `plannedSessionsRepo` : `getPlannedSessionFor`
- [ ] `raceCalendarRepo` : `getRacesInWindow`
- [ ] `completedSessionsRepo` : `getRecentSessions`
- [ ] `weeklyAvailabilityRepo` : `getAvailabilityForWeek`
- [ ] `healthFlagsRepo` : `getActiveHealthFlags` (filtré `status != 'resolved'`)
- [ ] `decisionsRepo` : `insertDecision` (append-only) et wrapper d'appel à la RPC `persist_daily_run`

**Volontairement non créés en M2** :
- ❌ `athleteBaselinesRepo` (le moteur M1 ne consomme aucune baseline)
- ❌ `activeExperimentsRepo` (pas de runtime M2, table inexistante — `RawContext.active_experiments = []` explicite)

### 4. Adapter — construction du `RawContext`

- [ ] `src/supabase/mapping/` : mappings SQL row → types domaine (`DailyCheckin`, `HealthFlag`, `UpcomingRace`, `CompletedSessionSummary`, `TrainingIntervention`, `RawContext.planned_intent`)
- [ ] `src/supabase/mapping/invertDbSessionType.ts` : inversion partielle non ambiguë (`REST`, `BIKE_MAINTENANCE`, `RACE_PREP`), autres cas → `null` + warning
- [ ] `src/supabase/buildRawContext.ts` : lecture parallèle des repos + mapping + validation stricte du checkin courant. Aucune règle métier. `active_experiments = []` explicite.

### 5. Orchestration — calcul vs persistance

- [ ] `src/supabase/computeDailyFor.ts` : construit `RawContext` + appelle `buildDailyPlan`. **Zéro écriture.**
- [ ] `src/supabase/runDailyFor.ts` : appelle `computeDailyFor`, invoque la RPC `persist_daily_run` (upsert health flag + insert decision atomiques).

### 6. Mapping écriture

- [ ] `src/supabase/mapping/dailyPlanToDecisionRow.ts` : mapping déterministe `DailyPlan → decisions` row (colonnes dénormalisées + JSONB source de vérité + `active_mode`).

### 7. CLI M2

- [ ] `npm run compute:daily -- --date=YYYY-MM-DD` : appelle `computeDailyFor`, affiche le `DailyPlan` JSON, aucune écriture.
- [ ] `npm run run:daily -- --date=YYYY-MM-DD` : appelle `runDailyFor`, affiche le `DailyPlan` + IDs des rows insérées.

### 8. Tests M2

- [ ] M2.A (unitaires purs) — voir `10_TEST_PLAN.md` §M2.A (7 sous-tests dont A.6 inversion partielle et A.2 rejet checkin incomplet)
- [ ] M2.B (intégration Supabase CLI local) — 5 sous-tests dont B.5 rejet checkin incomplet
- [ ] M2.C (cycle A1→A5) — 4 sous-tests dont C.4 idempotence garantie par contrainte DB
- [ ] M2.D (équivalence fixture ↔ Supabase) — tous les scénarios CLI M1 reproduits en SQL
- [ ] 75/75 tests M1 toujours verts (moteur strictement non modifié)

### 9. Validation M2

- [ ] Audit DDL réalisé et tracé
- [ ] Toutes les migrations appliquées sur la DB de dev Louis
- [ ] Tests M2 A/B/C/D verts
- [ ] Cycle A1→A5 explicitement prouvé
- [ ] Idempotence health flag garantie côté PostgreSQL (M2.C.4)
- [ ] Équivalence fixture ↔ Supabase prouvée
- [ ] Rejet checkin incomplet démontré (M2.B.5)
- [ ] Aucune modification de `src/{types,engine,rules,domains,mapping}`
- [ ] Aucun secret Supabase commité dans le repo
- [ ] Review Louis
- [ ] Update `00_PROJECT_STATUS.md` avec M2 DONE
- [ ] Décision Go/No-Go M3

---

## P1 — Après M2

### Runtime `ActiveExperiment` (T9)
- Concept `ActiveExperiment` runtime
- Support de l'experiment `sleep-liquids-cutoff-2026-08`
- Tests T9.1 et T9.2 passent
- Table `active_experiments` en base

### Enrichissement des domaines (couche C)
- Domaine Mental (basique)
- Domaine Nutrition (basique)
- Domaine Contexte pro (basique)
- Domaine Analyse (quasi-passif)

### M3 — API HTTP
- Edge Function Supabase exposant `runDailyFor` en HTTP
- Endpoint check-in (POST daily_checkin + trigger recompute)
- Endpoint récupération de la décision courante du jour
- Authentification JWT athlète (RLS active)

### `athlete_state` recalculé (si UI en a besoin)
- Trigger ou fonction serveur recalculant `athlete_state` après chaque checkin
- Non requis par le moteur (qui utilise les dimensions à la volée)

---

## P2 — Enrichissements ultérieurs
- LLM couche E pour rédaction contextuelle
- Planificateur hebdomadaire (`planned_sessions` généré automatiquement)
- Debrief course post-mortem structuré
- Intégration Zwift (FTP + puissance)
- Intégration Garmin (FC + sommeil détaillé)
- Interface app mobile complète (M4+)
- Table `learned_patterns` en base (couche D)
- Premiers patterns confirmés après données longitudinales
- Domaine 7 Analyse enrichi (patterns émergents)
- Éventuel `supersedes_decision_id` / `revision` / `is_current` sur `decisions`

---

## Hors périmètre (canonique)
- Suivi setup / mécanique vélo → Louis gère en autonomie
- Sponsoring / management de carrière
- Multi-athlètes
- Business / SaaS
- Analyse vidéo automatique
- Prédictions précises de temps de course
- Coach mental "profond" avec analyse émotionnelle complexe
- Coach nutrition avec tracking exhaustif

Voir `01_PRODUCT_REQUIREMENTS.md` §Hors périmètre.
