-- PILOT_022 — decision freshness provenance (REV-01) + superseded-projection reconciliation (REV-03).
-- Additive only: new nullable columns, a new security_invoker view, and two RPC bodies extended
-- with backward-compatible optional inputs. No existing column, row or grant is rewritten.

---------------------------------------------------------------------------
-- 1. decisions — the exact input versions a daily decision was computed from.
--
-- `source_checkin_id` already existed (baseline) but was never written by M2.
-- `updated_at` on daily_checkins/planned_sessions is maintained by the existing
-- set_updated_at() triggers, so (id, updated_at) is the row's persistent version:
-- a decision is current only while both inputs still carry the version it read.
-- No FK on source_planned_session_id on purpose: a projected session can be
-- removed by reconciliation, and that removal must make the decision stale,
-- never null out its provenance.
-- Rows written before PILOT_022 keep NULL here (no backfill, nothing invented);
-- daily_decision_currency evaluates them with a conservative timestamp fallback.
---------------------------------------------------------------------------
alter table public.decisions
  add column source_checkin_updated_at timestamptz null,
  add column source_planned_session_id uuid null,
  add column source_planned_session_updated_at timestamptz null;

comment on column public.decisions.source_checkin_updated_at is
  'PILOT_022 — daily_checkins.updated_at of source_checkin_id as read by daily-run. NULL on pre-PILOT_022 rows.';
comment on column public.decisions.source_planned_session_id is
  'PILOT_022 — planned_sessions.id read by daily-run for decision_date (NULL = no planned session). No FK by design.';
comment on column public.decisions.source_planned_session_updated_at is
  'PILOT_022 — planned_sessions.updated_at of source_planned_session_id as read by daily-run.';

---------------------------------------------------------------------------
-- 2. persist_daily_run — same contract (M2_006), plus four OPTIONAL provenance keys
-- in p_decision_row. A caller that omits them (older daily-run deployment) still
-- works and writes NULL, exactly as before.
---------------------------------------------------------------------------
create or replace function public.persist_daily_run(p_athlete_id uuid, p_health_flag jsonb, p_decision_row jsonb)
returns jsonb
language plpgsql
set search_path to 'public'
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

  v_decision_source_checkin_id uuid;
  v_decision_source_checkin_updated_at timestamptz;
  v_decision_source_planned_session_id uuid;
  v_decision_source_planned_session_updated_at timestamptz;
begin
  if p_health_flag is not null then
    if not (p_health_flag ? 'flag_type') or (p_health_flag->>'flag_type') is null then
      raise exception 'persist_daily_run: p_health_flag.flag_type is required';
    end if;
    v_flag_type := (p_health_flag->>'flag_type')::public.health_flag_type;

    if not (p_health_flag ? 'flag_date') or (p_health_flag->>'flag_date') is null then
      raise exception 'persist_daily_run: p_health_flag.flag_date is required';
    end if;
    v_flag_date := (p_health_flag->>'flag_date')::date;

    if not (p_health_flag ? 'description') or (p_health_flag->>'description') is null then
      raise exception 'persist_daily_run: p_health_flag.description is required';
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

  if p_decision_row is null then
    raise exception 'persist_daily_run: p_decision_row is required';
  end if;

  if (p_decision_row ? 'athlete_id') and (p_decision_row->>'athlete_id') is not null then
    v_row_athlete_id := (p_decision_row->>'athlete_id')::uuid;
    if v_row_athlete_id <> p_athlete_id then
      raise exception 'persist_daily_run: p_decision_row.athlete_id (%) does not match p_athlete_id (%)',
        v_row_athlete_id, p_athlete_id;
    end if;
  end if;

  if not (p_decision_row ? 'decision_date') or (p_decision_row->>'decision_date') is null then
    raise exception 'persist_daily_run: p_decision_row.decision_date is required';
  end if;
  v_decision_date := (p_decision_row->>'decision_date')::date;

  if (p_decision_row ? 'planned_session_before') and (p_decision_row->>'planned_session_before') is not null then
    v_planned_session_before := (p_decision_row->>'planned_session_before')::public.session_type;
  else
    v_planned_session_before := null;
  end if;

  if not (p_decision_row ? 'final_session') or (p_decision_row->>'final_session') is null then
    raise exception 'persist_daily_run: p_decision_row.final_session is required';
  end if;
  v_final_session := (p_decision_row->>'final_session')::public.session_type;

  if not (p_decision_row ? 'reason') or (p_decision_row->>'reason') is null then
    raise exception 'persist_daily_run: p_decision_row.reason is required';
  end if;
  v_reason := p_decision_row->>'reason';

  v_do_not_do := p_decision_row->'do_not_do';
  v_override_reason := p_decision_row->>'override_reason';

  if not (p_decision_row ? 'engine_version') or (p_decision_row->>'engine_version') is null then
    raise exception 'persist_daily_run: p_decision_row.engine_version is required';
  end if;
  v_engine_version := p_decision_row->>'engine_version';

  if not (p_decision_row ? 'daily_plan')
     or (p_decision_row->'daily_plan') is null
     or (p_decision_row->'daily_plan') = 'null'::jsonb
     or jsonb_typeof(p_decision_row->'daily_plan') <> 'object' then
    raise exception 'persist_daily_run: p_decision_row.daily_plan must be a non-null JSON object';
  end if;
  v_daily_plan := p_decision_row->'daily_plan';

  if not (p_decision_row ? 'active_mode') or (p_decision_row->>'active_mode') is null then
    raise exception 'persist_daily_run: p_decision_row.active_mode is required';
  end if;
  v_active_mode := (p_decision_row->>'active_mode')::public.training_mode;

  if not (p_decision_row ? 'confidence_level') or (p_decision_row->>'confidence_level') is null then
    raise exception 'persist_daily_run: p_decision_row.confidence_level is required';
  end if;
  v_confidence_level := (p_decision_row->>'confidence_level')::public.confidence_level;

  -- PILOT_022 — optional input provenance.
  v_decision_source_checkin_id := nullif(p_decision_row->>'source_checkin_id', '')::uuid;
  v_decision_source_checkin_updated_at := nullif(p_decision_row->>'source_checkin_updated_at', '')::timestamptz;
  v_decision_source_planned_session_id := nullif(p_decision_row->>'source_planned_session_id', '')::uuid;
  v_decision_source_planned_session_updated_at := nullif(p_decision_row->>'source_planned_session_updated_at', '')::timestamptz;

  if v_decision_source_checkin_id is not null and not exists (
    select 1 from public.daily_checkins
    where id = v_decision_source_checkin_id and athlete_id = p_athlete_id and checkin_date = v_decision_date
  ) then
    raise exception 'persist_daily_run: p_decision_row.source_checkin_id (%) is not this athlete''s check-in for %',
      v_decision_source_checkin_id, v_decision_date;
  end if;
  if (v_decision_source_checkin_id is null) <> (v_decision_source_checkin_updated_at is null) then
    raise exception 'persist_daily_run: source_checkin_id and source_checkin_updated_at must be provided together';
  end if;
  if (v_decision_source_planned_session_id is null) <> (v_decision_source_planned_session_updated_at is null) then
    raise exception 'persist_daily_run: source_planned_session_id and source_planned_session_updated_at must be provided together';
  end if;

  insert into public.decisions (
    athlete_id, decision_date, planned_session_before, final_session, reason,
    do_not_do, override_reason, engine_version, stop_conditions,
    daily_plan, active_mode, confidence_level,
    source_checkin_id, source_checkin_updated_at, source_planned_session_id, source_planned_session_updated_at
  )
  values (
    p_athlete_id, v_decision_date, v_planned_session_before, v_final_session, v_reason,
    v_do_not_do, v_override_reason, v_engine_version, null,
    v_daily_plan, v_active_mode, v_confidence_level,
    v_decision_source_checkin_id, v_decision_source_checkin_updated_at,
    v_decision_source_planned_session_id, v_decision_source_planned_session_updated_at
  )
  returning id into v_decision_id;

  return jsonb_build_object('decision_id', v_decision_id, 'health_flag_id', v_health_flag_id);
end;
$function$;

---------------------------------------------------------------------------
-- 3. daily_decision_currency — is a persisted decision still the current one for its
-- inputs? security_invoker: evaluated under the caller's own RLS on decisions,
-- daily_checkins and planned_sessions, so an athlete only ever sees their own rows.
--   * PILOT_022+ rows: current iff today's check-in AND planned session (or its
--     absence) still carry exactly the (id, updated_at) the decision was computed from.
--   * Pre-PILOT_022 rows (no recorded version): conservative fallback — stale as soon
--     as either input was written after the decision, or the planned session it
--     had is gone.
---------------------------------------------------------------------------
create view public.daily_decision_currency
with (security_invoker = true)
as
select
  s.decision_id,
  s.athlete_id,
  s.decision_date,
  (s.checkin_current and s.planned_session_current) as is_current,
  case
    when not s.checkin_current then 'checkin_changed'
    when not s.planned_session_current then 'planned_session_changed'
  end as stale_reason
from (
  select
    d.id as decision_id,
    d.athlete_id,
    d.decision_date,
    case
      when d.source_checkin_updated_at is not null then
        c.id is not null and c.id = d.source_checkin_id and c.updated_at = d.source_checkin_updated_at
      else
        c.id is not null and c.updated_at <= d.created_at
    end as checkin_current,
    case
      when d.source_checkin_updated_at is not null then
        p.id is not distinct from d.source_planned_session_id
        and p.updated_at is not distinct from d.source_planned_session_updated_at
      else
        (p.id is null and d.planned_session_before is null)
        or (p.id is not null and p.updated_at <= d.created_at)
    end as planned_session_current
  from public.decisions d
  left join public.daily_checkins c on c.athlete_id = d.athlete_id and c.checkin_date = d.decision_date
  left join public.planned_sessions p on p.athlete_id = d.athlete_id and p.planned_date = d.decision_date
) s;

comment on view public.daily_decision_currency is
  'PILOT_022 — whether a persisted daily decision still matches the check-in and planned session it was computed from. A stale decision stays in history but must never be rendered as the current, executable one.';

revoke all on public.daily_decision_currency from public, anon, authenticated, service_role;
grant select on public.daily_decision_currency to authenticated, service_role;

---------------------------------------------------------------------------
-- 4. project_training_plan — same contract (V0.4_003a), plus reconciliation of
-- superseded projections. Previously only the replacement plan's candidate dates were
-- upserted; generated rows of the superseded plan on dates the new plan does not use
-- stayed in planned_sessions forever (REV-03).
--
-- New optional p_window_start: when provided (and the version is current), every
-- `source = 'generated'` row on or after it whose source_plan_version_id is not the
-- current plan is removed, reported as 'removed_superseded'. Ownership is the existing
-- `source` column: manual rows are never touched; a date with a completed session keeps
-- its row ('skipped_completed'); completed_sessions themselves are never touched; dates
-- before p_window_start (history) are never touched. Runs in the same transaction as the
-- candidate upserts, so projection + reconciliation commit or roll back together.
-- p_window_start NULL (an older caller) keeps the exact previous behaviour.
---------------------------------------------------------------------------
drop function public.project_training_plan(uuid, uuid, jsonb, jsonb);

create function public.project_training_plan(
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

    select source, session_type, intervention, source_plan_version_id, source_generated_session_id
    into v_existing_source, v_existing_session_type, v_existing_intervention,
         v_existing_source_plan_version_id, v_existing_source_generated_session_id
    from public.planned_sessions
    where athlete_id = p_athlete_id and planned_date = v_date
    for update;
    v_row_found := found;

    select exists(
      select 1 from public.completed_sessions
      where athlete_id = p_athlete_id and session_date = v_date
    ) into v_completed_exists;

    if v_completed_exists then
      v_outcome := 'skipped_completed';
    elsif v_row_found and v_existing_source <> 'generated' then
      v_outcome := 'skipped_manual_override';
    elsif v_row_found
          and v_existing_session_type = v_session_type
          and v_existing_intervention = v_intervention
          and v_existing_source_plan_version_id = p_plan_version_id
          and v_existing_source_generated_session_id = v_source_generated_session_id then
      v_outcome := 'unchanged';
    else
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
      ) into v_completed_exists;

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
