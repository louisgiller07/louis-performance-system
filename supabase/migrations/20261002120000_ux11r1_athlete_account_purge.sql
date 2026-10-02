-- UX-11R.1 — athlete account purge (local, not pushed).
--
-- Implements the decision of ADR UX-11B.2.1 §11: an account deletion is a
-- PHYSICAL purge of every row of the athlete, by ONE server-only procedure
-- that lifts the append-only protection ONLY inside its own transaction and
-- deletes in dependency order. Until now no path existed: deleting an
-- athlete failed on RESTRICT foreign keys (training_plan_versions,
-- training_plan_current_version, session_executions, pattern_*) and on the
-- append-only triggers of the ledgers.
--
-- 1. reject_append_only_mutation(): unchanged for every normal operation
--    (UPDATE is always refused; DELETE is refused) EXCEPT a DELETE executed
--    in the very transaction where purge_athlete_account() set the
--    transaction-local marker `nalynt.athlete_purge_txid` to that
--    transaction's own id. No trigger is ever disabled. API roles have no
--    DELETE privilege on any append-only table (verified), so the marker
--    widens nothing for them; it is set only by the purge procedure.
-- 2. purge_athlete_account(p_athlete_id): SECURITY DEFINER, execute granted
--    to service_role only. Explicit target, all-or-nothing (any failure
--    rolls everything back), serialized with execution writes of the same
--    athlete, deletes children before parents (supersedes chains leaf
--    first), then the athletes row (CASCADE for the remaining tables), then
--    verifies that no row of the athlete remains in any table carrying an
--    athlete_id. Other athletes are never touched.
-- 3. auth.users is NOT deleted here: athletes.user_id cascades from
--    auth.users, so the identity is removed afterwards through the Auth
--    admin API (auth.admin.deleteUser) by the authorized backend. Order:
--    purge application data → delete the Auth user.
--
-- Additive: no table, column or data change.

create or replace function public.reject_append_only_mutation()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'DELETE'
     and current_setting('nalynt.athlete_purge_txid', true) = txid_current()::text then
    -- Only inside purge_athlete_account()'s own transaction.
    return old;
  end if;
  raise exception 'append-only violation: % on % is not permitted', TG_OP, TG_TABLE_NAME;
end;
$$;

create or replace function public.purge_athlete_account(p_athlete_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_n bigint;
  v_total bigint;
  v_table text;
  v_left bigint;
begin
  if p_athlete_id is null then
    raise exception 'purge_athlete_account: p_athlete_id is required';
  end if;
  if not exists (select 1 from public.athletes where id = p_athlete_id) then
    raise exception 'purge_athlete_account: unknown athlete %', p_athlete_id using errcode = 'P0002';
  end if;

  -- Serialized with record_session_execution for the same athlete.
  perform pg_advisory_xact_lock(hashtextextended('record_session_execution:' || p_athlete_id::text, 0));
  -- Transaction-local marker: lifts the append-only DELETE refusal for this transaction only.
  perform set_config('nalynt.athlete_purge_txid', txid_current()::text, true);

  -- Guided-session executions (results: corrections before originals).
  v_total := 0;
  loop
    delete from public.session_activity_results r
     where r.athlete_id = p_athlete_id
       and not exists (select 1 from public.session_activity_results c where c.supersedes_id = r.id);
    get diagnostics v_n = row_count; v_total := v_total + v_n; exit when v_n = 0;
  end loop;
  v_counts := v_counts || jsonb_build_object('session_activity_results', v_total);
  v_total := 0;
  loop
    delete from public.exercise_set_results r
     where r.athlete_id = p_athlete_id
       and not exists (select 1 from public.exercise_set_results c where c.supersedes_id = r.id);
    get diagnostics v_n = row_count; v_total := v_total + v_n; exit when v_n = 0;
  end loop;
  v_counts := v_counts || jsonb_build_object('exercise_set_results', v_total);
  delete from public.execution_events where athlete_id = p_athlete_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('execution_events', v_n);
  delete from public.session_executions where athlete_id = p_athlete_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('session_executions', v_n);
  delete from public.decision_final_prescriptions where athlete_id = p_athlete_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('decision_final_prescriptions', v_n);

  -- Pattern ledgers (source refs before what they reference; chains leaf first).
  delete from public.pattern_evidence_source_refs s
   using public.pattern_evidence_revisions r, public.pattern_evidence_identities i
   where s.revision_id = r.id and r.evidence_identity_id = i.id and i.athlete_id = p_athlete_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('pattern_evidence_source_refs', v_n);
  v_total := 0;
  loop
    delete from public.pattern_evidence_revisions r
     using public.pattern_evidence_identities i
     where r.evidence_identity_id = i.id and i.athlete_id = p_athlete_id
       and not exists (select 1 from public.pattern_evidence_revisions c where c.supersedes_id = r.id);
    get diagnostics v_n = row_count; v_total := v_total + v_n; exit when v_n = 0;
  end loop;
  v_counts := v_counts || jsonb_build_object('pattern_evidence_revisions', v_total);
  v_total := 0;
  loop
    delete from public.pattern_evidence_lifecycle_transitions t
     using public.pattern_evidence_identities i
     where t.evidence_identity_id = i.id and i.athlete_id = p_athlete_id
       and not exists (select 1 from public.pattern_evidence_lifecycle_transitions c where c.supersedes_id = t.id);
    get diagnostics v_n = row_count; v_total := v_total + v_n; exit when v_n = 0;
  end loop;
  v_counts := v_counts || jsonb_build_object('pattern_evidence_lifecycle_transitions', v_total);
  delete from public.pattern_evidence_identities where athlete_id = p_athlete_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('pattern_evidence_identities', v_n);
  v_total := 0;
  loop
    delete from public.pattern_insight_reviews r
     using public.pattern_insight_identities i
     where r.insight_identity_id = i.id and i.athlete_id = p_athlete_id
       and not exists (select 1 from public.pattern_insight_reviews c where c.supersedes_id = r.id);
    get diagnostics v_n = row_count; v_total := v_total + v_n; exit when v_n = 0;
  end loop;
  v_counts := v_counts || jsonb_build_object('pattern_insight_reviews', v_total);
  delete from public.pattern_insight_identities where athlete_id = p_athlete_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('pattern_insight_identities', v_n);

  -- Decision outcomes reference decisions (RESTRICT): before the athletes cascade removes decisions.
  delete from public.decision_outcomes where athlete_id = p_athlete_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('decision_outcomes', v_n);

  -- Canonical training plans (structure children first; base-version chain leaf first).
  delete from public.training_plan_current_version where athlete_id = p_athlete_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('training_plan_current_version', v_n);
  delete from public.training_plan_planned_prescriptions p
   using public.training_plan_versions v
   where p.plan_version_id = v.id and v.athlete_id = p_athlete_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('training_plan_planned_prescriptions', v_n);
  delete from public.training_plan_generated_sessions g
   using public.training_plan_versions v
   where g.plan_version_id = v.id and v.athlete_id = p_athlete_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('training_plan_generated_sessions', v_n);
  delete from public.training_plan_weeks w
   using public.training_plan_versions v
   where w.plan_version_id = v.id and v.athlete_id = p_athlete_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('training_plan_weeks', v_n);
  delete from public.training_plan_blocks b
   using public.training_plan_versions v
   where b.plan_version_id = v.id and v.athlete_id = p_athlete_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('training_plan_blocks', v_n);
  v_total := 0;
  loop
    delete from public.training_plan_version_lifecycle_transitions t
     using public.training_plan_versions v
     where t.plan_version_id = v.id and v.athlete_id = p_athlete_id
       and not exists (select 1 from public.training_plan_version_lifecycle_transitions c where c.supersedes_id = t.id);
    get diagnostics v_n = row_count; v_total := v_total + v_n; exit when v_n = 0;
  end loop;
  v_counts := v_counts || jsonb_build_object('training_plan_version_lifecycle_transitions', v_total);
  v_total := 0;
  loop
    delete from public.training_plan_versions v
     where v.athlete_id = p_athlete_id
       and not exists (select 1 from public.training_plan_versions c where c.base_version_id = v.id);
    get diagnostics v_n = row_count; v_total := v_total + v_n; exit when v_n = 0;
  end loop;
  v_counts := v_counts || jsonb_build_object('training_plan_versions', v_total);

  -- Pilot observability rows carry the athlete id without a foreign key.
  delete from public.pilot_observability_events where athlete_id = p_athlete_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('pilot_observability_events', v_n);

  -- The athlete row: every remaining table cascades (decisions, check-ins, completed / planned sessions, …).
  delete from public.athletes where id = p_athlete_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('athletes', v_n);

  -- Verification: no row of the athlete may remain in any table carrying an athlete_id (else roll back).
  for v_table in
    select c.table_name from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'athlete_id'
  loop
    execute format('select count(*) from public.%I where athlete_id = $1', v_table) using p_athlete_id into v_left;
    if v_left > 0 then
      raise exception 'purge_athlete_account: % row(s) of the athlete remain in %', v_left, v_table;
    end if;
  end loop;

  return jsonb_build_object('athlete_id', p_athlete_id, 'deleted', v_counts);
end;
$$;

revoke all on function public.purge_athlete_account(uuid) from public;
revoke all on function public.purge_athlete_account(uuid) from anon;
revoke all on function public.purge_athlete_account(uuid) from authenticated;
grant execute on function public.purge_athlete_account(uuid) to service_role;

comment on function public.purge_athlete_account(uuid) is
  'UX-11R.1 — physical, all-or-nothing purge of one athlete (ADR UX-11B.2.1 §11). service_role only. Delete the Auth user afterwards (auth.admin.deleteUser).';
