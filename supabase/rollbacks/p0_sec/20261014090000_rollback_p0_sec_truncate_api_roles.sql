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
