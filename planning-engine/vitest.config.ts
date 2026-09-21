import { defineConfig } from "vitest/config";

// M1 has no Supabase/network I/O and no shared external resource, so unlike
// longitudinal-engine's vitest.config.ts (which serializes file execution to
// avoid contention on one shared local Postgres instance across integration
// tests), there is nothing here for parallel test files to contend over —
// default parallelism is safe and left on.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
