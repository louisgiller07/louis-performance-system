-- V0.4_001D — training_plan_planned_prescriptions / decision_final_
-- prescriptions: the two-stage prescription contract (M0 §3), persisted as
-- TWO tables, not a unified `session_prescriptions` + stage discriminator —
-- see M2 persistence closure §E for the full reasoning this migration
-- implements. Summary: the two have genuinely different, always-mandatory
-- ownership chains (session->week->block->version for planned; decision for
-- final) and this schema has zero precedent for a nullable-dual-FK-plus-
-- discriminator table anywhere; every table audited has exactly one clean
-- mandatory FK.
--
-- ===========================================================================
-- FinalPrescription provenance — two orthogonal axes, not one `source` enum
-- ===========================================================================
-- Final closure (this conversation) replaced the original single `source`
-- enum with active_session_origin (where did today's active session come
-- from, relative to the canonical plan) x reconciliation_action (what did
-- Head Coach do to it) — the single-axis version could not represent "the
-- athlete manually overrode the session, AND Head Coach subsequently
-- modified it further", a real, valid combination. All 12 combinations of
-- the two 4/3-valued enums are valid; the three CHECK constraints below
-- encode exactly the presence rules derived in that closure (see each
-- constraint's own comment for which axis governs it).
--
-- planning-engine/src/types/prescription.ts's FinalPrescription interface
-- now declares activeSessionOrigin + reconciliationAction directly (the
-- single `source: FinalPrescriptionSource` field was removed) — aligned in
-- the "Align planning-engine M1 contracts with the locked M2 persistence
-- model" follow-up; M1 and this table agree exactly.

create table public.training_plan_planned_prescriptions (
  id uuid primary key default gen_random_uuid(),
  generated_plan_session_id uuid not null,
  plan_version_id uuid not null,
  schema_version text not null,
  catalog_version text not null,
  structure jsonb not null,

  constraint training_plan_planned_prescriptions_schema_version_not_blank check (length(trim(schema_version)) > 0),
  constraint training_plan_planned_prescriptions_catalog_version_not_blank check (length(trim(catalog_version)) > 0),
  constraint training_plan_planned_prescriptions_structure_is_object check (jsonb_typeof(structure) = 'object'),
  -- At most one planned prescription per session (a REST/no-content session
  -- legitimately has none — see training_plan_generated_sessions).
  constraint training_plan_planned_prescriptions_unique_session unique (generated_plan_session_id),
  constraint training_plan_planned_prescriptions_unique_id_version unique (id, plan_version_id),

  constraint training_plan_planned_prescriptions_session_fk
    foreign key (generated_plan_session_id, plan_version_id)
    references public.training_plan_generated_sessions (id, plan_version_id)
    on delete restrict
);

create trigger trg_training_plan_planned_prescriptions_no_update
  before update on public.training_plan_planned_prescriptions
  for each row execute function public.reject_append_only_mutation();

create trigger trg_training_plan_planned_prescriptions_no_delete
  before delete on public.training_plan_planned_prescriptions
  for each row execute function public.reject_append_only_mutation();

alter table public.training_plan_planned_prescriptions enable row level security;

create policy "training_plan_planned_prescriptions_own_select"
  on public.training_plan_planned_prescriptions
  for select
  to authenticated
  using (
    plan_version_id in (
      select tpv.id from public.training_plan_versions tpv
      where tpv.athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
    )
  );

revoke all privileges on public.training_plan_planned_prescriptions from anon;
revoke all privileges on public.training_plan_planned_prescriptions from authenticated;
revoke all privileges on public.training_plan_planned_prescriptions from service_role;

grant select on public.training_plan_planned_prescriptions to authenticated;
grant select on public.training_plan_planned_prescriptions to service_role;

-- ===========================================================================
-- decision_final_prescriptions
-- ===========================================================================
create type public.final_prescription_active_session_origin as enum (
  'generated',
  'manual_override_same_kind',
  'manual_override_new_kind',
  'no_canonical_plan'
);

create type public.final_prescription_reconciliation_action as enum (
  'keep',
  'modify',
  'replace'
);

create table public.decision_final_prescriptions (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null,
  athlete_id uuid not null,
  plan_version_id uuid,
  planned_prescription_id uuid,

  active_session_origin public.final_prescription_active_session_origin not null,
  reconciliation_action public.final_prescription_reconciliation_action not null,
  adaptation_rule_ids jsonb not null default '[]'::jsonb,

  schema_version text not null,
  catalog_version text not null,
  structure jsonb not null,
  generated_at timestamptz not null default clock_timestamp(),

  constraint decision_final_prescriptions_schema_version_not_blank check (length(trim(schema_version)) > 0),
  constraint decision_final_prescriptions_catalog_version_not_blank check (length(trim(catalog_version)) > 0),
  constraint decision_final_prescriptions_structure_is_object check (jsonb_typeof(structure) = 'object'),
  constraint decision_final_prescriptions_adaptation_rule_ids_is_array check (jsonb_typeof(adaptation_rule_ids) = 'array'),

  -- Axis 1 (active_session_origin) governs plan_version_id: required unless
  -- no canonical plan covered this date at all.
  constraint decision_final_prescriptions_plan_version_presence check (
    (active_session_origin <> 'no_canonical_plan' and plan_version_id is not null)
    or
    (active_session_origin = 'no_canonical_plan' and plan_version_id is null)
  ),

  -- Both axes together govern planned_prescription_id: required only when
  -- origin carries same-kind lineage (generated / manual_override_same_kind)
  -- AND the action didn't break it. `replace` always nulls it, regardless of
  -- origin — by definition the resulting content no longer derives from the
  -- compatible planned prescription even when one exists.
  constraint decision_final_prescriptions_planned_prescription_presence check (
    (
      active_session_origin in ('generated', 'manual_override_same_kind')
      and reconciliation_action in ('keep', 'modify')
      and planned_prescription_id is not null
    )
    or
    (
      not (
        active_session_origin in ('generated', 'manual_override_same_kind')
        and reconciliation_action in ('keep', 'modify')
      )
      and planned_prescription_id is null
    )
  ),

  -- Axis 2 (reconciliation_action) governs adaptation_rule_ids: empty iff
  -- action=keep (nothing to explain); non-empty for modify/replace (never
  -- silent — the same "never silent" discipline as every golden scenario).
  constraint decision_final_prescriptions_adaptation_rule_ids_matches_action check (
    (reconciliation_action = 'keep' and jsonb_array_length(adaptation_rule_ids) = 0)
    or
    (reconciliation_action in ('modify', 'replace') and jsonb_array_length(adaptation_rule_ids) > 0)
  ),

  -- Cross-athlete integrity (M2 closure §A) — composite FKs, not RLS alone
  -- (service_role bypasses RLS; these constraints do not).
  constraint decision_final_prescriptions_decision_fk
    foreign key (decision_id, athlete_id)
    references public.decisions (id, athlete_id)
    on delete restrict,

  constraint decision_final_prescriptions_plan_version_fk
    foreign key (plan_version_id, athlete_id)
    references public.training_plan_versions (id, athlete_id)
    on delete restrict,

  -- Plan-lineage compatibility: where a planned prescription IS referenced,
  -- it must belong to the SAME plan_version_id also named on this row.
  -- Nullable-safe under Postgres' default MATCH SIMPLE — a no-op whenever
  -- planned_prescription_id is null, which decision_final_prescriptions_
  -- planned_prescription_presence above guarantees coincides exactly with
  -- plan_version_id also being null in the cases where that would matter.
  constraint decision_final_prescriptions_planned_prescription_fk
    foreign key (planned_prescription_id, plan_version_id)
    references public.training_plan_planned_prescriptions (id, plan_version_id)
    on delete restrict
);

create index idx_decision_final_prescriptions_decision
  on public.decision_final_prescriptions (decision_id);

create trigger trg_decision_final_prescriptions_no_update
  before update on public.decision_final_prescriptions
  for each row execute function public.reject_append_only_mutation();

create trigger trg_decision_final_prescriptions_no_delete
  before delete on public.decision_final_prescriptions
  for each row execute function public.reject_append_only_mutation();

alter table public.decision_final_prescriptions enable row level security;

create policy "decision_final_prescriptions_own_select"
  on public.decision_final_prescriptions
  for select
  to authenticated
  using (
    athlete_id in (select athletes.id from public.athletes where athletes.user_id = auth.uid())
  );

revoke all privileges on public.decision_final_prescriptions from anon;
revoke all privileges on public.decision_final_prescriptions from authenticated;
revoke all privileges on public.decision_final_prescriptions from service_role;

grant select on public.decision_final_prescriptions to authenticated;
grant select on public.decision_final_prescriptions to service_role;
