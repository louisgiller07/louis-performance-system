-- V2-PHYS-READINESS-01 — production V2 inventory. READ ONLY: one SELECT statement (the SQL Editor shows the last
-- result only), plain tables, built-in aggregates only; no write, no function with side effects, no setting.
-- Returns one row of counts and dates: no identifier, no name, no personal data.
-- « Current plan » = the row of training_plan_current_version, i.e. exactly what daily-run reads to choose its path
-- (dailyPrescriptionModel.ts: a current V2 plan → V2 daily path, even past its horizon, whatever the V2 flag).
-- Dates compared with current_date (SQL Editor session: UTC).
select
  -- Assignments (training_plan_model_assignments, service_role only).
  (select count(*) from public.training_plan_model_assignments where planning_model = 'v2') as assignments_v2,
  (select count(*) from public.training_plan_model_assignments where planning_model = 'v1') as assignments_v1,
  -- Current plans by prescription schema: what daily-run follows.
  (select count(*) from public.training_plan_current_version c
     join public.training_plan_versions v on v.id = c.plan_version_id
    where v.prescription_schema_version = 'v2') as current_plans_v2,
  (select count(*) from public.training_plan_current_version c
     join public.training_plan_versions v on v.id = c.plan_version_id
    where v.prescription_schema_version = 'v2' and v.horizon_end_date >= current_date) as current_plans_v2_horizon_covering_today,
  (select count(*) from public.training_plan_current_version c
     join public.training_plan_versions v on v.id = c.plan_version_id
    where v.prescription_schema_version = 'v2' and v.horizon_end_date < current_date) as current_plans_v2_horizon_ended,
  (select count(*) from public.training_plan_current_version c
     join public.training_plan_versions v on v.id = c.plan_version_id
    where v.prescription_schema_version = 'v1') as current_plans_v1,
  -- Cross checks: V2 running without a V2 assignment / a V2 assignment without a current V2 plan.
  (select count(*) from public.training_plan_current_version c
     join public.training_plan_versions v on v.id = c.plan_version_id
    where v.prescription_schema_version = 'v2'
      and not exists (select 1 from public.training_plan_model_assignments a where a.athlete_id = c.athlete_id and a.planning_model = 'v2')) as current_v2_without_v2_assignment,
  (select count(*) from public.training_plan_model_assignments a
    where a.planning_model = 'v2'
      and not exists (select 1 from public.training_plan_current_version c
                        join public.training_plan_versions v on v.id = c.plan_version_id
                       where c.athlete_id = a.athlete_id and v.prescription_schema_version = 'v2')) as v2_assignment_without_current_v2,
  -- Pointer sanity: a current plan whose latest lifecycle state is not 'accepted' (expected 0).
  (select count(*) from public.training_plan_current_version c
    where (select t.state from public.training_plan_version_lifecycle_transitions t
            where t.plan_version_id = c.plan_version_id
            order by t.transition_number desc limit 1) is distinct from 'accepted') as current_pointer_not_accepted,
  -- V2 generations ever made, and the last one.
  (select count(*) from public.training_plan_versions where prescription_schema_version = 'v2') as plan_versions_v2_total,
  (select max(generated_at)::date from public.training_plan_versions where prescription_schema_version = 'v2') as last_v2_generation_date,
  -- Daily V2 activity: final prescriptions V2 written by daily-run on the V2 path (other schema versions counted apart).
  (select count(*) from public.decision_final_prescriptions where schema_version = 'v2') as final_prescriptions_v2_total,
  (select count(*) from public.decision_final_prescriptions where schema_version is distinct from 'v2') as final_prescriptions_other_schema,
  (select count(*) from public.decision_final_prescriptions where schema_version = 'v2' and generated_at >= current_date - 14) as final_prescriptions_v2_last_14_days,
  (select count(distinct athlete_id) from public.decision_final_prescriptions where schema_version = 'v2' and generated_at >= current_date - 14) as athletes_with_final_prescription_v2_last_14_days,
  (select max(generated_at)::date from public.decision_final_prescriptions where schema_version = 'v2') as last_final_prescription_v2_date,
  -- Guided executions by lifecycle (completed and abandoned are terminal and mutually exclusive).
  (select count(*) from public.session_executions) as executions_total,
  (select count(*) from public.session_executions e
    where exists (select 1 from public.execution_events ev where ev.execution_id = e.id and ev.event_type = 'completed')) as executions_completed,
  (select count(*) from public.session_executions e
    where exists (select 1 from public.execution_events ev where ev.execution_id = e.id and ev.event_type = 'abandoned')) as executions_abandoned,
  (select count(*) from public.session_executions e
    where not exists (select 1 from public.execution_events ev where ev.execution_id = e.id and ev.event_type in ('completed', 'abandoned'))) as executions_open,
  (select count(*) from public.session_executions e
    where e.session_date < current_date
      and not exists (select 1 from public.execution_events ev where ev.execution_id = e.id and ev.event_type in ('completed', 'abandoned'))) as executions_open_from_past_days,
  (select count(distinct athlete_id) from public.session_executions) as athletes_with_executions,
  (select max(session_date) from public.session_executions) as last_execution_date;
