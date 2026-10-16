-- REL-01 D′ (b327921) — production PRECHECK and POSTCHECK, READ ONLY (SELECT only). Run by Louis in the SQL Editor,
-- never by Claude Code. Aggregated: no athlete id, no personal data (table names only). Expected values measured on the
-- isolated local gate stack nalynt-gate01 (PostgreSQL 17.6): production state C 59202dc + P0-SAFE-HOTFIX-01 B (68),
-- then the 6 D′ migrations (74). Line endings neutralised (Windows checkouts store CRLF bodies).
-- PRE (blocks 1 to 6), before any D′ step: any difference in blocks 1 to 5 → STOP, report to the HPM, deploy nothing.

-- 1. History = production after the hotfix. Expected: 68 | 20261013180000 | 2 | 0
select count(*) as migrations,
       max(version) as last_version,
       count(*) filter (where version in ('20261013160000', '20261013180000')) as hotfix_versions,
       count(*) filter (where version > '20261013180000' or version in ('20261013120000', '20261013140000')) as d_versions
  from supabase_migrations.schema_migrations;

-- 2. Functions D′ replaces (persist_daily_run_v2, project_training_plan, persist_completed_session) or keeps (the three
--    hotfix ones). Expected, 6 rows, and none of enforce_planned_session_day_lock / planned_session_day_has_execution:
--      completed_session_health_block | ae7a128f918327cd403068114cb33270 | t | s | {"search_path=public, pg_temp"} | {postgres=X/postgres,service_role=X/postgres}
--      execution_health_block         | 8c7972c7ade8078b8b536f229b7d93c3 | f | s | {"search_path=public, pg_temp"} | {postgres=X/postgres}
--      persist_completed_session      | 2d5ec3f3b0d200937a92ee152dac5411 | f | v | {search_path=public}            | {postgres=X/postgres,service_role=X/postgres}
--      persist_daily_run_v2           | 81e6e6905f96ffa45116f78cef9c21aa | t | v | {"search_path=public, pg_temp"} | {postgres=X/postgres,service_role=X/postgres}
--      project_training_plan          | 82649dd9cbc1956c658aec648ee256e2 | t | v | {search_path=public}            | {postgres=X/postgres,service_role=X/postgres}
--      record_session_execution       | dd3c0a6826854f85452478eb131a6e46 | t | v | {search_path=public}            | {postgres=X/postgres,service_role=X/postgres}
select p.proname,
       md5(replace(p.prosrc, chr(13), '')) as body_md5,
       p.prosecdef as security_definer,
       p.provolatile as volatility,
       p.proconfig::text as settings,
       p.proacl::text as acl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('persist_daily_run_v2', 'project_training_plan', 'persist_completed_session', 'record_session_execution',
                     'execution_health_block', 'completed_session_health_block', 'enforce_planned_session_day_lock',
                     'planned_session_day_has_execution')
 order by p.proname;

-- 3. Day-lock triggers on planned_sessions do not exist yet. Expected: 0
select count(*) as day_lock_triggers
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'planned_sessions'
   and t.tgname in ('trg_planned_sessions_day_lock', 'trg_planned_sessions_day_lock_statement');

-- 4. P0-SEC preconditions. The three P0-SEC migrations revoke TRUNCATE / TRIGGER on the 9 baseline tables and MAINTAIN on
--    those 9 + completed_sessions, decisions, health_flags, then ABORT (fail closed) if anon or authenticated still holds
--    the privilege anywhere in public. Expected: 0 rows (otherwise the push would stop at 20261014090000 or later).
select x.privilege, c.relname as table_outside_revoke_list
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('TRUNCATE'), ('TRIGGER'), ('MAINTAIN')) as x(privilege)
 where n.nspname = 'public' and c.relkind in ('r', 'p', 'm')
   and (x.privilege <> 'MAINTAIN' or current_setting('server_version_num')::int >= 170000)
   and (has_table_privilege('anon', c.oid, x.privilege) or has_table_privilege('authenticated', c.oid, x.privilege))
   and not (c.relname in ('athlete_baselines', 'athlete_state', 'athletes', 'daily_checkins', 'goals', 'planned_sessions',
                          'race_calendar', 'training_blocks', 'weekly_availability')
            or (x.privilege = 'MAINTAIN' and c.relname in ('completed_sessions', 'decisions', 'health_flags')))
 order by 1, 2;
--    Same reason: PUBLIC holds nothing on a public table, and anon / authenticated inherit from no role. Expected: 0 | 0
select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join lateral aclexplode(c.relacl) a
         where n.nspname = 'public' and a.grantee = 0) as public_grants,
       (select count(*) from pg_auth_members m where m.member in ('anon'::regrole, 'authenticated'::regrole)) as api_role_memberships;

-- 5. What P0-SEC will remove (information; the local gate values below): direct grants on public tables, default
--    privileges of postgres. Local expected: MAINTAIN anon 9, MAINTAIN authenticated 12, TRIGGER 9 / 9, TRUNCATE 9 / 9;
--    default privileges: the same 3 privileges for anon and for authenticated (6 rows). MAINTAIN rows only on PostgreSQL 17+.
select a.privilege_type, r.rolname, count(distinct c.oid) as tables
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) a join pg_roles r on r.oid = a.grantee
 where n.nspname = 'public' and c.relkind in ('r', 'p', 'm', 'v') and r.rolname in ('anon', 'authenticated')
   and a.privilege_type in ('TRUNCATE', 'TRIGGER', 'MAINTAIN')
 group by 1, 2 order by 1, 2;
select r.rolname, a.privilege_type
  from pg_default_acl d join pg_roles o on o.oid = d.defaclrole
  cross join lateral aclexplode(d.defaclacl) a join pg_roles r on r.oid = a.grantee
 where o.rolname = 'postgres' and d.defaclobjtype = 'r' and d.defaclnamespace = 'public'::regnamespace
   and r.rolname in ('anon', 'authenticated') and a.privilege_type in ('TRUNCATE', 'TRIGGER', 'MAINTAIN')
 order by 1, 2;

-- 6. PostgreSQL version (decides the effect of 20261014150000). >= 170000: MAINTAIN revoked (HPM decision 5).
--    < 170000: the migration is recorded with a NOTICE and changes nothing (P0_SEC_MAINTAIN_NOTE.md, HPM decision 6):
--    report the value to the HPM before going further.
select current_setting('server_version_num') as server_version_num;

-- 7. Information (no expected value), aggregated: guided sessions not closed (they continue under D′), planned days that
--    already have an execution (the day lock of 20261013180200 protects them from then on).
select (select count(*) from public.session_executions e
         where not exists (select 1 from public.execution_events v where v.execution_id = e.id and v.event_type in ('completed', 'abandoned'))) as open_executions,
       (select count(*) from public.planned_sessions s
         where exists (select 1 from public.session_executions e where e.athlete_id = s.athlete_id and e.session_date = s.planned_date)) as planned_days_with_execution;

-- ======================================================================================================================
-- POST (after `db push` of the 6 D′ migrations only, before any Edge deploy). Expected (gate stack, 74):
--   Q1: 74 | 20261014150000 | 6 | 0
--   Q2 (8 rows):
--     completed_session_health_block    | ae7a128f918327cd403068114cb33270 | t | s | {"search_path=public, pg_temp"} | {postgres=X/postgres,service_role=X/postgres}
--     enforce_planned_session_day_lock  | 4161cfe4398a125aa7dfa26559c6adf4 | t | v | {"search_path=public, pg_temp"} | {postgres=X/postgres}
--     execution_health_block            | 8c7972c7ade8078b8b536f229b7d93c3 | f | s | {"search_path=public, pg_temp"} | {postgres=X/postgres}
--     persist_completed_session         | 050ad0e4dd812a9b1ef1c8d6ca084c77 | f | v | {search_path=public}            | {postgres=X/postgres,service_role=X/postgres}
--     persist_daily_run_v2              | 8ea80f3319f2e6f276b2653d50ab77b9 | t | v | {"search_path=public, pg_temp"} | {postgres=X/postgres,service_role=X/postgres}
--     planned_session_day_has_execution | 3bbe93b0c46cd3a9761ad84446acdfdd | f | s | {"search_path=public, pg_temp"} | {postgres=X/postgres}
--     project_training_plan             | 0e5079f4c0e776ecd77b7df478a630cf | t | v | {search_path=public}            | {postgres=X/postgres,service_role=X/postgres}
--     record_session_execution          | dd3c0a6826854f85452478eb131a6e46 | t | v | {search_path=public}            | {postgres=X/postgres,service_role=X/postgres}
--   Q3: 2
--   Q4: 0 rows (MAINTAIN rows can only remain on PostgreSQL < 17, where they do not exist)
--   Q5: 0 rows
-- ======================================================================================================================
-- Q1
select count(*) as migrations, max(version) as last_version,
       count(*) filter (where version in ('20261013180100', '20261013180200', '20261013190000', '20261014090000',
                                          '20261014120000', '20261014150000')) as d_prime_versions,
       count(*) filter (where version in ('20261013120000', '20261013140000')) as old_d_numbers
  from supabase_migrations.schema_migrations;
-- Q2
select p.proname, md5(replace(p.prosrc, chr(13), '')) as body_md5, p.prosecdef as security_definer, p.provolatile as volatility,
       p.proconfig::text as settings, p.proacl::text as acl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('persist_daily_run_v2', 'project_training_plan', 'persist_completed_session', 'record_session_execution',
                     'execution_health_block', 'completed_session_health_block', 'enforce_planned_session_day_lock',
                     'planned_session_day_has_execution')
 order by p.proname;
-- Q3
select count(*) as day_lock_triggers
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'planned_sessions'
   and t.tgname in ('trg_planned_sessions_day_lock', 'trg_planned_sessions_day_lock_statement');
-- Q4
select x.privilege, c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('TRUNCATE'), ('TRIGGER'), ('MAINTAIN')) as x(privilege)
 where n.nspname = 'public' and c.relkind in ('r', 'p', 'm')
   and (x.privilege <> 'MAINTAIN' or current_setting('server_version_num')::int >= 170000)
   and (has_table_privilege('anon', c.oid, x.privilege) or has_table_privilege('authenticated', c.oid, x.privilege))
 order by 1, 2;
-- Q5
select r.rolname, a.privilege_type
  from pg_default_acl d join pg_roles o on o.oid = d.defaclrole
  cross join lateral aclexplode(d.defaclacl) a join pg_roles r on r.oid = a.grantee
 where o.rolname = 'postgres' and d.defaclobjtype = 'r' and d.defaclnamespace = 'public'::regnamespace
   and r.rolname in ('anon', 'authenticated') and a.privilege_type in ('TRUNCATE', 'TRIGGER', 'MAINTAIN')
 order by 1, 2;
