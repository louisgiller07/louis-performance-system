-- V2-PHYS-READINESS-01 — production V2 inventory, READ ONLY, one statement (the SQL Editor shows the last result only).
-- Counts and dates only: no identifier, no personal data. Validated on a local stack at the production schema (75 migrations).
select
  (select count(*) from public.training_plan_model_assignments where planning_model = 'v2') as assignments_v2,
  (select count(*) from public.training_plan_model_assignments where planning_model = 'v1') as assignments_v1,
  (select count(*) from public.training_plan_current_version c
     join public.training_plan_versions v on v.id = c.plan_version_id
    where v.prescription_schema_version = 'v2') as current_plans_v2,
  (select count(*) from public.training_plan_current_version c
     join public.training_plan_versions v on v.id = c.plan_version_id
    where v.prescription_schema_version = 'v1') as current_plans_v1,
  (select count(*) from public.training_plan_versions where prescription_schema_version = 'v2') as plan_versions_v2_total,
  (select max(generated_at)::date from public.training_plan_versions where prescription_schema_version = 'v2') as last_v2_generation,
  (select count(*) from public.decision_final_prescriptions) as final_prescriptions_total,
  (select count(*) from public.session_executions) as executions_total,
  (select count(*) from public.session_executions e
    where exists (select 1 from public.execution_events ev where ev.execution_id = e.id and ev.event_type = 'completed')) as executions_completed,
  (select count(*) from public.session_executions e
    where exists (select 1 from public.execution_events ev where ev.execution_id = e.id and ev.event_type = 'abandoned')) as executions_abandoned,
  (select count(*) from public.session_executions e
    where not exists (select 1 from public.execution_events ev where ev.execution_id = e.id and ev.event_type in ('completed', 'abandoned'))) as executions_open,
  (select count(distinct athlete_id) from public.session_executions) as athletes_with_executions,
  (select max(session_date) from public.session_executions) as last_execution_date;
