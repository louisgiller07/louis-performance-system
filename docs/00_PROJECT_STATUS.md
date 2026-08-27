# 00 — Project Status

**Dernière mise à jour :** 27 août 2026
**Version canonique en cours :** V0.2
**Phase actuelle :** **M5 EN COURS.** M4 reste COMPLETE (client web de production, `https://louis-performance-system.vercel.app`). M5 (longitudinal/pattern evidence) a franchi M5_001 à M5_006C — voir `docs/11_DECISION_LOG.md` pour le détail milestone par milestone. M5_006B (cycle de vie de l'evidence + détecteur sommeil-énergie même-jour) est **CLOSED**, déployé sur `uvolpldwwyvadlamulvr`. M5_006C (détecteur de persistance de la douleur) est **CLOSED** — implémenté et testé dans `longitudinal-engine` uniquement, aucune migration, aucun déploiement (il réutilise entièrement le schéma/RPC déjà déployés par M5_006A/M5_006B). Aucun peuplement automatique de production, aucun pattern appris n'influence `daily-run`. Prochain : **M5_006D — agrégation déterministe d'evidence.**

M3 — Edge Function HTTP exposant `runDailyFor` : **DONE (local + remote)**, `daily-run` déployée et **ACTIVE** sur `uvolpldwwyvadlamulvr` (`verify_jwt: true`). Voir `docs/11_DECISION_LOG.md` (2026-08-17 — M3_001/M3_002/M3_003 ; 2026-08-18 — M3_005/M3_006).

M2 — Connexion Supabase read/write : **DONE (local + remote)**, voir `docs/11_DECISION_LOG.md` (2026-08-16 — clôture locale ; 2026-08-17 — déploiement remote).

## Où on en est réellement

### DONE

- **Onboarding athlète complet** (11 blocs), source de vérité pour `02_ATHLETE_PROFILE.md`.
- **DB Supabase V0.2 déployée et validée** : 12 tables, enums, RLS, triggers, seed data Louis.
- **Spec Head Coach Engine V0.2 consolidée** avec tous les principes canoniques (multidimensional state, décisions causales, non-double-counting, T-X default framework, support multi-jours, SAFETY limitée, soft constraints arbitrables, douleur non-SAFETY actionnable, séparation DB/interne).
- **M1 — Vertical Slice locale du Head Coach Engine** (`head-coach-engine/src/{types,engine,rules,domains,mapping}`) : pipeline complet `RawContext → DailyPlan`, 75/75 tests verts, build TypeScript strict clean, CLI de démonstration fonctionnelle. **Verdict architecte : APPROVED (2026-08-13). Frozen** sauf bug métier réel découvert ultérieurement.
- **M2 — Connexion Supabase read/write locale : DONE (local + remote)** : développement local terminé 2026-08-16 (baseline V0.2 + migrations `M2_001`→`M2_006`, DAL/adapter, `computeDailyFor` zéro écriture et `runDailyFor` RPC `persist_daily_run` atomique, cycle longitudinal A1→A5 prouvé, équivalence fixture ↔ Supabase sur 19 scénarios canoniques, 226/226 tests verts dont 75/75 M1). Déploiement remote effectué 2026-08-17 sur `uvolpldwwyvadlamulvr` : baseline `20260814095000` enregistrée comme applied sans rejouer son SQL, `M2_001`→`M2_006` déployées via `db push`, migration history LOCAL=REMOTE, `db push --dry-run` = "Remote database is up to date", post-deploy audit PASS, données existantes préservées (`athletes`, `goals`, `training_blocks`, `race_calendar`, `athlete_baselines`, `weekly_availability` — comptages identiques avant/après). Voir `docs/11_DECISION_LOG.md` et `docs/12_BACKLOG.md`.
- **M3 — API HTTP : DONE (local + remote)** : `supabase/functions/daily-run` — `Authorization: Bearer <JWT>` → `@supabase/server@1.4.1` (`withSupabase({auth:"user"})`) → `ctx.supabase`/RLS → athlete propre → `ctx.supabaseAdmin` → `runDailyFor(admin, athlete.id, date)` (import du JS compilé `head-coach-engine/dist/supabase/runDailyFor.js`, jamais la source `.ts`) → réponse `{dailyPlan, decisionId, healthFlagId, warnings}` ou mapping d'erreur HTTP stable (422/500/403/400/405). Local : `npm test` 226/226 (dont 75/75 M1), `npm run test:edge` 9/9, `npm run test:m3:http` 26/26. Remote (`uvolpldwwyvadlamulvr`) : packaging `--use-api` prouvé (canary M3_005), `daily-run` déployée et ACTIVE, run authentifié réel complet prouvé (M3_006 — 401/422/200, persistance vérifiée, isolation RLS, aucune fuite, cleanup complet). Aucune migration, aucun changement M1/M2. Voir `docs/11_DECISION_LOG.md` (2026-08-17 — M3_001/M3_002/M3_003 ; 2026-08-18 — M3_005/M3_006).
- **M4 — première interface utilisable : COMPLETE (2026-08-19)** : client web `web/` (React 19 + Vite + TypeScript strict + Tailwind v4 + React Router 7), authentification Supabase (`AuthContext`/`RequireAuth`/`LoginPage`), `/today` (date locale, check-in, génération/rendu du `DailyPlan`), `/history` + `/history/:decisionId` (lecture seule des décisions persistées, dégradation propre sur ligne legacy), polish mobile (cibles tactiles, zoom iOS évité, navigation deux-onglets), déploiement production HTTPS sur Vercel (`https://louis-performance-system.vercel.app`, projet/scope dédiés `louis-performance-system`, jamais `graviacoach`). **Correctif de sécurité** : `public.decisions` rendue réellement append-only (policy `SELECT`-only pour `authenticated`, `REVOKE` des privilèges d'écriture directs, `persist_daily_run`/`service_role` reste l'unique chemin d'écriture). Smoke authentifié réel sur le téléphone de Louis (login, `/today`, check-in, `/history`, détail, refresh direct, logout/relogin) : **tous PASS**. Voir `docs/11_DECISION_LOG.md` (2026-08-19 — M4_006 sécurité, M4_007 déploiement) et `docs/12_BACKLOG.md` (section M4).

### IN PROGRESS

- Aucun développement en cours. M4 déployé et validé en production.

### NOT STARTED

- M5_006D (agrégation déterministe d'evidence, contrat d'entrée verrouillé sur `pattern_evidence_current_effective`), M5_007 (insights / revue humaine) — jalons gelés, non entamés.
- Enrichissements P1+ (runtime `ActiveExperiment`, domaines mental/nutrition/analyse, LLM couche E, intégrations externes).

## Prochaines étapes (ordre)

1. ~~**Implémenter M2** (Claude Code) : audit DDL → migrations additives → DAL → adapter → `computeDailyFor` / `runDailyFor` → tests A/B/C/D.~~ **DONE (local), 2026-08-16.**
2. ~~**Review Louis M2 → déploiement remote séparé.**~~ **DONE, 2026-08-17.**
3. ~~**M3 — Edge Function locale** (`daily-run`) : portabilité Deno, boundary auth, branchement moteur.~~ **DONE (local), 2026-08-17 (M3_001/M3_002/M3_003).**
4. ~~**M3 remote** : canary de packaging `--use-api` (M3_005), déploiement réel de `daily-run` + run authentifié complet prouvé (M3_006).~~ **DONE (remote), 2026-08-18.**
5. ~~**M4 — première interface utilisable** (Today screen / check-in, historique, déploiement production HTTPS).~~ **DONE, 2026-08-19.**
6. ~~**M5_001-M5_006B** — timeline longitudinal, calculateur d'outcomes, détecteurs recommandation-vs-exécution et sommeil-énergie, ledger d'evidence append-only + cycle de vie.~~ **M5_006B CLOSED, 2026-08-26.** Voir `docs/11_DECISION_LOG.md`.
7. ~~**M5_006C** — détecteur de persistance de la douleur.~~ **CLOSED, 2026-08-27** (implémentation locale uniquement, aucune migration). Voir `docs/11_DECISION_LOG.md`.
8. **M5_006D** — agrégation déterministe d'evidence (`pattern_evidence_current_effective`). Puis M5_007 (insights).

## Prochain milestone

**M5_006D — agrégation déterministe d'evidence** (non entamé).

Statut M2 : **DONE (local + remote), 2026-08-17.**
Statut M3 : **DONE (local + remote), 2026-08-18.**
Statut M4 : **COMPLETE, 2026-08-19.**
Statut M5 : **EN COURS** — M5_006B **CLOSED (local + remote), 2026-08-26** ; M5_006C **CLOSED (local uniquement, aucune migration), 2026-08-27**. Détail milestone par milestone dans `docs/11_DECISION_LOG.md`.

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

Critères de sortie M4 (COMPLETE, 2026-08-19) :
- [x] `web/` bootstrap (React 19, Vite, TypeScript strict, Tailwind v4, React Router 7, Vitest/RTL), authentification Supabase (`AuthContext`/`RequireAuth`/`LoginPage`, résolution athlete via RLS uniquement).
- [x] `/today` : date locale sans biais UTC, check-in quotidien (CRUD RLS-scopé, champs santé/douleur tri-state `boolean | null` jamais coercés en `false`), génération et rendu production du `DailyPlan` réel via `daily-run`.
- [x] `/history` + `/history/:decisionId` : lecture seule des décisions persistées (`decisions.daily_plan`), aucune recomputation, dégradation propre sur une ligne au shape legacy, aucun signal santé déduit côté frontend.
- [x] **Correctif de sécurité** : `decisions` rendue réellement append-only — policy `decisions_own_data` (`FOR ALL`) remplacée par `decisions_own_select` (`SELECT`-only pour `authenticated`), privilèges d'écriture directs révoqués (`authenticated`/`anon`), `persist_daily_run`/`service_role` reste l'unique chemin d'écriture. Prouvé empiriquement en local puis sur `uvolpldwwyvadlamulvr` (INSERT/UPDATE/DELETE directs → `permission denied`).
- [x] Polish mobile : cibles tactiles ≥44px, zoom automatique iOS évité (inputs ≥16px), navigation deux-onglets, aucune régression de hiérarchie produit.
- [x] Déploiement production HTTPS sur Vercel : projet/scope dédiés `louis-performance-system` (jamais `graviacoach`), rewrite SPA (`web/vercel.json`) pour les deep-links `/today`/`/history`/`/history/:id`, variables d'environnement browser-safe uniquement (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`).
- [x] Supabase Auth Site URL mise à jour sur `uvolpldwwyvadlamulvr` pour `https://louis-performance-system.vercel.app`.
- [x] Smoke authentifié réel sur le téléphone de Louis : login, `/today`, check-in, `/history`, détail, refresh direct, logout/relogin — tous PASS.
- [x] `npm test` = 163/163, `npm run build` = PASS.

## Règle

**Ne pas marquer une étape comme `DONE` avant qu'elle existe réellement dans Git.**
