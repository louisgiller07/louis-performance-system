/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Tests only (VITEST is set by vitest, never by `vite`/`vite build`): let
  // drift-guard tests read sibling engine sources as ?raw (e.g. the engine's
  // signal names, UX-04). The dev server's file-serving boundary is unchanged.
  ...(process.env.VITEST ? { server: { fs: { allow: [".."] } } } : {}),
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    // Dummy, non-secret defaults so importing src/lib/supabase.ts doesn't
    // throw in tests that don't specifically exercise the config-guard
    // (which stub these to empty via vi.stubEnv instead). Vitest runs in
    // development mode, so the local-dev guard applies here too: the dummy
    // is a LOCAL, closed port — an unmocked call fails fast and never leaves
    // the machine.
    env: {
      VITE_SUPABASE_URL: 'http://127.0.0.1:54399',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    },
  },
})
