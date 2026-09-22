-- V0.4_004B — athlete_availability_windows / athlete_availability_exceptions
-- (Performance Setup, V0.4_018A) — the recurring-availability model that
-- weekly_availability (baseline V0.2) cannot represent.
--
-- Confirmé par audit (V0.4_101) : weekly_availability est un instantané daté
-- par semaine (week_start_date + 8 créneaux nommés fixes), jamais une
-- disponibilité récurrente indépendante d'une semaine précise. Structurellement
-- incompatible avec PlanInputAvailabilityWindow/PlanInputAvailabilityException
-- (planning-engine/src/types/planInputSnapshot.ts) — pas remplacé, laissé
-- intact, jamais réutilisé.
--
-- Deux tables, pas une seule avec discriminant : mêmes raisons de forme que
-- training_plan_planned_prescriptions / decision_final_prescriptions
-- (v0_4_001d) — un "window récurrent" et une "exception ponctuelle" ont des
-- colonnes obligatoires disjointes (day_of_week/start_time/end_time vs
-- date/available), pas de précédent dans ce schéma pour une table à colonnes
-- nullables-selon-discriminant.
--
-- Multi-lignes par athlète (comme race_calendar), donc athlete_id n'est pas
-- la clé primaire ici, contrairement à athlete_performance_profiles.

create table public.athlete_availability_windows (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,

  day_of_week smallint not null,
  start_time time not null,
  end_time time not null,
  label text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint athlete_availability_windows_day_of_week_range
    check (day_of_week between 0 and 6),
  constraint athlete_availability_windows_time_order
    check (end_time > start_time)
);

create index idx_athlete_availability_windows_athlete
  on public.athlete_availability_windows (athlete_id, day_of_week);

create trigger trg_athlete_availability_windows_updated_at
  before update on public.athlete_availability_windows
  for each row execute function public.set_updated_at();

alter table public.athlete_availability_windows enable row level security;

create policy "athlete_availability_windows_own_data"
  on public.athlete_availability_windows
  for all
  to authenticated
  using (
    athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
  )
  with check (
    athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
  );

revoke all privileges on public.athlete_availability_windows from anon;
revoke all privileges on public.athlete_availability_windows from authenticated;
revoke all privileges on public.athlete_availability_windows from service_role;

grant select, insert, update, delete on public.athlete_availability_windows to authenticated;
grant select, insert, update on public.athlete_availability_windows to service_role;

-- ===========================================================================

create table public.athlete_availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,

  date date not null,
  available boolean not null,
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Une seule exception par athlète et par date — une date ne peut pas être
  -- à la fois "disponible" et "indisponible".
  constraint athlete_availability_exceptions_unique_athlete_date
    unique (athlete_id, date)
);

create trigger trg_athlete_availability_exceptions_updated_at
  before update on public.athlete_availability_exceptions
  for each row execute function public.set_updated_at();

alter table public.athlete_availability_exceptions enable row level security;

create policy "athlete_availability_exceptions_own_data"
  on public.athlete_availability_exceptions
  for all
  to authenticated
  using (
    athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
  )
  with check (
    athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
  );

revoke all privileges on public.athlete_availability_exceptions from anon;
revoke all privileges on public.athlete_availability_exceptions from authenticated;
revoke all privileges on public.athlete_availability_exceptions from service_role;

grant select, insert, update, delete on public.athlete_availability_exceptions to authenticated;
grant select, insert, update on public.athlete_availability_exceptions to service_role;
