import { describe, it, expect } from "vitest";
import { buildDailyPlan } from "../src/engine/buildDailyPlan.js";
import { baseRawContext, RACE_CALENDAR } from "../fixtures/louis.js";

describe("T5 — Courses multi-jours", () => {
  it("T5.1 — Course en cours à J+1 après event_start", () => {
    const ctx = baseRawContext({
      today: "2026-08-16",
      upcoming_races: [RACE_CALENDAR.LA_BERRA],
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.event_context?.in_progress).toBe(true);
    expect(plan.event_context?.event_day).toBe(1);
    expect(plan.event_context?.phase).toBe("RACE_DAY_GENERIC");
    expect(plan.final_session).toEqual({ kind: "RACE_ACTIVITY" });
  });

  it("T5.2 — Contexte post-event utile", () => {
    const ctx = baseRawContext({
      today: "2026-08-17",
      upcoming_races: [RACE_CALENDAR.LA_BERRA],
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.event_context?.in_progress).toBe(false);
    expect(plan.event_context?.phase).toBe("POST_EVENT");
    expect(plan.event_context?.days_from_event).toBe(2);
    expect(plan.final_session).toEqual({ kind: "RECOVERY_ACTIVE" });
    expect(plan.triggered_rules.some((r) => r.rule_id === "POST_EVENT")).toBe(true);
  });

  it("T5.3 — Priorité au programme officiel si race_phase renseigné", () => {
    const verbierQuali = { ...RACE_CALENDAR.VERBIER, race_phase: "QUALI" as const };
    const ctx = baseRawContext({
      today: "2026-09-12", // event_day=1
      upcoming_races: [verbierQuali],
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.event_context?.phase).toBe("QUALI");
    expect(plan.final_session).toEqual({ kind: "RACE_ACTIVITY" });
  });
});
