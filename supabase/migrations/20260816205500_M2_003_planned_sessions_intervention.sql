-- M2_003 — planned_sessions: représentation riche TrainingIntervention
--
-- Voir docs/05_DATA_MODEL.md §planned_sessions et docs/06_ARCHITECTURE.md
-- §Fallback d'intervention en lecture, docs/11_DECISION_LOG.md
-- (2026-08-13 — M2 : planned_sessions.intervention JSONB + planned_intent TEXT).
--
-- Additif, non destructif :
--   - intervention JSONB NULL, sans DEFAULT — TrainingIntervention riche.
--   - planned_intent TEXT NULL, sans DEFAULT — intention explicite du
--     planificateur, jamais dérivée de primary_objective ou de session_type.
--   - session_type, primary_objective et la contrainte
--     unique_planned_per_day (athlete_id, planned_date) restent strictement
--     inchangés.
--   - Aucun backfill, aucun trigger, aucun RPC.

alter table public.planned_sessions
  add column intervention jsonb null,
  add column planned_intent text null;
