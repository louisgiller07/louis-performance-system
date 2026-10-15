# PHYS-02 — compatibility demonstration with REL-01 D's own web code

This test file is NOT part of the PHYS-02 web suite: it runs inside a throwaway checkout of REL-01 D
(`649a0a2`), so that the previous web's real decoder, day card and guided endurance module read the
documents PHYS-02 produces. Nothing of D is modified or committed.

Reproduce (Git Bash):

    git worktree add --detach <tmp>/dcompat 649a0a2
    cd <tmp>/dcompat/web && npm ci
    mkdir -p src/zz-phys02
    cp <phys02>/web/src/test/fixtures/phys02FinalPrescriptionV2.json src/zz-phys02/
    cp <phys02>/docs/release/phys02-compat/*.test.tsx src/zz-phys02/
    npx vitest run src/zz-phys02

Expected: 3/3 — D's web decodes every PHYS-02 / PHYS-02.1 document (including the LIGHT-day base endurance fallback) (session-model-v2.6, no format change), shows the
intervals block by block (warm-up, 6 work blocks with RPE 8, 5 easy blocks, cool-down), ignores the
endurance guidance, and its guided endurance module records the activity of an intervals session.

The runtime side (D's `runDailyFor` and planner on PHYS-02 data, both directions, and the rollback hazard
that keeps the intervals option off) is
`head-coach-engine/tests/supabase/phys02PreviousRuntimeCompat.integration.test.ts`, enabled by
`PHYS011_PREVIOUS_RUNTIME_ROOT=<built D checkout>`.
