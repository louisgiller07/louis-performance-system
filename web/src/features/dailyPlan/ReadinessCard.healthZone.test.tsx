import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
// Same cross-boundary direct engine import pattern as DailyPlanView.enriched.test.tsx.
import { buildDailyPlan } from "../../../../head-coach-engine/src/engine/buildDailyPlan.js";
import { baseRawContext } from "../../../../head-coach-engine/fixtures/louis.js";
import { PAIN_LOCATION_CODES, PAIN_LOCATION_LABELS } from "../checkin/checkinTypes";
import { isValidDailyPlan } from "./dailyPlanValidation";
import { ReadinessCard } from "./ReadinessCard";
import { DailyPlanResult } from "./DailyPlanResult";
import type { DailyPlan } from "./dailyPlanTypes";

/**
 * REV-014b — the Readiness "Attention" line (first monitoring.observe entry)
 * goes through athleteSafeMonitoring like DailyPlanView's "À surveiller":
 * PAIN_NON_SAFETY's raw pain_location_code is shown as its canonical
 * PAIN_LOCATION_LABELS label, never as "knee_R". Real RawContext → real
 * buildDailyPlan (rules/painNonSafety.ts).
 */
function nonSafetyPainPlan(pain_location_code?: string): DailyPlan {
  const plan = buildDailyPlan(
    baseRawContext({ checkin: { pain: true, pain_intensity: 4, pain_new: false, ...(pain_location_code !== undefined ? { pain_location_code } : {}) } })
  );
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

describe("ReadinessCard — Attention line health zones (REV-014b)", () => {
  it.each([
    ["knee_R", "Genou droit"],
    ["knee_L", "Genou gauche"],
    ["shoulder_R", "Épaule droite"],
    ["shoulder_L", "Épaule gauche"],
    ["lower_back", "Bas du dos"],
    ["hamstring_L", "Ischio-jambiers gauche"],
  ] as const)("%s → %s, the engine sentence is otherwise unchanged", (code, label) => {
    const plan = nonSafetyPainPlan(code);
    expect(plan.monitoring.observe[0]).toBe(`Surveiller l'évolution de la douleur (${code}, intensité 4/10) sur 24-48h`);

    const { container } = render(<ReadinessCard dailyPlan={plan} hasHealthSignal={false} />);

    expect(screen.getByText("Attention")).toBeInTheDocument();
    expect(screen.getByText(`Surveiller l'évolution de la douleur (${label}, intensité 4/10) sur 24-48h`)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(new RegExp(`\\b${code}\\b`));
  });

  it("no canonical zone code is ever rendered raw, for all 32 codes", () => {
    for (const code of PAIN_LOCATION_CODES) {
      const { container, unmount } = render(<ReadinessCard dailyPlan={nonSafetyPainPlan(code)} hasHealthSignal={false} />);
      expect(container.textContent, code).toContain(PAIN_LOCATION_LABELS[code]);
      expect(container.textContent, code).not.toMatch(new RegExp(`\\b${code}\\b`));
      unmount();
    }
  });

  it("an unknown zone code never breaks the card; the rest of the sentence is kept", () => {
    const plan = { ...nonSafetyPainPlan("knee_R"), monitoring: { observe: ["Surveiller l'évolution de la douleur (shoulder_X, intensité 4/10) sur 24-48h"] } };

    render(<ReadinessCard dailyPlan={plan} hasHealthSignal={false} />);

    expect(screen.getByText("Attention")).toBeInTheDocument();
    expect(screen.getByText(/Surveiller l'évolution de la douleur \(.*, intensité 4\/10\) sur 24-48h/)).toBeInTheDocument();
  });

  it.each([
    ["undefined (no zone declared)", undefined],
    ["null", null],
    ["empty string", ""],
  ] as const)("zone %s: the engine's French wording is shown unchanged", (_label, value) => {
    const plan = nonSafetyPainPlan(value as string | undefined);

    render(<ReadinessCard dailyPlan={plan} hasHealthSignal={false} />);

    expect(screen.getByText("Attention")).toBeInTheDocument();
    expect(screen.getByText(plan.monitoring.observe[0]!)).toBeInTheDocument();
    expect(plan.monitoring.observe[0]).not.toMatch(/_[LR]\b/);
  });

  it("no monitoring entry, or an empty one: no Attention line (unchanged behaviour)", () => {
    const base = nonSafetyPainPlan("knee_R");
    for (const observe of [[], [""]]) {
      const { unmount } = render(<ReadinessCard dailyPlan={{ ...base, monitoring: { observe } }} hasHealthSignal={false} />);
      expect(screen.queryByText("Attention")).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe("Today — full render with a non-safety pain (REV-014b)", () => {
  it("no raw zone code anywhere on Today; Attention and À surveiller both show 'Genou droit'; stored plan unchanged", () => {
    const plan = nonSafetyPainPlan("knee_R");
    const before = structuredClone(plan);

    const { container } = render(<DailyPlanResult result={{ dailyPlan: plan, decisionId: "d-1", healthFlagId: null, warnings: [] }} />);

    expect(screen.getByText("Attention")).toBeInTheDocument();
    expect(screen.getByText("À surveiller")).toBeInTheDocument();
    expect(screen.getAllByText("Surveiller l'évolution de la douleur (Genou droit, intensité 4/10) sur 24-48h")).toHaveLength(2);
    expect(visibleText(container)).not.toMatch(/\bknee_R\b/);
    expect(plan).toEqual(before);
  });
});
