import { describe, expect, it } from "vitest";
import { isValidDailyRunResponse, isValidDailyPlan } from "./dailyPlanValidation";

const VALID_DAILY_PLAN = {
  active_mode: "IN_SEASON",
  training: { active: true, session_type: { kind: "AEROBIC_BASE", load_profile: "MODERATE" }, objective: "Base aérobie" },
  dh_or_technical: { active: false },
  mental: { active: false },
  recovery: { active: true, actions: ["Étirements 10 min"] },
  nutrition: { active: false },
  sleep: { active: true, target_hours: 8 },
  protection: { do_not_do: [] },
  monitoring: { observe: [] },
  reasoning: "Tout va bien.",
  confidence: "MEDIUM",
  triggered_rules: [],
  planned_session_before: { kind: "AEROBIC_BASE", load_profile: "MODERATE" },
  final_session: { kind: "AEROBIC_BASE", load_profile: "MODERATE" },
  decision: "KEEP",
  overrode_race_protocol: false,
  engine_version: "1.0.0",
};

const VALID_RESPONSE = {
  dailyPlan: VALID_DAILY_PLAN,
  decisionId: "11111111-1111-1111-1111-111111111111",
  healthFlagId: null,
  warnings: [],
};

describe("isValidDailyRunResponse", () => {
  it("accepts a real, well-formed response", () => {
    expect(isValidDailyRunResponse(VALID_RESPONSE)).toBe(true);
  });

  it("accepts a non-null healthFlagId and a non-empty warnings array", () => {
    expect(
      isValidDailyRunResponse({
        ...VALID_RESPONSE,
        healthFlagId: "33333333-3333-3333-3333-333333333333",
        warnings: ["une alerte"],
      })
    ).toBe(true);
  });

  it("accepts a null planned_session_before (no prior planned session)", () => {
    expect(
      isValidDailyRunResponse({
        ...VALID_RESPONSE,
        dailyPlan: { ...VALID_DAILY_PLAN, planned_session_before: null },
      })
    ).toBe(true);
  });

  it("rejects null/undefined/non-object payloads", () => {
    expect(isValidDailyRunResponse(null)).toBe(false);
    expect(isValidDailyRunResponse(undefined)).toBe(false);
    expect(isValidDailyRunResponse("not an object")).toBe(false);
    expect(isValidDailyRunResponse(42)).toBe(false);
  });

  it("rejects a missing/non-string decisionId", () => {
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, decisionId: undefined })).toBe(false);
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, decisionId: 123 })).toBe(false);
  });

  it("rejects a healthFlagId that is neither null nor a string", () => {
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, healthFlagId: 123 })).toBe(false);
  });

  it("rejects a non-array or non-string-array warnings", () => {
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, warnings: "not an array" })).toBe(false);
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, warnings: [1, 2] })).toBe(false);
  });

  it("rejects a missing dailyPlan", () => {
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, dailyPlan: undefined })).toBe(false);
  });

  it("rejects an out-of-enum decision/confidence/active_mode", () => {
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, dailyPlan: { ...VALID_DAILY_PLAN, decision: "INVENT" } })).toBe(false);
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, dailyPlan: { ...VALID_DAILY_PLAN, confidence: "SUPER_HIGH" } })).toBe(false);
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, dailyPlan: { ...VALID_DAILY_PLAN, active_mode: "MADE_UP" } })).toBe(false);
  });

  it("rejects a non-string reasoning", () => {
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, dailyPlan: { ...VALID_DAILY_PLAN, reasoning: 42 } })).toBe(false);
  });

  it("rejects a missing section (e.g. recovery) or a section missing its required array", () => {
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, dailyPlan: { ...VALID_DAILY_PLAN, recovery: undefined } })).toBe(false);
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, dailyPlan: { ...VALID_DAILY_PLAN, recovery: { active: true } } })).toBe(false);
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, dailyPlan: { ...VALID_DAILY_PLAN, protection: { do_not_do: "not an array" } } })).toBe(false);
  });

  it("rejects a final_session missing a kind, or a malformed triggered_rules entry", () => {
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, dailyPlan: { ...VALID_DAILY_PLAN, final_session: {} } })).toBe(false);
    expect(
      isValidDailyRunResponse({
        ...VALID_RESPONSE,
        dailyPlan: { ...VALID_DAILY_PLAN, triggered_rules: [{ layer: "A", rule_id: "A1" }] },
      })
    ).toBe(false);
  });
});

// isValidDailyPlan is reused (not duplicated) by web/src/features/history's
// summarizeDecision to decide whether a stored decisions.daily_plan row
// (from an engine_version that might predate the current contract) is
// trustworthy enough for rich rendering.
describe("isValidDailyPlan", () => {
  it("accepts a real, well-formed DailyPlan (no decisionId/healthFlagId/warnings wrapper needed)", () => {
    expect(isValidDailyPlan(VALID_DAILY_PLAN)).toBe(true);
  });

  it("rejects a legacy/malformed shape without crashing", () => {
    expect(isValidDailyPlan({ decision: "NOT_A_REAL_ENUM" })).toBe(false);
    expect(isValidDailyPlan(null)).toBe(false);
    expect(isValidDailyPlan("not an object")).toBe(false);
  });

  it("accepts a well-formed health_flag_to_create", () => {
    expect(
      isValidDailyPlan({ ...VALID_DAILY_PLAN, health_flag_to_create: { type: "pain_persistent", reason: "Douleur 3 jours de suite" } })
    ).toBe(true);
  });

  it("accepts an absent health_flag_to_create (undefined — the normal no-signal case)", () => {
    expect(isValidDailyPlan(VALID_DAILY_PLAN)).toBe(true);
  });

  it("rejects health_flag_to_create: null — never silently treated as 'no signal' by staying undefined-shaped", () => {
    expect(isValidDailyPlan({ ...VALID_DAILY_PLAN, health_flag_to_create: null })).toBe(false);
  });

  it("rejects health_flag_to_create as a bare string, e.g. a stray rule id", () => {
    expect(isValidDailyPlan({ ...VALID_DAILY_PLAN, health_flag_to_create: "A1" })).toBe(false);
  });

  it("rejects health_flag_to_create with an invalid type or a non-string reason", () => {
    expect(isValidDailyPlan({ ...VALID_DAILY_PLAN, health_flag_to_create: { type: "NOT_A_REAL_TYPE", reason: "x" } })).toBe(false);
    expect(isValidDailyPlan({ ...VALID_DAILY_PLAN, health_flag_to_create: { type: "illness", reason: 42 } })).toBe(false);
    expect(isValidDailyPlan({ ...VALID_DAILY_PLAN, health_flag_to_create: { type: "illness" } })).toBe(false);
  });
});

// REV-001 — active_mode: "UNSPECIFIED" has been a legitimate engine output
// since V0.3_004C (head-coach-engine/src/types/context.ts, "no current
// training_blocks configured" — never a fabricated phase). This mirror was
// never updated in lockstep, so every fresh-athlete DailyPlan was silently
// rejected by both Today and History despite persisting successfully
// server-side. FRESH_ATHLETE_PLAN mirrors the real shape buildDailyPlan()
// produces for this case (head-coach-engine/tests/t6_fallback.test.ts,
// scenario E): no planned session, no active domains beyond recovery,
// final_session RECOVERY_ACTIVE.
const FRESH_ATHLETE_PLAN = {
  ...VALID_DAILY_PLAN,
  active_mode: "UNSPECIFIED",
  training: { active: false },
  planned_session_before: null,
  final_session: { kind: "RECOVERY_ACTIVE" },
};

describe("REV-001 — active_mode UNSPECIFIED (unconfigured training context)", () => {
  it("isValidDailyPlan accepts a real fresh-athlete DailyPlan with active_mode: UNSPECIFIED", () => {
    expect(isValidDailyPlan(FRESH_ATHLETE_PLAN)).toBe(true);
  });

  it("isValidDailyRunResponse accepts the same plan inside a full daily-run response envelope", () => {
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, dailyPlan: FRESH_ATHLETE_PLAN })).toBe(true);
  });

  it("a genuinely unknown/invented active_mode is still rejected — UNSPECIFIED is one canonical enum member, not a validation bypass", () => {
    expect(isValidDailyPlan({ ...FRESH_ATHLETE_PLAN, active_mode: "TOTALLY_UNKNOWN_MODE" })).toBe(false);
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, dailyPlan: { ...FRESH_ATHLETE_PLAN, active_mode: "TOTALLY_UNKNOWN_MODE" } })).toBe(
      false
    );
  });
});

// V0.3_006B — Session Prescription V1 (DH-first). `duration_min` is not a
// new field (TrainingIntervention already carried it, plumbed but unused
// for DH before this milestone) and not enum-shaped, so it carries no
// REV-001-style drift risk — isValidIntervention never validated it and
// still doesn't. These tests lock that contract in permanently: a DH plan
// with the new engine-populated duration_min must validate exactly like
// one without it (a pre-V0.3_006B/legacy row).
const DH_PLAN_WITH_DURATION = {
  ...VALID_DAILY_PLAN,
  training: { active: true, session_type: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" }, objective: "Séance DH" },
  dh_or_technical: { active: true, focus: "Précision des lignes et vitesse maîtrisée", spot_hint: "Terrain adapté au focus technique du jour." },
  planned_session_before: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
  final_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 360 },
};

describe("V0.3_006B — DH duration_min contract parity", () => {
  it("a DH plan with engine-populated duration_min is accepted", () => {
    expect(isValidDailyPlan(DH_PLAN_WITH_DURATION)).toBe(true);
    expect(isValidDailyRunResponse({ ...VALID_RESPONSE, dailyPlan: DH_PLAN_WITH_DURATION })).toBe(true);
  });

  it("a legacy DH plan predating V0.3_006B (no duration_min at all) remains valid — the field is optional, never required", () => {
    const legacy = {
      ...DH_PLAN_WITH_DURATION,
      final_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
    };
    expect(isValidDailyPlan(legacy)).toBe(true);
  });
});
