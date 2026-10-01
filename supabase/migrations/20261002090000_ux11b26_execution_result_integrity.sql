-- UX-11B.2.6 — execution result integrity (local, not pushed).
--
-- Three invariants of the execution contract, revealed by UX-11C.2, closed
-- on the server (record_session_execution stays the only write path):
--
-- 1. Terminal = frozen results. An execution that already has a `completed`
--    or `abandoned` event BEFORE the batch takes no new exercise_set_results
--    nor session_activity_results row, corrections included
--    (`execution_terminal`). Results sent in the SAME batch as the terminal
--    event are accepted (the execution is not terminal at the start of the
--    batch). Lifecycle events keep their existing protection
--    (`invalid_transition`). An idempotent replay of an already recorded id is
--    still answered `unchanged` (nothing is written).
-- 2. Bounded ordinal. For a prescribed item, 1 <= set_number <= the
--    prescription's bound: measure.count for a drill pass (`pass`), `sets`
--    otherwise (`result_slot_out_of_range`; set_number < 1 stays the existing
--    structural `invalid_payload`). The column keeps its name: for a drill it
--    is the pass ordinal.
-- 3. One original per slot. At most one row with supersedes_id IS NULL per
--    (execution, prescription item, set_number): checked by the function
--    (`result_slot_exists`) and enforced by a partial unique index.
--    Corrections (supersedes_id NOT NULL) keep their rules (one per original,
--    never a correction of a correction). Activity results keep their own
--    one-original-per-execution rule (`activity_result_exists`).
--
-- Additive: no table or column change, no data change. The index creation
-- refuses clearly if duplicate originals already exist (nothing is deleted).
-- Rows recorded after a terminal event under the previous contract are left
-- as history.

do $$
begin
  if exists (
    select 1 from public.exercise_set_results
     where supersedes_id is null and prescription_item_id is not null
     group by execution_id, prescription_item_id, set_number
    having count(*) > 1
  ) then
    raise exception 'UX-11B.2.6: duplicate original set results exist for one (execution_id, prescription_item_id, set_number); resolve them manually before applying this migration (nothing is deleted automatically)';
  end if;
end;
$$;

create unique index idx_exercise_set_results_one_original_per_slot
  on public.exercise_set_results (execution_id, prescription_item_id, set_number)
  where supersedes_id is null and prescription_item_id is not null;

-- ---------------------------------------------------------------------------
-- record_session_execution — terminal freeze, bounded ordinal, one original per slot
-- ---------------------------------------------------------------------------
-- Replaces the UX-11B.2.5 version (migration 20261001140000, left unchanged).

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
      select fp.structure into v_act_structure
        from public.session_executions e
        join public.decision_final_prescriptions fp on fp.id = e.final_prescription_id
       where e.id = v_completed_exec;
      if found and jsonb_typeof(v_act_structure -> 'activitySelection') = 'object'
         and not exists (select 1 from public.session_activity_results where execution_id = v_completed_exec) then
        raise exception using errcode = 'NX001', message = 'activity_result_required', detail = v_target;
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
