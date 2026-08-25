-- M5_006A — pattern_evidence_revisions: immutable, ordered revisions of one
-- evidence identity. Never updated, never deleted — a corrected observation
-- (e.g. a completed_session's completion_status changed after the fact)
-- produces a brand-new revision that supersedes the previous head, exactly
-- like decision_outcomes (M5_001B) never overwrites a row for a changed
-- calculator_version. See docs/11_DECISION_LOG.md (M5_006A).
--
-- ===========================================================================
-- Columns
-- ===========================================================================
--   id                    own identity.
--   evidence_identity_id  FK -> pattern_evidence_identities(id), ON DELETE RESTRICT —
--                         a revision is proof derived from its identity; never
--                         silently orphaned by a hypothetical identity deletion
--                         (which itself has no legitimate path — see the previous
--                         migration's append-only trigger).
--   revision_number       1, 2, 3... strictly increasing per identity, allocated
--                         exclusively by persist_pattern_evidence (a later
--                         migration) while that identity's transaction-scoped
--                         advisory lock (pg_advisory_xact_lock) is held — never
--                         computed by this table's own defaults/triggers.
--   supersedes_id         NULL for revision 1; for revision N>1, the id of
--                         revision N-1 of the SAME identity — enforced by the
--                         BEFORE INSERT trigger below (M5_006A hardening
--                         requirement — this is checked at the schema layer,
--                         not trusted from RPC logic alone).
--   event_type            supporting | contradicting | neutral — mirrors
--                         DetectorEventType (M5_005) exactly. no_evidence is
--                         deliberately NOT a value here: a no_evidence detector
--                         result never reaches this ledger at all (see the
--                         M5_005 persistence adapter, a later migration).
--   event_date             the date this evidence concerns (decision.decisionDate
--                         for M5_005) — a plain date, no time-of-day precision.
--   observed_value         JSON object of the detector's own observedValue shape —
--                         opaque to this schema (never validated field-by-field
--                         here, exactly like decision_outcomes.outcome_signals).
--   created_at             standard, no updated_at — immutable by construction.
--
-- ===========================================================================
-- Idempotence / supersession — uniqueness
-- ===========================================================================
-- UNIQUE (evidence_identity_id, revision_number) — no two revisions of the
-- same identity may share a revision number.
-- Partial UNIQUE (supersedes_id) WHERE supersedes_id IS NOT NULL — no
-- revision may be superseded by more than one successor (a linear chain,
-- never a fork).

create table public.pattern_evidence_revisions (
  id uuid primary key default gen_random_uuid(),
  evidence_identity_id uuid not null references public.pattern_evidence_identities(id) on delete restrict,
  revision_number integer not null,
  supersedes_id uuid references public.pattern_evidence_revisions(id) on delete restrict,
  event_type public.pattern_evidence_event_type not null,
  event_date date not null,
  observed_value jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint pattern_evidence_revisions_revision_number_check check (revision_number >= 1),
  constraint pattern_evidence_revisions_observed_value_is_object check (jsonb_typeof(observed_value) = 'object'),
  constraint pattern_evidence_revisions_supersedes_consistency check (
    (revision_number = 1 and supersedes_id is null)
    or (revision_number > 1 and supersedes_id is not null)
  ),
  constraint pattern_evidence_revisions_unique_revision unique (evidence_identity_id, revision_number)
);

create unique index idx_pattern_evidence_revisions_supersedes_unique
  on public.pattern_evidence_revisions (supersedes_id)
  where supersedes_id is not null;

-- Supports "current head" lookups (highest revision_number per identity) —
-- the exact access pattern pattern_evidence_current (a later migration) uses.
create index idx_pattern_evidence_revisions_current
  on public.pattern_evidence_revisions (evidence_identity_id, revision_number desc);

-- ===========================================================================
-- Predecessor-chain hardening (M5_006A explicit requirement, in addition to
-- the lock spec) — rejects a malformed INSERT even from trusted service-role
-- application code. Allocation of revision_number/supersedes_id itself
-- remains entirely owned by persist_pattern_evidence under the identity
-- lock; this trigger only ever VALIDATES what was proposed, never allocates.
-- ===========================================================================
create or replace function public.check_pattern_evidence_revision_predecessor() returns trigger
  language plpgsql
  as $$
declare
  v_predecessor_identity_id uuid;
  v_predecessor_revision_number integer;
begin
  if NEW.revision_number = 1 then
    if NEW.supersedes_id is not null then
      raise exception 'pattern_evidence_revisions: revision 1 must have supersedes_id NULL (got %)', NEW.supersedes_id;
    end if;
    return NEW;
  end if;

  -- revision_number > 1 here (revision_number >= 1 already enforced by the table CHECK).
  if NEW.supersedes_id is null then
    raise exception 'pattern_evidence_revisions: revision % must specify supersedes_id', NEW.revision_number;
  end if;

  select evidence_identity_id, revision_number
  into v_predecessor_identity_id, v_predecessor_revision_number
  from public.pattern_evidence_revisions
  where id = NEW.supersedes_id;

  if not found then
    raise exception 'pattern_evidence_revisions: supersedes_id % does not reference an existing revision', NEW.supersedes_id;
  end if;

  if v_predecessor_identity_id <> NEW.evidence_identity_id then
    raise exception 'pattern_evidence_revisions: supersedes_id % belongs to a different evidence_identity_id (% expected %)',
      NEW.supersedes_id, v_predecessor_identity_id, NEW.evidence_identity_id;
  end if;

  if v_predecessor_revision_number <> NEW.revision_number - 1 then
    raise exception 'pattern_evidence_revisions: supersedes_id % is revision %, but revision % may only supersede its immediate predecessor (revision %)',
      NEW.supersedes_id, v_predecessor_revision_number, NEW.revision_number, NEW.revision_number - 1;
  end if;

  return NEW;
end;
$$;

create trigger trg_pattern_evidence_revisions_predecessor_check
  before insert on public.pattern_evidence_revisions
  for each row execute function public.check_pattern_evidence_revision_predecessor();

create trigger trg_pattern_evidence_revisions_no_update
  before update on public.pattern_evidence_revisions
  for each row execute function public.reject_append_only_mutation();

create trigger trg_pattern_evidence_revisions_no_delete
  before delete on public.pattern_evidence_revisions
  for each row execute function public.reject_append_only_mutation();

alter table public.pattern_evidence_revisions enable row level security;

-- Scoped through evidence_identity_id -> pattern_evidence_identities.athlete_id,
-- exactly like completed_sessions_by_decision-style joins elsewhere in this schema.
create policy "pattern_evidence_revisions_own_select"
  on public.pattern_evidence_revisions
  for select
  to authenticated
  using (
    evidence_identity_id in (
      select pei.id
      from public.pattern_evidence_identities pei
      where pei.athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
    )
  );

revoke all privileges on public.pattern_evidence_revisions from anon;
revoke all privileges on public.pattern_evidence_revisions from authenticated;
revoke all privileges on public.pattern_evidence_revisions from service_role;

grant select on public.pattern_evidence_revisions to authenticated;
grant select, insert on public.pattern_evidence_revisions to service_role;
