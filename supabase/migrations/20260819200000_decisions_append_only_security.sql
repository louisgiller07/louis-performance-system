-- SECURITY FIX — decisions append-only enforcement
--
-- Empirical local proof (session M4_006 hardening audit, never run against
-- any remote project) showed that the baseline's decisions_own_data policy
-- and the baseline's GRANT ALL ... TO anon/authenticated together let an
-- authenticated user directly INSERT/UPDATE/DELETE their own decisions
-- rows via PostgREST — bypassing public.persist_daily_run entirely and
-- violating the project invariant that decisions is append-only and
-- writable only through that RPC (service_role-only EXECUTE, see
-- 20260816213500_M2_006_persist_daily_run.sql).
--
-- Root cause: CREATE POLICY "decisions_own_data" ON "public"."decisions"
-- USING (...) WITH CHECK (...) has no FOR clause, which PostgreSQL treats
-- as FOR ALL — combined with the baseline's GRANT ALL ON TABLE decisions
-- TO authenticated (which includes INSERT/UPDATE/DELETE), RLS's WITH CHECK
-- happily allowed a same-athlete direct write.
--
-- Fix, in two layers (defense in depth — either alone would already
-- close the hole, both together match least-privilege):
--   1. Replace the FOR ALL policy with a SELECT-only policy for
--      authenticated, keeping the exact same ownership expression as the
--      baseline (athlete_id belongs to an athlete owned by auth.uid()) —
--      not simplified, not reinvented.
--   2. Revoke the write privileges (INSERT/UPDATE/DELETE/TRUNCATE/
--      REFERENCES/TRIGGER) directly at the grant level for authenticated,
--      and all privileges for anon (which never had a matching policy to
--      begin with, but had the same broad baseline grant).
--
-- service_role is untouched: it already has its own full grant (baseline)
-- and is the only role allowed to EXECUTE persist_daily_run (M2_006) — the
-- sole legitimate write path stays exactly as before.
--
-- A docs/11_DECISION_LOG.md entry for this fix is proposed separately, not
-- included in this migration.

drop policy if exists "decisions_own_data" on "public"."decisions";

create policy "decisions_own_select"
  on "public"."decisions"
  for select
  to authenticated
  using (
    ("athlete_id" in ( select "athletes"."id"
       from "public"."athletes"
      where ("athletes"."user_id" = "auth"."uid"())))
  );

-- Least privilege: authenticated keeps only what M4_006 (/history) needs.
revoke insert, update, delete, truncate, references, trigger
  on "public"."decisions"
  from "authenticated";

grant select on "public"."decisions" to "authenticated";

-- anon has no legitimate access to decisions at all (no anon-targeted
-- policy exists, or is added here) — revoke the baseline's broad grant
-- outright rather than leaving it unused-but-present.
revoke all privileges on "public"."decisions" from "anon";
