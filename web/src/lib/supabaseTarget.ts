// Local development safety: a frontend running in development mode (vite dev
// server, vitest) must never talk to a remote Supabase project by accident —
// a local .env pointing at a hosted project would otherwise silently write
// real data from a developer's machine. Checked before the client is created.
// The rule is general (any non-local host), not a production-hostname list.
// A remote backend in development needs an explicit opt-in:
// VITE_ALLOW_REMOTE_SUPABASE_IN_DEV=true. Production builds (DEV false) are
// never blocked by this guard.

export const REMOTE_SUPABASE_IN_DEV_MESSAGE =
  "Le frontend est lancé en mode développement avec un backend Supabase distant. Configuration refusée par sécurité.";

export class RemoteSupabaseInDevError extends Error {
  constructor(host: string) {
    super(
      `${REMOTE_SUPABASE_IN_DEV_MESSAGE} (hôte : ${host}). Utilise le Supabase local (VITE_SUPABASE_URL=http://127.0.0.1:54321, voir web/.env.example) ` +
        "ou, en connaissance de cause, VITE_ALLOW_REMOTE_SUPABASE_IN_DEV=true."
    );
    this.name = "RemoteSupabaseInDevError";
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLocalSupabaseUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return LOCAL_HOSTS.has(host) || host.endsWith(".localhost");
}

export interface SupabaseTargetEnv {
  DEV: boolean;
  VITE_SUPABASE_URL: string;
  VITE_ALLOW_REMOTE_SUPABASE_IN_DEV?: string;
}

/** Throws RemoteSupabaseInDevError when development mode targets a non-local Supabase without the explicit opt-in. */
export function assertSupabaseTargetAllowed(env: SupabaseTargetEnv): void {
  if (!env.DEV) return;
  if (isLocalSupabaseUrl(env.VITE_SUPABASE_URL)) return;
  if (env.VITE_ALLOW_REMOTE_SUPABASE_IN_DEV === "true") return;
  let host = "URL invalide";
  try {
    host = new URL(env.VITE_SUPABASE_URL).hostname;
  } catch {
    /* keep the generic label */
  }
  throw new RemoteSupabaseInDevError(host);
}
