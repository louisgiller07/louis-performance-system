import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
// Direct relative source import of the real head-coach-engine package —
// no dependency/workspace/alias exists between web/ and head-coach-engine
// (deliberate, see dailyPlanTypes.ts), but Vite/Vitest resolve a relative
// .ts import across the boundary natively (empirically verified, V0.3_002F).
// This is the sole place in web/ that imports head-coach-engine directly —
// test-only, never production code.
import { buildDailyPlan } from "../../../../head-coach-engine/src/engine/buildDailyPlan.js";
import { baseRawContext } from "../../../../head-coach-engine/fixtures/louis.js";
import { isValidDailyPlan } from "./dailyPlanValidation";
import { DailyPlanView } from "./DailyPlanView";

/**
 * Closes the V0.3_002E carried-forward web compatibility gate durably
 * (docs/06_ARCHITECTURE.md §V0.3_002E, §Frontière rollout V0.3_002F). Runs
 * the real current path end-to-end: real RawContext → real buildDailyPlan
 * (Technique/Mental/Nutrition all active) → real isValidDailyPlan → real
 * DailyPlanView render. No captured/hand-copied DailyPlan object — this
 * test fails naturally if a future engine change becomes web-incompatible.
 * Coaching content/heuristics themselves remain owned by T11/T12/T13.
 */
describe("DailyPlanView — real enriched engine output", () => {
  it("accepts and renders a real Technique + Mental + Nutrition plan produced by the current engine", () => {
    const ctx = baseRawContext({
      planned_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
      upcoming_races: [
        { event_name: "Fixture race", event_start: "2026-08-27", event_end: "2026-08-27", priority: "A", race_format: "OTHER" },
      ],
      checkin: { work_stress: 6 },
    });

    const plan = buildDailyPlan(ctx);

    // Guards this test itself against silently becoming a trivial
    // all-inactive fixture.
    expect(plan.dh_or_technical.active).toBe(true);
    expect(plan.mental.active).toBe(true);
    expect(plan.nutrition.active).toBe(true);
    expect(plan.dh_or_technical.focus).toBeDefined();
    expect(plan.dh_or_technical.spot_hint).toBeDefined();
    expect(plan.mental.focus).toBeDefined();
    expect(plan.mental.action_hint).toBeDefined();
    expect(plan.nutrition.notes).toBeDefined();

    expect(isValidDailyPlan(plan)).toBe(true);
    if (!isValidDailyPlan(plan)) {
      throw new Error("unreachable — asserted above; narrows `plan` for the render call below");
    }

    render(<DailyPlanView dailyPlan={plan} hasHealthSignal={false} />);

    // V0.3_008B0 — Louis's fixture has a configured personal focus, so the
    // real engine output now also carries a generic execution_task
    // alongside it; DailyPlanView renders both with explicit labels.
    expect(screen.getByText(`Focus : ${plan.dh_or_technical.focus!}`)).toBeInTheDocument();
    expect(plan.dh_or_technical.execution_task).toBeDefined();
    expect(screen.getByText(`Tâche du jour : ${plan.dh_or_technical.execution_task!}`)).toBeInTheDocument();
    expect(screen.getByText(plan.dh_or_technical.spot_hint!)).toBeInTheDocument();
    expect(screen.getByText(plan.mental.focus!)).toBeInTheDocument();
    expect(screen.getByText(plan.mental.action_hint!)).toBeInTheDocument();
    expect(screen.getByText(plan.nutrition.notes!)).toBeInTheDocument();
  });
});

// V0.3_008A — Previous-Day Recovery Continuity, real end-to-end proof: real
// RawContext.recent_recovery_context → real buildDailyPlan (pure
// passthrough) → real isValidDailyPlan → real DailyPlanView render. Fails
// naturally if a future engine change ever breaks this field's shape.
describe("DailyPlanView — real engine output with recent_recovery_context (V0.3_008A)", () => {
  it("a real RawContext carrying a D-1 recovery context produces a plan whose Contexte récent section renders correctly", () => {
    const ctx = baseRawContext({
      recent_recovery_context: {
        session_date: "2026-08-23",
        completion_status: "partial",
        change_reason: "fatigue_control",
        post_leg_fatigue: 7,
        post_grip_fatigue: 7,
      },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.recent_recovery_context).toEqual(ctx.recent_recovery_context);
    expect(isValidDailyPlan(plan)).toBe(true);
    if (!isValidDailyPlan(plan)) {
      throw new Error("unreachable — asserted above; narrows `plan` for the render call below");
    }

    render(<DailyPlanView dailyPlan={plan} hasHealthSignal={false} />);

    expect(screen.getByText("Contexte récent")).toBeInTheDocument();
    expect(screen.getByText("Hier, ta séance a été écourtée pour fatigue ou perte de contrôle.")).toBeInTheDocument();
    expect(screen.getByText("Fatigue déclarée après la séance : jambes 7/10 · grip 7/10.")).toBeInTheDocument();
  });

  it("a real RawContext with no recent_recovery_context produces a plan with no Contexte récent section", () => {
    const ctx = baseRawContext();
    const plan = buildDailyPlan(ctx);

    expect(plan.recent_recovery_context).toBeUndefined();
    expect(isValidDailyPlan(plan)).toBe(true);
    if (!isValidDailyPlan(plan)) {
      throw new Error("unreachable — asserted above; narrows `plan` for the render call below");
    }

    render(<DailyPlanView dailyPlan={plan} hasHealthSignal={false} />);
    expect(screen.queryByText("Contexte récent")).not.toBeInTheDocument();
  });
});
