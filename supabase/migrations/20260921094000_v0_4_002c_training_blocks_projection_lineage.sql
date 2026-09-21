-- V0.4_002C — training_blocks: projection lineage column (M2.5
-- compatibility projection).
--
-- Plain FK, deliberately NOT composite — an asymmetry versus
-- planned_sessions, documented rather than accidental: training_blocks
-- holds at most one meaningfully-relevant row per athlete
-- (is_current = true, enforced by the existing
-- unique_current_block_per_athlete partial unique index), always written
-- by the same future projector call that already receives athlete_id as
-- an explicit parameter. The "many rows, easy to point at the wrong one"
-- risk that justified composite FKs on the canonical tree and on
-- planned_sessions does not apply at the same scale here. See the locked
-- M2.5 projection migration design for the full trade-off — revisit only
-- if a future security review judges the residual risk material enough to
-- warrant also adding a source_plan_version_id column here purely to
-- enable a composite FK.
--
-- ON DELETE SET NULL: same purge-safety reasoning as planned_sessions.
-- NULL means "not projector-owned" — either a legacy/admin/seed row never
-- touched by the projector, or a formerly-projected row whose lineage was
-- cleared by a future purge.
--
-- Does not interact with unique_current_block_per_athlete or is_current
-- behavior in any way — this column and that index are fully orthogonal.
-- No index added on source_plan_block_id itself: training_blocks has no
-- range/scan access pattern to serve (single relevant row per athlete).

alter table public.training_blocks
  add column source_plan_block_id uuid null;

alter table public.training_blocks
  add constraint training_blocks_source_plan_block_fk
    foreign key (source_plan_block_id)
    references public.training_plan_blocks (id)
    on delete set null;
