import { describe, it, expect } from "vitest";
import { buildDailyPlan } from "../src/engine/buildDailyPlan.js";
import { baseRawContext } from "../fixtures/louis.js";

describe("T7 — KEEP / MODIFY / REPLACE / REST", () => {
  it("T7.1 — KEEP quand tout aligné", () => {
    const ctx = baseRawContext({
      active_mode: "OFF_SEASON_DEVELOPMENT",
      planned_session: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "STRENGTH_UPPER", load_profile: "MODERATE" });
    expect(plan.decision).toBe("KEEP");
    expect(plan.planned_session_before).toEqual(plan.final_session);
  });

  it("T7.2 — MODIFY quand dimension force adaptation d'intensité", () => {
    const ctx = baseRawContext({
      planned_session: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" },
      checkin: { sleep_hours: 5.5 },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session.kind).toBe("STRENGTH_LOWER");
    expect(plan.decision).toBe("MODIFY");
    expect(plan.protection.do_not_do.length).toBeGreaterThan(0);
  });

  it("T7.3 — REPLACE quand cause identifiée exige changement de nature", () => {
    const ctx = baseRawContext({
      planned_session: { kind: "GRIP_WORK", load_profile: "HEAVY" },
      checkin: { grip_fatigue: 8 },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session.kind).not.toBe("GRIP_WORK");
    expect(plan.decision).toBe("REPLACE");
    expect(plan.reasoning.length).toBeGreaterThan(0);
  });

  it("T7.4 — REST déclenché par SAFETY", () => {
    const ctx = baseRawContext({ checkin: { suspected_concussion: true } });

    const plan = buildDailyPlan(ctx);

    expect(plan.decision).toBe("REST");
    expect(plan.final_session).toEqual({ kind: "REST" });
  });
});
