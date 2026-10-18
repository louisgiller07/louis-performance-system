import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BuildPlanInputSnapshotDeps } from "../../src/supabase/buildPlanInputSnapshot.js";
import { buildPlanInputSnapshotV2 } from "../../src/supabase/buildPlanInputSnapshotV2.js";
import type { PlanHistoryFactsV2 } from "../../src/supabase/mapping/planHistoryV2.js";

// V2-L2-01a — the V2 snapshot with the V2 history switch: OFF = the historical snapshot exactly; ON = only the
// volume and the missed count change; a failed history read refuses the snapshot.

const ATHLETE_ID = "athlete-1";
const TODAY = "2026-11-02";
const HORIZON = { startDate: "2026-11-03", endDate: "2026-11-16" };
const CLIENT = {} as SupabaseClient;

/** V1 debriefs of the window: 40 declared minutes + 2 « skipped / replaced » (the historical count). */
const V1_ROWS = [
  { session_date: "2026-10-27", session_type: "STRENGTH_A", intervention: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" }, completion_status: "done", actual_duration_min: 40, change_reason: null },
  { session_date: "2026-10-28", session_type: "DH_TECHNICAL", intervention: null, completion_status: "skipped", actual_duration_min: null, change_reason: "pain" },
  { session_date: "2026-10-29", session_type: "DH_TECHNICAL", intervention: null, completion_status: "replaced", actual_duration_min: 0, change_reason: "activity_change" },
];

function deps(): BuildPlanInputSnapshotDeps {
  return {
    getAthleteCoachingContext: vi.fn(async () => ({ athlete_id: ATHLETE_ID, discipline: "Downhill" })),
    getPerformanceProfileFor: vi.fn(async () => ({
      equipment: ["dumbbells"],
      terrain_access: ["flow_trail"],
      strength_experience_tier: "intermediate",
      declared_limitations: [],
      season_objective: null,
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering"] },
      dh_technical_tier: "intermediate",
    })),
    getAvailabilityWindowsFor: vi.fn(async () => [{ id: "w1", day_of_week: 6, start_time: "08:00", end_time: "18:00", label: null }]),
    getAvailabilityExceptionsFor: vi.fn(async () => []),
    getLockedDatesFor: vi.fn(async () => []),
    getRacesOverlappingRange: vi.fn(async () => []),
    getRecentSessions: vi.fn(async () => V1_ROWS),
  } as never;
}

const FACTS: PlanHistoryFactsV2 = {
  debriefs: V1_ROWS.map((r) => ({ session_date: r.session_date, completion_status: r.completion_status, actual_duration_min: r.actual_duration_min, change_reason: r.change_reason, new_pain: false })),
  executions: [{ id: "e", session_date: "2026-10-31", decision_id: "d", final_prescription_id: "fp", started_at: "2026-10-31T17:00:00Z", events: ["started", "completed"] }],
  decisions: [{ id: "d", decision_date: "2026-10-31", created_at: "2026-10-31T06:00:00Z", daily_plan: { decision: "KEEP", final_session: { kind: "AEROBIC_BASE", duration_min: 45 }, triggered_rules: [] } }],
  prescriptions: [{ id: "fp", structure: { family: "endurance" } }],
  sets: [],
  activities: [{ id: "a", execution_id: "e", duration_seconds: 52 * 60, supersedes_id: null }],
  checkins: [],
  healthFlags: [],
};

describe("buildPlanInputSnapshotV2 — V2 history switch", () => {
  it("OFF (absent, {}, false): the historical snapshot exactly, the history never read", async () => {
    const reference = await buildPlanInputSnapshotV2(CLIENT, ATHLETE_ID, TODAY, HORIZON, deps());
    expect(reference.recentHistory).toEqual({ trailingVolumeMinutes: 40, recentMissedOrReplacedCount: 2, recentSessionKinds: ["STRENGTH_LOWER"] });
    for (const options of [{}, { v2History: false }, { v2History: undefined }]) {
      const read = vi.fn();
      const snapshot = await buildPlanInputSnapshotV2(CLIENT, ATHLETE_ID, TODAY, HORIZON, deps(), { ...options, readPlanHistoryFactsV2: read });
      expect(JSON.stringify(snapshot)).toBe(JSON.stringify(reference));
      expect(read).not.toHaveBeenCalled();
    }
  });

  it("ON: the volume and the missed count from the V2 history; every other field, the key order and recentSessionKinds unchanged", async () => {
    const reference = await buildPlanInputSnapshotV2(CLIENT, ATHLETE_ID, TODAY, HORIZON, deps());
    const read = vi.fn(async () => FACTS);
    const snapshot = await buildPlanInputSnapshotV2(CLIENT, ATHLETE_ID, TODAY, HORIZON, deps(), { v2History: true, readPlanHistoryFactsV2: read });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(CLIENT, ATHLETE_ID, TODAY);
    // 40 (V1 done) + 0 (replaced, 0 declared) + 52 (endurance recorded); the « pain » skip is never missed, the replacement neither.
    expect(snapshot.recentHistory).toEqual({ trailingVolumeMinutes: 92, recentMissedOrReplacedCount: 0, recentSessionKinds: reference.recentHistory.recentSessionKinds });
    expect(Object.keys(snapshot)).toEqual(Object.keys(reference));
    expect(Object.keys(snapshot.recentHistory)).toEqual(Object.keys(reference.recentHistory));
    expect({ ...snapshot, recentHistory: null }).toEqual({ ...reference, recentHistory: null });
  });

  it("ON: a failed history read refuses the snapshot (the same error, never an empty history)", async () => {
    const failure = new Error("Supabase read failed (session_executions): boom");
    await expect(buildPlanInputSnapshotV2(CLIENT, ATHLETE_ID, TODAY, HORIZON, deps(), { v2History: true, readPlanHistoryFactsV2: vi.fn(async () => Promise.reject(failure)) })).rejects.toBe(failure);
  });

  it("ON: the V1 blocking errors still come first (missing profile), the history is not read", async () => {
    const d = deps();
    (d.getPerformanceProfileFor as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const read = vi.fn(async () => FACTS);
    await expect(buildPlanInputSnapshotV2(CLIENT, ATHLETE_ID, TODAY, HORIZON, d, { v2History: true, readPlanHistoryFactsV2: read })).rejects.toThrow(/missing_performance_profile/);
    expect(read).not.toHaveBeenCalled();
  });
});
