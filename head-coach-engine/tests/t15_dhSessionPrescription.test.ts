import { describe, it, expect } from "vitest";
import { buildDailyPlan } from "../src/engine/buildDailyPlan.js";
import { baseRawContext } from "../fixtures/louis.js";
import { resolveDhDuration, resolveDhFocus, resolveDhFatigueMonitoringNote, isDhFamilyKind } from "../src/domains/dhPrescription.js";
import { DH_DURATION_MIN, DH_GENERIC_FOCUS } from "../src/config/sessionPrescriptionPolicy.js";
import type { TriggeredRule } from "../src/types/triggeredRule.js";

/**
 * T15 — Session Prescription V1, DH-first (V0.3_006B). Proves the
 * PROVISIONAL DH duration policy, the generic focus fallback, the mental
 * execution-priority extension, and the six external-review acceptance
 * scenarios (P1-P6) — all against the real `buildDailyPlan(RawContext)`
 * pipeline, never a hand-built DailyPlan. No new DailyPlan field: everything
 * asserted here lives in the already-authoritative `final_session`,
 * `training`, `dh_or_technical`, `mental`, `monitoring` sections.
 */

const PERSONAL_FOCUS = "Fixe ta ligne, dose le freinage, laisse rouler."; // Louis's fixture value

describe("T15 — DH Session Prescription V1 duration policy", () => {
  it("resolves the exact provisional minute value for all 12 kind/load combinations", () => {
    for (const kind of Object.keys(DH_DURATION_MIN) as (keyof typeof DH_DURATION_MIN)[]) {
      for (const [load, expected] of Object.entries(DH_DURATION_MIN[kind])) {
        expect(resolveDhDuration({ kind, load_profile: load as "LIGHT" | "MODERATE" | "HEAVY" }, null)).toBe(expected);
      }
    }
  });

  it("DH_LIGHT/HEAVY (unusual but reachable) resolves to the documented provisional value (270)", () => {
    expect(resolveDhDuration({ kind: "DH_LIGHT", load_profile: "HEAVY" }, null)).toBe(270);
  });

  it("returns undefined for a non-DH-family kind", () => {
    expect(resolveDhDuration({ kind: "REST" }, null)).toBeUndefined();
    expect(resolveDhDuration({ kind: "RACE_ACTIVITY" }, null)).toBeUndefined();
    expect(resolveDhDuration({ kind: "AEROBIC_BASE", load_profile: "LIGHT" }, null)).toBeUndefined();
  });

  it("isDhFamilyKind is true for exactly the 4 DH-family kinds", () => {
    expect(isDhFamilyKind("DH_PERFORMANCE")).toBe(true);
    expect(isDhFamilyKind("DH_TECHNICAL")).toBe(true);
    expect(isDhFamilyKind("DH_LIGHT")).toBe(true);
    expect(isDhFamilyKind("PUMPTRACK")).toBe(true);
    expect(isDhFamilyKind("RACE_ACTIVITY")).toBe(false);
    expect(isDhFamilyKind("RECOVERY_ACTIVE")).toBe(false);
  });

  describe("explicit athlete duration precedence (corrected — upper bound, never a floor)", () => {
    it("CASE A — explicit duration wins exactly on a true KEEP (kind/load unchanged), even though it doesn't match the provisional table", () => {
      expect(
        resolveDhDuration(
          { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
          { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 195 }
        )
      ).toBe(195);
    });

    // CASE B — required example: planned 360 (> generic 270) capped down to 270.
    it("CASE B — a long explicit duration (360) is capped to the shorter provisional default (270) when load changed HEAVY→MODERATE", () => {
      expect(
        resolveDhDuration(
          { kind: "DH_PERFORMANCE", load_profile: "MODERATE" },
          { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 360 }
        )
      ).toBe(270);
    });

    // CASE B — required example: planned 120 (< generic 270) preserved as the upper bound.
    it("CASE B — a short explicit duration (120) is preserved as an upper bound, never lengthened up to the provisional default (270)", () => {
      expect(
        resolveDhDuration(
          { kind: "DH_PERFORMANCE", load_profile: "MODERATE" },
          { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 120 }
        )
      ).toBe(120);
    });

    // CASE B — required example: planned 360 capped to 150 on a full kind pivot (fatigue).
    it("CASE B — a long explicit duration (360) is capped to the shorter provisional default (150) when the kind pivoted to DH_LIGHT", () => {
      expect(
        resolveDhDuration(
          { kind: "DH_LIGHT", load_profile: "LIGHT" },
          { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 360 }
        )
      ).toBe(150);
    });

    // CASE B — required example: planned 90 (< generic 150) preserved as the upper bound on a kind pivot.
    it("CASE B — a short explicit duration (90) is preserved as an upper bound on a kind pivot, never lengthened up to 150", () => {
      expect(
        resolveDhDuration(
          { kind: "DH_LIGHT", load_profile: "LIGHT" },
          { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 90 }
        )
      ).toBe(90);
    });

    it("CASE C — no explicit duration at all -> the provisional default for the final kind/load", () => {
      expect(resolveDhDuration({ kind: "DH_TECHNICAL", load_profile: "LIGHT" }, null)).toBe(DH_DURATION_MIN.DH_TECHNICAL.LIGHT);
    });
  });
});

describe("T15 — corrected precedence, proved end-to-end via real buildDailyPlan (not just the pure resolver)", () => {
  it("planned 360 + mental RED downgrade to MODERATE -> final duration 270 (the generic default, since 360 exceeds it)", () => {
    const ctx = baseRawContext({
      today: "2026-01-01",
      upcoming_races: [],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 360 },
      checkin: { work_stress: 9 },
    });
    const plan = buildDailyPlan(ctx);
    expect(plan.final_session).toEqual({ kind: "DH_PERFORMANCE", load_profile: "MODERATE", duration_min: 270 });
  });

  it("planned 120 + mental RED downgrade to MODERATE -> final duration 120 (the athlete's own shorter duration, never lengthened to 270)", () => {
    const ctx = baseRawContext({
      today: "2026-01-01",
      upcoming_races: [],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 120 },
      checkin: { work_stress: 9 },
    });
    const plan = buildDailyPlan(ctx);
    expect(plan.final_session).toEqual({ kind: "DH_PERFORMANCE", load_profile: "MODERATE", duration_min: 120 });
  });

  it("planned 360 + fatigue pivot to DH_LIGHT/LIGHT -> final duration 150 (the generic default, since 360 exceeds it)", () => {
    const ctx = baseRawContext({
      today: "2026-01-01",
      upcoming_races: [],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 360 },
      checkin: { leg_fatigue: 8 },
    });
    const plan = buildDailyPlan(ctx);
    expect(plan.final_session).toEqual({ kind: "DH_LIGHT", load_profile: "LIGHT", duration_min: 150 });
  });

  it("planned 90 + fatigue pivot to DH_LIGHT/LIGHT -> final duration 90 (the athlete's own shorter duration, never lengthened to 150)", () => {
    const ctx = baseRawContext({
      today: "2026-01-01",
      upcoming_races: [],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 90 },
      checkin: { leg_fatigue: 8 },
    });
    const plan = buildDailyPlan(ctx);
    expect(plan.final_session).toEqual({ kind: "DH_LIGHT", load_profile: "LIGHT", duration_min: 90 });
  });

  it("unchanged planned DH with an explicit duration (195, no adaptation) -> final duration 195 exactly, full trust on a true KEEP", () => {
    const ctx = baseRawContext({
      today: "2026-01-01",
      upcoming_races: [],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 195 },
    });
    const plan = buildDailyPlan(ctx);
    expect(plan.decision).toBe("KEEP");
    expect(plan.final_session).toEqual({ kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 195 });
  });

  it("no explicit duration, no adaptation -> final duration 360 (the plain provisional default)", () => {
    const ctx = baseRawContext({
      today: "2026-01-01",
      upcoming_races: [],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
    });
    const plan = buildDailyPlan(ctx);
    expect(plan.final_session).toEqual({ kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 360 });
  });

  it("committed taper: explicit planned 360, ordinary T-X taper preserves DH_LIGHT/LIGHT family -> final duration 150 (capped), planned_session_before untouched", () => {
    const ctx = baseRawContext({
      today: "2026-08-10", // T-5 before LA_BERRA
      upcoming_races: [
        { event_name: "LA_BERRA", event_start: "2026-08-15", event_end: "2026-08-16", priority: "A_PLUS", race_format: "HOT_TRAIL_2DAY" },
      ],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 360 },
      planned_session_committed: true,
    });
    const plan = buildDailyPlan(ctx);
    expect(plan.final_session).toEqual({ kind: "DH_LIGHT", load_profile: "LIGHT", duration_min: 150 });
    expect(plan.planned_session_before).toEqual({ kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 360 });
  });

  it("committed taper: explicit planned 90 (shorter than the 150 generic) is preserved as the upper bound", () => {
    const ctx = baseRawContext({
      today: "2026-08-10",
      upcoming_races: [
        { event_name: "LA_BERRA", event_start: "2026-08-15", event_end: "2026-08-16", priority: "A_PLUS", race_format: "HOT_TRAIL_2DAY" },
      ],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 90 },
      planned_session_committed: true,
    });
    const plan = buildDailyPlan(ctx);
    expect(plan.final_session).toEqual({ kind: "DH_LIGHT", load_profile: "LIGHT", duration_min: 90 });
  });

  it("Safety A1: an explicit planned duration never survives as a stale DH value on REST", () => {
    const ctx = baseRawContext({
      today: "2026-01-01",
      upcoming_races: [],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 120 },
      checkin: { suspected_concussion: true },
    });
    const plan = buildDailyPlan(ctx);
    expect(plan.final_session).toEqual({ kind: "REST" });
  });

  it("Safety A5: an explicit planned duration never survives as a stale DH value on RECOVERY_ACTIVE", () => {
    const ctx = baseRawContext({
      today: "2026-01-01",
      upcoming_races: [],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 120 },
      active_health_flags: [{ type: "concussion_suspect", status: "monitoring" }],
    });
    const plan = buildDailyPlan(ctx);
    expect(plan.final_session).toEqual({ kind: "RECOVERY_ACTIVE" });
  });
});

describe("T15 — DH technical focus resolution", () => {
  it("personal focus takes precedence over the generic fallback", () => {
    expect(resolveDhFocus("DH_PERFORMANCE", PERSONAL_FOCUS)).toBe(PERSONAL_FOCUS);
  });

  it("falls back to the fixed generic focus for each DH kind when personal focus is absent", () => {
    for (const kind of Object.keys(DH_GENERIC_FOCUS) as (keyof typeof DH_GENERIC_FOCUS)[]) {
      expect(resolveDhFocus(kind, undefined)).toBe(DH_GENERIC_FOCUS[kind]);
    }
  });

  it("returns undefined for a non-DH-family kind regardless of personal focus", () => {
    expect(resolveDhFocus("RECOVERY_ACTIVE", PERSONAL_FOCUS)).toBeUndefined();
    expect(resolveDhFocus("RACE_ACTIVITY", undefined)).toBeUndefined();
  });
});

describe("T15 — DH fatigue monitoring note", () => {
  const dhRule: TriggeredRule = { layer: "C", rule_id: "C3.6", detail: "Fatigue jambes élevée." };
  const otherRule: TriggeredRule = { layer: "C", rule_id: "C3.7", detail: "Charge élevée." };

  it("present when a fatigue rule fired and the final session is still DH-family", () => {
    expect(resolveDhFatigueMonitoringNote("DH_LIGHT", [dhRule])).toBeDefined();
  });

  it("absent when no fatigue rule fired", () => {
    expect(resolveDhFatigueMonitoringNote("DH_LIGHT", [otherRule])).toBeUndefined();
  });

  it("absent when the final session is not DH-family, even if a fatigue rule fired", () => {
    expect(resolveDhFatigueMonitoringNote("RECOVERY_ACTIVE", [dhRule])).toBeUndefined();
  });

  it("never duplicated even when multiple fatigue rules fired the same run", () => {
    const note = resolveDhFatigueMonitoringNote("DH_LIGHT", [dhRule, { layer: "C", rule_id: "C3.3", detail: "Sommeil insuffisant." }]);
    expect(note).toBeDefined();
    expect(typeof note).toBe("string");
  });
});

describe("T15 — Acceptance P1: fresh athlete, DH_PERFORMANCE/HEAVY, no Safety", () => {
  it("final_session unchanged, duration 360, focus present, terrain present, existing KEEP behavior unchanged", () => {
    const ctx = baseRawContext({
      today: "2026-01-01",
      upcoming_races: [],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
    });
    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 360 });
    expect(plan.decision).toBe("KEEP");
    expect(plan.dh_or_technical.active).toBe(true);
    expect(plan.dh_or_technical.focus).toBe(PERSONAL_FOCUS); // Louis's fixture profile is configured
    expect(plan.dh_or_technical.spot_hint).toBeDefined();
  });
});

describe("T15 — Acceptance P2: fatigue (legs/grip RED), planned DH_PERFORMANCE/HEAVY", () => {
  it("existing pivot to DH_LIGHT/LIGHT unchanged, duration 150, generic focus fallback when unconfigured, fatigue monitoring note visible", () => {
    const ctx = baseRawContext({
      today: "2026-01-01",
      upcoming_races: [],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
      checkin: { leg_fatigue: 8 },
      coaching_profile: undefined,
    });
    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "DH_LIGHT", load_profile: "LIGHT", duration_min: 150 });
    expect(plan.dh_or_technical.focus).toBe(DH_GENERIC_FOCUS.DH_LIGHT);
    expect(plan.monitoring.observe.some((m) => m.includes("Réduis encore la séance ou arrête la partie DH"))).toBe(true);
    expect(plan.reasoning).not.toMatch(/RPE\s*\d/); // no invented numeric RPE
  });
});

describe("T15 — Acceptance P3: mental RED, physically fresh, planned DH_PERFORMANCE/HEAVY", () => {
  it("existing MODERATE downgrade unchanged, duration 270, mental action names the resolved focus", () => {
    const ctx = baseRawContext({
      today: "2026-01-01",
      upcoming_races: [],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
      checkin: { work_stress: 9 },
    });
    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "DH_PERFORMANCE", load_profile: "MODERATE", duration_min: 270 });
    expect(plan.mental.active).toBe(true);
    expect(plan.mental.action_hint).toContain(`Ta priorité aujourd'hui : ${PERSONAL_FOCUS.replace(/\.+$/, "")}.`);
  });
});

describe("T15 — Acceptance P4: non-Safety wrist pain, planned DH_PERFORMANCE/HEAVY", () => {
  it("existing MODERATE downgrade unchanged, duration coherent (270), protection/monitoring preserved, no medical-safety claim", () => {
    const ctx = baseRawContext({
      today: "2026-01-01",
      upcoming_races: [],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
      checkin: { pain: true, pain_intensity: 3, pain_location_code: "wrist_R" },
    });
    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "DH_PERFORMANCE", load_profile: "MODERATE", duration_min: 270 });
    expect(plan.protection.do_not_do.some((p) => p.includes("wrist_R"))).toBe(true);
    expect(plan.monitoring.observe.some((m) => m.includes("wrist_R"))).toBe(true);
    expect(plan.reasoning).not.toMatch(/sans danger|sûr médicalement|medically safe/i);
  });
});

describe("T15 — Acceptance P5: committed DH_PERFORMANCE, ordinary PRE_EVENT taper", () => {
  it("existing NAL-001 family preservation unchanged (DH_LIGHT/LIGHT), duration 150, planned_session_before deep-equal to raw intent", () => {
    const ctx = baseRawContext({
      today: "2026-08-10", // T-5 before LA_BERRA (see t4_raceProtocol.test.ts)
      upcoming_races: [
        {
          event_name: "LA_BERRA",
          event_start: "2026-08-15",
          event_end: "2026-08-16",
          priority: "A_PLUS",
          race_format: "HOT_TRAIL_2DAY",
        },
      ],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
      planned_session_committed: true,
    });
    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "DH_LIGHT", load_profile: "LIGHT", duration_min: 150 });
    expect(plan.planned_session_before).toEqual({ kind: "DH_PERFORMANCE", load_profile: "HEAVY" });
  });
});

describe("T15 — Acceptance P6: Safety precedence — no stale DH prescription", () => {
  it("A1 (suspected concussion, planned DH): duration/focus/terrain all absent, dh_or_technical inactive", () => {
    const ctx = baseRawContext({
      today: "2026-01-01",
      upcoming_races: [],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
      checkin: { suspected_concussion: true },
    });
    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "REST" });
    expect((plan.final_session as { duration_min?: number }).duration_min).toBeUndefined();
    expect(plan.dh_or_technical).toEqual({ active: false });
    expect(plan.mental.action_hint ?? "").not.toContain("Ta priorité aujourd'hui");
  });

  it("A5 (unresolved concussion flag, DH baseline forced to RECOVERY_ACTIVE): duration/focus/terrain/mental priority all absent", () => {
    const ctx = baseRawContext({
      today: "2026-01-01",
      upcoming_races: [],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
      active_health_flags: [{ type: "concussion_suspect", status: "monitoring" }],
    });
    const plan = buildDailyPlan(ctx);

    expect(plan.final_session).toEqual({ kind: "RECOVERY_ACTIVE" });
    expect((plan.final_session as { duration_min?: number }).duration_min).toBeUndefined();
    expect(plan.dh_or_technical).toEqual({ active: false });
    expect(plan.mental.action_hint ?? "").not.toContain("Ta priorité aujourd'hui");
  });
});

describe("T15 — no numeric RPE mapping, no run-count model", () => {
  it("nothing in a fresh DH plan's reasoning/monitoring/protection ever states a target RPE number", () => {
    const ctx = baseRawContext({
      today: "2026-01-01",
      upcoming_races: [],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
    });
    const plan = buildDailyPlan(ctx);
    const allText = [plan.reasoning, ...plan.monitoring.observe, ...plan.protection.do_not_do].join(" ");
    expect(allText).not.toMatch(/RPE\s*\d/i);
    expect(allText).not.toMatch(/\d+\s*(runs?|descentes?|m\s*D-?\+?)/i);
  });
});
