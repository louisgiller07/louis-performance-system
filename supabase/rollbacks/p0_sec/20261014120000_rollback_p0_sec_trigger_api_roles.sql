-- WARNING (HPM 2026-10-14): this is NOT a routine rollback. It RE-GRANTS a dangerous privilege: anon and
-- authenticated can again CREATE TRIGGER on the 9 baseline tables (e.g. attach reject_append_only_mutation and block
-- every write of a table), and every new public table created by postgres grants it again. No code depends on these
-- roles creating triggers: if an unknown dependency breaks, grant the single missing privilege to the single role on
-- the single table instead of replaying this file. Only on an explicit HPM incident decision.
--
-- P0-SEC-TRIGGER rollback of 20261014120000_p0_sec_trigger_api_roles.sql (replay as a NEW migration, never edit the
-- applied one). Restores exactly the previous privileges. Existing triggers and data untouched.

grant trigger on table
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

alter default privileges for role postgres in schema public grant trigger on tables to anon, authenticated;
