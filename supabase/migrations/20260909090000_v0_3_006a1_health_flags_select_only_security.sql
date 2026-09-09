-- V0.3_006A1 — health_flags select-only enforcement (Safety-integrity hardening)
--
-- Investigation finding (V0.3_006A, docs/11_DECISION_LOG.md): the baseline's
-- health_flags_own_data policy has no FOR clause (== FOR ALL), combined with
-- the baseline's GRANT ALL ON TABLE health_flags TO anon/authenticated. A5
-- (rules/safety.ts) consumes only open ('active'/'monitoring') flags — an
-- authenticated athlete could therefore directly UPDATE their own
-- concussion_suspect row to status='resolved' via PostgREST, silently
-- clearing A5 Safety follow-up outside any product workflow. Same shape as
-- 20260819200000_decisions_append_only_security.sql — mirrored here, not
-- reinvented.
--
-- Fix, in two layers (defense in depth):
--   1. Replace the FOR ALL policy with a SELECT-only policy for
--      authenticated, keeping the exact same ownership expression as the
--      baseline.
--   2. Revoke INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER directly at
--      the grant level for authenticated, and all privileges for anon.
--
-- service_role is untouched: it already has its own full grant (baseline)
-- and persist_daily_run (M2_006, SECURITY INVOKER, EXECUTE granted only to
-- service_role) is called exclusively via ctx.supabaseAdmin from
-- supabase/functions/daily-run/index.ts — the sole legitimate write path
-- stays exactly as before. No column, enum, or index change — health_flags
-- schema, health_flag_status/health_flag_type enums, and the
-- health_flags_open_unique partial index are all untouched.

drop policy if exists "health_flags_own_data" on "public"."health_flags";

create policy "health_flags_own_select"
  on "public"."health_flags"
  for select
  to authenticated
  using (
    ("athlete_id" in ( select "athletes"."id"
       from "public"."athletes"
      where ("athletes"."user_id" = "auth"."uid"())))
  );

-- Least privilege: authenticated keeps only read access to its own flags
-- (needed by the new V0.3_006A1 read-only Today banner).
revoke insert, update, delete, truncate, references, trigger
  on "public"."health_flags"
  from "authenticated";

grant select on "public"."health_flags" to "authenticated";

-- anon has no legitimate access to health_flags at all — revoke the
-- baseline's broad grant outright rather than leaving it unused-but-present.
revoke all privileges on "public"."health_flags" from "anon";
