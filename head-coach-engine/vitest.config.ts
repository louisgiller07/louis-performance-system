import { defineConfig } from "vitest/config";

// tests/edge/** imports compiled output from dist/ (gitignored, produced by
// `npm run build`) because it must exercise the exact class identity the
// Edge Function boundary checks with `instanceof` (see
// supabase/functions/daily-run/errorMapping.ts) — importing the TS source
// instead would load a second, distinct copy of each error class and
// silently break every instanceof check. Excluded here so a clean clone can
// run `npm test` with zero prior build step; run via `npm run test:edge`.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "tests/edge/**"],
  },
});
