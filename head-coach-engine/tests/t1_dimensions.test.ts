import { describe, it, expect } from "vitest";
import { buildDailyPlan } from "../src/engine/buildDailyPlan.js";
import { baseRawContext } from "../fixtures/louis.js";

describe("T1 — Dimensions individuelles séparées", () => {
  it("T1.1 — Grip RED + jambes GREEN → REPLACE vers STRENGTH_LOWER", () => {
    const ctx = baseRawContext({
      planned_session: { kind: "GRIP_WORK", load_profile: "HEAVY" },
      checkin: { grip_fatigue: 8, leg_fatigue: 2 },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "STRENGTH_LOWER", load_profile: "MODERATE" });
    expect(plan.decision).toBe("REPLACE");
    expect(plan.protection.do_not_do).toContain("Éviter le travail de grip lourd (fatigue avant-bras/grip élevée)");
    expect(plan.triggered_rules.some((r) => r.signals_used?.includes("grip_fatigue_high"))).toBe(true);
  });

  it("T1.2 — Jambes RED + grip GREEN → REPLACE vers STRENGTH_UPPER", () => {
    const ctx = baseRawContext({
      planned_session: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" },
      checkin: { leg_fatigue: 8, grip_fatigue: 2 },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "STRENGTH_UPPER", load_profile: "MODERATE" });
    expect(plan.decision).toBe("REPLACE");
    expect(plan.protection.do_not_do).toContain(
      "Éviter le squat lourd / travail jambes intense (fatigue jambes élevée)",
    );
  });

  it("T1.3 — Mental RED + physique GREEN → MODIFY vers AEROBIC_BASE", () => {
    const ctx = baseRawContext({
      planned_session: { kind: "AEROBIC_INTERVALS", load_profile: "MODERATE" },
      checkin: { work_stress: 8, motivation: 3, leg_fatigue: 2, grip_fatigue: 2, sleep_hours: 7.5 },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "AEROBIC_BASE", load_profile: "MODERATE" });
    expect(plan.decision).toBe("MODIFY");
    expect(plan.triggered_rules.some((r) => r.signals_used?.includes("stress_high"))).toBe(true);
  });

  it("T1.4 — Mauvais sommeil isolé → MODIFY, nature préservée", () => {
    const ctx = baseRawContext({
      planned_session: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" },
      checkin: { sleep_hours: 5.5, sleep_quality: 4 },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "STRENGTH_LOWER", load_profile: "MODERATE" });
    expect(plan.decision).toBe("MODIFY");
    expect(plan.protection.do_not_do).toContain(
      "Réduire l'intensité globale de la séance (RPE cible réduit) — sommeil insuffisant",
    );
  });
});
