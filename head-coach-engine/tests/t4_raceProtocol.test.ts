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

describe("V0.3_005A (NAL-001) — Planned Activity Commitment vs raceProtocol", () => {
  // LA_BERRA (HOT_TRAIL_2DAY, A_PLUS, event_start=2026-08-15, event_end=2026-08-16):
  //   T-7=2026-08-08 -> STRENGTH_UPPER/LIGHT (ordinary)
  //   T-6=2026-08-09 -> DH_TECHNICAL/MODERATE (ordinary)
  //   T-5=2026-08-10 -> AEROBIC_BASE/LIGHT/30min (ordinary)
  //   T-2=2026-08-13 -> REST (hard, explicit zero-load)
  // VERBIER (IXS_3DAY, A_PLUS, event_start=2026-09-11, event_end=2026-09-13):
  //   T-1=2026-09-10 -> RACE_ACTIVITY (hard, official trackwalk/practice)
  //   in_progress on 2026-09-12 -> RACE_ACTIVITY (hard)

  it("1. flexible DH + ordinary T-X (T-5) → verbatim race-protocol substitution unchanged", () => {
    const ctx = baseRawContext({
      today: "2026-08-10",
      upcoming_races: [RACE_CALENDAR.LA_BERRA],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
      // planned_session_committed intentionally omitted — flexible, today's default.
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "AEROBIC_BASE", load_profile: "LIGHT", duration_min: 30 });
    expect(plan.triggered_rules.some((r) => r.rule_id === "COMMITTED_FAMILY_PRESERVED")).toBe(false);
    expect(plan.triggered_rules.some((r) => r.rule_id === "COMMITTED_FAMILY_NO_ADAPTATION")).toBe(false);
  });

  it("2. committed DH_PERFORMANCE + T-5 (dogfood bug #2) → family-preserving DH adaptation, never AEROBIC_BASE", () => {
    const ctx = baseRawContext({
      today: "2026-08-10",
      upcoming_races: [RACE_CALENDAR.LA_BERRA],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
      planned_session_committed: true,
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "DH_LIGHT", load_profile: "LIGHT" });
    expect(plan.final_session.kind).not.toBe("AEROBIC_BASE");
    expect(plan.planned_session_before).toEqual({ kind: "DH_PERFORMANCE", load_profile: "HEAVY" });
    const trace = plan.triggered_rules.find((r) => r.rule_id === "COMMITTED_FAMILY_PRESERVED");
    expect(trace).toBeDefined();
    expect(trace?.layer).toBe("ARBITRATION");
    expect(plan.overrode_race_protocol).toBe(true);
    expect(plan.override_reason).toBeTruthy();
  });

  it("3. committed bike-family activity + T-7 (dogfood bug #1) → remains bike-family, never STRENGTH_UPPER", () => {
    const ctx = baseRawContext({
      today: "2026-08-08",
      upcoming_races: [RACE_CALENDAR.LA_BERRA],
      planned_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE" }, // "sortie Enduro chill"
      planned_session_committed: true,
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "DH_LIGHT", load_profile: "LIGHT" });
    expect(plan.final_session.kind).not.toBe("STRENGTH_UPPER");
    expect(plan.planned_session_before).toEqual({ kind: "DH_TECHNICAL", load_profile: "MODERATE" });
  });

  it("4. committed activity + suspicion de commotion → REST (Safety absolue, inchangée)", () => {
    const ctx = baseRawContext({
      today: "2026-08-10",
      upcoming_races: [RACE_CALENDAR.LA_BERRA],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
      planned_session_committed: true,
      checkin: { suspected_concussion: true },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "REST" });
  });

  it("5. committed activity + maladie déclarée → REST (Safety absolue, inchangée)", () => {
    const ctx = baseRawContext({
      today: "2026-08-10",
      upcoming_races: [RACE_CALENDAR.LA_BERRA],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
      planned_session_committed: true,
      checkin: { fever_or_illness: true },
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "REST" });
  });

  it("6. committed activity + événement en cours → RACE_ACTIVITY (hard override, engagement surclassé)", () => {
    const ctx = baseRawContext({
      today: "2026-09-12", // Verbier en cours (2026-09-11..2026-09-13)
      upcoming_races: [RACE_CALENDAR.VERBIER],
      planned_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
      planned_session_committed: true,
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "RACE_ACTIVITY" });
    expect(plan.triggered_rules.some((r) => r.rule_id === "COMMITTED_FAMILY_PRESERVED")).toBe(false);
  });

  it("7. committed activity + POST_EVENT → RECOVERY_ACTIVE (hard override, engagement surclassé)", () => {
    const ctx = baseRawContext({
      today: "2026-08-17", // T+1 après la fin de La Berra (event_end=2026-08-16)
      upcoming_races: [RACE_CALENDAR.LA_BERRA],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
      planned_session_committed: true,
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "RECOVERY_ACTIVE" });
  });

  it("8. committed activity + IXS T-1 (trackwalk/practice officielle) → RACE_ACTIVITY (hard override)", () => {
    const ctx = baseRawContext({
      today: "2026-09-10", // T-1 avant Verbier (IXS_3DAY)
      upcoming_races: [RACE_CALENDAR.VERBIER],
      planned_session: { kind: "AEROBIC_BASE", load_profile: "MODERATE" },
      planned_session_committed: true,
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "RACE_ACTIVITY", focus: "Trackwalk / practice officielle" });
  });

  it("9. committed activity + T-X REST explicite → REST (hard override, engagement surclassé)", () => {
    const ctx = baseRawContext({
      today: "2026-08-13", // T-2 avant La Berra -> REST
      upcoming_races: [RACE_CALENDAR.LA_BERRA],
      planned_session: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" },
      planned_session_committed: true,
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "REST" });
  });

  it("10. aucune adaptation de même famille disponible → fallback T-X brut, avec trace explicite", () => {
    const ctx = baseRawContext({
      today: "2026-08-10", // T-5 -> AEROBIC_BASE/LIGHT/30min (ordinaire)
      upcoming_races: [RACE_CALENDAR.LA_BERRA],
      planned_session: { kind: "BIKE_MAINTENANCE" }, // fixed-load, aucune famille de repli
      planned_session_committed: true,
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "AEROBIC_BASE", load_profile: "LIGHT", duration_min: 30 });
    const trace = plan.triggered_rules.find((r) => r.rule_id === "COMMITTED_FAMILY_NO_ADAPTATION");
    expect(trace).toBeDefined();
    expect(trace?.layer).toBe("ARBITRATION");
    expect(plan.triggered_rules.some((r) => r.rule_id === "COMMITTED_FAMILY_PRESERVED")).toBe(false);
  });

  it("11. planned_session_before reste l'intervention brute exacte, jamais mutée par l'engagement", () => {
    const ctx = baseRawContext({
      today: "2026-08-10",
      upcoming_races: [RACE_CALENDAR.LA_BERRA],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
      planned_session_committed: true,
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.planned_session_before).toEqual({ kind: "DH_PERFORMANCE", load_profile: "HEAVY" });
  });

  it("12. legacy planned_sessions (planned_session_committed absent) → comportement historique inchangé", () => {
    const withoutField = baseRawContext({
      today: "2026-08-10",
      upcoming_races: [RACE_CALENDAR.LA_BERRA],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
    });
    const explicitlyFalse = baseRawContext({
      today: "2026-08-10",
      upcoming_races: [RACE_CALENDAR.LA_BERRA],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
      planned_session_committed: false,
    });

    expect(buildDailyPlan(withoutField).final_session).toEqual(buildDailyPlan(explicitlyFalse).final_session);
    expect(buildDailyPlan(withoutField).final_session).toEqual({ kind: "AEROBIC_BASE", load_profile: "LIGHT", duration_min: 30 });
  });
});
