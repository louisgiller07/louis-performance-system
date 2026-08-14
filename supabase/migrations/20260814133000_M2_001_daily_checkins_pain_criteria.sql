-- M2_001 — daily_checkins: critères de douleur structurés (SAFETY A4)
--
-- Voir docs/05_DATA_MODEL.md §daily_checkins et docs/11_DECISION_LOG.md
-- (2026-08-13 — M2 : Option A retenue pour les champs douleur enrichis).
--
-- Additif, non destructif :
--   - boolean NULL, aucun DEFAULT
--   - NULL = inconnu sur les rows antérieures à M2 (jamais backfillé)
--   - un check-in courant M2 doit fournir explicitement true/false pour
--     les trois colonnes ; ceci est imposé par le code applicatif (adapter),
--     jamais par une contrainte SQL NOT NULL sur cette migration.

alter table public.daily_checkins
  add column pain_traumatic boolean null,
  add column pain_function_loss boolean null,
  add column pain_getting_worse boolean null;
