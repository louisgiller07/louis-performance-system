-- V0.4_001B — training_plan_version_lifecycle_transitions +
-- training_plan_current_version: the lifecycle half of M0's locked split
-- (TrainingPlanVersion = content, this table = status). Mirrors
-- pattern_evidence_lifecycle_transitions' already-proven shape almost
-- exactly (same predecessor-chain hardening, same double-layer append-only
-- immutability, same least-privilege grants) — see
-- 20260826090000_M5_006B_pattern_evidence_lifecycle_transitions.sql, the
-- direct precedent this migration adapts.
--
-- A plan version's current status is always its latest transition, never a
-- stored field on training_plan_versions itself (M0 Issue 2).
--
-- ===========================================================================
-- training_plan_current_version — the one deliberately mutable table
-- ===========================================================================
-- M0's locked model forbids a status column on TrainingPlanVersion, but
-- "which version is currently accepted for this athlete" still needs an
-- O(1), DB-enforced "at most one" answer. This table is that answer,
-- factored out on its own — athlete_id IS the primary key, which alone
-- makes "at most one current version per athlete" structurally impossible
-- to violate. It is the single mutable row in this entire subsystem, by
-- design; every other table here is insert-only. See M2 persistence
-- closure §F/§B for the full reasoning.

create type public.training_plan_lifecycle_state as enum (
  'draft',
  'accepted',
  'superseded',
  'abandoned'
);

create table public.training_plan_version_lifecycle_transitions (
  id uuid primary key default gen_random_uuid(),
  plan_version_id uuid not null references public.training_plan_versions (id) on delete restrict,
  transition_number integer not null,
  supersedes_id uuid references public.training_plan_version_lifecycle_transitions (id) on delete restrict,
  state public.training_plan_lifecycle_state not null,
  reason text,
  created_at timestamptz not null default clock_timestamp(),

  constraint training_plan_version_lifecycle_transitions_number_check check (transition_number >= 1),
  constraint training_plan_version_lifecycle_transitions_supersedes_consistency check (
    (transition_number = 1 and supersedes_id is null)
    or (transition_number > 1 and supersedes_id is not null)
  ),
  -- superseded/abandoned are terminal and must explain why (never silent);
  -- draft/accepted carry no reason — there is nothing yet to explain.
  constraint training_plan_version_lifecycle_transitions_reason_shape check (
    (state in ('superseded', 'abandoned') and reason is not null and length(trim(reason)) > 0)
    or (state in ('draft', 'accepted') and reason is null)
  ),
  constraint training_plan_version_lifecycle_transitions_unique_transition unique (plan_version_id, transition_number)
);

-- No-fork guarantee: a transition may be superseded by at most one successor.
create unique index idx_training_plan_version_lifecycle_transitions_supersedes_unique
  on public.training_plan_version_lifecycle_transitions (supersedes_id)
  where supersedes_id is not null;

-- Supports "current lifecycle state" lookups (highest transition_number per
-- version) — the exact access pattern accept_training_plan_version
-- (v0_4_001f) uses.
create index idx_training_plan_version_lifecycle_transitions_current
  on public.training_plan_version_lifecycle_transitions (plan_version_id, transition_number desc);

-- ===========================================================================
-- Predecessor-chain hardening — exact same strength/shape as
-- check_pattern_evidence_lifecycle_predecessor (M5_006B). Validates only
-- what the RPC proposes; transition_number allocation itself remains
-- exclusively RPC-owned under the athlete's advisory lock (see
-- accept_training_plan_version, v0_4_001f).
-- ===========================================================================
create or replace function public.check_training_plan_lifecycle_predecessor() returns trigger
  language plpgsql
  as $$
declare
  v_predecessor_plan_version_id uuid;
  v_predecessor_transition_number integer;
begin
  if NEW.transition_number = 1 then
    if NEW.supersedes_id is not null then
      raise exception 'training_plan_version_lifecycle_transitions: transition 1 must have supersedes_id NULL (got %)', NEW.supersedes_id;
    end if;
    if NEW.state <> 'draft' then
      raise exception 'training_plan_version_lifecycle_transitions: transition 1 must have state=draft (got %)', NEW.state;
    end if;
    return NEW;
  end if;

  -- transition_number > 1 here (transition_number >= 1 already enforced by the table CHECK).
  if NEW.supersedes_id is null then
    raise exception 'training_plan_version_lifecycle_transitions: transition % must specify supersedes_id', NEW.transition_number;
  end if;

  select plan_version_id, transition_number
  into v_predecessor_plan_version_id, v_predecessor_transition_number
  from public.training_plan_version_lifecycle_transitions
  where id = NEW.supersedes_id;

  if not found then
    raise exception 'training_plan_version_lifecycle_transitions: supersedes_id % does not reference an existing transition', NEW.supersedes_id;
  end if;

  if v_predecessor_plan_version_id <> NEW.plan_version_id then
    raise exception 'training_plan_version_lifecycle_transitions: supersedes_id % belongs to a different plan_version_id (% expected %)',
      NEW.supersedes_id, v_predecessor_plan_version_id, NEW.plan_version_id;
  end if;

  if v_predecessor_transition_number <> NEW.transition_number - 1 then
    raise exception 'training_plan_version_lifecycle_transitions: supersedes_id % is transition %, but transition % may only supersede its immediate predecessor (transition %)',
      NEW.supersedes_id, v_predecessor_transition_number, NEW.transition_number, NEW.transition_number - 1;
  end if;

  return NEW;
end;
$$;

create trigger trg_training_plan_version_lifecycle_transitions_predecessor_check
  before insert on public.training_plan_version_lifecycle_transitions
  for each row execute function public.check_training_plan_lifecycle_predecessor();

-- reject_append_only_mutation() already exists (M5_006A) — reused verbatim.
create trigger trg_training_plan_version_lifecycle_transitions_no_update
  before update on public.training_plan_version_lifecycle_transitions
  for each row execute function public.reject_append_only_mutation();

create trigger trg_training_plan_version_lifecycle_transitions_no_delete
  before delete on public.training_plan_version_lifecycle_transitions
  for each row execute function public.reject_append_only_mutation();

alter table public.training_plan_version_lifecycle_transitions enable row level security;

create policy "training_plan_version_lifecycle_transitions_own_select"
  on public.training_plan_version_lifecycle_transitions
  for select
  to authenticated
  using (
    plan_version_id in (
      select tpv.id
      from public.training_plan_versions tpv
      where tpv.athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
    )
  );

revoke all privileges on public.training_plan_version_lifecycle_transitions from anon;
revoke all privileges on public.training_plan_version_lifecycle_transitions from authenticated;
revoke all privileges on public.training_plan_version_lifecycle_transitions from service_role;

grant select on public.training_plan_version_lifecycle_transitions to authenticated;
grant select on public.training_plan_version_lifecycle_transitions to service_role;
-- No insert grant even for service_role — the only writer is
-- generate_training_plan_version (first transition) and
-- accept_training_plan_version (subsequent transitions), both SECURITY
-- DEFINER (v0_4_001e/f).

-- ===========================================================================
-- training_plan_current_version
-- ===========================================================================
create table public.training_plan_current_version (
  athlete_id uuid primary key references public.athletes(id) on delete restrict,
  plan_version_id uuid not null,
  updated_at timestamptz not null default now(),

  constraint training_plan_current_version_fk
    foreign key (plan_version_id, athlete_id)
    references public.training_plan_versions (id, athlete_id)
    on delete restrict
);

-- public.set_updated_at() already exists (used by athlete_onboarding_profiles
-- and others) — reused verbatim, not redefined.
create trigger trg_training_plan_current_version_updated_at
  before update on public.training_plan_current_version
  for each row execute function public.set_updated_at();

alter table public.training_plan_current_version enable row level security;

create policy "training_plan_current_version_own_select"
  on public.training_plan_current_version
  for select
  to authenticated
  using (
    athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
  );

revoke all privileges on public.training_plan_current_version from anon;
revoke all privileges on public.training_plan_current_version from authenticated;
revoke all privileges on public.training_plan_current_version from service_role;

grant select on public.training_plan_current_version to authenticated;
grant select on public.training_plan_current_version to service_role;
-- No insert/update grant even for service_role: the only legitimate writer
-- is accept_training_plan_version (v0_4_001f), a SECURITY DEFINER RPC. This
-- table intentionally has NO reject_append_only_mutation trigger — it is
-- the one deliberately mutable row per athlete in this subsystem.
