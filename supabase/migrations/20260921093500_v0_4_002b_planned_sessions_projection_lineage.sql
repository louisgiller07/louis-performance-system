-- V0.4_002B — planned_sessions: projection lineage columns (M2.5
-- compatibility projection). Two nullable columns recording which
-- canonical plan content a 'generated' row currently mirrors — written
-- only by the future projection RPC (not built in this batch), never by
-- the athlete's existing manual-save path: planningRepo.ts::
-- savePlannedSession's upsert payload never includes either column, so
-- Supabase's upsert leaves whatever value is already there untouched —
-- the same "omit and preserve" semantics already documented and tested for
-- the table's five existing engine-inert columns.
--
-- ===========================================================================
-- Composite FKs, not plain — same discipline as the M2 canonical tree
-- ===========================================================================
-- RLS is not a sufficient guarantee here (service_role bypasses it), so
-- referential integrity is enforced structurally instead, exactly as the
-- M2 persistence closure already established for the canonical tree
-- itself. planned_sessions.athlete_id already exists, and
-- training_plan_versions already exposes UNIQUE(id, athlete_id) (M2) —
-- reused verbatim rather than duplicated.
--
-- ON DELETE SET NULL (not RESTRICT) on both: planned_sessions is a live,
-- athlete-owned mutable table, not part of the immutable canonical tree —
-- it must never block a future purge of canonical content, and losing the
-- lineage pointer degrades gracefully (the row's actual content —
-- session_type/intervention — is fully self-contained regardless).
--
-- planned_sessions_source_plan_version_fk uses the PG15+ column-restricted
-- form, ON DELETE SET NULL (source_plan_version_id) — not the bare
-- ON DELETE SET NULL originally approved. Found empirically (disposable
-- Postgres 17, M2.5 migration validation): without a column-list
-- restriction, Postgres' SET NULL action nulls EVERY referencing column in
-- a composite FK, not just the lineage one — and athlete_id, needed here
-- for the same cross-athlete protection as every other composite FK in
-- this schema, is NOT NULL on planned_sessions. The bare form therefore
-- made the referenced training_plan_versions row permanently undeletable
-- while any planned_sessions row pointed at it (a hard failure, not a
-- graceful degradation), defeating the entire purpose of choosing SET NULL
-- over RESTRICT. The column-restricted form (available since PG15;
-- supabase/config.toml targets major_version = 17) nulls only
-- source_plan_version_id, leaving athlete_id untouched, while the FK's own
-- cross-athlete check at INSERT/UPDATE time is completely unaffected by
-- this restriction — verified empirically, see the migration correction
-- validation. planned_sessions_source_generated_session_fk needs no such
-- restriction: both of its referencing columns (source_generated_session_id,
-- source_plan_version_id) are nullable, so the bare form was already correct
-- there and is left unchanged.
--
-- ===========================================================================
-- The CHECK below — closing a real MATCH SIMPLE gap
-- ===========================================================================
-- Under Postgres' default MATCH SIMPLE, a composite FK is satisfied
-- whenever ANY of its referencing columns is NULL — so the composite FK on
-- (source_generated_session_id, source_plan_version_id) alone would NOT
-- catch "session id set, version id null", a nonsensical half-lineage
-- state. This CHECK closes exactly that gap.
--
-- Deliberately NOT adding the stronger constraint
-- "source = 'generated' -> both lineage columns NOT NULL": that would
-- conflict with the SET NULL behavior above. A future purge clearing
-- source_plan_version_id/source_generated_session_id on an old
-- 'generated' row (with no reason to also rewrite `source`) would violate
-- that stronger constraint and make the purge itself fail. The weaker,
-- one-directional CHECK below is what can actually be enforced safely.
--
-- No new indexes: the existing idx_planned_sessions_date
-- (athlete_id, planned_date DESC) already serves the projector's own
-- access pattern (a per-athlete date-range scan); neither
-- source_plan_version_id nor source_generated_session_id has any named
-- query consumer of its own today — see the locked M2.5 projection
-- migration design §D. Not adding one speculatively.

alter table public.planned_sessions
  add column source_plan_version_id uuid null,
  add column source_generated_session_id uuid null;

alter table public.planned_sessions
  add constraint planned_sessions_source_plan_version_fk
    foreign key (source_plan_version_id, athlete_id)
    references public.training_plan_versions (id, athlete_id)
    on delete set null (source_plan_version_id);

alter table public.planned_sessions
  add constraint planned_sessions_source_generated_session_fk
    foreign key (source_generated_session_id, source_plan_version_id)
    references public.training_plan_generated_sessions (id, plan_version_id)
    on delete set null;

alter table public.planned_sessions
  add constraint planned_sessions_generated_session_requires_version
    check (source_generated_session_id is null or source_plan_version_id is not null);
