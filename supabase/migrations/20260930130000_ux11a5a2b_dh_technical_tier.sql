-- UX-11A.5a.2b — declared DH technical tier (athlete_performance_profiles).
--
-- See docs/11_DECISION_LOG.md (ADR UX-11A.5a.2b) and docs/03_COACHING_MODEL.md
-- §Technique DH — règles V2.
--
-- A signal DECLARED by the rider (first run, "Affiner ton profil"), never
-- inferred: never derived from strength_experience_tier, competition level,
-- category, results or a weakness. Additive only:
-- - nullable, NO default, NO backfill: every existing row stays NULL;
-- - no trigger, no function computes it;
-- - values beginner / intermediate / advanced (same vocabulary as the DH
--   drills' own tier, deliberately a distinct signal from the strength tier).
-- Not consumed by any engine yet: the V2 generation path (UX-11A.5b) will
-- require it before building a V2 plan that contains DH, never default it.
-- Technical priorities keep using the existing technical_priorities.priorityAreas.
-- LOCAL ONLY until UX-11C (branch lineage kept out of main).

alter table public.athlete_performance_profiles
  add column dh_technical_tier text null;

alter table public.athlete_performance_profiles
  add constraint athlete_performance_profiles_dh_technical_tier_check
  check (dh_technical_tier is null or dh_technical_tier in ('beginner', 'intermediate', 'advanced'));

comment on column public.athlete_performance_profiles.dh_technical_tier is
  'UX-11A.5a.2b — rider-declared DH technical tier (beginner | intermediate | advanced). Never inferred; NULL for legacy rows; no default, no backfill.';
