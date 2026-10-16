-- CONSISTENCY-01 — production IMPACT before any release, READ ONLY (SELECT only). Run by Louis in the SQL Editor,
-- never by Claude Code. Aggregated: no athlete id, no personal data. One statement (the SQL Editor shows only the last).
--
-- Counts the manual planned_sessions rows that migration 20261016120000 would supersede at each rider's next projection
-- (acceptance, or the daily-run of today): manual rows written before the rider's current programme became current,
-- dated from today (Europe/Zurich) inside that programme's horizon, on a day not used (no guided execution, no V1
-- debrief other than skipped). « replaced » = the programme has a session that day; « removed » = programme rest day.
-- Rows dated before today, outside the horizon, or written after the acceptance are not counted (never touched).
with today as (select (now() at time zone 'Europe/Zurich')::date as d),
superseded as (
  select ps.athlete_id, ps.planned_date, ps.session_type,
         exists (select 1 from public.training_plan_generated_sessions gs
                  where gs.plan_version_id = cv.plan_version_id and gs.date = ps.planned_date) as programme_has_session
    from public.planned_sessions ps
    join public.training_plan_current_version cv on cv.athlete_id = ps.athlete_id
    join public.training_plan_versions v on v.id = cv.plan_version_id
   cross join today
   where ps.source <> 'generated'
     and ps.updated_at < cv.updated_at
     and ps.planned_date >= today.d
     and ps.planned_date between v.horizon_start_date and v.horizon_end_date
     and not exists (select 1 from public.session_executions e where e.athlete_id = ps.athlete_id and e.session_date = ps.planned_date)
     and not exists (select 1 from public.completed_sessions c where c.athlete_id = ps.athlete_id and c.session_date = ps.planned_date)
)
select count(*) as rows_superseded,
       count(*) filter (where programme_has_session) as replaced_by_programme_session,
       count(*) filter (where not programme_has_session) as removed_programme_rest_day,
       count(*) filter (where session_type in ('DH_TECHNICAL', 'DH_PERFORMANCE')) as of_which_dh,
       count(distinct athlete_id) as riders,
       min(planned_date) as first_date,
       max(planned_date) as last_date
  from superseded;
