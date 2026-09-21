-- V0.4_001C — training_plan_blocks / training_plan_weeks /
-- training_plan_generated_sessions: the canonical plan hierarchy inside one
-- TrainingPlanVersion (M0 §7/§Issue1). All three are immutable, belong
-- entirely to their (immutable) plan version, and are only ever written
-- together, atomically, by generate_training_plan_version (v0_4_001e).
--
-- ===========================================================================
-- Cross-plan integrity — composite FK chaining goes one level deeper here
-- ===========================================================================
-- training_plan_generated_sessions denormalizes plan_version_id alongside
-- week_id (useful for direct date-range queries without a 3-table join).
-- Left alone, that denormalization would be an unenforced fact — nothing
-- would stop a service bug from inserting a session whose week_id belongs to
-- Plan A while plan_version_id names Plan B. The fix (M2 closure §A) reaches
-- one level deeper than a plain athlete check: training_plan_blocks gets
-- UNIQUE(id, plan_version_id); training_plan_weeks carries its OWN
-- denormalized plan_version_id, chained via composite FK to blocks; sessions'
-- own (week_id, plan_version_id) pair becomes a real composite FK into
-- weeks. A session naming a week from the wrong plan version is now a
-- constraint violation, not a service bug waiting to happen — and this is
-- finer-grained than an athlete-level check would be (it also catches
-- "same athlete, wrong plan").
--
-- training_plan_blocks.mode reuses the EXISTING public.training_mode enum
-- verbatim (RACE_WEEK/RACE_CLUSTER/.../UNSPECIFIED) — confirmed identical to
-- planning-engine's TrainingMode (sharedVocabulary.ts) by direct read of
-- both. This is the vocabulary training_blocks.mode ultimately projects to
-- (M0 Issue 1); reusing the same Postgres type rather than duplicating it
-- means no translation step can silently drift.
--
-- plan_session_kind/plan_load_profile are NEW, dedicated enums — deliberately
-- NOT the existing public.session_type (10 coarse legacy values). CLAUDE.md
-- explicitly forbids replacing/extending session_type with a richer enum;
-- SessionKind (16 values, planning-engine's sharedVocabulary.ts) is a
-- genuinely different, richer vocabulary that belongs to this new subsystem
-- only.

create table public.training_plan_blocks (
  id uuid primary key default gen_random_uuid(),
  plan_version_id uuid not null references public.training_plan_versions (id) on delete restrict,
  sequence_number integer not null,
  name text not null,
  mode public.training_mode not null,
  primary_focus text not null,
  start_date date not null,
  end_date date not null,

  constraint training_plan_blocks_sequence_positive check (sequence_number >= 1),
  constraint training_plan_blocks_date_order check (end_date >= start_date),
  constraint training_plan_blocks_name_not_blank check (length(trim(name)) > 0),
  constraint training_plan_blocks_primary_focus_not_blank check (length(trim(primary_focus)) > 0),
  constraint training_plan_blocks_unique_sequence unique (plan_version_id, sequence_number),
  constraint training_plan_blocks_unique_id_version unique (id, plan_version_id)
);

-- Non-overlap enforcement — new to this schema (no exclusion-constraint
-- precedent exists here), implemented as a BEFORE INSERT trigger for
-- consistency with this project's existing trigger-based-validation style
-- rather than introducing a gist/exclusion index type used nowhere else.
-- Blocks are only ever inserted together, once, by generate_training_plan_
-- version, so a BEFORE INSERT check alone is sufficient (UPDATE is already
-- unconditionally rejected below).
create or replace function public.check_training_plan_block_no_overlap() returns trigger
  language plpgsql
  as $$
declare
  v_conflict_id uuid;
begin
  select id
  into v_conflict_id
  from public.training_plan_blocks
  where plan_version_id = NEW.plan_version_id
    and id <> NEW.id
    and daterange(start_date, end_date, '[]') && daterange(NEW.start_date, NEW.end_date, '[]')
  limit 1;

  if found then
    raise exception 'training_plan_blocks: block % (% .. %) overlaps existing block % within plan_version_id %',
      NEW.id, NEW.start_date, NEW.end_date, v_conflict_id, NEW.plan_version_id;
  end if;

  return NEW;
end;
$$;

create trigger trg_training_plan_blocks_no_overlap
  before insert on public.training_plan_blocks
  for each row execute function public.check_training_plan_block_no_overlap();

create trigger trg_training_plan_blocks_no_update
  before update on public.training_plan_blocks
  for each row execute function public.reject_append_only_mutation();

create trigger trg_training_plan_blocks_no_delete
  before delete on public.training_plan_blocks
  for each row execute function public.reject_append_only_mutation();

alter table public.training_plan_blocks enable row level security;

create policy "training_plan_blocks_own_select"
  on public.training_plan_blocks
  for select
  to authenticated
  using (
    plan_version_id in (
      select tpv.id from public.training_plan_versions tpv
      where tpv.athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
    )
  );

revoke all privileges on public.training_plan_blocks from anon;
revoke all privileges on public.training_plan_blocks from authenticated;
revoke all privileges on public.training_plan_blocks from service_role;

grant select on public.training_plan_blocks to authenticated;
grant select on public.training_plan_blocks to service_role;

-- ===========================================================================
-- training_plan_weeks
-- ===========================================================================
create type public.plan_week_type as enum (
  'development',
  'deload',
  'taper',
  'race',
  'recovery'
);

create table public.training_plan_weeks (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null,
  plan_version_id uuid not null,
  week_number integer not null,
  start_date date not null,
  end_date date not null,
  week_type public.plan_week_type not null,
  dose_summary jsonb not null,
  rationale text not null,

  constraint training_plan_weeks_week_number_positive check (week_number >= 1),
  constraint training_plan_weeks_date_order check (end_date >= start_date),
  constraint training_plan_weeks_rationale_not_blank check (length(trim(rationale)) > 0),
  constraint training_plan_weeks_dose_summary_is_object check (jsonb_typeof(dose_summary) = 'object'),
  constraint training_plan_weeks_unique_week_number unique (block_id, week_number),
  constraint training_plan_weeks_unique_id_version unique (id, plan_version_id),

  constraint training_plan_weeks_block_fk
    foreign key (block_id, plan_version_id)
    references public.training_plan_blocks (id, plan_version_id)
    on delete restrict
);

create trigger trg_training_plan_weeks_no_update
  before update on public.training_plan_weeks
  for each row execute function public.reject_append_only_mutation();

create trigger trg_training_plan_weeks_no_delete
  before delete on public.training_plan_weeks
  for each row execute function public.reject_append_only_mutation();

alter table public.training_plan_weeks enable row level security;

create policy "training_plan_weeks_own_select"
  on public.training_plan_weeks
  for select
  to authenticated
  using (
    plan_version_id in (
      select tpv.id from public.training_plan_versions tpv
      where tpv.athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
    )
  );

revoke all privileges on public.training_plan_weeks from anon;
revoke all privileges on public.training_plan_weeks from authenticated;
revoke all privileges on public.training_plan_weeks from service_role;

grant select on public.training_plan_weeks to authenticated;
grant select on public.training_plan_weeks to service_role;

-- ===========================================================================
-- training_plan_generated_sessions
-- ===========================================================================
create type public.plan_session_kind as enum (
  'STRENGTH_LOWER',
  'STRENGTH_UPPER',
  'STRENGTH_FULL_LIGHT',
  'POWER',
  'GRIP_WORK',
  'AEROBIC_BASE',
  'AEROBIC_INTERVALS',
  'DH_TECHNICAL',
  'DH_PERFORMANCE',
  'DH_LIGHT',
  'PUMPTRACK',
  'MOBILITY',
  'RECOVERY_ACTIVE',
  'REST',
  'BIKE_MAINTENANCE',
  'RACE_ACTIVITY'
);

create type public.plan_load_profile as enum ('HEAVY', 'MODERATE', 'LIGHT');

create table public.training_plan_generated_sessions (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null,
  plan_version_id uuid not null,
  date date not null,
  kind public.plan_session_kind not null,
  load_profile public.plan_load_profile,
  duration_min integer,
  focus text,
  dose_target jsonb not null,
  rationale text not null,
  generation_note text,

  constraint training_plan_generated_sessions_duration_positive check (duration_min is null or duration_min > 0),
  constraint training_plan_generated_sessions_rationale_not_blank check (length(trim(rationale)) > 0),
  constraint training_plan_generated_sessions_dose_target_is_object check (jsonb_typeof(dose_target) = 'object'),
  -- Mirrors M1's own tested invariant (tests/fixtures/invariants.ts,
  -- loadProfilePresenceMatchesKind / sharedVocabulary.LOAD_VARIABLE_SESSION_KINDS):
  -- load-variable kinds require load_profile; fixed-load kinds must not carry one.
  constraint training_plan_generated_sessions_load_profile_matches_kind check (
    (
      kind in (
        'STRENGTH_LOWER', 'STRENGTH_UPPER', 'STRENGTH_FULL_LIGHT', 'POWER', 'GRIP_WORK',
        'AEROBIC_BASE', 'AEROBIC_INTERVALS', 'DH_TECHNICAL', 'DH_PERFORMANCE', 'DH_LIGHT', 'PUMPTRACK'
      )
      and load_profile is not null
    )
    or
    (
      kind in ('MOBILITY', 'RECOVERY_ACTIVE', 'REST', 'BIKE_MAINTENANCE', 'RACE_ACTIVITY')
      and load_profile is null
    )
  ),
  -- V0.4 remains one session per day (M0: general multi-session is
  -- deferred). Scoped to (plan_version_id, date), deliberately NOT reusing
  -- planned_sessions' own (athlete_id, planned_date) constraint, so a later
  -- relaxation doesn't require restructuring this model.
  constraint training_plan_generated_sessions_unique_date unique (plan_version_id, date),
  constraint training_plan_generated_sessions_unique_id_version unique (id, plan_version_id),

  constraint training_plan_generated_sessions_week_fk
    foreign key (week_id, plan_version_id)
    references public.training_plan_weeks (id, plan_version_id)
    on delete restrict
);

create index idx_training_plan_generated_sessions_date
  on public.training_plan_generated_sessions (plan_version_id, date);

create trigger trg_training_plan_generated_sessions_no_update
  before update on public.training_plan_generated_sessions
  for each row execute function public.reject_append_only_mutation();

create trigger trg_training_plan_generated_sessions_no_delete
  before delete on public.training_plan_generated_sessions
  for each row execute function public.reject_append_only_mutation();

alter table public.training_plan_generated_sessions enable row level security;

create policy "training_plan_generated_sessions_own_select"
  on public.training_plan_generated_sessions
  for select
  to authenticated
  using (
    plan_version_id in (
      select tpv.id from public.training_plan_versions tpv
      where tpv.athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
    )
  );

revoke all privileges on public.training_plan_generated_sessions from anon;
revoke all privileges on public.training_plan_generated_sessions from authenticated;
revoke all privileges on public.training_plan_generated_sessions from service_role;

grant select on public.training_plan_generated_sessions to authenticated;
grant select on public.training_plan_generated_sessions to service_role;
