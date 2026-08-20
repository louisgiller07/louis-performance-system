-- M5_001A — fix compute_session_load(): reset to NULL when derivation
-- inputs are incomplete.
--
-- The baseline function (20260814095000_baseline_v0_2.sql, not edited —
-- additive fix only) only ever SETS session_load when both
-- actual_duration_min and rpe are non-null. It never had an ELSE branch,
-- so an UPDATE that clears either input (e.g. rpe -> NULL) left
-- session_load at its previous, now-stale value — the NEW row image keeps
-- whatever session_load already held when the IF condition is false,
-- since no column in the SET clause of an UPDATE overwrites an untouched
-- NEW field on its own.
--
-- session_load is a derived field: it must always reflect its two real
-- inputs, in both directions. Fixed invariant:
--   actual_duration_min IS NOT NULL AND rpe IS NOT NULL
--     -> session_load = actual_duration_min * rpe / 10.0
--   otherwise
--     -> session_load = NULL
--
-- CREATE OR REPLACE FUNCTION on the existing function name is sufficient —
-- the existing trigger trg_compute_session_load (BEFORE INSERT OR UPDATE
-- ON completed_sessions, from the baseline) already calls this function by
-- name and needs no change itself.

create or replace function public.compute_session_load() returns trigger
    language plpgsql
    as $$
begin
  if new.actual_duration_min is not null and new.rpe is not null then
    new.session_load := (new.actual_duration_min * new.rpe) / 10.0;
  else
    new.session_load := null;
  end if;
  return new;
end;
$$;
