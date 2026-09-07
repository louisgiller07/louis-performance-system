-- V0.3_005A (NAL-001) — planned_sessions.is_committed: whether the athlete
-- genuinely intends to perform this planned activity today, as opposed to
-- a loosely-held/flexible plan.
--
-- Purely additive: no RLS/grant change (the existing FOR ALL policy
-- planned_sessions_own_data already covers every column), no other table
-- touched. NOT NULL DEFAULT FALSE means every existing row is, and stays,
-- "flexible" — the exact historical arbitration behavior (race protocol may
-- fully substitute the planned session) is preserved for every row that
-- predates this migration, with zero backfill needed beyond the default.
--
-- Consumed by head-coach-engine/src/engine/buildDailyPlan.ts via
-- RawContext.planned_session_committed (see
-- src/supabase/mapping/plannedSessionIntervention.ts) — deliberately kept
-- as planning metadata alongside `intervention`, never merged into the
-- TrainingIntervention object itself (commitment is not intervention
-- semantics — see docs/11_DECISION_LOG.md, V0.3_005A).
alter table public.planned_sessions
  add column is_committed boolean not null default false;
