-- M2_004 — completed_sessions: représentation riche TrainingIntervention
--
-- Voir docs/05_DATA_MODEL.md §completed_sessions (audit DDL 2026-08-14,
-- M2_004 REQUIRED) et docs/11_DECISION_LOG.md.
--
-- main_content JSONB est libre, table vide, sans convention canonique
-- établie : la TrainingIntervention riche ne peut pas y vivre de façon
-- fiable. Contrairement à planned_sessions.session_type, il n'existe ici
-- aucune inversion partielle déterministe documentée pour les rows
-- legacy — une session complétée sans `intervention` reste `null`, sans
-- fallback.
--
-- Additif, non destructif :
--   - intervention JSONB NULL, sans DEFAULT.
--   - main_content, session_type, compute_session_load(),
--     trg_compute_session_load et unique_completed_per_day restent
--     strictement inchangés.
--   - Aucun backfill, aucun trigger, aucun RPC.

alter table public.completed_sessions
  add column intervention jsonb null;
