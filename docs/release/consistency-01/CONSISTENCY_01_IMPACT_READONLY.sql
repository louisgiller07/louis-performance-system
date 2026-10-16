-- CONSISTENCY-01 — production IMPACT before any release, READ ONLY (SELECT only). Run by Louis in the SQL Editor,
-- never by Claude Code. ONE statement (the SQL Editor shows only the last result). Aggregated by category: no athlete
-- id, no name, no note text in the output.
--
-- BEFORE RUNNING: replace 00000000-0000-0000-0000-000000000000 below by the simulation athlete's id (the value of
-- VITE_SIMULATION_ATHLETE_ID). It is the only test account the schema lets us prove; every other rider is counted
-- under « other_riders » (test or real: not distinguishable without supposition). Never paste the id back.
--
-- Counts exactly what migration 20261016120000 would supersede at each rider's next projection (the daily-run of
-- that day, or an acceptance) — same predicate as project_training_plan: a manual row written before the rider's
-- current programme became current, dated from today (Europe/Zurich) inside that programme's horizon, on a day not
-- used (no V1 debrief of any status, no guided execution in progress or completed). « replaced » = the programme has
-- a session that day; « removed » = programme rest day. « written_before_first_programme » = the row predates the
-- rider's first ever acceptance (legacy V1 planning / simulation); otherwise it was written under an earlier programme.
-- These riders accepted their current programme BEFORE the acceptance warning existed: none of them consented.
with params as (
  select '00000000-0000-0000-0000-000000000000'::uuid as simulation_athlete_id,
         (now() at time zone 'Europe/Zurich')::date as today
),
superseded as (
  select ps.athlete_id,
         ps.session_type,
         ps.planned_date,
         ps.updated_at,
         (ps.notes is not null and btrim(ps.notes) <> '') as has_note,
         (ps.planned_intent is not null and btrim(ps.planned_intent) <> '') as has_intent,
         ps.is_committed,
         exists (select 1 from public.training_plan_generated_sessions gs
                  where gs.plan_version_id = cv.plan_version_id and gs.date = ps.planned_date) as programme_has_session,
         ps.updated_at < (select min(t.created_at)
                            from public.training_plan_version_lifecycle_transitions t
                            join public.training_plan_versions tv on tv.id = t.plan_version_id
                           where tv.athlete_id = ps.athlete_id and t.state = 'accepted') as written_before_first_programme,
         case when ps.athlete_id = params.simulation_athlete_id then 'simulation_account' else 'other_riders' end as category
    from public.planned_sessions ps
    join public.training_plan_current_version cv on cv.athlete_id = ps.athlete_id
    join public.training_plan_versions v on v.id = cv.plan_version_id
   cross join params
   where ps.source <> 'generated'
     and ps.updated_at < cv.updated_at
     and ps.planned_date >= params.today
     and ps.planned_date between v.horizon_start_date and v.horizon_end_date
     and not exists (select 1 from public.completed_sessions c where c.athlete_id = ps.athlete_id and c.session_date = ps.planned_date)
     and not exists (
       select 1 from public.session_executions e
        where e.athlete_id = ps.athlete_id and e.session_date = ps.planned_date
          and (exists (select 1 from public.execution_events ev where ev.execution_id = e.id and ev.event_type = 'completed')
               or not exists (select 1 from public.execution_events ev where ev.execution_id = e.id and ev.event_type in ('completed', 'abandoned'))))
)
select category,
       count(distinct athlete_id) as riders,
       count(*) as future_rows_superseded,
       count(*) filter (where programme_has_session) as replaced_by_programme_session,
       count(*) filter (where not programme_has_session) as removed_on_programme_rest_day,
       count(*) filter (where session_type in ('DH_TECHNICAL', 'DH_PERFORMANCE')) as dh_rows,
       count(*) filter (where has_note) as rows_with_note,
       count(*) filter (where has_intent) as rows_with_intent,
       count(*) filter (where is_committed) as rows_committed,
       count(*) filter (where written_before_first_programme) as written_before_first_programme,
       count(*) filter (where not written_before_first_programme) as written_under_earlier_programme,
       min(planned_date) as first_date,
       max(planned_date) as last_date,
       min(updated_at)::date as oldest_write,
       max(updated_at)::date as newest_write
  from superseded
 group by category
 order by category;
