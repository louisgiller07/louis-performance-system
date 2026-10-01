import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanInputSnapshot } from "planning-engine";
import { generatePlanV2InMemory } from "planning-engine/session-model-v2";
import { buildPlanInputSnapshot, type BuildPlanInputSnapshotDeps } from "../../src/supabase/buildPlanInputSnapshot.js";
import { runGenerationEngine } from "../../src/generation/generationEngine.js";
import type { AthleteAvailabilityWindowRawRow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import type { AthleteAvailabilityExceptionRawRow } from "../../src/supabase/repositories/athleteAvailabilityExceptionsRepo.js";
import type { AthleteLockedDateRawRow } from "../../src/supabase/repositories/athleteLockedDatesRepo.js";
import type { CompletedSessionRawRow } from "../../src/supabase/repositories/completedSessionsRepo.js";

// Deterministic generation snapshot — the same data returned by the database
// in any order yields the same snapshot JSON, the same hash and the same plan.
// Every permutation is fixed (no randomness is needed for the test to pass).

const TODAY = "2026-10-05";
const HORIZON = { startDate: "2026-10-05", endDate: "2026-10-18" };

const WINDOWS: AthleteAvailabilityWindowRawRow[] = [
  { id: "w1", day_of_week: 1, start_time: "07:00", end_time: "08:00", label: "morning" },
  { id: "w2", day_of_week: 1, start_time: "17:00", end_time: "20:00", label: null },
  { id: "w3", day_of_week: 2, start_time: "17:00", end_time: "20:00", label: null },
  { id: "w4", day_of_week: 3, start_time: "17:00", end_time: "19:00", label: null },
  { id: "w5", day_of_week: 3, start_time: "17:00", end_time: "19:00", label: "club" },
  { id: "w6", day_of_week: 4, start_time: "08:00", end_time: "20:00", label: null },
  { id: "w7", day_of_week: 5, start_time: "08:00", end_time: "20:00", label: null },
  { id: "w8", day_of_week: 6, start_time: "08:00", end_time: "20:00", label: null },
  { id: "w9", day_of_week: 0, start_time: "08:00", end_time: "12:00", label: null },
];
const EXCEPTIONS: AthleteAvailabilityExceptionRawRow[] = [
  { id: "e1", date: "2026-10-08", available: false, note: "travel" },
  { id: "e2", date: "2026-10-11", available: true, note: null },
  { id: "e3", date: "2026-10-14", available: false, note: null },
];
const LOCKED: AthleteLockedDateRawRow[] = [
  { id: "l1", date: "2026-10-10", reason: "family" },
  { id: "l2", date: "2026-10-16", reason: null },
];
const RECENT: CompletedSessionRawRow[] = [
  { session_date: "2026-09-28", session_type: "STRENGTH_A", intervention: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" }, completion_status: "done", actual_duration_min: 60 },
  { session_date: "2026-09-30", session_type: "DH_TECHNICAL", intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE" }, completion_status: "replaced", actual_duration_min: 45 },
  { session_date: "2026-10-02", session_type: "AEROBIC_BASE", intervention: { kind: "AEROBIC_BASE", load_profile: "LIGHT" }, completion_status: "done", actual_duration_min: 50 },
];

/** Fixed permutations: identity, reversed, rotated, interleaved. */
function permutations<T>(rows: readonly T[]): T[][] {
  const reversed = [...rows].reverse();
  const rotated = [...rows.slice(2), ...rows.slice(0, 2)];
  const interleaved = [...rows.filter((_, i) => i % 2 === 1), ...rows.filter((_, i) => i % 2 === 0)];
  return [[...rows], reversed, rotated, interleaved];
}

function deps(order: number): BuildPlanInputSnapshotDeps {
  const pick = <T,>(rows: readonly T[]) => permutations(rows)[order]!;
  return {
    getAthleteCoachingContext: vi.fn(async () => ({ athlete_id: "a", discipline: "Downhill" })),
    getPerformanceProfileFor: vi.fn(async () => ({
      equipment: ["dumbbells", "bench"],
      terrain_access: ["flow_trail", "bermed_trail"],
      strength_experience_tier: "intermediate",
      declared_limitations: [],
      season_objective: null,
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
    })),
    getAvailabilityWindowsFor: vi.fn(async () => pick(WINDOWS)),
    getAvailabilityExceptionsFor: vi.fn(async () => pick(EXCEPTIONS)),
    getLockedDatesFor: vi.fn(async () => pick(LOCKED)),
    getRacesOverlappingRange: vi.fn(async () => []),
    getRecentSessions: vi.fn(async () => pick(RECENT)),
  } as unknown as BuildPlanInputSnapshotDeps;
}

const hash = (snapshot: unknown) => createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
const build = (order: number) => buildPlanInputSnapshot({} as SupabaseClient, "a", TODAY, HORIZON, deps(order));

/** The sport content of a V1 plan, without any minted id. */
function v1SportContent(snapshot: PlanInputSnapshot): string {
  const result = runGenerationEngine({
    block: { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED", primaryFocus: "Test", startDate: HORIZON.startDate, endDate: HORIZON.endDate },
    planInputSnapshot: snapshot,
  });
  return JSON.stringify(result.weeks, (key, value) => (key === "id" || /Id$/.test(key) ? undefined : value));
}

describe("generation snapshot — canonical order of DB collections without a meaningful order", () => {
  it("windows, exceptions, locked dates and recent sessions are in their canonical business order", async () => {
    const snapshot = await build(1);
    expect(snapshot.availability.windows.map((w) => `${w.dayOfWeek} ${w.startTime}-${w.endTime} ${w.label ?? ""}`)).toEqual([
      "0 08:00-12:00 ",
      "1 07:00-08:00 morning",
      "1 17:00-20:00 ",
      "2 17:00-20:00 ",
      "3 17:00-19:00 ",
      "3 17:00-19:00 club",
      "4 08:00-20:00 ",
      "5 08:00-20:00 ",
      "6 08:00-20:00 ",
    ]);
    expect(snapshot.availability.exceptions.map((e) => e.date)).toEqual(["2026-10-08", "2026-10-11", "2026-10-14"]);
    expect(snapshot.lockedDates.map((l) => l.date)).toEqual(["2026-10-10", "2026-10-16"]);
    expect(snapshot.recentHistory).toEqual({ recentSessionKinds: ["STRENGTH_LOWER", "DH_TECHNICAL", "AEROBIC_BASE"], recentMissedOrReplacedCount: 1, trailingVolumeMinutes: 155 });
  });

  it("every DB order → identical snapshot JSON and identical hash", async () => {
    const snapshots = await Promise.all([0, 1, 2, 3].map(build));
    const reference = JSON.stringify(snapshots[0]);
    for (const s of snapshots) {
      expect(JSON.stringify(s)).toBe(reference);
      expect(hash(s)).toBe(hash(snapshots[0]));
    }
  });

  it("profile arrays keep their stored order (priorityAreas order is meaningful)", async () => {
    const snapshot = await build(2);
    expect(snapshot.technicalPriorities.priorityAreas).toEqual(["cornering", "braking"]);
    expect(snapshot.equipment).toEqual(["dumbbells", "bench"]);
  });
});

describe("the canonical order changes no sport result (V1 and V2 planners are order-insensitive)", () => {
  /** The same data in a non-canonical order, as an un-fixed builder could have produced it. */
  async function nonCanonical(): Promise<PlanInputSnapshot> {
    const s = await build(0);
    return {
      ...s,
      availability: { windows: [...s.availability.windows].reverse(), exceptions: [...s.availability.exceptions].reverse() },
      lockedDates: [...s.lockedDates].reverse(),
      recentHistory: { ...s.recentHistory, recentSessionKinds: [...s.recentHistory.recentSessionKinds].reverse() },
    };
  }

  it("V1: same weeks, dates, kinds, loads, durations, doses and prescriptions", async () => {
    const canonical = await build(0);
    expect(v1SportContent(await nonCanonical())).toBe(v1SportContent(canonical));
  });

  it("V2: same plan sport fingerprint", async () => {
    const canonical = await build(0);
    const v2 = async (s: PlanInputSnapshot) => {
      let n = 0;
      const r = generatePlanV2InMemory({
        block: { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED", primaryFocus: "Test", startDate: HORIZON.startDate, endDate: HORIZON.endDate },
        snapshot: { ...s, dhTechnicalTier: "intermediate" },
        mintId: () => `id-${++n}`,
      });
      if (r.status !== "generated") throw new Error(JSON.stringify(r));
      return r.plan.planSportFingerprint;
    };
    expect(await v2(await nonCanonical())).toBe(await v2(canonical));
  });
});
