-- P0-SEC-MAINTAIN (HPM 2026-10-14, local proposal — NOT integrated into REL-01 without a specific GO) — the browser
-- API roles never hold MAINTAIN on public tables.
--
-- MAINTAIN exists from PostgreSQL 17 (VACUUM incl. FULL, ANALYZE, CLUSTER, REINDEX, REFRESH MATERIALIZED VIEW, LOCK
-- TABLE in any mode). Before (local PG 17.6, schema = production + INT-01 + P0-SEC-TRUNCATE/TRIGGER): anon held it on
-- the 9 baseline tables, authenticated on 12 (the same 9 + completed_sessions, decisions, health_flags, where its only
-- other privilege is SELECT), and the default privileges of postgres granted it on every new table. Proven in a local
-- session acting as these roles: REINDEX and VACUUM FULL on goals (anon); LOCK TABLE ... ACCESS EXCLUSIVE on decisions
-- (authenticated) — an exclusive lock that SELECT alone does not allow. No function, Edge, purge or maintenance path
-- uses these roles for maintenance (autovacuum and migrations run as superuser / postgres).
--
-- Rule: anon and authenticated hold MAINTAIN on no public table, today or for future tables created by postgres.
-- Scope, deliberately minimal: MAINTAIN only; service_role, REFERENCES and RLS-governed privileges unchanged; existing
-- triggers, functions, policies, tables and rows untouched. Known residual: LOCK TABLE in strong modes stays possible
-- on a table where a role still holds UPDATE / DELETE (the 9 baseline tables): inherent to those privileges.
-- Default privileges of supabase_admin cannot be changed by postgres (same limit as P0-SEC-TRUNCATE / TRIGGER).
--
-- Version-guarded: on PostgreSQL < 17 the privilege does not exist (the statements would not parse), so the migration
-- is a recorded no-op there. Rollback: supabase/rollbacks/p0_sec/20261014150000_rollback_p0_sec_maintain_api_roles.sql
do $$
declare
  v_tables text;
begin
  if current_setting('server_version_num')::int < 170000 then
    raise notice 'P0-SEC-MAINTAIN: PostgreSQL % has no MAINTAIN privilege, nothing to revoke', current_setting('server_version');
    return;
  end if;

  execute 'revoke maintain on table
             public.athlete_baselines, public.athlete_state, public.athletes, public.daily_checkins, public.goals,
             public.planned_sessions, public.race_calendar, public.training_blocks, public.weekly_availability,
             public.completed_sessions, public.decisions, public.health_flags
           from anon, authenticated';
  execute 'alter default privileges for role postgres in schema public revoke maintain on tables from anon, authenticated';

  -- Fail closed: abort (nothing applied) if any public table still grants MAINTAIN to an API browser role, or if the
  -- default privileges of postgres still do.
  select string_agg(c.relname, ', ' order by c.relname) into v_tables
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'm')
     and (has_table_privilege('anon', c.oid, 'MAINTAIN') or has_table_privilege('authenticated', c.oid, 'MAINTAIN'));
  if v_tables is not null then
    raise exception 'P0-SEC-MAINTAIN: anon or authenticated still holds MAINTAIN on %', v_tables;
  end if;
  if exists (
    select 1 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
     where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r'
       and a.privilege_type = 'MAINTAIN' and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
  ) then
    raise exception 'P0-SEC-MAINTAIN: default privileges of postgres in schema public still grant MAINTAIN to anon or authenticated';
  end if;
end
$$;
