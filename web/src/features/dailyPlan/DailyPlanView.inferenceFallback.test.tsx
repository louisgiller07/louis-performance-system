import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
// Same cross-boundary direct engine import pattern as DailyPlanView.enriched.test.tsx.
import { buildDailyPlan } from "../../../../head-coach-engine/src/engine/buildDailyPlan.js";
import { baseRawContext } from "../../../../head-coach-engine/fixtures/louis.js";
import { isValidDailyPlan } from "./dailyPlanValidation";
import { DailyPlanResult } from "./DailyPlanResult";
import type { DailyPlan } from "./dailyPlanTypes";

/**
 * REV-016 — a day without a planned session (engine INFERENCE_FALLBACK) never
 * shows "(mode=UNSPECIFIED)" or the inference wording on Today. Real
 * RawContext → real buildDailyPlan → real Today render.
 */
function noPlannedSessionPlan(active_mode: string): DailyPlan {
  const plan = buildDailyPlan(baseRawContext({ planned_session: null, active_mode } as Parameters<typeof baseRawContext>[0]));
  if (!isValidDailyPlan(plan)) throw new Error("engine produced an invalid DailyPlan");
  return plan;
}

/** Rendered text minus the dev-only "Détails techniques" JSON dump (import.meta.env.DEV), which intentionally shows the raw stored plan. */
function visibleText(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("details").forEach((d) => {
    if (d.querySelector("summary")?.textContent === "Détails techniques") d.remove();
  });
  return clone.textContent ?? "";
}

describe("Today — no planned session (REV-016)", () => {
  it.each(["UNSPECIFIED", "IN_SEASON"])("mode %s: 'Aucune séance planifiée.' everywhere, never the mode or the inference wording; stored plan unchanged", (mode) => {
    const plan = noPlannedSessionPlan(mode);
    const before = structuredClone(plan);
    expect(plan.triggered_rules.some((r) => r.rule_id === "INFERENCE_FALLBACK" && r.detail.includes(`(mode=${mode})`))).toBe(true);

    const { container } = render(<DailyPlanResult result={{ dailyPlan: plan, decisionId: "d-1", healthFlagId: null, warnings: [] }} />);
    screen.getByText("Pourquoi cette décision ?").click();

    const text = visibleText(container);
    expect(text).toContain("Aucune séance planifiée.");
    expect(text).not.toMatch(/mode=|UNSPECIFIED|inférence depuis le contexte/);
    expect(plan).toEqual(before);
  });
});
