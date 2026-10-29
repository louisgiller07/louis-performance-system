-- BETA-V2-TECH-01 — V1 exemptions: RELEASE GATE before the deployment of generate-training-plan. READ ONLY, one statement.
--
-- HPM CANON-GATE-01 (2026-10-29), option (b): migration 20261027150000 may succeed while historical v1 assignments still
-- lack a reason (note) or an author (decided_by). Its trace constraint then stays NOT VALID: it protects every new or
-- updated row, but the old untraced rows can remain, and they still authorise V1 generation (the Edge function reads
-- planning_model only). generate-training-plan is therefore NOT deployed until this gate answers GO.
--
-- GO   = the statement succeeds, with the NOTICE release_gate_go (SQL Editor: "Success. No rows returned";
--        psql -v ON_ERROR_STOP=1 -f <this file>: exit code 0).
-- STOP = the statement fails with release_gate_stop: <failed checks>; the DETAIL gives the counters (no rider id).
--        Any other error (permission, timeout, missing schema) is also a STOP, never a GO.
--
-- Run with Louis's GO, in the SQL Editor of the target project. The gate only reads. Tracing each historical v1 row with
-- the real decision (GO Louis, never an invented author) and the VALIDATE statement are operator steps outside the gate;
-- re-run the gate after them. Counters for the operator: V1_EXEMPTION_POSTCHECK_READONLY.sql.
do $gate$
declare
  c_table constant regclass := to_regclass('public.training_plan_model_assignments');
  c_trace constant text := 'training_plan_model_assignments_v1_exemption_traced';
  c_length constant text := 'training_plan_model_assignments_decided_by_length';
  c_trace_def constant text := 'CHECK (((planning_model <> ''v1''::text) OR ((note IS NOT NULL) AND (decided_by IS NOT NULL))))';
  v_failed text[] := '{}';
  v_migration boolean;
  v_column boolean;
  v_length_validated boolean;
  v_trace_validated boolean;
  v_trace_def text;
  v_v1 bigint;
  v_v1_untraced bigint;
  v_v2 bigint;
  v_unassigned bigint;
  v_rls boolean;
  v_policies bigint;
  v_client_privilege boolean;
  v_counters text;
begin
  set transaction read only;
  set local statement_timeout = '30s';

  if c_table is null then
    raise exception using message = 'release_gate_stop: table_missing',
      detail = 'public.training_plan_model_assignments does not exist on this database.';
  end if;

  select exists (select 1 from supabase_migrations.schema_migrations where version = '20261027150000') into v_migration;
  select exists (select 1 from pg_attribute where attrelid = c_table and attname = 'decided_by' and not attisdropped)
    into v_column;
  select convalidated into v_length_validated from pg_constraint where conrelid = c_table and conname = c_length;
  select convalidated, pg_get_constraintdef(oid) into v_trace_validated, v_trace_def
    from pg_constraint where conrelid = c_table and conname = c_trace;
  select relrowsecurity into v_rls from pg_class where oid = c_table;
  select count(*) into v_policies from pg_policy where polrelid = c_table;
  v_client_privilege := has_table_privilege('anon', c_table, 'select, insert, update, delete')
                     or has_table_privilege('authenticated', c_table, 'select, insert, update, delete');

  select count(*) filter (where planning_model = 'v1'),
         count(*) filter (where planning_model = 'v2')
    into v_v1, v_v2
    from public.training_plan_model_assignments;
  if v_column then
    execute 'select count(*) from public.training_plan_model_assignments
              where planning_model = ''v1'' and (note is null or decided_by is null)' into v_v1_untraced;
  end if;
  select count(*) into v_unassigned from public.athletes a
   where not exists (select 1 from public.training_plan_model_assignments t where t.athlete_id = a.id);

  if not v_migration then v_failed := array_append(v_failed, 'migration_20261027150000_not_recorded'); end if;
  if not v_column then v_failed := array_append(v_failed, 'decided_by_column_missing'); end if;
  if v_length_validated is null then v_failed := array_append(v_failed, 'length_constraint_missing');
  elsif not v_length_validated then v_failed := array_append(v_failed, 'length_constraint_not_valid'); end if;
  if v_trace_validated is null then v_failed := array_append(v_failed, 'trace_constraint_missing');
  else
    if not v_trace_validated then v_failed := array_append(v_failed, 'trace_constraint_not_valid'); end if;
    if regexp_replace(v_trace_def, ' NOT VALID$', '') <> c_trace_def then
      v_failed := array_append(v_failed, 'trace_constraint_definition_changed');
    end if;
  end if;
  if v_v1_untraced is distinct from 0 then v_failed := array_append(v_failed, 'untraced_v1_assignments'); end if;
  if not v_rls or v_policies <> 0 or v_client_privilege then v_failed := array_append(v_failed, 'access_changed'); end if;

  v_counters := format('v1_rows=%s v1_untraced=%s v2_rows=%s athletes_without_assignment=%s trace_constraint_validated=%s rls=%s policies=%s client_privilege=%s',
    v_v1, coalesce(v_v1_untraced::text, 'n/a'), v_v2, v_unassigned, coalesce(v_trace_validated::text, 'missing'),
    v_rls, v_policies, v_client_privilege);

  if cardinality(v_failed) > 0 then
    raise exception using message = 'release_gate_stop: ' || array_to_string(v_failed, ', '),
      detail = v_counters,
      hint = 'Do not deploy generate-training-plan. Trace each v1 row with the real decision (GO Louis, never an invented author), run VALIDATE, then re-run this gate.';
  end if;
  -- athletes_without_assignment is not a gate condition: those accounts get 403 beta_access_not_granted by design
  -- (ADR § 2.4); each one needs Louis's decision (v2 pilot, traced v1 test account, or no access).
  raise notice 'release_gate_go: %', v_counters;
end
$gate$;
