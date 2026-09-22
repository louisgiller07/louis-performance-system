/**
 * Read/write access to `athlete_performance_profiles` (V0.4_101 — Performance
 * Setup). `athlete_id` is the table's PRIMARY KEY, so at most one row can
 * ever exist per athlete: 0 rows means "not yet configured", never an
 * error, never a fabricated default.
 *
 * Write access exists for admin/fixture population ahead of any Performance
 * Setup UI — same justification as athlete_coaching_profiles/athlete_
 * onboarding_profiles' own service_role grants. No runtime consumer of this
 * data exists yet: PlanInputSnapshot construction (V0.4_107) is a separate,
 * later ticket — this repository is deliberately not wired into anything.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoSupabaseError } from "./supabaseError.js";

export interface AthletePerformanceProfileRawRow {
  equipment: unknown;
  terrain_access: unknown;
  strength_experience_tier: string | null;
  declared_limitations: unknown;
  season_objective: string | null;
  technical_priorities: unknown;
}

/**
 * Fetches the `athlete_performance_profiles` row for `athleteId`, or `null`
 * if the athlete has never configured one. Explicitly scoped by
 * `athlete_id` even though `athlete_id` is already the PK — matches the
 * same explicit-filter discipline used by every other repository in this
 * directory, never a bare `.single()`/global lookup.
 */
export async function getPerformanceProfileFor(
  client: SupabaseClient,
  athleteId: string
): Promise<AthletePerformanceProfileRawRow | null> {
  const { data, error } = await client
    .from("athlete_performance_profiles")
    .select("equipment, terrain_access, strength_experience_tier, declared_limitations, season_objective, technical_priorities")
    .eq("athlete_id", athleteId)
    .maybeSingle();

  assertNoSupabaseError(error, "athlete_performance_profiles");
  return (data as AthletePerformanceProfileRawRow | null) ?? null;
}

export type AthletePerformanceProfileWriteFields = Partial<AthletePerformanceProfileRawRow>;

/**
 * Upserts (insert-or-update) the single `athlete_performance_profiles` row
 * for `athleteId` — matches the table's own "current mutable configuration"
 * semantics, never a history. Only the fields explicitly passed are
 * written; omitted fields keep their existing value (update) or the
 * column's own default (first insert).
 */
export async function upsertPerformanceProfileFor(
  client: SupabaseClient,
  athleteId: string,
  fields: AthletePerformanceProfileWriteFields
): Promise<void> {
  const { error } = await client
    .from("athlete_performance_profiles")
    .upsert({ athlete_id: athleteId, ...fields }, { onConflict: "athlete_id" });

  assertNoSupabaseError(error, "athlete_performance_profiles");
}
