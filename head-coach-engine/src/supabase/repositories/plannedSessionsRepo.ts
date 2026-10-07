/**
 * Read-only access to `planned_sessions` for the current (today's) planned
 * session. See docs/05_DATA_MODEL.md §planned_sessions.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoSupabaseError } from "./supabaseError.js";
import { getCurrentPlanVersion } from "./trainingPlanCurrentVersionRepo.js";

/** Raw shape of the columns needed by mapPlannedSessionRow (M2_003). */
export type PlannedSessionRawRow = Record<string, unknown>;

/**
 * Fetches the `planned_sessions` row for `athleteId` on exactly `date`.
 * Returns `null` if no row exists for that day — a day with no planned
 * session at all (distinct from a legacy row whose session_type can't be
 * inverted, which is handled downstream by mapPlannedSessionRow/M2_003).
 */
export async function getPlannedSessionFor(
  client: SupabaseClient,
  athleteId: string,
  date: string
): Promise<PlannedSessionRawRow | null> {
  const { data, error } = await client
    .from("planned_sessions")
    // UX-11A.5c.3 — the same single read also carries the row's identity and
    // projection lineage, so the V2 daily path reconciles against exactly the
    // observation M1 consumed (never a second read after M1). M1 itself still
    // only receives session_type / intervention / planned_intent / is_committed.
    .select("id, planned_date, updated_at, source, source_plan_version_id, source_generated_session_id, session_type, intervention, planned_intent, is_committed")
    .eq("athlete_id", athleteId)
    .eq("planned_date", date)
    .maybeSingle();

  assertNoSupabaseError(error, "planned_sessions");
  return data as PlannedSessionRawRow | null;
}

/**
 * V0.5_047/048 — reads only the generated-session lineage of today's
 * `planned_sessions` row, deliberately separate from `getPlannedSessionFor`
 * above (never touched — that function feeds M1 via buildRawContext and
 * stays exactly as it was). Returns `null` both when no row exists for the
 * date, and when a row exists but was never sourced from a generated plan
 * (a manual/legacy session, or a date with no accepted plan coverage) —
 * both are legitimate, never an error (see planning-engine's
 * `ActiveSessionOrigin: "no_canonical_plan"` for the same distinction).
 *
 * PILOT_022 (REV-02) — ownership, not the mere presence of lineage columns,
 * decides. A manual edit keeps `source_generated_session_id` (the upsert
 * omits it) while replacing the session itself, so the lineage alone can
 * point at a strength prescription for what is now an aerobic session. The
 * generated session id is therefore returned only while the row is still
 * owned by the projection (`source = 'generated'`) AND belongs to the
 * athlete's current plan version — never for a manual row, and never for a
 * row left over from a superseded plan.
 */
export async function getProjectedGeneratedSessionIdForDate(
  client: SupabaseClient,
  athleteId: string,
  date: string
): Promise<string | null> {
  const { data, error } = await client
    .from("planned_sessions")
    .select("source, source_plan_version_id, source_generated_session_id")
    .eq("athlete_id", athleteId)
    .eq("planned_date", date)
    .maybeSingle();

  assertNoSupabaseError(error, "planned_sessions");
  const row = data as { source: string | null; source_plan_version_id: string | null; source_generated_session_id: string | null } | null;
  if (!row || row.source !== "generated" || !row.source_generated_session_id || !row.source_plan_version_id) {
    return null;
  }

  const currentVersion = await getCurrentPlanVersion(client, athleteId);
  if (currentVersion?.plan_version_id !== row.source_plan_version_id) {
    return null;
  }
  return row.source_generated_session_id;
}

export interface DailyRunInputVersion {
  id: string;
  updated_at: string;
}

/** A10 — the check-in's version and the rider's time today, read together (one row, one read). */
export interface DailyRunCheckinVersion extends DailyRunInputVersion {
  /** Minutes available today; null (or absent) = no exceptional time constraint. */
  available_minutes_today?: number | null;
}

export interface DailyRunInputVersions {
  checkin: DailyRunCheckinVersion | null;
  plannedSession: DailyRunInputVersion | null;
}

/**
 * PILOT_022 (REV-01) — the persistent version (`id`, `updated_at`, maintained
 * by the set_updated_at() triggers) of the two inputs a daily decision is
 * computed from: today's check-in and today's planned session (or its
 * absence). Persisted with the decision so `daily_decision_currency` can tell,
 * after any navigation or reload, whether the decision still matches them.
 */
export async function getDailyRunInputVersions(client: SupabaseClient, athleteId: string, date: string): Promise<DailyRunInputVersions> {
  const [checkin, planned] = await Promise.all([
    client.from("daily_checkins").select("id, updated_at, available_minutes_today").eq("athlete_id", athleteId).eq("checkin_date", date).maybeSingle(),
    client.from("planned_sessions").select("id, updated_at").eq("athlete_id", athleteId).eq("planned_date", date).maybeSingle(),
  ]);
  assertNoSupabaseError(checkin.error, "daily_checkins");
  assertNoSupabaseError(planned.error, "planned_sessions");
  return {
    checkin: (checkin.data as DailyRunCheckinVersion | null) ?? null,
    plannedSession: (planned.data as DailyRunInputVersion | null) ?? null,
  };
}
