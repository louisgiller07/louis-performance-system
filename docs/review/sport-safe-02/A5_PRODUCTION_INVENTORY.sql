-- SPORT-SAFE-02 A5 — read-only aggregated production inventory, to run BEFORE migration 20261021200000.
-- A single SELECT statement: it cannot write. Counts and booleans only: no identifier, no date, no free text,
-- no medical detail beyond the signal type the question is about.
-- Run (Louis, production, after an explicit GO): npx supabase db query --linked -f docs/review/sport-safe-02/A5_PRODUCTION_INVENTORY.sql
-- Expected reading: docs/review/sport-safe-02/A5_RELEASE_PROCEDURE.md (§ Inventaire).
with today as (
  select (now() at time zone 'Europe/Zurich')::date as d
), conc as (
  select f.id, f.athlete_id, f.status, f.flag_date, f.created_at, f.resolved_at,
         f.status in ('active', 'monitoring') as is_open
  from public.health_flags f
  where f.flag_type = 'concussion_suspect'
), open_conc as (
  select * from conc where is_open
), checks (ord, check_name, value) as (
  select 1, 'concussion_signals_total', count(*)::text from conc
  union all select 2, 'concussion_signals_active', count(*) filter (where status = 'active')::text from conc
  union all select 3, 'concussion_signals_monitoring', count(*) filter (where status = 'monitoring')::text from conc
  union all select 4, 'concussion_signals_resolved', count(*) filter (where status = 'resolved')::text from conc
  union all select 5, 'riders_with_open_concussion', count(distinct athlete_id)::text from open_conc
  union all select 6, 'riders_with_several_open_concussion_signals',
    (select count(*) from (select athlete_id from open_conc group by athlete_id having count(*) > 1) x)::text
  -- No closure path: only the signed-in rider can attest (never an operator or a service role).
  union all select 7, 'open_concussion_rider_without_login',
    count(*)::text from open_conc o join public.athletes a on a.id = o.athlete_id
    where a.user_id is null or not exists (select 1 from auth.users u where u.id = a.user_id)
  union all select 8, 'open_concussion_login_banned_or_deleted',
    count(*)::text from open_conc o join public.athletes a on a.id = o.athlete_id join auth.users u on u.id = a.user_id
    where u.banned_until > now() or u.deleted_at is not null
  -- A dated outcome needs a date between the signal and today: none possible before flag_date (temporary).
  union all select 9, 'open_concussion_flag_date_in_future', count(*) filter (where flag_date > (select d from today))::text from open_conc
  -- Closure refused until today's check-in is corrected (never a lock: the check-in stays editable).
  union all select 10, 'open_concussion_today_checkin_declares_concussion',
    count(*)::text from open_conc o
    where exists (select 1 from public.daily_checkins c where c.athlete_id = o.athlete_id and c.checkin_date = (select d from today) and c.suspected_concussion)
  -- « Entry error » no longer possible (a full return authorised still is).
  union all select 11, 'open_concussion_session_recorded_since_signal',
    count(*)::text from open_conc o
    where exists (select 1 from public.session_executions e where e.athlete_id = o.athlete_id and e.recorded_at >= o.created_at)
       or exists (select 1 from public.completed_sessions cs where cs.athlete_id = o.athlete_id and cs.submitted_at >= o.created_at and cs.completion_status <> 'skipped')
  -- After the migration: results, resume and completion refused; pause and abandon accepted; recorded results kept.
  union all select 12, 'open_concussion_unfinished_guided_execution',
    count(*)::text from public.session_executions e
    where e.athlete_id in (select athlete_id from open_conc)
      and not exists (select 1 from public.execution_events ev where ev.execution_id = e.id and ev.event_type in ('completed', 'abandoned'))
  -- Today's current decision still prescribes a session (A5 was ZERO_DH): no longer startable after the migration.
  union all select 13, 'open_concussion_latest_decision_today_not_rest',
    count(*)::text from (
      select distinct on (d.athlete_id) d.athlete_id, d.daily_plan ->> 'decision' as decision
      from public.decisions d
      where d.athlete_id in (select athlete_id from open_conc) and d.decision_date = (select d from today)
      order by d.athlete_id, d.created_at desc
    ) latest where latest.decision is distinct from 'REST'
  union all select 14, 'resolved_concussion_without_resolved_at', count(*) filter (where status = 'resolved' and resolved_at is null)::text from conc
  union all select 15, 'open_signals_other_types_unchanged_by_a5',
    count(*)::text from public.health_flags where flag_type <> 'concussion_suspect' and status in ('active', 'monitoring')
  -- Pre-checks: the migration creates these objects (it fails if one already exists).
  union all select 16, 'precheck_attestations_table_absent', (to_regclass('public.health_flag_attestations') is null)::text
  union all select 17, 'precheck_attestation_rpc_absent', (to_regprocedure('public.record_health_flag_attestation(jsonb)') is null)::text
  union all select 18, 'precheck_new_functions_absent',
    (to_regprocedure('public.lock_athlete_for_health_flag()') is null and to_regprocedure('public.guard_concussion_flag()') is null
     and to_regprocedure('public.reject_attestation_mutation()') is null)::text
  union all select 19, 'precheck_new_triggers_absent',
    (not exists (select 1 from pg_trigger where tgname in ('trg_health_flags_lock_athlete', 'trg_health_flags_guard_concussion')))::text
  union all select 20, 'precheck_execution_health_block_md5', md5(pg_get_functiondef('public.execution_health_block(uuid,date,text)'::regprocedure))
  union all select 21, 'precheck_last_migration', (select max(version) from supabase_migrations.schema_migrations)
  union all select 22, 'precheck_migrations_count', (select count(*) from supabase_migrations.schema_migrations)::text
)
select check_name, value from checks order by ord;
