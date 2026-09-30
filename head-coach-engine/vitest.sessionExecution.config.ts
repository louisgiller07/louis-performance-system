import { defineConfig } from "vitest/config";

// UX-11B.2.2 — pure unit tests for supabase/functions/session-execution/**
// (validation.ts has zero Deno-specific code, so vitest imports it directly).
// No build step needed. Run via `npm run test:session-execution`. Kept in its
// own config/script so it never changes the pinned `npm test` /
// `npm run test:edge` counts — same discipline as vitest.completedSession.config.ts.
export default defineConfig({
  test: {
    include: ["tests/edge/sessionExecution/*.test.ts"],
  },
});
