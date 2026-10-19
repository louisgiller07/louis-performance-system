import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
// Real M1 plans and the real V2 A10 application (same cross-boundary import pattern as DailyPlanView.enriched.test.tsx).
import { buildDailyPlan } from "../../../../head-coach-engine/src/engine/buildDailyPlan.js";
import { baseRawContext } from "../../../../head-coach-engine/fixtures/louis.js";
import { applyV2TodayTimeConstraint } from "../../../../head-coach-engine/src/supabase/dailyV2/applyV2TodayTimeConstraint.js";
import { BODY_STATUS_LABELS, bodyStatusOf } from "../dailyPlan/bodyStatus";
import { CoachStateCard } from "../dailyPlan/CoachStateCard";
import { effectiveDays } from "../effectiveSession/effectiveDay";
import { WeekStrip } from "./WeekStrip";
import { weekSummary } from "./todayContext";
import type { DailyPlan } from "../dailyPlan/dailyPlanTypes";
import type { DecisionHistoryRow } from "../history/historyTypes";
import type { PlannedSessionRow } from "../planning/planningTypes";

// SPORT-SAFE-RELEASE-01 (HPM 2026-10-19), presentation only:
// 1. « État du corps » is a health-signal status (P0-SAFE): « ready » reads « Aucun signal de santé », never « Prêt »
//    (a fatigue day adapted by M1 stays « ready » there, the fatigue is shown elsewhere);
// 2. « Cette semaine »: a day whose session A04 refused (no executable session) reads « Pas de séance guidée », never
//    « Aujourd'hui » / « Prévue » as if it could be started; counters and symbols unchanged.

const ENDURANCE = { kind: "AEROBIC_BASE", load_profile: "MODERATE", duration_min: 45 } as const;
const DH = { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 } as const;
const SYSTEMIC_RED = { sleep_hours: 4, sleep_quality: 2, sleep_wake_ups: 4, energy: 2 };
const m1 = (checkin: Record<string, unknown>, planned: Record<string, unknown> = ENDURANCE) =>
  buildDailyPlan(baseRawContext({ planned_session: planned as never, active_mode: "UNSPECIFIED" as never, upcoming_races: [], checkin: checkin as never })) as unknown as DailyPlan;
const FATIGUE = m1(SYSTEMIC_RED);
const before = { decision: "MODIFY" as const, kind: "AEROBIC_BASE", loadProfile: "LIGHT" as const, durationMin: 45 };
const ALTERNATIVE = applyV2TodayTimeConstraint(FATIGUE as never, { status: "created", finalPrescription: {} as never, timeConstraint: { availableMinutes: 30, action: "adapted", before, after: { decision: "REPLACE", kind: "RECOVERY_ACTIVE" } }, refusedModify: { code: "final_prescription_adaptation_not_defined", detail: { reason: "modify_not_supported" } } } as never) as unknown as DailyPlan;

describe("SPORT-SAFE-RELEASE-01 — « État du corps » says what the status means", () => {
  it("the status is about health signals only: fatigue adapted by M1 → « ready »; declared pain → watch; Safety → signal", () => {
    expect(bodyStatusOf(FATIGUE)).toBe("ready");
    expect(bodyStatusOf(m1({ pain: true, pain_intensity: 4, pain_new: false, pain_location_code: "knee_R" }, DH))).toBe("watch");
    expect(bodyStatusOf(m1({ pain: true, pain_intensity: 6, pain_new: false, pain_location_code: "knee_R" }, DH))).toBe("signal");
  });

  it("labels: « Aucun signal de santé » (never « Prêt »), « Douleur signalée », « Signal actif »", () => {
    expect(BODY_STATUS_LABELS).toEqual({ signal: "Signal actif", watch: "Douleur signalée", ready: "Aucun signal de santé" });
  });

  it("a fatigue day on Today's card: « Aucun signal de santé », the fatigue shown as retained signals", () => {
    render(<CoachStateCard dailyPlan={FATIGUE} hasHealthSignal={false} bodyStatus="ready" checkin={{ checkin_date: "2026-10-16", ...SYSTEMIC_RED, leg_fatigue: 2, grip_fatigue: 2 } as never} />);
    const state = screen.getByRole("region", { name: "Ton état du jour" });
    expect(state).toHaveTextContent("État du corpsAucun signal de santé");
    expect(state.textContent).not.toMatch(/Prêt/);
    expect(screen.getByRole("region", { name: "Ce que ton coach a retenu" }).textContent).toMatch(/nuit trop courte/i);
  });
});

describe("SPORT-SAFE-RELEASE-01 — « Cette semaine » never presents a refused session as startable", () => {
  const TODAY = "2026-10-16";
  const plannedRow = (date: string, intervention: Record<string, unknown>): PlannedSessionRow =>
    ({ planned_date: date, session_type: intervention.kind, intervention, planned_intent: null, is_committed: false, source: "generated" }) as unknown as PlannedSessionRow;
  const decision = (dailyPlan: DailyPlan, status: Partial<DecisionHistoryRow>): DecisionHistoryRow =>
    ({ id: "d1", decisionDate: TODAY, createdAt: `${TODAY}T07:00:00Z`, finalSessionDb: "AEROBIC_BASE", activeModeDb: null, confidenceLevelDb: null, dailyPlan, ...status }) as DecisionHistoryRow;
  const week = (row: DecisionHistoryRow) => {
    const planned = [plannedRow(TODAY, ENDURANCE), plannedRow("2026-10-12", DH)];
    const effective = effectiveDays(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", TODAY, "2026-10-17", "2026-10-18"], {
      decisions: [{ ...row, dailyPlan: { ...(row.dailyPlan as DailyPlan), date: TODAY } }],
      executions: [],
      legacy: [],
      planned: planned.map((p) => ({ date: p.planned_date, session: p.intervention! })),
    });
    return weekSummary(TODAY, planned, [], [], [], effective);
  };
  const todayDetail = () => {
    const detail = document.querySelector("[aria-live='polite']")!;
    return detail.textContent!.replace(/ /g, " ");
  };

  it("refused (A04 modify_not_supported, no alternative): the coach's session, « Pas de séance guidée »; counters and symbol unchanged", () => {
    const summary = week(decision(FATIGUE, { finalPrescriptionStatus: "blocked", finalPrescriptionStatusCode: "final_prescription_adaptation_not_defined", finalPrescriptionStatusDetail: { reason: "modify_not_supported", durationMin: 45 } }));
    expect(summary.days.find((d) => d.isToday)).toMatchObject({ noGuidedSession: true, plannedLabel: "Aérobie base", plannedDurationMin: 45 });
    expect([summary.plannedCount, summary.performedCount]).toEqual([2, 0]);
    render(<MemoryRouter><WeekStrip week={summary} /></MemoryRouter>);
    expect(todayDetail()).toBe("Aujourd'huiAérobie base45 min · Pas de séance guidée");
    expect(within(screen.getByRole("group", { name: "Jours de la semaine" })).getAllByRole("button")[4]!.textContent).toBe("V●");
  });

  it("the alternative (REPLACE active recovery, created): the recovery, today — unchanged", () => {
    render(<MemoryRouter><WeekStrip week={week(decision(ALTERNATIVE, { finalPrescriptionStatus: "created" }))} /></MemoryRouter>);
    expect(todayDetail()).toBe("Aujourd'huiRécupération activeAujourd'hui");
  });

  it("another blocked reason, or no V2 status: unchanged", () => {
    render(<MemoryRouter><WeekStrip week={week(decision(FATIGUE, { finalPrescriptionStatus: "blocked", finalPrescriptionStatusCode: "final_prescription_adaptation_not_defined", finalPrescriptionStatusDetail: { reason: "manual_kind_not_supported" } }))} /></MemoryRouter>);
    expect(todayDetail()).toBe("Aujourd'huiAérobie base45 min · Aujourd'hui");
  });
});
