-- M5_006B — pattern_evidence_lifecycle_transitions: an append-only,
-- immutable, numbered chain of active/withdrawn transitions layered on top
-- of one M5_006A evidence identity. Mirrors pattern_evidence_revisions'
-- identity/revision-chain discipline exactly (same predecessor-chain
-- hardening, same double-layer append-only immutability, same
-- least-privilege grants), but tracks a SEPARATE axis: whether the
-- CURRENT evidence head should currently be treated as active or
-- withdrawn (e.g. re-evaluated later and found to no longer hold), never
-- the evidence content itself (that remains pattern_evidence_revisions'
-- job, entirely unchanged by this migration). See docs/11_DECISION_LOG.md
-- (M5_006B).
--
-- An evidence identity with ZERO lifecycle rows is, by definition, active
-- (see transition_pattern_evidence_lifecycle, a later migration) — this
-- table only ever records a CHANGE away from that default, or a
-- subsequent change back.
--
-- ===========================================================================
-- Columns
-- ===========================================================================
--   id                    own identity.
--   evidence_identity_id  FK -> pattern_evidence_identities(id), ON DELETE
--                         RESTRICT — same audit-durability rationale as
--                         pattern_evidence_revisions.
--   transition_number     1, 2, 3... strictly increasing per identity,
--                         allocated exclusively by
--                         transition_pattern_evidence_lifecycle /
--                         persist_active_pattern_evidence while that
--                         identity's transaction-scoped advisory lock is
--                         held — same discipline as revision_number.
--   supersedes_id         NULL for transition 1; for transition N>1, the id
--                         of transition N-1 of the SAME identity — enforced
--                         by the BEFORE INSERT trigger below.
--   state                 active | withdrawn.
--   reason_code            NULL when state=active, a short (1-128 char)
--                         machine-readable code when state=withdrawn (e.g.
--                         a detector's own NoEvidence.reason).
--   context               NOT NULL jsonb object — '{}'::jsonb when
--                         state=active, an opaque detector-owned object
--                         when state=withdrawn (e.g. which checkin drove
--                         the withdrawal). Never validated field-by-field
--                         here, exactly like pattern_evidence_revisions.observed_value.
--   created_at             standard, no updated_at — immutable by construction.

create type public.pattern_evidence_lifecycle_state as enum ('active', 'withdrawn');

create table public.pattern_evidence_lifecycle_transitions (
  id uuid primary key default gen_random_uuid(),
  evidence_identity_id uuid not null references public.pattern_evidence_identities(id) on delete restrict,
  transition_number integer not null,
  supersedes_id uuid references public.pattern_evidence_lifecycle_transitions(id) on delete restrict,
  state public.pattern_evidence_lifecycle_state not null,
  reason_code text,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint pattern_evidence_lifecycle_transitions_number_check check (transition_number >= 1),
  constraint pattern_evidence_lifecycle_transitions_context_is_object check (jsonb_typeof(context) = 'object'),
  constraint pattern_evidence_lifecycle_transitions_supersedes_consistency check (
    (transition_number = 1 and supersedes_id is null)
    or (transition_number > 1 and supersedes_id is not null)
  ),
  constraint pattern_evidence_lifecycle_transitions_active_shape check (
    state <> 'active' or (reason_code is null and context = '{}'::jsonb)
  ),
  constraint pattern_evidence_lifecycle_transitions_withdrawn_shape check (
    state <> 'withdrawn' or (reason_code is not null and char_length(reason_code) between 1 and 128)
  ),
  constraint pattern_evidence_lifecycle_transitions_unique_transition unique (evidence_identity_id, transition_number)
);

create unique index idx_pattern_evidence_lifecycle_transitions_supersedes_unique
  on public.pattern_evidence_lifecycle_transitions (supersedes_id)
  where supersedes_id is not null;

-- Supports "current lifecycle state" lookups (highest transition_number per
-- identity) — the exact access pattern pattern_evidence_current_state (a
-- later migration) uses.
create index idx_pattern_evidence_lifecycle_transitions_current
  on public.pattern_evidence_lifecycle_transitions (evidence_identity_id, transition_number desc);

-- ===========================================================================
-- Predecessor-chain hardening — exact same strength/shape as
-- check_pattern_evidence_revision_predecessor (M5_006A). Validates only what
-- the RPC proposes; allocation itself remains exclusively RPC-owned under
-- the identity's advisory lock.
-- ===========================================================================
create or replace function public.check_pattern_evidence_lifecycle_predecessor() returns trigger
  language plpgsql
  as $$
declare
  v_predecessor_identity_id uuid;
  v_predecessor_transition_number integer;
begin
  if NEW.transition_number = 1 then
    if NEW.supersedes_id is not null then
      raise exception 'pattern_evidence_lifecycle_transitions: transition 1 must have supersedes_id NULL (got %)', NEW.supersedes_id;
    end if;
    return NEW;
  end if;

  -- transition_number > 1 here (transition_number >= 1 already enforced by the table CHECK).
  if NEW.supersedes_id is null then
    raise exception 'pattern_evidence_lifecycle_transitions: transition % must specify supersedes_id', NEW.transition_number;
  end if;

  select evidence_identity_id, transition_number
  into v_predecessor_identity_id, v_predecessor_transition_number
  from public.pattern_evidence_lifecycle_transitions
  where id = NEW.supersedes_id;

  if not found then
    raise exception 'pattern_evidence_lifecycle_transitions: supersedes_id % does not reference an existing transition', NEW.supersedes_id;
  end if;

  if v_predecessor_identity_id <> NEW.evidence_identity_id then
    raise exception 'pattern_evidence_lifecycle_transitions: supersedes_id % belongs to a different evidence_identity_id (% expected %)',
      NEW.supersedes_id, v_predecessor_identity_id, NEW.evidence_identity_id;
  end if;

  if v_predecessor_transition_number <> NEW.transition_number - 1 then
    raise exception 'pattern_evidence_lifecycle_transitions: supersedes_id % is transition %, but transition % may only supersede its immediate predecessor (transition %)',
      NEW.supersedes_id, v_predecessor_transition_number, NEW.transition_number, NEW.transition_number - 1;
  end if;

  return NEW;
end;
$$;

create trigger trg_pattern_evidence_lifecycle_transitions_predecessor_check
  before insert on public.pattern_evidence_lifecycle_transitions
  for each row execute function public.check_pattern_evidence_lifecycle_predecessor();

-- reject_append_only_mutation() already exists (M5_006A) — generic, keyed
-- only off TG_OP/TG_TABLE_NAME, reused verbatim here rather than redefined.
create trigger trg_pattern_evidence_lifecycle_transitions_no_update
  before update on public.pattern_evidence_lifecycle_transitions
  for each row execute function public.reject_append_only_mutation();

create trigger trg_pattern_evidence_lifecycle_transitions_no_delete
  before delete on public.pattern_evidence_lifecycle_transitions
  for each row execute function public.reject_append_only_mutation();

alter table public.pattern_evidence_lifecycle_transitions enable row level security;

create policy "pattern_evidence_lifecycle_transitions_own_select"
  on public.pattern_evidence_lifecycle_transitions
  for select
  to authenticated
  using (
    evidence_identity_id in (
      select pei.id
      from public.pattern_evidence_identities pei
      where pei.athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
    )
  );

revoke all privileges on public.pattern_evidence_lifecycle_transitions from anon;
revoke all privileges on public.pattern_evidence_lifecycle_transitions from authenticated;
revoke all privileges on public.pattern_evidence_lifecycle_transitions from service_role;

grant select on public.pattern_evidence_lifecycle_transitions to authenticated;
grant select, insert on public.pattern_evidence_lifecycle_transitions to service_role;
