# 00 — Project Status

**Dernière mise à jour :** 17 août 2026
**Version canonique en cours :** V0.2
**Phase actuelle :** M2 — Connexion Supabase read/write locale : **DONE (local + remote)**. Développement local terminé (baseline + `M2_001`→`M2_006`, read path, write path, 226/226 tests dont 75/75 M1). **Déploiement Supabase remote effectué** sur `uvolpldwwyvadlamulvr` : baseline `20260814095000` enregistrée comme déjà appliquée (`migration repair`, sans rejouer son SQL), puis `M2_001`→`M2_006` déployées via `db push`. Migration history LOCAL = REMOTE ; `db push --dry-run` → "Remote database is up to date" ; post-deploy audit PASS ; données existantes préservées. Voir `docs/11_DECISION_LOG.md` (2026-08-16 — clôture locale ; 2026-08-17 — déploiement remote).

## Où on en est réellement

### DONE

- **Onboarding athlète complet** (11 blocs), source de vérité pour `02_ATHLETE_PROFILE.md`.
- **DB Supabase V0.2 déployée et validée** : 12 tables, enums, RLS, triggers, seed data Louis.
- **Spec Head Coach Engine V0.2 consolidée** avec tous les principes canoniques (multidimensional state, décisions causales, non-double-counting, T-X default framework, support multi-jours, SAFETY limitée, soft constraints arbitrables, douleur non-SAFETY actionnable, séparation DB/interne).
- **M1 — Vertical Slice locale du Head Coach Engine** (`head-coach-engine/src/{types,engine,rules,domains,mapping}`) : pipeline complet `RawContext → DailyPlan`, 75/75 tests verts, build TypeScript strict clean, CLI de démonstration fonctionnelle. **Verdict architecte : APPROVED (2026-08-13). Frozen** sauf bug métier réel découvert ultérieurement.
- **M2 — Connexion Supabase read/write locale : DONE (local + remote)** : développement local terminé 2026-08-16 (baseline V0.2 + migrations `M2_001`→`M2_006`, DAL/adapter, `computeDailyFor` zéro écriture et `runDailyFor` RPC `persist_daily_run` atomique, cycle longitudinal A1→A5 prouvé, équivalence fixture ↔ Supabase sur 19 scénarios canoniques, 226/226 tests verts dont 75/75 M1). Déploiement remote effectué 2026-08-17 sur `uvolpldwwyvadlamulvr` : baseline `20260814095000` enregistrée comme applied sans rejouer son SQL, `M2_001`→`M2_006` déployées via `db push`, migration history LOCAL=REMOTE, `db push --dry-run` = "Remote database is up to date", post-deploy audit PASS, données existantes préservées (`athletes`, `goals`, `training_blocks`, `race_calendar`, `athlete_baselines`, `weekly_availability` — comptages identiques avant/après). Voir `docs/11_DECISION_LOG.md` et `docs/12_BACKLOG.md`.

### IN PROGRESS

- Aucun développement en cours. M2 déployé (local + remote). En attente de la **décision Go/No-Go M3** (Louis, non encore prise).

### NOT STARTED

- M3 (Edge Function / API HTTP exposant le moteur).
- Enrichissements P1+ (runtime `ActiveExperiment`, domaines mental/nutrition/analyse, UI, LLM couche E, intégrations externes).

## Prochaines étapes (ordre)

1. ~~**Implémenter M2** (Claude Code) : audit DDL → migrations additives → DAL → adapter → `computeDailyFor` / `runDailyFor` → tests A/B/C/D.~~ **DONE (local), 2026-08-16.**
2. ~~**Review Louis M2 → déploiement remote séparé.**~~ **DONE, 2026-08-17.** → **Décision Go/No-Go M3** (Louis, à venir).
3. **M3 — Edge Function** Supabase exposant `runDailyFor` en HTTP.
4. **Première interface de check-in** (Today screen) — M4+.
5. **Enrichissement des domaines de coaching**, runtime `ActiveExperiment`, LLM couche E, intégrations externes — après M4, ordre à trancher au moment venu.

## Prochain milestone

**Décision Go/No-Go M3** (Louis)

Statut M2 : **DONE (local + remote), 2026-08-17 — développement local terminé (2026-08-16) et déploiement Supabase remote effectué (2026-08-17) sur `uvolpldwwyvadlamulvr`.**

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
- [ ] Décision Go/No-Go M3.

## Règle

**Ne pas marquer une étape comme `DONE` avant qu'elle existe réellement dans Git.**
