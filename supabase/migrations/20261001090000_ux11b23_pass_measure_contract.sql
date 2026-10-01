-- UX-11B.2.3 — single 'pass' measure vocabulary, fail-closed measure check.
--
-- See docs/11_DECISION_LOG.md (ADR UX-11B.2.3). Replaces
-- record_session_execution (UX-11B.2.2, migration 20260930120500, left
-- unchanged) with exactly one behavioral change:
-- - the prescribed item's `measure.type` must be exactly one of the set
--   measure vocabulary: 'reps', 'duration', 'distance', 'pass'. The former
--   prescription spelling 'passes' (mapped to 'pass') is no longer accepted;
-- - a missing or unknown prescribed measure type now rejects the set with
--   the stable code `invalid_prescribed_measure` (previously it silently
--   skipped the measure check);
-- - everything else (signature, SECURITY DEFINER, search_path, grants,
--   stable codes, idempotence, lifecycle, corrections) is unchanged.
--
-- No v2 prescription exists yet in any environment (local lineage only, not
-- applied in production), so no stored 'passes' structure needs preserving.
-- CREATE OR REPLACE keeps the existing grants; they are restated below for
-- clarity.

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
    if (v_exec is not null and jsonb_typeof(v_exec) <> 'object')
       or jsonb_typeof(v_events) <> 'array' or jsonb_typeof(v_sets) <> 'array'
       or jsonb_array_length(v_events) > c_max_items or jsonb_array_length(v_sets) > c_max_items
       or (v_exec is null and jsonb_array_length(v_events) = 0 and jsonb_array_length(v_sets) = 0) then
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
          select fp.decision_id, fp.schema_version, d.decision_date
            into v_exec_decision_id, v_fp_schema, v_fp_decision_date
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
    'inserted', jsonb_build_object('executions', v_inserted_exec, 'events', v_inserted_events, 'sets', v_inserted_sets),
    'unchanged', jsonb_build_object('executions', v_unchanged_exec, 'events', v_unchanged_events, 'sets', v_unchanged_sets)
  );
end;
$$;

revoke all on function public.record_session_execution(uuid, jsonb) from public;
revoke all on function public.record_session_execution(uuid, jsonb) from anon;
revoke all on function public.record_session_execution(uuid, jsonb) from authenticated;
grant execute on function public.record_session_execution(uuid, jsonb) to service_role;
