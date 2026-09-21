-- V0.4_001E — generate_training_plan_version: atomic, idempotent persistence
-- of one full generated training plan (version + first draft transition +
-- blocks + weeks + sessions + planned prescriptions), in a single
-- transaction. A PostgreSQL FUNCTION executes intrinsically inside one
-- transaction (no explicit COMMIT/ROLLBACK, invalid inside a FUNCTION) —
-- any uncaught exception unwinds the entire call, exactly like
-- persist_daily_run (M2_006).
--
-- Pure transactional recorder, same discipline as persist_daily_run: no
-- coaching logic, no catalogue/rep-scheme validation. Those are
-- planning-engine's M1 TypeScript validators' job (validatePrescription.ts,
-- validateCatalog.ts, validatePlanInputSnapshot.ts, etc.), already run
-- BEFORE this RPC is ever called — see the M2 persistence closure's
-- "Validation + transactional write architecture" answer. This function
-- trusts its caller's payload structurally (required-field presence) and
-- leans on each table's own CHECK/FK constraints (v0_4_001a-d) for the rest.
--
-- ===========================================================================
-- Why SECURITY DEFINER — a deliberate departure from this schema's
-- otherwise-universal SECURITY INVOKER convention
-- ===========================================================================
-- Every other RPC in this schema (persist_daily_run, persist_completed_
-- session, persist_decision_outcome, the persist_pattern_evidence family) is
-- SECURITY INVOKER, relying on service_role holding direct table grants plus
-- convention (only trusted backend code calls the RPC) to keep writes
-- funneled through it. This subsystem is deliberately different:
-- service_role received SELECT only on all five tables this function
-- touches (v0_4_001a-d) specifically so a future maintainer cannot bypass
-- this function's atomicity/idempotency/ordering guarantees even by
-- accident — e.g. a one-off script inserting a block without its version.
-- SECURITY DEFINER lets this function run with its owner's privileges
-- regardless of the caller's (service_role's) own grants. `set search_path =
-- public` is pinned explicitly — the standard, required defense against
-- search_path hijacking for SECURITY DEFINER functions specifically (the
-- existing SECURITY INVOKER RPCs in this schema already pin it defensively
-- even without needing it as strictly; here it is not optional).
--
-- ===========================================================================
-- Idempotency contract (M2 persistence closure — generation idempotency)
-- ===========================================================================
-- p_generation_request_id is a caller-supplied UUID, one per LOGICAL
-- generation request (never derived from input content — a deliberate
-- regeneration with byte-identical inputs must still be allowed, which a
-- content-hash identity would incorrectly collapse). Locked under an
-- athlete+request-scoped advisory lock (so a genuine concurrent retry race
-- cannot both pass the "not found" check and collide on the unique
-- constraint), then, on (p_athlete_id, p_generation_request_id):
--   - no existing row -> proceed with a full insert.
--   - an existing row whose input_snapshot_hash, planner_version,
--     ruleset_version, catalog_version, prescription_schema_version AND
--     input_snapshot_schema_version all match the new payload -> idempotent
--     no-op, returns the existing version's id untouched.
--   - an existing row where ANY of those six differ -> exception. A retry
--     whose generation environment moved on (new planner/ruleset/catalogue)
--     must conflict, never silently return an incompatible old draft.
--
-- ===========================================================================
-- Parameters
-- ===========================================================================
-- p_version: jsonb object — the TrainingPlanVersion fields (M1 field names,
--   camelCase), minus athleteId (= p_athlete_id) and generationRequestId
--   (its own param, the identity key).
-- p_blocks / p_weeks / p_sessions / p_planned_prescriptions: jsonb arrays of
--   already-validated (M1 TypeScript validators, before this call) rows,
--   each carrying its own `id` (caller-assigned, matching this project's
--   convention that the DTO is fully-formed with real ids before it ever
--   reaches SQL) and the FK id it belongs to (blockId/weekId/
--   generatedPlanSessionId). plan_version_id is NEVER read from these
--   payloads — this function always injects it from the version row it just
--   created, so a caller cannot desync a nested row from its own parent.

create or replace function public.generate_training_plan_version(
  p_athlete_id uuid,
  p_generation_request_id uuid,
  p_version jsonb,
  p_blocks jsonb,
  p_weeks jsonb,
  p_sessions jsonb,
  p_planned_prescriptions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id uuid;
  v_existing_hash text;
  v_existing_planner text;
  v_existing_ruleset text;
  v_existing_catalog text;
  v_existing_prescription_schema text;
  v_existing_input_schema text;

  v_version_id uuid;
  v_base_version_id uuid;
  v_horizon_start date;
  v_horizon_end date;
  v_input_snapshot jsonb;
  v_input_snapshot_schema_version text;
  v_input_snapshot_hash text;
  v_planner_version text;
  v_ruleset_version text;
  v_catalog_version text;
  v_prescription_schema_version text;
  v_generation_trigger public.plan_generation_trigger;
  v_rationale text;
  v_relaxed_constraints jsonb;

  v_block jsonb;
  v_week jsonb;
  v_session jsonb;
  v_prescription jsonb;
begin
  if p_version is null then
    raise exception 'generate_training_plan_version: p_version is required';
  end if;
  if p_generation_request_id is null then
    raise exception 'generate_training_plan_version: p_generation_request_id is required';
  end if;

  -----------------------------------------------------------------------
  -- 0. Athlete+request advisory lock — serializes a genuine concurrent
  -- retry of the SAME logical request against itself, so the idempotency
  -- check below cannot race its own insert. Transaction-scoped, released
  -- automatically, never leaked — same technique as persist_pattern_
  -- evidence's identity lock (M5_006A).
  -----------------------------------------------------------------------
  perform pg_advisory_xact_lock(hashtextextended(
    length(p_athlete_id::text)::text || ':' || p_athlete_id::text
    || '|' || length(p_generation_request_id::text)::text || ':' || p_generation_request_id::text,
    0
  ));

  -----------------------------------------------------------------------
  -- 1. Idempotency check — see module doc above.
  -----------------------------------------------------------------------
  if not (p_version ? 'inputSnapshotHash') or (p_version->>'inputSnapshotHash') is null then
    raise exception 'generate_training_plan_version: p_version.inputSnapshotHash is required';
  end if;
  v_input_snapshot_hash := p_version->>'inputSnapshotHash';

  if not (p_version ? 'plannerVersion') or (p_version->>'plannerVersion') is null then
    raise exception 'generate_training_plan_version: p_version.plannerVersion is required';
  end if;
  v_planner_version := p_version->>'plannerVersion';

  if not (p_version ? 'rulesetVersion') or (p_version->>'rulesetVersion') is null then
    raise exception 'generate_training_plan_version: p_version.rulesetVersion is required';
  end if;
  v_ruleset_version := p_version->>'rulesetVersion';

  if not (p_version ? 'catalogVersion') or (p_version->>'catalogVersion') is null then
    raise exception 'generate_training_plan_version: p_version.catalogVersion is required';
  end if;
  v_catalog_version := p_version->>'catalogVersion';

  if not (p_version ? 'prescriptionSchemaVersion') or (p_version->>'prescriptionSchemaVersion') is null then
    raise exception 'generate_training_plan_version: p_version.prescriptionSchemaVersion is required';
  end if;
  v_prescription_schema_version := p_version->>'prescriptionSchemaVersion';

  if not (p_version ? 'inputSnapshotSchemaVersion') or (p_version->>'inputSnapshotSchemaVersion') is null then
    raise exception 'generate_training_plan_version: p_version.inputSnapshotSchemaVersion is required';
  end if;
  v_input_snapshot_schema_version := p_version->>'inputSnapshotSchemaVersion';

  select id, input_snapshot_hash, planner_version, ruleset_version, catalog_version,
         prescription_schema_version, input_snapshot_schema_version
  into v_existing_id, v_existing_hash, v_existing_planner, v_existing_ruleset, v_existing_catalog,
       v_existing_prescription_schema, v_existing_input_schema
  from public.training_plan_versions
  where athlete_id = p_athlete_id
    and generation_request_id = p_generation_request_id;

  if found then
    if v_existing_hash = v_input_snapshot_hash
       and v_existing_planner = v_planner_version
       and v_existing_ruleset = v_ruleset_version
       and v_existing_catalog = v_catalog_version
       and v_existing_prescription_schema = v_prescription_schema_version
       and v_existing_input_schema = v_input_snapshot_schema_version then
      return jsonb_build_object('plan_version_id', v_existing_id, 'idempotent_replay', true);
    else
      raise exception 'generate_training_plan_version: generation_request_id % already used for athlete % with a different generation environment (existing version %)',
        p_generation_request_id, p_athlete_id, v_existing_id;
    end if;
  end if;

  -----------------------------------------------------------------------
  -- 2. Version row.
  -----------------------------------------------------------------------
  if not (p_version ? 'id') or (p_version->>'id') is null then
    raise exception 'generate_training_plan_version: p_version.id is required';
  end if;
  v_version_id := (p_version->>'id')::uuid;

  if (p_version ? 'baseVersionId') and (p_version->>'baseVersionId') is not null then
    v_base_version_id := (p_version->>'baseVersionId')::uuid;
  else
    v_base_version_id := null;
  end if;

  if not (p_version ? 'horizonStartDate') or (p_version->>'horizonStartDate') is null then
    raise exception 'generate_training_plan_version: p_version.horizonStartDate is required';
  end if;
  v_horizon_start := (p_version->>'horizonStartDate')::date;

  if not (p_version ? 'horizonEndDate') or (p_version->>'horizonEndDate') is null then
    raise exception 'generate_training_plan_version: p_version.horizonEndDate is required';
  end if;
  v_horizon_end := (p_version->>'horizonEndDate')::date;

  if not (p_version ? 'inputSnapshot')
     or (p_version->'inputSnapshot') is null
     or jsonb_typeof(p_version->'inputSnapshot') <> 'object' then
    raise exception 'generate_training_plan_version: p_version.inputSnapshot must be a non-null JSON object';
  end if;
  v_input_snapshot := p_version->'inputSnapshot';

  if not (p_version ? 'generationTrigger') or (p_version->>'generationTrigger') is null then
    raise exception 'generate_training_plan_version: p_version.generationTrigger is required';
  end if;
  v_generation_trigger := (p_version->>'generationTrigger')::public.plan_generation_trigger;

  if not (p_version ? 'rationale') or (p_version->>'rationale') is null then
    raise exception 'generate_training_plan_version: p_version.rationale is required';
  end if;
  v_rationale := p_version->>'rationale';

  if (p_version ? 'relaxedConstraints') and (p_version->'relaxedConstraints') is not null then
    v_relaxed_constraints := p_version->'relaxedConstraints';
  else
    v_relaxed_constraints := '[]'::jsonb;
  end if;

  insert into public.training_plan_versions (
    id, athlete_id, base_version_id, horizon_start_date, horizon_end_date,
    input_snapshot, input_snapshot_schema_version, input_snapshot_hash,
    planner_version, ruleset_version, catalog_version, prescription_schema_version,
    generation_trigger, generation_request_id, rationale, relaxed_constraints
  ) values (
    v_version_id, p_athlete_id, v_base_version_id, v_horizon_start, v_horizon_end,
    v_input_snapshot, v_input_snapshot_schema_version, v_input_snapshot_hash,
    v_planner_version, v_ruleset_version, v_catalog_version, v_prescription_schema_version,
    v_generation_trigger, p_generation_request_id, v_rationale, v_relaxed_constraints
  );

  -----------------------------------------------------------------------
  -- 3. First lifecycle transition — always transition_number=1, state=draft.
  -----------------------------------------------------------------------
  insert into public.training_plan_version_lifecycle_transitions (
    plan_version_id, transition_number, supersedes_id, state
  ) values (
    v_version_id, 1, null, 'draft'
  );

  -----------------------------------------------------------------------
  -- 4. Blocks — plan_version_id always injected here, never read from payload.
  -----------------------------------------------------------------------
  if p_blocks is null or jsonb_typeof(p_blocks) <> 'array' or jsonb_array_length(p_blocks) = 0 then
    raise exception 'generate_training_plan_version: p_blocks must be a non-empty JSON array';
  end if;

  for v_block in select * from jsonb_array_elements(p_blocks)
  loop
    insert into public.training_plan_blocks (
      id, plan_version_id, sequence_number, name, mode, primary_focus, start_date, end_date
    ) values (
      (v_block->>'id')::uuid,
      v_version_id,
      (v_block->>'sequenceNumber')::integer,
      v_block->>'name',
      (v_block->>'mode')::public.training_mode,
      v_block->>'primaryFocus',
      (v_block->>'startDate')::date,
      (v_block->>'endDate')::date
    );
  end loop;

  -----------------------------------------------------------------------
  -- 5. Weeks.
  -----------------------------------------------------------------------
  if p_weeks is null or jsonb_typeof(p_weeks) <> 'array' or jsonb_array_length(p_weeks) = 0 then
    raise exception 'generate_training_plan_version: p_weeks must be a non-empty JSON array';
  end if;

  for v_week in select * from jsonb_array_elements(p_weeks)
  loop
    insert into public.training_plan_weeks (
      id, block_id, plan_version_id, week_number, start_date, end_date,
      week_type, dose_summary, rationale
    ) values (
      (v_week->>'id')::uuid,
      (v_week->>'blockId')::uuid,
      v_version_id,
      (v_week->>'weekNumber')::integer,
      (v_week->>'startDate')::date,
      (v_week->>'endDate')::date,
      (v_week->>'weekType')::public.plan_week_type,
      v_week->'doseSummary',
      v_week->>'rationale'
    );
  end loop;

  -----------------------------------------------------------------------
  -- 6. Sessions.
  -----------------------------------------------------------------------
  if p_sessions is null or jsonb_typeof(p_sessions) <> 'array' or jsonb_array_length(p_sessions) = 0 then
    raise exception 'generate_training_plan_version: p_sessions must be a non-empty JSON array';
  end if;

  for v_session in select * from jsonb_array_elements(p_sessions)
  loop
    insert into public.training_plan_generated_sessions (
      id, week_id, plan_version_id, date, kind, load_profile, duration_min, focus,
      dose_target, rationale, generation_note
    ) values (
      (v_session->>'id')::uuid,
      (v_session->>'weekId')::uuid,
      v_version_id,
      (v_session->>'date')::date,
      (v_session->>'kind')::public.plan_session_kind,
      case when (v_session->>'loadProfile') is not null then (v_session->>'loadProfile')::public.plan_load_profile else null end,
      case when (v_session->>'durationMin') is not null then (v_session->>'durationMin')::integer else null end,
      v_session->>'focus',
      v_session->'doseTarget',
      v_session->>'rationale',
      v_session->>'generationNote'
    );
  end loop;

  -----------------------------------------------------------------------
  -- 7. Planned prescriptions — may be fewer than p_sessions: a REST/
  -- no-content session legitimately has none (training_plan_planned_
  -- prescriptions_unique_session enforces at most one, not exactly one).
  -----------------------------------------------------------------------
  if p_planned_prescriptions is null or jsonb_typeof(p_planned_prescriptions) <> 'array' then
    raise exception 'generate_training_plan_version: p_planned_prescriptions must be a JSON array (may be empty)';
  end if;

  for v_prescription in select * from jsonb_array_elements(p_planned_prescriptions)
  loop
    insert into public.training_plan_planned_prescriptions (
      id, generated_plan_session_id, plan_version_id, schema_version, catalog_version, structure
    ) values (
      (v_prescription->>'id')::uuid,
      (v_prescription->>'generatedPlanSessionId')::uuid,
      v_version_id,
      v_prescription->>'schemaVersion',
      v_prescription->>'catalogVersion',
      v_prescription->'structure'
    );
  end loop;

  return jsonb_build_object('plan_version_id', v_version_id, 'idempotent_replay', false);
end;
$$;

revoke all on function public.generate_training_plan_version(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public;
revoke all on function public.generate_training_plan_version(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from anon;
revoke all on function public.generate_training_plan_version(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from authenticated;
grant execute on function public.generate_training_plan_version(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
