-- CONSISTENCY-01 (HPM 2026-10-16, O-43 / O-46) — Today's mission follows the ACTIVE programme.
--
-- Cause (P0-SAFETY-INV-01, reproduced on C and D′): project_training_plan never touches a planned_sessions row whose
-- source is not 'generated' ("manual priority"), whatever its age. A manual row written under an earlier programme or
-- planning therefore survives every new programme: daily-run (buildRawContext → getPlannedSessionFor), Today's
-- "Prochaine étape" and /plan read it as the day's session, while /training-plan shows the programme (a rest day, or
-- the programme's session with a "Modifiée par toi" badge).
--
-- Rule: a manual row is part of the active programme when it was written after the programme became current
-- (training_plan_current_version.updated_at): the rider's own modification, untouched (V06-02, UX-10B-2B, P0-3). An
-- older manual row, dated from p_window_start inside the programme's horizon, is superseded by the programme, like a
-- superseded plan's generated row (PILOT_022 REV-03): replaced by the programme's session on a candidate date
-- (outcome 'projected'), removed on any other date (outcome 'removed_superseded'). Existing outcome vocabulary only.
--
-- Unchanged: a used day keeps its row ('skipped_completed', P0-3 lock); dates before p_window_start (history) and
-- outside the horizon; calls without p_window_start; decisions, executions, completed_sessions, training_blocks,
-- signature, SECURITY DEFINER, search_path, grants. Function only, no table change.
-- Rollback (replay as a NEW migration only on HPM decision):
--   supabase/rollbacks/consistency01/20261016120000_rollback_superseded_manual_projection.sql

create or replace function public.project_training_plan(
  p_athlete_id uuid,
  p_plan_version_id uuid,
  p_planned_session_candidates jsonb,
  p_training_block_candidate jsonb,
  p_window_start date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actual_current_version_id uuid;
  v_stale boolean;

  v_candidate jsonb;
  v_date date;
  v_session_type public.session_type;
  v_intervention jsonb;
  v_source_generated_session_id uuid;

  v_existing_source public.session_source;
  v_existing_session_type public.session_type;
  v_existing_intervention jsonb;
  v_existing_source_plan_version_id uuid;
  v_existing_source_generated_session_id uuid;
  v_row_found boolean;
  v_completed_exists boolean;
  v_outcome text;
  v_planned_sessions_report jsonb := '[]'::jsonb;

  -- CONSISTENCY-01
  v_existing_updated_at timestamptz;
  v_programme_since timestamptz;
  v_horizon_start date;
  v_horizon_end date;
  v_superseded_manual boolean;

  v_block_name text;
  v_block_mode public.training_mode;
  v_block_primary_focus text;
  v_block_start_date date;
  v_block_end_date date;
  v_block_source_plan_block_id uuid;
  v_existing_block_id uuid;
  v_existing_block_name text;
  v_existing_block_mode public.training_mode;
  v_existing_block_primary_focus text;
  v_existing_block_start_date date;
  v_existing_block_end_date date;
  v_existing_block_source_plan_block_id uuid;
  v_block_row_found boolean;
  v_block_outcome text;
begin
  if p_athlete_id is null then
    raise exception 'project_training_plan: p_athlete_id is required';
  end if;
  if p_plan_version_id is null then
    raise exception 'project_training_plan: p_plan_version_id is required';
  end if;
  if p_planned_session_candidates is null or jsonb_typeof(p_planned_session_candidates) <> 'array' then
    raise exception 'project_training_plan: p_planned_session_candidates must be a JSON array (may be empty)';
  end if;

  -- 0. Staleness / cross-athlete guard.
  select plan_version_id into v_actual_current_version_id
  from public.training_plan_current_version
  where athlete_id = p_athlete_id;

  v_stale := (v_actual_current_version_id is null or v_actual_current_version_id <> p_plan_version_id);

  if v_stale then
    for v_candidate in
      select value from jsonb_array_elements(p_planned_session_candidates) as t(value)
    loop
      if not (v_candidate ? 'date') or (v_candidate->>'date') is null then
        raise exception 'project_training_plan: candidate.date is required';
      end if;
      v_planned_sessions_report := v_planned_sessions_report
        || jsonb_build_object('date', v_candidate->>'date', 'outcome', 'skipped_stale_version');
    end loop;

    return jsonb_build_object(
      'plannedSessions', v_planned_sessions_report,
      'trainingBlock', jsonb_build_object(
        'outcome', case when p_training_block_candidate is null then 'no_candidate' else 'skipped_stale_version' end
      )
    );
  end if;

  -- P0-3 — the per-athlete lock of record_session_execution, taken before any planned_sessions row lock (same
  -- order as the execution RPC, the account purge and the planned_sessions trigger): no guided session starts or
  -- completes between the checks below and the writes.
  perform pg_advisory_xact_lock(hashtextextended('record_session_execution:' || p_athlete_id::text, 0));

  -- CONSISTENCY-01 (HPM 2026-10-16, O-43 / O-46) — since when this programme is the athlete's current one, and its
  -- horizon. A manual row written BEFORE that moment, dated from p_window_start inside the horizon, was left by an
  -- earlier programme or an earlier planning: this programme supersedes it (steps 1 and 1c), exactly as step 1b does
  -- for a superseded plan's generated rows. A manual row written AFTER it is the rider's own modification of this
  -- programme (V06-02, UX-10B-2B, P0-3) and is never touched. A used day keeps its row in every case.
  select updated_at into v_programme_since
  from public.training_plan_current_version
  where athlete_id = p_athlete_id;

  select horizon_start_date, horizon_end_date into v_horizon_start, v_horizon_end
  from public.training_plan_versions
  where id = p_plan_version_id;

  -- 1. planned_sessions — one candidate at a time, ascending date order.
  for v_candidate in
    select value from jsonb_array_elements(p_planned_session_candidates) as t(value) order by value->>'date' asc
  loop
    if not (v_candidate ? 'date') or (v_candidate->>'date') is null then
      raise exception 'project_training_plan: candidate.date is required';
    end if;
    v_date := (v_candidate->>'date')::date;

    if not (v_candidate ? 'sessionType') or (v_candidate->>'sessionType') is null then
      raise exception 'project_training_plan: candidate.sessionType is required (date %)', v_date;
    end if;
    v_session_type := (v_candidate->>'sessionType')::public.session_type;

    if not (v_candidate ? 'intervention')
       or (v_candidate->'intervention') is null
       or jsonb_typeof(v_candidate->'intervention') <> 'object' then
      raise exception 'project_training_plan: candidate.intervention must be a non-null JSON object (date %)', v_date;
    end if;
    v_intervention := v_candidate->'intervention';

    if not (v_candidate ? 'sourceGeneratedSessionId') or (v_candidate->>'sourceGeneratedSessionId') is null then
      raise exception 'project_training_plan: candidate.sourceGeneratedSessionId is required (date %)', v_date;
    end if;
    v_source_generated_session_id := (v_candidate->>'sourceGeneratedSessionId')::uuid;

    select source, session_type, intervention, source_plan_version_id, source_generated_session_id, updated_at
    into v_existing_source, v_existing_session_type, v_existing_intervention,
         v_existing_source_plan_version_id, v_existing_source_generated_session_id, v_existing_updated_at
    from public.planned_sessions
    where athlete_id = p_athlete_id and planned_date = v_date
    for update;
    v_row_found := found;

    select exists(
      select 1 from public.completed_sessions
      where athlete_id = p_athlete_id and session_date = v_date
    ) or public.planned_session_day_has_execution(p_athlete_id, v_date)
    into v_completed_exists;

    v_superseded_manual := coalesce(
      v_row_found
      and v_existing_source <> 'generated'
      and p_window_start is not null
      and v_date >= p_window_start
      and v_date between v_horizon_start and v_horizon_end
      and v_existing_updated_at < v_programme_since,
      false);

    if v_completed_exists then
      v_outcome := 'skipped_completed';
    elsif v_row_found and v_existing_source <> 'generated' and not v_superseded_manual then
      v_outcome := 'skipped_manual_override';
    elsif v_row_found
          and v_existing_source = 'generated'
          and v_existing_session_type = v_session_type
          and v_existing_intervention = v_intervention
          and v_existing_source_plan_version_id = p_plan_version_id
          and v_existing_source_generated_session_id = v_source_generated_session_id then
      v_outcome := 'unchanged';
    else
      -- CONSISTENCY-01 — a superseded manual row gives way to the programme's session: removed, then the session is
      -- projected as on an empty day (no manual-only field — commitment, intent, note — is carried over).
      if v_superseded_manual then
        delete from public.planned_sessions
        where athlete_id = p_athlete_id and planned_date = v_date and source <> 'generated';
      end if;
      insert into public.planned_sessions (
        athlete_id, planned_date, session_type, intervention, source,
        source_plan_version_id, source_generated_session_id
      ) values (
        p_athlete_id, v_date, v_session_type, v_intervention, 'generated',
        p_plan_version_id, v_source_generated_session_id
      )
      on conflict (athlete_id, planned_date) do update set
        session_type = excluded.session_type,
        intervention = excluded.intervention,
        source = 'generated',
        source_plan_version_id = excluded.source_plan_version_id,
        source_generated_session_id = excluded.source_generated_session_id
      where planned_sessions.source = 'generated';
      v_outcome := 'projected';
    end if;

    v_planned_sessions_report := v_planned_sessions_report || jsonb_build_object('date', v_date, 'outcome', v_outcome);
  end loop;

  -- 1b. PILOT_022 — reconcile generated projections owned by a superseded plan.
  if p_window_start is not null then
    for v_date in
      select ps.planned_date
      from public.planned_sessions ps
      where ps.athlete_id = p_athlete_id
        and ps.source = 'generated'
        and ps.planned_date >= p_window_start
        and ps.source_plan_version_id is distinct from p_plan_version_id
      order by ps.planned_date asc
      for update
    loop
      select exists(
        select 1 from public.completed_sessions
        where athlete_id = p_athlete_id and session_date = v_date
      ) or public.planned_session_day_has_execution(p_athlete_id, v_date)
      into v_completed_exists;

      if v_completed_exists then
        v_outcome := 'skipped_completed';
      else
        delete from public.planned_sessions
        where athlete_id = p_athlete_id
          and planned_date = v_date
          and source = 'generated'
          and source_plan_version_id is distinct from p_plan_version_id;
        v_outcome := 'removed_superseded';
      end if;

      v_planned_sessions_report := v_planned_sessions_report || jsonb_build_object('date', v_date, 'outcome', v_outcome);
    end loop;
  end if;

  -- 1c. CONSISTENCY-01 — superseded manual rows on the programme's other dates (a programme rest day, or a day not
  -- projected yet): removed, like 1b removes a superseded plan's generated rows (same vocabulary). The candidates'
  -- dates were settled in step 1. A used day keeps its row.
  if p_window_start is not null then
    for v_date in
      select ps.planned_date
      from public.planned_sessions ps
      where ps.athlete_id = p_athlete_id
        and ps.source <> 'generated'
        and ps.planned_date >= p_window_start
        and ps.planned_date between v_horizon_start and v_horizon_end
        and ps.updated_at < v_programme_since
        and not exists (
          select 1 from jsonb_array_elements(p_planned_session_candidates) as c(value)
          where (c.value->>'date')::date = ps.planned_date
        )
      order by ps.planned_date asc
      for update
    loop
      select exists(
        select 1 from public.completed_sessions
        where athlete_id = p_athlete_id and session_date = v_date
      ) or public.planned_session_day_has_execution(p_athlete_id, v_date)
      into v_completed_exists;

      if v_completed_exists then
        v_outcome := 'skipped_completed';
      else
        delete from public.planned_sessions
        where athlete_id = p_athlete_id
          and planned_date = v_date
          and source <> 'generated';
        v_outcome := 'removed_superseded';
      end if;

      v_planned_sessions_report := v_planned_sessions_report || jsonb_build_object('date', v_date, 'outcome', v_outcome);
    end loop;
  end if;

  -- 2. training_blocks — the single is_current=true row.
  if p_training_block_candidate is null then
    v_block_outcome := 'no_candidate';
  else
    if not (p_training_block_candidate ? 'name') or (p_training_block_candidate->>'name') is null then
      raise exception 'project_training_plan: trainingBlockCandidate.name is required';
    end if;
    v_block_name := p_training_block_candidate->>'name';

    if not (p_training_block_candidate ? 'mode') or (p_training_block_candidate->>'mode') is null then
      raise exception 'project_training_plan: trainingBlockCandidate.mode is required';
    end if;
    v_block_mode := (p_training_block_candidate->>'mode')::public.training_mode;

    if not (p_training_block_candidate ? 'primaryFocus') or (p_training_block_candidate->>'primaryFocus') is null then
      raise exception 'project_training_plan: trainingBlockCandidate.primaryFocus is required';
    end if;
    v_block_primary_focus := p_training_block_candidate->>'primaryFocus';

    if not (p_training_block_candidate ? 'startDate') or (p_training_block_candidate->>'startDate') is null then
      raise exception 'project_training_plan: trainingBlockCandidate.startDate is required';
    end if;
    v_block_start_date := (p_training_block_candidate->>'startDate')::date;

    if not (p_training_block_candidate ? 'endDate') or (p_training_block_candidate->>'endDate') is null then
      raise exception 'project_training_plan: trainingBlockCandidate.endDate is required';
    end if;
    v_block_end_date := (p_training_block_candidate->>'endDate')::date;

    if not (p_training_block_candidate ? 'sourcePlanBlockId') or (p_training_block_candidate->>'sourcePlanBlockId') is null then
      raise exception 'project_training_plan: trainingBlockCandidate.sourcePlanBlockId is required';
    end if;
    v_block_source_plan_block_id := (p_training_block_candidate->>'sourcePlanBlockId')::uuid;

    select id, name, mode, primary_focus, start_date, end_date, source_plan_block_id
    into v_existing_block_id, v_existing_block_name, v_existing_block_mode, v_existing_block_primary_focus,
         v_existing_block_start_date, v_existing_block_end_date, v_existing_block_source_plan_block_id
    from public.training_blocks
    where athlete_id = p_athlete_id and is_current = true
    for update;
    v_block_row_found := found;

    if v_block_row_found and v_existing_block_source_plan_block_id is null then
      v_block_outcome := 'skipped_not_owned';
    elsif v_block_row_found
          and v_existing_block_name = v_block_name
          and v_existing_block_mode = v_block_mode
          and v_existing_block_primary_focus = v_block_primary_focus
          and v_existing_block_start_date = v_block_start_date
          and v_existing_block_end_date = v_block_end_date
          and v_existing_block_source_plan_block_id = v_block_source_plan_block_id then
      v_block_outcome := 'unchanged';
    elsif v_block_row_found then
      update public.training_blocks
      set name = v_block_name,
          mode = v_block_mode,
          primary_focus = v_block_primary_focus,
          start_date = v_block_start_date,
          end_date = v_block_end_date,
          source_plan_block_id = v_block_source_plan_block_id
      where id = v_existing_block_id;
      v_block_outcome := 'updated';
    else
      insert into public.training_blocks (
        athlete_id, name, mode, primary_focus, start_date, end_date, is_current, source_plan_block_id
      ) values (
        p_athlete_id, v_block_name, v_block_mode, v_block_primary_focus, v_block_start_date, v_block_end_date,
        true, v_block_source_plan_block_id
      );
      v_block_outcome := 'updated';
    end if;
  end if;

  return jsonb_build_object(
    'plannedSessions', v_planned_sessions_report,
    'trainingBlock', jsonb_build_object('outcome', v_block_outcome)
  );
end;
$function$;

revoke all on function public.project_training_plan(uuid, uuid, jsonb, jsonb, date) from public;
revoke all on function public.project_training_plan(uuid, uuid, jsonb, jsonb, date) from anon;
revoke all on function public.project_training_plan(uuid, uuid, jsonb, jsonb, date) from authenticated;
grant execute on function public.project_training_plan(uuid, uuid, jsonb, jsonb, date) to service_role;
