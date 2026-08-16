-- M2_002 — decisions: persistance du DailyPlan M2
--
-- Voir docs/05_DATA_MODEL.md §decisions et docs/11_DECISION_LOG.md
-- (2026-08-13 — M2 : decisions.daily_plan JSONB + active_mode NULL sur legacy ;
--  2026-08-14 — M2 : confidence_level intégré dans M2_002, pas de M2_007).
--
-- Additif, non destructif :
--   - daily_plan JSONB NULL, sans DEFAULT — source de vérité du DailyPlan M2.
--   - active_mode training_mode NULL, sans DEFAULT — projection SQL du mode actif.
--   - confidence_level : nouvel enum PostgreSQL dédié ('LOW','MEDIUM','HIGH'),
--     colonne NULL sans DEFAULT. La confidence qualitative M1 (LOW/MEDIUM/HIGH)
--     y est écrite verbatim par le DAL, jamais convertie en nombre.
--   - La colonne legacy decisions.confidence numeric(3,2) (CHECK 0..1) N'EST
--     PAS modifiée : reste strictement intacte, jamais écrite par M2.
--   - Aucun backfill, aucun trigger, aucun RPC, aucune contrainte unique.

create type public.confidence_level as enum (
  'LOW',
  'MEDIUM',
  'HIGH'
);

alter table public.decisions
  add column daily_plan jsonb null,
  add column active_mode public.training_mode null,
  add column confidence_level public.confidence_level null;
