import { describe, expect, it } from "vitest";
import { availabilityByDate, isActivityAvailableOn } from "../../src/pipeline/availabilityActivity.js";
import { segmentWeek, type WeekSegmentationInput } from "../../src/pipeline/weekSegmenter.js";
import { WEEK_TEMPLATE_CATALOG } from "../../src/catalog/weekTemplateCatalog.js";
import { generatePlanV2InMemory, type PlanInputSnapshotV2, type PlanV2InMemory } from "../../src/sessionModelV2/index.js";
import type { PlanInputAvailability, PlanInputAvailabilityWindow } from "../../src/types/planInputSnapshot.js";

// BUG-V2-1 — physical vs riding availability must really constrain placement.
// Week of 2026-10-19 (Monday) .. 2026-10-25 (Sunday).
const MON = "2026-10-19", TUE = "2026-10-20", WED = "2026-10-21", THU = "2026-10-22", FRI = "2026-10-23", SAT = "2026-10-24", SUN = "2026-10-25";
const DOW: Record<string, number> = { [MON]: 1, [TUE]: 2, [WED]: 3, [THU]: 4, [FRI]: 5, [SAT]: 6, [SUN]: 0 };
type Dow = PlanInputAvailabilityWindow["dayOfWeek"];

const physical = (dayOfWeek: number, startTime: string, endTime: string): PlanInputAvailabilityWindow => ({ dayOfWeek: dayOfWeek as Dow, startTime, endTime, activity: "physical" });
const riding = (dayOfWeek: number, startTime = "08:00", endTime = "18:00"): PlanInputAvailabilityWindow => ({ dayOfWeek: dayOfWeek as Dow, startTime, endTime, activity: "riding" });
const legacy = (dayOfWeek: number, startTime: string, endTime: string): PlanInputAvailabilityWindow => ({ dayOfWeek: dayOfWeek as Dow, startTime, endTime });

/** Case A — physical Mon 1 h 20, Tue 1 h 30, Thu 1 h 20 (evenings); riding Saturday and Sunday (full days). */
const CASE_A: PlanInputAvailabilityWindow[] = [physical(1, "18:00", "19:20"), physical(2, "18:00", "19:30"), physical(4, "18:00", "19:20"), riding(6), riding(0)];

const DEVELOPMENT_DURATIONS: WeekSegmentationInput["sessionDurationMinByDomain"] = { strength: 60, dh_technical: 90, aerobic: 45 };
const segment = (windows: PlanInputAvailabilityWindow[], overrides: Partial<WeekSegmentationInput> = {}) =>
  segmentWeek({
    weekStartDate: MON,
    weekEndDate: SUN,
    template: WEEK_TEMPLATE_CATALOG.development!,
    availability: { windows, exceptions: [] },
    terrainAccess: ["flow_trail", "technical_trail"],
    lockedDates: [],
    sessionDurationMinByDomain: DEVELOPMENT_DURATIONS,
    ...overrides,
  });
const placed = (result: ReturnType<typeof segmentWeek>) => Object.fromEntries(result.placedSlots.map((s) => [s.date, s.domain]));

describe("availabilityByDate — per activity", () => {
  const avail = (windows: PlanInputAvailabilityWindow[], exceptions: PlanInputAvailability["exceptions"] = []): PlanInputAvailability => ({ windows, exceptions });

  it("a legacy window (no activity) serves both physical and riding, with its own capacity", () => {
    expect(availabilityByDate([MON, TUE], avail([legacy(1, "18:00", "19:30")]))).toEqual([
      { date: MON, physical: 90, riding: 90 },
      { date: TUE, physical: undefined, riding: undefined },
    ]);
  });

  it("typed windows only serve their own activity; a day may carry both, one or none", () => {
    const days = availabilityByDate([MON, WED, SAT], avail([physical(1, "18:00", "19:20"), physical(6, "07:00", "08:00"), riding(6)]));
    expect(days).toEqual([
      { date: MON, physical: 80, riding: undefined },
      { date: WED, physical: undefined, riding: undefined },
      { date: SAT, physical: 60, riding: 600 },
    ]);
  });

  it("exceptions still win outright (false revokes everything, true grants both); locked dates are excluded", () => {
    const a = avail([riding(6)], [{ date: SAT, available: false }, { date: WED, available: true }]);
    expect(availabilityByDate([SAT, WED, SUN], a, [{ date: SUN }])).toEqual([
      { date: SAT, physical: undefined, riding: undefined },
      { date: WED, physical: null, riding: null },
      { date: SUN, physical: undefined, riding: undefined },
    ]);
    expect(isActivityAvailableOn(WED, "riding", a)).toBe(true);
  });
});

describe("segmentWeek — BUG-V2-1 cases", () => {
  it("Case A: DH only on the riding days (Sat/Sun), strength only on physical days, nothing Wed/Fri", () => {
    const result = segment(CASE_A);
    expect(result.unplaceable).toEqual([]);
    expect(placed(result)).toEqual({ [SAT]: "dh_technical", [SUN]: "dh_technical", [MON]: "strength", [TUE]: "strength", [THU]: "aerobic" });
    for (const s of result.placedSlots) {
      if (s.domain === "dh_technical") expect([6, 0]).toContain(DOW[s.date]);
      if (s.domain === "strength") expect([1, 2, 4]).toContain(DOW[s.date]);
    }
  });

  it("Case B: Saturday riding unavailable, Sunday available — no bike session on Saturday", () => {
    const result = segment([physical(1, "18:00", "19:20"), physical(2, "18:00", "19:30"), physical(4, "18:00", "19:20"), riding(0)]);
    expect(placed(result)[SAT]).toBeUndefined();
    expect(placed(result)[SUN]).toBe("dh_technical");
    expect(result.placedSlots.filter((s) => s.domain === "dh_technical")).toHaveLength(1);
    expect(result.unplaceable).toContainEqual({ domain: "dh_technical", reason: "insufficient_available_dates" });
  });

  it("Case C: 45 min of physical availability on Tuesday never hosts a session that needs more (strength 60 / 90 min)", () => {
    const result = segment([physical(2, "18:00", "18:45"), riding(6), riding(0)]);
    expect(placed(result)[TUE]).toBe("aerobic"); // 45 min fits exactly; strength (60) does not
    expect(result.placedSlots.some((s) => s.domain === "strength")).toBe(false);
    expect(result.unplaceable.filter((u) => u.domain === "strength")).toEqual([
      { domain: "strength", reason: "insufficient_available_time" },
      { domain: "strength", reason: "insufficient_available_time" },
    ]);
    const longer = segment([physical(2, "18:00", "18:45")], { sessionDurationMinByDomain: { strength: 90, dh_technical: 90, aerobic: 90 } });
    expect(longer.placedSlots).toEqual([]);
  });

  it("Case D: several days without riding availability — no DH invented there", () => {
    const result = segment([1, 2, 3, 4, 5].map((d) => physical(d, "17:00", "19:00")).concat(riding(0)));
    expect(result.placedSlots.filter((s) => s.domain === "dh_technical").map((s) => s.date)).toEqual([SUN]);
    expect(result.unplaceable).toEqual([{ domain: "dh_technical", reason: "insufficient_available_dates" }]);
    const none = segment([1, 2, 3, 4, 5].map((d) => physical(d, "17:00", "19:00")));
    expect(none.placedSlots.some((s) => s.domain === "dh_technical")).toBe(false);
  });

  it("Case E: legacy windows (no activity) keep the previous placement exactly", () => {
    const result = segment([0, 1, 2, 3, 4, 5, 6].map((d) => legacy(d, "16:00", "20:00")));
    expect(result.unplaceable).toEqual([]);
    expect(placed(result)).toEqual({ [MON]: "dh_technical", [TUE]: "dh_technical", [WED]: "strength", [THU]: "strength", [FRI]: "aerobic" });
  });

  it("strength prefers physical-only days and keeps the riding days for riding", () => {
    const result = segment([physical(3, "18:00", "19:30"), physical(6, "07:00", "09:00"), riding(6), riding(0)], {
      template: { ...WEEK_TEMPLATE_CATALOG.development!, dhTechnicalSlotCount: 1, strengthSlotCount: 1, aerobicSlotCount: 0 },
    });
    expect(placed(result)).toEqual({ [SAT]: "dh_technical", [WED]: "strength" });
  });
});

// --- V2 generation end to end (in memory) ---------------------------------
const ALL_TERRAIN = ["any_groomed_trail", "flow_trail", "bermed_trail", "technical_trail", "rock_garden", "steep_technical_trail", "root_rock_trail", "bike_park_jump_line", "full_dh_track"];

function snapshot(windows: PlanInputAvailabilityWindow[]): PlanInputSnapshotV2 {
  return {
    discipline: "Downhill",
    races: [],
    availability: { windows, exceptions: [] },
    equipment: ["dumbbells", "bench"],
    terrainAccess: ALL_TERRAIN,
    strengthExperienceTier: "intermediate",
    declaredLimitations: [],
    technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
    lockedDates: [],
    recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 },
    dhTechnicalTier: "intermediate",
  };
}
function counter() {
  let n = 0;
  return () => `id-${++n}`;
}
function generate(windows: PlanInputAvailabilityWindow[]): PlanV2InMemory {
  const result = generatePlanV2InMemory({
    block: { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED", primaryFocus: "Test", startDate: "2026-10-19", endDate: "2026-11-01" },
    snapshot: snapshot(windows),
    mintId: counter(),
  });
  if (result.status !== "generated") throw new Error(`expected a generated plan, got ${JSON.stringify(result)}`);
  return result.plan;
}
const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const all = (plan: PlanV2InMemory) => plan.weeks.flatMap((w) => w.sessions);

describe("generatePlanV2InMemory — BUG-V2-1", () => {
  it("Case A over two weeks: DH on Sat/Sun only, strength Mon/Tue/Thu only, nothing on Wed/Fri", () => {
    const sessions = all(generate(CASE_A));
    expect(sessions.length).toBeGreaterThan(0);
    for (const s of sessions) {
      expect([3, 5]).not.toContain(dow(s.date));
      if (s.kind === "DH_TECHNICAL") expect([6, 0]).toContain(dow(s.date));
      if (s.kind.startsWith("STRENGTH")) expect([1, 2, 4]).toContain(dow(s.date));
    }
    expect(sessions.filter((s) => s.kind === "DH_TECHNICAL").length).toBeGreaterThan(0);
  });

  it("an endurance session on a day without riding availability offers only home trainer / running", () => {
    const aerobic = all(generate(CASE_A)).filter((s) => s.kind === "AEROBIC_BASE");
    expect(aerobic.length).toBeGreaterThan(0);
    for (const s of aerobic) {
      expect([1, 2, 4]).toContain(dow(s.date));
      expect(s.plannedPrescription.structure.activitySelection).toEqual({ mode: "restricted", activityIds: ["home_trainer", "running"] });
    }
  });

  it("Case D: no riding window at all — no DH session, endurance stays off-terrain", () => {
    const sessions = all(generate([1, 2, 3, 4, 5].map((d) => physical(d, "17:00", "19:00"))));
    expect(sessions.some((s) => s.kind === "DH_TECHNICAL")).toBe(false);
    for (const s of sessions.filter((x) => x.kind === "AEROBIC_BASE")) {
      expect(s.plannedPrescription.structure.activitySelection?.activityIds).toEqual(["home_trainer", "running"]);
    }
  });

  it("Case E: legacy windows keep every endurance activity option (unchanged behavior)", () => {
    const sessions = all(generate([0, 1, 2, 3, 4, 5, 6].map((d) => legacy(d, "08:00", "20:00"))));
    const aerobic = sessions.filter((s) => s.kind === "AEROBIC_BASE");
    expect(aerobic.length).toBeGreaterThan(0);
    for (const s of aerobic) expect(s.plannedPrescription.structure.activitySelection?.activityIds).toEqual(["road_bike", "mtb_rolling", "home_trainer", "running"]);
  });
});
