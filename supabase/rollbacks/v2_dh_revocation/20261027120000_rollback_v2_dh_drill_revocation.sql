-- V2-DH-REVOCATION — ROLLBACK of 20261027120000_v2_dh_drill_revocation.sql (PR2-DH-REVOCATION-PREP, HPM 2026-10-27).
-- Never re-authorises a revoked execution or daily-run write: refused as soon as one revocation exists, hence for good
-- after the first (the table is append-only; only a forward fix remains, reserve R1). Restores
-- record_session_execution exactly as 20261018120000_power_guard_01 and persist_daily_run_v2 exactly as
-- 20261013180100_p0_3_manual_keep, drops the helper,
-- keeps the table (append-only history) and closes it to new revocations, owner included.
-- One explicit transaction (psql runs it as is; any error rolls everything back). Concurrency (RELEASE-PREP-FINAL-01):
-- - the table is locked (SHARE ROW EXCLUSIVE) BEFORE the guard reads it, until the commit: a revocation being written
--   is waited for, then seen by the guard (rollback refused); a revocation started after the lock waits for the end of
--   the rollback, and is then refused, never recorded without effect: the service_role loses INSERT, and a trigger
--   refuses every role (the owner keeps its privileges) while the guard is absent. Both are read by the waiting insert
--   only once its lock is granted, i.e. after this commit (privileges at executor start, triggers from the relation
--   cache reloaded on lock acquisition);
-- - the lock also waits for every execution batch or daily-run write in progress (they hold SHARE), and new ones wait
--   for the rollback: none runs while the functions are swapped.
begin;

lock table public.dh_drill_revocations in share row exclusive mode;

do $guard$
begin
  if exists (select 1 from public.dh_drill_revocations) then
    raise exception 'rollback refused: % DH drill revocation(s) recorded; a revocation is permanent: fix forward only',
      (select count(*) from public.dh_drill_revocations);
  end if;
end
$guard$;

create or replace function public.record_session_execution(p_athlete_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max_items constant integer := 200;
  v_target text := 'payload';
  v_events jsonb;
  v_sets jsonb;
  v_exec jsonb;
  v_item jsonb;
  v_idx integer;

  -- execution
  v_exec_id uuid;
  v_exec_date date;
  v_exec_started_at timestamptz;
  v_exec_fp_id uuid;
  v_exec_comment text;
  v_exec_decision_id uuid;
  v_fp_schema text;
  v_fp_decision_date date;
  v_fp_decision_status text;
  v_existing_exec public.session_executions%rowtype;

  -- events
  v_ev_id uuid;
  v_ev_exec_id uuid;
  v_ev_type public.execution_event_type;
  v_ev_at timestamptz;
  v_existing_ev public.execution_events%rowtype;
  v_last_type public.execution_event_type;

  -- sets
  v_set_id uuid;
  v_set_exec_id uuid;
  v_set_item_id uuid;
  v_set_other text;
  v_set_number integer;
  v_set_done boolean;
  v_set_measure public.set_measure_type;
  v_set_value integer;
  v_set_load numeric(6, 2);
  v_set_rpe numeric(3, 1);
  v_set_success boolean;
  v_set_comment text;
  v_set_supersedes uuid;
  v_set_at timestamptz;
  v_set_exercise_id text;
  v_existing_set public.exercise_set_results%rowtype;
  v_target_set public.exercise_set_results%rowtype;
  v_exec_row public.session_executions%rowtype;
  v_structure jsonb;
  v_prescribed_item jsonb;
  v_prescribed_measure text;
  v_slot_max integer;

  -- activities (UX-11B.2.5)
  v_activities jsonb;
  v_act_id uuid;
  v_act_exec_id uuid;
  v_act_activity text;
  v_act_duration integer;
  v_act_distance integer;
  v_act_rpe numeric(3, 1);
  v_act_comment text;
  v_act_supersedes uuid;
  v_act_at timestamptz;
  v_existing_act public.session_activity_results%rowtype;
  v_target_act public.session_activity_results%rowtype;
  v_act_structure jsonb;
  v_act_schema text;
  v_completed_execs jsonb := '[]'::jsonb;
  v_completed_exec uuid;
  v_inserted_acts jsonb := '[]'::jsonb;
  v_unchanged_acts jsonb := '[]'::jsonb;

  v_inserted_exec jsonb := '[]'::jsonb;
  v_unchanged_exec jsonb := '[]'::jsonb;
  v_inserted_events jsonb := '[]'::jsonb;
  v_unchanged_events jsonb := '[]'::jsonb;
  v_inserted_sets jsonb := '[]'::jsonb;
  v_unchanged_sets jsonb := '[]'::jsonb;

  v_code text;
  v_detail text;

  -- P0-3 — health suspension (execution_health_block)
  v_health text;
  v_health_date date;
  v_health_family text;
begin
  if p_athlete_id is null then
    raise exception 'record_session_execution: p_athlete_id is required';
  end if;
  if not exists (select 1 from public.athletes where id = p_athlete_id) then
    raise exception 'record_session_execution: unknown athlete %', p_athlete_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('record_session_execution:' || p_athlete_id::text, 0));

  begin
    if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
      raise exception using errcode = 'NX001', message = 'invalid_payload', detail = v_target;
    end if;

    -- A JSON null is treated exactly like an absent key (the Edge Function
    -- sends "execution": null when the batch opens no new execution).
    v_exec := nullif(p_payload -> 'execution', 'null'::jsonb);
    v_events := coalesce(nullif(p_payload -> 'events', 'null'::jsonb), '[]'::jsonb);
    v_sets := coalesce(nullif(p_payload -> 'sets', 'null'::jsonb), '[]'::jsonb);
    v_activities := coalesce(nullif(p_payload -> 'activities', 'null'::jsonb), '[]'::jsonb);
    if (v_exec is not null and jsonb_typeof(v_exec) <> 'object')
       or jsonb_typeof(v_events) <> 'array' or jsonb_typeof(v_sets) <> 'array' or jsonb_typeof(v_activities) <> 'array'
       or jsonb_array_length(v_events) > c_max_items or jsonb_array_length(v_sets) > c_max_items or jsonb_array_length(v_activities) > c_max_items
       or (v_exec is null and jsonb_array_length(v_events) = 0 and jsonb_array_length(v_sets) = 0 and jsonb_array_length(v_activities) = 0) then
      raise exception using errcode = 'NX001', message = 'invalid_payload', detail = v_target;
    end if;

    -- -----------------------------------------------------------------
    -- Execution
    -- -----------------------------------------------------------------
    if v_exec is not null then
      v_target := 'execution';
      if v_exec ->> 'id' is null or v_exec ->> 'session_date' is null or v_exec ->> 'started_at' is null then
        raise exception using errcode = 'NX001', message = 'invalid_payload', detail = v_target;
      end if;
      v_exec_id := (v_exec ->> 'id')::uuid;
      v_exec_date := (v_exec ->> 'session_date')::date;
      v_exec_started_at := (v_exec ->> 'started_at')::timestamptz;
      v_exec_fp_id := (v_exec ->> 'final_prescription_id')::uuid;
      v_exec_comment := v_exec ->> 'comment';

      select * into v_existing_exec from public.session_executions where id = v_exec_id;
      if found then
        if v_existing_exec.athlete_id = p_athlete_id
           and v_existing_exec.session_date = v_exec_date
           and v_existing_exec.started_at = v_exec_started_at
           and v_existing_exec.final_prescription_id is not distinct from v_exec_fp_id
           and v_existing_exec.comment is not distinct from v_exec_comment then
          v_unchanged_exec := v_unchanged_exec || to_jsonb(v_exec_id);
        else
          raise exception using errcode = 'NX001', message = 'id_conflict', detail = v_target;
        end if;
      else
        v_exec_decision_id := null;
        if v_exec_fp_id is not null then
          select fp.decision_id, fp.schema_version, d.decision_date, d.final_prescription_status
            into v_exec_decision_id, v_fp_schema, v_fp_decision_date, v_fp_decision_status
            from public.decision_final_prescriptions fp
            join public.decisions d on d.id = fp.decision_id
           where fp.id = v_exec_fp_id and fp.athlete_id = p_athlete_id;
          if not found then
            raise exception using errcode = 'NX001', message = 'prescription_not_found', detail = v_target;
          end if;
          if v_fp_schema <> 'v2' then
            raise exception using errcode = 'NX001', message = 'not_executable', detail = v_target;
          end if;
          if v_fp_decision_date <> v_exec_date then
            raise exception using errcode = 'NX001', message = 'date_mismatch', detail = v_target;
          end if;
          -- UX-11A.5c.2 — a final prescription is executable only when its decision
          -- created it through the V2 contract (status 'created'; REST and blocked
          -- decisions have none) ...
          if v_fp_decision_status is distinct from 'created' then
            raise exception using errcode = 'NX001', message = 'not_executable', detail = v_target;
          end if;
          -- ... and that decision is the athlete's CURRENT decision for the day:
          -- the most recent one (decisions are append-only; a new daily run
          -- supersedes the previous decision) AND still current for its inputs
          -- (daily_decision_currency, PILOT_022). Both are needed: two runs on the
          -- same inputs are both "current" in the view, only the latest is the
          -- day's decision.
          if v_exec_decision_id is distinct from (
               select d.id from public.decisions d
                where d.athlete_id = p_athlete_id and d.decision_date = v_exec_date
                order by d.created_at desc, d.id desc
                limit 1
             )
             or not exists (
               select 1 from public.daily_decision_currency c
                where c.decision_id = v_exec_decision_id and c.is_current
             ) then
            raise exception using errcode = 'NX001', message = 'final_prescription_not_current', detail = v_target;
          end if;
        end if;

        -- UX-11R.9 (F-6B, F-5b) — one main session per athlete and day: a day
        -- already completed (a V2 execution with a `completed` event, or a
        -- legacy completed_sessions row that is not `skipped`) takes no new
        -- normal execution. A restart after `abandoned` (no completion) stays
        -- allowed; an idempotent replay of an existing execution never reaches
        -- this branch. Serialized with persist_completed_session by the same
        -- per-athlete advisory lock (taken above).
        if exists (
          select 1 from public.session_executions e
           where e.athlete_id = p_athlete_id
             and e.session_date = v_exec_date
             and exists (
               select 1 from public.execution_events ev
                where ev.execution_id = e.id and ev.event_type = 'completed'
             )
        ) or exists (
          select 1 from public.completed_sessions cs
           where cs.athlete_id = p_athlete_id
             and cs.session_date = v_exec_date
             and cs.completion_status <> 'skipped'
        ) then
          raise exception using errcode = 'NX001', message = 'session_already_completed', detail = v_target;
        end if;

        if exists (
          select 1 from public.session_executions e
           where e.athlete_id = p_athlete_id
             and e.session_date = v_exec_date
             and not exists (
               select 1 from public.execution_events ev
                where ev.execution_id = e.id and ev.event_type in ('completed', 'abandoned')
             )
        ) then
          raise exception using errcode = 'NX001', message = 'active_execution_exists', detail = v_target;
        end if;

        if not exists (
          select 1 from jsonb_array_elements(v_events) ev
           where lower(ev ->> 'execution_id') = v_exec_id::text and ev ->> 'event_type' = 'started'
        ) then
          raise exception using errcode = 'NX001', message = 'missing_start_event', detail = v_target;
        end if;

        -- P0-3 (HPM 2026-10-13) — no new session while the athlete's health suspends training, nor on a day
        -- whose decision no longer matches its inputs (health status unknown until the daily run is re-run).
        v_health := public.execution_health_block(
          p_athlete_id, v_exec_date,
          (select fp.structure ->> 'family' from public.decision_final_prescriptions fp where fp.id = v_exec_fp_id)
        );
        if v_health is not null then
          raise exception using errcode = 'NX001', message = v_health, detail = v_target;
        end if;

        insert into public.session_executions (id, athlete_id, session_date, decision_id, final_prescription_id, started_at, comment)
        values (v_exec_id, p_athlete_id, v_exec_date, v_exec_decision_id, v_exec_fp_id, v_exec_started_at, v_exec_comment);
        v_inserted_exec := v_inserted_exec || to_jsonb(v_exec_id);
      end if;
    end if;

    -- -----------------------------------------------------------------
    -- Events (lifecycle, evaluated in server insertion order)
    -- -----------------------------------------------------------------
    for v_item, v_idx in select value, ordinality - 1 from jsonb_array_elements(v_events) with ordinality loop
      v_target := 'events[' || v_idx || ']';
      if jsonb_typeof(v_item) <> 'object' or v_item ->> 'id' is null or v_item ->> 'execution_id' is null
         or v_item ->> 'event_type' is null or v_item ->> 'occurred_at' is null then
        raise exception using errcode = 'NX001', message = 'invalid_payload', detail = v_target;
      end if;
      v_ev_id := (v_item ->> 'id')::uuid;
      v_ev_exec_id := (v_item ->> 'execution_id')::uuid;
      v_ev_type := (v_item ->> 'event_type')::public.execution_event_type;
      v_ev_at := (v_item ->> 'occurred_at')::timestamptz;

      select * into v_existing_ev from public.execution_events where id = v_ev_id;
      if found then
        if v_existing_ev.athlete_id = p_athlete_id
           and v_existing_ev.execution_id = v_ev_exec_id
           and v_existing_ev.event_type = v_ev_type
           and v_existing_ev.occurred_at = v_ev_at then
          v_unchanged_events := v_unchanged_events || to_jsonb(v_ev_id);
          continue;
        end if;
        raise exception using errcode = 'NX001', message = 'id_conflict', detail = v_target;
      end if;

      if not exists (select 1 from public.session_executions where id = v_ev_exec_id and athlete_id = p_athlete_id) then
        raise exception using errcode = 'NX001', message = 'execution_not_found', detail = v_target;
      end if;

      select event_type into v_last_type
        from public.execution_events
       where execution_id = v_ev_exec_id
       order by event_seq desc
       limit 1;
      if not found then
        v_last_type := null;
      end if;

      if not (
        (v_last_type is null and v_ev_type = 'started')
        or (v_last_type in ('started', 'resumed') and v_ev_type in ('paused', 'completed', 'abandoned'))
        or (v_last_type = 'paused' and v_ev_type in ('resumed', 'completed', 'abandoned'))
      ) then
        raise exception using errcode = 'NX001', message = 'invalid_transition', detail = v_target;
      end if;

      -- P0-3 (HPM 2026-10-13) — under a health suspension (or a stale day decision) no effort resumes and the
      -- session is not closed as completed: `resumed` and `completed` are refused; `paused` and `abandoned`
      -- (safe closure, results kept) stay allowed. An identical replay never reaches this point.
      if v_ev_type in ('resumed', 'completed') then
        select e.session_date, fp.structure ->> 'family'
          into v_health_date, v_health_family
          from public.session_executions e
          left join public.decision_final_prescriptions fp on fp.id = e.final_prescription_id
         where e.id = v_ev_exec_id;
        v_health := public.execution_health_block(p_athlete_id, v_health_date, v_health_family);
        if v_health is not null then
          raise exception using errcode = 'NX001', message = v_health, detail = v_target;
        end if;
      end if;

      insert into public.execution_events (id, execution_id, athlete_id, event_type, occurred_at)
      values (v_ev_id, v_ev_exec_id, p_athlete_id, v_ev_type, v_ev_at);
      v_inserted_events := v_inserted_events || to_jsonb(v_ev_id);
      -- UX-11B.2.5 — completion invariant checked at the end of the batch.
      if v_ev_type = 'completed' then
        v_completed_execs := v_completed_execs || to_jsonb(v_ev_exec_id);
      end if;
    end loop;

    -- -----------------------------------------------------------------
    -- Sets (recordable at any point of the lifecycle)
    -- -----------------------------------------------------------------
    for v_item, v_idx in select value, ordinality - 1 from jsonb_array_elements(v_sets) with ordinality loop
      v_target := 'sets[' || v_idx || ']';
      if jsonb_typeof(v_item) <> 'object' or v_item ->> 'id' is null or v_item ->> 'execution_id' is null
         or v_item ->> 'set_number' is null or v_item ->> 'done' is null or v_item ->> 'measure_type' is null
         or v_item ->> 'occurred_at' is null then
        raise exception using errcode = 'NX001', message = 'invalid_payload', detail = v_target;
      end if;
      v_set_id := (v_item ->> 'id')::uuid;
      v_set_exec_id := (v_item ->> 'execution_id')::uuid;
      v_set_item_id := (v_item ->> 'prescription_item_id')::uuid;
      v_set_other := v_item ->> 'other_exercise_name';
      v_set_number := (v_item ->> 'set_number')::integer;
      v_set_done := (v_item ->> 'done')::boolean;
      v_set_measure := (v_item ->> 'measure_type')::public.set_measure_type;
      v_set_value := (v_item ->> 'measure_value')::integer;
      v_set_load := (v_item ->> 'load_kg')::numeric(6, 2);
      v_set_rpe := (v_item ->> 'rpe_actual')::numeric(3, 1);
      v_set_success := (v_item ->> 'success')::boolean;
      v_set_comment := v_item ->> 'comment';
      v_set_supersedes := (v_item ->> 'supersedes_id')::uuid;
      v_set_at := (v_item ->> 'occurred_at')::timestamptz;

      select * into v_existing_set from public.exercise_set_results where id = v_set_id;
      if found then
        if v_existing_set.athlete_id = p_athlete_id
           and v_existing_set.execution_id = v_set_exec_id
           and v_existing_set.prescription_item_id is not distinct from v_set_item_id
           and v_existing_set.other_exercise_name is not distinct from v_set_other
           and v_existing_set.set_number = v_set_number
           and v_existing_set.done = v_set_done
           and v_existing_set.measure_type = v_set_measure
           and v_existing_set.measure_value is not distinct from v_set_value
           and v_existing_set.load_kg is not distinct from v_set_load
           and v_existing_set.rpe_actual is not distinct from v_set_rpe
           and v_existing_set.success is not distinct from v_set_success
           and v_existing_set.comment is not distinct from v_set_comment
           and v_existing_set.supersedes_id is not distinct from v_set_supersedes
           and v_existing_set.occurred_at = v_set_at then
          v_unchanged_sets := v_unchanged_sets || to_jsonb(v_set_id);
          continue;
        end if;
        raise exception using errcode = 'NX001', message = 'id_conflict', detail = v_target;
      end if;

      select * into v_exec_row from public.session_executions where id = v_set_exec_id and athlete_id = p_athlete_id;
      if not found then
        raise exception using errcode = 'NX001', message = 'execution_not_found', detail = v_target;
      end if;
      -- UX-11B.2.6 — the results of an execution that was ALREADY terminal before
      -- this batch are frozen (no new result, no correction). A terminal event
      -- inserted by this very batch does not count: the last result and
      -- `completed` can travel together in one transaction.
      if exists (
        select 1 from public.execution_events ev
         where ev.execution_id = v_set_exec_id and ev.event_type in ('completed', 'abandoned')
           and not (v_inserted_events ? ev.id::text)
      ) then
        raise exception using errcode = 'NX001', message = 'execution_terminal', detail = v_target;
      end if;
      -- P0-3 — no new result (set, pass or correction) under a health suspension or a stale day decision.
      v_health := public.execution_health_block(
        p_athlete_id, v_exec_row.session_date,
        (select fp.structure ->> 'family' from public.decision_final_prescriptions fp where fp.id = v_exec_row.final_prescription_id)
      );
      if v_health is not null then
        raise exception using errcode = 'NX001', message = v_health, detail = v_target;
      end if;

      v_set_exercise_id := null;
      if v_set_item_id is not null then
        if v_exec_row.final_prescription_id is null then
          raise exception using errcode = 'NX001', message = 'invalid_item', detail = v_target;
        end if;
        select structure into v_structure from public.decision_final_prescriptions where id = v_exec_row.final_prescription_id;
        v_prescribed_item := null;
        select it into v_prescribed_item
          from jsonb_array_elements(coalesce(v_structure -> 'blocks', '[]'::jsonb)) b,
               jsonb_array_elements(coalesce(b -> 'items', '[]'::jsonb)) it
         where lower(it ->> 'prescriptionItemId') = v_set_item_id::text
         limit 1;
        if v_prescribed_item is null then
          raise exception using errcode = 'NX001', message = 'invalid_item', detail = v_target;
        end if;
        v_set_exercise_id := v_prescribed_item ->> 'exerciseId';
        -- UX-11B.2.3 — fail-closed: the prescribed measure type must be one of
        -- the set measure vocabulary, spelled exactly the same ('pass', never
        -- 'passes'). A missing or unknown type rejects the set; it never
        -- disables the measure check.
        v_prescribed_measure := v_prescribed_item -> 'measure' ->> 'type';
        if v_prescribed_measure is null or v_prescribed_measure not in ('reps', 'duration', 'distance', 'pass') then
          raise exception using errcode = 'NX001', message = 'invalid_prescribed_measure', detail = v_target;
        end if;
        if v_prescribed_measure <> v_set_measure::text then
          raise exception using errcode = 'NX001', message = 'measure_mismatch', detail = v_target;
        end if;
        -- UX-11B.2.6 — the result ordinal is bounded by the prescription: a drill
        -- pass ordinal by measure.count, any other item's set by `sets`.
        v_slot_max := case
          when v_prescribed_measure = 'pass' then (v_prescribed_item -> 'measure' ->> 'count')::integer
          else (v_prescribed_item ->> 'sets')::integer
        end;
        if v_slot_max is null or v_slot_max < 1 then
          raise exception using errcode = 'NX001', message = 'invalid_prescribed_measure', detail = v_target;
        end if;
        if v_set_number > v_slot_max then
          raise exception using errcode = 'NX001', message = 'result_slot_out_of_range', detail = v_target;
        end if;
        v_prescribed_item := null;
      end if;

      if v_set_supersedes is not null then
        select * into v_target_set from public.exercise_set_results where id = v_set_supersedes and athlete_id = p_athlete_id;
        if not found
           or v_target_set.execution_id <> v_set_exec_id
           or v_target_set.supersedes_id is not null
           or v_target_set.prescription_item_id is distinct from v_set_item_id
           or v_target_set.other_exercise_name is distinct from v_set_other
           or v_target_set.set_number <> v_set_number
           or exists (select 1 from public.exercise_set_results where supersedes_id = v_set_supersedes) then
          raise exception using errcode = 'NX001', message = 'invalid_correction', detail = v_target;
        end if;
      elsif v_set_item_id is not null and exists (
        select 1 from public.exercise_set_results
         where execution_id = v_set_exec_id and prescription_item_id = v_set_item_id
           and set_number = v_set_number and supersedes_id is null
      ) then
        -- UX-11B.2.6 — one original per (execution, prescription item, ordinal):
        -- another id on a recorded slot is refused (send a correction instead).
        raise exception using errcode = 'NX001', message = 'result_slot_exists', detail = v_target;
      end if;

      insert into public.exercise_set_results (
        id, execution_id, athlete_id, prescription_item_id, exercise_id, other_exercise_name,
        set_number, done, measure_type, measure_value, load_kg, rpe_actual, success, comment,
        supersedes_id, occurred_at
      ) values (
        v_set_id, v_set_exec_id, p_athlete_id, v_set_item_id, v_set_exercise_id, v_set_other,
        v_set_number, v_set_done, v_set_measure, v_set_value, v_set_load, v_set_rpe, v_set_success, v_set_comment,
        v_set_supersedes, v_set_at
      );
      v_inserted_sets := v_inserted_sets || to_jsonb(v_set_id);
    end loop;

    -- -----------------------------------------------------------------
    -- Activities (UX-11B.2.5): the endurance activity actually performed.
    -- Recordable at any point of the lifecycle, like sets. Lineage only
    -- through THIS execution's final prescription and its activitySelection
    -- (no prescription item, no exercise): never re-checked against the
    -- day's current decision (an execution already started is never
    -- interrupted, UX-11A.5c.2).
    -- -----------------------------------------------------------------
    for v_item, v_idx in select value, ordinality - 1 from jsonb_array_elements(v_activities) with ordinality loop
      v_target := 'activities[' || v_idx || ']';
      if jsonb_typeof(v_item) <> 'object' or v_item ->> 'id' is null or v_item ->> 'execution_id' is null
         or v_item ->> 'activity_id' is null or v_item ->> 'duration_seconds' is null or v_item ->> 'occurred_at' is null then
        raise exception using errcode = 'NX001', message = 'invalid_payload', detail = v_target;
      end if;
      v_act_id := (v_item ->> 'id')::uuid;
      v_act_exec_id := (v_item ->> 'execution_id')::uuid;
      v_act_activity := v_item ->> 'activity_id';
      v_act_duration := (v_item ->> 'duration_seconds')::integer;
      v_act_distance := (v_item ->> 'distance_m')::integer;
      v_act_rpe := (v_item ->> 'rpe_actual')::numeric(3, 1);
      v_act_comment := v_item ->> 'comment';
      v_act_supersedes := (v_item ->> 'supersedes_id')::uuid;
      v_act_at := (v_item ->> 'occurred_at')::timestamptz;

      select * into v_existing_act from public.session_activity_results where id = v_act_id;
      if found then
        if v_existing_act.athlete_id = p_athlete_id
           and v_existing_act.execution_id = v_act_exec_id
           and v_existing_act.activity_id = v_act_activity
           and v_existing_act.duration_seconds = v_act_duration
           and v_existing_act.distance_m is not distinct from v_act_distance
           and v_existing_act.rpe_actual is not distinct from v_act_rpe
           and v_existing_act.comment is not distinct from v_act_comment
           and v_existing_act.supersedes_id is not distinct from v_act_supersedes
           and v_existing_act.occurred_at = v_act_at then
          v_unchanged_acts := v_unchanged_acts || to_jsonb(v_act_id);
          continue;
        end if;
        raise exception using errcode = 'NX001', message = 'id_conflict', detail = v_target;
      end if;

      select * into v_exec_row from public.session_executions where id = v_act_exec_id and athlete_id = p_athlete_id;
      if not found then
        raise exception using errcode = 'NX001', message = 'execution_not_found', detail = v_target;
      end if;
      -- UX-11B.2.6 — the results of an execution that was ALREADY terminal before
      -- this batch are frozen (no new result, no correction). A terminal event
      -- inserted by this very batch does not count: the last result and
      -- `completed` can travel together in one transaction.
      if exists (
        select 1 from public.execution_events ev
         where ev.execution_id = v_act_exec_id and ev.event_type in ('completed', 'abandoned')
           and not (v_inserted_events ? ev.id::text)
      ) then
        raise exception using errcode = 'NX001', message = 'execution_terminal', detail = v_target;
      end if;
      -- P0-3 — no new activity result (or correction) under a health suspension or a stale day decision.
      v_health := public.execution_health_block(
        p_athlete_id, v_exec_row.session_date,
        (select fp.structure ->> 'family' from public.decision_final_prescriptions fp where fp.id = v_exec_row.final_prescription_id)
      );
      if v_health is not null then
        raise exception using errcode = 'NX001', message = v_health, detail = v_target;
      end if;

      -- The execution's own final prescription must offer an activity choice
      -- that contains exactly this activity (v2, restricted list).
      v_act_structure := null;
      v_act_schema := null;
      if v_exec_row.final_prescription_id is not null then
        select structure, schema_version into v_act_structure, v_act_schema
          from public.decision_final_prescriptions where id = v_exec_row.final_prescription_id;
      end if;
      if v_act_schema is distinct from 'v2'
         or jsonb_typeof(v_act_structure -> 'activitySelection') is distinct from 'object'
         or (v_act_structure -> 'activitySelection' ->> 'mode') is distinct from 'restricted'
         or jsonb_typeof(v_act_structure -> 'activitySelection' -> 'activityIds') is distinct from 'array'
         or not ((v_act_structure -> 'activitySelection' -> 'activityIds') ? v_act_activity) then
        raise exception using errcode = 'NX001', message = 'activity_not_allowed_by_prescription', detail = v_target;
      end if;

      if v_act_supersedes is not null then
        -- Same correction rule as sets: one correction of an original, same execution, never a correction of a correction.
        select * into v_target_act from public.session_activity_results where id = v_act_supersedes and athlete_id = p_athlete_id;
        if not found
           or v_target_act.execution_id <> v_act_exec_id
           or v_target_act.supersedes_id is not null
           or exists (select 1 from public.session_activity_results where supersedes_id = v_act_supersedes) then
          raise exception using errcode = 'NX001', message = 'invalid_correction', detail = v_target;
        end if;
      elsif exists (select 1 from public.session_activity_results where execution_id = v_act_exec_id and supersedes_id is null) then
        -- One activity actually performed per session: a second original is refused (correct it instead).
        raise exception using errcode = 'NX001', message = 'activity_result_exists', detail = v_target;
      end if;

      insert into public.session_activity_results (
        id, execution_id, athlete_id, activity_id, duration_seconds, distance_m, rpe_actual, comment, supersedes_id, occurred_at
      ) values (
        v_act_id, v_act_exec_id, p_athlete_id, v_act_activity, v_act_duration, v_act_distance, v_act_rpe, v_act_comment, v_act_supersedes, v_act_at
      );
      v_inserted_acts := v_inserted_acts || to_jsonb(v_act_id);
    end loop;

    -- -----------------------------------------------------------------
    -- Completion invariant (UX-11B.2.5): an execution whose final
    -- prescription offers an activity choice is completed only with its
    -- activity result, recorded before or in the same batch. Same
    -- transaction: a refusal rolls the whole batch back.
    -- -----------------------------------------------------------------
    for v_completed_exec in select (value #>> '{}')::uuid from jsonb_array_elements(v_completed_execs) loop
      v_target := 'execution';
      -- UX-11R.9 (F-6B, F-5b) — the same one-main-session rule at completion:
      -- a legacy completed_sessions row (not `skipped`) recorded for this
      -- day while the execution was open wins; the execution cannot become a
      -- second terminal "done" for the day (it can still be abandoned).
      if exists (
        select 1 from public.session_executions e
          join public.completed_sessions cs on cs.athlete_id = e.athlete_id and cs.session_date = e.session_date
         where e.id = v_completed_exec and cs.completion_status <> 'skipped'
      ) then
        raise exception using errcode = 'NX001', message = 'session_already_completed', detail = v_target;
      end if;
      select fp.structure into v_act_structure
        from public.session_executions e
        join public.decision_final_prescriptions fp on fp.id = e.final_prescription_id
       where e.id = v_completed_exec;
      if found and jsonb_typeof(v_act_structure -> 'activitySelection') = 'object'
         and not exists (select 1 from public.session_activity_results where execution_id = v_completed_exec) then
        raise exception using errcode = 'NX001', message = 'activity_result_required', detail = v_target;
      end if;
      -- UX-11R.9 (F-6A) — a DH technical execution is completed only with at
      -- least one ACTIVE pass result (a row no correction supersedes) that was
      -- done, recorded before or in the same batch.
      if found and v_act_structure ->> 'family' = 'dh_technical'
         and not exists (
           select 1 from public.exercise_set_results r
            where r.execution_id = v_completed_exec
              and r.measure_type = 'pass'
              and r.done
              and not exists (select 1 from public.exercise_set_results c where c.supersedes_id = r.id)
         ) then
        raise exception using errcode = 'NX001', message = 'dh_pass_required', detail = v_target;
      end if;
      -- F-6C — a Force execution is completed only with at least one ACTIVE
      -- (no correction supersedes it), PERFORMED (`done`) set result on an
      -- exercise its own final prescription plans in a work block (`main` /
      -- `complementary`), recorded before or in the same batch. Same rule as
      -- the guided Force screen (UX-11C.2): a partial session stays a legitimate
      -- completion; zero work done does not. A Force prescription that plans
      -- no work set at all requires nothing (defensive, never produced by V2).
      -- POWER-GUARD-01 (HPM 2026-10-18) — the same rule for a power session (PHYS-03, family `power`: its explosive
      -- exercises are `main` work blocks). Zero work done does not complete it; a partial power session stays a
      -- legitimate completion. Same refusal and message (the power session is guided by the Force screen).
      if found and v_act_structure ->> 'family' in ('strength', 'power')
         and exists (
           select 1
             from jsonb_array_elements(coalesce(v_act_structure -> 'blocks', '[]'::jsonb)) b,
                  jsonb_array_elements(coalesce(b -> 'items', '[]'::jsonb)) it
            where b ->> 'role' in ('main', 'complementary') and it ->> 'kind' = 'exercise'
         )
         and not exists (
           select 1 from public.exercise_set_results r
            where r.execution_id = v_completed_exec
              and r.done
              and r.prescription_item_id is not null
              and not exists (select 1 from public.exercise_set_results c where c.supersedes_id = r.id)
              and exists (
                select 1
                  from jsonb_array_elements(coalesce(v_act_structure -> 'blocks', '[]'::jsonb)) b,
                       jsonb_array_elements(coalesce(b -> 'items', '[]'::jsonb)) it
                 where b ->> 'role' in ('main', 'complementary') and it ->> 'kind' = 'exercise'
                   and lower(it ->> 'prescriptionItemId') = r.prescription_item_id::text
              )
         ) then
        raise exception using errcode = 'NX001', message = 'strength_set_required', detail = v_target;
      end if;
    end loop;

  exception
    when sqlstate 'NX001' then
      get stacked diagnostics v_code = message_text, v_detail = pg_exception_detail;
      return jsonb_build_object('status', 'rejected', 'code', v_code, 'target', v_detail);
    -- Malformed values (bad uuid / date / enum / number) or a table
    -- constraint (bounds, lengths, shapes): the batch is invalid. Never
    -- surfaces PostgreSQL's own message to the caller.
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
         or numeric_value_out_of_range or check_violation or not_null_violation then
      return jsonb_build_object('status', 'rejected', 'code', 'invalid_payload', 'target', v_target);
  end;

  return jsonb_build_object(
    'status', 'ok',
    'inserted', jsonb_build_object('executions', v_inserted_exec, 'events', v_inserted_events, 'sets', v_inserted_sets, 'activities', v_inserted_acts),
    'unchanged', jsonb_build_object('executions', v_unchanged_exec, 'events', v_unchanged_events, 'sets', v_unchanged_sets, 'activities', v_unchanged_acts)
  );
end;
$$;

revoke all on function public.record_session_execution(uuid, jsonb) from public;
revoke all on function public.record_session_execution(uuid, jsonb) from anon;
revoke all on function public.record_session_execution(uuid, jsonb) from authenticated;
grant execute on function public.record_session_execution(uuid, jsonb) to service_role;

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

  -- P0-3 — manual sessions (origin manual_override_new_kind)
  v_fp_origin public.final_prescription_active_session_origin;
  v_fp_plan_version_id uuid;
  v_manual_athlete_id uuid;
  v_manual_date date;
  v_manual_source text;
  v_manual_updated_at timestamptz;
  v_version_schema text;
  v_version_start date;
  v_version_end date;
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
    v_fp_origin := (v_fp->>'active_session_origin')::public.final_prescription_active_session_origin;
    -- P0-3 — a KEEP of the rider's MANUAL session has no planned prescription (built from the current V2 plan's
    -- snapshot): the only exception, verified server-side below before any decision write. Every other keep
    -- (generated, manual_override_same_kind) still requires one.
    if v_fp_action = 'keep' and v_fp_planned_id is null and v_fp_origin is distinct from 'manual_override_new_kind' then
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

  -- -------------------------------------------------------------------------
  -- P0-3 — a manual-session final prescription (origin manual_override_new_kind, any action) is never accepted
  -- on the caller's word: the decision must have been computed on THIS athlete's manual session for the
  -- decision date, at its current version; the plan version must be the athlete's current V2 version covering
  -- the date; no planned prescription; a KEEP carries no adaptation rule (the table already requires it).
  -- The action-vs-decision rule above stays: a KEEP prescription only for a KEEP decision.
  -- -------------------------------------------------------------------------
  if v_fp is not null and v_fp_origin = 'manual_override_new_kind' then
    if v_fp_planned_id is not null then
      raise exception 'persist_daily_run_v2: a manual-session final prescription never references a planned prescription';
    end if;
    if v_fp_action = 'keep' and jsonb_array_length(coalesce(v_fp->'adaptation_rule_ids', '[]'::jsonb)) <> 0 then
      raise exception 'persist_daily_run_v2: a keep final prescription carries no adaptation rule';
    end if;
    if v_decision_source_planned_session_id is null then
      raise exception 'persist_daily_run_v2: a manual-session final prescription requires the decision''s source planned session';
    end if;
    select ps.athlete_id, ps.planned_date, ps.source::text, ps.updated_at
      into v_manual_athlete_id, v_manual_date, v_manual_source, v_manual_updated_at
      from public.planned_sessions ps
     where ps.id = v_decision_source_planned_session_id
       for share;
    if not found
       or v_manual_athlete_id <> p_athlete_id
       or v_manual_date <> v_decision_date
       or v_manual_source is distinct from 'manual'
       or v_manual_updated_at is distinct from v_decision_source_planned_session_updated_at then
      raise exception 'persist_daily_run_v2: the decision''s planned session is not this athlete''s current manual session for %', v_decision_date;
    end if;
    v_fp_plan_version_id := nullif(v_fp->>'plan_version_id', '')::uuid;
    if v_fp_plan_version_id is null or not exists (
      select 1 from public.training_plan_current_version cv
       where cv.athlete_id = p_athlete_id and cv.plan_version_id = v_fp_plan_version_id
    ) then
      raise exception 'persist_daily_run_v2: a manual-session final prescription requires the athlete''s current plan version';
    end if;
    select v.prescription_schema_version, v.horizon_start_date, v.horizon_end_date
      into v_version_schema, v_version_start, v_version_end
      from public.training_plan_versions v
     where v.id = v_fp_plan_version_id and v.athlete_id = p_athlete_id;
    if not found or v_version_schema is distinct from 'v2' or v_decision_date < v_version_start or v_decision_date > v_version_end then
      raise exception 'persist_daily_run_v2: the current plan version is not a V2 version covering %', v_decision_date;
    end if;
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

drop function public.execution_dh_revocation_block(uuid);

-- Closed to new revocations: once the checks are gone, a revocation would have no effect. The service_role loses INSERT;
-- the trigger refuses every role, the owner included, while the guard helper is absent (re-applying migration 20261027120000
-- re-creates the helper and re-grants INSERT: the trigger then lets revocations through).
revoke insert on table public.dh_drill_revocations from service_role;
create or replace function public.reject_dh_revocation_without_guard() returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if to_regprocedure('public.execution_dh_revocation_block(uuid)') is null then
    raise exception 'dh_drill_revocations: the revocation guard is rolled back; re-apply migration 20261027120000 before revoking a drill';
  end if;
  return new;
end
$fn$;
create or replace trigger trg_dh_drill_revocations_guard_absent before insert on public.dh_drill_revocations
  for each row execute function public.reject_dh_revocation_without_guard();
comment on table public.dh_drill_revocations is
  'V2-DH-REVOCATION — ROLLED BACK: history only, read by nothing, closed to new revocations (re-apply migration 20261027120000 to revoke again).';

commit;
