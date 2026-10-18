-- V2-PHYS-RELEASE-GATE-01 — state of the production database around the release. READ ONLY: one SELECT statement
-- (the SQL Editor shows the last result only), catalog and plain tables, built-in functions only; no write, no setting.
-- Returns one row of counts, booleans and fingerprints: no identifier, no name, no personal data.
-- Run by Louis in the SQL Editor (never by Claude Code in Production), at three points of the gate:
--   P4  before the migration      : migrations 75, power_guard_applied 0, fn body dd3c0a68…, every PHYS count 0
--   2b  right after the migration : migrations 76, power_guard_applied 1, fn body c271b883…, every PHYS count 0
--   5   after Edge + web, flags OFF: same as 2b (no PHYS data may appear while every new secret is absent)
-- Fingerprint = md5 of the function body with carriage returns removed (the migration files are CRLF on Windows).
select
  -- Migration history (expected 75 / 20261016120000 before; 76 / 20261018120000 after).
  (select count(*) from supabase_migrations.schema_migrations) as migrations_applied,
  (select max(version) from supabase_migrations.schema_migrations) as last_migration,
  (select count(*) from supabase_migrations.schema_migrations where version = '20261018120000') as power_guard_applied,
  -- record_session_execution: one function, SECURITY DEFINER, search_path=public, owner postgres,
  -- EXECUTE for postgres and service_role only; body dd3c0a6826854f85452478eb131a6e46 (20261013160000, before)
  -- or c271b8836a05a6b896469b081ee3105c (20261018120000, after).
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_session_execution' and p.prokind = 'f') as rse_functions,
  (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_session_execution' and p.prokind = 'f') as rse_body_md5,
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_session_execution' and p.prokind = 'f') as rse_security_definer,
  (select array_to_string(p.proconfig, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_session_execution' and p.prokind = 'f') as rse_config,
  (select pg_get_userbyid(p.proowner) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_session_execution' and p.prokind = 'f') as rse_owner,
  (select string_agg(distinct pg_get_userbyid(a.grantee), ',' order by pg_get_userbyid(a.grantee))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace, aclexplode(p.proacl) a
    where n.nspname = 'public' and p.proname = 'record_session_execution' and p.prokind = 'f'
      and a.privilege_type = 'EXECUTE') as rse_execute_grantees,
  -- PHYS data (expected 0 at every point while every new secret is absent).
  -- POWER-GUARD-01 precondition: no guided execution of a power prescription.
  (select count(*) from public.session_executions e
     join public.decision_final_prescriptions fp on fp.id = e.final_prescription_id
    where fp.structure ->> 'family' = 'power') as power_executions,
  (select count(*) from public.decision_final_prescriptions
    where structure ->> 'family' in ('power', 'mobility')) as final_prescriptions_power_mobility,
  (select count(*) from public.decision_final_prescriptions
    where structure ->> 'sessionKind' = 'AEROBIC_INTERVALS') as final_prescriptions_intervals,
  (select count(*) from public.decision_final_prescriptions
    where structure ? 'enduranceGuidance'
       or structure::text like '%"loadGuidance"%'
       or structure::text like '%"repsGuidance"%') as final_prescriptions_with_phys_guidance,
  -- V2 plans only (a V1 plan may legitimately hold other kinds).
  (select count(*) from public.training_plan_generated_sessions g
     join public.training_plan_versions v on v.id = g.plan_version_id
    where v.prescription_schema_version = 'v2'
      and g.kind in ('AEROBIC_INTERVALS', 'POWER', 'MOBILITY')) as v2_plan_sessions_phys_kinds,
  (select count(*) from public.training_plan_weeks w
     join public.training_plan_versions v on v.id = w.plan_version_id
    where v.prescription_schema_version = 'v2'
      and (w.dose_summary -> 'progression' ? 'intervalsPolicy'
        or w.dose_summary -> 'progression' ? 'powerPolicy'
        or w.dose_summary -> 'progression' ? 'mobilityPolicy')) as v2_plan_weeks_phys_policies,
  -- Context (informational): V2 plan versions and the last V2 generation.
  (select count(*) from public.training_plan_versions where prescription_schema_version = 'v2') as v2_plan_versions_total,
  (select max(generated_at) from public.training_plan_versions where prescription_schema_version = 'v2') as last_v2_generation_at;
