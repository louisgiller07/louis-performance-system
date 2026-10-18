# PHYS-03 — compatibility demonstration with REL-01 D's own web code

This test file is NOT part of the web suite: it runs inside a throwaway checkout of REL-01 D (`649a0a2`), so that
the previous web's real decoder, day card and guided-session shell read the power documents PHYS-03 produces.
Nothing of D is modified or committed.

Reproduce (Git Bash):

    git worktree add --detach <tmp>/dcompat 649a0a2
    cd <tmp>/dcompat/web && npm ci
    mkdir -p src/zz-phys03
    cp <repo>/web/src/test/fixtures/phys03FinalPrescriptionV2.json src/zz-phys03/
    cp <repo>/docs/release/phys03-compat/*.test.tsx src/zz-phys03/
    npx vitest run src/zz-phys03

Expected: 3/3 — D's web decodes every PHYS-03 document (session-model-v2.6, family `power`), shows the whole
session block by block with the stop rule, and opens it read only in the guided shell (no set entry, completion
not possible: a degraded rollback, never an error).

The runtime side (D's `runDailyFor` on plans holding power sessions, the fatigue gap, the rollback precondition) is
`head-coach-engine/tests/supabase/phys03PreviousRuntimeCompat.integration.test.ts`, enabled by
`PHYS011_PREVIOUS_RUNTIME_ROOT=<built D checkout>`.
