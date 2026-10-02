/**
 * UX-11R.1 — account deletion = explicit PHYSICAL purge (ADR UX-11B.2.1 §11).
 *
 * Server-side only (service-role client): reads the athlete's Auth user id,
 * purges every application row of the athlete in one all-or-nothing
 * transaction (`purge_athlete_account`, which lifts the append-only
 * protection only inside that transaction), THEN deletes the Auth identity
 * through the Auth admin API. The order matters: `athletes.user_id`
 * cascades from `auth.users`, so deleting the Auth user first would hit the
 * RESTRICT foreign keys and append-only ledgers and fail.
 *
 * If the Auth deletion fails after a successful purge, no application data
 * remains; calling the Auth deletion again is the recovery.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export class AthletePurgeError extends Error {
  readonly stage: "lookup" | "purge" | "auth";
  constructor(stage: "lookup" | "purge" | "auth", detail: string) {
    super(`athlete purge failed at ${stage}: ${detail}`);
    this.name = "AthletePurgeError";
    this.stage = stage;
  }
}

export interface AthletePurgeResult {
  athleteId: string;
  /** Rows deleted per table by the purge (cascaded tables are covered by `athletes`). */
  deleted: Record<string, number>;
  authUserDeleted: boolean;
}

export async function purgeAthleteAccount(admin: SupabaseClient, athleteId: string): Promise<AthletePurgeResult> {
  const { data: athlete, error: lookupError } = await admin.from("athletes").select("user_id").eq("id", athleteId).maybeSingle();
  if (lookupError) throw new AthletePurgeError("lookup", lookupError.code ?? "query_failed");
  if (!athlete) throw new AthletePurgeError("lookup", "unknown athlete");

  const { data, error } = await admin.rpc("purge_athlete_account", { p_athlete_id: athleteId });
  if (error) throw new AthletePurgeError("purge", error.code ?? "rpc_failed");
  const deleted = ((data as { deleted?: Record<string, number> } | null)?.deleted ?? {}) as Record<string, number>;

  const userId = (athlete as { user_id: string | null }).user_id;
  if (userId) {
    const { error: authError } = await admin.auth.admin.deleteUser(userId);
    if (authError) throw new AthletePurgeError("auth", authError.message);
  }
  return { athleteId, deleted, authUserDeleted: userId !== null };
}
