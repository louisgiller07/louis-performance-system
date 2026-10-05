-- UX-11R.9 — stale plan acceptance guard (local, not pushed).
--
-- F-4: when the athlete has a current accepted plan, a draft is accepted only
-- if candidate.generated_at > current.generated_at (equal or older → stale):
-- SQLSTATE NX102, message `stale_plan_version` (the Edge Function maps the
-- SQLSTATE to HTTP 409, never the text). The check runs under the existing
-- athlete-scoped advisory lock, after the idempotent replay (accepting the
-- current version again stays `idempotent_replay`) and the draft check, and
-- before any lifecycle transition: a refusal writes nothing. Two concurrent
-- acceptances serialize on the lock; the second re-reads the current version
-- and is refused if its candidate became stale. First plan (no current
-- version): unchanged. Ordering: training_plan_versions.generated_at only (no
-- second ranking system).
--
-- Additive: function body only. Replaces the V0.4_001F version
-- (20260921092500, left unchanged).
-- Rollback script: supabase/rollbacks/ux11r9/20261005121000_rollback_accept_training_plan_version.sql

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
  v_candidate_generated_at timestamptz;
  v_current_generated_at timestamptz;
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

  -- UX-11R.9 (F-4) — a draft never replaces a current plan generated at the
  -- same time or later: the candidate must be strictly more recent
  -- (training_plan_versions.generated_at, the existing canonical order). Read
  -- under this function's athlete lock, after the idempotent replay and the
  -- draft check, before any transition is written. Restoring an older plan
  -- is a separate, explicit feature. Dedicated SQLSTATE: the Edge Function
  -- maps the code, never the message text.
  if v_previous_current_version_id is not null then
    select generated_at into v_candidate_generated_at
      from public.training_plan_versions where id = p_plan_version_id;
    select generated_at into v_current_generated_at
      from public.training_plan_versions where id = v_previous_current_version_id;
    if v_candidate_generated_at <= v_current_generated_at then
      raise exception using errcode = 'NX102', message = 'stale_plan_version';
    end if;
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
