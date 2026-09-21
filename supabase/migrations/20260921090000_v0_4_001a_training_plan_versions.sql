-- V0.4_001A — training_plan_versions: canonical, immutable content root of
-- one generated training plan (NALYNT V0.4 M2 persistence — architecture
-- closed across three design conversations; docs/11_DECISION_LOG.md entry
-- to follow separately). Mirrors the pattern_evidence_identities precedent
-- exactly: content-only, insert-once, no status field — lifecycle lives
-- entirely in training_plan_version_lifecycle_transitions (next migration).
--
-- ===========================================================================
-- Cross-athlete integrity — composite identity, not RLS alone
-- ===========================================================================
-- UNIQUE(id, athlete_id) lets every child table down the whole plan tree
-- (blocks/weeks/sessions/prescriptions) enforce same-athlete/same-version
-- ownership via composite FK, structurally — not by convention, and not
-- bypassable by service_role the way an RLS policy would be. Same technique
-- used again in every migration that follows.
--
-- base_version_id is a self-referential composite FK: a regeneration's base
-- version must belong to the SAME athlete as the new version, enforced by
-- the FK itself, never left to service-layer discipline.
--
-- generation_request_id is the idempotency key for generate_training_plan_
-- version (v0_4_001e) — one UUID per LOGICAL generation request, supplied
-- by the caller, scoped UNIQUE(athlete_id, generation_request_id).
-- input_snapshot_hash stays pure audit/provenance metadata, never identity:
-- a deliberate regeneration with byte-identical inputs must still be
-- allowed, which a hash-based identity would incorrectly collapse.
--
-- input_snapshot_schema_version: identified as a gap during the M2
-- persistence closure (PlanInputSnapshot's shape can evolve independently of
-- planner/ruleset version). planning-engine/src/types/planVersion.ts's
-- TrainingPlanVersion now carries this field (and generationRequestId)
-- verbatim — aligned in the "Align planning-engine M1 contracts with the
-- locked M2 persistence model" follow-up; M1 and this table agree exactly.
--
-- ON DELETE RESTRICT throughout (athlete_id, base_version_id): this whole
-- subsystem is immutable/audit-relevant content, mirroring
-- pattern_evidence_identities' own RESTRICT rationale exactly. A real
-- athlete deletion needs its own explicit, separately-security-reviewed
-- purge mechanism (deliberately NOT built in this batch — see
-- reject_append_only_mutation below); CASCADE would conflict with that
-- trigger's unconditional rejection of DELETE.

create type public.plan_generation_trigger as enum (
  'initial',
  'race_added',
  'race_removed',
  'availability_changed',
  'equipment_changed',
  'missed_session',
  'manual_edit',
  'ruleset_upgrade'
);

create table public.training_plan_versions (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete restrict,
  base_version_id uuid,

  horizon_start_date date not null,
  horizon_end_date date not null,

  input_snapshot jsonb not null,
  input_snapshot_schema_version text not null,
  input_snapshot_hash text not null,

  planner_version text not null,
  ruleset_version text not null,
  catalog_version text not null,
  prescription_schema_version text not null,

  generation_trigger public.plan_generation_trigger not null,
  generation_request_id uuid not null,
  generated_at timestamptz not null default clock_timestamp(),

  rationale text not null,
  relaxed_constraints jsonb not null default '[]'::jsonb,

  constraint training_plan_versions_horizon_order check (horizon_end_date >= horizon_start_date),
  constraint training_plan_versions_input_snapshot_is_object check (jsonb_typeof(input_snapshot) = 'object'),
  constraint training_plan_versions_relaxed_constraints_is_array check (jsonb_typeof(relaxed_constraints) = 'array'),
  constraint training_plan_versions_rationale_not_blank check (length(trim(rationale)) > 0),
  constraint training_plan_versions_input_schema_version_not_blank check (length(trim(input_snapshot_schema_version)) > 0),
  constraint training_plan_versions_hash_not_blank check (length(trim(input_snapshot_hash)) > 0),
  constraint training_plan_versions_planner_version_not_blank check (length(trim(planner_version)) > 0),
  constraint training_plan_versions_ruleset_version_not_blank check (length(trim(ruleset_version)) > 0),
  constraint training_plan_versions_catalog_version_not_blank check (length(trim(catalog_version)) > 0),
  constraint training_plan_versions_prescription_schema_version_not_blank check (length(trim(prescription_schema_version)) > 0),

  constraint training_plan_versions_unique_id_athlete unique (id, athlete_id),
  constraint training_plan_versions_unique_generation_request unique (athlete_id, generation_request_id),

  constraint training_plan_versions_base_version_fk
    foreign key (base_version_id, athlete_id)
    references public.training_plan_versions (id, athlete_id)
    on delete restrict
);

create index idx_training_plan_versions_athlete_generated
  on public.training_plan_versions (athlete_id, generated_at desc);

alter table public.training_plan_versions enable row level security;

create policy "training_plan_versions_own_select"
  on public.training_plan_versions
  for select
  to authenticated
  using (
    athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
  );

-- Same ALTER DEFAULT PRIVILEGES over-broad-grant reality as every other
-- post-baseline migration in this project — revoke explicitly before
-- granting the exact minimum.
revoke all privileges on public.training_plan_versions from anon;
revoke all privileges on public.training_plan_versions from authenticated;
revoke all privileges on public.training_plan_versions from service_role;

grant select on public.training_plan_versions to authenticated;
grant select on public.training_plan_versions to service_role;
-- service_role deliberately does NOT receive insert here: the only write
-- path is generate_training_plan_version (v0_4_001e), a SECURITY DEFINER
-- RPC — direct multi-table inserts are never granted, so a caller cannot
-- bypass that RPC's atomicity/idempotency/ordering guarantees even by
-- accident (e.g. a one-off script inserting a version without its blocks).

-- reject_append_only_mutation() already exists (M5_006A) — generic, keyed
-- only off TG_OP/TG_TABLE_NAME, reused verbatim rather than redefined.
create trigger trg_training_plan_versions_no_update
  before update on public.training_plan_versions
  for each row execute function public.reject_append_only_mutation();

create trigger trg_training_plan_versions_no_delete
  before delete on public.training_plan_versions
  for each row execute function public.reject_append_only_mutation();

-- ===========================================================================
-- Additive touch to the existing, frozen `decisions` table
-- ===========================================================================
-- Purely additive unique index — zero behavior change to persist_daily_run
-- (M2_006) or any existing read/RLS policy on decisions. Required so
-- decision_final_prescriptions (v0_4_001d) can enforce, via composite FK,
-- that a FinalPrescription's plan_version_id belongs to the SAME athlete as
-- its decision_id — without a trigger, and without RLS (which service_role
-- bypasses and is therefore not a sufficient guarantee on its own).
alter table public.decisions
  add constraint decisions_unique_id_athlete unique (id, athlete_id);
