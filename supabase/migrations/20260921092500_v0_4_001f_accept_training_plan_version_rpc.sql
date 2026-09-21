-- V0.4_001F — accept_training_plan_version: moves a draft version to
-- accepted, supersedes whatever was previously the athlete's current
-- version (if any), and moves the training_plan_current_version pointer —
-- all in one transaction, under an athlete-scoped advisory lock. SECURITY
-- DEFINER for the same reason as generate_training_plan_version (v0_4_001e)
-- — see that migration's module doc for the full rationale; not repeated
-- here.
--
-- ===========================================================================
-- Concurrency (M2 persistence closure §L)
-- ===========================================================================
-- pg_advisory_xact_lock keyed on athlete_id alone (training_plan_current_
-- version's own primary key) — simpler than persist_pattern_evidence's
-- 4-component tuple because this table's natural key IS just athlete_id.
-- Two concurrent accept calls for the same athlete serialize against each
-- other; the second to acquire the lock re-reads state fresh and either
-- no-ops (idempotent replay, below) or fails cleanly (target no longer
-- draft). generate_training_plan_version's own lock is keyed differently
-- (athlete_id + generation_request_id) and therefore never blocks against
-- this one — correct, since generate never touches training_plan_current_
-- version or another version's transitions.
--
-- Idempotent: calling accept twice on the SAME already-current version is a
-- no-op, not an error (M2 closure §F).

create or replace function public.accept_training_plan_version(
  p_athlete_id uuid,
  p_plan_version_id uuid
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
  v_previous_current_version_id uuid;
  v_previous_transition_id uuid;
  v_previous_transition_number integer;
  v_accepted_transition_id uuid;
begin
  if p_athlete_id is null then
    raise exception 'accept_training_plan_version: p_athlete_id is required';
  end if;
  if p_plan_version_id is null then
    raise exception 'accept_training_plan_version: p_plan_version_id is required';
  end if;

  -----------------------------------------------------------------------
  -- 0. Athlete-scoped advisory lock — see module doc above.
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
    raise exception 'accept_training_plan_version: plan_version_id % does not exist', p_plan_version_id;
  end if;

  if v_owning_athlete_id <> p_athlete_id then
    raise exception 'accept_training_plan_version: plan_version_id % does not belong to athlete %', p_plan_version_id, p_athlete_id;
  end if;

  select id, transition_number, state
  into v_latest_transition_id, v_latest_transition_number, v_latest_state
  from public.training_plan_version_lifecycle_transitions
  where plan_version_id = p_plan_version_id
  order by transition_number desc
  limit 1;

  if not found then
    raise exception 'accept_training_plan_version: plan_version_id % has no lifecycle transitions (data integrity error)', p_plan_version_id;
  end if;

  select plan_version_id into v_previous_current_version_id
  from public.training_plan_current_version
  where athlete_id = p_athlete_id;

  -----------------------------------------------------------------------
  -- 2. Idempotent no-op: already the current, accepted version.
  -----------------------------------------------------------------------
  if v_latest_state = 'accepted' and v_previous_current_version_id = p_plan_version_id then
    return jsonb_build_object('plan_version_id', p_plan_version_id, 'idempotent_replay', true);
  end if;

  if v_latest_state <> 'draft' then
    raise exception 'accept_training_plan_version: plan_version_id % is not in draft state (current state: %)', p_plan_version_id, v_latest_state;
  end if;

  -----------------------------------------------------------------------
  -- 3. Append the accepted transition for the target version.
  -----------------------------------------------------------------------
  insert into public.training_plan_version_lifecycle_transitions (
    plan_version_id, transition_number, supersedes_id, state
  ) values (
    p_plan_version_id, v_latest_transition_number + 1, v_latest_transition_id, 'accepted'
  )
  returning id into v_accepted_transition_id;

  -----------------------------------------------------------------------
  -- 4. Supersede whatever was previously current, if anything (and it is
  -- not the version we just accepted — already excluded by step 2's no-op).
  -----------------------------------------------------------------------
  if v_previous_current_version_id is not null then
    select id, transition_number
    into v_previous_transition_id, v_previous_transition_number
    from public.training_plan_version_lifecycle_transitions
    where plan_version_id = v_previous_current_version_id
    order by transition_number desc
    limit 1;

    insert into public.training_plan_version_lifecycle_transitions (
      plan_version_id, transition_number, supersedes_id, state, reason
    ) values (
      v_previous_current_version_id, v_previous_transition_number + 1, v_previous_transition_id, 'superseded',
      'superseded by acceptance of plan_version_id ' || p_plan_version_id::text
    );
  end if;

  -----------------------------------------------------------------------
  -- 5. Move the current-version pointer — the one mutable write in this
  -- entire subsystem (training_plan_current_version has no reject_append_
  -- only_mutation trigger, by design).
  -----------------------------------------------------------------------
  insert into public.training_plan_current_version (athlete_id, plan_version_id)
  values (p_athlete_id, p_plan_version_id)
  on conflict (athlete_id) do update set plan_version_id = excluded.plan_version_id;

  return jsonb_build_object(
    'plan_version_id', p_plan_version_id,
    'idempotent_replay', false,
    'accepted_transition_id', v_accepted_transition_id
  );
end;
$$;

revoke all on function public.accept_training_plan_version(uuid, uuid) from public;
revoke all on function public.accept_training_plan_version(uuid, uuid) from anon;
revoke all on function public.accept_training_plan_version(uuid, uuid) from authenticated;
grant execute on function public.accept_training_plan_version(uuid, uuid) to service_role;
