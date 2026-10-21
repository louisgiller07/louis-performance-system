import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DailyPlanResult } from "./DailyPlanResult";
import { DailyPlanView } from "./DailyPlanView";
import { DH_GRIP_SAFETY_TEXT } from "./DhGripSafetyNotice";
import type { DailyPlan, DailyRunResponse } from "./dailyPlanTypes";
import { fakeBackend, prescriptionView } from "../../test/guidedSessionFakeBackend";
import { GuidedSessionHarness as Harness } from "../../test/GuidedSessionHarness";

// SPORT-SAFE-02 (HPM 2026-10-21) — the rider's grip / braking stop rule on today's DH session: a fixed instruction,
// never a detection of the rider's state, never added to a past day's persisted plan.

const APPROVED =
  "Si la fatigue des mains ou des avant-bras t'empêche de tenir correctement le guidon ou de freiner de façon fiable, arrête ta séance DH. Ne poursuis pas une descente lorsque tu n'as plus le contrôle nécessaire.";

const BASE: DailyPlan = {
  active_mode: "IN_SEASON",
  training: { active: true, session_type: { kind: "DH_TECHNICAL", load_profile: "MODERATE" }, objective: "Virages" },
  dh_or_technical: { active: true, focus: "Virages" },
  mental: { active: false },
  recovery: { active: false, actions: [] },
  nutrition: { active: false },
  sleep: { active: false },
  protection: { do_not_do: [] },
  monitoring: { observe: [] },
  reasoning: "Séance prévue conservée.",
  confidence: "MEDIUM",
  triggered_rules: [],
  planned_session_before: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
  final_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 },
  decision: "KEEP",
  overrode_race_protocol: false,
  engine_version: "test",
};
const result = (plan: Partial<DailyPlan> = {}): DailyRunResponse => ({ dailyPlan: { ...BASE, ...plan }, decisionId: "11111111-1111-1111-1111-111111111111", healthFlagId: null, warnings: [] });
const NON_DH: Partial<DailyPlan> = {
  training: { active: true, session_type: { kind: "STRENGTH_A", load_profile: "MODERATE" }, objective: "Force" },
  dh_or_technical: { active: false },
  planned_session_before: { kind: "STRENGTH_A", load_profile: "MODERATE" },
  final_session: { kind: "STRENGTH_A", load_profile: "MODERATE" },
};

describe("SPORT-SAFE-02 — DH grip / braking stop rule", () => {
  it("the approved text, verbatim", () => {
    expect(DH_GRIP_SAFETY_TEXT).toBe(APPROVED);
  });

  it("Today, a DH session: shown once, as a fixed instruction (no state, no threshold)", () => {
    render(<DailyPlanResult result={result()} />);
    const notices = screen.getAllByTestId("dh-grip-safety");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toHaveTextContent(APPROVED);
    expect(notices[0]!.textContent).not.toMatch(/\d|détect|NALYNT a /);
  });

  it("Today, a non-DH session: never shown", () => {
    render(<DailyPlanResult result={result(NON_DH)} />);
    expect(screen.queryByTestId("dh-grip-safety")).toBeNull();
  });

  it("History (a past day's persisted plan): never added", () => {
    render(<DailyPlanView dailyPlan={result().dailyPlan} hasHealthSignal={false} />);
    expect(screen.queryByTestId("dh-grip-safety")).toBeNull();
  });

  it("guided DH session: shown before the start and while it can go on; not on the completed session shown read only", async () => {
    const b = fakeBackend({ prescription: prescriptionView("DH_TECHNICAL") });
    render(<Harness deps={b.deps} />);
    await screen.findByRole("button", { name: "Commencer la séance" });
    expect(screen.getByTestId("dh-grip-safety")).toHaveTextContent(APPROVED);
    await userEvent.click(screen.getByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(screen.getByRole("status").getAttribute("data-phase")).toBe("active"));
    expect(screen.getByTestId("dh-grip-safety")).toHaveTextContent(APPROVED);
    await userEvent.click(screen.getByRole("button", { name: "Arrêter la séance" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmer l'arrêt" }));
    await waitFor(() => expect(screen.getByRole("status").getAttribute("data-phase")).not.toBe("active"));
    expect(screen.queryByTestId("dh-grip-safety")).toBeNull();
  });

  it("guided non-DH session: never shown", async () => {
    const b = fakeBackend({ prescription: prescriptionView("STRENGTH_UPPER") });
    render(<Harness deps={b.deps} />);
    await screen.findByRole("button", { name: "Commencer la séance" });
    expect(screen.queryByTestId("dh-grip-safety")).toBeNull();
  });
});
