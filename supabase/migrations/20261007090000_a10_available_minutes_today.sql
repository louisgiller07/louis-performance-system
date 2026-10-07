-- A10 — the rider's time today: an explicit, structured check-in field.
--
-- Voir docs/05_DATA_MODEL.md §daily_checkins et docs/11_DECISION_LOG.md
-- (2026-10-07 — ADR A10).
--
-- Additif, non destructif :
--   - integer NULL, aucun DEFAULT, jamais backfillé ;
--   - NULL = aucune contrainte de temps exceptionnelle ce jour-là
--     (comportement historique) ;
--   - sinon un nombre entier positif de minutes (au plus une journée).
-- Distinct des disponibilités hebdomadaires (athlete_availability_windows,
-- BUG-V2-1) : celles-ci disent quand le rider peut normalement s'entraîner,
-- ce champ dit combien de temps il a réellement aujourd'hui. Jamais déduit du
-- commentaire libre.
--
-- Écrit par le web avec le check-in (RLS daily_checkins_own_data inchangée),
-- lu par le chemin daily V2 avec la version du check-in de la décision.

alter table public.daily_checkins
  add column available_minutes_today integer null;

alter table public.daily_checkins
  add constraint daily_checkins_available_minutes_today_check
  check (available_minutes_today is null or (available_minutes_today >= 1 and available_minutes_today <= 1440));
