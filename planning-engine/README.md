# planning-engine

Sibling package to `head-coach-engine` and `longitudinal-engine`. Owns the
canonical training-plan model for NALYNT V0.4 — see `docs/11_DECISION_LOG.md`,
"V0.4 M0 Architecture Lock" and its follow-up closure entry, for the full
architecture this package implements.

## Status: M1 — pure contracts only

This package is currently **fully inert**:

- No Supabase dependency, no network calls, no filesystem I/O beyond what
  Node/TypeScript need to run.
- No database migrations, no tables, no RPCs.
- No production wiring — nothing in `head-coach-engine`, `web`, or
  `supabase/functions` imports this package yet.
- No writes to `planned_sessions` or `training_blocks` — those projection
  contracts are designed (decision log) but not implemented.

`src/` contains only: TypeScript interfaces/types for the canonical plan
model (`types/`), versioned code-based exercise/drill registries
(`catalog/`), and pure, deterministic runtime validators (`validation/`).
`tests/fixtures/` contains the architecture-approved golden scenarios as
data, not an implementation of the planner that will eventually satisfy
them — there is no planning algorithm in this package yet.

## Boundary rules (enforced by `tests/unit/boundaries.test.ts`)

- Never imports `head-coach-engine` internals — `src/{types,engine,rules,
  domains,mapping}` there are frozen (M1 APPROVED 2026-08-13) and this
  package must never create a dependency on them.
- Never imports `web`/React code.
- Never imports `@supabase/supabase-js` (not even installed as a
  dependency) — enforced structurally, not just by convention, for as long
  as this package has no repository layer.
- Performs no I/O; every exported function is pure and deterministic.

## Catalogue versioning rules

- `EXERCISE_CATALOG_VERSION` / `DRILL_CATALOG_VERSION` are release-together
  strings (mirrors `engine_version`'s existing precedent in
  `head-coach-engine` — one version string per released artifact).
- Catalogue entry `id`s are **permanent**. A meaningful change to an entry
  ships as a *new* id; the old one is marked `deprecated: true,
  replacedBy: <newId>` and is never deleted or repurposed.
- A stored prescription's `catalog_version` field (once persistence exists)
  fixes exactly which historical version of these files to consult when
  reinterpreting it later, independent of what the catalogue looks like at
  HEAD.
