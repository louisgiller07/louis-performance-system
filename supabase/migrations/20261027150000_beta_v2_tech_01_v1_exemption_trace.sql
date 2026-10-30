-- BETA-V2-TECH-01 — V1 exemptions traced (HPM 2026-10-29, V2 INTEGRATION PREPARATION; CANDIDATE, local only).
--
-- Since BETA-V2-TECH-01 B the assignment IS the authorisation to generate: no row → 403 beta_access_not_granted,
-- never V1 by default. A 'v1' row is an explicit exemption, reserved for test accounts: from now on it must state
-- its reason (note) and the administrator who decided it (decided_by). 'v2' rows are unchanged (both optional).
--
-- Additive: one nullable column, two check constraints. No row written, no code change: the Edge function still
-- reads planning_model only, and the table stays service_role only (RLS without policy, unchanged).
--
-- Existing rows are never rewritten nor given an invented author. The trace constraint is added NOT VALID, so it
-- applies at once to every new or updated row, then validated here only when no existing 'v1' row lacks a reason
-- or an author. Otherwise it stays NOT VALID and this migration says so (NOTICE): the release stops until the
-- operator traces each listed row with the real decision (GO Louis) and runs the VALIDATE statement below.
-- Inventory and checks (read-only): docs/review/beta-v2-tech-01/V1_EXEMPTION_PREFLIGHT_READONLY.sql and
-- V1_EXEMPTION_POSTCHECK_READONLY.sql.
-- Rollback: supabase/rollbacks/beta_v2_tech_01/20261027150000_rollback_v1_exemption_trace.sql.

alter table public.training_plan_model_assignments
  add column if not exists decided_by text;

alter table public.training_plan_model_assignments
  add constraint training_plan_model_assignments_decided_by_length
    check (decided_by is null or (length(trim(decided_by)) > 0 and char_length(decided_by) <= 200)),
  add constraint training_plan_model_assignments_v1_exemption_traced
    check (planning_model <> 'v1' or (note is not null and decided_by is not null)) not valid;

comment on column public.training_plan_model_assignments.decided_by is
  'BETA-V2-TECH-01: the administrator who decided the assignment; required with a reason (note) for every v1 exemption (test accounts only).';

do $validate$
declare
  v_untraced bigint;
begin
  select count(*) into v_untraced
    from public.training_plan_model_assignments
   where planning_model = 'v1' and (note is null or decided_by is null);
  if v_untraced = 0 then
    alter table public.training_plan_model_assignments
      validate constraint training_plan_model_assignments_v1_exemption_traced;
  else
    raise notice 'training_plan_model_assignments_v1_exemption_traced left NOT VALID: % v1 assignment(s) without a reason or an author. Trace each one with the real decision (GO Louis), then run: alter table public.training_plan_model_assignments validate constraint training_plan_model_assignments_v1_exemption_traced;', v_untraced;
  end if;
end
$validate$;
