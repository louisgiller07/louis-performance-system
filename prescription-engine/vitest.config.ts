import { defineConfig } from "vitest/config";

// Same reasoning as planning-engine/vitest.config.ts: no Supabase/network
// I/O and no shared external resource at this layer, so default
// parallelism is safe and left on.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
