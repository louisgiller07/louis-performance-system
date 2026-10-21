-- SPORT-SAFE-02 A5-P0 (HPM 2026-10-21) — concussion follow-up: server guard on the CURRENT state, attested lifecycle,
-- no reactivation of an old prescription. LOCAL ONLY: prepared and tested on the local stack; never applied to
-- production without a separate HPM decision. Additive: one table, two functions, two triggers; one function body
-- replaced with the same signature, grants and callers.
-- Rollback: supabase/rollbacks/sport_safe_02/20261021200000_rollback_a5_p0_hardening.sql
--
-- 1. execution_health_block (called by record_session_execution for a start, a resume, every set / activity result
--    and a completion, and by the INT-01 debrief guard):
--    - an open concussion_suspect signal now suspends EVERY session family (was: DH only). It reads the signal
--      itself, whatever the day's decision (no new daily run needed);
--    - a decision computed before the last change of a concussion signal (opened, attested, closed) is no longer
--      the day's decision: daily_decision_not_current. A prescription produced before a closure is never
--      reactivated: a new daily run (new check-in reading) is required.
--    Other signal types and every other condition: unchanged.
-- 2. Serialization: every insert / update of a health signal takes the athlete's lock of record_session_execution,
--    so opening (persist_daily_run, A1) or closing a signal and recording a session never interleave.
-- 3. health_flag_attestations + record_health_flag_attestation: the rider's DECLARATIVE attestation of an external
--    assessment of a concussion signal (never verified by NALYNT, no medical document). Append-only.
-- 4. guard_concussion_flag: a concussion signal is resolved only with a resolving attestation, never deleted outside
--    an account deletion. A technical operator cannot decide medical fitness.

-- ---------------------------------------------------------------------------
-- 1. execution_health_block — same signature, grants unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.execution_health_block(p_athlete_id uuid, p_date date, p_family text)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  with latest as (
    select d.id, d.daily_plan, d.created_at
      from public.decisions d
     where d.athlete_id = p_athlete_id and d.decision_date = p_date
     order by d.created_at desc, d.id desc
     limit 1
  ),
  concussion as (
    select f.status, f.flag_date, greatest(f.created_at, f.updated_at) as changed_at
      from public.health_flags f
     where f.athlete_id = p_athlete_id and f.flag_type = 'concussion_suspect'
  )
  select case
    when exists (
      select 1 from public.health_flags f
       where f.athlete_id = p_athlete_id and f.status in ('active', 'monitoring')
         and f.flag_type in ('injury_suspect', 'illness', 'pain_persistent')
    ) then 'health_suspended'
    -- SPORT-SAFE-02 A5-P0 — every family (p_family no longer narrows it to DH).
    when exists (select 1 from concussion c where c.status in ('active', 'monitoring')) then 'health_suspended'
    when exists (
      select 1 from latest l
       where l.daily_plan ->> 'decision' = 'REST'
         and exists (select 1 from jsonb_array_elements(coalesce(l.daily_plan -> 'triggered_rules', '[]'::jsonb)) r where r ->> 'layer' = 'A')
    ) then 'health_suspended'
    -- SPORT-SAFE-02 A5-P0 — the day's decision predates the last change of a concussion signal declared on or
    -- before that day (a signal never invalidates the decisions of the days before it).
    when exists (
      select 1 from latest l
       where exists (select 1 from concussion c where c.flag_date <= p_date and c.changed_at > l.created_at)
    ) then 'daily_decision_not_current'
    when exists (
      select 1 from latest l
       where not exists (select 1 from public.daily_decision_currency c where c.decision_id = l.id and c.is_current)
    ) then 'daily_decision_not_current'
  end;
$$;

revoke all on function public.execution_health_block(uuid, date, text) from public;
revoke all on function public.execution_health_block(uuid, date, text) from anon;
revoke all on function public.execution_health_block(uuid, date, text) from authenticated;
revoke all on function public.execution_health_block(uuid, date, text) from service_role;

comment on function public.execution_health_block(uuid, date, text) is
  'P0-3, SPORT-SAFE-02 A5-P0 — why no training action may be recorded for the athlete on this date (health_suspended | daily_decision_not_current), NULL when none. An open concussion signal suspends every family; a decision older than the last concussion signal change is not current. Called by record_session_execution and completed_session_health_block only.';

-- ---------------------------------------------------------------------------
-- 2. Serialization with record_session_execution (same per-athlete advisory lock).
-- ---------------------------------------------------------------------------
create function public.lock_athlete_for_health_flag()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('record_session_execution:' || new.athlete_id::text, 0));
  return new;
end;
$$;

revoke all on function public.lock_athlete_for_health_flag() from public, anon, authenticated, service_role;

create trigger trg_health_flags_lock_athlete
  before insert or update on public.health_flags
  for each row execute function public.lock_athlete_for_health_flag();

-- ---------------------------------------------------------------------------
-- 3. Declarative attestations of a concussion signal (append-only).
-- ---------------------------------------------------------------------------
create table public.health_flag_attestations (
  id uuid primary key,
  flag_id uuid not null references public.health_flags (id) on delete cascade,
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  outcome text not null check (outcome in ('assessment_in_progress', 'concussion_confirmed', 'ruled_out', 'full_return_authorised', 'entered_in_error')),
  assessed_on date null,
  professional_category text null check (professional_category in ('physician', 'sports_physician', 'physiotherapist', 'other')),
  -- Always a rider's declaration: NALYNT never verifies it (no document, no diagnosis stored).
  declarative boolean not null default true check (declarative),
  verified_by_nalynt boolean not null default false check (not verified_by_nalynt),
  attested_by uuid not null,
  recorded_at timestamptz not null default now(),
  constraint health_flag_attestations_error_shape check (
    outcome <> 'entered_in_error' or (assessed_on is null and professional_category is null)
  ),
  constraint health_flag_attestations_assessed_on_required check (
    outcome not in ('concussion_confirmed', 'ruled_out', 'full_return_authorised') or assessed_on is not null
  )
);

create index health_flag_attestations_flag_idx on public.health_flag_attestations (flag_id, recorded_at);

comment on table public.health_flag_attestations is
  'SPORT-SAFE-02 A5-P0 — the rider''s declarative attestation of an external assessment of a concussion signal (assessment in progress, confirmed, ruled out, full return authorised) or of an entry error. Never verified by NALYNT; no medical document. Append-only; written only by record_health_flag_attestation.';

alter table public.health_flag_attestations enable row level security;

create policy health_flag_attestations_own_select on public.health_flag_attestations
  for select to authenticated
  using (athlete_id in (select a.id from public.athletes a where a.user_id = auth.uid()));

-- Read only for everyone but the RPC (security definer): a service role or an operator can never write an
-- attestation (it would let a direct write close a concussion signal). No TRUNCATE / TRIGGER / MAINTAIN either.
revoke all on public.health_flag_attestations from public, anon, authenticated, service_role;
grant select on public.health_flag_attestations to authenticated, service_role;

-- Append-only, except inside an account purge or a cascade from the deleted signal / account.
create function public.reject_attestation_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' and (
       current_setting('nalynt.athlete_purge_txid', true) = txid_current()::text
       or not exists (select 1 from public.health_flags f where f.id = old.flag_id)
       or not exists (select 1 from public.athletes a where a.id = old.athlete_id)
     ) then
    return old;
  end if;
  raise exception 'append-only violation: % on % is not permitted', tg_op, tg_table_name;
end;
$$;

revoke all on function public.reject_attestation_mutation() from public, anon, authenticated, service_role;

create trigger trg_health_flag_attestations_no_update
  before update on public.health_flag_attestations
  for each row execute function public.reject_attestation_mutation();
create trigger trg_health_flag_attestations_no_delete
  before delete on public.health_flag_attestations
  for each row execute function public.reject_attestation_mutation();

-- ---------------------------------------------------------------------------
-- 4. A concussion signal: resolved only with a resolving attestation, never deleted on its own.
-- ---------------------------------------------------------------------------
create function public.guard_concussion_flag()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.flag_type = 'concussion_suspect'
       and current_setting('nalynt.athlete_purge_txid', true) is distinct from txid_current()::text
       and exists (select 1 from public.athletes a where a.id = old.athlete_id) then
      raise exception using errcode = 'NX201', message = 'concussion_flag_delete_refused',
        detail = 'A concussion signal is never deleted; it is closed through a rider attestation.';
    end if;
    return old;
  end if;
  if old.flag_type = 'concussion_suspect' and new.flag_type is distinct from old.flag_type then
    raise exception using errcode = 'NX201', message = 'concussion_flag_retype_refused';
  end if;
  if old.flag_type = 'concussion_suspect' and old.status <> 'resolved' and new.status = 'resolved'
     and not exists (
       select 1 from public.health_flag_attestations a
        where a.flag_id = old.id and a.outcome in ('ruled_out', 'full_return_authorised', 'entered_in_error')
     ) then
    raise exception using errcode = 'NX201', message = 'concussion_resolution_requires_attestation',
      detail = 'A concussion signal is resolved only through record_health_flag_attestation.';
  end if;
  if old.flag_type = 'concussion_suspect' and old.status = 'resolved' and new.status <> 'resolved' then
    raise exception using errcode = 'NX201', message = 'concussion_flag_reopen_refused',
      detail = 'A new suspicion opens a new signal (A1).';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_concussion_flag() from public, anon, authenticated, service_role;

create trigger trg_health_flags_guard_concussion
  before update or delete on public.health_flags
  for each row execute function public.guard_concussion_flag();

-- ---------------------------------------------------------------------------
-- 5. record_health_flag_attestation — the rider's own declaration, nothing else.
-- ---------------------------------------------------------------------------
create function public.record_health_flag_attestation(p_attestation jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_keys constant text[] := array['id', 'flag_id', 'outcome', 'assessed_on', 'professional_category', 'entered_in_error_confirmation'];
  c_resolving constant text[] := array['ruled_out', 'full_return_authorised', 'entered_in_error'];
  v_key text;
  v_athlete uuid;
  v_id uuid;
  v_flag_id uuid;
  v_outcome text;
  v_assessed_on date;
  v_category text;
  v_confirmed boolean;
  v_flag public.health_flags%rowtype;
  v_existing public.health_flag_attestations%rowtype;
  v_last text;
  v_today date := (now() at time zone 'Europe/Zurich')::date;
  v_new_status public.health_flag_status;
begin
  begin
    if p_attestation is null or jsonb_typeof(p_attestation) <> 'object' then
      raise exception using errcode = 'NX001', message = 'invalid_payload';
    end if;
    for v_key in select jsonb_object_keys(p_attestation) loop
      if not (v_key = any (c_keys)) then
        raise exception using errcode = 'NX001', message = 'unknown_key', detail = v_key;
      end if;
    end loop;

    -- Only the rider, signed in: never a service role, never an operator acting for the rider.
    select a.id into v_athlete from public.athletes a where a.user_id = auth.uid();
    if auth.uid() is null or v_athlete is null then
      raise exception using errcode = 'NX001', message = 'rider_attestation_required';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('record_session_execution:' || v_athlete::text, 0));

    begin
      v_id := (p_attestation ->> 'id')::uuid;
      v_flag_id := (p_attestation ->> 'flag_id')::uuid;
      v_assessed_on := (p_attestation ->> 'assessed_on')::date;
    exception when others then
      raise exception using errcode = 'NX001', message = 'invalid_payload';
    end;
    v_outcome := p_attestation ->> 'outcome';
    v_category := p_attestation ->> 'professional_category';
    if jsonb_typeof(p_attestation -> 'entered_in_error_confirmation') not in ('boolean', 'null') then
      raise exception using errcode = 'NX001', message = 'invalid_payload';
    end if;
    v_confirmed := coalesce((p_attestation ->> 'entered_in_error_confirmation')::boolean, false);
    if v_id is null or v_flag_id is null
       or v_outcome is null or not (v_outcome = any (array['assessment_in_progress', 'concussion_confirmed', 'ruled_out', 'full_return_authorised', 'entered_in_error']))
       or (v_category is not null and not (v_category = any (array['physician', 'sports_physician', 'physiotherapist', 'other']))) then
      raise exception using errcode = 'NX001', message = 'invalid_payload';
    end if;

    -- Idempotence: the same id with the same content is a replay; another content is a conflict.
    select * into v_existing from public.health_flag_attestations where id = v_id;
    if found then
      if v_existing.athlete_id = v_athlete and v_existing.flag_id = v_flag_id and v_existing.outcome = v_outcome
         and v_existing.assessed_on is not distinct from v_assessed_on and v_existing.professional_category is not distinct from v_category then
        return jsonb_build_object('status', 'unchanged', 'id', v_id);
      end if;
      raise exception using errcode = 'NX001', message = 'id_conflict';
    end if;

    -- The rider's own concussion signal only (another rider's signal reads as not found).
    select * into v_flag from public.health_flags where id = v_flag_id and athlete_id = v_athlete;
    if not found then
      raise exception using errcode = 'NX001', message = 'flag_not_found';
    end if;
    if v_flag.flag_type <> 'concussion_suspect' then
      raise exception using errcode = 'NX001', message = 'not_a_concussion_signal';
    end if;
    if v_flag.status = 'resolved' then
      raise exception using errcode = 'NX001', message = 'flag_not_open';
    end if;

    select a.outcome into v_last from public.health_flag_attestations a
     where a.flag_id = v_flag_id order by a.recorded_at desc, a.id desc limit 1;

    if v_outcome = 'entered_in_error' then
      -- PROPOSAL (not an HPM decision): an entry error is corrected the day it was declared, before any professional
      -- attestation and before any session was recorded since; otherwise only an assessment closes the signal.
      if not v_confirmed then
        raise exception using errcode = 'NX001', message = 'entered_in_error_confirmation_required';
      end if;
      if v_assessed_on is not null or v_category is not null then
        raise exception using errcode = 'NX001', message = 'invalid_payload';
      end if;
      if v_last is not null then
        raise exception using errcode = 'NX001', message = 'entered_in_error_after_assessment';
      end if;
      if v_flag.flag_date <> v_today then
        raise exception using errcode = 'NX001', message = 'entered_in_error_window_closed';
      end if;
      if exists (select 1 from public.session_executions e where e.athlete_id = v_athlete and e.recorded_at >= v_flag.created_at)
         or exists (select 1 from public.completed_sessions cs where cs.athlete_id = v_athlete and cs.session_date >= v_flag.flag_date and cs.completion_status <> 'skipped') then
        raise exception using errcode = 'NX001', message = 'entered_in_error_after_training';
      end if;
    else
      if v_confirmed then
        raise exception using errcode = 'NX001', message = 'invalid_payload';
      end if;
      if v_outcome <> 'assessment_in_progress' and v_assessed_on is null then
        raise exception using errcode = 'NX001', message = 'assessed_on_required';
      end if;
      if v_assessed_on is not null and (v_assessed_on < v_flag.flag_date or v_assessed_on > v_today) then
        raise exception using errcode = 'NX001', message = 'assessed_on_out_of_range';
      end if;
      -- Transitions: a confirmed concussion is never « ruled out » and never goes back to « in progress »; it ends
      -- with a full return authorised.
      if (v_outcome = 'assessment_in_progress' and v_last = 'concussion_confirmed')
         or (v_outcome = 'ruled_out' and v_last = 'concussion_confirmed') then
        raise exception using errcode = 'NX001', message = 'invalid_transition';
      end if;
    end if;

    insert into public.health_flag_attestations (id, flag_id, athlete_id, outcome, assessed_on, professional_category, attested_by)
    values (v_id, v_flag_id, v_athlete, v_outcome, v_assessed_on, v_category, auth.uid());

    v_new_status := case when v_outcome = any (c_resolving) then 'resolved'::public.health_flag_status else 'monitoring'::public.health_flag_status end;
    update public.health_flags
       set status = v_new_status,
           resolved_at = case when v_new_status = 'resolved' then v_today else resolved_at end,
           professional_consulted = case when v_outcome in ('ruled_out', 'full_return_authorised', 'concussion_confirmed') then true else professional_consulted end,
           professional_type = coalesce(v_category, professional_type),
           resolution_note = case when v_new_status = 'resolved'
                                  then 'attestation:' || v_outcome || ' (déclaratif, non vérifié par NALYNT)'
                                  else resolution_note end
     where id = v_flag_id;

    return jsonb_build_object('status', 'recorded', 'id', v_id, 'outcome', v_outcome, 'flag_status', v_new_status);
  exception when sqlstate 'NX001' then
    get stacked diagnostics v_key = message_text;
    return jsonb_build_object('status', 'rejected', 'code', v_key);
  end;
end;
$$;

revoke all on function public.record_health_flag_attestation(jsonb) from public, anon, service_role;
grant execute on function public.record_health_flag_attestation(jsonb) to authenticated;

comment on function public.record_health_flag_attestation(jsonb) is
  'SPORT-SAFE-02 A5-P0 — the rider records a DECLARATIVE attestation (never verified by NALYNT) of an external assessment of their own concussion signal, or an entry error the day of the declaration. Resolving outcomes close the signal; the others keep it open (monitoring). Never callable by a service role or an operator.';
