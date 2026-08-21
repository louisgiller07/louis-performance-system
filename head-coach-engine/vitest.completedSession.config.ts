import { defineConfig } from "vitest/config";

// M5_003 — pure unit tests for supabase/functions/completed-session/**
// (validation.ts has zero Deno-specific code, so vitest can import it
// directly via a relative path — see validation.test.ts's own doc). No
// build step needed. Run via `npm run test:completed-session`. Kept in its
// own config/script so it never inflates the pinned `npm test` (226) or
// `npm run test:edge` (9) counts.
export default defineConfig({
  test: {
    include: ["tests/edge/completedSession/*.test.ts"],
  },
});
