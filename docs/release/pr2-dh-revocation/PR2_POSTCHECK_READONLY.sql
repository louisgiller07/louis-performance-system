-- PR2-DH-REVOCATION — post-migration check, READ ONLY. Counters and booleans only: no rider id, no personal data.
-- Run in the Supabase SQL Editor of the production project (uvolpldwwyvadlamulvr) right after `supabase db push`.
-- Expected: every column true except 0_read_only = on, 1 = 78, 2 = 20261027120000, 3 = 0.
-- The md5 values are those of the function bodies of 20261027120000_v2_dh_drill_revocation.sql (carriage returns
-- ignored: a Windows checkout may send CRLF), checked on the local stack. A failing query is NOT a zero.
set transaction read only;
set local statement_timeout = '30s';
select
  current_setting('transaction_read_only') as "0_read_only",
  (select count(*) from supabase_migrations.schema_migrations) as "1_migrations_applied",
  (select max(version) from supabase_migrations.schema_migrations) as "2_last_migration",
  (select count(*) from public.dh_drill_revocations) as "3_revocations",
  (select relrowsecurity and not exists (select 1 from pg_policy where polrelid = c.oid)
     from pg_class c where c.oid = 'public.dh_drill_revocations'::regclass) as "4_rls_on_no_policy",
  (select coalesce(string_agg(grantee || ':' || privilege_type, ',' order by grantee, privilege_type), '')
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'dh_drill_revocations' and grantee in ('anon', 'authenticated', 'service_role'))
    = 'service_role:INSERT,service_role:SELECT' as "5_table_privileges_operators_only",
  (select count(*) = 2 from pg_trigger
    where tgrelid = 'public.dh_drill_revocations'::regclass
      and tgname in ('trg_dh_drill_revocations_no_update', 'trg_dh_drill_revocations_no_delete')) as "6_append_only_triggers",
  (select not has_function_privilege('public', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')
      and not p.prosecdef and p.proowner = r.proowner and r.prosecdef
     from pg_proc p, pg_proc r
    where p.oid = 'public.execution_dh_revocation_block(uuid)'::regprocedure
      and r.oid = 'public.record_session_execution(uuid, jsonb)'::regprocedure) as "7_helper_owner_only",
  (select md5(replace(prosrc, chr(13), '')) = '6145c23f7b2b4b5e3b1680bf2e1d8edd' and prosecdef
     from pg_proc where oid = 'public.record_session_execution(uuid, jsonb)'::regprocedure) as "8_record_session_execution_body",
  (select md5(replace(prosrc, chr(13), '')) = '214458e5c24fcdf58ae8e37cd877ab8e' and prosecdef
     from pg_proc where oid = 'public.persist_daily_run_v2(uuid, jsonb, jsonb, jsonb)'::regprocedure) as "9_persist_daily_run_v2_body",
  (select md5(replace(prosrc, chr(13), '')) = '9efbfb2e6ebe7ee10a518406b2906cba'
     from pg_proc where oid = 'public.execution_dh_revocation_block(uuid)'::regprocedure) as "10_helper_body",
  not has_function_privilege('authenticated', 'public.record_session_execution(uuid, jsonb)', 'execute')
    and has_function_privilege('service_role', 'public.record_session_execution(uuid, jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.persist_daily_run_v2(uuid, jsonb, jsonb, jsonb)', 'execute')
    and has_function_privilege('service_role', 'public.persist_daily_run_v2(uuid, jsonb, jsonb, jsonb)', 'execute') as "11_rpc_grants_unchanged";
