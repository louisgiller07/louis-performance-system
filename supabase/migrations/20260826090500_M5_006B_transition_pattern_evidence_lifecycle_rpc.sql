-- M5_006B — transition_pattern_evidence_lifecycle: atomic, append-only,
-- concurrency-safe RPC for changing (or confirming) one evidence identity's
-- active/withdrawn lifecycle state. See docs/11_DECISION_LOG.md (M5_006B).
--
-- Security contract: identical rigor to persist_pattern_evidence —
-- SECURITY INVOKER, EXECUTE reserved to service_role, p_athlete_id is the
-- sole ownership source of truth (used only to derive the identity lock key
-- here; the identity lookup itself is scoped by the full natural key, not
-- by athlete_id alone).
--
-- ===========================================================================
-- Identity lock — EXACT SAME algorithm as persist_pattern_evidence
-- ===========================================================================
-- Same pg_advisory_xact_lock, same length-prefixed 4-component tuple
-- (athlete_id/detector_rule_id/detector_rule_version/evidence_key), same
-- hashtextextended call — a lifecycle transition for a given identity and
-- an evidence write for that SAME identity always serialize against each
-- other, never just against other lifecycle calls. This is what lets
-- persist_active_pattern_evidence (a later migration) compose the two RPCs
-- inside one transaction and have the lock acquired by the first call
-- remain held (pg_advisory_xact_lock is transaction-scoped, not
-- call-scoped) for the second — no separate coordination needed. Never
-- SELECT ... FOR UPDATE — see persist_pattern_evidence's own migration for
-- the empirical reason that mechanism was rejected.
--
-- ===========================================================================
-- Effective state / exact transition matrix
-- ===========================================================================
-- An identity with ZERO lifecycle rows is implicitly 'active'. Given
-- p_target_state and the identity's current effective state:
--   target=withdrawn, no identity found            -> skipped_no_prior (no write)
--   target=active,    no identity found             -> structural error (raise exception)
--   target=active,    current=active (implicit or explicit) -> unchanged
--   target=active,    current=withdrawn             -> insert an 'active' transition
--   target=withdrawn, current=active (implicit or explicit) -> insert a 'withdrawn' transition
--   target=withdrawn, current=withdrawn, same reason_code AND jsonb-equal context -> unchanged
--   target=withdrawn, current=withdrawn, changed reason_code or context -> insert another 'withdrawn' transition
-- No application-side SELECT-then-INSERT: the whole decision is made and
-- acted on inside this one function call, under the lock.

create or replace function public.transition_pattern_evidence_lifecycle(
  p_athlete_id uuid,
  p_detector_rule_id text,
  p_detector_rule_version text,
  p_evidence_key text,
  p_target_state public.pattern_evidence_lifecycle_state,
  p_reason_code text,
  p_context jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_identity_id uuid;

  v_latest_id uuid;
  v_latest_number integer;
  v_latest_state public.pattern_evidence_lifecycle_state;
  v_latest_reason_code text;
  v_latest_context jsonb;

  v_current_state public.pattern_evidence_lifecycle_state;
  v_reason_code text;
  v_context jsonb;

  v_new_id uuid;
  v_new_number integer;
begin
  -----------------------------------------------------------------------
  -- Required scalar fields.
  -----------------------------------------------------------------------
  if p_athlete_id is null then
    raise exception 'transition_pattern_evidence_lifecycle: p_athlete_id is required';
  end if;
  if p_detector_rule_id is null or length(trim(p_detector_rule_id)) = 0 then
    raise exception 'transition_pattern_evidence_lifecycle: p_detector_rule_id is required and must be non-blank';
  end if;
  if p_detector_rule_version is null or length(trim(p_detector_rule_version)) = 0 then
    raise exception 'transition_pattern_evidence_lifecycle: p_detector_rule_version is required and must be non-blank';
  end if;
  if p_evidence_key is null or length(trim(p_evidence_key)) = 0 then
    raise exception 'transition_pattern_evidence_lifecycle: p_evidence_key is required and must be non-blank';
  end if;
  if p_target_state is null then
    raise exception 'transition_pattern_evidence_lifecycle: p_target_state is required';
  end if;

  -----------------------------------------------------------------------
  -- Normalize reason_code/context to the fixed shape each state requires —
  -- 'active' NEVER carries a reason/context regardless of what was passed;
  -- 'withdrawn' requires a real reason_code and defaults a null context to
  -- '{}'::jsonb. The table's own CHECK constraints re-validate this
  -- independently at the schema layer (defense in depth).
  -----------------------------------------------------------------------
  if p_target_state = 'active' then
    v_reason_code := null;
    v_context := '{}'::jsonb;
  else
    if p_reason_code is null or length(trim(p_reason_code)) = 0 or length(p_reason_code) > 128 then
      raise exception 'transition_pattern_evidence_lifecycle: p_reason_code is required (1-128 chars) when p_target_state=withdrawn';
    end if;
    v_reason_code := p_reason_code;
    v_context := coalesce(p_context, '{}'::jsonb);
    if jsonb_typeof(v_context) <> 'object' then
      raise exception 'transition_pattern_evidence_lifecycle: p_context must be a JSON object, got %', jsonb_typeof(v_context);
    end if;
  end if;

  -----------------------------------------------------------------------
  -- Identity lock — see module doc above. Acquired BEFORE the identity
  -- lookup, so the entire lookup + transition-allocation critical section
  -- below is covered.
  -----------------------------------------------------------------------
  perform pg_advisory_xact_lock(hashtextextended(
    length(p_athlete_id::text)::text || ':' || p_athlete_id::text
    || '|' || length(p_detector_rule_id)::text || ':' || p_detector_rule_id
    || '|' || length(p_detector_rule_version)::text || ':' || p_detector_rule_version
    || '|' || length(p_evidence_key)::text || ':' || p_evidence_key,
    0
  ));

  select id into v_identity_id
  from public.pattern_evidence_identities
  where athlete_id = p_athlete_id
    and detector_rule_id = p_detector_rule_id
    and detector_rule_version = p_detector_rule_version
    and evidence_key = p_evidence_key;

  if v_identity_id is null then
    if p_target_state = 'withdrawn' then
      return jsonb_build_object(
        'identity_id', null,
        'transition_id', null,
        'transition_number', null,
        'state', null,
        'action', 'skipped_no_prior'
      );
    else
      raise exception 'pattern_evidence_lifecycle_no_identity: cannot activate a lifecycle for an evidence identity that has never been persisted (athlete_id=%, detector_rule_id=%, detector_rule_version=%, evidence_key=%)',
        p_athlete_id, p_detector_rule_id, p_detector_rule_version, p_evidence_key;
    end if;
  end if;

  -----------------------------------------------------------------------
  -- Latest transition (if any) — everything from here on happens strictly
  -- while the advisory lock acquired above is held.
  -----------------------------------------------------------------------
  select id, transition_number, state, reason_code, context
  into v_latest_id, v_latest_number, v_latest_state, v_latest_reason_code, v_latest_context
  from public.pattern_evidence_lifecycle_transitions
  where evidence_identity_id = v_identity_id
  order by transition_number desc
  limit 1;

  v_current_state := coalesce(v_latest_state, 'active'::public.pattern_evidence_lifecycle_state);

  if p_target_state = v_current_state then
    if p_target_state = 'active' then
      return jsonb_build_object(
        'identity_id', v_identity_id,
        'transition_id', v_latest_id,
        'transition_number', v_latest_number,
        'state', 'active',
        'action', 'unchanged'
      );
    else
      -- Both withdrawn: unchanged only if reason_code AND context (native jsonb
      -- equality — key-order-insensitive, never a hash/canonicalizer) both match.
      if v_latest_reason_code = v_reason_code and v_latest_context = v_context then
        return jsonb_build_object(
          'identity_id', v_identity_id,
          'transition_id', v_latest_id,
          'transition_number', v_latest_number,
          'state', 'withdrawn',
          'action', 'unchanged'
        );
      end if;
      -- else: fall through to insert another withdrawn transition below.
    end if;
  end if;

  -----------------------------------------------------------------------
  -- New transition — allocation is exclusively owned here, under the lock.
  -- trg_pattern_evidence_lifecycle_transitions_predecessor_check
  -- re-validates this same invariant independently at the schema layer.
  -----------------------------------------------------------------------
  v_new_number := coalesce(v_latest_number, 0) + 1;

  insert into public.pattern_evidence_lifecycle_transitions (evidence_identity_id, transition_number, supersedes_id, state, reason_code, context)
  values (v_identity_id, v_new_number, v_latest_id, p_target_state, v_reason_code, v_context)
  returning id into v_new_id;

  return jsonb_build_object(
    'identity_id', v_identity_id,
    'transition_id', v_new_id,
    'transition_number', v_new_number,
    'state', p_target_state,
    'action', 'transitioned'
  );
end;
$$;

revoke all on function public.transition_pattern_evidence_lifecycle(uuid, text, text, text, public.pattern_evidence_lifecycle_state, text, jsonb) from public;
revoke all on function public.transition_pattern_evidence_lifecycle(uuid, text, text, text, public.pattern_evidence_lifecycle_state, text, jsonb) from anon;
revoke all on function public.transition_pattern_evidence_lifecycle(uuid, text, text, text, public.pattern_evidence_lifecycle_state, text, jsonb) from authenticated;
grant execute on function public.transition_pattern_evidence_lifecycle(uuid, text, text, text, public.pattern_evidence_lifecycle_state, text, jsonb) to service_role;
