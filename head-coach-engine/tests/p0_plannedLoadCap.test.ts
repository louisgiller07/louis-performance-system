import { describe, it, expect } from "vitest";
import { buildDailyPlan } from "../src/engine/buildDailyPlan.js";
import { activityFamily } from "../src/rules/committedActivityFamily.js";
import { capToPlannedLoad, PLANNED_LOAD_CAP_RULE_ID } from "../src/rules/plannedLoadCap.js";
import type { TrainingIntervention, LoadProfile } from "../src/types/trainingIntervention.js";
import type { TrainingMode } from "../src/types/context.js";
import { baseRawContext, RACE_CALENDAR } from "../fixtures/louis.js";

// P0 — M1 UPWARD MODIFY NORMAL PATH (HPM 2026-10-07): a planned session's load
// is never raised automatically (same activity family, load_profile only).

// La Berra (HOT_TRAIL_2DAY, A+) on 2026-08-15: T-7 = 08-08, T-6 = 08-09 (DH_TECHNICAL MODERATE), T-5 = 08-10.
const T = (x: number) => `2026-08-${String(15 - x).padStart(2, "0")}`;
const RANK: Record<LoadProfile, number> = { LIGHT: 0, MODERATE: 1, HEAVY: 2 };
const DH_LIGHT_60: TrainingIntervention = { kind: "DH_TECHNICAL", load_profile: "LIGHT", duration_min: 60 };
const capRule = (plan: ReturnType<typeof buildDailyPlan>) => plan.triggered_rules.find((r) => r.rule_id === PLANNED_LOAD_CAP_RULE_ID);

describe("P0 — the race protocol never raises a planned session", () => {
  it("A / B — Hot Trail T-6: planned taper DH_TECHNICAL LIGHT + T-X DH_TECHNICAL MODERATE → KEEP the planned DH LIGHT (no upward MODIFY), traced", () => {
    const plan = buildDailyPlan(baseRawContext({ today: T(6), upcoming_races: [RACE_CALENDAR.LA_BERRA], planned_session: DH_LIGHT_60 }));
    expect([plan.decision, plan.final_session]).toEqual(["KEEP", DH_LIGHT_60]);
    expect(capRule(plan)?.detail).toBe(
      "Séance planifiée DH_TECHNICAL LIGHT — proposition DH_TECHNICAL MODERATE (protocole T-X) plafonnée à la charge planifiée : DH_TECHNICAL LIGHT."
    );
    expect(capRule(plan)?.layer).toBe("ARBITRATION");
  });

  it("K — the reasoning describes the session kept, never the rejected stronger recommendation as the outcome", () => {
    const plan = buildDailyPlan(baseRawContext({ today: T(6), upcoming_races: [RACE_CALENDAR.LA_BERRA], planned_session: DH_LIGHT_60 }));
    expect(plan.training.session_type).toEqual(DH_LIGHT_60);
    expect(plan.decision_reasoning?.map((r) => r.rule_id)).toEqual(["RACE_PROTOCOL_TX", PLANNED_LOAD_CAP_RULE_ID]);
    expect(plan.overrode_race_protocol).toBe(true);
    expect(plan.override_reason).toContain("plafonnée à la charge planifiée : DH_TECHNICAL LIGHT");
  });

  it("C — planned MODERATE + protocol LIGHT: the existing reduction still applies (T-7 Force upper LIGHT)", () => {
    const plan = buildDailyPlan(baseRawContext({ today: T(7), upcoming_races: [RACE_CALENDAR.LA_BERRA], planned_session: { kind: "STRENGTH_UPPER", load_profile: "MODERATE", duration_min: 60 } }));
    expect([plan.decision, plan.final_session.kind, plan.final_session.load_profile]).toEqual(["MODIFY", "STRENGTH_UPPER", "LIGHT"]);
    expect(capRule(plan)).toBeUndefined();
  });

  it("D — planned LIGHT + protocol LIGHT: stable KEEP, no cap, no false MODIFY", () => {
    const planned: TrainingIntervention = { kind: "STRENGTH_UPPER", load_profile: "LIGHT", duration_min: 45 };
    const plan = buildDailyPlan(baseRawContext({ today: T(7), upcoming_races: [RACE_CALENDAR.LA_BERRA], planned_session: planned }));
    expect(plan.decision).toBe("KEEP");
    expect(capRule(plan)).toBeUndefined();
  });

  it("G — no planned session: no plan cap; the T-X recommendation stands (DH_TECHNICAL MODERATE)", () => {
    const plan = buildDailyPlan(baseRawContext({ today: T(6), upcoming_races: [RACE_CALENDAR.LA_BERRA] }));
    expect([plan.final_session.kind, plan.final_session.load_profile]).toEqual(["DH_TECHNICAL", "MODERATE"]);
    expect(capRule(plan)).toBeUndefined();
  });

  it("H — a family change by the protocol is untouched (planned Force LIGHT at T-6 → T-X DH MODERATE: REPLACE, no cross-family comparison)", () => {
    const plan = buildDailyPlan(baseRawContext({ today: T(6), upcoming_races: [RACE_CALENDAR.LA_BERRA], planned_session: { kind: "STRENGTH_LOWER", load_profile: "LIGHT", duration_min: 45 } }));
    expect([plan.decision, plan.final_session.kind, plan.final_session.load_profile]).toEqual(["REPLACE", "DH_TECHNICAL", "MODERATE"]);
    expect(capRule(plan)).toBeUndefined();
  });
});

describe("P0 — training-domain pivots inside a family keep the planned load", () => {
  it("E — Force: legs RED on a planned lower-body LIGHT → upper body LIGHT (was MODERATE), the kind change kept", () => {
    const plan = buildDailyPlan(baseRawContext({ planned_session: { kind: "STRENGTH_LOWER", load_profile: "LIGHT", duration_min: 45 }, checkin: { leg_fatigue: 9 } }));
    expect([plan.decision, plan.final_session.kind, plan.final_session.load_profile]).toEqual(["REPLACE", "STRENGTH_UPPER", "LIGHT"]);
    expect(capRule(plan)?.detail).toContain("(arbitrage du jour)");
  });

  it("E — Force MODERATE + legs RED: upper MODERATE as before (nothing raised, no cap)", () => {
    const plan = buildDailyPlan(baseRawContext({ planned_session: { kind: "STRENGTH_LOWER", load_profile: "MODERATE", duration_min: 60 }, checkin: { leg_fatigue: 9 } }));
    expect([plan.final_session.kind, plan.final_session.load_profile]).toEqual(["STRENGTH_UPPER", "MODERATE"]);
    expect(capRule(plan)).toBeUndefined();
  });

  it("H — a legitimate family change by fatigue is untouched (lower + legs RED + grip RED → active recovery)", () => {
    const plan = buildDailyPlan(baseRawContext({ planned_session: { kind: "STRENGTH_LOWER", load_profile: "LIGHT" }, checkin: { leg_fatigue: 9, grip_fatigue: 9 } }));
    expect(plan.final_session.kind).toBe("RECOVERY_ACTIVE");
    expect(capRule(plan)).toBeUndefined();
  });

  it("the cap itself: same family only, load only, never upward, never across families", () => {
    expect(capToPlannedLoad({ kind: "DH_TECHNICAL", load_profile: "MODERATE" }, { kind: "DH_TECHNICAL", load_profile: "LIGHT" })).toEqual({ kind: "DH_TECHNICAL", load_profile: "LIGHT" });
    expect(capToPlannedLoad({ kind: "STRENGTH_UPPER", load_profile: "HEAVY" }, { kind: "STRENGTH_LOWER", load_profile: "MODERATE" })).toEqual({ kind: "STRENGTH_UPPER", load_profile: "MODERATE" });
    expect(capToPlannedLoad({ kind: "DH_TECHNICAL", load_profile: "MODERATE" }, { kind: "STRENGTH_LOWER", load_profile: "LIGHT" })).toBeNull();
    expect(capToPlannedLoad({ kind: "AEROBIC_BASE", load_profile: "LIGHT" }, { kind: "AEROBIC_BASE", load_profile: "MODERATE" })).toBeNull();
    expect(capToPlannedLoad({ kind: "RECOVERY_ACTIVE" }, { kind: "DH_TECHNICAL", load_profile: "LIGHT" })).toBeNull();
    expect(capToPlannedLoad({ kind: "DH_TECHNICAL", load_profile: "MODERATE" }, null)).toBeNull();
  });
});

describe("P0 — matrix: V2-generable planned sessions × T-X days × daily signals × modes", () => {
  const PLANNED: TrainingIntervention[] = [
    { kind: "STRENGTH_LOWER", load_profile: "LIGHT", duration_min: 45 },
    { kind: "STRENGTH_LOWER", load_profile: "MODERATE", duration_min: 60 },
    { kind: "STRENGTH_UPPER", load_profile: "LIGHT", duration_min: 45 },
    { kind: "STRENGTH_UPPER", load_profile: "MODERATE", duration_min: 60 },
    { kind: "DH_TECHNICAL", load_profile: "LIGHT", duration_min: 60 },
    { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 },
    { kind: "AEROBIC_BASE", load_profile: "LIGHT", duration_min: 45 },
    { kind: "AEROBIC_BASE", load_profile: "MODERATE", duration_min: 60 },
  ];
  const DAYS: (string | null)[] = [null, T(7), T(6), T(5), T(4), T(3), T(2), T(1)];
  const CHECKINS = [{}, { sleep_hours: 4, sleep_quality: 2, sleep_wake_ups: 4, energy: 2 }, { leg_fatigue: 9 }, { grip_fatigue: 9 }, { work_stress: 9, motivation: 1 }, { pain: true, pain_intensity: 4, pain_new: false, pain_location_code: "knee_R" as const }];
  const MODES: TrainingMode[] = ["UNSPECIFIED", "RACE_WEEK", "INJURY_RECOVERY", "RACE_CLUSTER"];

  it("never a same-family load above the planned one; equal to the plan → KEEP", () => {
    let runs = 0;
    for (const planned of PLANNED)
      for (const day of DAYS)
        for (const checkin of CHECKINS)
          for (const mode of MODES) {
            const plan = buildDailyPlan(
              baseRawContext({ planned_session: planned, active_mode: mode, checkin, ...(day ? { today: day, upcoming_races: [RACE_CALENDAR.LA_BERRA] } : {}) })
            );
            runs++;
            const final = plan.final_session;
            const where = `${planned.kind} ${planned.load_profile} / ${day ?? "no race"} / ${JSON.stringify(checkin)} / ${mode}`;
            if (final.load_profile !== undefined && activityFamily(final.kind) !== null && activityFamily(final.kind) === activityFamily(planned.kind)) {
              expect(RANK[final.load_profile], where).toBeLessThanOrEqual(RANK[planned.load_profile!]);
            }
            if (final.kind === planned.kind && final.load_profile === planned.load_profile) expect(plan.decision, where).toBe("KEEP");
            // A same-kind decision is never an upward MODIFY (the A04 guard is never reached by M1).
            if (plan.decision === "MODIFY" && final.load_profile && final.kind === planned.kind) expect(RANK[final.load_profile], where).toBeLessThan(RANK[planned.load_profile!]);
          }
    expect(runs).toBe(PLANNED.length * DAYS.length * CHECKINS.length * MODES.length);
  });
});
