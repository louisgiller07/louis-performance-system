import { describe, it, expect } from "vitest";
import { buildDailyPlan } from "../src/engine/buildDailyPlan.js";
import { baseRawContext } from "../fixtures/louis.js";

describe("T6 — Absence de planned_session", () => {
  it("T6.1 — Fallback d'inférence quand planned_session = null", () => {
    const ctx = baseRawContext({
      today: "2026-08-24", // lundi, hors fenêtre de toute course du calendrier
      active_mode: "OFF_SEASON_DEVELOPMENT",
      planned_session: null,
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.event_context).toBeUndefined();
    expect(plan.triggered_rules.some((r) => r.rule_id === "INFERENCE_FALLBACK")).toBe(true);
    expect(plan.final_session).toEqual({ kind: "STRENGTH_UPPER", load_profile: "MODERATE" });
  });
});
