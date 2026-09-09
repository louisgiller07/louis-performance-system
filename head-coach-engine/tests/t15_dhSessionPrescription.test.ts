import { describe, it, expect } from "vitest";
import { buildDailyPlan } from "../src/engine/buildDailyPlan.js";
import { baseRawContext } from "../fixtures/louis.js";
import { resolveDhDuration, resolveDhFocus, resolveDhLoadGuidance, resolveDhFatigueMonitoringNote, isDhFamilyKind } from "../src/domains/dhPrescription.js";
import { DH_DURATION_MIN, DH_GENERIC_FOCUS, DH_LOAD_GUIDANCE } from "../src/config/sessionPrescriptionPolicy.js";
import type { TriggeredRule } from "../src/types/triggeredRule.js";

/**
 * T15 — Session Prescription V1, DH-first (V0.3_006B). Proves the
 * PROVISIONAL DH duration policy, the generic focus fallback, the mental
 * execution-priority extension, and the six external-review acceptance
 * scenarios (P1-P6) — all against the real `buildDailyPlan(RawContext)`
 * pipeline, never a hand-built DailyPlan. No new DailyPlan field: everything
 * asserted here lives in the already-authoritative `final_session`,
 * `training`, `dh_or_technical`, `mental`, `monitoring` sections.
 *
 * V0.3_006C1 (final correction) — `dh_or_technical.load_guidance` (riding
 * behavior per FINAL load_profile) was initially web-only; corrected to be
 * engine-emitted/persisted here (see dhPrescription.ts#resolveDhLoadGuidance)
 * so History never retroactively synthesizes it for a legacy plan.
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

describe("T15 (final correction) — DH load guidance resolution", () => {
  it("returns the exact approved guidance for each of the 3 load profiles", () => {
    expect(resolveDhLoadGuidance("DH_PERFORMANCE", "LIGHT")).toBe(DH_LOAD_GUIDANCE.LIGHT);
    expect(resolveDhLoadGuidance("DH_PERFORMANCE", "MODERATE")).toBe(DH_LOAD_GUIDANCE.MODERATE);
    expect(resolveDhLoadGuidance("DH_PERFORMANCE", "HEAVY")).toBe(DH_LOAD_GUIDANCE.HEAVY);
  });

  it("consistent across all 4 DH-family kinds for a given load", () => {
    for (const kind of ["DH_PERFORMANCE", "DH_TECHNICAL", "DH_LIGHT", "PUMPTRACK"] as const) {
      expect(resolveDhLoadGuidance(kind, "HEAVY")).toBe(DH_LOAD_GUIDANCE.HEAVY);
    }
  });

  it("returns undefined for a non-DH-family kind regardless of load_profile", () => {
    expect(resolveDhLoadGuidance("RECOVERY_ACTIVE", undefined)).toBeUndefined();
    expect(resolveDhLoadGuidance("REST", undefined)).toBeUndefined();
  });

  it("returns undefined when load_profile is absent, even for a DH-family kind", () => {
    expect(resolveDhLoadGuidance("DH_PERFORMANCE", undefined)).toBeUndefined();
  });

  it("no numeric RPE/run%/run-count/speed% anywhere in the 3 approved strings", () => {
    for (const text of Object.values(DH_LOAD_GUIDANCE)) {
      expect(text).not.toMatch(/RPE\s*\d/i);
      expect(text).not.toMatch(/\d+\s*%/);
      expect(text).not.toMatch(/\d+\s*(runs?|descentes?)/i);
    }
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
    expect(plan.dh_or_technical.execution_task).toBeUndefined(); // personal focus present -> no generic task
    expect(plan.dh_or_technical.spot_hint).toBeDefined();
    expect(plan.monitoring.observe.some((m) => m.includes("Pendant la séance, arrête la partie DH"))).toBe(false);
    // V0.3_006C1 (final correction) — engine-persisted riding-behavior
    // guidance for the FINAL load (HEAVY here, no adaptation this run).
    expect(plan.dh_or_technical.load_guidance).toBe(DH_LOAD_GUIDANCE.HEAVY);
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
    expect(plan.dh_or_technical.execution_task).toBe(
      "Sur terrain connu, cherche une conduite fluide et relâchée sans objectif de vitesse."
    );
    // leg_fatigue=8 is RED (>=7). Corrected (final fatigue-terrain check):
    // technique.ts's meaningful-fatigue check now covers AMBER AND RED, so
    // this severe fatigue still selects the reduced-demand fatigue terrain,
    // never the fresh/default guidance.
    expect(plan.dh_or_technical.spot_hint).toBe(
      "Choisis un terrain familier et lisible où tu peux garder de la marge et une exécution propre."
    );
    expect(plan.monitoring.observe.some((m) => m.includes("Réduis encore la séance ou arrête la partie DH"))).toBe(true);
    expect(plan.reasoning).not.toMatch(/RPE\s*\d/); // no invented numeric RPE
    // V0.3_006C1 (final correction) — the fatigue pivot to DH_LIGHT/LIGHT
    // must carry the LIGHT guidance, never a stale HEAVY one.
    expect(plan.dh_or_technical.load_guidance).toBe(DH_LOAD_GUIDANCE.LIGHT);
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
    // V0.3_006C1 — unified pre-run-action template: one concrete pre-run
    // regulation action + the already-resolved technical priority.
    expect(plan.mental.action_hint).toContain(`rappelle-toi ta priorité : ${PERSONAL_FOCUS.replace(/\.+$/, "")}.`);
    expect(plan.mental.action_hint).toMatch(/^Avant de partir, fais quelques respirations lentes/);
    expect(plan.mental.action_hint).toContain("Pendant le run, reviens uniquement à ce focus.");
    // V0.3_006C1 (final correction) — the mental-RED downgrade to MODERATE
    // must carry the MODERATE guidance, never a stale HEAVY one.
    expect(plan.dh_or_technical.load_guidance).toBe(DH_LOAD_GUIDANCE.MODERATE);
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

  // V0.3_006C1 — immediate in-session interruption criterion, additive to
  // (never replacing) the existing 24-48h post-session follow-up.
  it("adds the immediate in-session interruption note, in addition to the existing 24-48h monitoring — never a 'safe to ride' claim", () => {
    const ctx = baseRawContext({
      today: "2026-01-01",
      upcoming_races: [],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
      checkin: { pain: true, pain_intensity: 4, pain_location_code: "wrist_L" },
    });
    const plan = buildDailyPlan(ctx);

    expect(
      plan.monitoring.observe.some((m) => m === "Pendant la séance, arrête la partie DH si la douleur augmente clairement ou si ton contrôle se dégrade.")
    ).toBe(true);
    expect(plan.monitoring.observe.some((m) => m.includes("sur 24-48h"))).toBe(true);
    expect(plan.reasoning).not.toMatch(/tu peux rouler|la séance est sûre|douleur acceptable|commence prudemment/i);
  });

  // V0.3_006C1 — terrain precedence: upper_grip pain wins over everything else.
  it("upper_grip pain (wrist) selects the reduced grip/braking terrain guidance", () => {
    const ctx = baseRawContext({
      today: "2026-01-01",
      upcoming_races: [],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
      checkin: { pain: true, pain_intensity: 3, pain_location_code: "wrist_R" },
    });
    const plan = buildDailyPlan(ctx);
    expect(plan.dh_or_technical.spot_hint).toBe("Privilégie un terrain familier, moins cassant et moins exigeant en freinage et en grip.");
  });

  // V0.3_006C1 — lower-limb non-Safety pain shares the same generic
  // reduced-demand terrain guidance, without inventing location-specific
  // biomechanics unsupported by the existing zone model.
  it("lower-limb pain (knee) selects the generic reduced-physical-demand terrain guidance", () => {
    const ctx = baseRawContext({
      today: "2026-01-01",
      upcoming_races: [],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
      checkin: { pain: true, pain_intensity: 3, pain_location_code: "knee_L" },
    });
    const plan = buildDailyPlan(ctx);
    expect(plan.dh_or_technical.spot_hint).toBe("Privilégie un terrain familier et moins exigeant physiquement.");
  });
});

describe("T15 (final fatigue-terrain check) — severe RED fatigue scenario, external-review equivalent (sleep 4h/poor, energy low, legs=RED, grip=RED)", () => {
  it("existing DH_LIGHT/LIGHT pivot unchanged, duration 150, LIGHT load_guidance, fatigue terrain (never fresh/default), fatigue monitoring", () => {
    const ctx = baseRawContext({
      today: "2026-01-01",
      upcoming_races: [],
      planned_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
      checkin: { sleep_hours: 4, sleep_quality: 2, energy: 2, leg_fatigue: 9, grip_fatigue: 9 },
    });
    const plan = buildDailyPlan(ctx);

    // Training-domain arbitration is unchanged by this ticket — same pivot
    // already proven in Acceptance P2, reconfirmed here at the more severe
    // RED level the external review actually used.
    expect(plan.final_session).toEqual({ kind: "DH_LIGHT", load_profile: "LIGHT", duration_min: 150 });
    expect(plan.dh_or_technical.load_guidance).toBe(DH_LOAD_GUIDANCE.LIGHT);
    // The fix under test: RED-level fatigue must not fall through to
    // fresh/race/default terrain merely because it exceeded AMBER.
    expect(plan.dh_or_technical.spot_hint).toBe(
      "Choisis un terrain familier et lisible où tu peux garder de la marge et une exécution propre."
    );
    expect(plan.monitoring.observe.some((m) => m.includes("Réduis encore la séance ou arrête la partie DH"))).toBe(true);
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
    // V0.3_006C1 (final correction) — explicit: no stale HEAVY load_guidance
    // survives a Safety A1 pivot (already implied by the toEqual above).
    expect((plan.dh_or_technical as { load_guidance?: string }).load_guidance).toBeUndefined();
    expect(plan.mental.action_hint ?? "").not.toContain("rappelle-toi ta priorité");
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
    // V0.3_006C1 (final correction) — explicit: no stale HEAVY load_guidance
    // survives a Safety A5 pivot (already implied by the toEqual above).
    expect((plan.dh_or_technical as { load_guidance?: string }).load_guidance).toBeUndefined();
    expect(plan.mental.action_hint ?? "").not.toContain("rappelle-toi ta priorité");
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
