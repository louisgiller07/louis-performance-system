import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
// Same cross-boundary direct engine import pattern as DailyPlanView.enriched.test.tsx.
import { buildDailyPlan } from "../../../../head-coach-engine/src/engine/buildDailyPlan.js";
import { baseRawContext } from "../../../../head-coach-engine/fixtures/louis.js";
import { isValidDailyPlan } from "./dailyPlanValidation";
import { formatConfidence } from "./dailyPlanLabels";
import { DailyPlanResult } from "./DailyPlanResult";
import { DecisionHero } from "./DecisionHero";
import { ReadinessCard } from "./ReadinessCard";
import type { DailyPlan } from "./dailyPlanTypes";

/**
 * REV-015.1 — Today's (and History's) labels are French; the stored
 * DailyPlan values themselves (decision, confidence enum, …) are never
 * changed — only their rendering. Real RawContext → real buildDailyPlan.
 */
function planFor(overrides: Parameters<typeof baseRawContext>[0]): DailyPlan {
  const plan = buildDailyPlan(baseRawContext(overrides));
  if (!isValidDailyPlan(plan)) throw new Error("engine produced an invalid DailyPlan");
  return plan;
}

const DH_KEEP = { planned_session: { kind: "DH_TECHNICAL" as const, load_profile: "MODERATE" as const, duration_min: 120 } };
const DH_MODIFY = { planned_session: { kind: "DH_PERFORMANCE" as const, load_profile: "HEAVY" as const, duration_min: 240 }, checkin: { sleep_hours: 5 } };
const DH_REPLACE = { planned_session: { kind: "DH_PERFORMANCE" as const, load_profile: "HEAVY" as const, duration_min: 240 }, checkin: { sleep_hours: 5, leg_fatigue: 8, grip_fatigue: 8 } };
const PAIN_REST = { checkin: { pain: true, pain_intensity: 8, pain_new: true } };

/** Rendered text minus the dev-only "Détails techniques" JSON dump (import.meta.env.DEV, absent from production builds), which intentionally shows the raw stored plan. */
function visibleText(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("details").forEach((d) => {
    if (d.querySelector("summary")?.textContent === "Détails techniques") d.remove();
  });
  return clone.textContent ?? "";
}

// Every English label REV-015.1 removed, plus the raw confidence enum.
const ENGLISH_LABELS = /Head Coach Decision|Readiness|Confidence|Body status|\bReady\b|ready to perform|Today's Mission|Session Plan|\bFocus\b|\bToday\b|\bHIGH\b|\bMEDIUM\b|\bLOW\b/;

describe("formatConfidence (REV-015.1)", () => {
  it("maps every Confidence value to its French label", () => {
    expect(formatConfidence("HIGH")).toBe("Élevée");
    expect(formatConfidence("MEDIUM")).toBe("Moyenne");
    expect(formatConfidence("LOW")).toBe("Faible");
  });

  it("never returns a raw or unknown value", () => {
    for (const value of ["VERY_HIGH", "high", "toString", "", null, undefined, 3]) expect(formatConfidence(value)).toBeNull();
  });
});

describe("DecisionHero (REV-015.1)", () => {
  it.each([
    ["KEEP", DH_KEEP, "✓ Prêt à performer"],
    ["MODIFY", DH_MODIFY, "✓ Ajusté — prêt à performer"],
    ["REPLACE", DH_REPLACE, "✓ Nouveau plan — prêt à performer"],
  ] as const)("%s: French title, confidence and tagline", (decision, overrides, tagline) => {
    const plan = planFor(overrides);
    expect(plan.decision).toBe(decision);

    const { container } = render(<DecisionHero dailyPlan={plan} />);

    expect(screen.getByText("Décision du Head Coach")).toBeInTheDocument();
    expect(screen.getByText(`Confiance ${formatConfidence(plan.confidence)!.toLowerCase()}`)).toBeInTheDocument();
    expect(screen.getByText(tagline)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(ENGLISH_LABELS);
  });

  it("REST: no tagline, still French", () => {
    const plan = planFor(PAIN_REST);
    expect(plan.decision).toBe("REST");

    const { container } = render(<DecisionHero dailyPlan={plan} />);

    expect(screen.getByText("Décision du Head Coach")).toBeInTheDocument();
    expect(screen.queryByText(/prêt à performer/)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(ENGLISH_LABELS);
  });

  it("an unknown confidence value hides the line instead of showing the raw value", () => {
    const plan = { ...planFor(DH_KEEP), confidence: "VERY_HIGH" } as unknown as DailyPlan;

    render(<DecisionHero dailyPlan={plan} />);

    expect(screen.queryByText(/Confiance/)).not.toBeInTheDocument();
    expect(screen.queryByText(/VERY_HIGH/)).not.toBeInTheDocument();
  });
});

describe("ReadinessCard (REV-015.1)", () => {
  it.each(["HIGH", "MEDIUM", "LOW"] as const)("confidence %s shows its French label, never the enum", (confidence) => {
    const plan = { ...planFor(DH_KEEP), confidence };

    const { container } = render(<ReadinessCard dailyPlan={plan} hasHealthSignal={false} />);

    expect(screen.getByText("État de préparation")).toBeInTheDocument();
    expect(screen.getByText("Confiance")).toBeInTheDocument();
    expect(screen.getByText(formatConfidence(confidence)!)).toBeInTheDocument();
    expect(screen.getByText("État du corps")).toBeInTheDocument();
    expect(screen.getByText("Prêt")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(ENGLISH_LABELS);
  });

  it("health signal: 'Signal actif' instead of 'Prêt'", () => {
    render(<ReadinessCard dailyPlan={planFor(PAIN_REST)} hasHealthSignal />);

    expect(screen.getByText("Signal actif")).toBeInTheDocument();
    expect(screen.queryByText("Prêt")).not.toBeInTheDocument();
  });

  it("an unknown confidence value hides the row instead of showing the raw value", () => {
    const plan = { ...planFor(DH_KEEP), confidence: "VERY_HIGH" } as unknown as DailyPlan;

    render(<ReadinessCard dailyPlan={plan} hasHealthSignal={false} />);

    expect(screen.queryByText("Confiance")).not.toBeInTheDocument();
    expect(screen.queryByText(/VERY_HIGH/)).not.toBeInTheDocument();
  });
});

describe("Today — full daily plan render (REV-015.1)", () => {
  it.each([
    ["KEEP", DH_KEEP],
    ["MODIFY", DH_MODIFY],
    ["REPLACE", DH_REPLACE],
    ["REST", PAIN_REST],
  ] as const)("%s: no English label anywhere, stored plan values unchanged", (_decision, overrides) => {
    const plan = planFor(overrides);
    const before = structuredClone(plan);

    const { container } = render(<DailyPlanResult result={{ dailyPlan: plan, decisionId: "d-1", healthFlagId: null, warnings: [] }} />);

    expect(visibleText(container)).not.toMatch(ENGLISH_LABELS);
    expect(plan).toEqual(before);
  });

  it("DH plan: the session card is titled 'Plan de séance' with the 'Intensité' guidance line", () => {
    render(<DailyPlanResult result={{ dailyPlan: planFor(DH_KEEP), decisionId: "d-1", healthFlagId: null, warnings: [] }} />);

    expect(screen.getByText("Plan de séance")).toBeInTheDocument();
    expect(screen.getByText("Intensité")).toBeInTheDocument();
    // UX-03 — Today leads with the unified MissionHero.
    expect(screen.getByText("Ta mission du jour")).toBeInTheDocument();
  });
});
