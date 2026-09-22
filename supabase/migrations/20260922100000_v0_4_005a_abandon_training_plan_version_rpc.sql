-- V0.4_005A — abandon_training_plan_version: moves a draft version to
-- abandoned. Same pattern as accept_training_plan_version (v0_4_001f) —
-- athlete-scoped advisory lock, ownership check, freshness re-check,
-- SECURITY DEFINER. training_plan_version_lifecycle_transitions grants no
-- INSERT to service_role at all (v0_4_001b) — generate_training_plan_version
-- and accept_training_plan_version are its only writers today; this function
-- becomes the third, for exactly the same reason.
--
-- Unlike accept, abandon never touches training_plan_current_version — a
-- draft is by construction never the athlete's current accepted version
-- (v0_4_001b: "the only legitimate writer is accept_training_plan_version").
--
-- Idempotent: calling abandon twice on the SAME already-abandoned version is
-- a no-op, not an error (V0.4_102 decision) — mirrors accept's own
-- idempotence exactly, including that the idempotent-replay path does not
-- compare the second call's p_reason against the first; it is still
-- validated for non-blankness, but not for equality.
--
-- p_reason is mandatory. training_plan_version_lifecycle_transitions_
-- reason_shape (v0_4_001b) already requires a non-blank reason for
-- 'abandoned' transitions at the CHECK level; this function rejects a
-- missing/blank reason itself, before that CHECK is ever reached, for a
-- clearer error message — same "TypeScript/PL/pgSQL validates early, CHECK
-- is the backstop" discipline used throughout this schema.
--
-- Explicitly out of scope (V0.4_102 decision) — the draft->superseded case
-- already declared valid by VALID_LIFECYCLE_TRANSITIONS
-- (planning-engine/src/types/planLifecycle.ts) but not implemented by any
-- RPC: if a DIFFERENT version is accepted while this draft is still
-- pending, this draft is neither abandoned nor superseded by that
-- acceptance — it stays in draft indefinitely unless explicitly abandoned.
-- This function does not change that. A separate, global lifecycle
-- decision is needed before any RPC writes a draft->superseded transition.

create or replace function public.abandon_training_plan_version(
  p_athlete_id uuid,
  p_plan_version_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owning_athlete_id uuid;
  v_latest_transition_id uuid;
  v_latest_transition_number integer;
  v_latest_state public.training_plan_lifecycle_state;
  v_abandoned_transition_id uuid;
begin
  if p_athlete_id is null then
    raise exception 'abandon_training_plan_version: p_athlete_id is required';
  end if;
  if p_plan_version_id is null then
    raise exception 'abandon_training_plan_version: p_plan_version_id is required';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'abandon_training_plan_version: p_reason is required and must not be blank';
  end if;

  -----------------------------------------------------------------------
  -- 0. Athlete-scoped advisory lock — same key as accept_training_plan_
  -- version (v0_4_001f), so a concurrent accept/abandon pair for the same
  -- athlete serializes against each other rather than racing.
  -----------------------------------------------------------------------
  perform pg_advisory_xact_lock(hashtextextended(
    length(p_athlete_id::text)::text || ':' || p_athlete_id::text,
    0
  ));

  -----------------------------------------------------------------------
  -- 1. Ownership + current lifecycle state of the target version.
  -----------------------------------------------------------------------
  select athlete_id into v_owning_athlete_id
  from public.training_plan_versions
  where id = p_plan_version_id;

  if not found then
    raise exception 'abandon_training_plan_version: plan_version_id % does not exist', p_plan_version_id;
  end if;

  if v_owning_athlete_id <> p_athlete_id then
    raise exception 'abandon_training_plan_version: plan_version_id % does not belong to athlete %', p_plan_version_id, p_athlete_id;
  end if;

  select id, transition_number, state
  into v_latest_transition_id, v_latest_transition_number, v_latest_state
  from public.training_plan_version_lifecycle_transitions
  where plan_version_id = p_plan_version_id
  order by transition_number desc
  limit 1;

  if not found then
    raise exception 'abandon_training_plan_version: plan_version_id % has no lifecycle transitions (data integrity error)', p_plan_version_id;
  end if;

  -----------------------------------------------------------------------
  -- 2. Idempotent no-op: already abandoned.
  -----------------------------------------------------------------------
  if v_latest_state = 'abandoned' then
    return jsonb_build_object('plan_version_id', p_plan_version_id, 'idempotent_replay', true);
  end if;

  if v_latest_state <> 'draft' then
    raise exception 'abandon_training_plan_version: plan_version_id % is not in draft state (current state: %)', p_plan_version_id, v_latest_state;
  end if;

  -----------------------------------------------------------------------
  -- 3. Append the abandoned transition.
  -----------------------------------------------------------------------
  insert into public.training_plan_version_lifecycle_transitions (
    plan_version_id, transition_number, supersedes_id, state, reason
  ) values (
    p_plan_version_id, v_latest_transition_number + 1, v_latest_transition_id, 'abandoned', p_reason
  )
  returning id into v_abandoned_transition_id;

  return jsonb_build_object(
    'plan_version_id', p_plan_version_id,
    'idempotent_replay', false,
    'abandoned_transition_id', v_abandoned_transition_id
  );
end;
$$;

revoke all on function public.abandon_training_plan_version(uuid, uuid, text) from public;
revoke all on function public.abandon_training_plan_version(uuid, uuid, text) from anon;
revoke all on function public.abandon_training_plan_version(uuid, uuid, text) from authenticated;
grant execute on function public.abandon_training_plan_version(uuid, uuid, text) to service_role;
