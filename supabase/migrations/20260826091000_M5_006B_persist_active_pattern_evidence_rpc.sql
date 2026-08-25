-- M5_006B — persist_active_pattern_evidence: a COMPOSITE RPC that persists
-- one evidence observation (via the existing, unmodified
-- persist_pattern_evidence) and, in the same transaction, ensures that
-- identity's lifecycle is 'active' (via transition_pattern_evidence_lifecycle).
-- See docs/11_DECISION_LOG.md (M5_006B).
--
-- Deliberately does NOT duplicate/reimplement any M5_006A evidence-revision
-- semantics (identity insert-or-fetch, semantic-equality comparison,
-- provenance validation, revision allocation) — all of that remains
-- exclusively owned by persist_pattern_evidence, called here unmodified.
-- This function's only added behavior is the lifecycle activation step.
--
-- ===========================================================================
-- Concurrency — why no extra locking is needed here
-- ===========================================================================
-- persist_pattern_evidence acquires a pg_advisory_xact_lock keyed on
-- (athlete_id, detector_rule_id, detector_rule_version, evidence_key).
-- transition_pattern_evidence_lifecycle acquires a lock keyed by the EXACT
-- SAME algorithm on the SAME four components. pg_advisory_xact_lock is
-- TRANSACTION-scoped, not call-scoped: once persist_pattern_evidence
-- acquires it, it stays held for the remainder of the enclosing
-- transaction — which, since this whole function is one single top-level
-- RPC call, means the entire body of persist_active_pattern_evidence,
-- including the transition_pattern_evidence_lifecycle call below. The
-- second lock acquisition (inside transition_pattern_evidence_lifecycle)
-- is therefore already held by this same session and succeeds immediately
-- — no separate coordination, no risk of a concurrent withdrawal
-- interleaving between the evidence write and the lifecycle activation.
--
-- Security contract: identical rigor to the two RPCs it composes —
-- SECURITY INVOKER, EXECUTE reserved to service_role.

create or replace function public.persist_active_pattern_evidence(
  p_athlete_id uuid,
  p_detector_rule_id text,
  p_detector_rule_version text,
  p_evaluation_key text,
  p_evidence_key text,
  p_event_type public.pattern_evidence_event_type,
  p_event_date date,
  p_observed_value jsonb,
  p_provenance jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_evidence_result jsonb;
  v_lifecycle_result jsonb;
begin
  v_evidence_result := public.persist_pattern_evidence(
    p_athlete_id, p_detector_rule_id, p_detector_rule_version,
    p_evaluation_key, p_evidence_key, p_event_type, p_event_date,
    p_observed_value, p_provenance
  );

  v_lifecycle_result := public.transition_pattern_evidence_lifecycle(
    p_athlete_id, p_detector_rule_id, p_detector_rule_version, p_evidence_key,
    'active'::public.pattern_evidence_lifecycle_state, null, '{}'::jsonb
  );

  return jsonb_build_object(
    'identity_id', (v_evidence_result->>'identity_id')::uuid,
    'revision_id', (v_evidence_result->>'revision_id')::uuid,
    'revision_number', (v_evidence_result->>'revision_number')::integer,
    'evidence_action', v_evidence_result->>'action',
    'lifecycle_action', v_lifecycle_result->>'action',
    'lifecycle_transition_id', (v_lifecycle_result->>'transition_id')::uuid,
    'lifecycle_transition_number', (v_lifecycle_result->>'transition_number')::integer
  );
end;
$$;

revoke all on function public.persist_active_pattern_evidence(uuid, text, text, text, text, public.pattern_evidence_event_type, date, jsonb, jsonb) from public;
revoke all on function public.persist_active_pattern_evidence(uuid, text, text, text, text, public.pattern_evidence_event_type, date, jsonb, jsonb) from anon;
revoke all on function public.persist_active_pattern_evidence(uuid, text, text, text, text, public.pattern_evidence_event_type, date, jsonb, jsonb) from authenticated;
grant execute on function public.persist_active_pattern_evidence(uuid, text, text, text, text, public.pattern_evidence_event_type, date, jsonb, jsonb) to service_role;
