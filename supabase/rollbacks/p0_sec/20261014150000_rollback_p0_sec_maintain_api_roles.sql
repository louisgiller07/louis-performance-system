-- WARNING (HPM 2026-10-14): this is NOT a routine rollback. It RE-GRANTS a dangerous privilege: anon and
-- authenticated can again VACUUM FULL / CLUSTER / REINDEX the baseline tables and authenticated can again take an
-- ACCESS EXCLUSIVE lock on completed_sessions, decisions and health_flags. No code depends on it: if an unknown
-- dependency breaks, grant the single missing privilege instead of replaying this file. Only on an explicit HPM
-- incident decision.
--
-- P0-SEC-MAINTAIN rollback of 20261014150000_p0_sec_maintain_api_roles.sql (replay as a NEW migration). Restores exactly
-- the previous privileges (anon: 9 baseline tables; authenticated: the same 9 + completed_sessions, decisions,
-- health_flags; default privileges of postgres). Version-guarded like the migration. Data untouched.
do $$
begin
  if current_setting('server_version_num')::int < 170000 then
    raise notice 'P0-SEC-MAINTAIN rollback: PostgreSQL % has no MAINTAIN privilege, nothing to restore', current_setting('server_version');
    return;
  end if;
  execute 'grant maintain on table
             public.athlete_baselines, public.athlete_state, public.athletes, public.daily_checkins, public.goals,
             public.planned_sessions, public.race_calendar, public.training_blocks, public.weekly_availability
           to anon, authenticated';
  execute 'grant maintain on table public.completed_sessions, public.decisions, public.health_flags to authenticated';
  execute 'alter default privileges for role postgres in schema public grant maintain on tables to anon, authenticated';
end
$$;
