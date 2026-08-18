# 00 — Project Status

**Dernière mise à jour :** 18 août 2026
**Version canonique en cours :** V0.2
**Phase actuelle :** M3 — Edge Function HTTP exposant `runDailyFor`. **M3 = DONE local + remote.** `daily-run` est déployée et **ACTIVE** sur `uvolpldwwyvadlamulvr` (`verify_jwt: true`). Preuves remote : packaging `--use-api` de `head-coach-engine/dist/**` (canary jetable M3_005, supprimée), puis run authentifié réel complet (M3_006) — JWT utilisateur scratch → gateway → RLS → athlete propre → `ctx.supabaseAdmin` → `runDailyFor` → `persist_daily_run` → `200` avec `DailyPlan` réel, decision persistée et vérifiée en DB (id, athlete_id, `daily_plan` deep-equal, `confidence` legacy NULL, `confidence_level` renseigné), `422 no_checkin_for_date` avant checkin avec zéro écriture, réponse sans fuite de donnée sensible, tous les fixtures scratch remote supprimés et vérifiés absents. Voir `docs/11_DECISION_LOG.md` (2026-08-17 — M3_001/M3_002/M3_003 ; 2026-08-18 — M3_005/M3_006).

M2 — Connexion Supabase read/write : **DONE (local + remote)**, voir entrée précédente ci-dessous et `docs/11_DECISION_LOG.md` (2026-08-16 — clôture locale ; 2026-08-17 — déploiement remote).

## Où on en est réellement

### DONE

- **Onboarding athlète complet** (11 blocs), source de vérité pour `02_ATHLETE_PROFILE.md`.
- **DB Supabase V0.2 déployée et validée** : 12 tables, enums, RLS, triggers, seed data Louis.
- **Spec Head Coach Engine V0.2 consolidée** avec tous les principes canoniques (multidimensional state, décisions causales, non-double-counting, T-X default framework, support multi-jours, SAFETY limitée, soft constraints arbitrables, douleur non-SAFETY actionnable, séparation DB/interne).
- **M1 — Vertical Slice locale du Head Coach Engine** (`head-coach-engine/src/{types,engine,rules,domains,mapping}`) : pipeline complet `RawContext → DailyPlan`, 75/75 tests verts, build TypeScript strict clean, CLI de démonstration fonctionnelle. **Verdict architecte : APPROVED (2026-08-13). Frozen** sauf bug métier réel découvert ultérieurement.
- **M2 — Connexion Supabase read/write locale : DONE (local + remote)** : développement local terminé 2026-08-16 (baseline V0.2 + migrations `M2_001`→`M2_006`, DAL/adapter, `computeDailyFor` zéro écriture et `runDailyFor` RPC `persist_daily_run` atomique, cycle longitudinal A1→A5 prouvé, équivalence fixture ↔ Supabase sur 19 scénarios canoniques, 226/226 tests verts dont 75/75 M1). Déploiement remote effectué 2026-08-17 sur `uvolpldwwyvadlamulvr` : baseline `20260814095000` enregistrée comme applied sans rejouer son SQL, `M2_001`→`M2_006` déployées via `db push`, migration history LOCAL=REMOTE, `db push --dry-run` = "Remote database is up to date", post-deploy audit PASS, données existantes préservées (`athletes`, `goals`, `training_blocks`, `race_calendar`, `athlete_baselines`, `weekly_availability` — comptages identiques avant/après). Voir `docs/11_DECISION_LOG.md` et `docs/12_BACKLOG.md`.
- **M3 — API HTTP : DONE (local + remote)** : `supabase/functions/daily-run` — `Authorization: Bearer <JWT>` → `@supabase/server@1.4.1` (`withSupabase({auth:"user"})`) → `ctx.supabase`/RLS → athlete propre → `ctx.supabaseAdmin` → `runDailyFor(admin, athlete.id, date)` (import du JS compilé `head-coach-engine/dist/supabase/runDailyFor.js`, jamais la source `.ts`) → réponse `{dailyPlan, decisionId, healthFlagId, warnings}` ou mapping d'erreur HTTP stable (422/500/403/400/405). Local : `npm test` 226/226 (dont 75/75 M1), `npm run test:edge` 9/9, `npm run test:m3:http` 26/26. Remote (`uvolpldwwyvadlamulvr`) : packaging `--use-api` prouvé (canary M3_005), `daily-run` déployée et ACTIVE, run authentifié réel complet prouvé (M3_006 — 401/422/200, persistance vérifiée, isolation RLS, aucune fuite, cleanup complet). Aucune migration, aucun changement M1/M2. Voir `docs/11_DECISION_LOG.md` (2026-08-17 — M3_001/M3_002/M3_003 ; 2026-08-18 — M3_005/M3_006).

### IN PROGRESS

- Aucun développement en cours. M3 déployé (local + remote).

### NOT STARTED

- M4 — première interface utilisable (Today screen / check-in).
- Enrichissements P1+ (runtime `ActiveExperiment`, domaines mental/nutrition/analyse, UI, LLM couche E, intégrations externes).

## Prochaines étapes (ordre)

1. ~~**Implémenter M2** (Claude Code) : audit DDL → migrations additives → DAL → adapter → `computeDailyFor` / `runDailyFor` → tests A/B/C/D.~~ **DONE (local), 2026-08-16.**
2. ~~**Review Louis M2 → déploiement remote séparé.**~~ **DONE, 2026-08-17.**
3. ~~**M3 — Edge Function locale** (`daily-run`) : portabilité Deno, boundary auth, branchement moteur.~~ **DONE (local), 2026-08-17 (M3_001/M3_002/M3_003).**
4. ~~**M3 remote** : canary de packaging `--use-api` (M3_005), déploiement réel de `daily-run` + run authentifié complet prouvé (M3_006).~~ **DONE (remote), 2026-08-18.**
5. **M4 — première interface utilisable** (Today screen / check-in).
6. **Enrichissement des domaines de coaching**, runtime `ActiveExperiment`, LLM couche E, intégrations externes — après M4, ordre à trancher au moment venu.

## Prochain milestone

**M4 — première interface utilisable**

Statut M2 : **DONE (local + remote), 2026-08-17.**
Statut M3 : **DONE (local + remote), 2026-08-18.**

Critères de sortie M2 :
- [x] Audit initial du DDL réel (tables + enums touchés par M2) réalisé et tracé (2026-08-14).
- [x] Baseline V0.2 capturée via `supabase db dump --linked --schema public` en `supabase/migrations/20260814095000_baseline_v0_2.sql` (timestamp réel de capture), fichier read-only strict.
- [x] Migrations DB `M2_001`, `M2_002` (incluant enum `confidence_level`), `M2_003`, `M2_004` (REQUIRED), `M2_005`, `M2_006` appliquées sur l'instance Supabase locale, dans l'ordre canonique après la baseline. Tous timestamps de nom strictement postérieurs à celui de la baseline.
- [x] Index unique partiel PostgreSQL sur `health_flags` empêchant deux flags ouverts `(athlete_id, flag_type)` simultanés (colonne réelle `flag_type` confirmée par audit), tout en autorisant un nouveau flag après résolution.
- [x] Fonction PostgreSQL `persist_daily_run` (via RPC) : deux écritures dans un seul appel (transaction unique implicite), `SECURITY INVOKER`, `EXECUTE` réservé au rôle serveur M2, jamais exposée à `PUBLIC`/`anon`/`authenticated`. Aucune logique de coaching côté SQL.
- [x] DAL minimal (repositories + adapter) implémenté dans `src/supabase/`.
- [x] Séparation calcul (`computeDailyFor`) / persistance (`runDailyFor`).
- [x] `buildRawContext` **rejette** un checkin courant M2 dont un des trois critères douleur (`pain_traumatic`, `pain_function_loss`, `pain_getting_worse`) est `NULL` — jamais de conversion silencieuse en `false`.
- [x] Inversion `DbSessionType → TrainingIntervention` limitée aux mappings mathématiquement non ambigus (`REST`, `BIKE_MAINTENANCE`, `RACE_PREP`). Autres cas legacy → `planned_session = null` + warning.
- [x] `decisions` append-only (aucune contrainte d'unicité, aucun upsert destructif). `confidence_level` obligatoire via DAL pour toute nouvelle décision M2 ; `confidence` numeric legacy reste `NULL`. `overridden_by_user` conserve son default DB `false`.
- [x] 75/75 tests M1 toujours verts (moteur strictement non modifié).
- [x] Tests M2 A/B/C/D verts (voir `docs/10_TEST_PLAN.md` §M2).
- [x] Cycle A1/A2/A3/A4 → A5 (jour N → jour N+1) explicitement prouvé par test d'intégration, y compris résolution du flag et A1 répétée sans doublon.
- [x] Équivalence fixture ↔ Supabase prouvée pour tous les scénarios M1 canoniques (19 scénarios).
- [x] Aucun `db push`, aucun `migration repair`, aucune modification remote pendant tout le développement local.
- [x] Aucune modification de `src/{types,engine,rules,domains,mapping}`.
- [x] Update `00_PROJECT_STATUS.md` avec M2 DONE (local + remote) — ce document, 2026-08-17.
- [x] Revue Louis (local + tests, avant tout push remote).
- [x] **Uniquement après review** : baseline V0.2 marquée comme déjà appliquée dans l'historique remote via `supabase migration repair` (une seule fois, hors développement), puis premier `supabase db push` M2 vers la DB Louis — effectué 2026-08-17 sur `uvolpldwwyvadlamulvr`. Post-deploy audit PASS (M2_001→M2_006, RPC `persist_daily_run` permissions, données existantes préservées).
- [x] Commit / push des sources M2 dans le repo (aucun secret).
- [x] Décision Go/No-Go M3 (Louis) : Go, 2026-08-17.

Critères de sortie M3 (local, DONE) :
- [x] M3_001 — frontière de build Deno prouvée : import source `.ts` échoue (attendu), import `dist/*.js` compilé fonctionne, aucune duplication du moteur, `dist/` reste gitignored.
- [x] M3_002 — boundary d'authentification prouvée : JWT utilisateur → `ctx.supabase`/RLS → athlete propre uniquement (jamais `body.athlete_id`), isolation cross-user prouvée, zéro écriture métier.
- [x] M3_003 — moteur réellement branché : `ctx.supabaseAdmin` → `runDailyFor(admin, athlete.id, date)` (athlete.id exclusivement RLS-dérivé), réponse `{dailyPlan, decisionId, healthFlagId, warnings}`, mapping d'erreurs typées M1/M2 → HTTP stable, aucune fuite de donnée sensible.
- [x] `npm test` = 226/226 (dont 75/75 M1), `npm run test:edge` = 9/9, `npm run test:m3:http` = 26/26 (répété avec succès, cleanup vérifié).
- [x] Aucune migration DB, aucun changement `head-coach-engine/src/{types,engine,rules,domains,mapping,supabase}`.
- [x] Commit / push M3_001, M3_002, M3_003 dans le repo (aucun secret).

Critères de sortie M3 (remote, DONE 2026-08-18) :
- [x] Canary de packaging `supabase functions deploy --use-api` validée sur `uvolpldwwyvadlamulvr` (M3_005) : graphe transitif `dist/**` uploadé automatiquement, module chargé remote (`{"ok":true,"runDailyForLoaded":true}`), canary supprimée.
- [x] Déploiement remote de `daily-run` (M3_006), `verify_jwt: true`, statut `ACTIVE`.
- [x] Run authentifié réel complet prouvé : 401 (sans auth / JWT invalide), 422 `no_checkin_for_date` avec zéro écriture, 200 avec `DailyPlan` réel après checkin neutre, decision persistée et vérifiée (id/athlete_id/`daily_plan` deep-equal/`confidence` NULL/`confidence_level` renseigné), réponse sans fuite, isolation RLS via athlete propre.
- [x] Tous les fixtures scratch remote (user, athlete, training_block, checkin) supprimés et vérifiés absents ; aucune donnée réelle de Louis touchée.
- [x] Aucune valeur de clé/secret affichée, loguée ou commitée ; fichiers temporaires supprimés.

## Règle

**Ne pas marquer une étape comme `DONE` avant qu'elle existe réellement dans Git.**
