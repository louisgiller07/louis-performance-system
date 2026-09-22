-- V0.4_004C — athlete_locked_dates (Performance Setup, V0.4_018A) —
-- PlanInputLockedDate: a date the athlete/coach has flagged as fully
-- off-limits to the planner, still counted for recovery-spacing purposes
-- even though no session may be generated on it
-- (planning-engine/src/types/planInputSnapshot.ts). Distinct concept from
-- athlete_availability_exceptions (available: false there means "cannot
-- train that day at all"; a locked date can be a day the athlete IS
-- otherwise available but the planner must not schedule content on, e.g. a
-- coach-reserved rest day) — kept as its own table rather than folded into
-- exceptions, matching V0.4_018A's own separation.

create table public.athlete_locked_dates (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,

  date date not null,
  reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint athlete_locked_dates_unique_athlete_date
    unique (athlete_id, date)
);

create trigger trg_athlete_locked_dates_updated_at
  before update on public.athlete_locked_dates
  for each row execute function public.set_updated_at();

alter table public.athlete_locked_dates enable row level security;

create policy "athlete_locked_dates_own_data"
  on public.athlete_locked_dates
  for all
  to authenticated
  using (
    athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
  )
  with check (
    athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
  );

revoke all privileges on public.athlete_locked_dates from anon;
revoke all privileges on public.athlete_locked_dates from authenticated;
revoke all privileges on public.athlete_locked_dates from service_role;

grant select, insert, update, delete on public.athlete_locked_dates to authenticated;
grant select, insert, update on public.athlete_locked_dates to service_role;
