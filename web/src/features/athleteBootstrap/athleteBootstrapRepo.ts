// V0.3_004B — self-provisioning of the caller's own athletes row. The
// authenticated user's own Supabase client only (RLS policy
// athletes_own_data's WITH CHECK (user_id = auth.uid()) is the sole
// authority on which user_id a row can belong to) — never a
// service/secret key, never an Edge Function. Mirrors checkinRepo.ts's
// pattern exactly.
import { supabase } from "../../lib/supabase";

export class AthleteBootstrapError extends Error {
  constructor() {
    super("Impossible de créer ton profil athlète. Réessaie dans un instant.");
    this.name = "AthleteBootstrapError";
  }
}

/**
 * Creates the athlete row for `userId` with `name`. `userId` is sent as
 * part of the insert payload but is never authoritative on its own — RLS
 * independently rejects any insert where `user_id !== auth.uid()`, so a
 * caller can never provision a row for someone else no matter what id is
 * passed here. Every other column (`id`, `nationality`, `current_stage`,
 * `discipline`, `created_at`, `updated_at`) is left to its DB default —
 * deliberately not written here.
 */
export async function createOwnAthlete(userId: string, name: string): Promise<void> {
  const { error } = await supabase.from("athletes").insert({ user_id: userId, name });

  if (error) {
    // Generic + error code only — never the raw PostgREST message in a
    // browser console (matches checkinRepo.ts/planningRepo.ts). Includes
    // the expected UNIQUE(user_id) violation on a concurrent/duplicate
    // attempt — the caller is responsible for re-resolving athlete state
    // before treating this as fatal (see AthleteBootstrap.tsx).
    console.error("athleteBootstrapRepo.createOwnAthlete failed", error.code);
    throw new AthleteBootstrapError();
  }
}
