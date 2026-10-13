-- INT-01 (HPM 2026-10-13, dernier contrôle « guidée abandonnée hors santé ») — the legacy debrief never turns a
-- recorded guided attempt into a V1 realisation.
--
-- Before: on an ordinary day (no health suspension), after a guided V2 execution with results was abandoned,
-- persist_completed_session accepted « Terminée », « Partielle » and « Remplacée » (UX-11R.9 left the debrief
-- open after an abandoned attempt): the day read « Séance réalisée » in History, counted in adherence and in
-- the M1 recent load, while the abandoned execution itself counts in neither.
--
-- Rule (HPM contract: an existing guided execution never becomes a fictive V1 realisation nor a second main
-- session of the day): a day with an abandoned guided execution that recorded at least one set or activity
-- result takes no V1 debrief at all -> NX104 guided_results_exist (« Non réalisée » would contradict it, the
-- other statuses would replace or duplicate it). Unchanged: open / completed executions (NX101), the health
-- guard (20261013180000, evaluated first), an attempt stopped before any result on an ordinary day (debrief
-- open, UX-11R.9), days without a guided execution.
--
-- persist_completed_session only: signature, SECURITY INVOKER, search_path, grants, advisory lock, validations
-- and upsert unchanged; the check runs under the existing lock. completed_session_health_block unchanged.
-- Rollback script: supabase/rollbacks/int01/20261013190000_rollback_completed_session_guided_record_guard.sql

create or replace function public.persist_completed_session(
  p_athlete_id uuid,
  p_row jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_key text;
  v_id uuid;

  v_session_date date;
  v_session_type public.session_type;
  v_completion_status public.completion_status;
  v_new_pain boolean;

  v_decision_id uuid;
  v_actual_duration_min integer;
  v_rpe integer;
  v_main_content jsonb;
  v_intervention jsonb;
  v_free_notes text;
  v_post_leg_fatigue integer;
  v_post_grip_fatigue integer;
  v_new_pain_note text;
  v_technical_outcome public.technical_outcome;
  v_change_reason public.change_reason;
  v_change_reason_note text;

  v_decision_athlete_id uuid;
  v_decision_date date;

  v_health_block text;
begin
  if p_row is null then
    raise exception 'persist_completed_session: p_row is required';
  end if;

  -----------------------------------------------------------------------
  -- Explicitly forbidden keys — dedicated messages (typo/data-loss
  -- protection is easier to diagnose with a specific reason than a
  -- generic "unknown key").
  -----------------------------------------------------------------------
  if p_row ? 'id' then
    raise exception 'persist_completed_session: p_row.id is not accepted (DB-managed identity)';
  end if;
  if p_row ? 'session_load' then
    raise exception 'persist_completed_session: p_row.session_load is not accepted (trigger-derived, never client-supplied)';
  end if;
  if p_row ? 'submitted_at' then
    raise exception 'persist_completed_session: p_row.submitted_at is not accepted (DB-managed, fixed at first insert)';
  end if;
  if p_row ? 'created_at' then
    raise exception 'persist_completed_session: p_row.created_at is not accepted (DB-managed)';
  end if;
  if p_row ? 'updated_at' then
    raise exception 'persist_completed_session: p_row.updated_at is not accepted (DB-managed, trigger-maintained)';
  end if;
  if p_row ? 'athlete_id' then
    raise exception 'persist_completed_session: p_row.athlete_id is not accepted — ownership comes exclusively from p_athlete_id';
  end if;
  if p_row ? 'planned_session_id' then
    raise exception 'persist_completed_session: p_row.planned_session_id is not accepted (outside the M5_001A contract; the existing value, if any, is always preserved untouched)';
  end if;

  -----------------------------------------------------------------------
  -- Any other unknown/typoed key is rejected — only the canonical set
  -- below is accepted (full replacement, strict).
  -----------------------------------------------------------------------
  for v_key in select jsonb_object_keys(p_row) loop
    if v_key <> all (array[
      'session_date', 'session_type', 'completion_status', 'new_pain',
      'decision_id', 'actual_duration_min', 'rpe', 'main_content', 'intervention',
      'free_notes', 'post_leg_fatigue', 'post_grip_fatigue', 'new_pain_note',
      'technical_outcome', 'change_reason', 'change_reason_note'
    ]) then
      raise exception 'persist_completed_session: unknown key "%" in p_row', v_key;
    end if;
  end loop;

  -----------------------------------------------------------------------
  -- Required, non-null fields.
  -----------------------------------------------------------------------
  if not (p_row ? 'session_date') or (p_row->>'session_date') is null then
    raise exception 'persist_completed_session: p_row.session_date is required and must not be null';
  end if;
  v_session_date := (p_row->>'session_date')::date;

  -- UX-11R.9 (F-5, F-5b) — a day whose guided V2 execution is open
  -- (started / paused / resumed) or completed takes no legacy
  -- completed_sessions row (insert or replacement): an open guided session
  -- reserves the day's main session, a completed one is the day's session.
  -- Only an abandoned execution (or none) leaves the legacy debrief open.
  -- Same per-athlete advisory lock as record_session_execution: a V2 start,
  -- a V2 completion and a legacy debrief never interleave (one wins).
  -- Dedicated SQLSTATE: the Edge Function maps the code, never the message.
  perform pg_advisory_xact_lock(hashtextextended('record_session_execution:' || p_athlete_id::text, 0));
  if exists (
    select 1 from public.session_executions e
     where e.athlete_id = p_athlete_id
       and e.session_date = v_session_date
       and not exists (
         select 1 from public.execution_events ev
          where ev.execution_id = e.id and ev.event_type = 'abandoned'
       )
  ) then
    raise exception using errcode = 'NX101', message = 'completed_session_v2_exists';
  end if;

  if not (p_row ? 'session_type') or (p_row->>'session_type') is null then
    raise exception 'persist_completed_session: p_row.session_type is required and must not be null';
  end if;
  v_session_type := (p_row->>'session_type')::public.session_type;

  if not (p_row ? 'completion_status') or (p_row->>'completion_status') is null then
    raise exception 'persist_completed_session: p_row.completion_status is required and must not be null';
  end if;
  v_completion_status := (p_row->>'completion_status')::public.completion_status;

  -- new_pain: health/safety field (same family as daily_checkins.pain,
  -- whose silent omission already caused a real bug elsewhere in this
  -- project — see the M4_003 check-in bugfix in docs/11_DECISION_LOG.md).
  -- The DB column is NOT NULL DEFAULT false (no tri-state representation
  -- possible at the SQL level), but this RPC never accepts a missing or
  -- null value as an implicit "false".
  if not (p_row ? 'new_pain') or (p_row->>'new_pain') is null then
    raise exception 'persist_completed_session: p_row.new_pain is required and must not be null';
  end if;
  v_new_pain := (p_row->>'new_pain')::boolean;

  -----------------------------------------------------------------------
  -- Required-present, nullable fields — the key MUST exist; the value MAY
  -- be JSON null. A missing key is always an exception, never treated as
  -- an implicit null.
  -----------------------------------------------------------------------
  if not (p_row ? 'decision_id') then
    raise exception 'persist_completed_session: p_row.decision_id key is required (uuid or explicit null)';
  end if;
  if not (p_row ? 'actual_duration_min') then
    raise exception 'persist_completed_session: p_row.actual_duration_min key is required (integer or explicit null)';
  end if;
  if not (p_row ? 'rpe') then
    raise exception 'persist_completed_session: p_row.rpe key is required (integer or explicit null)';
  end if;
  if not (p_row ? 'main_content') then
    raise exception 'persist_completed_session: p_row.main_content key is required (object or explicit null)';
  end if;
  if not (p_row ? 'intervention') then
    raise exception 'persist_completed_session: p_row.intervention key is required (object or explicit null)';
  end if;
  if not (p_row ? 'free_notes') then
    raise exception 'persist_completed_session: p_row.free_notes key is required (text or explicit null)';
  end if;
  if not (p_row ? 'post_leg_fatigue') then
    raise exception 'persist_completed_session: p_row.post_leg_fatigue key is required (integer or explicit null)';
  end if;
  if not (p_row ? 'post_grip_fatigue') then
    raise exception 'persist_completed_session: p_row.post_grip_fatigue key is required (integer or explicit null)';
  end if;
  if not (p_row ? 'new_pain_note') then
    raise exception 'persist_completed_session: p_row.new_pain_note key is required (text or explicit null)';
  end if;

  v_actual_duration_min := (p_row->>'actual_duration_min')::integer;
  v_rpe := (p_row->>'rpe')::integer;
  v_main_content := p_row->'main_content';
  v_intervention := p_row->'intervention';
  v_free_notes := p_row->>'free_notes';
  v_post_leg_fatigue := (p_row->>'post_leg_fatigue')::integer;
  v_post_grip_fatigue := (p_row->>'post_grip_fatigue')::integer;
  v_new_pain_note := p_row->>'new_pain_note';

  -- INT-01 (HPM 2026-10-13) — health guard of the legacy debrief, under the same per-athlete advisory lock
  -- (taken above). The server decides, never the client: completed_session_health_block applies the P0-3
  -- health rule (execution_health_block) and the day's health history. Dedicated SQLSTATEs, mapped by the
  -- Edge Function (never the message): NX102 health_suspended, NX103 daily_decision_not_current,
  -- NX104 guided_results_exist.
  -- DH family (P0-3: an open concussion signal suspends DH sessions): the performed DH activity or the DH type.
  v_health_block := public.completed_session_health_block(
    p_athlete_id, v_session_date, v_completion_status,
    case when coalesce(v_intervention ->> 'kind', '') in ('DH_TECHNICAL', 'DH_PERFORMANCE', 'DH_LIGHT', 'PUMPTRACK', 'RACE_ACTIVITY')
           or v_session_type in ('DH_TECHNICAL', 'DH_PERFORMANCE')
         then 'dh_technical' else 'other' end
  );
  if v_health_block = 'health_suspended' then
    raise exception using errcode = 'NX102', message = 'health_suspended';
  elsif v_health_block = 'daily_decision_not_current' then
    raise exception using errcode = 'NX103', message = 'daily_decision_not_current';
  elsif v_health_block = 'guided_results_exist' then
    raise exception using errcode = 'NX104', message = 'guided_results_exist';
  end if;

  -- INT-01 (HPM 2026-10-13, dernier contrôle) — a guided attempt that recorded results is the day's record of
  -- the session, health or not: no V1 debrief may turn it into a V1 realisation or a second main session
  -- (done / partial / replaced), nor contradict it (skipped). Open or completed executions are already refused
  -- above (NX101); this concerns abandoned ones. An attempt stopped before any result leaves the ordinary
  -- debrief open (UX-11R.9), except on a day with a Safety REST (health guard above). Same SQLSTATE as the
  -- health guard's contradiction case: NX104 guided_results_exist.
  if exists (
    select 1 from public.session_executions e
     where e.athlete_id = p_athlete_id and e.session_date = v_session_date
       and (exists (select 1 from public.exercise_set_results r where r.execution_id = e.id)
            or exists (select 1 from public.session_activity_results a where a.execution_id = e.id))
  ) then
    raise exception using errcode = 'NX104', message = 'guided_results_exist';
  end if;

  -----------------------------------------------------------------------
  -- technical_outcome / change_reason / change_reason_note — the ONLY
  -- keys in this contract that may be ABSENT. See the module doc above
  -- (rollout-safety). Absent -> NULL; present (including JSON null) ->
  -- cast/read normally, identical to every other field's treatment.
  -----------------------------------------------------------------------
  if p_row ? 'technical_outcome' then
    v_technical_outcome := (p_row->>'technical_outcome')::public.technical_outcome;
  else
    v_technical_outcome := null;
  end if;

  if p_row ? 'change_reason' then
    v_change_reason := (p_row->>'change_reason')::public.change_reason;
  else
    v_change_reason := null;
  end if;

  if p_row ? 'change_reason_note' then
    v_change_reason_note := p_row->>'change_reason_note';
  else
    v_change_reason_note := null;
  end if;

  -----------------------------------------------------------------------
  -- decision_id integrity (value-level, key presence already enforced
  -- above): same athlete, same date as session_date.
  -----------------------------------------------------------------------
  if (p_row->>'decision_id') is not null then
    v_decision_id := (p_row->>'decision_id')::uuid;

    select athlete_id, decision_date
    into v_decision_athlete_id, v_decision_date
    from public.decisions
    where id = v_decision_id;

    if not found then
      raise exception 'persist_completed_session: decision_id % does not exist', v_decision_id;
    end if;

    if v_decision_athlete_id <> p_athlete_id then
      raise exception 'persist_completed_session: decision_id % does not belong to athlete %', v_decision_id, p_athlete_id;
    end if;

    if v_decision_date <> v_session_date then
      raise exception 'persist_completed_session: decision_id % decision_date (%) does not match session_date (%)',
        v_decision_id, v_decision_date, v_session_date;
    end if;
  else
    v_decision_id := null;
  end if;

  -----------------------------------------------------------------------
  -- UPSERT on the existing unique_completed_per_day (athlete_id, session_date).
  -- session_load is never in this column list — trg_compute_session_load
  -- derives it on both the INSERT and the DO UPDATE branch.
  -- planned_session_id is never in this column list either — absent from
  -- the INSERT (takes its column default, NULL) and absent from the
  -- DO UPDATE SET clause (Postgres leaves an unlisted column untouched on
  -- UPDATE, so any existing value is preserved automatically).
  -----------------------------------------------------------------------
  insert into public.completed_sessions (
    athlete_id, session_date, session_type, completion_status,
    actual_duration_min, rpe, main_content, intervention, free_notes,
    post_leg_fatigue, post_grip_fatigue, new_pain, new_pain_note, decision_id,
    technical_outcome, change_reason, change_reason_note
  )
  values (
    p_athlete_id, v_session_date, v_session_type, v_completion_status,
    v_actual_duration_min, v_rpe, v_main_content, v_intervention, v_free_notes,
    v_post_leg_fatigue, v_post_grip_fatigue, v_new_pain, v_new_pain_note, v_decision_id,
    v_technical_outcome, v_change_reason, v_change_reason_note
  )
  on conflict (athlete_id, session_date) do update set
    session_type = excluded.session_type,
    completion_status = excluded.completion_status,
    actual_duration_min = excluded.actual_duration_min,
    rpe = excluded.rpe,
    main_content = excluded.main_content,
    intervention = excluded.intervention,
    free_notes = excluded.free_notes,
    post_leg_fatigue = excluded.post_leg_fatigue,
    post_grip_fatigue = excluded.post_grip_fatigue,
    new_pain = excluded.new_pain,
    new_pain_note = excluded.new_pain_note,
    decision_id = excluded.decision_id,
    technical_outcome = excluded.technical_outcome,
    change_reason = excluded.change_reason,
    change_reason_note = excluded.change_reason_note
    -- submitted_at intentionally absent: keeps its original first-submission
    -- value across updates. updated_at is auto-maintained separately by
    -- trg_completed_sessions_updated_at. planned_session_id intentionally
    -- absent: see module doc above.
  returning id into v_id;

  -- Minimal, stable response — the caller does not need to distinguish
  -- INSERT from UPDATE (no xmax-based "created" flag exposed).
  return jsonb_build_object('completed_session_id', v_id);
end;
$$;

revoke all on function public.persist_completed_session(uuid, jsonb) from public;
revoke all on function public.persist_completed_session(uuid, jsonb) from anon;
revoke all on function public.persist_completed_session(uuid, jsonb) from authenticated;
grant execute on function public.persist_completed_session(uuid, jsonb) to service_role;
