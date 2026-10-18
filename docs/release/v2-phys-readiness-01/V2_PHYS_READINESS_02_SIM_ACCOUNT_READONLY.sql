-- V2-PHYS-READINESS-02 — does every V2 signal belong to the internal simulation account? READ ONLY, one statement.
-- Relations used (schema checked): athletes.user_id → auth.users.id (unique); training_plan_current_version,
-- training_plan_model_assignments, session_executions → athletes.id; decision_final_prescriptions (decision_id,
-- athlete_id) → decisions (id, athlete_id). Returns counts and booleans only: no identifier, no other e-mail.
with sim as (
  select a.id
    from public.athletes a
    join auth.users u on u.id = a.user_id
   where lower(trim(u.email)) = 'simulation@nalynt.test'
),
current_v2 as (
  select c.athlete_id
    from public.training_plan_current_version c
    join public.training_plan_versions v on v.id = c.plan_version_id
   where v.prescription_schema_version = 'v2'
),
assigned_v2 as (
  select athlete_id from public.training_plan_model_assignments where planning_model = 'v2'
),
fp_v2_14d as (
  select athlete_id from public.decision_final_prescriptions
   where schema_version = 'v2' and generated_at >= current_date - 14
),
ex as (
  select e.athlete_id, e.session_date,
         not exists (select 1 from public.execution_events ev
                      where ev.execution_id = e.id and ev.event_type in ('completed', 'abandoned')) as is_open
    from public.session_executions e
)
select
  (select count(*) from sim) as sim_athlete_rows,
  (select count(*) from current_v2) as current_v2_total,
  (select count(*) from current_v2 where athlete_id in (select id from sim)) as current_v2_sim,
  (select count(*) from assigned_v2) as assignments_v2_total,
  (select count(*) from assigned_v2 where athlete_id in (select id from sim)) as assignments_v2_sim,
  (select count(*) from fp_v2_14d) as final_prescriptions_v2_14d_total,
  (select count(*) from fp_v2_14d where athlete_id in (select id from sim)) as final_prescriptions_v2_14d_sim,
  (select count(*) from ex) as executions_total,
  (select count(*) from ex where athlete_id in (select id from sim)) as executions_sim,
  (select count(*) from ex where session_date > current_date) as executions_future_total,
  (select count(*) from ex where session_date > current_date and athlete_id in (select id from sim)) as executions_future_sim,
  (select count(*) from ex where session_date = date '2026-11-07') as executions_2026_11_07_total,
  (select count(*) from ex where session_date = date '2026-11-07' and athlete_id in (select id from sim)) as executions_2026_11_07_sim,
  (select count(*) from ex where is_open) as executions_open_total,
  (select count(*) from ex where is_open and athlete_id in (select id from sim)) as executions_open_sim,
  -- Verdict: true only if the simulation account exists once and owns every V2 signal and every future execution.
  (    (select count(*) from sim) = 1
   and not exists (select 1 from current_v2 where athlete_id not in (select id from sim))
   and not exists (select 1 from assigned_v2 where athlete_id not in (select id from sim))
   and not exists (select 1 from fp_v2_14d where athlete_id not in (select id from sim))
   and not exists (select 1 from ex where session_date > current_date and athlete_id not in (select id from sim))
  ) as all_v2_signals_on_simulation_account;
