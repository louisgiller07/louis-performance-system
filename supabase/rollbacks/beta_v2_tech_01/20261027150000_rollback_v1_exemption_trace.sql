-- BETA-V2-TECH-01 — ROLLBACK of 20261027150000_beta_v2_tech_01_v1_exemption_trace.sql (candidate, local only).
-- Drops the two check constraints. Keeps the decided_by column and its values: who decided each exemption is
-- history, never deleted (a re-application reuses the column: add column if not exists). No code to roll back: the
-- Edge function reads planning_model only. One explicit transaction (any error rolls everything back).
begin;

alter table public.training_plan_model_assignments
  drop constraint if exists training_plan_model_assignments_v1_exemption_traced;
alter table public.training_plan_model_assignments
  drop constraint if exists training_plan_model_assignments_decided_by_length;

commit;
