import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Every tests/supabase/** file shares ONE local Postgres instance. With
    // the default file-level parallelism, DDL in
    // patternEvidenceSchema.integration.test.ts's atomic-rollback
    // fault-injection test (CREATE/DROP TRIGGER on
    // pattern_evidence_source_refs, which requires an ACCESS EXCLUSIVE lock)
    // can queue behind concurrent INSERT traffic from sibling integration
    // files writing to the SAME table at the same time. That wait happens
    // inside a synchronous, thread-blocking spawnSync call (runPsqlChecked)
    // — vitest's own per-test JS timeout cannot fire while the thread is
    // blocked in native code, so the wait is effectively unbounded from
    // vitest's perspective. If anything external then kills the hung
    // process (a CI job budget, an interrupted local run), the orphaned
    // docker-exec child can go on to finish installing the fault trigger
    // with no JS code left alive to ever call cleanup — a real, reproduced
    // failure mode (see docs/11_DECISION_LOG.md, M5_006B hardening entry).
    // Serializing file execution removes the race at its source: no two
    // tests/supabase/** files ever write to the DB at the same time.
    fileParallelism: false,
  },
});
