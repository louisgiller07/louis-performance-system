# 12 — Backlog

## Statut actuel

**Phase** : **M5 COMPLETE (2026-08-27).** M4 reste COMPLETE (2026-08-19) — client web de production HTTPS. M5_006B (cycle de vie de l'evidence + détecteur sommeil-énergie même-jour) **CLOSED (local + remote), 2026-08-26**. M5_006C (détecteur de persistance de la douleur) **CLOSED (local uniquement — zéro migration, aucun déploiement), 2026-08-27**. M5_006D (agrégation déterministe d'evidence effective) **CLOSED (local uniquement — zéro migration, aucun déploiement), 2026-08-27**. M5_007 (insights déterministes + ledger de revue humaine) **CLOSED (local + remote), 2026-08-27** — schéma/RPC déployés sur `uvolpldwwyvadlamulvr` ; moteur d'insight implémenté/testé localement, non invoqué automatiquement en production — voir `docs/11_DECISION_LOG.md` pour l'historique complet M5_001→M5_007. M3 : **DONE (local + remote)**. M2 : **DONE (local + remote)**. Aucun pattern appris n'influence `daily-run` en M5 ; aucun peuplement automatique de production ; `accepted_as_insight` n'active jamais le coaching.
**Prochain milestone** : **V0.3_001B — Backfill + durcissement complet (remote).** V0.3_001A **CLOSED LOCALLY, 2026-08-28** (voir ci-dessous et `docs/11_DECISION_LOG.md`). V0.3_001C reste **NOT STARTED**.

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
- [x] Review Louis (local + tests, avant tout push remote)
- [x] **Uniquement après review Louis** : baseline V0.2 marquée comme déjà appliquée dans l'historique remote via `supabase migration repair` (une seule fois, hors développement) — fait 2026-08-17
- [x] Premier `supabase db push` M2 vers la DB Louis — fait 2026-08-17 sur `uvolpldwwyvadlamulvr` (`M2_001`→`M2_006`), post-deploy audit PASS, données existantes préservées
- [x] Update `00_PROJECT_STATUS.md` avec M2 DONE (local + remote)
- [x] Décision Go/No-Go M3 — Go (Louis), 2026-08-17

---

## M3 — Edge Function HTTP (`daily-run`)

### M3_001 — Portabilité Deno / frontière de build — DONE (local, committé 2026-08-17)

- [x] Import direct de la source TS M1/M2 dans Deno → échec reproductible et attendu (imports `.js` résolus littéralement par Deno).
- [x] Import du JS compilé (`head-coach-engine/dist/supabase/*.js`, produit par `npm run build`) → fonctionne dans `supabase functions serve` local.
- [x] Aucune duplication du moteur, aucune copie dans `supabase/functions/`.
- [x] `dist/` reste gitignored, non versionné.
- [x] `head-coach-engine/src/{types,engine,rules,domains,mapping,supabase}` non modifiés.
- [ ] **Packaging remote `--use-api` : PAS encore prouvé.** Aucun déploiement remote n'a eu lieu — voir item ouvert ci-dessous.

### M3_002 — Boundary d'authentification — DONE (local, committé 2026-08-17)

- [x] `Authorization: Bearer <JWT>` → `@supabase/server@1.4.1` (`withSupabase({auth:"user"})`) → `ctx.supabase`/RLS → athlete propre uniquement.
- [x] `athlete_id`/`athleteId`/`user_id`/`userId` dans le body → `400 invalid_request`, jamais utilisé.
- [x] Aucun athlete pour l'utilisateur → `403 no_athlete_for_user`.
- [x] Isolation RLS cross-user prouvée (JWT A ne voit jamais l'athlete B).
- [x] Zéro écriture métier.
- [x] Méthode ≠ POST → `405` + `Allow: POST`.

### M3_003 — Branchement réel du moteur — DONE (local, committé 2026-08-17)

- [x] `ctx.supabaseAdmin` → `runDailyFor(admin, athlete.id, date)` — `athlete.id` exclusivement RLS-dérivé (M3_002), jamais du client.
- [x] Réponse `{dailyPlan, decisionId, healthFlagId, warnings}` — mapping exact depuis `RunDailyForResult` (`persistence.decision_id`/`health_flag_id`, snake_case).
- [x] Mapping d'erreurs typées M1/M2 → HTTP stable (4×422 spécifiques, 500 générique pour le reste), aucune fuite (message brut/SQL/stack/JWT/secret).
- [x] Run neutre réel, SAFETY A1 réel, appels répétés (append-only + idempotence health flag), isolation cross-user, injection `athlete_id`, audit d'écriture — tous prouvés avec vrai moteur/vraie DB/vraie RPC, aucun mock sur le chemin critique.
- [x] `npm test` = 226/226 (dont 75/75 M1), `npm run test:edge` = 9/9, `npm run test:m3:http` = 26/26 (répété deux fois, cleanup vérifié).
- [x] `npx tsc --noEmit -p tsconfig.json` = 0 erreur.
- [x] Aucune migration DB, aucun changement M1/M2.

### M3_005 — Canary de packaging remote `--use-api` — DONE (2026-08-18)

- [x] `supabase functions deploy daily-run-canary --use-api --no-verify-jwt --project-ref uvolpldwwyvadlamulvr` : le CLI embarque automatiquement tout le graphe transitif `head-coach-engine/dist/**` (gitignored, hors `supabase/functions/`), sans copie manuelle.
- [x] Invocation remote → `200`, `{"ok":true,"runDailyForLoaded":true}` — module chargé réellement par le runtime Deno distant.
- [x] Canary n'appelait jamais `runDailyFor`, aucun accès DB, aucun secret.
- [x] Canary supprimée remote (confirmé `404`) et localement, jamais commitée.

### M3_006 — Déploiement remote réel de `daily-run` — DONE (2026-08-18)

- [x] `daily-run` déployée (`--use-api`, `verify_jwt` par défaut, PAS de `--no-verify-jwt`) sur `uvolpldwwyvadlamulvr` — statut `ACTIVE`, `verify_jwt: true`.
- [x] Sans auth / JWT invalide → `401` (jamais atteint le handler).
- [x] User scratch réel créé, JWT réel obtenu, résolution athlete via RLS confirmée.
- [x] Avant checkin : `422 no_checkin_for_date`, zéro `decisions`/`health_flags` créés.
- [x] Après checkin neutre réel : `200`, `dailyPlan` réel, `decisionId` UUID, `healthFlagId=null`.
- [x] DB vérifiée : exactement 1 decision, `id`/`athlete_id`/`daily_plan` (deep-equal) corrects, `confidence` legacy `NULL`, `confidence_level` renseigné, `health_flags=0`.
- [x] Réponse sans fuite (`rawContext`/`athleteId`/`userId`/JWT/clés absents).
- [x] Un seul run de succès effectué (pas de doublon inutile sur le remote).
- [x] Toutes les fixtures scratch (user, athlete, training_block, checkin) supprimées et vérifiées absentes ; aucune donnée réelle de Louis touchée.
- [x] Aucune valeur de clé affichée/loguée/commitée ; fichiers temporaires supprimés.
- [x] `daily-run` conservée déployée (tous les tests passés).

**M3 est fermé : local + remote tous deux DONE.**

---

## M4 — Interface web mobile (Today / Check-in / DailyPlan / Historique) — COMPLETE (2026-08-19)

### M4_001 — Bootstrap web + Supabase Auth — DONE

- [x] `web/` : React 19, Vite, TypeScript strict, Tailwind CSS v4, React Router 7, Vitest/RTL.
- [x] `AuthContext`/`RequireAuth`/`LoginPage` (email/password) ; résolution de l'athlete via RLS (`athletes_own_data`) uniquement, jamais un pick arbitraire.

### M4_002 — `/today` skeleton + date locale — DONE

- [x] `todayLocal()` sans biais UTC (`Intl.DateTimeFormat` sur les composantes Y/M/D), jamais `toISOString().slice(0,10)`.
- [x] `/today` : en-tête, carte date, sections Check-in / DailyPlan.

### M4_003 — Daily Check-in + persistance RLS — DONE

- [x] CRUD `daily_checkins` via le client Supabase RLS-scopé de l'utilisateur, `upsert` sur la contrainte réelle `unique_checkin_per_day`.
- [x] Champs santé/douleur en tri-état (`boolean | null`) — une question non répondue ne devient jamais silencieusement `false`.
- [x] Bugfix : bascule douleur `true→false` normalise immédiatement les champs conditionnels (évitait un échec de sauvegarde silencieux).

### M4_004 — Génération `daily-run` depuis `/today` — DONE

- [x] `runDailyRun()` via `supabase.functions.invoke("daily-run", {body:{date}})`, mapping d'erreurs structuré (`dailyRunErrors.ts`).
- [x] Garde anti double-soumission (ref synchrone), invalidation du plan affiché par révision de check-in, garde anti-réponse-obsolète en vol.
- [x] Validation runtime du contrat de réponse (`isValidDailyRunResponse`).

### M4_005 — Rendu production du DailyPlan — DONE

- [x] `DailyPlanView` : toutes les sections réelles (training, technique, mental, récupération, sommeil, nutrition, protection, monitoring), labels français par mapping (jamais de valeur métier modifiée).
- [x] Aucune règle A1-A5 côté frontend — signal santé strictement dérivé de données serveur explicites.

### M4_006 — Historique en lecture seule + sécurité append-only — DONE

- [x] `/history`, `/history/:decisionId` : lecture seule via le client RLS de l'utilisateur, aucun recalcul, aucune dépendance à `daily-run`.
- [x] Dégradation propre sur une ligne au shape legacy (`isValidDailyPlan` réutilisé), jamais de champ inventé.
- [x] **Correctif de sécurité** : policy `decisions_own_data` (`FOR ALL`, vulnérable) remplacée par `decisions_own_select` (`SELECT`-only pour `authenticated`) ; privilèges d'écriture directs révoqués pour `authenticated`/`anon`. `persist_daily_run`/`service_role` reste l'unique chemin d'écriture. Prouvé empiriquement en local puis sur `uvolpldwwyvadlamulvr` (`supabase/migrations/20260819200000_decisions_append_only_security.sql`, `supabase/preflight/decisions_append_only_security_check.sql`).

### M4_007 — Mobile polish + déploiement production HTTPS — DONE (2026-08-19)

- [x] Cibles tactiles ≥44px, `text-base` sur tous les champs de saisie (évite le zoom automatique iOS Safari au focus).
- [x] `web/vercel.json` — rewrite SPA catch-all pour les deep-links `/today`, `/history`, `/history/:id`.
- [x] Projet Vercel dédié `louis-performance-system`, scope `louis-performance-system` — scope `graviacoach` jamais touché.
- [x] Variables d'environnement browser-safe uniquement (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) déployées Preview + Production.
- [x] Déploiement production : `https://louis-performance-system.vercel.app`.
- [x] Supabase Auth Site URL mise à jour sur `uvolpldwwyvadlamulvr` (Louis, Dashboard).
- [x] Smoke authentifié réel sur téléphone : login, `/today`, check-in, `/history`, détail, refresh direct, logout/relogin — tous PASS.
- [x] `npm test` = 163/163, `npm run build` = PASS.

**M4 est fermé : COMPLETE, 2026-08-19.**

---

## V0.3_001 — Longitudinal Intelligence Runtime + Human Insight Review — V0.3_001A CLOSED LOCALLY (2026-08-28), V0.3_001B/C NOT STARTED

Objectif : rendre utilisable le pipeline M5 déjà construit (`evidence → agrégat → candidat d'insight → revue humaine`), sans jamais influencer `daily-run` ni activer automatiquement un pattern. Les briques M5 sous-jacentes existent déjà selon leur statut canonique propre (decision outcomes + RPC déployés depuis M5_001B/M5_004, ledger d'evidence déployé depuis M5_006A, cycle de vie + RPC/vues déployés depuis M5_006B, ledger de revue humaine + RPC/vues déployés depuis M5_007 ; M5_006D et le projecteur M5_007 restent une logique TypeScript pure, sans migration ni objet DB propre). Ce qui n'existe pas encore est décrit ci-dessous. Détail architectural complet : `docs/11_DECISION_LOG.md` (entrée de verrouillage d'architecture), `docs/06_ARCHITECTURE.md` §V0.3_001.

### V0.3_001A — Correction de runtime + orchestration (CLOSED LOCALLY, 2026-08-28 — aucun déploiement remote)

- [x] Précondition remote read-only : `pattern_evidence_identities` count = 0 pour `(recommendation_vs_actual_execution, 1.0.0)` — confirmée avant le changement de code, reconfirmée à la clôture via requête SQL directe
- [x] Constante de domaine `INSIGHT_AGGREGATION_RANGE = {fromDate: "1900-01-01", toDate: "9999-12-31"}` câblée dans la couche runtime (`longitudinal-engine/src/supabase/runtimeRanges.ts`, jamais dans `aggregateEffectivePatternEvidence.ts`)
- [x] `longitudinalProcessingDate` côté serveur, fuseau V1 fixe `Europe/Zurich`, séparé strictement de la plage d'agrégation
- [x] Correction identité `recommendation_vs_actual_execution` : `evaluationKey = evidenceKey = decision:<decisionId>` (evidence + no_evidence), retrait de cycle de vie sur `no_evidence` via `transition_pattern_evidence_lifecycle` existante (déployée depuis M5_006B) — `detector_rule_version` reste `1.0.0`
- [x] Orchestrateur de lot pour les 3 détecteurs existants (`runDetectors`, miroir de `outcomeOrchestrator.ts`)
- [x] Appelant réel pour `calculateAndPersistOutcomes`
- [x] Frontière serveur authentifiée (motif JWT→RLS→athlète propre→`service_role`, miroir de `daily-run`, `daily-run` lui-même non modifié)
- [x] `refresh-longitudinal` (écriture, idempotent) — implémenté et testé **localement uniquement**, aucun déploiement remote
- [x] `get-insights` (lecture, calcul de candidat côté serveur uniquement) — implémenté et testé **localement uniquement**, aucun déploiement remote

### V0.3_001B — Backfill + durcissement complet (NON EXÉCUTÉ)

- [ ] Preuve locale complète fraîche (stack locale, incluant le comportement corrigé du détecteur recommendation)
- [ ] Aperçu/rapport remote read-only (ce qu'un backfill toucherait)
- [ ] Reconfirmation des préconditions critiques remote (ne doit pas être la première vérification — déjà faite en 001A)
- [ ] Invocation remote historique explicitement approuvée (`refresh-longitudinal` réel, supervisé)
- [ ] Validation post-backfill read-only (comptages, provenance, cycle de vie)
- [ ] Preuve d'idempotence par une seconde invocation remote consécutive

### V0.3_001C — API de revue canonique + surface web Insights (NON IMPLÉMENTÉ)

- [ ] `submit-review`
- [ ] Validation complète du jeton de fraîcheur (7 dimensions : `detectorRuleId`/`detectorRuleVersion`/`insightKind`/`insightProjectorVersion`/`rangeFromDate`/`rangeToDate`/`sourceEvidenceRefs`)
- [ ] Gestion `stale_candidate` / `candidate_not_found`
- [ ] `candidate_snapshot` persisté = toujours généré par le serveur
- [ ] Page web Insights minimale (liste, résumé d'evidence, état de revue `unreviewed`/`reviewed_current`/`reviewed_stale`, actions `accepted_as_insight`/`dismissed`/`needs_more_evidence`, note optionnelle)
- [ ] Tests de bout en bout course/idempotence à travers l'API réelle

### Explicitement hors périmètre V0.3_001

Enrichissement des domaines Technique DH / Mental / Nutrition, planificateur hebdomadaire, runtime `ActiveExperiment`, Garmin/Zwift/Strava, LLM, activation de coaching par pattern appris, scheduler/cron, table de persistance de candidat, scores de confiance/signification, causalité.

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

### M3 — API HTTP additionnelle (au-delà de `daily-run`)
- `daily-run` (`runDailyFor` en HTTP, auth JWT/RLS) : **DONE (local + remote)** — voir section `M3 — Edge Function HTTP` ci-dessus.
- Endpoint check-in (POST daily_checkin + trigger recompute)
- Endpoint récupération de la décision courante du jour

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
