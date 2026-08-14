# 00 — Project Status

**Dernière mise à jour :** 13 août 2026
**Version canonique en cours :** V0.2
**Phase actuelle :** M2 — Connexion Supabase read/write locale (conception validée, implémentation à venir)

## Où on en est réellement

### DONE

- **Onboarding athlète complet** (11 blocs), source de vérité pour `02_ATHLETE_PROFILE.md`.
- **DB Supabase V0.2 déployée et validée** : 12 tables, enums, RLS, triggers, seed data Louis.
- **Spec Head Coach Engine V0.2 consolidée** avec tous les principes canoniques (multidimensional state, décisions causales, non-double-counting, T-X default framework, support multi-jours, SAFETY limitée, soft constraints arbitrables, douleur non-SAFETY actionnable, séparation DB/interne).
- **M1 — Vertical Slice locale du Head Coach Engine** (`head-coach-engine/src/{types,engine,rules,domains,mapping}`) : pipeline complet `RawContext → DailyPlan`, 75/75 tests verts, build TypeScript strict clean, CLI de démonstration fonctionnelle. **Verdict architecte : APPROVED (2026-08-13). Frozen** sauf bug métier réel découvert ultérieurement.

### IN PROGRESS

- **M2 — Connexion Supabase read/write locale** : conception validée (2026-08-13). Implémentation à confier à Claude Code.

### NOT STARTED

- M3 (Edge Function / API HTTP exposant le moteur).
- Enrichissements P1+ (runtime `ActiveExperiment`, domaines mental/nutrition/analyse, UI, LLM couche E, intégrations externes).

## Prochaines étapes (ordre)

1. **Implémenter M2** (Claude Code) : audit DDL → migrations additives → DAL → adapter → `computeDailyFor` / `runDailyFor` → tests A/B/C/D.
2. **Revue M2** par Louis, décision Go/No-Go M3.
3. **M3 — Edge Function** Supabase exposant `runDailyFor` en HTTP.
4. **Première interface de check-in** (Today screen) — M4+.
5. **Enrichissement des domaines de coaching**, runtime `ActiveExperiment`, LLM couche E, intégrations externes — après M4, ordre à trancher au moment venu.

## Prochain milestone

**M2 — Connexion Supabase read/write locale**

Statut : **conception validée (2026-08-13), implémentation NOT STARTED**

Critères de sortie M2 :
- [ ] Audit initial du DDL réel (tables + enums touchés par M2) réalisé et tracé.
- [ ] Migrations DB `M2_001`, `M2_002`, `M2_003` appliquées (et `M2_004` si l'audit `completed_sessions.main_content` le justifie).
- [ ] Contrainte / index unique partiel PostgreSQL sur `health_flags` empêchant deux flags ouverts `(athlete_id, type)` simultanés, tout en autorisant un nouveau flag après résolution.
- [ ] Fonction PostgreSQL / RPC transactionnelle `persist_daily_run` (upsert health flag + insert decision append-only atomiques). Aucune logique de coaching côté SQL.
- [ ] DAL minimal (repositories + adapter) implémenté dans `src/supabase/`.
- [ ] Séparation calcul (`computeDailyFor`) / persistance (`runDailyFor`).
- [ ] `buildRawContextFromSupabase` **rejette** un checkin courant M2 dont un des trois critères douleur (`pain_traumatic`, `pain_function_loss`, `pain_getting_worse`) est `NULL` — jamais de conversion silencieuse en `false`.
- [ ] Inversion `DbSessionType → TrainingIntervention` limitée aux mappings mathématiquement non ambigus (`REST`, `BIKE_MAINTENANCE`, `RACE_PREP`). Autres cas legacy → `planned_session = null` + warning.
- [ ] `decisions` append-only (aucune contrainte d'unicité, aucun upsert destructif).
- [ ] 75/75 tests M1 toujours verts (moteur strictement non modifié).
- [ ] Tests M2 A/B/C/D verts (voir `docs/10_TEST_PLAN.md` §M2).
- [ ] Cycle A1/A2/A3/A4 → A5 (jour N → jour N+1) explicitement prouvé par test d'intégration.
- [ ] Équivalence fixture ↔ Supabase prouvée pour tous les scénarios M1 canoniques.
- [ ] Infra tests : Supabase CLI local + migrations versionnées + seed reproductible fonctionnels.
- [ ] Aucune modification de `src/{types,engine,rules,domains,mapping}`.
- [ ] Revue Louis.
- [ ] Commit / push.
- [ ] Décision Go/No-Go M3.

## Règle

**Ne pas marquer une étape comme `DONE` avant qu'elle existe réellement dans Git.**
