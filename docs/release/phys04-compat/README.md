# PHYS-04 — compatibility demonstration with REL-01 D's own web code

This test file is NOT part of the web suite: it runs inside a throwaway checkout of REL-01 D (`649a0a2`), so that
the previous web's real decoder, day card and guided-session shell read the documents PHYS-04 produces (mobility
routine, bodyweight Force with repetitions guidance). Nothing of D is modified or committed.

Reproduce (Git Bash):

    git worktree add --detach <tmp>/dcompat 649a0a2
    cd <tmp>/dcompat/web && npm ci
    mkdir -p src/zz-phys04
    cp <repo>/web/src/test/fixtures/phys04FinalPrescriptionV2.json src/zz-phys04/
    cp <repo>/docs/release/phys04-compat/*.test.tsx src/zz-phys04/
    npx vitest run src/zz-phys04

Expected: 3/3 — D's web decodes every PHYS-04 document (session-model-v2.6, families `mobility` and `strength`),
ignores the repetitions guidance, shows the whole routine, opens it read only in the guided shell (completion not
possible: a degraded rollback, never an error) and runs the bodyweight Force session as before.

The runtime side (D's `runDailyFor` on plans holding mobility sessions, A10, manual refusal, bodyweight days, the
rollback precondition) is `head-coach-engine/tests/supabase/phys04PreviousRuntimeCompat.integration.test.ts`, enabled
by `PHYS011_PREVIOUS_RUNTIME_ROOT=<built D checkout>`.
