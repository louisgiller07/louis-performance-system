-- PR2-DH-REVOCATION — preflight, READ ONLY (no write, no lock beyond a read). Counters and booleans only: no rider id,
-- no personal data. Run in the Supabase SQL Editor of the production project (uvolpldwwyvadlamulvr) before step 2.
-- Expected: 0_read_only = on; 1 = 77; 2 = 20261021200000; 3 = true (the table does not exist yet); 4 = false (no
-- helper); 5 and 6 = true (the RPCs are those of power_guard_01 / p0_3_manual_keep, CR ignored).
-- A failing query is NOT a zero: report the error as is.
set transaction read only;
set local statement_timeout = '30s';
select
  current_setting('transaction_read_only') as "0_read_only",
  (select count(*) from supabase_migrations.schema_migrations) as "1_migrations_applied",
  (select max(version) from supabase_migrations.schema_migrations) as "2_last_migration",
  to_regclass('public.dh_drill_revocations') is null as "3_revocation_table_absent",
  to_regprocedure('public.execution_dh_revocation_block(uuid)') is not null as "4_helper_present",
  (select position('NX301' in prosrc) = 0 and position('power' in prosrc) > 0
     from pg_proc where oid = 'public.record_session_execution(uuid, jsonb)'::regprocedure) as "5_record_session_execution_is_power_guard_01",
  (select position('NX302' in prosrc) = 0
     from pg_proc where oid = 'public.persist_daily_run_v2(uuid, jsonb, jsonb, jsonb)'::regprocedure) as "6_persist_daily_run_v2_without_revocation";
