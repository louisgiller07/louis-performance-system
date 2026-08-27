-- M5_007 — read views over the pattern_insight review ledger. See
-- docs/11_DECISION_LOG.md (M5_007).
--
-- Every view is created WITH (security_invoker = true) — mandatory: without
-- it, a Postgres view runs with the VIEW OWNER's privileges for the
-- underlying tables, which would silently bypass the RLS policies already
-- enforced on pattern_insight_identities/pattern_insight_reviews. With
-- security_invoker, the view instead runs with the QUERYING user's own
-- privileges/RLS.
--
-- pattern_insight_review_current: one row per insight identity — the
-- highest review_number for that identity ("current" is per-identity, and
-- an identity is already scoped to one exact (athlete, detector_rule_id,
-- detector_rule_version, insight_kind)).
--
-- pattern_insight_review_history: every review of every identity,
-- unfiltered — the full append-only ledger, in read form.
--
-- Both expose enough fields to reconstruct: athlete, detector rule/version,
-- insight kind, review number, decision, candidate snapshot, reviewer note,
-- created_at.

create view public.pattern_insight_review_current
  with (security_invoker = true)
  as
  select distinct on (r.insight_identity_id)
    i.id as identity_id,
    i.athlete_id,
    i.detector_rule_id,
    i.detector_rule_version,
    i.insight_kind,
    r.id as review_id,
    r.review_number,
    r.supersedes_id,
    r.decision,
    r.candidate_snapshot,
    r.reviewer_note,
    r.created_at as review_created_at
  from public.pattern_insight_reviews r
  join public.pattern_insight_identities i on i.id = r.insight_identity_id
  order by r.insight_identity_id, r.review_number desc;

create view public.pattern_insight_review_history
  with (security_invoker = true)
  as
  select
    i.id as identity_id,
    i.athlete_id,
    i.detector_rule_id,
    i.detector_rule_version,
    i.insight_kind,
    r.id as review_id,
    r.review_number,
    r.supersedes_id,
    r.decision,
    r.candidate_snapshot,
    r.reviewer_note,
    r.created_at as review_created_at
  from public.pattern_insight_reviews r
  join public.pattern_insight_identities i on i.id = r.insight_identity_id;

-- Same REVOKE-then-GRANT discipline as every table/view migration above —
-- views are also subject to this project's ALTER DEFAULT PRIVILEGES
-- auto-grant.
revoke all privileges on public.pattern_insight_review_current from anon;
revoke all privileges on public.pattern_insight_review_current from authenticated;
revoke all privileges on public.pattern_insight_review_current from service_role;
grant select on public.pattern_insight_review_current to authenticated;
grant select on public.pattern_insight_review_current to service_role;

revoke all privileges on public.pattern_insight_review_history from anon;
revoke all privileges on public.pattern_insight_review_history from authenticated;
revoke all privileges on public.pattern_insight_review_history from service_role;
grant select on public.pattern_insight_review_history to authenticated;
grant select on public.pattern_insight_review_history to service_role;
