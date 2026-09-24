import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DailyPlanView } from "./DailyPlanView";
import type { DailyPlan, ExecutablePrescription } from "./dailyPlanTypes";

/**
 * V0.5_048 §30 — full KEEP/MODIFY/REPLACE/REST acceptance matrix, exercised
 * directly against DailyPlanView's own frontend gate
 * (`dailyPlan.decision === "KEEP" && executablePrescription != null`,
 * DailyPlanView.tsx). Hand-built minimal DailyPlan fixtures (same style as
 * dailyPlanValidation.test.ts's VALID_DAILY_PLAN) rather than the real
 * engine — this suite only needs control over `decision`, never M1's actual
 * arbitration logic. The MODIFY/REPLACE/REST cases deliberately pass a
 * present `executablePrescription` prop anyway (simulating a hypothetical
 * backend bug) to prove this frontend gate holds independently of the
 * backend's own KEEP-only gate (runDailyFor.ts) — required even though the
 * backend already gates it (ticket §17).
 */
function basePlan(decision: DailyPlan["decision"]): DailyPlan {
  return {
    active_mode: "IN_SEASON",
    training: { active: true, session_type: { kind: "AEROBIC_BASE", load_profile: "MODERATE" }, objective: "Base aérobie" },
    dh_or_technical: { active: false },
    mental: { active: false },
    recovery: { active: false, actions: [] },
    nutrition: { active: false },
    sleep: { active: false },
    protection: { do_not_do: [] },
    monitoring: { observe: [] },
    reasoning: "Tout va bien.",
    confidence: "MEDIUM",
    triggered_rules: [],
    planned_session_before: { kind: "AEROBIC_BASE", load_profile: "MODERATE" },
    final_session: { kind: "AEROBIC_BASE", load_profile: "MODERATE" },
    decision,
    overrode_race_protocol: false,
    engine_version: "1.0.0",
  };
}

const STRENGTH_PRESCRIPTION: ExecutablePrescription = {
  id: "prescription-1",
  generatedPlanSessionId: "session-1",
  schemaVersion: "v1",
  catalogVersion: "v1",
  structure: {
    domain: "strength",
    schemaVersion: "v1",
    blocks: [
      {
        role: "work",
        exerciseId: "back_squat",
        sets: 4,
        repScheme: { type: "fixed", reps: 5 },
        intensity: { type: "percent_1rm", value: 80 },
        restSeconds: 180,
      },
    ],
  },
};

const DH_PRESCRIPTION: ExecutablePrescription = {
  id: "prescription-2",
  generatedPlanSessionId: "session-2",
  schemaVersion: "v1",
  catalogVersion: "v1",
  structure: {
    domain: "dh_technical",
    schemaVersion: "v1",
    drills: [
      {
        drillId: "berm_carry_speed",
        skillTarget: "cornering",
        terrainRequirement: "flow_trail",
        runs: 6,
        executionCue: "Reste bas dans le virage.",
        successCriterion: "Vitesse constante sur les 3 derniers virages.",
      },
    ],
  },
};

describe("DailyPlanView — executable prescription acceptance matrix (V0.5_048)", () => {
  it("KEEP + strength prescription present → card is shown with correct content", () => {
    render(<DailyPlanView dailyPlan={basePlan("KEEP")} hasHealthSignal={false} executablePrescription={STRENGTH_PRESCRIPTION} />);
    expect(screen.getByText("Exercices")).toBeInTheDocument();
    expect(screen.getByText("Back Squat")).toBeInTheDocument();
  });

  it("KEEP + DH technical prescription present → card is shown with correct content", () => {
    render(<DailyPlanView dailyPlan={basePlan("KEEP")} hasHealthSignal={false} executablePrescription={DH_PRESCRIPTION} />);
    expect(screen.getByText("Exercices")).toBeInTheDocument();
    expect(screen.getByText("Berm Carry Speed")).toBeInTheDocument();
  });

  it("KEEP + no prescription (undefined) → card is absent", () => {
    render(<DailyPlanView dailyPlan={basePlan("KEEP")} hasHealthSignal={false} />);
    expect(screen.queryByText("Exercices")).not.toBeInTheDocument();
  });

  it("KEEP + no prescription (null) → card is absent", () => {
    render(<DailyPlanView dailyPlan={basePlan("KEEP")} hasHealthSignal={false} executablePrescription={null} />);
    expect(screen.queryByText("Exercices")).not.toBeInTheDocument();
  });

  it("MODIFY + prescription present (simulated backend bug) → card is absent (frontend gate holds independently of the backend)", () => {
    render(<DailyPlanView dailyPlan={basePlan("MODIFY")} hasHealthSignal={false} executablePrescription={STRENGTH_PRESCRIPTION} />);
    expect(screen.queryByText("Exercices")).not.toBeInTheDocument();
  });

  it("REPLACE + prescription present (simulated backend bug) → card is absent", () => {
    render(<DailyPlanView dailyPlan={basePlan("REPLACE")} hasHealthSignal={false} executablePrescription={STRENGTH_PRESCRIPTION} />);
    expect(screen.queryByText("Exercices")).not.toBeInTheDocument();
  });

  it("REST + prescription present (simulated backend bug) → card is absent", () => {
    render(<DailyPlanView dailyPlan={basePlan("REST")} hasHealthSignal={false} executablePrescription={STRENGTH_PRESCRIPTION} />);
    expect(screen.queryByText("Exercices")).not.toBeInTheDocument();
  });
});
