// CONSISTENCY-01 (HPM 2026-10-16) — a programme rest day on which the rider added a session after the acceptance:
// Today shows it (mission, next step, week), Programme lists the generated sessions only. Wherever the session is
// shown, it is the rider's own modification (« Modifiée par toi », V06-02), never the coach's prescription; once the
// coach replaced it or rested the day, the mark goes. Presentation only — the session itself is never touched.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MissionHero } from "./dailyPlan/MissionHero";
import type { DailyPlan } from "./dailyPlan/dailyPlanTypes";
import { NextStepCard } from "./today/NextStepCard";
import { weekSummary } from "./today/todayContext";
import { WeekDaysPicker } from "../components/WeekDaysPicker";
import type { EffectiveDay } from "./effectiveSession/effectiveDay";
import type { PlannedSessionRow } from "./planning/planningTypes";
import { programWeekDays } from "./program/programPresentation";
import { plan, session } from "./program/programFixtures";

const MONDAY = "2026-10-19";
const REST_DAY = "2026-10-21"; // the programme rests; the rider added an endurance session after accepting it
const TODAY = REST_DAY;
const RIDER_SESSION = { kind: "AEROBIC_BASE", load_profile: "LIGHT", duration_min: 45 } as const;

const riderRow = (date: string, source = "manual") =>
  ({ planned_date: date, session_type: "AEROBIC_BASE", intervention: RIDER_SESSION, planned_intent: null, is_committed: false, source }) as unknown as PlannedSessionRow;

const decided = (date: string, adaptation: EffectiveDay["adaptation"], kind = "AEROBIC_BASE"): EffectiveDay => ({
  date,
  session: { kind, load_profile: "LIGHT", duration_min: 45 } as EffectiveDay["session"],
  status: "decided",
  source: "decision",
  adaptation,
  planned: RIDER_SESSION as unknown as EffectiveDay["planned"],
  decisionId: "decision-1",
  executionId: null,
  finalPrescriptionId: null,
});

const mission = (decision: DailyPlan["decision"], rules: string[] = []): DailyPlan =>
  ({
    active_mode: "IN_SEASON",
    training: { active: true, objective: "Endurance de base." },
    dh_or_technical: { active: false },
    mental: { active: false },
    recovery: { active: false, actions: [] },
    nutrition: { active: false },
    sleep: { active: false },
    protection: { do_not_do: [] },
    monitoring: { observe: [] },
    reasoning: "Séance gardée.",
    confidence: "HIGH",
    triggered_rules: rules.map((rule_id) => ({ rule_id })),
    planned_session_before: RIDER_SESSION,
    final_session: decision === "REST" ? { kind: "REST" } : decision === "REPLACE" ? { kind: "RECOVERY_ACTIVE", load_profile: "LIGHT", duration_min: 30 } : RIDER_SESSION,
    decision,
    overrode_race_protocol: false,
    engine_version: "1.0.0",
  }) as unknown as DailyPlan;

describe("CONSISTENCY-01 — a programme rest day with the rider's own session", () => {
  it("Today's mission: « Modifiée par toi » while the mission is the rider's session (KEEP / MODIFY), never after a coach REPLACE or a rest", () => {
    const { rerender } = render(<MissionHero dailyPlan={mission("KEEP")} sessionModifiedByAthlete />);
    expect(within(screen.getByRole("region")).getByText("Modifiée par toi")).toBeInTheDocument();
    rerender(<MissionHero dailyPlan={mission("MODIFY")} sessionModifiedByAthlete />);
    expect(within(screen.getByRole("region")).getByText("Modifiée par toi")).toBeInTheDocument();
    rerender(<MissionHero dailyPlan={mission("REPLACE")} sessionModifiedByAthlete />);
    expect(within(screen.getByRole("region")).queryByText("Modifiée par toi")).not.toBeInTheDocument();
    rerender(<MissionHero dailyPlan={mission("REST", ["A7"])} sessionModifiedByAthlete />);
    expect(within(screen.getByRole("region")).queryByText("Modifiée par toi")).not.toBeInTheDocument();
    rerender(<MissionHero dailyPlan={mission("KEEP")} />); // a programme session
    expect(within(screen.getByRole("region")).queryByText("Modifiée par toi")).not.toBeInTheDocument();
  });

  it("Today's next step names it the rider's", () => {
    render(
      <MemoryRouter>
        <NextStepCard next={riderRow(REST_DAY)} today="2026-10-20" horizon={null} objective={null} />
      </MemoryRouter>
    );
    expect(screen.getByRole("region", { name: "Prochaine étape" })).toHaveTextContent("Modifiée par toi");
  });

  it("Today's week: the decided rider session and a future one are the rider's; a programme session or a coach REPLACE is not", () => {
    const rows = [riderRow(REST_DAY), riderRow("2026-10-23"), riderRow("2026-10-24", "generated"), riderRow("2026-10-25")];
    const effective = [decided(REST_DAY, null), decided("2026-10-25", "REPLACE", "RECOVERY_ACTIVE")];
    const days = weekSummary(TODAY, rows, [], [], [], effective).days;
    const byDate = new Map(days.map((d) => [d.date, d.modifiedByAthlete]));
    expect([byDate.get(REST_DAY), byDate.get("2026-10-23"), byDate.get("2026-10-24"), byDate.get("2026-10-25")]).toEqual([true, true, false, false]);

    render(<WeekDaysPicker days={days} initialIndex={days.findIndex((d) => d.date === REST_DAY)} />);
    expect(screen.getByText(/Modifiée par toi/)).toBeInTheDocument();
  });

  it("Programme's week: the decided rider session is marked; a future programme rest day stays rest (generated sessions only); a modified programme day is marked", () => {
    const review = plan([session("2026-10-20"), session("2026-10-22")]); // the programme rests on 21 and 23
    const manualDates = [REST_DAY, "2026-10-22", "2026-10-23"];
    const days = programWeekDays(MONDAY, TODAY, review, [], [], [], new Map([[REST_DAY, decided(REST_DAY, null)]]), manualDates);
    const day = (date: string) => days.find((d) => d.date === date)!;
    expect([day(REST_DAY).plannedLabel !== null, day(REST_DAY).modifiedByAthlete]).toEqual([true, true]);
    expect([day("2026-10-22").modifiedByAthlete, day("2026-10-23").planned, day("2026-10-23").modifiedByAthlete]).toEqual([true, null, false]);
    expect(day("2026-10-20").modifiedByAthlete).toBe(false);
  });
});
