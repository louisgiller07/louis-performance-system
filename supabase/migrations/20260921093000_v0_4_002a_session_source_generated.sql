-- V0.4_002A — session_source: add 'generated' value (M2.5 compatibility
-- projection). Isolated migration, single statement only — mirrors the
-- exact precedent of 20260904090000_v0_3_004c_training_mode_unspecified.sql
-- (a lone ALTER TYPE ... ADD VALUE, nothing else in the same migration), to
-- respect Postgres' restrictions on using a newly added enum value inside
-- the same transaction that adds it.
--
-- Purely additive: the existing 'rule'/'manual'/'template' values and the
-- column's own DEFAULT 'manual' are untouched. Confirmed by direct code
-- audit (M2.5 projection architecture, Phase 0) that
-- planned_sessions.source is never selected by head-coach-engine's read
-- path (plannedSessionsRepo.ts::getPlannedSessionFor selects only
-- session_type, intervention, planned_intent, is_committed) and is
-- unconditionally overwritten to 'manual' by the athlete's own save path
-- (web/src/features/planning/planningRepo.ts::savePlannedSession) — this
-- addition cannot affect either.

alter type public.session_source add value 'generated';
