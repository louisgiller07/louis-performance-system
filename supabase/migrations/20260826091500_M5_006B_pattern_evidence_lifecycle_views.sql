-- M5_006B — read views layering lifecycle state on top of the M5_006A
-- evidence ledger. See docs/11_DECISION_LOG.md (M5_006B).
--
-- pattern_evidence_current/_history/_current_with_provenance (M5_006A) are
-- NOT modified by this migration — both new views are purely additive.
--
-- pattern_evidence_current_state: pattern_evidence_current's exact columns
-- plus the identity's LATEST lifecycle transition (nullable — an identity
-- with zero lifecycle rows still gets a row here, with
-- lifecycle_state='active' and lifecycle_transition_id/_number NULL,
-- exactly mirroring transition_pattern_evidence_lifecycle's own "implicit
-- active" default).
--
-- pattern_evidence_current_effective: ONLY current evidence heads whose
-- effective lifecycle state is 'active' — same evidence-column shape as
-- pattern_evidence_current (no lifecycle columns at all), so a downstream
-- consumer (M5_006D aggregation, per the future-aggregation contract below)
-- can query it exactly like pattern_evidence_current, just pre-filtered.
--
-- security_invoker=true on both — same mandatory reasoning as every other
-- pattern_evidence_* view (M5_006A): without it, a view would silently run
-- with its owner's privileges rather than the querying user's own RLS.
--
-- ===========================================================================
-- Future aggregation contract
-- ===========================================================================
-- M5_006D (pattern aggregation, not yet implemented) MUST read from
-- pattern_evidence_current_effective, never pattern_evidence_current
-- directly — withdrawn evidence must never silently re-enter an aggregate
-- just because a consumer forgot to filter it out itself.

create view public.pattern_evidence_current_state
  with (security_invoker = true)
  as
  select
    c.identity_id,
    c.athlete_id,
    c.detector_rule_id,
    c.detector_rule_version,
    c.evaluation_key,
    c.evidence_key,
    c.revision_id,
    c.revision_number,
    c.supersedes_id,
    c.event_type,
    c.event_date,
    c.observed_value,
    c.revision_created_at,
    lt.id as lifecycle_transition_id,
    lt.transition_number as lifecycle_transition_number,
    coalesce(lt.state, 'active'::public.pattern_evidence_lifecycle_state) as lifecycle_state,
    lt.reason_code as lifecycle_reason_code,
    lt.context as lifecycle_context,
    lt.created_at as lifecycle_created_at
  from public.pattern_evidence_current c
  left join lateral (
    select t.id, t.transition_number, t.state, t.reason_code, t.context, t.created_at
    from public.pattern_evidence_lifecycle_transitions t
    where t.evidence_identity_id = c.identity_id
    order by t.transition_number desc
    limit 1
  ) lt on true;

create view public.pattern_evidence_current_effective
  with (security_invoker = true)
  as
  select
    identity_id,
    athlete_id,
    detector_rule_id,
    detector_rule_version,
    evaluation_key,
    evidence_key,
    revision_id,
    revision_number,
    supersedes_id,
    event_type,
    event_date,
    observed_value,
    revision_created_at
  from public.pattern_evidence_current_state
  where lifecycle_state = 'active';

revoke all privileges on public.pattern_evidence_current_state from anon;
revoke all privileges on public.pattern_evidence_current_state from authenticated;
revoke all privileges on public.pattern_evidence_current_state from service_role;
grant select on public.pattern_evidence_current_state to authenticated;
grant select on public.pattern_evidence_current_state to service_role;

revoke all privileges on public.pattern_evidence_current_effective from anon;
revoke all privileges on public.pattern_evidence_current_effective from authenticated;
revoke all privileges on public.pattern_evidence_current_effective from service_role;
grant select on public.pattern_evidence_current_effective to authenticated;
grant select on public.pattern_evidence_current_effective to service_role;
