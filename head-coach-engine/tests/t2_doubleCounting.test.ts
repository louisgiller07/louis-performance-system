import { describe, it, expect } from "vitest";
import { buildDailyPlan } from "../src/engine/buildDailyPlan.js";
import { baseRawContext } from "../fixtures/louis.js";

describe("T2 — Prévention du double-counting", () => {
  it("T2.1 — sleep_deficit apparaît dans exactement une règle", () => {
    const ctx = baseRawContext({
      planned_session: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" },
      checkin: { sleep_hours: 5.5 },
    });

    const plan = buildDailyPlan(ctx);

    const rulesCitingSleepDeficit = plan.triggered_rules.filter((r) => r.signals_used?.includes("sleep_deficit"));
    expect(rulesCitingSleepDeficit).toHaveLength(1);
    expect(rulesCitingSleepDeficit[0]?.rule_id).toBe("C3.3");
  });
});
