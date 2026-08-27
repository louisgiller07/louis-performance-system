-- M5_007 — pattern_insight_identities / pattern_insight_reviews: an
-- append-only, immutable ledger recording a human's review decision over
-- one deterministically-projected insight (see docs/11_DECISION_LOG.md,
-- M5_007). Mirrors pattern_evidence_identities/_revisions' identity/chain
-- discipline exactly (same predecessor-chain hardening in the next
-- migration, same double-layer append-only immutability, same
-- least-privilege grants) — this table records REVIEW DECISIONS over
-- insight PROJECTIONS, never evidence itself (pattern_evidence_* remains
-- entirely unchanged by this migration) and never a coaching activation.
--
-- ===========================================================================
-- pattern_insight_identities
-- ===========================================================================
--   id                      own identity, never any evidence/aggregate row's id.
--   athlete_id              ownership, FK real, ON DELETE RESTRICT (same
--                           rationale as pattern_evidence_identities —
--                           review history is audit-relevant, an athlete
--                           deletion must not silently cascade-erase it).
--   detector_rule_id        the SOURCE detector this insight was projected
--                           from (e.g. "sleep_quality_to_same_day_energy_correlation")
--                           — free text, no enum, mirrors
--                           pattern_evidence_identities' own reasoning.
--   detector_rule_version   e.g. "1.0.0" — a new detector version gets its
--                           own identity rows entirely.
--   insight_kind            the M5_007 projector's output kind (e.g.
--                           "sleep_energy_same_day_association") — free
--                           text, no enum: mirrors detector_rule_id's own
--                           reasoning, and keeps this table decoupled from
--                           the exact registry shape in longitudinal-engine.
--   created_at              standard, no updated_at — append-only by
--                           construction (see the trigger, next migration).
--
-- One insight identity per (athlete, detector, version, insight kind) — a
-- single detector/version pair could in principle project to more than one
-- insight_kind in a future projector version, so insight_kind is part of
-- the natural key, not merely descriptive.
--
-- ===========================================================================
-- pattern_insight_reviews
-- ===========================================================================
--   id                    own identity.
--   insight_identity_id   FK -> pattern_insight_identities(id), ON DELETE
--                         RESTRICT — same audit-durability rationale as
--                         pattern_evidence_revisions.
--   review_number         1, 2, 3... strictly increasing per identity,
--                         allocated exclusively by
--                         persist_pattern_insight_review (a later migration)
--                         while that identity's transaction-scoped advisory
--                         lock is held — never computed by this table's own
--                         defaults/triggers.
--   supersedes_id         NULL for review 1; for review N>1, the id of
--                         review N-1 of the SAME identity — enforced by the
--                         BEFORE INSERT trigger (next migration).
--   decision              accepted_as_insight | dismissed | needs_more_evidence
--                         — a human's read of the insight's WORDING/FRAMING
--                         only. NEVER a coaching activation: no runtime
--                         anywhere in this schema reads this column to
--                         change daily-run behavior.
--   candidate_snapshot    the EXACT PatternInsightSnapshot (longitudinal-engine
--                         `src/insights/types.ts`) that was reviewed —
--                         opaque JSON object here, never validated
--                         field-by-field, exactly like
--                         pattern_evidence_revisions.observed_value. This is
--                         what lets a later fingerprint comparison detect
--                         staleness (range moved, evidence set changed)
--                         without this schema knowing anything about the
--                         snapshot's internal shape.
--   reviewer_note         optional free-text human note, 1-2000 trimmed
--                         chars when present.
--   created_at             standard, no updated_at — immutable by
--                         construction.

create type public.pattern_insight_review_decision as enum (
  'accepted_as_insight',
  'dismissed',
  'needs_more_evidence'
);

create table public.pattern_insight_identities (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete restrict,
  detector_rule_id text not null,
  detector_rule_version text not null,
  insight_kind text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint pattern_insight_identities_detector_rule_id_len check (char_length(detector_rule_id) between 1 and 128),
  constraint pattern_insight_identities_detector_rule_version_len check (char_length(detector_rule_version) between 1 and 32),
  constraint pattern_insight_identities_insight_kind_len check (char_length(insight_kind) between 1 and 128),
  constraint pattern_insight_identities_unique_key unique (athlete_id, detector_rule_id, detector_rule_version, insight_kind)
);

create index idx_pattern_insight_identities_athlete
  on public.pattern_insight_identities (athlete_id);

alter table public.pattern_insight_identities enable row level security;

create policy "pattern_insight_identities_own_select"
  on public.pattern_insight_identities
  for select
  to authenticated
  using (
    athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
  );

-- IMPORTANT — verified empirically for this project (see M5_006A):
-- ALTER DEFAULT PRIVILEGES auto-GRANTs ALL table/function privileges to
-- anon/authenticated/service_role on every newly created object. REVOKE
-- explicitly before GRANTing the exact minimum, rather than assuming a
-- blank slate.
revoke all privileges on public.pattern_insight_identities from anon;
revoke all privileges on public.pattern_insight_identities from authenticated;
revoke all privileges on public.pattern_insight_identities from service_role;

grant select on public.pattern_insight_identities to authenticated;
grant select, insert on public.pattern_insight_identities to service_role;
-- service_role deliberately does NOT receive update/delete/truncate — see
-- the append-only trigger in the next migration for the second,
-- independent enforcement layer.

create table public.pattern_insight_reviews (
  id uuid primary key default gen_random_uuid(),
  insight_identity_id uuid not null references public.pattern_insight_identities(id) on delete restrict,
  review_number integer not null,
  supersedes_id uuid references public.pattern_insight_reviews(id) on delete restrict,
  decision public.pattern_insight_review_decision not null,
  candidate_snapshot jsonb not null,
  reviewer_note text,
  created_at timestamptz not null default clock_timestamp(),
  constraint pattern_insight_reviews_review_number_check check (review_number >= 1),
  constraint pattern_insight_reviews_snapshot_is_object check (jsonb_typeof(candidate_snapshot) = 'object'),
  constraint pattern_insight_reviews_supersedes_consistency check (
    (review_number = 1 and supersedes_id is null)
    or (review_number > 1 and supersedes_id is not null)
  ),
  constraint pattern_insight_reviews_reviewer_note_shape check (
    reviewer_note is null
    or (char_length(reviewer_note) between 1 and 2000 and btrim(reviewer_note) = reviewer_note)
  ),
  constraint pattern_insight_reviews_unique_review unique (insight_identity_id, review_number)
);

create unique index idx_pattern_insight_reviews_supersedes_unique
  on public.pattern_insight_reviews (supersedes_id)
  where supersedes_id is not null;

-- Supports "current review head" lookups (highest review_number per
-- identity) — the exact access pattern pattern_insight_review_current (a
-- later migration) uses.
create index idx_pattern_insight_reviews_current
  on public.pattern_insight_reviews (insight_identity_id, review_number desc);

alter table public.pattern_insight_reviews enable row level security;

-- Scoped through insight_identity_id -> pattern_insight_identities.athlete_id,
-- exactly like pattern_evidence_revisions_own_select.
create policy "pattern_insight_reviews_own_select"
  on public.pattern_insight_reviews
  for select
  to authenticated
  using (
    insight_identity_id in (
      select pii.id
      from public.pattern_insight_identities pii
      where pii.athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
    )
  );

revoke all privileges on public.pattern_insight_reviews from anon;
revoke all privileges on public.pattern_insight_reviews from authenticated;
revoke all privileges on public.pattern_insight_reviews from service_role;

grant select on public.pattern_insight_reviews to authenticated;
grant select, insert on public.pattern_insight_reviews to service_role;
