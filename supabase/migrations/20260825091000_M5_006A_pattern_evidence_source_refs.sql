-- M5_006A — pattern_evidence_source_refs: normalized provenance for one
-- evidence revision — exactly which source rows (decision, completed
-- session, check-in, health flag, decision_outcome) this revision's
-- observed_value was actually derived from. See docs/11_DECISION_LOG.md
-- (M5_006A).
--
-- ===========================================================================
-- Why normalized rows instead of a JSON array column on the revision?
-- ===========================================================================
-- Provenance is compared set-wise for semantic-equality purposes
-- (persist_pattern_evidence, a later migration — "did the provenance set
-- change" is one of the four conditions that decides unchanged vs
-- superseded) and needs real per-source-kind foreign keys so a provenance
-- entry can never reference a row that does not exist or belongs to another
-- athlete — a JSONB array could not express either as a database-enforced
-- invariant.
--
-- ===========================================================================
-- Columns
-- ===========================================================================
--   id            own identity.
--   revision_id   FK -> pattern_evidence_revisions(id), ON DELETE RESTRICT.
--   role          the detector-defined role of this source within the
--                 evidence (e.g. "evaluation_decision", "linked_completed_session"
--                 for M5_005) — free text, no enum (mirrors detector_rule_id's
--                 own reasoning: no closed set of roles exists across detectors).
--   source_*_id   exactly one of these five nullable FK columns is non-null per
--                 row (see the CHECK constraint below) — one column per source
--                 table this package's detectors can ever cite as provenance.
--                 All ON DELETE RESTRICT: a provenance-cited source row must
--                 never silently disappear out from under persisted evidence.
--   created_at    standard, no updated_at — immutable by construction.
--
-- ===========================================================================
-- Exactly-one-source invariant
-- ===========================================================================
-- CHECK: exactly one of the five source_*_id columns is non-null. Never
-- zero (that is simply not provenance), never more than one (a single
-- provenance row cites exactly one source row of exactly one kind).

create table public.pattern_evidence_source_refs (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.pattern_evidence_revisions(id) on delete restrict,
  role text not null,
  source_decision_id uuid references public.decisions(id) on delete restrict,
  source_completed_session_id uuid references public.completed_sessions(id) on delete restrict,
  source_daily_checkin_id uuid references public.daily_checkins(id) on delete restrict,
  source_health_flag_id uuid references public.health_flags(id) on delete restrict,
  source_decision_outcome_id uuid references public.decision_outcomes(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint pattern_evidence_source_refs_role_len check (char_length(role) between 1 and 64),
  constraint pattern_evidence_source_refs_exactly_one_source check (
    (
      (case when source_decision_id is not null then 1 else 0 end)
      + (case when source_completed_session_id is not null then 1 else 0 end)
      + (case when source_daily_checkin_id is not null then 1 else 0 end)
      + (case when source_health_flag_id is not null then 1 else 0 end)
      + (case when source_decision_outcome_id is not null then 1 else 0 end)
    ) = 1
  )
);

-- ===========================================================================
-- Provenance uniqueness — physical, per source kind (partial unique indexes;
-- a plain multi-column UNIQUE constraint cannot express a WHERE clause).
-- Prevents duplicate provenance rows for the same (revision, role, source)
-- triple from ever existing, independent of the RPC's own payload-level
-- duplicate check (pattern_evidence_provenance_duplicate_payload).
-- ===========================================================================
create unique index idx_pattern_evidence_source_refs_unique_decision
  on public.pattern_evidence_source_refs (revision_id, role, source_decision_id)
  where source_decision_id is not null;

create unique index idx_pattern_evidence_source_refs_unique_completed_session
  on public.pattern_evidence_source_refs (revision_id, role, source_completed_session_id)
  where source_completed_session_id is not null;

create unique index idx_pattern_evidence_source_refs_unique_daily_checkin
  on public.pattern_evidence_source_refs (revision_id, role, source_daily_checkin_id)
  where source_daily_checkin_id is not null;

create unique index idx_pattern_evidence_source_refs_unique_health_flag
  on public.pattern_evidence_source_refs (revision_id, role, source_health_flag_id)
  where source_health_flag_id is not null;

create unique index idx_pattern_evidence_source_refs_unique_decision_outcome
  on public.pattern_evidence_source_refs (revision_id, role, source_decision_outcome_id)
  where source_decision_outcome_id is not null;

-- Lookup partial indexes per source kind — e.g. "every evidence row that
-- cites this specific decision" — distinct purpose from the uniqueness
-- indexes above (which are keyed by revision_id first).
create index idx_pattern_evidence_source_refs_decision
  on public.pattern_evidence_source_refs (source_decision_id) where source_decision_id is not null;
create index idx_pattern_evidence_source_refs_completed_session
  on public.pattern_evidence_source_refs (source_completed_session_id) where source_completed_session_id is not null;
create index idx_pattern_evidence_source_refs_daily_checkin
  on public.pattern_evidence_source_refs (source_daily_checkin_id) where source_daily_checkin_id is not null;
create index idx_pattern_evidence_source_refs_health_flag
  on public.pattern_evidence_source_refs (source_health_flag_id) where source_health_flag_id is not null;
create index idx_pattern_evidence_source_refs_decision_outcome
  on public.pattern_evidence_source_refs (source_decision_outcome_id) where source_decision_outcome_id is not null;

create trigger trg_pattern_evidence_source_refs_no_update
  before update on public.pattern_evidence_source_refs
  for each row execute function public.reject_append_only_mutation();

create trigger trg_pattern_evidence_source_refs_no_delete
  before delete on public.pattern_evidence_source_refs
  for each row execute function public.reject_append_only_mutation();

alter table public.pattern_evidence_source_refs enable row level security;

-- Scoped through revision_id -> evidence_identity_id -> athlete_id.
create policy "pattern_evidence_source_refs_own_select"
  on public.pattern_evidence_source_refs
  for select
  to authenticated
  using (
    revision_id in (
      select per.id
      from public.pattern_evidence_revisions per
      join public.pattern_evidence_identities pei on pei.id = per.evidence_identity_id
      where pei.athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
    )
  );

revoke all privileges on public.pattern_evidence_source_refs from anon;
revoke all privileges on public.pattern_evidence_source_refs from authenticated;
revoke all privileges on public.pattern_evidence_source_refs from service_role;

grant select on public.pattern_evidence_source_refs to authenticated;
grant select, insert on public.pattern_evidence_source_refs to service_role;
