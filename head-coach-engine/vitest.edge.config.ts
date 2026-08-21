import { defineConfig } from "vitest/config";

// Run via `npm run test:edge`, which builds first — these tests import
// head-coach-engine/dist/**, never present on a clean clone. Scoped to this
// exact file (not a `tests/edge/**` glob): other suites under tests/edge/**
// (e.g. completedSession/) need no dist build and run through their own
// dedicated config instead — see vitest.completedSession.config.ts. Keeping
// this include narrow keeps `test:edge`'s count pinned to exactly this
// file's tests, unaffected by whatever else gets added under tests/edge/**.
export default defineConfig({
  test: {
    include: ["tests/edge/errorMapping.test.ts"],
  },
});
