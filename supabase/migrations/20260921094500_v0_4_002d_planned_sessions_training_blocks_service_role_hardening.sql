-- V0.4_002D — service_role hardening: planned_sessions / training_blocks
-- (M2.5 compatibility projection).
--
-- ===========================================================================
-- Audit finding, verified by direct grep across every migration to date
-- (not assumed) — see the locked M2.5 projection migration design §E/§F
-- ===========================================================================
-- Unlike decisions / completed_sessions / health_flags — each explicitly
-- hardened in its own follow-up migration after the baseline
-- (decisions_append_only_security.sql,
-- completed_sessions_upsert_only_security.sql,
-- v0_3_006a1_health_flags_select_only_security.sql) — planned_sessions and
-- training_blocks still carry the baseline's unrestricted
-- GRANT ALL ... TO anon/authenticated/service_role, never touched by any
-- migration since. This means service_role could write either table
-- directly today, bypassing any future projection RPC entirely — exactly
-- the gap the M2.5 projection migration design flagged as needing closure
-- before that RPC is built.
--
-- ===========================================================================
-- What must be preserved — verified by direct code read before writing
-- this migration, not assumed
-- ===========================================================================
-- The production Head Coach read path (web/src/features/dailyPlan/
-- runDailyRun.ts -> the `daily-run` Edge Function -> head-coach-engine's
-- runDailyFor -> computeDailyFor -> buildRawContext ->
-- getPlannedSessionFor / getCurrentTrainingBlock) runs on a server client
-- built via head-coach-engine/src/supabase/client.ts::
-- createSupabaseServerClient, from SUPABASE_SECRET_KEY /
-- SUPABASE_SERVICE_ROLE_KEY — i.e. AS service_role, not as the athlete's
-- own authenticated client. service_role's SELECT access on both tables is
-- therefore load-bearing for production reads today and MUST be
-- preserved; only the write privileges are revoked here.
--
-- authenticated's and anon's existing grants on both tables are
-- deliberately untouched — out of scope for this migration (service_role
-- hardening only, per the locked M2.5 projection migration design; "do not
-- expand scope"). The athlete's own manual-write path to planned_sessions
-- (web/src/features/planning/planningRepo.ts::savePlannedSession, under
-- the existing planned_sessions_own_data RLS policy) is unaffected by
-- anything below.

revoke insert, update, delete, truncate, references, trigger
  on public.planned_sessions
  from service_role;

grant select on public.planned_sessions to service_role;

revoke insert, update, delete, truncate, references, trigger
  on public.training_blocks
  from service_role;

grant select on public.training_blocks to service_role;
