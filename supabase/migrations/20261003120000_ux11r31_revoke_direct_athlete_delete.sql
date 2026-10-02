-- UX-11R.3.1 — revoke the direct client DELETE on public.athletes (local, not pushed).
--
-- anon and authenticated held DELETE on athletes through the baseline's
-- generic GRANT ALL (V0.2 dump), filtered by the RLS policy
-- athletes_own_data. No product path uses it (static search, UX-11R.3.1):
-- every athlete deletion in code and tests goes through service_role.
-- Audit UX-11R.3: a rider without a plan could delete their own row, and
-- the ON DELETE CASCADE (run as the table owner) erased check-ins,
-- decisions, health flags and completed sessions the rider cannot delete
-- directly, leaving the auth user and pilot events orphaned.
--
-- Account deletion contract (ADR UX-11B.2.1, UX-11R.1): server purge
-- purge_athlete_account() (service_role only), then auth.admin.deleteUser.
--
-- Scope: DELETE only. SELECT, INSERT, UPDATE (web bootstrap and profile),
-- the other privileges and the RLS policies are unchanged. service_role
-- keeps DELETE; purge_athlete_account is SECURITY DEFINER and its EXECUTE
-- grant (service_role only) is unchanged.

revoke delete on public.athletes from anon, authenticated;
