# 12 — Backlog

## Statut actuel

**Phase** : M2 — Connexion Supabase read/write locale : **DONE (local)**, voir `docs/11_DECISION_LOG.md` (2026-08-16 — clôture). Déploiement remote non effectué — review Louis puis `supabase migration repair` + premier `db push` restent à faire séparément.
**Prochain milestone** : review Louis M2 → décision Go/No-Go M3

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

### 0. Audit préalable (RÉALISÉ 2026-08-14 via MCP Supabase)

- [x] Auditer le DDL réel des tables et enums touchés par M2.
- [x] Clé d'idempotence `health_flags` : **`(athlete_id, flag_type)`** — colonne réelle `flag_type`, pas `type` ; pas de `location_code`.
- [x] `completed_sessions.main_content` : JSONB libre sans convention canonique. **`M2_004` REQUIRED**.
- [x] `decisions.confidence` réel : `numeric(3,2)` — incompatible avec enum qualitatif M1. Résolution : enum PostgreSQL `confidence_level` + nouvelle colonne, intégré dans `M2_002`.
- [x] `decisions.overridden_by_user` réel : `NOT NULL DEFAULT false` — reste `false` en M2, pas `NULL`.
- [x] DB distante sans historique de migrations Supabase → baseline via `db dump --linked --schema public`, read-only stricte.
- [x] Audit + décisions tracés dans `11_DECISION_LOG.md` (entrées 2026-08-14).

### 1. Infra tests d'intégration + baseline

- [x] Supabase CLI local installé et opérationnel
- [x] Baseline V0.2 capturée : `supabase/migrations/20260814095000_baseline_v0_2.sql` (un seul commit dans son historique — jamais réédité, jamais poussé).
- [x] Structure `supabase/migrations/M2_*.sql` versionnée (tous timestamps strictement postérieurs à celui de la baseline)
- [x] Fixtures déterministes avant chaque suite — remplace le `supabase/seed.sql` initialement envisagé : chaque suite d'intégration crée/nettoie son propre athlète scratch via `tests/supabase/testDb.ts` (fixtures TypeScript programmatiques), et `supabase db reset --local --no-seed` repart d'un état DB vide avant chaque campagne complète. Choix équivalent, meilleure isolation entre tests.
- [ ] `.env.example` — non créé (aucun n'existait avant M2 ; les noms de variables `SUPABASE_URL`/`SUPABASE_SECRET_KEY`/`SUPABASE_SERVICE_ROLE_KEY` sont documentés dans `client.ts` et `docs/06_ARCHITECTURE.md`). Reste à créer si un futur onboarding développeur en a besoin — non bloquant pour M2.
- [x] Aucun `db push`, aucun `migration repair`, aucune modification remote pendant tout le développement local

### 2. Migrations DB additives (non-destructives) — ordre canonique

Application locale dans cet ordre après la baseline V0.2 (`20260814095000_baseline_v0_2.sql`) :

- [x] `M2_001_daily_checkins_pain_criteria.sql` : `pain_traumatic`, `pain_function_loss`, `pain_getting_worse` en `boolean NULL` **sans default** (NULL = inconnu sur legacy)
- [x] `M2_002_decisions_daily_plan.sql` : `daily_plan JSONB NULL` + `active_mode training_mode NULL` + création enum PostgreSQL `confidence_level ('LOW','MEDIUM','HIGH')` + `confidence_level confidence_level NULL`. Colonne legacy `confidence numeric(3,2)` **conservée intacte**, non touchée. Aucune valeur par défaut fabriquée sur legacy.
- [x] `M2_003_planned_sessions_intervention.sql` : `intervention JSONB NULL` + `planned_intent TEXT NULL`
- [x] `M2_004_completed_sessions_intervention.sql` (**REQUIRED** — audit 2026-08-14) : `intervention JSONB NULL`. `main_content` reste disponible pour d'autres usages libres, mais la `TrainingIntervention` riche vit dans `intervention` uniquement.
- [x] `M2_005_health_flags_unique_open.sql` : index unique partiel sur `health_flags` couvrant **`(athlete_id, flag_type)`** filtré sur `status IN ('active','monitoring')`. Autorise un nouveau flag après résolution.
- [x] `M2_006_persist_daily_run_rpc.sql` : fonction PostgreSQL `persist_daily_run` — deux écritures dans un seul appel (transaction unique implicite, pas de `COMMIT`/`ROLLBACK` explicite dans le corps). Contrat de sécurité : `SECURITY INVOKER`, aucune exposition à `PUBLIC`/`anon`/`authenticated`, `EXECUTE` accordé uniquement au rôle serveur utilisé par M2 (`service_role` ou équivalent). Jamais appelable directement depuis une future UI cliente sans nouvelle décision architecte. Aucune logique de coaching côté SQL. `overridden_by_user` prend son default DB (`false`).

Tous les fichiers de migration M2 portent des timestamps de nom strictement postérieurs à celui de la baseline.

### 3. DAL — repositories `src/supabase/repositories/`

- [x] `client.ts` : construction du client Supabase depuis env (`SUPABASE_SECRET_KEY` préférée, fallback `SUPABASE_SERVICE_ROLE_KEY` legacy), injecté par argument
- [x] `dailyCheckinsRepo` : `getCheckinFor` — l'adapter downstream (`dailyCheckinRow.ts`) rejette explicitement un checkin courant avec un des 3 critères douleur (ou tout autre champ scalaire requis par M1) à `NULL`
- [x] `trainingBlocksRepo` : `getCurrentTrainingModeRaw` — volontairement minimal (voir note ci-dessous)
- [x] `plannedSessionsRepo` : `getPlannedSessionFor`
- [x] `raceCalendarRepo` : `getRacesInWindow`
- [x] `completedSessionsRepo` : `getRecentSessions`
- [x] `healthFlagsRepo` : `getOpenHealthFlags` (`status IN ('active','monitoring')`, équivalent à `!= 'resolved'`)
- [x] `athleteCountsRepo` : `getTotalCheckinsCount`/`getTotalCompletedSessionsCount` (pour `RawContext.n_total_*`, requis par le type M1 mais non utilisés en décision)
- [x] `persistDailyRun.ts` : wrapper typé de la RPC `persist_daily_run`, validation runtime du résultat — pas de `decisionsRepo.insertDecision` séparé, l'insert `decisions` vit exclusivement dans la RPC atomique, jamais dupliqué côté TypeScript

**Volontairement non créés en M2** (vérifié par grep exhaustif sur `src/{engine,rules,domains}` : aucune règle M1 ne les consomme) :
- ❌ `athletesRepo` (`getAthleteById`) — `athleteId` toujours fourni en paramètre par l'appelant, jamais résolu depuis la DB
- ❌ `athleteBaselinesRepo` (le moteur M1 ne consomme aucune baseline)
- ❌ `activeExperimentsRepo` (pas de runtime M2, table inexistante — `RawContext.active_experiments = []` explicite)
- ❌ `weeklyAvailabilityRepo` (`RawContext.availability`/`.life_constraints` non lus par M1)
- ❌ `trainingBlocksRepo.getCurrentBlock` complet (`TrainingBlockRef`/`RawContext.current_block` non lus par M1 — seule la colonne `mode` est nécessaire, servie par `getCurrentTrainingModeRaw`)
- ❌ `decisionsRepo` de lecture de la "current decision" — aucun code M2 actuel n'en a besoin (voir §9 Validation M2)

### 4. Adapter — construction du `RawContext`

- [x] `src/supabase/mapping/` : mappings SQL row → types domaine (`DailyCheckin`, `HealthFlag`, `UpcomingRace`, `CompletedSessionSummary`, `TrainingIntervention`, `RawContext.planned_intent`, `TrainingMode`)
- [x] `src/supabase/mapping/invertDbSessionType.ts` : inversion partielle non ambiguë (`REST`, `BIKE_MAINTENANCE`, `RACE_PREP`), autres cas → `null` + warning
- [x] `src/supabase/buildRawContext.ts` : lecture des repos + mapping + validation stricte du checkin courant. Aucune règle métier. `active_experiments = []` explicite. Warnings de reconstruction (planned_session ambigu, race_format NULL) surfacés dans `{ rawContext, warnings }` plutôt que perdus silencieusement.

### 5. Orchestration — calcul vs persistance

- [x] `src/supabase/computeDailyFor.ts` : construit `RawContext` + appelle `buildDailyPlan`. **Zéro écriture** — prouvé par test d'intégration (comptages avant/après) et par audit statique (aucun `.insert`/`.update`/`.delete`/`.upsert`, aucun import write-path).
- [x] `src/supabase/runDailyFor.ts` : appelle `computeDailyFor` exactement une fois, invoque `persistDailyRun`/RPC `persist_daily_run` exactement une fois (upsert health flag + insert decision atomiques, un seul appel `client.rpc`).

### 6. Mapping écriture

- [x] `src/supabase/mapping/dailyPlanToDecisionRow.ts` : mapping déterministe `DailyPlan → decisions` row. Renseigne : colonnes dénormalisées (`final_session`, `planned_session_before`, `reason`, `do_not_do`, `override_reason`, `engine_version`) + JSONB source de vérité (`daily_plan`) + `active_mode` + `confidence_level` (enum obligatoire). Ne touche pas à `confidence` numeric legacy (reste `NULL`), ne touche pas à `overridden_by_user` (default DB `false`). `stop_conditions` reste `NULL`.
- [x] `src/supabase/mapping/healthFlagToCreatePayload.ts` : mapping déterministe `HealthFlagToCreate → p_health_flag` payload RPC (`type→flag_type`, `reason→description`, date du run→`flag_date`). `status` jamais envoyé explicitement (DEFAULT DB `active`).
- [x] `src/supabase/persistDailyRun.ts` : wrapper typé de `persist_daily_run`, validation runtime stricte du résultat (`decision_id`/`health_flag_id`), aucun cast aveugle.

### 7. CLI — reporté post-M2 (P1/M3, non requis pour M2 DONE local)

- [ ] `npm run compute:daily -- --date=YYYY-MM-DD` : appelle `computeDailyFor`, affiche le `DailyPlan` JSON, aucune écriture. **Reporté** — hors scope des tâches d'implémentation M2 read/write path, candidat P1/M3.
- [ ] `npm run run:daily -- --date=YYYY-MM-DD` : appelle `runDailyFor`, affiche le `DailyPlan` + IDs des rows insérées. **Reporté**, même raison.

### 8. Tests M2

- [x] M2.A (unitaires purs) — voir `10_TEST_PLAN.md` §M2.A (A.1 à A.7 couverts, plus tests unitaires additionnels : `dailyCheckinRow`, `healthFlagRow`, `raceCalendarRow`, `completedSessionRow`, `trainingMode`, `healthFlagToCreatePayload`, `persistDailyRun`, orchestration `runDailyFor`)
- [x] M2.B (intégration Supabase CLI local) — B.1 à B.5 couverts (équivalence, RPC appelée, append-only, zero-write, rejet checkin incomplet)
- [x] M2.C (cycle A1→A5) — C.1 à C.4 couverts, prouvé par test longitudinal réel (vrai M1 + vraie DB + vrai `runDailyFor`, aucun mock sur la chaîne)
- [x] M2.D (équivalence fixture ↔ Supabase) — **19 scénarios canoniques** de `runExample.ts` reproduits en DB locale, égalité structurelle stricte avec le `DailyPlan` M1 réel (aucun scénario canonique trouvé irreprésentable)
- [x] 75/75 tests M1 toujours verts (moteur strictement non modifié) — vérifié isolément (`tests/*.test.ts`)

### 9. Validation M2

- [x] Audit DDL réalisé et tracé (2026-08-14)
- [x] Baseline V0.2 capturée et versionnée (`supabase/migrations/20260814095000_baseline_v0_2.sql`), fichier read-only strict — un seul commit dans son historique
- [x] Toutes les migrations M2 appliquées avec succès sur l'instance Supabase locale (ordre : baseline → `M2_001` → `M2_002` → `M2_003` → `M2_004` → `M2_005` → `M2_006`), aucune `M2_007`
- [x] Tests M2 A/B/C/D verts
- [x] Cycle A1→A5 explicitement prouvé (avec la clé réelle `(athlete_id, flag_type)`), y compris résolution du flag → A5 disparaît, et A1 répété → idempotence sans doublon
- [x] Idempotence health flag garantie côté PostgreSQL (M2.C.4)
- [x] Équivalence fixture ↔ Supabase prouvée — 19 scénarios canoniques
- [x] Rejet checkin incomplet démontré (M2.B.5)
- [x] `confidence_level` correctement écrit pour toute décision M2 ; `confidence` legacy reste `NULL` (vérifié par requête directe en test d'intégration)
- [x] `overridden_by_user` conserve son default DB (`false`) pour toutes les rows M2
- [x] RPC `persist_daily_run` : `SECURITY INVOKER` vérifié, `EXECUTE` limité au rôle serveur M2 (`service_role`), aucune exposition à `PUBLIC`/`anon`/`authenticated`
- [x] Aucune modification de `src/{types,engine,rules,domains,mapping}` — `git diff --stat` vide entre le commit M1 (`eab2072`) et l'état courant
- [x] Aucun secret Supabase commité dans le repo (`git grep "sb_secret_"` vide ; `git grep "service_role"` = noms de rôle/grants/prose uniquement)
- [ ] Review Louis (local + tests, avant tout push remote) — **reste à faire**
- [ ] **Uniquement après review Louis** : baseline V0.2 marquée comme déjà appliquée dans l'historique remote via `supabase migration repair` (une seule fois, hors développement) — **non fait**
- [ ] Premier `supabase db push` M2 vers la DB Louis — **non fait**
- [x] Update `00_PROJECT_STATUS.md` avec M2 DONE (local)
- [ ] Décision Go/No-Go M3 — décision de Louis, pas de Claude Code

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
