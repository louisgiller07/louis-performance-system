import { describe, expect, it } from "vitest";
import { nextSessions, planWeekCount, resumeStep } from "./firstRunPlan";
import type { AvailabilityWindow } from "../performanceSetup/availabilityRepo";
import type { PerformanceSetupAnswers } from "../performanceSetup/performanceSetupRepo";
import { plan, session } from "../program/programFixtures";

const window = (dayOfWeek: AvailabilityWindow["dayOfWeek"], startTime = "17:00", endTime = "21:00"): AvailabilityWindow => ({ id: `w-${dayOfWeek}`, dayOfWeek, startTime, endTime, label: null, activity: "any" });
const PROFILE: PerformanceSetupAnswers = { equipment: [], terrainAccess: [], strengths: [], weaknesses: [], priorityAreas: [], strengthExperienceTier: null, dhTechnicalTier: null, seasonObjective: null };

describe("resumeStep", () => {
  const base = { hasActivePlan: false, latestDraftId: null, windows: [window(1)], profile: { ...PROFILE, terrainAccess: ["flow_trail"], dhTechnicalTier: "intermediate", priorityAreas: ["cornering"], strengthExperienceTier: "beginner" } as PerformanceSetupAnswers };

  it("an active plan: nothing to do here", () => {
    expect(resumeStep({ ...base, hasActivePlan: true })).toBe("done");
  });

  it("a generated first plan is shown again rather than generating another", () => {
    expect(resumeStep({ ...base, latestDraftId: "v-1" })).toBe("ready");
  });

  it("otherwise the first missing answer", () => {
    expect(resumeStep({ ...base, windows: [] })).toBe("training");
    expect(resumeStep({ ...base, profile: { ...base.profile, terrainAccess: [] } })).toBe("terrain");
    // UX-11A.5a.2b — a first run in progress asks the declared DH tier and 1–3 priorities before the renfo.
    expect(resumeStep({ ...base, profile: { ...base.profile, dhTechnicalTier: null } })).toBe("technique");
    expect(resumeStep({ ...base, profile: { ...base.profile, priorityAreas: [] } })).toBe("technique");
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
