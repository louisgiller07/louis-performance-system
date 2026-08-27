-- M5_007 — persist_pattern_insight_review: atomic, append-only,
-- concurrency-safe RPC for recording a human review decision over one
-- insight candidate. See docs/11_DECISION_LOG.md (M5_007).
--
-- Security contract: identical rigor to persist_pattern_evidence — SECURITY
-- INVOKER, EXECUTE reserved to service_role, p_athlete_id is the sole
-- ownership source of truth.
--
-- IMPORTANT: this RPC records ONLY that a human reviewed an insight's
-- wording/framing. Nothing in this function (or anywhere else in this
-- schema) reads pattern_insight_reviews to change daily-run behavior —
-- `accepted_as_insight` is never a coaching activation.
--
-- ===========================================================================
-- Identity lock — EXACT SAME algorithm as persist_pattern_evidence /
-- transition_pattern_evidence_lifecycle
-- ===========================================================================
-- pg_advisory_xact_lock, transaction-scoped (released automatically at the
-- end of this call's enclosing transaction — never leaked, never requiring
-- an explicit unlock), keyed by the natural identity tuple
-- (athlete_id, detector_rule_id, detector_rule_version, insight_kind).
-- Never SELECT ... FOR UPDATE — see persist_pattern_evidence's own
-- migration for the empirical reason that mechanism was rejected (requires
-- UPDATE table privilege even when no column is ever written, directly
-- incompatible with service_role never receiving UPDATE on these tables).
--
-- Tuple encoding: each component is length-prefixed ("<byteLength>:<value>")
-- before concatenation, not simply pipe-joined — same collision-avoidance
-- rationale as persist_pattern_evidence's own module doc (a plain
-- pipe-join could let two DIFFERENT tuples produce the IDENTICAL pre-hash
-- string whenever a '|' character appears inside a text component).
--
-- ===========================================================================
-- Behavior — exact
-- ===========================================================================
--   missing identity                                  -> create identity, insert review #1, action=inserted
--   existing identity, same decision AND native
--     jsonb-equal candidate_snapshot AND same
--     reviewer_note (IS NOT DISTINCT FROM, so NULL=NULL
--     counts as "same")                                -> action=unchanged (no write)
--   otherwise (decision changed, snapshot changed,
--     or reviewer_note changed)                        -> append next review, supersede previous head, action=superseded
-- No application-side SELECT-then-INSERT: the whole decision is made and
-- acted on inside this one function call, under the lock. No UPDATE ever
-- issued by this function.

create or replace function public.persist_pattern_insight_review(
  p_athlete_id uuid,
  p_detector_rule_id text,
  p_detector_rule_version text,
  p_insight_kind text,
  p_decision public.pattern_insight_review_decision,
  p_candidate_snapshot jsonb,
  p_reviewer_note text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_identity_id uuid;

  v_head_id uuid;
  v_head_number integer;
  v_head_decision public.pattern_insight_review_decision;
  v_head_snapshot jsonb;
  v_head_note text;

  v_new_id uuid;
  v_new_number integer;
begin
  -----------------------------------------------------------------------
  -- Required scalar fields.
  -----------------------------------------------------------------------
  if p_athlete_id is null then
    raise exception 'persist_pattern_insight_review: p_athlete_id is required';
  end if;
  if p_detector_rule_id is null or length(trim(p_detector_rule_id)) = 0 then
    raise exception 'persist_pattern_insight_review: p_detector_rule_id is required and must be non-blank';
  end if;
  if p_detector_rule_version is null or length(trim(p_detector_rule_version)) = 0 then
    raise exception 'persist_pattern_insight_review: p_detector_rule_version is required and must be non-blank';
  end if;
  if p_insight_kind is null or length(trim(p_insight_kind)) = 0 then
    raise exception 'persist_pattern_insight_review: p_insight_kind is required and must be non-blank';
  end if;
  if p_decision is null then
    raise exception 'persist_pattern_insight_review: p_decision is required';
  end if;
  if p_candidate_snapshot is null or jsonb_typeof(p_candidate_snapshot) <> 'object' then
    raise exception 'persist_pattern_insight_review: p_candidate_snapshot is required and must be a JSON object';
  end if;
  if p_reviewer_note is not null and (
    length(p_reviewer_note) < 1 or length(p_reviewer_note) > 2000 or btrim(p_reviewer_note) <> p_reviewer_note
  ) then
    raise exception 'persist_pattern_insight_review: p_reviewer_note must be NULL or a trimmed string of 1-2000 characters';
  end if;

  -----------------------------------------------------------------------
  -- Identity lock — see module doc above.
  -----------------------------------------------------------------------
  perform pg_advisory_xact_lock(hashtextextended(
    length(p_athlete_id::text)::text || ':' || p_athlete_id::text
    || '|' || length(p_detector_rule_id)::text || ':' || p_detector_rule_id
    || '|' || length(p_detector_rule_version)::text || ':' || p_detector_rule_version
    || '|' || length(p_insight_kind)::text || ':' || p_insight_kind,
    0
  ));

  insert into public.pattern_insight_identities (athlete_id, detector_rule_id, detector_rule_version, insight_kind)
  values (p_athlete_id, p_detector_rule_id, p_detector_rule_version, p_insight_kind)
  on conflict (athlete_id, detector_rule_id, detector_rule_version, insight_kind) do nothing;

  select id into v_identity_id
  from public.pattern_insight_identities
  where athlete_id = p_athlete_id
    and detector_rule_id = p_detector_rule_id
    and detector_rule_version = p_detector_rule_version
    and insight_kind = p_insight_kind;

  if v_identity_id is null then
    raise exception 'persist_pattern_insight_review: internal error — identity row not found immediately after insert-or-fetch';
  end if;

  -----------------------------------------------------------------------
  -- Current head (if any) — everything from here on happens strictly while
  -- the transaction-scoped advisory lock acquired above is held.
  -----------------------------------------------------------------------
  select id, review_number, decision, candidate_snapshot, reviewer_note
  into v_head_id, v_head_number, v_head_decision, v_head_snapshot, v_head_note
  from public.pattern_insight_reviews
  where insight_identity_id = v_identity_id
  order by review_number desc
  limit 1;

  if v_head_id is not null
     and v_head_decision = p_decision
     and v_head_snapshot = p_candidate_snapshot
     and v_head_note is not distinct from p_reviewer_note
  then
    return jsonb_build_object(
      'identity_id', v_identity_id,
      'review_id', v_head_id,
      'review_number', v_head_number,
      'action', 'unchanged'
    );
  end if;

  -----------------------------------------------------------------------
  -- New review — allocation is exclusively owned here, under the lock.
  -- trg_pattern_insight_reviews_predecessor_check re-validates this same
  -- invariant independently at the schema layer (defense in depth).
  -----------------------------------------------------------------------
  v_new_number := coalesce(v_head_number, 0) + 1;

  insert into public.pattern_insight_reviews (insight_identity_id, review_number, supersedes_id, decision, candidate_snapshot, reviewer_note)
  values (v_identity_id, v_new_number, v_head_id, p_decision, p_candidate_snapshot, p_reviewer_note)
  returning id into v_new_id;

  return jsonb_build_object(
    'identity_id', v_identity_id,
    'review_id', v_new_id,
    'review_number', v_new_number,
    'action', case when v_head_id is null then 'inserted' else 'superseded' end
  );
end;
$$;

revoke all on function public.persist_pattern_insight_review(uuid, text, text, text, public.pattern_insight_review_decision, jsonb, text) from public;
revoke all on function public.persist_pattern_insight_review(uuid, text, text, text, public.pattern_insight_review_decision, jsonb, text) from anon;
revoke all on function public.persist_pattern_insight_review(uuid, text, text, text, public.pattern_insight_review_decision, jsonb, text) from authenticated;
grant execute on function public.persist_pattern_insight_review(uuid, text, text, text, public.pattern_insight_review_decision, jsonb, text) to service_role;
