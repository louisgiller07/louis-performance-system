import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
// Same cross-boundary direct engine import pattern as DailyPlanView.enriched.test.tsx: real M1 plans.
import { buildDailyPlan } from "../../../../head-coach-engine/src/engine/buildDailyPlan.js";
import { baseRawContext } from "../../../../head-coach-engine/fixtures/louis.js";
import { PROVISIONAL_THRESHOLDS } from "../../../../head-coach-engine/src/engine/provisionalThresholds.js";
import { fakeBackend, prescriptionView } from "../../test/guidedSessionFakeBackend";
import { GuidedSessionHarness as Harness } from "../../test/GuidedSessionHarness";
import { CoachStateCard } from "./CoachStateCard";
import { DailyPlanResult } from "./DailyPlanResult";
import { DailyPlanView } from "./DailyPlanView";
import { ReadinessCard } from "./ReadinessCard";
import { bodyStatusOf } from "./bodyStatus";
import { DayGuidanceSections, dayGuidanceOf } from "./dayGuidance";
import { isValidDailyPlan } from "./dailyPlanValidation";
import { athleteSafeMonitoring } from "./safetyPresentation";
import type { DailyPlan, DailyRunResponse } from "./dailyPlanTypes";

// SPORT-LOAD-01.1 (HPM 2026-10-19) — C3.7's monitoring line reads as the approved rider wording on every surface that
// shows it (Today's « Ton état du jour » and « À surveiller », the « État de préparation » card, the guided session),
// and only that line does. Real M1 plans: the RED threshold (5) and the inclusive [J − 7, J] window stay the engine's
// own, the session is untouched, and a declared pain or a Safety day keeps its priority.

const RAW = "Surveiller la charge cumulée sur 7 jours (très élevée)";
const APPROVED =
  "Charge d'entraînement élevée : au moins 5 séances de charge modérée ou élevée sur les 8 derniers jours. Ce repère ne modifie pas ta séance à lui seul. Si tu ressens une fatigue inhabituelle ou une douleur, indique-le dans ton check-in.";
const OLD_WORDING = /Surveiller la charge cumulée|7 jours|très élevée/;
const TODAY = "2026-08-24";
const DH = { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 } as const;
const KINDS = ["STRENGTH_LOWER", "STRENGTH_UPPER", "AEROBIC_BASE", "DH_TECHNICAL", "DH_TECHNICAL"] as const;
/** Five MODERATE sessions, the oldest on the 8th day of the window (J − 7). */
const RED_AGES = [1, 2, 3, 4, 7];
/** The same five, the oldest one day earlier (J − 8): four counted. */
const OUTSIDE_AGES = [1, 2, 3, 4, 8];

/** Completed MODERATE sessions `ages` days before TODAY, as the adapter hands them to M1. */
function done(ages: number[]) {
  return ages.map((age, i) => {
    const d = new Date(`${TODAY}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - age);
    return { date: d.toISOString().slice(0, 10), intervention: { kind: KINDS[i % KINDS.length], load_profile: "MODERATE" }, completion_status: "done" };
  });
}
function m1(ages: number[], checkin: Record<string, unknown> = {}): DailyPlan {
  const plan = buildDailyPlan(
    baseRawContext({ planned_session: DH as never, active_mode: "UNSPECIFIED" as never, upcoming_races: [], recent_sessions: done(ages) as never, checkin: checkin as never })
  );
  if (!isValidDailyPlan(plan)) throw new Error("engine produced an invalid DailyPlan");
  return plan;
}
function response(dailyPlan: DailyPlan): DailyRunResponse {
  return { dailyPlan, decisionId: "11111111-1111-1111-1111-111111111111", healthFlagId: null, warnings: [] };
}
const hasC37 = (plan: DailyPlan) => plan.triggered_rules.some((rule) => rule.rule_id === "C3.7");
const PAIN_4 = { pain: true, pain_intensity: 4, pain_new: false, pain_location_code: "knee_R" };
const PAIN_LINE = "Surveiller l'évolution de la douleur (Genou droit, intensité 4/10) sur 24-48h";

/** The text of the « Attention » block of a card (the line under its label). */
function attentionOf(card: HTMLElement): string | null {
  const label = within(card).queryByText("Attention");
  return label?.nextElementSibling?.textContent ?? null;
}
/** What a rider reads: the dev-only raw decision dump (`import.meta.env.DEV`, never in production) left out. */
function riderText(container: HTMLElement): string {
  const copy = container.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("pre").forEach((pre) => pre.remove());
  return copy.textContent ?? "";
}
function surveillerOf(container: HTMLElement): string[] {
  // PlanSection: the title's parent is the section's own card.
  const card = within(container).getByText("À surveiller").parentElement!;
  return within(card).getAllByRole("listitem").map((item) => item.textContent ?? "");
}

describe("SPORT-LOAD-01.1 — C3.7's monitoring line in rider words", () => {
  it("unchanged engine: RED at 5 MODERATE sessions over [J − 7, J] (8 days), its raw line persisted; the 5th one at J − 8 → 4, AMBER, no line", () => {
    expect(PROVISIONAL_THRESHOLDS.recentLoad).toEqual({ windowDays: 7, amberMinHeavyOrModerateSessions: 3, redMinHeavyOrModerateSessions: 5 });

    const red = m1(RED_AGES);
    expect(hasC37(red)).toBe(true);
    expect(red.monitoring.observe).toEqual([RAW]);
    expect(athleteSafeMonitoring(red)).toEqual([APPROVED]);

    const outside = m1(OUTSIDE_AGES);
    expect(hasC37(outside)).toBe(false);
    expect(outside.monitoring.observe).toEqual([]);
    expect(athleteSafeMonitoring(outside)).toEqual([]);
  });

  it("only C3.7's exact line is reworded: a near variant, a pain line and a DH note pass through as before", () => {
    const red = m1(RED_AGES);
    const other = { ...red, monitoring: { observe: ["Surveiller la charge cumulée sur 7 jours", "Surveiller l'évolution de la douleur (knee_R, intensité 4/10) sur 24-48h", RAW, "Note DH"] } };
    expect(athleteSafeMonitoring(other)).toEqual(["Surveiller la charge cumulée sur 7 jours", PAIN_LINE, APPROVED, "Note DH"]);
  });

  it("the session is untouched: same decision, session and protection as the same day without RED; rendering never mutates the persisted plan", () => {
    const red = m1(RED_AGES);
    const outside = m1(OUTSIDE_AGES);
    expect(red.decision).toBe("KEEP");
    expect(red.final_session).toEqual(DH);
    for (const key of ["decision", "planned_session_before", "final_session", "training", "protection", "decision_reasoning"] as const) {
      expect(red[key]).toEqual(outside[key]);
    }

    const persisted = structuredClone(red);
    render(<DailyPlanResult result={response(red)} today={{ checkin: null, revealed: false }} />);
    render(<ReadinessCard dailyPlan={red} hasHealthSignal={false} bodyStatus={bodyStatusOf(red)} />);
    render(<DayGuidanceSections guidance={dayGuidanceOf(red)!} />);
    expect(red).toEqual(persisted);
    expect(red.monitoring.observe).toEqual([RAW]);
  });

  it("the four surfaces agree: Today's « Ton état du jour » and « À surveiller », the « État de préparation » card, the guided session's guidance", async () => {
    const red = m1(RED_AGES);
    expect(bodyStatusOf(red)).toBe("ready");

    // Today (V1 and V2 daily decision alike): CoachStateCard + DailyPlanView's « À surveiller ».
    const today = render(<DailyPlanResult result={response(red)} today={{ checkin: null, revealed: false }} />);
    const dayState = screen.getByRole("region", { name: "Ton état du jour" });
    expect(within(dayState).getByText("Aucun signal de santé")).toBeInTheDocument();
    expect(attentionOf(dayState)).toBe(APPROVED);
    expect(surveillerOf(today.container)).toEqual([APPROVED]);
    expect(riderText(today.container)).not.toMatch(OLD_WORDING);
    today.unmount();

    // « État de préparation » (the readiness card, shown when Today has no check-in snapshot).
    const readiness = render(<DailyPlanResult result={response(red)} />);
    const card = screen.getByText("État de préparation").parentElement!;
    expect(within(card).getByText("Aucun signal de santé")).toBeInTheDocument();
    expect(attentionOf(card)).toBe(APPROVED);
    expect(surveillerOf(readiness.container)).toEqual([APPROVED]);
    expect(riderText(readiness.container)).not.toMatch(OLD_WORDING);
    readiness.unmount();

    // History detail renders the same DailyPlanView inline.
    const history = render(<DailyPlanView dailyPlan={red} hasHealthSignal={false} />);
    expect(surveillerOf(history.container)).toEqual([APPROVED]);
    expect(riderText(history.container)).not.toMatch(OLD_WORDING);
    history.unmount();

    // Guided session: the guidance the loader builds from the decision, in the real shell, before the start.
    expect(dayGuidanceOf(red)).toEqual({ protection: [], monitoring: [APPROVED] });
    const b = fakeBackend({ prescription: prescriptionView("DH_TECHNICAL") });
    b.state.guidance = dayGuidanceOf(red);
    render(<Harness deps={b.deps} />);
    await screen.findByRole("button", { name: "Commencer la séance" });
    expect(screen.getByTestId("day-guidance").textContent).toBe(`À surveiller${APPROVED}`);
    expect(document.body.textContent).not.toMatch(OLD_WORDING);
  });

  it("a declared pain keeps its priority: the pain line stays first in « Attention » and « À surveiller », the load line after it", () => {
    const plan = m1(RED_AGES, PAIN_4);
    expect(plan.decision).toBe("MODIFY");
    expect(hasC37(plan)).toBe(true);
    expect(bodyStatusOf(plan)).toBe("watch");
    expect(athleteSafeMonitoring(plan)[0]).toBe(PAIN_LINE);
    expect(athleteSafeMonitoring(plan)).toContain(APPROVED);
    expect(athleteSafeMonitoring(plan).indexOf(APPROVED)).toBeGreaterThan(0);

    const today = render(<DailyPlanResult result={response(plan)} today={{ checkin: null, revealed: false }} />);
    const dayState = screen.getByRole("region", { name: "Ton état du jour" });
    expect(within(dayState).getByText("Douleur signalée")).toBeInTheDocument();
    expect(attentionOf(dayState)).toBe(PAIN_LINE);
    expect(surveillerOf(today.container)[0]).toBe(PAIN_LINE);
    today.unmount();

    render(<ReadinessCard dailyPlan={plan} hasHealthSignal={false} bodyStatus={bodyStatusOf(plan)} />);
    expect(attentionOf(screen.getByText("État de préparation").parentElement!)).toBe(PAIN_LINE);
  });

  it("a Safety day never shows the load line, whatever the load: fever (REST) and a severe pain (Coaching suspendu)", () => {
    for (const checkin of [{ fever_or_illness: true }, { pain: true, pain_intensity: 7, pain_new: false, pain_location_code: "knee_R" }]) {
      const plan = m1(RED_AGES, checkin);
      expect(plan.decision).toBe("REST");
      expect(plan.triggered_rules.some((rule) => rule.layer === "A")).toBe(true);
      expect(hasC37(plan)).toBe(false);
      expect(plan.monitoring.observe).not.toContain(RAW);
      expect(athleteSafeMonitoring(plan)).not.toContain(APPROVED);

      const view = render(<DailyPlanResult result={response(plan)} today={{ checkin: null, revealed: false }} />);
      expect(within(screen.getByRole("region", { name: "Ton état du jour" })).getByText("Signal actif")).toBeInTheDocument();
      expect(riderText(view.container)).not.toContain(APPROVED);
      expect(riderText(view.container)).not.toMatch(/Surveiller la charge cumulée/);
      view.unmount();
    }
  });

  it("a decision persisted before decision_reasoning existed (legacy) reads the same approved line", () => {
    const legacy = { ...m1(RED_AGES) } as Partial<DailyPlan>;
    delete legacy.decision_reasoning;
    if (!isValidDailyPlan(legacy)) throw new Error("unreachable");
    render(<CoachStateCard dailyPlan={legacy} hasHealthSignal={false} bodyStatus={bodyStatusOf(legacy)} checkin={null} />);
    expect(attentionOf(screen.getByRole("region", { name: "Ton état du jour" }))).toBe(APPROVED);
  });
});
