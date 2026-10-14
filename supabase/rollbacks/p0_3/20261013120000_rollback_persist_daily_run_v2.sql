-- P0-3 rollback of 20261013120000_p0_3_manual_keep_persist_daily_run_v2.sql (NOT a migration;
-- copy into supabase/migrations/ under a new timestamp only if a rollback is decided).
-- Restores exactly the persist_daily_run_v2 body and grants of 20261001120000_ux11a5c2_v2_daily_persistence.sql.
-- Effect: a manual session kept by M1 is refused again at persistence: deploy it together with the daily-run
-- Edge of the previous release (no manual F1 branch), never alone.

create or replace function public.persist_daily_run_v2(
  p_athlete_id uuid,
  p_health_flag jsonb,
  p_decision_row jsonb,
  p_final_prescription_outcome jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_health_flag_id uuid := null;
  v_decision_id uuid;

  v_flag_type public.health_flag_type;
  v_flag_date date;
  v_description text;
  v_source_checkin_id uuid;

  v_row_athlete_id uuid;
  v_decision_date date;
  v_planned_session_before public.session_type;
  v_final_session public.session_type;
  v_reason text;
  v_do_not_do jsonb;
  v_override_reason text;
  v_engine_version text;
  v_daily_plan jsonb;
  v_active_mode public.training_mode;
  v_confidence_level public.confidence_level;
  v_arbitration text;

  v_decision_source_checkin_id uuid;
  v_decision_source_checkin_updated_at timestamptz;
  v_decision_source_planned_session_id uuid;
  v_decision_source_planned_session_updated_at timestamptz;

  v_status text;
  v_code text;
  v_detail jsonb;
  v_fp jsonb;
  v_fp_id uuid := null;
  v_fp_action public.final_prescription_reconciliation_action;
  v_fp_catalog text;
  v_fp_structure jsonb;
  v_fp_planned_id uuid;
  v_planned_schema text;
begin
  if p_athlete_id is null then
    raise exception 'persist_daily_run_v2: p_athlete_id is required';
  end if;
  if p_decision_row is null or jsonb_typeof(p_decision_row) <> 'object' then
    raise exception 'persist_daily_run_v2: p_decision_row is required';
  end if;

  -- -------------------------------------------------------------------------
  -- Final prescription outcome: structural contract, checked before any write.
  -- -------------------------------------------------------------------------
  if p_final_prescription_outcome is null or jsonb_typeof(p_final_prescription_outcome) <> 'object' then
    raise exception 'persist_daily_run_v2: p_final_prescription_outcome is required (the V2 path never writes a NULL status)';
  end if;
  v_status := p_final_prescription_outcome->>'status';
  if v_status is null or v_status not in ('created', 'not_required', 'blocked') then
    raise exception 'persist_daily_run_v2: unknown final prescription status %', coalesce(v_status, 'NULL');
  end if;
  v_fp := nullif(p_final_prescription_outcome->'final_prescription', 'null'::jsonb);
  v_code := p_final_prescription_outcome->>'code';
  v_detail := nullif(p_final_prescription_outcome->'detail', 'null'::jsonb);

  if not (p_decision_row ? 'id') or (p_decision_row->>'id') is null then
    raise exception 'persist_daily_run_v2: p_decision_row.id is required';
  end if;
  v_decision_id := (p_decision_row->>'id')::uuid;

  if not (p_decision_row ? 'daily_plan')
     or (p_decision_row->'daily_plan') is null
     or jsonb_typeof(p_decision_row->'daily_plan') <> 'object' then
    raise exception 'persist_daily_run_v2: p_decision_row.daily_plan must be a non-null JSON object';
  end if;
  v_arbitration := p_decision_row->'daily_plan'->>'decision';

  if v_status = 'created' then
    if v_fp is null or jsonb_typeof(v_fp) <> 'object' then
      raise exception 'persist_daily_run_v2: status created requires exactly one final prescription';
    end if;
    if v_code is not null or v_detail is not null then
      raise exception 'persist_daily_run_v2: status created carries no code or detail';
    end if;
  elsif v_status = 'not_required' then
    if v_fp is not null or v_code is not null or v_detail is not null then
      raise exception 'persist_daily_run_v2: status not_required carries no final prescription, code or detail';
    end if;
    if v_arbitration is distinct from 'REST' then
      raise exception 'persist_daily_run_v2: status not_required is only valid for a REST decision (got %)', coalesce(v_arbitration, 'NULL');
    end if;
  else -- blocked
    if v_fp is not null then
      raise exception 'persist_daily_run_v2: status blocked never carries a final prescription';
    end if;
    if v_code is null or length(trim(v_code)) = 0 then
      raise exception 'persist_daily_run_v2: status blocked requires a code';
    end if;
    if v_detail is not null and jsonb_typeof(v_detail) <> 'object' then
      raise exception 'persist_daily_run_v2: status detail must be a JSON object';
    end if;
  end if;

  if v_fp is not null then
    if (v_fp->>'id') is null then
      raise exception 'persist_daily_run_v2: final_prescription.id is required (minted by the caller, never by SQL)';
    end if;
    v_fp_id := (v_fp->>'id')::uuid;
    if (v_fp->>'decision_id') is null or (v_fp->>'decision_id')::uuid <> v_decision_id then
      raise exception 'persist_daily_run_v2: final_prescription.decision_id must be the decision persisted by this call';
    end if;
    if (v_fp ? 'athlete_id') and (v_fp->>'athlete_id') is not null and (v_fp->>'athlete_id')::uuid <> p_athlete_id then
      raise exception 'persist_daily_run_v2: final_prescription.athlete_id does not match p_athlete_id';
    end if;
    if (v_fp->>'schema_version') is distinct from 'v2' then
      raise exception 'persist_daily_run_v2: final_prescription.schema_version must be v2';
    end if;
    v_fp_catalog := v_fp->>'catalog_version';
    if v_fp_catalog is null or length(trim(v_fp_catalog)) = 0 then
      raise exception 'persist_daily_run_v2: final_prescription.catalog_version is required';
    end if;
    v_fp_structure := v_fp->'structure';
    if v_fp_structure is null or jsonb_typeof(v_fp_structure) <> 'object' then
      raise exception 'persist_daily_run_v2: final_prescription.structure must be a JSON object';
    end if;
    if (v_fp_structure->>'schemaVersion') is distinct from 'v2' then
      raise exception 'persist_daily_run_v2: final_prescription.structure.schemaVersion must be v2';
    end if;
    if (v_fp_structure->'catalog'->>'aggregate') is distinct from v_fp_catalog then
      raise exception 'persist_daily_run_v2: final_prescription.catalog_version must equal structure.catalog.aggregate';
    end if;
    v_fp_action := (v_fp->>'reconciliation_action')::public.final_prescription_reconciliation_action;
    -- The action mirrors M1's arbitration (REST never has a final prescription).
    if v_arbitration is distinct from upper(v_fp_action::text) then
      raise exception 'persist_daily_run_v2: reconciliation_action % does not match decision %', v_fp_action, coalesce(v_arbitration, 'NULL');
    end if;
    v_fp_planned_id := nullif(v_fp->>'planned_prescription_id', '')::uuid;
    if v_fp_action = 'keep' and v_fp_planned_id is null then
      raise exception 'persist_daily_run_v2: a keep final prescription requires planned_prescription_id';
    end if;
    if v_fp_planned_id is not null then
      select schema_version into v_planned_schema from public.training_plan_planned_prescriptions where id = v_fp_planned_id;
      if v_planned_schema is distinct from 'v2' then
        raise exception 'persist_daily_run_v2: planned prescription % is not a v2 prescription', v_fp_planned_id;
      end if;
    end if;
  end if;

  -- -------------------------------------------------------------------------
  -- Health flag (same behaviour as persist_daily_run).
  -- -------------------------------------------------------------------------
  if p_health_flag is not null then
    if not (p_health_flag ? 'flag_type') or (p_health_flag->>'flag_type') is null then
      raise exception 'persist_daily_run_v2: p_health_flag.flag_type is required';
    end if;
    v_flag_type := (p_health_flag->>'flag_type')::public.health_flag_type;

    if not (p_health_flag ? 'flag_date') or (p_health_flag->>'flag_date') is null then
      raise exception 'persist_daily_run_v2: p_health_flag.flag_date is required';
    end if;
    v_flag_date := (p_health_flag->>'flag_date')::date;

    if not (p_health_flag ? 'description') or (p_health_flag->>'description') is null then
      raise exception 'persist_daily_run_v2: p_health_flag.description is required';
    end if;
    v_description := p_health_flag->>'description';

    if (p_health_flag ? 'source_checkin_id') and (p_health_flag->>'source_checkin_id') is not null then
      v_source_checkin_id := (p_health_flag->>'source_checkin_id')::uuid;
    else
      v_source_checkin_id := null;
    end if;

    loop
      v_health_flag_id := null;

      insert into public.health_flags (athlete_id, flag_date, flag_type, description, source_checkin_id)
      values (p_athlete_id, v_flag_date, v_flag_type, v_description, v_source_checkin_id)
      on conflict (athlete_id, flag_type) where status in ('active', 'monitoring')
      do nothing
      returning id into v_health_flag_id;

      exit when v_health_flag_id is not null;

      select id
      into v_health_flag_id
      from public.health_flags
      where athlete_id = p_athlete_id
        and flag_type = v_flag_type
        and status in ('active', 'monitoring')
      limit 1
      for update;

      exit when v_health_flag_id is not null;
    end loop;
  end if;

  -- -------------------------------------------------------------------------
  -- Decision (same contract as persist_daily_run, plus id and status).
  -- -------------------------------------------------------------------------
  if (p_decision_row ? 'athlete_id') and (p_decision_row->>'athlete_id') is not null then
    v_row_athlete_id := (p_decision_row->>'athlete_id')::uuid;
    if v_row_athlete_id <> p_athlete_id then
      raise exception 'persist_daily_run_v2: p_decision_row.athlete_id (%) does not match p_athlete_id (%)',
        v_row_athlete_id, p_athlete_id;
    end if;
  end if;

  if not (p_decision_row ? 'decision_date') or (p_decision_row->>'decision_date') is null then
    raise exception 'persist_daily_run_v2: p_decision_row.decision_date is required';
  end if;
  v_decision_date := (p_decision_row->>'decision_date')::date;

  if (p_decision_row ? 'planned_session_before') and (p_decision_row->>'planned_session_before') is not null then
    v_planned_session_before := (p_decision_row->>'planned_session_before')::public.session_type;
  else
    v_planned_session_before := null;
  end if;

  if not (p_decision_row ? 'final_session') or (p_decision_row->>'final_session') is null then
    raise exception 'persist_daily_run_v2: p_decision_row.final_session is required';
  end if;
  v_final_session := (p_decision_row->>'final_session')::public.session_type;

  if not (p_decision_row ? 'reason') or (p_decision_row->>'reason') is null then
    raise exception 'persist_daily_run_v2: p_decision_row.reason is required';
  end if;
  v_reason := p_decision_row->>'reason';

  v_do_not_do := p_decision_row->'do_not_do';
  v_override_reason := p_decision_row->>'override_reason';

  if not (p_decision_row ? 'engine_version') or (p_decision_row->>'engine_version') is null then
    raise exception 'persist_daily_run_v2: p_decision_row.engine_version is required';
  end if;
  v_engine_version := p_decision_row->>'engine_version';
  v_daily_plan := p_decision_row->'daily_plan';

  if not (p_decision_row ? 'active_mode') or (p_decision_row->>'active_mode') is null then
    raise exception 'persist_daily_run_v2: p_decision_row.active_mode is required';
  end if;
  v_active_mode := (p_decision_row->>'active_mode')::public.training_mode;

  if not (p_decision_row ? 'confidence_level') or (p_decision_row->>'confidence_level') is null then
    raise exception 'persist_daily_run_v2: p_decision_row.confidence_level is required';
  end if;
  v_confidence_level := (p_decision_row->>'confidence_level')::public.confidence_level;

  v_decision_source_checkin_id := nullif(p_decision_row->>'source_checkin_id', '')::uuid;
  v_decision_source_checkin_updated_at := nullif(p_decision_row->>'source_checkin_updated_at', '')::timestamptz;
  v_decision_source_planned_session_id := nullif(p_decision_row->>'source_planned_session_id', '')::uuid;
  v_decision_source_planned_session_updated_at := nullif(p_decision_row->>'source_planned_session_updated_at', '')::timestamptz;

  if v_decision_source_checkin_id is not null and not exists (
    select 1 from public.daily_checkins
    where id = v_decision_source_checkin_id and athlete_id = p_athlete_id and checkin_date = v_decision_date
  ) then
    raise exception 'persist_daily_run_v2: p_decision_row.source_checkin_id (%) is not this athlete''s check-in for %',
      v_decision_source_checkin_id, v_decision_date;
  end if;
  if (v_decision_source_checkin_id is null) <> (v_decision_source_checkin_updated_at is null) then
    raise exception 'persist_daily_run_v2: source_checkin_id and source_checkin_updated_at must be provided together';
  end if;
  if (v_decision_source_planned_session_id is null) <> (v_decision_source_planned_session_updated_at is null) then
    raise exception 'persist_daily_run_v2: source_planned_session_id and source_planned_session_updated_at must be provided together';
  end if;

  insert into public.decisions (
    id, athlete_id, decision_date, planned_session_before, final_session, reason,
    do_not_do, override_reason, engine_version, stop_conditions,
    daily_plan, active_mode, confidence_level,
    source_checkin_id, source_checkin_updated_at, source_planned_session_id, source_planned_session_updated_at,
    final_prescription_status, final_prescription_status_code, final_prescription_status_detail
  )
  values (
    v_decision_id, p_athlete_id, v_decision_date, v_planned_session_before, v_final_session, v_reason,
    v_do_not_do, v_override_reason, v_engine_version, null,
    v_daily_plan, v_active_mode, v_confidence_level,
    v_decision_source_checkin_id, v_decision_source_checkin_updated_at,
    v_decision_source_planned_session_id, v_decision_source_planned_session_updated_at,
    v_status, case when v_status = 'blocked' then v_code end, case when v_status = 'blocked' then v_detail end
  );

  -- -------------------------------------------------------------------------
  -- Final prescription: stored verbatim (ids from the caller, no recomputation).
  -- -------------------------------------------------------------------------
  if v_fp is not null then
    insert into public.decision_final_prescriptions (
      id, decision_id, athlete_id, plan_version_id, planned_prescription_id,
      active_session_origin, reconciliation_action, adaptation_rule_ids,
      schema_version, catalog_version, structure
    )
    values (
      v_fp_id, v_decision_id, p_athlete_id, nullif(v_fp->>'plan_version_id', '')::uuid, v_fp_planned_id,
      (v_fp->>'active_session_origin')::public.final_prescription_active_session_origin, v_fp_action,
      coalesce(v_fp->'adaptation_rule_ids', '[]'::jsonb),
      'v2', v_fp_catalog, v_fp_structure
    );
  end if;

  return jsonb_build_object(
    'decision_id', v_decision_id,
    'health_flag_id', v_health_flag_id,
    'final_prescription_id', v_fp_id,
    'final_prescription_status', v_status
  );
end;
$function$;

revoke all on function public.persist_daily_run_v2(uuid, jsonb, jsonb, jsonb) from public;
revoke all on function public.persist_daily_run_v2(uuid, jsonb, jsonb, jsonb) from anon;
revoke all on function public.persist_daily_run_v2(uuid, jsonb, jsonb, jsonb) from authenticated;
grant execute on function public.persist_daily_run_v2(uuid, jsonb, jsonb, jsonb) to service_role;
