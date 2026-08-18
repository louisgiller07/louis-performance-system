// Client-side Supabase client — only ever holds a public key (publishable
// or legacy anon). Never import a secret/service_role key here: everything
// in this module ends up in the browser bundle.
import { createClient } from "@supabase/supabase-js";

export class MissingSupabaseConfigError extends Error {
  constructor(missing: string) {
    super(
      `Missing Supabase configuration: ${missing}. Copy web/.env.example to web/.env.local and fill in ` +
        "VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY as a legacy fallback)."
    );
    this.name = "MissingSupabaseConfigError";
  }
}

export function resolvePublicKey(env: ImportMetaEnv): string {
  // Preferred: the new sb_publishable_* key. Fallback: the legacy anon JWT
  // key, for projects where the new key format isn't accepted yet. Both are
  // public/client-safe by design — never a secret or service_role key.
  const publishable = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (publishable) return publishable;

  const legacyAnon = env.VITE_SUPABASE_ANON_KEY;
  if (legacyAnon) return legacyAnon;

  throw new MissingSupabaseConfigError("VITE_SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_ANON_KEY");
}

const url = import.meta.env.VITE_SUPABASE_URL;
if (!url) throw new MissingSupabaseConfigError("VITE_SUPABASE_URL");

const publicKey = resolvePublicKey(import.meta.env);

export const supabase = createClient(url, publicKey);
