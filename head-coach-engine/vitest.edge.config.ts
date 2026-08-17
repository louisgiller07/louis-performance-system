import { defineConfig } from "vitest/config";

// Run via `npm run test:edge`, which builds first — these tests import
// head-coach-engine/dist/**, never present on a clean clone.
export default defineConfig({
  test: {
    include: ["tests/edge/**/*.test.ts"],
  },
});
