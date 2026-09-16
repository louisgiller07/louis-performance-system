/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  // V0.3.009 — Simulation Lab. UX-only guard (shows a refusal message
  // instead of the lab UI for the wrong athlete) — NEVER the real security
  // boundary. The actual enforcement lives server-side: RLS on every table
  // write, and the simulation-reset Edge Function's own athlete_id check
  // against its own (server-only) secret. Not sensitive to expose in the
  // client bundle — knowing this UUID grants no access on its own.
  readonly VITE_SIMULATION_ATHLETE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
