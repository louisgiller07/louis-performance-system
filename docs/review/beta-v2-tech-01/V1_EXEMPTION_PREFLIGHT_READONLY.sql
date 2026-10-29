-- BETA-V2-TECH-01 — V1 exemptions: inventory BEFORE migration 20261027150000, READ ONLY (no write, no lock beyond a read).
-- Run in the Supabase SQL Editor of the target project, with Louis's GO. A failing query is NOT a zero: report the error.
--
-- Part A (shareable: counters and booleans only, no rider id).
-- Expected before the migration: 0 = on; 1 = false (no decided_by column yet); 2 to 5 = the inventory.
--  - 2 > 0: decided_by is a new column, so EVERY one of these v1 rows lacks an author right after the migration (3 is
--    the subset that also lacks a reason). The migration still succeeds, the trace constraint stays NOT VALID, and the
--    release stops before the deployment of generate-training-plan until each row is traced with the real decision
--    (GO Louis), VALIDATE has run and V1_EXEMPTION_RELEASE_GATE_READONLY.sql answers GO. Never invent an author.
--  - 5: athletes WITHOUT any assignment. After BETA-V2-TECH-01 B they can no longer generate a plan (403); each needs
--    an explicit decision (v2 for a pilot, traced v1 for a test account) before the Edge deployment.
set transaction read only;
set local statement_timeout = '30s';
select
  current_setting('transaction_read_only') as "0_read_only",
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'training_plan_model_assignments' and column_name = 'decided_by') as "1_decided_by_present",
  (select count(*) from public.training_plan_model_assignments where planning_model = 'v1') as "2_v1_rows",
  (select count(*) from public.training_plan_model_assignments where planning_model = 'v1' and note is null) as "3_v1_rows_without_reason",
  (select count(*) from public.training_plan_model_assignments where planning_model = 'v2') as "4_v2_rows",
  (select count(*) from public.athletes a
    where not exists (select 1 from public.training_plan_model_assignments t where t.athlete_id = a.id)) as "5_athletes_without_assignment";

-- Part B (operator only, NOT shareable: athlete ids). The v1 rows to trace, and the athletes without any assignment.
-- select athlete_id, note, created_at, updated_at from public.training_plan_model_assignments where planning_model = 'v1' order by created_at;
-- select a.id, a.created_at from public.athletes a where not exists (select 1 from public.training_plan_model_assignments t where t.athlete_id = a.id) order by a.created_at;
