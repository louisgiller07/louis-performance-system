-- BETA-V2-TECH-01 — V1 exemptions: check AFTER migration 20261027150000, READ ONLY (no write, no lock beyond a read).
-- Counters and booleans only, no rider id. A failing query is NOT a zero: report the error.
-- Expected: 0 = on; 1 = true; 2 and 3 = true; 4 = true (validated); 5 = 0; 6 = 0; 7 = true (still no policy, no
-- privilege for anon / authenticated). If 4 = false: 5 lists how many v1 rows still lack a reason or an author; the
-- release stops (trace them with the real decision, GO Louis, then VALIDATE, then re-run this check).
-- The binary GO / STOP before the deployment of generate-training-plan is V1_EXEMPTION_RELEASE_GATE_READONLY.sql.
set transaction read only;
set local statement_timeout = '30s';
select
  current_setting('transaction_read_only') as "0_read_only",
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'training_plan_model_assignments' and column_name = 'decided_by') as "1_decided_by_present",
  exists (select 1 from pg_constraint where conrelid = 'public.training_plan_model_assignments'::regclass
           and conname = 'training_plan_model_assignments_decided_by_length') as "2_length_constraint_present",
  exists (select 1 from pg_constraint where conrelid = 'public.training_plan_model_assignments'::regclass
           and conname = 'training_plan_model_assignments_v1_exemption_traced') as "3_trace_constraint_present",
  (select convalidated from pg_constraint where conrelid = 'public.training_plan_model_assignments'::regclass
           and conname = 'training_plan_model_assignments_v1_exemption_traced') as "4_trace_constraint_validated",
  (select count(*) from public.training_plan_model_assignments
    where planning_model = 'v1' and (note is null or decided_by is null)) as "5_v1_rows_untraced",
  (select count(*) from pg_policy where polrelid = 'public.training_plan_model_assignments'::regclass) as "6_policies",
  not (has_table_privilege('anon', 'public.training_plan_model_assignments', 'select, insert, update, delete')
       or has_table_privilege('authenticated', 'public.training_plan_model_assignments', 'select, insert, update, delete')) as "7_no_client_privilege";
