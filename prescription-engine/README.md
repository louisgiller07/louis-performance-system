# prescription-engine

Sibling package to `planning-engine` and `head-coach-engine`. Resolves a
single planning-engine session (`kind` + `doseTarget`) into a concrete
exercise/drill prescription (`StrengthPrescription`/`DhTechnicalPrescription`)
by selecting from `planning-engine`'s catalogues — see
`docs/11_DECISION_LOG.md` and the V0.4_119 → V0.4_130 design/preparation
audits for the full architecture this package implements.

## Status: scaffold only (V0.4_131)

This package is currently **inert**:

- `PrescriptionRequest`/`PrescriptionResult` (the locked call contract,
  V0.4_121/122/129 §1) are declared in `src/index.ts` — no resolver logic
  exists yet.
- No strength/DH selection, no entry point assembling a `PrescriptionResult`.
- Three fields have no approved V1 source and are explicitly blocked —
  `StrengthBlock.repScheme` outside `amrap`, `StrengthBlock.restSeconds`,
  `DhDrill.executionCue` (see V0.4_124 → V0.4_127) — pending a catalogue
  extension or type change, never filled with an invented value.

## Dependency on planning-engine

Declared as a local `file:../planning-engine` dependency (V0.4_129 §4).
`planning-engine`'s catalogues (`EXERCISE_CATALOG`/`DRILL_CATALOG`), its
prescription types (`PrescriptionStructure`, `PlannedPrescription`,
`RelaxedConstraint`, ...), and `validatePrescriptionStructure` all remain
owned by `planning-engine` (V0.4_129 §2/§3) — never duplicated here.

## Boundary rules (enforced by `tests/unit/boundaries.test.ts`)

- Never imports `head-coach-engine` internals.
- Never imports `web`/React code.
- Never imports `@supabase/supabase-js` — no I/O; every exported function
  is pure and deterministic (same discipline as `planning-engine`).
- Depends on `planning-engine` by design — the only cross-package
  dependency this package has.
