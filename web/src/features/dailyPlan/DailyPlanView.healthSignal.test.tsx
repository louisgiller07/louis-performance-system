import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
// Same cross-boundary direct engine import pattern as DailyPlanView.enriched.test.tsx.
import { buildDailyPlan } from "../../../../head-coach-engine/src/engine/buildDailyPlan.js";
import { baseRawContext } from "../../../../head-coach-engine/fixtures/louis.js";
import { PAIN_LOCATION_CODES } from "../checkin/checkinTypes";
import { isValidDailyPlan } from "./dailyPlanValidation";
import { DailyPlanView } from "./DailyPlanView";
import type { DailyPlan } from "./dailyPlanTypes";

/**
 * REV-014 — the "Attention santé" banner shows the Safety rule's reason with
 * the zone as its French label, never the raw pain_location_code. Real
 * RawContext → real buildDailyPlan (rules/safety.ts A2/A4) → real
 * DailyPlanView render, exactly how Today/History pass the reason.
 */
function planFor(checkin: Record<string, unknown>): DailyPlan {
  const plan = buildDailyPlan(baseRawContext({ checkin }));
  if (!isValidDailyPlan(plan)) throw new Error("engine produced an invalid DailyPlan");
  return plan;
}

function renderWithHealthSignal(plan: DailyPlan) {
  return render(<DailyPlanView dailyPlan={plan} hasHealthSignal={plan.health_flag_to_create !== undefined} healthSignalReason={plan.health_flag_to_create?.reason} />);
}

// Zone codes that can never be mistaken for ordinary text (all contain "_").
const UNDERSCORE_CODES = PAIN_LOCATION_CODES.filter((code) => code.includes("_"));

describe("DailyPlanView — health signal zone labels (REV-014)", () => {
  it("A2 (new severe pain, knee_R): banner shows 'Genou droit', the engine sentence is otherwise unchanged", () => {
    const plan = planFor({ pain: true, pain_intensity: 8, pain_new: true, pain_location_code: "knee_R" });
    expect(plan.health_flag_to_create?.reason).toBe("Douleur nouvelle sévère (8/10) — knee_R");

    const { container } = renderWithHealthSignal(plan);

    expect(screen.getByText("Attention santé")).toBeInTheDocument();
    expect(screen.getByText("Douleur nouvelle sévère (8/10) — Genou droit")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\bknee_R\b/);
  });

  it("A4 (objective severity criterion, shoulder_L): banner shows 'Épaule gauche', criteria unchanged", () => {
    const plan = planFor({ pain: true, pain_intensity: 4, pain_traumatic: true, pain_location_code: "shoulder_L" });
    expect(plan.health_flag_to_create?.reason).toBe("Douleur avec critère objectif de gravité (traumatique) — shoulder_L");

    const { container } = renderWithHealthSignal(plan);

    expect(screen.getByText("Douleur avec critère objectif de gravité (traumatique) — Épaule gauche")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\bshoulder_L\b/);
  });

  it("no raw zone code anywhere in the rendered view, for every zone with an underscore", () => {
    for (const code of UNDERSCORE_CODES) {
      const { container, unmount } = renderWithHealthSignal(planFor({ pain: true, pain_intensity: 8, pain_new: true, pain_location_code: code }));
      expect(container.textContent, code).not.toMatch(new RegExp(`\\b${code}\\b`));
      unmount();
    }
  });

  it("no zone declared: the engine sentence is shown exactly as before", () => {
    const plan = planFor({ pain: true, pain_intensity: 8, pain_new: true });
    expect(plan.health_flag_to_create?.reason).toBe("Douleur nouvelle sévère (8/10)");

    renderWithHealthSignal(plan);

    expect(screen.getByText("Attention santé")).toBeInTheDocument();
    expect(screen.getByText("Douleur nouvelle sévère (8/10)")).toBeInTheDocument();
  });

  it("health signal without a reason: the existing generic fallback is kept", () => {
    const plan = planFor({ pain: true, pain_intensity: 8, pain_new: true, pain_location_code: "knee_R" });

    render(<DailyPlanView dailyPlan={plan} hasHealthSignal />);

    expect(screen.getByText("Le coach a généré un signal de santé pour cette décision.")).toBeInTheDocument();
  });

  it("no health signal: no banner", () => {
    render(<DailyPlanView dailyPlan={planFor({})} hasHealthSignal={false} />);

    expect(screen.queryByText("Attention santé")).not.toBeInTheDocument();
  });
});
