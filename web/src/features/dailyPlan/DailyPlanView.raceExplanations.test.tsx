import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
// Same cross-boundary direct engine import pattern as DailyPlanView.enriched.test.tsx.
import { buildDailyPlan } from "../../../../head-coach-engine/src/engine/buildDailyPlan.js";
import { baseRawContext } from "../../../../head-coach-engine/fixtures/louis.js";
import { isValidDailyPlan } from "./dailyPlanValidation";
import { DailyPlanResult } from "./DailyPlanResult";
import { athleteSafeRuleDetail } from "./safetyPresentation";
import type { DailyPlan } from "./dailyPlanTypes";

/**
 * REV-016b — new race decisions from the real engine (before, during, after a
 * race; committed activity) never show a raw race identifier on Today.
 * Real RawContext → real buildDailyPlan → real Today render.
 */
type Overrides = Parameters<typeof baseRawContext>[0];

function planFor(overrides: Overrides): DailyPlan {
  const plan = buildDailyPlan(baseRawContext(overrides));
  if (!isValidDailyPlan(plan)) throw new Error("engine produced an invalid DailyPlan");
  return plan;
}

function race(event_start: string, event_end: string, race_format: string, priority: string, race_phase?: string) {
  return { event_name: "iXS Cup Lenzerheide", event_start, event_end, race_format, priority, ...(race_phase ? { race_phase } : {}) };
}

/** Rendered text minus the dev-only "Détails techniques" JSON dump (import.meta.env.DEV), which intentionally shows the raw stored plan. */
function visibleText(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("details").forEach((d) => {
    if (d.querySelector("summary")?.textContent === "Détails techniques") d.remove();
  });
  return clone.textContent ?? "";
}

const RAW_RACE_CODES = /IXS_3DAY|HOT_TRAIL_2DAY|A_PLUS|event_day=|phase=|protocole T-X|recommandation T-X|\bT[-+]\d+\b|BIKE_MAINTENANCE|RECOVERY_ACTIVE|RACE_ACTIVITY|\b[A-Z]+_[A-Z_]+\b/;

function renderToday(plan: DailyPlan) {
  const result = render(<DailyPlanResult result={{ dailyPlan: plan, decisionId: "d-1", healthFlagId: null, warnings: [] }} />);
  result.getByText("Pourquoi cette décision ?").click();
  return result;
}

describe("Today — race explanations from the real engine (REV-016b)", () => {
  it.each([
    ["pre-race J-3, iXS A+", { today: "2026-10-01", upcoming_races: [race("2026-10-04", "2026-10-06", "IXS_3DAY", "A_PLUS")] }, "RACE_PROTOCOL_TX", "J-3 avant iXS Cup Lenzerheide (iXS, 3 jours, priorité A+)"],
    ["post-race J+2", { today: "2026-10-08", upcoming_races: [race("2026-10-04", "2026-10-06", "IXS_3DAY", "A")] }, "POST_EVENT", "J+2 après la fin de iXS Cup Lenzerheide"],
    ["race in progress, qualifications", { today: "2026-10-05", upcoming_races: [race("2026-10-04", "2026-10-06", "IXS_3DAY", "A", "QUALI")] }, "RACE_DAY_ACTIVE", "Course en cours (jour 1, qualifications)"],
    [
      "committed bike maintenance before a Hot Trail",
      {
        today: "2026-10-01",
        upcoming_races: [race("2026-10-04", "2026-10-05", "HOT_TRAIL_2DAY", "A")],
        planned_session: { kind: "BIKE_MAINTENANCE" },
        planned_session_committed: true,
      },
      "COMMITTED_FAMILY_NO_ADAPTATION",
      "Activité engagée (Entretien vélo)",
    ],
  ] as const)("%s: French wording, no raw race identifier; stored plan unchanged", (_label, overrides, ruleId, expected) => {
    const plan = planFor(overrides as unknown as Overrides);
    expect(plan.triggered_rules.map((r) => r.rule_id)).toContain(ruleId);
    const before = structuredClone(plan);

    const { container } = renderToday(plan);
    const text = visibleText(container);

    expect(text).toContain(expected);
    expect(text).not.toMatch(RAW_RACE_CODES);
    expect(plan).toEqual(before);
  });
});

// Documented, deliberately untranslated (REV-016b): strong soft constraints only come from the RACE_WEEK /
// INJURY_RECOVERY modes, which no production decision has ever used. This guard pins the current engine output
// so that (a) the gap stays visible and (b) any change to that engine wording fails here and gets reviewed.
describe("strong soft constraints — guard, not translated (REV-016b)", () => {
  it("RACE_WEEK mode still emits the raw SOFT_CONSTRAINT_STRONG_APPLIED wording, passed through unchanged", () => {
    const plan = planFor({ active_mode: "RACE_WEEK", upcoming_races: [], planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 240 } } as unknown as Overrides);
    const strong = plan.triggered_rules.find((r) => r.rule_id === "SOFT_CONSTRAINT_STRONG_APPLIED");

    expect(strong).toBeDefined();
    expect(strong!.detail).toMatch(/^Contrainte "[a-z_]+" \(strong, mode RACE_WEEK\) appliquée, aucune justification déclarée \(planned_intent absent\) : [A-Z_]+ → [A-Z_]+$/);
    expect(athleteSafeRuleDetail(strong!)).toBe(strong!.detail);
  });
});
