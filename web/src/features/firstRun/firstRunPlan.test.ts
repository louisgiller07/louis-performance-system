import { describe, expect, it } from "vitest";
import { availabilityWindows, initialSlot, initialTrainingDays, isValidSlot, nextSessions, planWeekCount, presetFor, resumeStep } from "./firstRunPlan";
import type { AvailabilityWindow } from "../performanceSetup/availabilityRepo";
import type { PerformanceSetupAnswers } from "../performanceSetup/performanceSetupRepo";
import { plan, session } from "../program/programFixtures";

const window = (dayOfWeek: AvailabilityWindow["dayOfWeek"], startTime = "17:00", endTime = "21:00"): AvailabilityWindow => ({ id: `w-${dayOfWeek}`, dayOfWeek, startTime, endTime, label: null });
const PROFILE: PerformanceSetupAnswers = { equipment: [], terrainAccess: [], strengths: [], weaknesses: [], priorityAreas: [], strengthExperienceTier: null, seasonObjective: null };

describe("training days and the typical window", () => {
  it("prefills the training days with the riding days, Monday first", () => {
    expect(initialTrainingDays([], ["Sunday", "Saturday", "Tuesday"])).toEqual([2, 6, 0]);
  });

  it("an existing availability wins over the riding days", () => {
    expect(initialTrainingDays([window(3), window(1)], ["Saturday"])).toEqual([1, 3]);
  });

  it("the saved window is recognised only when every day shares it (nothing guessed)", () => {
    expect(initialSlot([window(1), window(3)])).toEqual({ start: "17:00", end: "21:00" });
    expect(presetFor(initialSlot([window(1), window(3)]))).toBe("evening");
    expect(initialSlot([window(1), window(3, "08:00", "12:00")])).toBeNull();
    expect(initialSlot([])).toBeNull();
  });

  it("a window is valid only with two times, start before end", () => {
    expect(isValidSlot({ start: "17:00", end: "21:00" })).toBe(true);
    expect(isValidSlot({ start: "21:00", end: "17:00" })).toBe(false);
    expect(isValidSlot({ start: "", end: "21:00" })).toBe(false);
    expect(isValidSlot(null)).toBe(false);
  });

  it("one typical window becomes one availability window per training day", () => {
    expect(availabilityWindows([2, 6], { start: "08:00", end: "12:00" })).toEqual([
      { dayOfWeek: 2, startTime: "08:00", endTime: "12:00" },
      { dayOfWeek: 6, startTime: "08:00", endTime: "12:00" },
    ]);
  });
});

describe("resumeStep", () => {
  const base = { hasActivePlan: false, latestDraftId: null, windows: [window(1)], profile: { ...PROFILE, terrainAccess: ["flow_trail"], strengthExperienceTier: "beginner" } as PerformanceSetupAnswers };

  it("an active plan: nothing to do here", () => {
    expect(resumeStep({ ...base, hasActivePlan: true })).toBe("done");
  });

  it("a generated first plan is shown again rather than generating another", () => {
    expect(resumeStep({ ...base, latestDraftId: "v-1" })).toBe("ready");
  });

  it("otherwise the first missing answer", () => {
    expect(resumeStep({ ...base, windows: [] })).toBe("training");
    expect(resumeStep({ ...base, profile: { ...base.profile, terrainAccess: [] } })).toBe("terrain");
    expect(resumeStep({ ...base, profile: { ...base.profile, strengthExperienceTier: null } })).toBe("strength");
    expect(resumeStep(base)).toBe("preparation");
  });
});

describe("the first plan summary", () => {
  it("the next three sessions from today, and the plan's week count", () => {
    const review = plan([session("2026-10-20"), session("2026-10-22"), session("2026-10-24"), session("2026-10-27"), session("2026-10-28")]);
    expect(nextSessions(review, "2026-10-21").map((s) => s.date)).toEqual(["2026-10-22", "2026-10-24", "2026-10-27"]);
    expect(planWeekCount(review)).toBe(2);
  });
});
