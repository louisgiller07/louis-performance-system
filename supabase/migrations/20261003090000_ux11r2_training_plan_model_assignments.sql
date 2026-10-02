-- UX-11R.2 — server-side planning model assignment for the V2 rollout (local, not pushed).
--
-- The planning model (v1 | v2) of a NEW training plan generation is decided
-- on the server only:
--   global switch NALYNT_V2_PLAN_GENERATION_ENABLED (Edge secret) is not
--   exactly "true"                           → v1 for everyone;
--   switch on, no row for the athlete         → v1 (default);
--   switch on, row planning_model = 'v1'      → v1 (explicit individual rollback);
--   switch on, row planning_model = 'v2'      → v2.
-- The assignment never governs daily-run, final prescriptions, guided
-- sessions or executions: those follow the data already persisted.
--
-- Server configuration only: RLS enabled without any policy, every
-- privilege revoked from anon and authenticated (the browser can neither
-- read nor change an assignment); read / written by service_role (Edge
-- server context, operator). No row is inserted: the migration assigns
-- NOBODY to v2.
--
-- Purge (UX-11R.1): FK ON DELETE RESTRICT, so an athlete is only removed
-- through purge_athlete_account(), redefined below to delete the
-- assignment explicitly (otherwise identical to migration 20261002120000,
-- left unchanged).
--
-- Additive: one new table, one function redefined.

create table public.training_plan_model_assignments (
  athlete_id uuid primary key references public.athletes (id) on delete restrict,
  planning_model text not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_plan_model_assignments_planning_model_values check (planning_model in ('v1', 'v2')),
  constraint training_plan_model_assignments_note_length check (note is null or (length(trim(note)) > 0 and char_length(note) <= 500))
);

comment on table public.training_plan_model_assignments is
  'UX-11R.2 — server-only rollout assignment of the planning model used by the NEXT plan generation (no row = v1; v2 only while NALYNT_V2_PLAN_GENERATION_ENABLED=true). Never read by the browser.';

create trigger trg_training_plan_model_assignments_updated_at
  before update on public.training_plan_model_assignments
  for each row execute function public.set_updated_at();

alter table public.training_plan_model_assignments enable row level security;
revoke all privileges on public.training_plan_model_assignments from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.training_plan_model_assignments to service_role;

-- ---------------------------------------------------------------------------
-- purge_athlete_account — + training_plan_model_assignments
-- ---------------------------------------------------------------------------

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

  -- UX-11R.2 — the athlete's server-side planning model assignment (FK RESTRICT: removed explicitly here).
  delete from public.training_plan_model_assignments where athlete_id = p_athlete_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('training_plan_model_assignments', v_n);

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
