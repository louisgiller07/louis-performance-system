-- V0.4_003A — project_training_plan: the M2.7 / ADR V0.4_012 projection
-- runtime RPC. Makes planned_sessions/training_blocks converge toward the
-- athlete's currently accepted canonical training plan for a caller-given
-- batch of already-computed candidates, without ever overwriting a
-- completed or manually-overridden date. Pure transactional
-- guard-and-write — no coaching logic, no session_type derivation (that is
-- planning-engine/head-coach-engine TypeScript's job, already done before
-- this RPC is ever called — see projectTrainingPlan.ts /
-- generatedSessionToPlannedSessionCandidate.ts).
--
-- ===========================================================================
-- SECURITY DEFINER — same reasoning as generate_training_plan_version /
-- accept_training_plan_version (see their own migrations' module docs, not
-- repeated here). service_role holds SELECT only on planned_sessions /
-- training_blocks (20260921094500_v0_4_002d_...) — this RPC is the only
-- write path, exactly as intended.
-- ===========================================================================
--
-- ===========================================================================
-- Staleness / cross-athlete guard
-- ===========================================================================
-- p_plan_version_id is whatever the TypeScript caller resolved as "current"
-- before building candidates. This RPC never trusts that value blindly: it
-- re-reads training_plan_current_version for p_athlete_id and compares.
-- Mismatch (including "no current version at all", or a version id that
-- belongs to a different athlete entirely — which can never equal this
-- athlete's own current version) -> every candidate is reported
-- 'skipped_stale_version', nothing is written. This closes the race window
-- between "TypeScript resolved the current version" and "this call actually
-- executes" (a concurrent acceptance/regeneration in between), and doubles
-- as a structural backstop against a caller bug supplying the wrong
-- athlete's version — without needing a composite-FK-style mechanism at the
-- RPC-parameter level (the composite FKs on planned_sessions/
-- training_plan_versions already protect the table itself; this protects
-- the RPC's own decision-making from acting on stale input).
--
-- ===========================================================================
-- Per-row guard classification (planned_sessions)
-- ===========================================================================
-- For each candidate date, in this order:
--   1. completed_sessions has a row for (athlete_id, date) -> skipped_completed.
--      Checked via the date join, never completed_sessions.planned_session_id
--      (confirmed dead — never populated by persist_completed_session).
--      Applies unconditionally, even when no planned_sessions row exists yet.
--   2. an existing planned_sessions row's source <> 'generated' -> skipped_manual_override.
--   3. an existing row whose stored values already match the candidate exactly
--      -> unchanged. No write is issued at all in this case (not merely a
--      no-op UPDATE) — updated_at is therefore guaranteed untouched on an
--      identical replay (M2.7 idempotence requirement).
--   4. otherwise -> insert or update, reported 'projected'.
-- SELECT ... FOR UPDATE locks an existing row before this classification,
-- closing the check-then-act race a bare guarded UPSERT can't close on its
-- own (a concurrent manual save between the read and the write). The
-- ON CONFLICT ... WHERE clause below is kept anyway as defense-in-depth,
-- same multi-layer-defense discipline as the append-only triggers
-- (grants + trigger) elsewhere in this schema.
--
-- Candidates are processed in ascending date order — not merely because the
-- caller happens to submit them that way, but enforced here via
-- `order by value->>'date' asc` — so two concurrent calls for the same
-- athlete always acquire per-date locks in the same relative order and can
-- never deadlock against each other (standard fixed-order lock-acquisition
-- discipline).
--
-- ===========================================================================
-- training_blocks — the single is_current=true row
-- ===========================================================================
-- source_plan_block_id IS NULL on the existing current row means
-- legacy/admin/manual ownership (M2.5/M2.6) -> skipped_not_owned, never
-- touched. Otherwise: identical values -> unchanged (no write); otherwise
-- update in place, or insert if no current row exists at all -> updated.

create or replace function public.project_training_plan(
  p_athlete_id uuid,
  p_plan_version_id uuid,
  p_planned_session_candidates jsonb,
  p_training_block_candidate jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  -----------------------------------------------------------------------
  -- 0. Staleness / cross-athlete guard — see module doc above.
  -----------------------------------------------------------------------
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

  -----------------------------------------------------------------------
  -- 1. planned_sessions — one candidate at a time, ascending date order.
  -----------------------------------------------------------------------
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

  -----------------------------------------------------------------------
  -- 2. training_blocks — the single is_current=true row.
  -----------------------------------------------------------------------
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
$$;

revoke all on function public.project_training_plan(uuid, uuid, jsonb, jsonb) from public;
revoke all on function public.project_training_plan(uuid, uuid, jsonb, jsonb) from anon;
revoke all on function public.project_training_plan(uuid, uuid, jsonb, jsonb) from authenticated;
grant execute on function public.project_training_plan(uuid, uuid, jsonb, jsonb) to service_role;
