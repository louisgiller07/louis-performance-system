-- M5_006A — pattern_evidence_identities: append-only foundation for
-- persisting deterministic detector evidence (starting with M5_005's
-- recommendation_vs_actual_execution). See docs/11_DECISION_LOG.md
-- (M5_006A) for the full design record.
--
-- ===========================================================================
-- Why a separate identity table, distinct from the revisions themselves?
-- ===========================================================================
-- A detector's (evaluation_key, evidence_key) pair is a stable relationship
-- identity — the SAME relationship can be observed multiple times as its
-- underlying source rows are edited (e.g. a completed_session's
-- completion_status corrected from "skipped" to "done"), producing a new
-- immutable revision each time, never an overwrite. Separating identity from
-- revision lets `evaluation_key` live exactly once per identity (never
-- repeated/duplicated across revisions) and gives the RPC (next migration
-- but one) a single, lockable row per relationship to serialize concurrent
-- writers against — see persist_pattern_evidence's own module doc for the
-- concurrency design this enables.
--
-- ===========================================================================
-- Columns
-- ===========================================================================
--   id                      own identity, never decision_id/completedSessionId — an
--                           evidence identity is its own entity, not reusing
--                           any source table's row identity.
--   athlete_id              ownership, FK real, ON DELETE RESTRICT (deliberately NOT
--                           CASCADE, unlike most athlete_id FKs in this schema —
--                           evidence is derived/audit-relevant data; an athlete
--                           deletion must not silently cascade-erase it).
--   detector_rule_id        e.g. "recommendation_vs_actual_execution" — free text,
--                           no enum (mirrors decision_outcomes.calculator_id's own
--                           reasoning: no closed set of detectors exists yet).
--   detector_rule_version   e.g. "1.0.0" — a NEW detector version gets its OWN
--                           identity rows entirely (never reused across versions),
--                           mirroring decision_outcomes' calculator_version design.
--   evaluation_key          the detector's own stable relationship key (e.g.
--                           "decision:<id>") — lives HERE, exactly once, never
--                           repeated on individual revisions.
--   evidence_key            the detector's own stable evidence key (e.g.
--                           "decision:<id>:completion:<completedSessionId>") —
--                           the actual uniqueness anchor this table enforces.
--   created_at              standard, no updated_at — this table is append-only
--                           by construction (see the trigger below), the absence
--                           of updated_at expresses that structurally.
--
-- ===========================================================================
-- Idempotence — uniqueness
-- ===========================================================================
-- UNIQUE (athlete_id, detector_rule_id, detector_rule_version, evidence_key)
-- One identity row per (athlete, detector, version, evidence relationship).
-- The persist RPC (a later migration) inserts this row idempotently
-- (ON CONFLICT DO NOTHING), then serializes every revision written against
-- it via a transaction-scoped advisory lock keyed by this same natural
-- tuple (pg_advisory_xact_lock — see persist_pattern_evidence_rpc.sql's own
-- module doc for why this table's own row is not locked directly).

create type public.pattern_evidence_event_type as enum (
  'supporting',
  'contradicting',
  'neutral'
);

create table public.pattern_evidence_identities (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete restrict,
  detector_rule_id text not null,
  detector_rule_version text not null,
  evaluation_key text not null,
  evidence_key text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint pattern_evidence_identities_detector_rule_id_len check (char_length(detector_rule_id) between 1 and 128),
  constraint pattern_evidence_identities_detector_rule_version_len check (char_length(detector_rule_version) between 1 and 32),
  constraint pattern_evidence_identities_evaluation_key_len check (char_length(evaluation_key) between 1 and 512),
  constraint pattern_evidence_identities_evidence_key_len check (char_length(evidence_key) between 1 and 512),
  constraint pattern_evidence_identities_unique_key unique (athlete_id, detector_rule_id, detector_rule_version, evidence_key)
);

-- Distinct from the uniqueness index above (which covers evidence_key) —
-- this one supports lookups/joins keyed by evaluation_key instead (e.g. "all
-- evidence identities tied to one decision"), the shape pattern_evidence_current
-- and its siblings (a later migration) are expected to filter/join by.
create index idx_pattern_evidence_identities_lookup
  on public.pattern_evidence_identities
  using btree (athlete_id, detector_rule_id, detector_rule_version, evaluation_key);

alter table public.pattern_evidence_identities enable row level security;

create policy "pattern_evidence_identities_own_select"
  on public.pattern_evidence_identities
  for select
  to authenticated
  using (
    athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
  );

-- IMPORTANT — verified empirically for this project (see decision_outcomes_table.sql,
-- M5_001B): ALTER DEFAULT PRIVILEGES auto-GRANTs ALL table/function privileges to
-- anon/authenticated/service_role on every newly created object. REVOKE explicitly
-- before GRANTing the exact minimum, rather than assuming a blank slate.
revoke all privileges on public.pattern_evidence_identities from anon;
revoke all privileges on public.pattern_evidence_identities from authenticated;
revoke all privileges on public.pattern_evidence_identities from service_role;

grant select on public.pattern_evidence_identities to authenticated;
grant select, insert on public.pattern_evidence_identities to service_role;
-- service_role deliberately does NOT receive update/delete/truncate — this
-- table (like its siblings, revisions and source_refs) has no legitimate
-- mutation path once a row exists. Grants alone would already prevent this;
-- the trigger below is a second, independent layer (M5_006A hardening
-- requirement) so the invariant holds even against a hypothetical future
-- over-broad GRANT, not only against today's correctly-scoped one.

-- ===========================================================================
-- Strong immutability — enforced at the trigger layer too, not grants alone.
-- ===========================================================================
-- Shared by all three pattern_evidence_* tables (this migration and the two
-- that follow) — one generic function, attached per-table, so the "why" is
-- documented once instead of three times.
create or replace function public.reject_append_only_mutation() returns trigger
  language plpgsql
  as $$
begin
  raise exception 'append-only violation: % on % is not permitted', TG_OP, TG_TABLE_NAME;
end;
$$;

create trigger trg_pattern_evidence_identities_no_update
  before update on public.pattern_evidence_identities
  for each row execute function public.reject_append_only_mutation();

create trigger trg_pattern_evidence_identities_no_delete
  before delete on public.pattern_evidence_identities
  for each row execute function public.reject_append_only_mutation();
