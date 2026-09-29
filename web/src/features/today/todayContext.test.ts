import { describe, expect, it } from "vitest";
import { daysBetween, firstNameFrom, nextPlannedSession, raceHorizon, weekCheckinCount, weekDates, weekSummary } from "./todayContext";
import type { RaceOverlayEvent } from "../planning/raceOverlayRepo";
import type { PlannedSessionRow } from "../planning/planningTypes";
import type { CompletedSessionRecord } from "../completedSession/completedSessionTypes";

const race = (eventName: string, startDate: string, endDate = startDate): RaceOverlayEvent => ({ eventName, startDate, endDate, priority: "A" });
const planned = (planned_date: string, kind: string | null): PlannedSessionRow =>
  ({
    planned_date,
    session_type: kind === "REST" ? "REST" : "DH_TRAINING",
    intervention: kind ? { kind, load_profile: "MODERATE", duration_min: 60 } : null,
    planned_intent: null,
    is_committed: false,
    source: "manual",
  }) as unknown as PlannedSessionRow;
const done = (session_date: string, completion_status: string) => ({ session_date, completion_status }) as unknown as CompletedSessionRecord;

describe("firstNameFrom (validated: first word of the profile name)", () => {
  it.each([
    ["Louis Giller", "Louis"],
    ["  Louis  ", "Louis"],
    ["", null],
    [null, null],
  ])("%s → %s", (name, expected) => expect(firstNameFrom(name)).toBe(expected));
});

describe("raceHorizon (validated display rule)", () => {
  const today = "2026-09-29";
  it("under 120 days: countdown J-XX", () => {
    expect(raceHorizon([race("iXS Lenzerheide", "2026-10-11")], today)).toMatchObject({ kind: "countdown", days: 12 });
    expect(raceHorizon([race("A", "2027-01-26")], today)).toMatchObject({ kind: "countdown", days: 119 });
  });
  it("120 to 365 days: next objective", () => {
    expect(raceHorizon([race("A", "2027-01-27")], today)).toMatchObject({ kind: "horizon", days: 120 });
    expect(raceHorizon([race("A", "2027-09-29")], today)).toMatchObject({ kind: "horizon", days: 365 });
  });
  it("beyond 365 days, or no race: nothing", () => {
    expect(raceHorizon([race("A", "2027-09-30")], today)).toBeNull();
    expect(raceHorizon([], today)).toBeNull();
  });
  it("a race in progress is shown as such, with its day number; the closest upcoming race wins otherwise", () => {
    expect(raceHorizon([race("iXS", "2026-09-28", "2026-09-30")], today)).toMatchObject({ kind: "ongoing", day: 2 });
    expect(raceHorizon([race("Later", "2026-11-01"), race("Sooner", "2026-10-05"), race("Past", "2026-09-01")], today)).toMatchObject({
      kind: "countdown",
      race: { eventName: "Sooner" },
    });
  });
});

describe("weekDates — Monday to Sunday", () => {
  it("from a Tuesday, a Sunday and a Monday", () => {
    expect(weekDates("2026-09-29")).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(weekDates("2026-10-04")[0]).toBe("2026-09-28");
    expect(weekDates("2026-09-28")[6]).toBe("2026-10-04");
    expect(daysBetween("2026-09-29", "2026-10-11")).toBe(12);
  });
});

describe("weekSummary — plain counts, no score", () => {
  it("planned counts training sessions of this week only (not REST); performed counts done / partial / replaced, never skipped", () => {
    const summary = weekSummary(
      "2026-09-29",
      [planned("2026-09-28", "DH_TECHNICAL"), planned("2026-09-30", "REST"), planned("2026-10-01", "STRENGTH_LOWER"), planned("2026-10-06", "DH_TECHNICAL")],
      [done("2026-09-28", "done"), done("2026-09-29", "skipped")],
      [race("Swiss Cup", "2026-10-03", "2026-10-04")]
    );
    expect(summary.plannedCount).toBe(2);
    expect(summary.performedCount).toBe(1);
    expect(summary.days.map((day) => day.planned)).toEqual(["DH", null, "Repos", "Force", null, null, null]);
    expect(summary.days[0]).toMatchObject({ performed: true, isPast: true });
    expect(summary.days[1]).toMatchObject({ isToday: true, performed: false });
    expect(summary.days[5]!.race).toBe("Swiss Cup");
    // UX-05 — full label and duration for the tapped-day detail.
    expect(summary.days[3]).toMatchObject({ plannedLabel: "Renfo bas du corps", plannedDurationMin: 60 });
  });

  it("a legacy planned row without intervention still counts, labelled neutrally", () => {
    expect(weekSummary("2026-09-29", [planned("2026-09-29", null)], [], []).days[1]!.planned).toBe("Séance");
  });
});

describe("nextPlannedSession", () => {
  it("the first training session strictly after today (REST skipped)", () => {
    expect(nextPlannedSession([planned("2026-09-29", "DH_TECHNICAL"), planned("2026-09-30", "REST"), planned("2026-10-02", "AEROBIC_BASE")], "2026-09-29")?.planned_date).toBe(
      "2026-10-02"
    );
    expect(nextPlannedSession([planned("2026-09-28", "DH_TECHNICAL")], "2026-09-29")).toBeNull();
  });
});

describe("weekCheckinCount (UX-05) — a plain count, no streak", () => {
  it("distinct days Monday → today with a saved check-in; today's fresh save is counted once", () => {
    const dates = ["2026-09-28", "2026-09-28", "2026-09-29", "2026-09-27", "2026-10-01"];
    expect(weekCheckinCount(dates, "2026-09-29", false)).toBe(2);
    expect(weekCheckinCount(dates, "2026-09-29", true)).toBe(2);
    expect(weekCheckinCount(["2026-09-28"], "2026-09-29", true)).toBe(2);
    expect(weekCheckinCount([], "2026-09-29", false)).toBe(0);
  });
});
