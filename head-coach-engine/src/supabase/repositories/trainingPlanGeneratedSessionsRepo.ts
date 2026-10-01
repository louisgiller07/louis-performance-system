/**
 * Read-only access to `training_plan_generated_sessions` — the immutable,
 * canonical per-date session content within one accepted
 * `TrainingPlanVersion`. See supabase/migrations/20260921091000_v0_4_001c_
 * training_plan_hierarchy.sql.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoSupabaseError } from "./supabaseError.js";

/** Raw shape of the columns needed to build a projection candidate (mapping/generatedSessionToPlannedSessionCandidate.ts). */
export interface GeneratedSessionRawRow {
  id: string;
  date: string;
  kind: string;
  load_profile: string | null;
  duration_min: number | null;
  focus: string | null;
}

/**
 * Fetches every `training_plan_generated_sessions` row for `planVersionId`
 * whose `date` falls within `[windowStart, windowEnd]` (inclusive),
 * ascending by date. A date with no canonical content (outside the
 * version's own horizon) simply has no row here — never an error, never a
 * fabricated entry.
 */
/** UX-11A.5c.3 — one generated session of exactly `planVersionId` (never searched in another version). */
export async function getGeneratedSessionOfVersion(
  client: SupabaseClient,
  planVersionId: string,
  generatedSessionId: string
): Promise<Pick<GeneratedSessionRawRow, "id" | "kind" | "load_profile" | "duration_min"> | null> {
  const { data, error } = await client
    .from("training_plan_generated_sessions")
    .select("id, kind, load_profile, duration_min")
    .eq("plan_version_id", planVersionId)
    .eq("id", generatedSessionId)
    .maybeSingle();
  assertNoSupabaseError(error, "training_plan_generated_sessions");
  return data as Pick<GeneratedSessionRawRow, "id" | "kind" | "load_profile" | "duration_min"> | null;
}

export async function getGeneratedSessionsInWindow(
  client: SupabaseClient,
  planVersionId: string,
  windowStart: string,
  windowEnd: string
): Promise<GeneratedSessionRawRow[]> {
  const { data, error } = await client
    .from("training_plan_generated_sessions")
    .select("id, date, kind, load_profile, duration_min, focus")
    .eq("plan_version_id", planVersionId)
    .gte("date", windowStart)
    .lte("date", windowEnd)
    .order("date", { ascending: true });

  assertNoSupabaseError(error, "training_plan_generated_sessions");
  return (data ?? []) as GeneratedSessionRawRow[];
}
