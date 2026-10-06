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
