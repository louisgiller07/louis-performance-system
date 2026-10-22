-- SPORT-SAFE-02 A5-P0 rollback of 20261021200000_sport_safe_02_a5_p0_hardening.sql (replay as a NEW migration if it
-- ever reached a shared database; LOCAL ONLY today). Restores exactly the execution_health_block body and grants of
-- 20261013160000 (P0-3), then drops the attestation contract and both triggers.
-- Data: the riders' declarations are never lost. Before health_flag_attestations is dropped, its rows are copied into
-- health_flag_attestations_rollback_archive (owner only: no API role can read it; account deletion still removes them
-- through the cascades from health_flags and athletes); the health_flags rows keep the status, resolution date and
-- note the attestations wrote. The table name is left free for a later re-application. A rollback re-opens the gaps
-- closed by A5-P0 (a non-DH session startable under an open concussion signal, a prescription computed before a
-- closure startable again, a concussion signal closable by a direct write) and removes the riders' closure path: it is
-- never a safe rollback by default (docs/review/sport-safe-02/A5_RELEASE_PROCEDURE.md).

create table if not exists public.health_flag_attestations_rollback_archive (
  id uuid primary key,
  flag_id uuid not null references public.health_flags (id) on delete cascade,
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  outcome text not null,
  assessed_on date null,
  professional_category text null,
  declarative boolean not null,
  verified_by_nalynt boolean not null,
  attested_by uuid not null,
  recorded_at timestamptz not null,
  archived_at timestamptz not null default now()
);
alter table public.health_flag_attestations_rollback_archive enable row level security;
revoke all on public.health_flag_attestations_rollback_archive from public, anon, authenticated, service_role;
do $$
begin
  if to_regclass('public.health_flag_attestations') is not null then
    insert into public.health_flag_attestations_rollback_archive
      (id, flag_id, athlete_id, outcome, assessed_on, professional_category, declarative, verified_by_nalynt, attested_by, recorded_at)
    select id, flag_id, athlete_id, outcome, assessed_on, professional_category, declarative, verified_by_nalynt, attested_by, recorded_at
      from public.health_flag_attestations
    on conflict (id) do nothing;
  end if;
end $$;

drop function if exists public.record_health_flag_attestation(jsonb);
drop trigger if exists trg_health_flags_guard_concussion on public.health_flags;
drop function if exists public.guard_concussion_flag();
drop trigger if exists trg_health_flags_lock_athlete on public.health_flags;
drop function if exists public.lock_athlete_for_health_flag();
drop table if exists public.health_flag_attestations;
drop function if exists public.reject_attestation_mutation();

create or replace function public.execution_health_block(p_athlete_id uuid, p_date date, p_family text)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  with latest as (
    select d.id, d.daily_plan
      from public.decisions d
     where d.athlete_id = p_athlete_id and d.decision_date = p_date
     order by d.created_at desc, d.id desc
     limit 1
  )
  select case
    when exists (
      select 1 from public.health_flags f
       where f.athlete_id = p_athlete_id and f.status in ('active', 'monitoring')
         and f.flag_type in ('injury_suspect', 'illness', 'pain_persistent')
    ) then 'health_suspended'
    when p_family = 'dh_technical' and exists (
      select 1 from public.health_flags f
       where f.athlete_id = p_athlete_id and f.status in ('active', 'monitoring') and f.flag_type = 'concussion_suspect'
    ) then 'health_suspended'
    when exists (
      select 1 from latest l
       where l.daily_plan ->> 'decision' = 'REST'
         and exists (select 1 from jsonb_array_elements(coalesce(l.daily_plan -> 'triggered_rules', '[]'::jsonb)) r where r ->> 'layer' = 'A')
    ) then 'health_suspended'
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
  'P0-3 — why no training action may be recorded for the athlete on this date (health_suspended | daily_decision_not_current), NULL when none. Called by record_session_execution only.';
