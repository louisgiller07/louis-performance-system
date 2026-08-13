import { describe, it, expect } from "vitest";
import { buildDailyPlan } from "../src/engine/buildDailyPlan.js";
import { baseRawContext, RACE_CALENDAR } from "../fixtures/louis.js";

describe("T4 — T-X adaptable (default framework, pas rail)", () => {
  it("T4.1 — T-X respecté quand rien ne justifie override", () => {
    const ctx = baseRawContext({
      today: "2026-08-12", // T-3 avant La Berra (2026-08-15)
      upcoming_races: [RACE_CALENDAR.LA_BERRA],
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "RECOVERY_ACTIVE", duration_min: 20 });
    expect(plan.overrode_race_protocol).toBe(false);
  });

  it("T4.2 — T-X respecté avec douleur légère non-SAFETY ajoutant monitoring/protection", () => {
    const ctx = baseRawContext({
      today: "2026-08-12", // T-3 avant La Berra
      upcoming_races: [RACE_CALENDAR.LA_BERRA],
      checkin: { pain: true, pain_intensity: 3, pain_location_code: "forearm_R" },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "RECOVERY_ACTIVE", duration_min: 20 });
    expect(plan.overrode_race_protocol).toBe(false);
    expect(plan.health_flag_to_create).toBeUndefined();
    expect(plan.monitoring.observe.some((o) => o.includes("forearm_R"))).toBe(true);
    expect(plan.protection.do_not_do.some((p) => p.includes("forearm_R"))).toBe(true);
    expect(plan.triggered_rules.some((r) => r.rule_id === "RACE_PROTOCOL_TX")).toBe(true);
    expect(plan.triggered_rules.some((r) => r.rule_id === "PAIN_NON_SAFETY")).toBe(true);
  });

  it("T4.3 — Le protocole T-X participe à l'arbitrage même quand planned_session existe déjà", () => {
    const ctx = baseRawContext({
      today: "2026-08-12", // T-3 avant La Berra (A+, HOT_TRAIL_2DAY) → T-X recommande RECOVERY_ACTIVE
      upcoming_races: [RACE_CALENDAR.LA_BERRA],
      planned_session: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" }, // plan générique qui n'a pas anticipé la course
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "RECOVERY_ACTIVE", duration_min: 20 });
    expect(plan.overrode_race_protocol).toBe(false);
    expect(plan.planned_session_before).toEqual({ kind: "STRENGTH_LOWER", load_profile: "HEAVY" });
  });

  it("Un override réel du RaceProtocol (cause dimensionnelle) porte toujours un override_reason non vide", () => {
    const ctx = baseRawContext({
      today: "2026-08-09", // T-6 avant La Berra → T-X recommande DH_TECHNICAL MODERATE
      upcoming_races: [RACE_CALENDAR.LA_BERRA],
      checkin: { grip_fatigue: 8 }, // cause dimensionnelle réelle : grip RED refuse le DH intense
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "DH_LIGHT", load_profile: "LIGHT" });
    expect(plan.overrode_race_protocol).toBe(true);
    expect(plan.override_reason).toBeTruthy();
    expect(plan.override_reason?.length).toBeGreaterThan(0);
  });
});
