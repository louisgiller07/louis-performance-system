import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
// Real M1 plans (same cross-boundary import pattern as sportSafeRelease01.test.tsx).
import { buildDailyPlan } from "../../../../head-coach-engine/src/engine/buildDailyPlan.js";
import { baseRawContext } from "../../../../head-coach-engine/fixtures/louis.js";
import { MissionHero } from "../dailyPlan/MissionHero";
import { WITHOUT_PLANNED_SESSION_SENTENCE, withoutPlannedSessionOf } from "../dailyPlan/withoutPlannedSession";
import { effectiveDays } from "../effectiveSession/effectiveDay";
import { WeekStrip } from "./WeekStrip";
import { weekSummary, type TodayRace } from "./todayContext";
import { NO_RACE_PROTOCOL_SENTENCE, RaceBanner } from "./RaceBanner";
import { translateExplanation } from "../trainingPlanReview/trainingPlanExplanationLabels";
import { describeRelaxedConstraints } from "../trainingPlanReview/placementReasonLabels";
import type { DailyPlan } from "../dailyPlan/dailyPlanTypes";
import type { DecisionHistoryRow } from "../history/historyTypes";

// SPORT-RACE-01P (HPM 2026-10-19), presentation only:
// 1. a V2 day without a planned session keeps M1's recommendation as advice: never M1's duration (e.g. the V1 DH
//    window « 4 h ») shown as a prescription, and a sentence says so; a created prescription is unchanged;
// 2. in the seven days before a race whose format has no protocol, Today says that no specific preparation is defined;
// 3. the plan's new explanation is translated.

const TODAY = "2026-11-15";
const HOT_TRAIL = { event_name: "Course 2 jours", event_start: "2026-11-21", event_end: "2026-11-22", priority: "A", race_format: "HOT_TRAIL_2DAY" };
// J-6 of a HOT_TRAIL_2DAY race without a planned session: M1's T-X DH_TECHNICAL MODERATE, its V1 window (240 min).
const T6 = buildDailyPlan(baseRawContext({ today: TODAY, planned_session: null, active_mode: "UNSPECIFIED" as never, upcoming_races: [HOT_TRAIL] as never })) as unknown as DailyPlan;
const NO_PLANNED = { kind: "blocked" as const, code: "final_prescription_no_lineage", detail: { reason: "no_planned_session" } };

describe("SPORT-RACE-01P — a day without a planned session is advice, never M1's duration as a prescription", () => {
  it("M1 recommends the T-X DH with its V1 window (240 min) at J-6", () => {
    expect([T6.decision, T6.final_session.kind, T6.final_session.load_profile, T6.final_session.duration_min]).toEqual(["KEEP", "DH_TECHNICAL", "MODERATE", 240]);
  });

  it("only a blocked no_planned_session day, and never a REST or the race activity", () => {
    expect(withoutPlannedSessionOf(NO_PLANNED, T6.final_session)).toBe(true);
    expect(withoutPlannedSessionOf(NO_PLANNED, { kind: "REST" })).toBe(false);
    expect(withoutPlannedSessionOf(NO_PLANNED, { kind: "RACE_ACTIVITY" })).toBe(false);
    expect(withoutPlannedSessionOf({ kind: "blocked", code: "final_prescription_adaptation_not_defined", detail: { reason: "modify_not_supported" } }, T6.final_session)).toBe(false);
    expect(withoutPlannedSessionOf({ kind: "not_required" }, T6.final_session)).toBe(false);
    expect(withoutPlannedSessionOf(undefined, T6.final_session)).toBe(false);
  });

  it("Today's mission: the DH and its load, without « 4 h », and the advice sentence", () => {
    render(<MissionHero dailyPlan={T6} withoutPlannedSession />);
    const hero = screen.getByRole("region", { name: /DH technique/i });
    expect(hero.textContent).not.toMatch(/4\s?h/);
    expect(hero.textContent).toMatch(/charge modérée/i);
    expect(screen.getByTestId("without-planned-session").textContent).toBe(WITHOUT_PLANNED_SESSION_SENTENCE);
  });

  it("counter-proof: the same recommendation outside this case keeps its duration", () => {
    render(<MissionHero dailyPlan={T6} />);
    expect(screen.getByRole("region", { name: /DH technique/i }).textContent).toMatch(/4\s?h/);
    expect(screen.queryByTestId("without-planned-session")).toBeNull();
  });

  const advice = (date: string) =>
    ({ id: `d-${date}`, decisionDate: date, createdAt: `${date}T07:00:00Z`, finalSessionDb: "DH_TECHNICAL", activeModeDb: null, confidenceLevelDb: null, dailyPlan: { ...T6, date }, finalPrescriptionStatus: "blocked", finalPrescriptionStatusCode: "final_prescription_no_lineage", finalPrescriptionStatusDetail: { reason: "no_planned_session" } }) as unknown as DecisionHistoryRow;
  const WEEK = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", TODAY];

  it("« Cette semaine »: the day reads « Pas de séance guidée », without M1's duration", () => {
    const effective = effectiveDays(WEEK, { decisions: [advice(TODAY)], executions: [], legacy: [], planned: [] });
    expect(effective.at(-1)).toMatchObject({ noGuidedSession: true, adviceOnly: true });
    const summary = weekSummary(TODAY, [], [], [], [], effective);
    expect(summary.days.at(-1)).toMatchObject({ plannedLabel: "DH technique", plannedDurationMin: null, noGuidedSession: true, adviceOnly: true });
    render(<MemoryRouter><WeekStrip week={summary} /></MemoryRouter>);
    expect(document.querySelector("[aria-live='polite']")!.textContent!.replace(/ /g, " ")).toBe("Aujourd'huiDH techniquePas de séance guidée");
  });

  it("AR-D — the counters: a planned session counts, M1's advice on a day without a planned session does not, and is never « ○ prévue »", () => {
    // Saturday 14: advice only (past day); Sunday 15 (today): advice only; Wednesday 11: a real planned session.
    const plannedRow = { planned_date: "2026-11-11", session_type: "STRENGTH_LOWER", intervention: { kind: "STRENGTH_LOWER", load_profile: "LIGHT", duration_min: 45 }, planned_intent: null, is_committed: false, source: "generated" };
    const effective = effectiveDays(WEEK, { decisions: [advice("2026-11-14"), advice(TODAY)], executions: [], legacy: [], planned: [{ date: "2026-11-11", session: plannedRow.intervention as never }] });
    const summary = weekSummary(TODAY, [plannedRow as never], [], [], [], effective);
    expect([summary.plannedCount, summary.performedCount]).toEqual([1, 0]);
    render(<MemoryRouter><WeekStrip week={summary} /></MemoryRouter>);
    expect(screen.getAllByRole("button").slice(0, 7).map((b) => b.textContent)).toEqual(["L·", "M·", "M○", "J·", "V·", "S·", "D●"]);
  });
});

describe("SPORT-RACE-01P / 01P.3 — a race without a protocol: no specific preparation is defined", () => {
  const race = (raceFormat: string | null, startDate: string, series: string | null = null): TodayRace => ({ eventName: "Swiss Cup DH", startDate, endDate: startDate, priority: "A", location: null, raceFormat, series });
  it("within seven days, for any race without a protocol: no format, Swiss / UCI, French national or regional, and a legacy 2 / 3-day row without its competition (01P.3)", () => {
    const cases: [string | null, string | null][] = [
      ["OTHER", null],
      ["SWISS_CUP", null],
      ["UCI_WC", null],
      [null, null],
      ["HOT_TRAIL_2DAY", null],
      ["IXS_3DAY", null],
      ["HOT_TRAIL_2DAY", "Hot Trail Series (Swiss DH Cup)"],
      ["OTHER", "FR_COUPE_DE_FRANCE_DH"],
      ["OTHER", "FR_CHAMPIONNAT_DE_FRANCE_DH"],
      ["OTHER", "FR_REGIONAL_DH"],
      ["OTHER", "SWISS_OTHER"],
    ];
    for (const [format, series] of cases) {
      const { unmount } = render(<RaceBanner horizon={{ kind: "countdown", race: race(format, "2026-11-21", series), days: 5 }} objective={null} />);
      expect(screen.getByTestId("no-race-protocol").textContent, `${format} / ${series}`).toBe(NO_RACE_PROTOCOL_SENTENCE);
      unmount();
    }
  });

  it("never for a race explicitly identified as the Hot Trail Series or iXS, nor beyond seven days", () => {
    render(<RaceBanner horizon={{ kind: "countdown", race: race("HOT_TRAIL_2DAY", "2026-11-21", "HOT_TRAIL_SERIES"), days: 5 }} objective={null} />);
    expect(screen.queryByTestId("no-race-protocol")).toBeNull();
    render(<RaceBanner horizon={{ kind: "countdown", race: race("IXS_3DAY", "2026-11-21", "IXS"), days: 5 }} objective={null} />);
    expect(screen.queryByTestId("no-race-protocol")).toBeNull();
    render(<RaceBanner horizon={{ kind: "countdown", race: race("OTHER", "2026-11-30"), days: 10 }} objective={null} />);
    expect(screen.queryByTestId("no-race-protocol")).toBeNull();
  });
});

describe("SPORT-RACE-01P.2 — a session the race protocol leaves out is identifiable in the programme review", () => {
  it("the taper DH removed on J-7 (incompatible day) and on J-2 (protocol rest)", () => {
    expect(describeRelaxedConstraints([{ constraintId: "placement_shortfall", reason: "race_protocol_incompatible_day", domain: "dh_technical", date: "2026-11-14" }])).toEqual([
      "1 séance DH non placée : le protocole avant la course prévoit ce jour-là une autre séance que tes créneaux ne permettent pas.",
    ]);
    expect(describeRelaxedConstraints([{ constraintId: "placement_shortfall", reason: "race_protocol_rest_day", domain: "dh_technical", date: "2026-11-21" }])).toEqual(["1 séance DH non placée : jour de repos du protocole avant la course."]);
  });
});

describe("SPORT-RACE-01P — the plan's explanation", () => {
  it("the pre-race protocol phrase is translated", () => {
    expect(translateExplanation("Taper week ahead of an upcoming race: reduced volume versus a normal development week. Pre-race days follow the race's protocol: sessions placed where the format, the day and the availability allow.", "week").text).toMatch(/Les jours avant la course suivent son protocole/);
  });
});
