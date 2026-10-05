import { defineConfig } from "vitest/config";

// Run via `npm run test:edge`, which builds first (incl. the generate-training-plan
// Edge bundle, PILOT_015) — these tests import
// head-coach-engine/dist/**, never present on a clean clone. Scoped to these
// exact files (not a `tests/edge/**` glob): other suites under tests/edge/**
// (e.g. completedSession/) need no dist build and run through their own
// dedicated config instead — see vitest.completedSession.config.ts. Keeping
// this include narrow keeps `test:edge`'s count pinned to exactly these
// files' tests, unaffected by whatever else gets added under tests/edge/**.
export default defineConfig({
  test: {
    include: [
      "tests/edge/errorMapping.test.ts",
      "tests/edge/generateTrainingPlanErrorMapping.test.ts",
      // UX-11R.9 — accept-training-plan: stale_plan_version mapped by SQLSTATE only.
      "tests/edge/acceptTrainingPlanErrorMapping.test.ts",
      // UX-11A.5b.2.1 — session-execution request validation and stable
      // rejection codes (invalid_prescribed_measure, …). Pure TypeScript,
      // imported from supabase/functions/session-execution/validation.ts.
      "tests/edge/sessionExecution/**/*.test.ts",
      // UX-11A.5c.3.1 — the daily-run V2 Deno bundle runs the same source as Node.
      "tests/edge/dailyRunV2Bundle.test.ts",
      // Harness safety — the HTTP harnesses only clean up an Edge runtime they started.
      "tests/edge/http/functionsRuntime.test.ts",
    ],
  },
});
