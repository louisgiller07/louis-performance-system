import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
// Same cross-boundary direct engine import pattern as DailyPlanView.enriched.test.tsx.
import { buildDailyPlan } from "../../../../head-coach-engine/src/engine/buildDailyPlan.js";
import { baseRawContext } from "../../../../head-coach-engine/fixtures/louis.js";
import { PROVISIONAL_THRESHOLDS } from "../../../../head-coach-engine/src/engine/provisionalThresholds.js";
import { isValidDailyPlan } from "./dailyPlanValidation";
import { DailyPlanView } from "./DailyPlanView";
import type { DailyPlan } from "./dailyPlanTypes";

/**
 * V0.3.012 — "Pourquoi cette décision ?" must render decision_reasoning
 * (already filtered by the engine's reasoningBuilder.ts), never the raw
 * triggered_rules audit array — see docs/11_DECISION_LOG.md V0.3.012. Real
 * RawContext → real buildDailyPlan → real DailyPlanView render, same
 * end-to-end pattern as DailyPlanView.enriched.test.tsx.
 */
function openPanel() {
  const summary = screen.getByText("Pourquoi cette décision ?");
  summary.click();
  return summary.closest("details")!;
}

describe("DailyPlanView — 'Pourquoi cette décision ?' panel (V0.3.012)", () => {
  it("Test 1 — REPLACE: panel shows the grip/legs pivot rules, never C3.3's stale 'nature préservée' or C3.7", () => {
    const ctx = baseRawContext({
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 240 },
      checkin: { sleep_hours: 5, leg_fatigue: 8, grip_fatigue: 8 },
    });
    const plan = buildDailyPlan(ctx);
    expect(plan.decision).toBe("REPLACE");
    expect(isValidDailyPlan(plan)).toBe(true);
    if (!isValidDailyPlan(plan)) throw new Error("unreachable");

    render(<DailyPlanView dailyPlan={plan} hasHealthSignal={false} />);

    const panel = within(openPanel());
    expect(panel.getByText(/Fatigue grip élevée/)).toBeInTheDocument();
    expect(panel.getByText(/Fatigue jambes élevée/)).toBeInTheDocument();
    expect(panel.queryByText(/nature de la séance préservée/)).not.toBeInTheDocument();
    expect(panel.queryByText(/Charge 7 jours très élevée/)).not.toBeInTheDocument();
  });

  it("Test 2 — MODIFY: panel keeps 'nature préservée' when the kind genuinely didn't change", () => {
    const ctx = baseRawContext({
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 240 },
      checkin: { sleep_hours: 5 },
    });
    const plan = buildDailyPlan(ctx);
    expect(plan.decision).toBe("MODIFY");
    expect(plan.final_session.kind).toBe("DH_PERFORMANCE");
    expect(isValidDailyPlan(plan)).toBe(true);
    if (!isValidDailyPlan(plan)) throw new Error("unreachable");

    render(<DailyPlanView dailyPlan={plan} hasHealthSignal={false} />);

    const panel = within(openPanel());
    expect(panel.getByText(/nature de la séance préservée/)).toBeInTheDocument();
  });

  it("Test 3 — KEEP with C3.7: C3.7 never appears as a decision reason; panel is absent when it's the only triggered rule", () => {
    const redMin = PROVISIONAL_THRESHOLDS.recentLoad.redMinHeavyOrModerateSessions;
    const ctx = baseRawContext({
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 240 },
      recent_sessions: Array.from({ length: redMin }, (_, i) => {
        const d = new Date(Date.UTC(2026, 7, 24));
        d.setUTCDate(d.getUTCDate() - (i + 1));
        return {
          date: d.toISOString().slice(0, 10),
          intervention: { kind: "DH_PERFORMANCE" as const, load_profile: "HEAVY" as const },
          completion_status: "done" as const,
        };
      }),
    });
    const plan = buildDailyPlan(ctx);
    expect(plan.decision).toBe("KEEP");
    expect(plan.triggered_rules.some((r) => r.rule_id === "C3.7")).toBe(true);
    expect(plan.decision_reasoning).toEqual([]);
    expect(isValidDailyPlan(plan)).toBe(true);
    if (!isValidDailyPlan(plan)) throw new Error("unreachable");

    render(<DailyPlanView dailyPlan={plan} hasHealthSignal={false} />);

    // C3.7 must still be visible via monitoring ("À surveiller"), but the
    // decision-reasoning panel itself must not exist — nothing decision-affecting to show.
    expect(screen.getByText("À surveiller")).toBeInTheDocument();
    expect(screen.getByText(/Surveiller la charge cumulée/)).toBeInTheDocument();
    expect(screen.queryByText("Pourquoi cette décision ?")).not.toBeInTheDocument();
  });

  it("legacy fallback: a persisted plan with no decision_reasoning field falls back to triggered_rules unfiltered", () => {
    const ctx = baseRawContext({
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 240 },
      checkin: { sleep_hours: 5, leg_fatigue: 8, grip_fatigue: 8 },
    });
    const plan = buildDailyPlan(ctx);
    expect(plan.decision).toBe("REPLACE");

    // Simulate a decision persisted before V0.3.012 — the field is entirely absent.
    const legacyPlan = { ...plan } as Partial<DailyPlan>;
    delete legacyPlan.decision_reasoning;
    expect(isValidDailyPlan(legacyPlan)).toBe(true);
    if (!isValidDailyPlan(legacyPlan)) throw new Error("unreachable");

    render(<DailyPlanView dailyPlan={legacyPlan} hasHealthSignal={false} />);

    // Falls back to the full triggered_rules array — C3.3's stale text is an
    // accepted legacy-degradation limitation (the field simply didn't exist
    // yet), not a regression: the panel is still present and non-empty.
    const panel = within(openPanel());
    expect(panel.getByText(/Fatigue grip élevée/)).toBeInTheDocument();
  });
});
