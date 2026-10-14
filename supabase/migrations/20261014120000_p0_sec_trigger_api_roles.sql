-- P0-SEC-TRIGGER (HPM 2026-10-14, local) — the browser API roles never hold TRIGGER on public tables.
--
-- Before: anon and authenticated held TRIGGER on the 9 public tables of the V0.2 baseline (direct ACL entries
-- granted by postgres), and the default privileges of schema public (owner postgres) granted TRIGGER to them on every
-- NEW table. CREATE TRIGGER only needs TRIGGER on the table and EXECUTE on a trigger function; anon and authenticated
-- can execute public trigger functions such as reject_append_only_mutation, so a session acting as one of these roles
-- could attach a persistent trigger that blocks or alters every write of a table (proven in a rolled-back
-- transaction). Neither NOLOGIN nor the absence of a known API path is taken as proof of harmlessness.
--
-- Rule: anon and authenticated hold TRIGGER on no public table, today or for future tables created by postgres.
-- Scope, deliberately minimal:
--   * TRIGGER only. Existing triggers are untouched: the TRIGGER privilege is checked only when a trigger is created,
--     never when it fires, so the 62 application triggers keep running unchanged.
--   * service_role, REFERENCES, MAINTAIN and SELECT / INSERT / UPDATE / DELETE (governed by RLS) unchanged.
--   * Default privileges: only those of owner postgres (owner of every public table, role of the migrations). Those of
--     supabase_admin cannot be changed by postgres (not a member: "permission denied to change default privileges").
--     The final check below covers every public table whatever its owner.
-- No table, row, function, policy or trigger changed. Rollback:
-- supabase/rollbacks/p0_sec/20261014120000_rollback_p0_sec_trigger_api_roles.sql

revoke trigger on table
  public.athlete_baselines,
  public.athlete_state,
  public.athletes,
  public.daily_checkins,
  public.goals,
  public.planned_sessions,
  public.race_calendar,
  public.training_blocks,
  public.weekly_availability
from anon, authenticated;

alter default privileges for role postgres in schema public revoke trigger on tables from anon, authenticated;

-- Fail closed: the migration aborts (nothing applied) if any public table still grants TRIGGER to an API browser role
-- (e.g. a production table outside the local inventory), or if the default privileges of postgres still do.
do $$
declare
  v_tables text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v_tables
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and (has_table_privilege('anon', c.oid, 'TRIGGER') or has_table_privilege('authenticated', c.oid, 'TRIGGER'));
  if v_tables is not null then
    raise exception 'P0-SEC-TRIGGER: anon or authenticated still holds TRIGGER on %', v_tables;
  end if;
  if exists (
    select 1 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
     where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r'
       and a.privilege_type = 'TRIGGER' and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
  ) then
    raise exception 'P0-SEC-TRIGGER: default privileges of postgres in schema public still grant TRIGGER to anon or authenticated';
  end if;
end
$$;
