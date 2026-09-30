import { describe, expect, it } from "vitest";
import {
  adaptationFrom,
  calendarMondays,
  completionOn,
  initialMonday,
  latestDecisionByDate,
  planWeekAt,
  programWeekDays,
  sessionFocus,
  sessionTitle,
  splitByToday,
} from "./programPresentation";
import { completed, DECISION, drill, exercise, plan, session, TODAY } from "./programFixtures";

describe("sessionTitle / sessionFocus", () => {
  it("translates the session kind; an unknown kind gets the neutral label, never the raw value", () => {
    expect(sessionTitle(session(TODAY))).toBe("DH technique");
    expect(sessionTitle(session(TODAY, { kind: "FUTURE_KIND" }))).not.toMatch(/FUTURE_KIND/);
  });

  it("Focus is the first drill / exercise of the stored prescription, in French", () => {
    expect(sessionFocus(session(TODAY, { prescription: drill("braking_progressive_control") }))).toBe("Freinage progressif");
    expect(sessionFocus(session(TODAY, { prescription: exercise("goblet_squat") }))).toBe("Goblet squat");
  });

  it("no prescription, an unknown id or another domain: no Focus (never an invented objective)", () => {
    expect(sessionFocus(session(TODAY))).toBeNull();
    expect(sessionFocus(session(TODAY, { prescription: drill("future_drill") }))).toBeNull();
    expect(sessionFocus(session(TODAY, { prescription: { id: "p", generatedPlanSessionId: "s", structure: { domain: "aerobic" } } }))).toBeNull();
  });
});

describe("planWeekAt — 'Semaine N / M' and the stored week type", () => {
  it("positions a date among the plan's own weeks", () => {
    const review = plan([]);
    expect(planWeekAt(review, TODAY)).toMatchObject({ position: 1, total: 2, phase: "Développement" });
    expect(planWeekAt(review, "2026-10-28")).toMatchObject({ position: 2, total: 2, phase: "Affûtage" });
  });

  it("outside the plan: null", () => {
    expect(planWeekAt(plan([]), "2026-11-02")).toBeNull();
  });
});

describe("calendar weeks (Monday → Sunday)", () => {
  it("covers every calendar week overlapping the horizon, even when plan weeks run Thursday → Wednesday", () => {
    const review = plan([]);
    const thuToWed = { ...review, version: { ...review.version, horizonStartDate: "2026-10-22", horizonEndDate: "2026-11-04" } };
    expect(calendarMondays(thuToWed)).toEqual(["2026-10-19", "2026-10-26", "2026-11-02"]);
  });

  it("opens on the current week, else the closest end of the plan", () => {
    const mondays = ["2026-10-19", "2026-10-26"];
    expect(initialMonday(mondays, TODAY)).toBe("2026-10-19");
    expect(initialMonday(mondays, "2026-09-29")).toBe("2026-10-19");
    expect(initialMonday(mondays, "2026-12-01")).toBe("2026-10-26");
  });

  it("builds the week in Today's strip language: today, performed, planned, race", () => {
    const review = plan([session("2026-10-20"), session(TODAY), session("2026-10-24", { kind: "STRENGTH_LOWER" })]);
    const days = programWeekDays("2026-10-19", TODAY, review, [completed("2026-10-20", "done")], [
      { eventName: "iXS Lenzerheide", startDate: "2026-10-25", endDate: "2026-10-25", priority: "A" },
    ]);
    expect(days.map((day) => day.date)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(days[1]).toMatchObject({ isPast: true, performed: true, plannedLabel: "DH technique" });
    expect(days[3]).toMatchObject({ isToday: true, performed: false });
    expect(days[5]).toMatchObject({ plannedLabel: "Renfo bas du corps", plannedDurationMin: 90 });
    expect(days[6]).toMatchObject({ planned: null, race: "iXS Lenzerheide" });
  });

  it("a skipped session is never shown as performed", () => {
    const days = programWeekDays("2026-10-19", TODAY, plan([session("2026-10-20")]), [completed("2026-10-20", "skipped")], []);
    expect(days[1]!.performed).toBe(false);
  });
});

describe("splitByToday / completionOn", () => {
  it("today, upcoming (chronological), past (most recent first)", () => {
    const review = plan([session("2026-10-28"), session("2026-10-20"), session(TODAY), session("2026-10-21"), session("2026-10-24")]);
    const split = splitByToday(review, TODAY);
    expect(split.today?.date).toBe(TODAY);
    expect(split.upcoming.map((s) => s.date)).toEqual(["2026-10-24", "2026-10-28"]);
    expect(split.past.map((s) => s.date)).toEqual(["2026-10-21", "2026-10-20"]);
  });

  it("the most informative recorded completion of the day; none → null", () => {
    expect(completionOn("2026-10-20", [completed("2026-10-20", "skipped"), completed("2026-10-20", "partial")])).toBe("partial");
    expect(completionOn("2026-10-21", [completed("2026-10-20", "done")])).toBeNull();
  });
});

describe("decisions and adaptations (today and past only)", () => {
  const row = (decisionDate: string, createdAt: string, dailyPlan: unknown) => ({
    id: `${decisionDate}-${createdAt}`,
    decisionDate,
    createdAt,
    finalSessionDb: "DH_TECHNICAL",
    activeModeDb: null,
    confidenceLevelDb: null,
    dailyPlan,
  });

  it("keeps the latest valid decision of each day (append-only decisions)", () => {
    const keep = { ...DECISION, decision: "KEEP" as const };
    const map = latestDecisionByDate([row(TODAY, "2026-10-22T07:00:00Z", keep), row(TODAY, "2026-10-22T09:00:00Z", DECISION), row("2026-10-21", "2026-10-21T07:00:00Z", { broken: true })]);
    expect(map.get(TODAY)?.decision).toBe("MODIFY");
    expect(map.has("2026-10-21")).toBe(false);
  });

  it("an adaptation shows planned → adapted with the Today 'Pourquoi' wording", () => {
    expect(adaptationFrom(DECISION)).toEqual({
      planned: DECISION.planned_session_before,
      adapted: DECISION.final_session,
      why: "Signal détecté : fatigue jambes élevée. La charge est ajustée pour préserver ton objectif.",
    });
  });

  it("KEEP, no planned session or no decision: no adaptation", () => {
    expect(adaptationFrom({ ...DECISION, decision: "KEEP" })).toBeNull();
    expect(adaptationFrom({ ...DECISION, planned_session_before: null })).toBeNull();
    expect(adaptationFrom(undefined)).toBeNull();
  });
});
