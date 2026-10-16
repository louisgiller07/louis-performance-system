-- P0-3 (HPM 2026-10-13, GO L1) — server lock of planned_sessions on a day whose session is started or completed.
--
-- Contract: the planned session of a day with a V2 guided session RUNNING (started, neither completed nor
-- abandoned) or COMPLETED, or with a legacy completed_sessions row that is not `skipped`, is never inserted,
-- replaced, moved or deleted — the same "used day" rules as record_session_execution (UX-11R.9). Both OLD and NEW
-- (athlete, date) are checked. A day whose only executions are abandoned stays editable (restart allowed).
--
-- Serialization: every check runs under the per-athlete transaction advisory lock of record_session_execution
-- (`record_session_execution:<athlete_id>`), after the lock is granted, in READ COMMITTED (fresh snapshot per
-- statement). Either the session start commits first (the trigger then sees it and refuses), or the planned write
-- commits first (the start then sees the changed planned session through daily_decision_currency:
-- final_prescription_not_current). Lock order everywhere: advisory lock first, planned_sessions rows after —
--   * rider writes (PostgREST, RLS): statement-level trigger, before any row lock (UPDATE / DELETE lock their rows
--     before row triggers run);
--   * project_training_plan: takes it at the start of its writes (below);
--   * purge_athlete_account, record_session_execution, persist_completed_session: unchanged, already first.
-- Another isolation level is refused (a frozen snapshot could miss a session started meanwhile).
--
-- Account purge (UX-11R.1): inside purge_athlete_account()'s own transaction only (existing transaction-local
-- marker, set by that service_role-only procedure, unreachable through the API), its deletions and the
-- ON DELETE SET NULL actions of its plan deletions (lineage, training block) pass. Nothing else does.
--
-- project_training_plan (exact diff in the P0-3 report): a used day keeps its planned row like a legacy
-- completion (`skipped_completed`, closed vocabulary unchanged), in the projection and in the PILOT_022
-- reconciliation; every other day is projected as before. Signature, return, SECURITY DEFINER, search_path and
-- grants unchanged.
--
-- No table, column, constraint, index or data change. No change to record_session_execution,
-- persist_daily_run_v2, purge_athlete_account or the sport engines.
-- Rollback: supabase/rollbacks/p0_3/20261013140000_rollback_planned_session_day_lock.sql

-- ---------------------------------------------------------------------------
-- 1. Helper: a V2 guided session running or completed on the day (an abandoned-only day does not count).
-- ---------------------------------------------------------------------------
create function public.planned_session_day_has_execution(p_athlete_id uuid, p_date date)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.session_executions e
     where e.athlete_id = p_athlete_id
       and e.session_date = p_date
       and (
         exists (select 1 from public.execution_events ev where ev.execution_id = e.id and ev.event_type = 'completed')
         or not exists (select 1 from public.execution_events ev where ev.execution_id = e.id and ev.event_type in ('completed', 'abandoned'))
       )
  );
$$;

revoke all on function public.planned_session_day_has_execution(uuid, date) from public;
revoke all on function public.planned_session_day_has_execution(uuid, date) from anon;
revoke all on function public.planned_session_day_has_execution(uuid, date) from authenticated;
revoke all on function public.planned_session_day_has_execution(uuid, date) from service_role;

comment on function public.planned_session_day_has_execution(uuid, date) is
  'P0-3 — true when the athlete has a V2 guided session running or completed on the date (abandoned only: false). Called by owner-run functions only.';

-- ---------------------------------------------------------------------------
-- 2. Trigger function (statement and row level).
-- ---------------------------------------------------------------------------
create function public.enforce_planned_session_day_lock()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_athlete_id uuid;
  v_old_athlete_id uuid;
  v_old_date date;
  v_new_athlete_id uuid;
  v_new_date date;
begin
  -- Statement level: a rider's write (JWT subject; RLS limits it to the caller's own athlete) takes the lock
  -- BEFORE any planned_sessions row lock. Server writes (no subject) take it themselves first.
  if TG_LEVEL = 'STATEMENT' then
    for v_athlete_id in
      select a.id from public.athletes a where a.user_id = auth.uid() order by a.id
    loop
      perform pg_advisory_xact_lock(hashtextextended('record_session_execution:' || v_athlete_id::text, 0));
    end loop;
    return null;
  end if;

  -- Account purge (UX-11R.1), only inside purge_athlete_account()'s own transaction: its deletions, and the
  -- ON DELETE SET NULL actions of its plan deletions (lineage and training block set to NULL, nothing else).
  if current_setting('nalynt.athlete_purge_txid', true) = txid_current()::text then
    if TG_OP = 'DELETE' then
      return old;
    end if;
    if TG_OP = 'UPDATE'
       and (to_jsonb(new) - array['source_plan_version_id', 'source_generated_session_id', 'training_block_id', 'updated_at'])
         = (to_jsonb(old) - array['source_plan_version_id', 'source_generated_session_id', 'training_block_id', 'updated_at'])
       and (new.source_plan_version_id is null or new.source_plan_version_id is not distinct from old.source_plan_version_id)
       and (new.source_generated_session_id is null or new.source_generated_session_id is not distinct from old.source_generated_session_id)
       and (new.training_block_id is null or new.training_block_id is not distinct from old.training_block_id) then
      return new;
    end if;
  end if;

  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = 'NX202', message = 'planned_session_day_lock_requires_read_committed';
  end if;

  if TG_OP in ('UPDATE', 'DELETE') then
    v_old_athlete_id := old.athlete_id;
    v_old_date := old.planned_date;
  end if;
  if TG_OP in ('INSERT', 'UPDATE') then
    v_new_athlete_id := new.athlete_id;
    v_new_date := new.planned_date;
  end if;

  -- The lock of record_session_execution for every athlete concerned (OLD and NEW), in id order (re-entrant:
  -- usually already held from the statement level).
  for v_athlete_id in
    select distinct x.id from (values (v_old_athlete_id), (v_new_athlete_id)) as x(id) where x.id is not null order by x.id
  loop
    perform pg_advisory_xact_lock(hashtextextended('record_session_execution:' || v_athlete_id::text, 0));
  end loop;

  -- After the lock (READ COMMITTED: fresh snapshot per statement), a session started or completed by a
  -- transaction that held the lock is visible.
  if v_old_athlete_id is not null and (
       public.planned_session_day_has_execution(v_old_athlete_id, v_old_date)
       or exists (select 1 from public.completed_sessions cs
                   where cs.athlete_id = v_old_athlete_id and cs.session_date = v_old_date and cs.completion_status <> 'skipped')
     ) then
    raise exception using errcode = 'NX201', message = 'planned_session_day_locked', detail = v_old_date::text;
  end if;
  if v_new_athlete_id is not null and (
       public.planned_session_day_has_execution(v_new_athlete_id, v_new_date)
       or exists (select 1 from public.completed_sessions cs
                   where cs.athlete_id = v_new_athlete_id and cs.session_date = v_new_date and cs.completion_status <> 'skipped')
     ) then
    raise exception using errcode = 'NX201', message = 'planned_session_day_locked', detail = v_new_date::text;
  end if;

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_planned_session_day_lock() from public;
revoke all on function public.enforce_planned_session_day_lock() from anon;
revoke all on function public.enforce_planned_session_day_lock() from authenticated;
revoke all on function public.enforce_planned_session_day_lock() from service_role;

comment on function public.enforce_planned_session_day_lock() is
  'P0-3 — planned_sessions of a started or completed day are never inserted, replaced, moved or deleted (OLD and NEW), under the per-athlete lock of record_session_execution.';

create trigger trg_planned_sessions_day_lock_statement
  before insert or update or delete on public.planned_sessions
  for each statement execute function public.enforce_planned_session_day_lock();

create trigger trg_planned_sessions_day_lock
  before insert or update or delete on public.planned_sessions
  for each row execute function public.enforce_planned_session_day_lock();

-- ---------------------------------------------------------------------------
-- 3. project_training_plan — a used day keeps its planned row; the lock first.
-- ---------------------------------------------------------------------------
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
    ) or public.planned_session_day_has_execution(p_athlete_id, v_date)
    into v_completed_exists;

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
