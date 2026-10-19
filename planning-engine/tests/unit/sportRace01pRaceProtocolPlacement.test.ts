import { describe, expect, it } from "vitest";
import { generatePlanV2InMemory, type PlanInputSnapshotV2, type PlanV2InMemory } from "../../src/sessionModelV2/index.js";
import { PLAN_ROLE_DOSES_V2 } from "../../src/catalog/planDosePolicyV2.js";
import { RACE_PROTOCOL_PLAN_POLICY_V2_VERSION } from "../../src/catalog/raceProtocolPlanPolicyV2.js";
import { recoveryActiveDurationRangeV2 } from "../../src/sessionModelV2/builders/recoveryActivePrescriptionV2.js";
import type { PlanInputAvailabilityWindow } from "../../src/types/planInputSnapshot.js";

// SPORT-RACE-01P (HPM 2026-10-19, option P) — the pre-event days of an A / B race follow its protocol in the plan
// (RACE_PROTOCOL_PLAN_POLICY_V2, PROVISIONAL): only for a format that has a protocol, only where the day and the
// availability allow, with the existing doses (taper Force and DH, recovery_active_v1). Everything else unchanged.

const w = (dayOfWeek: PlanInputAvailabilityWindow["dayOfWeek"], startTime: string, endTime: string, activity: "physical" | "riding"): PlanInputAvailabilityWindow => ({ dayOfWeek, startTime, endTime, activity });
// SPORT-VALIDATION-01's rider C: weekday evenings "physical", weekend "riding".
const WEEKDAYS_WEEKEND = [w(1, "18:00", "20:00", "physical"), w(2, "18:00", "19:30", "physical"), w(3, "18:00", "20:00", "physical"), w(4, "18:00", "19:30", "physical"), w(5, "18:00", "20:00", "physical"), w(6, "09:00", "17:00", "riding"), w(0, "09:00", "17:00", "riding")];
// Rider B: Tuesday and Thursday "physical", Saturday morning "riding".
const THREE_SLOTS = [w(2, "18:30", "19:45", "physical"), w(4, "18:30", "19:45", "physical"), w(6, "09:00", "12:00", "riding")];

function snapshot(overrides: Partial<PlanInputSnapshotV2> = {}): PlanInputSnapshotV2 {
  return {
    discipline: "Downhill",
    races: [],
    availability: { windows: WEEKDAYS_WEEKEND, exceptions: [] },
    equipment: ["dumbbells", "bench"],
    terrainAccess: ["flow_trail", "bermed_trail", "technical_trail"],
    strengthExperienceTier: "intermediate",
    declaredLimitations: [],
    technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
    lockedDates: [],
    recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 },
    dhTechnicalTier: "intermediate",
    ...overrides,
  };
}
const BLOCK = { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED" as const, primaryFocus: "Test", startDate: "2026-11-02", endDate: "2026-11-29" };
const race = (startDate: string, endDate: string, raceFormat?: string, priority: "A" | "B" | "C" = "A") => ({ eventName: "Course", startDate, endDate, priority, ...(raceFormat !== undefined ? { raceFormat } : {}) });

function plan(s: PlanInputSnapshotV2): PlanV2InMemory {
  let n = 0;
  const result = generatePlanV2InMemory({ block: BLOCK, snapshot: s, mintId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` });
  if (result.status !== "generated") throw new Error(`expected a generated plan, got ${result.code}`);
  return result.plan;
}
const sessionsOf = (p: PlanV2InMemory, week: number) => p.weeks[week]!.sessions.map((s) => `${s.date.slice(5)} ${s.kind} ${s.loadProfile ?? "-"} ${s.durationMin}`);
const roles = (p: PlanV2InMemory) => p.weeks.map((x) => x.doseSummary.progression?.role);
const RECOVERY = recoveryActiveDurationRangeV2().min;

describe("SPORT-RACE-01P — pre-event days planned from the race protocol", () => {
  it("formats without a protocol (no format, OTHER, SWISS_CUP, UCI_WC, UCI_WORLDS): the plan is exactly the one without any format — race week without session", () => {
    const reference = plan(snapshot({ races: [race("2026-11-21", "2026-11-22")] }));
    expect(roles(reference)).toEqual(["race_specific", "taper", "race", "introduction"]);
    expect(sessionsOf(reference, 2)).toEqual([]);
    for (const raceFormat of ["OTHER", "SWISS_CUP", "UCI_WC", "UCI_WORLDS"]) {
      expect(plan(snapshot({ races: [race("2026-11-21", "2026-11-22", raceFormat)] })).planSportFingerprint).toBe(reference.planSportFingerprint);
    }
  });

  it("HOT_TRAIL_2DAY on Sat 21 – Sun 22, weekend riding: the taper DH moves from J-7 (the protocol's Force day) to J-6 (its DH day), same dose; active recovery at J-4 and J-3; nothing on J-5, J-2, J-1 or the race days", () => {
    const p = plan(snapshot({ races: [race("2026-11-21", "2026-11-22", "HOT_TRAIL_2DAY")] }));
    expect(roles(p)).toEqual(["race_specific", "taper", "race", "introduction"]);
    expect(sessionsOf(p, 1)).toEqual(["11-09 STRENGTH_LOWER LIGHT 45", "11-10 AEROBIC_BASE LIGHT 45", "11-15 DH_TECHNICAL LIGHT 60"]);
    expect(sessionsOf(p, 2)).toEqual([`11-17 RECOVERY_ACTIVE - ${RECOVERY}`, `11-18 RECOVERY_ACTIVE - ${RECOVERY}`]);
    const taper = p.weeks[1]!.doseSummary;
    expect(taper.progression).toMatchObject({ reasonCodes: expect.arrayContaining(["race_in_next_week", "race_protocol_sessions"]), raceProtocolPolicy: RACE_PROTOCOL_PLAN_POLICY_V2_VERSION, sessionCount: 3 });
    expect(taper.plannedDhTechnicalSessionCount).toBe(1);
    const raceWeek = p.weeks[2]!.doseSummary;
    expect(raceWeek.progression).toMatchObject({ role: "race", sessionCount: 2, reasonCodes: ["race_in_week", "race_protocol_sessions"] });
    expect(raceWeek).toMatchObject({ plannedRestOrRecoveryDayCount: 5, totalPlannedMinutes: 2 * RECOVERY });
  });

  it("IXS_3DAY on Fri 20 – Sun 22: J-7 upper-body Force LIGHT 45 on a physical evening, J-6 the taper DH (already the protocol's DH day), J-4 and J-3 recovery; J-2 and J-1 (official practice) nothing", () => {
    const p = plan(snapshot({ races: [race("2026-11-20", "2026-11-22", "IXS_3DAY")] }));
    expect(sessionsOf(p, 1)).toEqual(["11-09 STRENGTH_LOWER LIGHT 45", "11-10 AEROBIC_BASE LIGHT 45", "11-13 STRENGTH_UPPER LIGHT 45", "11-14 DH_TECHNICAL LIGHT 60"]);
    expect(sessionsOf(p, 2)).toEqual([`11-16 RECOVERY_ACTIVE - ${RECOVERY}`, `11-17 RECOVERY_ACTIVE - ${RECOVERY}`]);
  });

  it("three slots (Tue / Thu physical, Sat riding), HOT_TRAIL_2DAY on Saturday: the taper DH on J-7 has no riding slot to move to and stays; J-4 (Tuesday) recovery; J-3 has no slot", () => {
    const p = plan(snapshot({ availability: { windows: THREE_SLOTS, exceptions: [] }, races: [race("2026-11-21", "2026-11-22", "HOT_TRAIL_2DAY")] }));
    expect(sessionsOf(p, 1)).toEqual(["11-10 STRENGTH_LOWER LIGHT 45", "11-12 AEROBIC_BASE LIGHT 45", "11-14 DH_TECHNICAL LIGHT 60"]);
    expect(sessionsOf(p, 2)).toEqual([`11-17 RECOVERY_ACTIVE - ${RECOVERY}`]);
  });

  it("a race on Monday 23 (HOT_TRAIL_2DAY): the taper DH on the protocol's REST day (J-2) cannot move (J-6 is a physical evening) and is removed; recovery on J-4 and J-3; the other taper sessions stay", () => {
    const p = plan(snapshot({ races: [race("2026-11-23", "2026-11-24", "HOT_TRAIL_2DAY")] }));
    expect(roles(p)).toEqual(["introduction", "race_specific", "taper", "race"]);
    expect(sessionsOf(p, 2)).toEqual(["11-16 STRENGTH_LOWER LIGHT 45", "11-17 AEROBIC_BASE LIGHT 45", `11-19 RECOVERY_ACTIVE - ${RECOVERY}`, `11-20 RECOVERY_ACTIVE - ${RECOVERY}`]);
    expect(p.weeks[2]!.doseSummary.plannedDhTechnicalSessionCount).toBe(0);
  });

  it("a C race (A09) and a race without a format change nothing", () => {
    const none = plan(snapshot());
    expect(plan(snapshot({ races: [race("2026-11-21", "2026-11-22", "HOT_TRAIL_2DAY", "C")] })).planSportFingerprint).toBe(none.planSportFingerprint);
  });

  it("two races a week apart (HOT_TRAIL_2DAY, Sat 21 and Sat 28): nothing on the first race's days or the two days after it; the second race keeps its J-3 recovery", () => {
    const p = plan(snapshot({ races: [race("2026-11-21", "2026-11-22", "HOT_TRAIL_2DAY"), race("2026-11-28", "2026-11-29", "HOT_TRAIL_2DAY")] }));
    expect(roles(p)).toEqual(["race_specific", "taper", "race", "race"]);
    expect(sessionsOf(p, 2)).toEqual([`11-17 RECOVERY_ACTIVE - ${RECOVERY}`, `11-18 RECOVERY_ACTIVE - ${RECOVERY}`]);
    expect(sessionsOf(p, 3)).toEqual([`11-25 RECOVERY_ACTIVE - ${RECOVERY}`]);
  });

  it("an unavailable day (exception) gets nothing", () => {
    const p = plan(snapshot({ availability: { windows: WEEKDAYS_WEEKEND, exceptions: [{ date: "2026-11-17", available: false }] }, races: [race("2026-11-21", "2026-11-22", "HOT_TRAIL_2DAY")] }));
    expect(sessionsOf(p, 2)).toEqual([`11-18 RECOVERY_ACTIVE - ${RECOVERY}`]);
  });

  it("the planned sessions are complete V2 prescriptions with the existing content: recovery_active_v1, the upper-body Force template at LIGHT, the DH drill at the taper's 4 passes", () => {
    const p = plan(snapshot({ races: [race("2026-11-20", "2026-11-22", "IXS_3DAY")] }));
    const on = (date: string) => p.weeks.flatMap((x) => x.sessions).find((s) => s.date === date)!.plannedPrescription.structure;
    expect(on("2026-11-16")).toMatchObject({ family: "recovery", sessionKind: "RECOVERY_ACTIVE", protocolId: "recovery_active_v1" });
    expect(on("2026-11-13")).toMatchObject({ family: "strength", sessionKind: "STRENGTH_UPPER" });
    const dh = on("2026-11-14");
    const passes = dh.blocks.filter((b) => b.role === "main").flatMap((b) => b.items).map((i) => (i as { measure?: { count?: number } }).measure?.count);
    expect(passes).toEqual([PLAN_ROLE_DOSES_V2.taper.dhFocusedPasses]);
  });

  it("never two sessions on a day", () => {
    for (const races of [[race("2026-11-21", "2026-11-22", "HOT_TRAIL_2DAY")], [race("2026-11-20", "2026-11-22", "IXS_3DAY")], [race("2026-11-23", "2026-11-24", "HOT_TRAIL_2DAY")]]) {
      const dates = plan(snapshot({ races })).weeks.flatMap((x) => x.sessions.map((s) => s.date));
      expect(new Set(dates).size).toBe(dates.length);
    }
  });
});
