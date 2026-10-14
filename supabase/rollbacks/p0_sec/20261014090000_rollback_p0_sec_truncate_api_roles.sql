-- WARNING (QA-ISOLATION-01, HPM 2026-10-14): this is NOT a routine rollback. It RE-GRANTS a dangerous privilege:
-- anon and authenticated can again TRUNCATE (bypassing RLS and row triggers) 4 baseline tables directly, and every
-- new public table created by postgres grants it again. Proven on nalynt-qa01: after this script,
-- `set role anon; truncate public.weekly_availability` succeeds. No code depends on TRUNCATE: if an unknown dependency
-- breaks, grant the single missing privilege to the single role on the single table instead of replaying this file.
-- Only on an explicit HPM incident decision.
--
-- P0-SEC-TRUNCATE rollback of 20261014090000_p0_sec_truncate_api_roles.sql (replay as a NEW migration, never edit
-- the applied one). Restores exactly the previous privileges: TRUNCATE for anon and authenticated on the 9 baseline
-- tables, and TRUNCATE in the default privileges of postgres in schema public. Re-opens the P0-SEC-TRUNCATE finding:
-- only on an incident decision of the HPM. Data untouched.

grant truncate on table
  public.athlete_baselines,
  public.athlete_state,
  public.athletes,
  public.daily_checkins,
  public.goals,
  public.planned_sessions,
  public.race_calendar,
  public.training_blocks,
  public.weekly_availability
to anon, authenticated;

alter default privileges for role postgres in schema public grant truncate on tables to anon, authenticated;
