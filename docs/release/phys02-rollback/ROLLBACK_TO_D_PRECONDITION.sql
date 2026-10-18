-- PHYS-02.1 — precondition of a COMPLETE rollback of daily-run to REL-01 D (read-only, aggregated, no personal data).
-- Run in the SQL Editor (Louis) BEFORE any daily-run rollback to D. Never run by Claude Code in Production.
--
-- D cannot adapt a planned AEROBIC_INTERVALS session: on a day M1 lowers it to LIGHT, D's daily run raises a
-- contract error and nothing is persisted that day (proven on D's real code). The rollback is complete-safe
-- only when NO current plan still holds an intervals session on or after the product date (Europe/Zurich).
-- Manual intervals sessions are not a blocker: D refuses them explicitly (manual_kind_not_supported).
--
-- Expected for a complete rollback: intervals_sessions_ahead = 0 (then riders_concerned = 0).
with params as (
  select (now() at time zone 'Europe/Zurich')::date as from_date
)
select count(*) as intervals_sessions_ahead,
       count(distinct c.athlete_id) as riders_concerned,
       max(g.date) as last_intervals_date
from public.training_plan_current_version c
join public.training_plan_generated_sessions g on g.plan_version_id = c.plan_version_id
cross join params p
where g.kind = 'AEROBIC_INTERVALS'
  and g.date >= p.from_date;
