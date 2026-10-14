-- P0-SEC-TRUNCATE (HPM 2026-10-13, local) — the browser API roles never hold TRUNCATE.
--
-- Before: anon and authenticated held TRUNCATE on the 9 public tables of the V0.2 baseline (direct ACL entries
-- granted by postgres), and the default privileges of schema public (owner postgres) granted ALL, TRUNCATE included,
-- to anon and authenticated on every NEW table. TRUNCATE bypasses RLS and row triggers. No exploit path was shown
-- (PostgREST / GraphQL do not expose TRUNCATE, the roles are NOLOGIN, no public function runs TRUNCATE), but the
-- privilege is useless to the product and dangerous by construction.
--
-- Rule: anon and authenticated hold TRUNCATE on no public table, today or for future tables created by postgres.
-- Scope, deliberately minimal:
--   * TRUNCATE only. SELECT / INSERT / UPDATE / DELETE (governed by RLS) unchanged. TRIGGER and REFERENCES, held on
--     the same 9 tables, are reported to the HPM and NOT changed here.
--   * service_role keeps TRUNCATE: on these tables it already holds DELETE and UPDATE and bypasses RLS, and none has
--     a DELETE or TRUNCATE trigger, so TRUNCATE gives it no extra capability; server-only key.
--   * Default privileges: only those of owner postgres (the owner of every public table and the role that runs the
--     migrations). Those of supabase_admin cannot be changed by postgres (not a member); no public table is owned by
--     supabase_admin. The final check below covers every public table whatever its owner.
-- No table, row, function, policy or trigger changed. Rollback:
-- supabase/rollbacks/p0_sec/20261014090000_rollback_p0_sec_truncate_api_roles.sql

revoke truncate on table
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

alter default privileges for role postgres in schema public revoke truncate on tables from anon, authenticated;

-- Fail closed: the migration aborts (nothing applied) if any public table still grants TRUNCATE to an API browser
-- role (e.g. a production table outside the local inventory), or if the default privileges of postgres still do.
do $$
declare
  v_tables text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v_tables
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and (has_table_privilege('anon', c.oid, 'TRUNCATE') or has_table_privilege('authenticated', c.oid, 'TRUNCATE'));
  if v_tables is not null then
    raise exception 'P0-SEC-TRUNCATE: anon or authenticated still holds TRUNCATE on %', v_tables;
  end if;
  if exists (
    select 1 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
     where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r'
       and a.privilege_type = 'TRUNCATE' and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
  ) then
    raise exception 'P0-SEC-TRUNCATE: default privileges of postgres in schema public still grant TRUNCATE to anon or authenticated';
  end if;
end
$$;
