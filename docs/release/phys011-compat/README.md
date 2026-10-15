# PHYS-01.1 — compatibility demonstration with REL-01 D's own web code

These two test files are NOT part of the PHYS-01 web suite: they run inside a throwaway checkout of
REL-01 D (`649a0a2`), so that the previous web's real decoder, day card and guided Force module read the
documents PHYS-01.1 produces. Nothing of D is modified or committed.

Reproduce (Git Bash):

    git worktree add --detach <tmp>/dcompat 649a0a2
    cd <tmp>/dcompat/web && npm ci
    mkdir -p src/zz-phys011
    cp <phys01>/web/src/test/fixtures/phys01FinalPrescriptionV2.json src/zz-phys011/
    git -C <phys01> show 5ec0976:web/src/test/fixtures/phys01FinalPrescriptionV2.json > src/zz-phys011/phys01v27.json
    cp <phys01>/docs/release/phys011-compat/*.test.ts* src/zz-phys011/
    npx vitest run src/zz-phys011

Expected: 5/5 — D's web decodes every PHYS-01.1 document (cool-down shown, load guidance ignored,
guided module running, work sets counted from main / complementary only), and refuses the first PHYS-01
documents (session-model-v2.7): the counter-proof of the format decision.

The Edge side (D's `runDailyFor` on PHYS-01.1 data, both directions) is
`head-coach-engine/tests/supabase/phys011PreviousRuntimeCompat.integration.test.ts`, enabled by
`PHYS011_PREVIOUS_RUNTIME_ROOT=<built D checkout>`.
