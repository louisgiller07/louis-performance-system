import { describe, expect, it } from "vitest";
import { generatePlanV2InMemory, type PlanInputSnapshotV2, type PlanV2InMemory } from "../../src/sessionModelV2/index.js";
import type { PlanInputAvailabilityWindow, PlanInputRace } from "../../src/types/planInputSnapshot.js";

// A09 — a C race (secondary / training) never restructures the V2 macro plan; A+ / A / B keep the existing race / taper / race-specific weeks.

const ALL_DAY: PlanInputAvailabilityWindow[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as PlanInputAvailabilityWindow["dayOfWeek"], startTime: "08:00", endTime: "20:00" }));
function snapshot(races: PlanInputRace[]): PlanInputSnapshotV2 {
  return {
    discipline: "Downhill",
    races,
    availability: { windows: ALL_DAY, exceptions: [] },
    equipment: ["dumbbells", "bench"],
    terrainAccess: ["any_groomed_trail", "flow_trail", "bermed_trail", "technical_trail"],
    strengthExperienceTier: "intermediate",
    declaredLimitations: [],
    technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering"] },
    lockedDates: [],
    recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 240 },
    dhTechnicalTier: "intermediate",
  };
}
function plan(races: PlanInputRace[]): PlanV2InMemory {
  let n = 0;
  const r = generatePlanV2InMemory({ block: { sequenceNumber: 1, name: "P", mode: "UNSPECIFIED", primaryFocus: "T", startDate: "2026-10-05", endDate: "2026-11-15" }, snapshot: snapshot(races), mintId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` });
  if (r.status !== "generated") throw new Error("plan");
  return r.plan;
}
const roles = (p: PlanV2InMemory) => p.weeks.map((w) => `${w.weekType}/${w.doseSummary.progression?.role ?? "-"}`);
const sessions = (p: PlanV2InMemory) => p.weeks.map((w) => w.sessions.map((s) => `${s.date}:${s.kind}:${s.loadProfile ?? "-"}:${s.durationMin ?? "-"}`).join(","));
// Week 4 = 2026-10-26..2026-11-01: a weekend race.
const race = (priority: PlanInputRace["priority"]): PlanInputRace => ({ eventName: "Test race", startDate: "2026-10-31", endDate: "2026-11-01", priority });

describe("A09 — race priority and the V2 macro plan", () => {
  it("B and A+: the existing race / taper / race-specific weeks around the race (unchanged)", () => {
    for (const priority of ["A_PLUS", "A", "B"] as const) {
      const r = roles(plan([race(priority)]));
      expect(r.slice(1, 4), priority).toEqual(["development/race_specific", "taper/taper", "race/race"]);
    }
  });

  it("C: no race, taper or race-specific week — the macro plan is exactly the plan without the race", () => {
    const withC = plan([race("C")]);
    const without = plan([]);
    expect(roles(withC)).toEqual(roles(without));
    expect(sessions(withC)).toEqual(sessions(without));
    expect(roles(withC).some((x) => /race|taper/.test(x))).toBe(false);
  });

  it("a C race next to a B race: only the B race shapes the plan", () => {
    const b = race("B");
    expect(roles(plan([{ ...race("C"), startDate: "2026-10-17", endDate: "2026-10-18" }, b]))).toEqual(roles(plan([b])));
  });
});
