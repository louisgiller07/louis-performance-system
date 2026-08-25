-- M5_006A — read views over the pattern_evidence ledger. See
-- docs/11_DECISION_LOG.md (M5_006A).
--
-- Every view is created WITH (security_invoker = true) — mandatory: without
-- it, a Postgres view runs with the VIEW OWNER's privileges for the
-- underlying tables, which would silently bypass the RLS policies already
-- enforced on pattern_evidence_identities/revisions/source_refs. With
-- security_invoker, the view instead runs with the QUERYING user's own
-- privileges/RLS — exactly what "authenticated sees only their own athlete's
-- evidence" requires.
--
-- pattern_evidence_current: one row per evidence_identity_id — the highest
-- revision_number for that identity ("current" is per-identity, and an
-- identity is already scoped to one exact (athlete, detector_rule_id,
-- detector_rule_version, evidence_key) — a distinct detector_rule_version
-- gets its own, entirely separate identity, so this view never collapses
-- "latest across detector versions"; that concept simply does not exist
-- here, by construction, not by extra logic).
--
-- pattern_evidence_history: every revision of every identity, unfiltered —
-- the full append-only ledger, in read form.
--
-- pattern_evidence_current_with_provenance: pattern_evidence_current joined
-- to its own revision's provenance rows (one output row per provenance
-- entry — a caller wanting exactly one row per identity should query
-- pattern_evidence_current directly instead).

create view public.pattern_evidence_current
  with (security_invoker = true)
  as
  select distinct on (r.evidence_identity_id)
    i.id as identity_id,
    i.athlete_id,
    i.detector_rule_id,
    i.detector_rule_version,
    i.evaluation_key,
    i.evidence_key,
    r.id as revision_id,
    r.revision_number,
    r.supersedes_id,
    r.event_type,
    r.event_date,
    r.observed_value,
    r.created_at as revision_created_at
  from public.pattern_evidence_revisions r
  join public.pattern_evidence_identities i on i.id = r.evidence_identity_id
  order by r.evidence_identity_id, r.revision_number desc;

create view public.pattern_evidence_history
  with (security_invoker = true)
  as
  select
    i.id as identity_id,
    i.athlete_id,
    i.detector_rule_id,
    i.detector_rule_version,
    i.evaluation_key,
    i.evidence_key,
    r.id as revision_id,
    r.revision_number,
    r.supersedes_id,
    r.event_type,
    r.event_date,
    r.observed_value,
    r.created_at as revision_created_at
  from public.pattern_evidence_revisions r
  join public.pattern_evidence_identities i on i.id = r.evidence_identity_id;

create view public.pattern_evidence_current_with_provenance
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
    sr.id as source_ref_id,
    sr.role,
    sr.source_decision_id,
    sr.source_completed_session_id,
    sr.source_daily_checkin_id,
    sr.source_health_flag_id,
    sr.source_decision_outcome_id
  from public.pattern_evidence_current c
  join public.pattern_evidence_source_refs sr on sr.revision_id = c.revision_id;

-- Same REVOKE-then-GRANT discipline as every table migration above — views
-- are also subject to this project's ALTER DEFAULT PRIVILEGES auto-grant.
revoke all privileges on public.pattern_evidence_current from anon;
revoke all privileges on public.pattern_evidence_current from authenticated;
revoke all privileges on public.pattern_evidence_current from service_role;
grant select on public.pattern_evidence_current to authenticated;
grant select on public.pattern_evidence_current to service_role;

revoke all privileges on public.pattern_evidence_history from anon;
revoke all privileges on public.pattern_evidence_history from authenticated;
revoke all privileges on public.pattern_evidence_history from service_role;
grant select on public.pattern_evidence_history to authenticated;
grant select on public.pattern_evidence_history to service_role;

revoke all privileges on public.pattern_evidence_current_with_provenance from anon;
revoke all privileges on public.pattern_evidence_current_with_provenance from authenticated;
revoke all privileges on public.pattern_evidence_current_with_provenance from service_role;
grant select on public.pattern_evidence_current_with_provenance to authenticated;
grant select on public.pattern_evidence_current_with_provenance to service_role;
