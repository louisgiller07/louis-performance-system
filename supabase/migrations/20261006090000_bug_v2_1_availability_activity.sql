-- BUG-V2-1 — physical vs riding availability.
--
-- athlete_availability_windows (V0.4_004B) holds ONE generic kind of recurring
-- window: the planner could not tell "1 h 30 for strength on Monday evening"
-- from "a full riding day on Saturday", and placed DH on any free weekday
-- window. Each window now says what it can host:
--   - 'physical' : off-bike training (strength, home trainer / running endurance);
--   - 'riding'   : on the bike / on terrain (DH, outdoor endurance);
--   - 'any'      : both — every row written before this migration, so legacy
--                  athletes keep exactly their previous planning behavior
--                  (absence of typed data never means "unavailable").
-- A day may carry a physical window, a riding window, both, or none.
--
-- Additive only: one column with a default, no row rewritten by hand, no
-- constraint on existing data beyond the value domain. RLS, grants and the
-- updated_at trigger of the table are unchanged and cover the new column.

alter table public.athlete_availability_windows
  add column activity text not null default 'any';

alter table public.athlete_availability_windows
  add constraint athlete_availability_windows_activity_check
  check (activity in ('any', 'physical', 'riding'));

comment on column public.athlete_availability_windows.activity is
  'BUG-V2-1 — what the window can host: physical (off-bike), riding (on the bike / terrain) or any (both; legacy rows).';
