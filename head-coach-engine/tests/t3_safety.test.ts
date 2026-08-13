import { describe, it, expect } from "vitest";
import { buildDailyPlan } from "../src/engine/buildDailyPlan.js";
import { baseRawContext } from "../fixtures/louis.js";
import { evaluateSafety } from "../src/rules/safety.js";
import { baseCheckin } from "../fixtures/louis.js";

describe("T3 — SAFETY strictement limitée", () => {
  it("T3.1 — Suspicion de commotion déclenche SAFETY A1", () => {
    const ctx = baseRawContext({ checkin: { suspected_concussion: true } });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "REST" });
    expect(plan.health_flag_to_create?.type).toBe("concussion_suspect");
    expect(plan.confidence).toBe("HIGH");
    expect(plan.reasoning).toContain("professionnel de santé");
  });

  it("T3.2 — Douleur légère non-SAFETY reste actionnable", () => {
    const ctx = baseRawContext({
      planned_session: { kind: "STRENGTH_UPPER", load_profile: "HEAVY" },
      checkin: { pain: true, pain_intensity: 3, pain_location_code: "wrist_R" },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session.kind).not.toBe("REST");
    expect(plan.monitoring.observe.some((o) => o.includes("wrist_R"))).toBe(true);
    expect(plan.protection.do_not_do.some((p) => p.includes("wrist_R"))).toBe(true);
    expect(plan.final_session).toEqual({ kind: "STRENGTH_UPPER", load_profile: "MODERATE" });
  });

  it("T3.3 — Douleur avec critère traumatique déclenche SAFETY A4", () => {
    const ctx = baseRawContext({
      checkin: { pain: true, pain_intensity: 4, pain_traumatic: true, pain_location_code: "wrist_R" },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "REST" });
    expect(plan.health_flag_to_create).toBeDefined();
    expect(plan.reasoning).toContain("professionnel de santé");
  });

  describe("A5 — ZERO_DH toujours tracée", () => {
    it("Séance DH planifiée → remplacée, A5 tracée, protection explicite", () => {
      const ctx = baseRawContext({
        planned_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
        active_health_flags: [{ type: "concussion_suspect", status: "monitoring" }],
      });

      const plan = buildDailyPlan(ctx);

      expect(plan.final_session).toEqual({ kind: "RECOVERY_ACTIVE" });
      expect(plan.confidence).toBe("HIGH");
      expect(plan.triggered_rules.some((r) => r.rule_id === "A5")).toBe(true);
      expect(plan.protection.do_not_do.some((p) => p.toLowerCase().includes("dh"))).toBe(true);
    });

    it("Séance non-DH planifiée → maintenue, mais A5 reste tracée et visible", () => {
      const ctx = baseRawContext({
        planned_session: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" },
        active_health_flags: [{ type: "concussion_suspect", status: "monitoring" }],
      });

      const plan = buildDailyPlan(ctx);

      expect(plan.final_session).toEqual({ kind: "STRENGTH_UPPER", load_profile: "MODERATE" });
      expect(plan.decision).toBe("KEEP");
      expect(plan.confidence).toBe("HIGH");
      expect(plan.triggered_rules.some((r) => r.rule_id === "A5")).toBe(true);
      expect(plan.protection.do_not_do.some((p) => p.toLowerCase().includes("dh"))).toBe(true);
    });
  });

  describe("Règles A1-A5 isolées", () => {
    it("A3 — fièvre/maladie déclenche REST", () => {
      const result = evaluateSafety(baseCheckin({ fever_or_illness: true }), []);
      expect(result?.rule_id).toBe("A3");
      expect(result?.action).toBe("REST");
    });

    it("A5 — flag concussion_suspect non résolu déclenche ZERO_DH", () => {
      const result = evaluateSafety(baseCheckin(), [{ type: "concussion_suspect", status: "monitoring" }]);
      expect(result?.rule_id).toBe("A5");
      expect(result?.action).toBe("ZERO_DH");
    });

    it("Aucune SAFETY sur un checkin neutre", () => {
      const result = evaluateSafety(baseCheckin(), []);
      expect(result).toBeNull();
    });
  });
});
