/**
 * Server-only Supabase client factory. See docs/06_ARCHITECTURE.md
 * §Adapter Supabase (M2 — actif) and docs/11_DECISION_LOG.md
 * (2026-08-13 — M2 : décisions infra, clé serveur env-only).
 *
 * No singleton: every caller builds/injects its own client, so
 * repositories and tests can pass whichever client (local dev stack,
 * future CI, a mock) they need — never a hidden global.
 *
 * Key preference order, per docs/06_ARCHITECTURE.md: the current Supabase
 * "Secret Key" (`SUPABASE_SECRET_KEY`) is preferred; the legacy
 * `SUPABASE_SERVICE_ROLE_KEY` is used as a fallback if that's what the
 * current project still relies on. Both are read from the environment
 * only — never hardcoded, never committed.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface SupabaseServerConfig {
  url: string;
  serverKey: string;
}

export class MissingSupabaseServerConfigError extends Error {
  constructor(missing: readonly string[]) {
    super(
      `Missing Supabase server configuration: ${missing.join(", ")}. ` +
        "Set SUPABASE_URL and either SUPABASE_SECRET_KEY (preferred) or " +
        "SUPABASE_SERVICE_ROLE_KEY (legacy fallback) in the environment."
    );
    this.name = "MissingSupabaseServerConfigError";
  }
}

/**
 * Reads server-only Supabase configuration from `process.env`. Throws
 * {@link MissingSupabaseServerConfigError} rather than silently falling
 * back to an empty/placeholder value.
 */
export function readSupabaseServerConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): SupabaseServerConfig {
  const url = env.SUPABASE_URL;
  const serverKey = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;

  const missing: string[] = [];
  if (!url) missing.push("SUPABASE_URL");
  if (!serverKey) missing.push("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length > 0) throw new MissingSupabaseServerConfigError(missing);

  return { url: url as string, serverKey: serverKey as string };
}

/**
 * Builds a server-only Supabase client from an explicit config. No
 * session persistence, no auth refresh — this is a stateless server
 * credential, not a browser/user session.
 */
export function createSupabaseServerClient(config: SupabaseServerConfig): SupabaseClient {
  return createClient(config.url, config.serverKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
