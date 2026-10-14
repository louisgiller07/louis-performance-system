import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DailyPlanView } from "./DailyPlanView";
import type { DailyPlan } from "./dailyPlanTypes";
import { FinalPrescriptionV2Card } from "../finalPrescriptionV2/FinalPrescriptionV2Card";
import { MANUAL_BLOCKED_MESSAGES } from "../finalPrescriptionV2/finalPrescriptionV2Copy";
import { EDITOR, manualSessionHint } from "../planning/weekPresentation";

// P0-3 (HPM 2026-10-13) — a manual session without a prescription is never presented as executable (V1), a V2
// manual session NALYNT cannot build is refused precisely, and no surface implies a free comment is taken into account.

function keepPlan(kind: string): DailyPlan {
  return {
    active_mode: "IN_SEASON",
    training: { active: true, session_type: { kind, load_profile: "MODERATE" }, objective: "Renfo" },
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
    planned_session_before: { kind, load_profile: "MODERATE" },
    final_session: { kind, load_profile: "MODERATE" },
    decision: "KEEP",
    overrode_race_protocol: false,
    engine_version: "1.0.0",
  } as DailyPlan;
}

describe("P0-3 — V1: a kept session without any prescription", () => {
  it("says plainly that NALYNT only knows its type and load (never an executable session)", () => {
    render(<DailyPlanView dailyPlan={keepPlan("STRENGTH_UPPER")} executablePrescription={null} executablePrescriptionStatus="none" />);
    expect(screen.getByTestId("no-detailed-content")).toHaveTextContent("Seuls son type et sa charge sont connus.");
    expect(screen.queryByText(/Ouvrir la séance guidée|Commencer/)).not.toBeInTheDocument();
  });

  it("not shown on a REST day, nor when the prescription is delivered, nor in History (no status)", () => {
    const { rerender } = render(<DailyPlanView dailyPlan={keepPlan("REST")} executablePrescription={null} executablePrescriptionStatus="none" />);
    expect(screen.queryByTestId("no-detailed-content")).not.toBeInTheDocument();
    rerender(<DailyPlanView dailyPlan={keepPlan("STRENGTH_UPPER")} />);
    expect(screen.queryByTestId("no-detailed-content")).not.toBeInTheDocument();
  });
});

describe("P0-3 — V2: a manual session NALYNT cannot build is refused precisely", () => {
  it.each(Object.entries(MANUAL_BLOCKED_MESSAGES))("%s", (reason, message) => {
    render(<FinalPrescriptionV2Card state={{ kind: "blocked", code: "final_prescription_adaptation_not_defined", detail: { reason } }} />);
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it("any other blocked reason keeps the existing neutral copy", () => {
    render(<FinalPrescriptionV2Card state={{ kind: "blocked", code: "final_prescription_adaptation_not_defined", detail: { reason: "upward_modify_not_supported" } }} />);
    expect(screen.getByText("L'adaptation détaillée n'est pas disponible pour cette recommandation.")).toBeInTheDocument();
  });
});

describe("P0-3 — /plan editor: what a manual session will really get", () => {
  it("V1 plan: every manual session is announced without detailed content (REST excepted)", () => {
    expect(manualSessionHint("v1", "STRENGTH_UPPER", "MODERATE")).toBe(EDITOR.manualV1Hint);
    expect(manualSessionHint("v1", "DH_TECHNICAL", "MODERATE")).toBe(EDITOR.manualV1Hint);
    expect(manualSessionHint("v1", "REST", null)).toBeNull();
  });

  it("V2 plan: no note when NALYNT builds the content; a note for kinds / loads it cannot build", () => {
    for (const kind of ["STRENGTH_LOWER", "STRENGTH_UPPER", "DH_TECHNICAL", "DH_LIGHT", "AEROBIC_BASE", "RECOVERY_ACTIVE"]) expect(manualSessionHint("v2", kind, "MODERATE"), kind).toBeNull();
    for (const kind of ["POWER", "GRIP_WORK", "PUMPTRACK", "BIKE_MAINTENANCE", "STRENGTH_FULL_LIGHT", "AEROBIC_INTERVALS", "MOBILITY", "DH_PERFORMANCE"]) {
      expect(manualSessionHint("v2", kind, "MODERATE"), kind).toBe(EDITOR.manualV2UnsupportedHint);
    }
    expect(manualSessionHint("v2", "STRENGTH_UPPER", "HEAVY")).toBe(EDITOR.manualV2HeavyHint);
  });

  it("unknown plan model: no claim at all", () => {
    expect(manualSessionHint(null, "STRENGTH_UPPER", "MODERATE")).toBeNull();
  });
});
