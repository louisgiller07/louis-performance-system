import { describe, expect, it } from "vitest";
import type { AvailabilityWindow } from "../performanceSetup/availabilityRepo";
import { durationLabel, emptyWeek, hasAnyAvailability, isLegacyAvailability, optionsWith, PHYSICAL_OPTIONS, weekFromWindows, weekSummary, windowsFromWeek } from "./trainingAvailability";

const w = (dayOfWeek: AvailabilityWindow["dayOfWeek"], startTime: string, endTime: string, activity: AvailabilityWindow["activity"]): AvailabilityWindow => ({
  id: `${dayOfWeek}-${activity}-${startTime}`,
  dayOfWeek,
  startTime,
  endTime,
  label: null,
  activity,
});

describe("BUG-V2-1 — physical / riding week", () => {
  it("Case A week → one typed window per day and activity (physical evening, riding from the morning)", () => {
    const week = emptyWeek();
    week[1].physical = 80;
    week[2].physical = 90;
    week[4].physical = 80;
    week[6].riding = 600;
    week[0].riding = 600;
    expect(windowsFromWeek(week)).toEqual([
      { dayOfWeek: 1, startTime: "18:00", endTime: "19:20", activity: "physical" },
      { dayOfWeek: 2, startTime: "18:00", endTime: "19:30", activity: "physical" },
      { dayOfWeek: 4, startTime: "18:00", endTime: "19:20", activity: "physical" },
      { dayOfWeek: 6, startTime: "08:00", endTime: "18:00", activity: "riding" },
      { dayOfWeek: 0, startTime: "08:00", endTime: "18:00", activity: "riding" },
    ]);
  });

  it("a day may carry both a physical and a riding window", () => {
    const week = emptyWeek();
    week[6] = { physical: 45, riding: 240 };
    expect(windowsFromWeek(week)).toEqual([
      { dayOfWeek: 6, startTime: "18:00", endTime: "18:45", activity: "physical" },
      { dayOfWeek: 6, startTime: "08:00", endTime: "12:00", activity: "riding" },
    ]);
  });

  it("round-trips: saved typed windows → the same week (longest window per day and activity)", () => {
    const saved = [w(1, "18:00", "19:20", "physical"), w(1, "07:00", "07:30", "physical"), w(6, "08:00", "18:00", "riding")];
    const week = weekFromWindows(saved, ["Tuesday"]);
    expect(week[1]).toEqual({ physical: 80, riding: 0 });
    expect(week[6]).toEqual({ physical: 0, riding: 600 });
    expect(week[2]).toEqual({ physical: 0, riding: 0 }); // typed data saved: onboarding riding days are not re-applied
  });

  it("a legacy profile ('any' windows): short windows offered as physical, long ones (> 2 h) as riding, onboarding riding days as full riding days", () => {
    const legacy = [w(1, "18:00", "19:30", "any"), w(2, "17:00", "21:00", "any"), w(6, "08:00", "18:00", "any")];
    expect(isLegacyAvailability(legacy)).toBe(true);
    const week = weekFromWindows(legacy, ["Saturday", "Sunday"]);
    expect(week[1]).toEqual({ physical: 90, riding: 0 });
    expect(week[2]).toEqual({ physical: 0, riding: 240 });
    expect(week[6]).toEqual({ physical: 0, riding: 600 });
    expect(week[0]).toEqual({ physical: 0, riding: 600 });
  });

  it("a new rider starts from the onboarding riding days; no availability means nothing to save", () => {
    expect(weekFromWindows([], ["Saturday"])[6]).toEqual({ physical: 0, riding: 600 });
    expect(isLegacyAvailability([])).toBe(false);
    expect(hasAnyAvailability(emptyWeek())).toBe(false);
    expect(windowsFromWeek(emptyWeek())).toEqual([]);
  });

  it("keeps a saved non-preset duration selectable and labels durations in French", () => {
    expect(optionsWith(PHYSICAL_OPTIONS, 80).map((o) => o.label)).toContain("1 h 20");
    expect(optionsWith(PHYSICAL_OPTIONS, 90)).toBe(PHYSICAL_OPTIONS);
    expect([durationLabel(45), durationLabel(60), durationLabel(80), durationLabel(240), durationLabel(600)]).toEqual(["45 min", "1 h", "1 h 20", "Demi-journée", "Journée"]);
  });

  it("summarises the week per activity, Monday first", () => {
    const week = emptyWeek();
    week[2].physical = 90;
    week[1].physical = 90;
    week[0].riding = 600;
    week[6].riding = 600;
    expect(weekSummary(week)).toEqual(["Physique · Lun 1 h 30, Mar 1 h 30", "Vélo · Sam Journée, Dim Journée"]);
  });
});

// P1 riding days single source — the riding days shown are exactly the days the planner can ride on.
import { ridingDaysFromWindows } from "./trainingAvailability";
import { windowServes } from "../../../../planning-engine/src/pipeline/availabilityActivity.ts";

describe("P1 — ridingDaysFromWindows mirrors the planner's windowServes(window, 'riding')", () => {
  const w = (id: string, dayOfWeek: AvailabilityWindow["dayOfWeek"], startTime: string, endTime: string, activity: AvailabilityWindow["activity"]): AvailabilityWindow => ({ id, dayOfWeek, startTime, endTime, label: null, activity });
  const DOW_TO_DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
  // What the planner sees: buildPlanInputSnapshot passes "physical" / "riding" through and drops "any" (a legacy window serves both).
  const plannerRidingDays = (windows: AvailabilityWindow[]) => {
    const dows = new Set(windows.filter((x) => windowServes({ dayOfWeek: x.dayOfWeek, startTime: x.startTime, endTime: x.endTime, ...(x.activity === "any" ? {} : { activity: x.activity }) }, "riding")).map((x) => x.dayOfWeek));
    return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].filter((d) => dows.has(DOW_TO_DAY.indexOf(d as (typeof DOW_TO_DAY)[number]) as AvailabilityWindow["dayOfWeek"]));
  };

  it("riding → a riding day; physical alone → never; legacy any → a riding day whatever its length (no web threshold)", () => {
    const cases: AvailabilityWindow[][] = [
      [w("a", 6, "08:00", "18:00", "riding"), w("b", 0, "08:00", "10:00", "riding")],
      [w("a", 2, "18:00", "19:30", "physical")],
      [w("a", 2, "18:00", "19:00", "any"), w("b", 6, "08:00", "18:00", "any")],
      [w("a", 1, "18:00", "19:30", "physical"), w("b", 1, "08:00", "10:00", "riding"), w("c", 3, "18:00", "19:00", "physical")],
      [],
    ];
    for (const windows of cases) expect(ridingDaysFromWindows(windows)).toEqual(plannerRidingDays(windows));
    expect(ridingDaysFromWindows(cases[1]!)).toEqual([]);
    expect(ridingDaysFromWindows(cases[2]!)).toEqual(["Tuesday", "Saturday"]);
    expect(ridingDaysFromWindows(cases[0]!)).toEqual(["Saturday", "Sunday"]);
  });
});
