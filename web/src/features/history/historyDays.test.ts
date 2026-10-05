import { describe, expect, it } from "vitest";
import { isValidDailyPlan } from "../dailyPlan/dailyPlanValidation";
import { buildHistoryDays, dayOutcome, hasHealthSignal, historyZones, isSafetyRest, journeyFacts } from "./historyDays";
import { checkin, completed, decision, JOURNEY_ROWS, KEEP_PLAN, MODIFY_PLAN, SAFETY_REST_PLAN, TODAY, UNPLANNED_PLAN } from "./historyFixtures";

describe("fixtures", () => {
  it("are valid stored DailyPlans", () => {
    for (const plan of [KEEP_PLAN, MODIFY_PLAN, SAFETY_REST_PLAN, UNPLANNED_PLAN]) expect(isValidDailyPlan(plan)).toBe(true);
  });
});

describe("buildHistoryDays — one day per date", () => {
  it("groups same-day decisions: the latest valid one is the day, all stay reachable oldest first", () => {
    const days = buildHistoryDays(JOURNEY_ROWS, [], [], []);

    expect(days.map((day) => day.date)).toEqual(["2026-09-29", "2026-09-28", "2026-09-24"]);
    const monday = days[1]!;
    expect(monday.main.id).toBe("d-28c");
    expect(monday.dailyPlan?.decision).toBe("REST");
    expect(monday.decisions.map((row) => row.id)).toEqual(["d-28a", "d-28b", "d-28c"]);
  });

  it("a newer malformed row never hides an older valid decision of the same day", () => {
    const days = buildHistoryDays([decision("new", TODAY, "12:00", { broken: true }), decision("old", TODAY, "08:00", KEEP_PLAN)], [], [], []);

    expect(days[0]!.main.id).toBe("old");
    expect(days[0]!.decisions).toHaveLength(2);
  });

  it("a day with only legacy rows is kept, degraded", () => {
    const days = buildHistoryDays([decision("legacy", TODAY, "08:00", null)], [], [], []);

    expect(days[0]!.dailyPlan).toBeNull();
    expect(dayOutcome(days[0]!).kind).toBe("unknown");
  });

  it("attaches the day's check-in, recorded session and race", () => {
    const race = { eventName: "iXS Lenzerheide", startDate: "2026-09-28", endDate: "2026-09-28", priority: "A" as const };
    const days = buildHistoryDays(JOURNEY_ROWS, [checkin("2026-09-28")], [completed("2026-09-24", "done")], [race]);

    expect(days[1]!.checkin?.checkin_date).toBe("2026-09-28");
    expect(days[1]!.race?.eventName).toBe("iXS Lenzerheide");
    expect(days[2]!.completed?.completion_status).toBe("done");
    expect(days[0]!.checkin).toBeNull();
  });
});

describe("day outcome and state", () => {
  it("adapted / kept / unplanned, from what the Head Coach had planned when deciding", () => {
    expect(dayOutcome({ dailyPlan: MODIFY_PLAN }).kind).toBe("adapted");
    expect(dayOutcome({ dailyPlan: SAFETY_REST_PLAN }).kind).toBe("adapted");
    expect(dayOutcome({ dailyPlan: KEEP_PLAN }).kind).toBe("kept");
    expect(dayOutcome({ dailyPlan: UNPLANNED_PLAN }).kind).toBe("unplanned");
  });

  it("health signal and safety rest come from the stored decision only", () => {
    expect(hasHealthSignal({ dailyPlan: SAFETY_REST_PLAN })).toBe(true);
    expect(hasHealthSignal({ dailyPlan: MODIFY_PLAN })).toBe(false);
    expect(isSafetyRest({ dailyPlan: SAFETY_REST_PLAN })).toBe(true);
    expect(isSafetyRest({ dailyPlan: { ...MODIFY_PLAN, decision: "REST" } })).toBe(false);
  });
});

describe("historyZones — calendar week Monday → Sunday", () => {
  it("today, this week before today, older by month", () => {
    const zones = historyZones(buildHistoryDays([...JOURNEY_ROWS, decision("d-aug", "2026-08-30", "08:00", KEEP_PLAN)], [], [], []), TODAY);

    expect(zones.today?.date).toBe(TODAY);
    expect(zones.week.map((day) => day.date)).toEqual(["2026-09-28"]);
    expect(zones.older.map((month) => [month.key, month.days.map((day) => day.date)])).toEqual([
      ["2026-09", ["2026-09-24"]],
      ["2026-08", ["2026-08-30"]],
    ]);
  });

  it("on a Monday, the previous days are already 'older'", () => {
    const zones = historyZones(buildHistoryDays(JOURNEY_ROWS, [], [], []), "2026-10-05");

    expect(zones.today).toBeNull();
    expect(zones.week).toEqual([]);
    expect(zones.older[0]!.days).toHaveLength(3);
  });
});

describe("journeyFacts — plain counts only", () => {
  it("counts analysed days, adaptations, safety rests, recorded and unrecorded sessions since the first loaded day", () => {
    const days = buildHistoryDays([...JOURNEY_ROWS, decision("d-23", "2026-09-23", "08:00", MODIFY_PLAN)], [], [completed("2026-09-24", "partial")], []);

    expect(journeyFacts(days, TODAY)).toEqual({
      since: "2026-09-23",
      analysedDays: 4,
      adaptations: 1,
      safetyRests: 1,
      recordedSessions: 1,
      unrecordedSessions: 2,
    });
  });

  it("today's session is never counted as unrecorded; nothing loaded → null", () => {
    const days = buildHistoryDays([decision("t", TODAY, "08:00", KEEP_PLAN)], [], [], []);

    expect(journeyFacts(days, TODAY)?.unrecordedSessions).toBe(0);
    expect(journeyFacts([], TODAY)).toBeNull();
  });
});

describe("UX-11R.9 — guided completions in History", () => {
  const guided = (date: string) => ({ executionId: `exec-${date}`, sessionDate: date, decisionId: "dec", finalPrescriptionId: "fp" });

  it("V2 completed only: the day carries the guided completion and counts as recorded", () => {
    const days = buildHistoryDays([decision("d-24", "2026-09-24", "08:00", KEEP_PLAN)], [], [], [], [guided("2026-09-24")]);
    expect(days[0]!.guided).toMatchObject({ executionId: "exec-2026-09-24" });
    expect(journeyFacts(days, TODAY)).toMatchObject({ recordedSessions: 1, unrecordedSessions: 0 });
  });

  it("legacy + V2 (history): the legacy record wins, no guided entry; V1 legacy only is unchanged", () => {
    const both = buildHistoryDays([decision("d-24", "2026-09-24", "08:00", KEEP_PLAN)], [], [completed("2026-09-24", "done")], [], [guided("2026-09-24")]);
    expect(both[0]!.guided).toBeNull();
    expect(both[0]!.completed).not.toBeNull();
    const legacyOnly = buildHistoryDays([decision("d-24", "2026-09-24", "08:00", KEEP_PLAN)], [], [completed("2026-09-24", "done")], []);
    expect(legacyOnly[0]!.guided).toBeNull();
    expect(journeyFacts(legacyOnly, TODAY)?.recordedSessions).toBe(1);
  });

  it("V2 started or abandoned never reaches the guided list: a past planned day stays unrecorded", () => {
    const days = buildHistoryDays([decision("d-24", "2026-09-24", "08:00", KEEP_PLAN)], [], [], [], []);
    expect(days[0]!.guided).toBeNull();
    expect(journeyFacts(days, TODAY)?.unrecordedSessions).toBe(1);
  });
});
