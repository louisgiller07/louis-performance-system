-- PHYS-03 — precondition of a COMPLETE rollback of daily-run to REL-01 D (read-only, aggregated, no personal data).
-- Run in the SQL Editor (Louis) BEFORE any daily-run rollback to D. Never run by Claude Code in Production.
-- Supersedes docs/release/phys02-rollback/ROLLBACK_TO_D_PRECONDITION.sql (same intervals count, plus power).
--
-- AEROBIC_INTERVALS: D raises a contract error on a day M1 lowers it to LIGHT (nothing persisted that day).
-- POWER: D serves it without error but WITHOUT the PHYS-03 fatigue hold: on a day M1 flags legs / grip fatigue
-- (C3.6 / C3.5) D prescribes the power session anyway, and D's web cannot record or complete it (read only).
-- Manual sessions of either kind are not a blocker: D refuses them explicitly (manual_kind_not_supported).
--
-- Expected for a complete rollback: intervals_sessions_ahead = 0 AND power_sessions_ahead = 0.
with params as (
  select (now() at time zone 'Europe/Zurich')::date as from_date
)
select count(*) filter (where g.kind = 'AEROBIC_INTERVALS') as intervals_sessions_ahead,
       count(*) filter (where g.kind = 'POWER') as power_sessions_ahead,
       count(distinct c.athlete_id) as riders_concerned,
       max(g.date) as last_session_date
from public.training_plan_current_version c
join public.training_plan_generated_sessions g on g.plan_version_id = c.plan_version_id
cross join params p
where g.kind in ('AEROBIC_INTERVALS', 'POWER')
  and g.date >= p.from_date;
