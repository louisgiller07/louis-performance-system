import { describe, expect, it } from "vitest";
import {
  buildSessionModelV2CatalogManifest,
  buildStrengthPrescriptionV2Content,
  estimateStrengthDurationMinutesV2,
  strengthItemSecondsV2,
  type ExerciseItemV2Content,
} from "../../src/sessionModelV2/index.js";
import { PLAN_ROLE_DOSES_V2, PLAN_STRENGTH_TIMING_V2 } from "../../src/catalog/planDosePolicyV2.js";
import type { StrengthDoseStepV2 } from "../../src/catalog/strengthDoseCatalogV2.js";

// PHYS-01 — a Force session's real duration, computed from its content (conservative upper bounds).

const MANIFEST = buildSessionModelV2CatalogManifest();
const KINDS = ["STRENGTH_LOWER", "STRENGTH_UPPER"] as const;
const TIERS = ["beginner", "intermediate", "advanced"] as const;
const PROFILES: readonly (readonly string[])[] = [[], ["dumbbells"], ["dumbbells", "bench"], ["resistance_bands"], ["pull_up_bar"], ["barbell"], ["barbell", "squat_rack", "dumbbells", "bench", "resistance_bands", "cable_machine", "pull_up_bar"]];

describe("PHYS-01 — Force duration estimate", () => {
  it("one exercise: sets × (setup + work) + rests between sets + one transition (+ ramp-up for the principal), upper bounds", () => {
    const item: ExerciseItemV2Content = {
      kind: "exercise",
      exerciseId: "goblet_squat",
      role: "principal",
      sets: 3,
      measure: { type: "reps", min: 8, max: 10, perSide: false },
      restSeconds: { min: 90, max: 120 },
      rpeTarget: { min: 5, max: 6 },
      cueId: "cue.goblet_squat",
      vigilanceIds: [],
      rampUp: { instructionId: "instruction.strength_warm_up.main_movement_ramp", sets: { min: 1, max: 2 } },
    };
    const T = PLAN_STRENGTH_TIMING_V2;
    expect(strengthItemSecondsV2(item)).toBe(3 * (T.setSetupSeconds + 10 * T.repSeconds) + 2 * 120 + T.transitionSeconds + 2 * (T.rampUpSetSeconds + T.rampUpRestSeconds));
    // Per side doubles the work; a hold counts its seconds; a carry is walked at ~1 m/s.
    expect(strengthItemSecondsV2({ ...item, rampUp: undefined, sets: 1, measure: { type: "reps", min: 8, max: 10, perSide: true } })).toBe(T.setSetupSeconds + 80 + T.transitionSeconds);
    expect(strengthItemSecondsV2({ ...item, rampUp: undefined, sets: 1, measure: { type: "duration", minSeconds: 30, maxSeconds: 45, perSide: true } })).toBe(T.setSetupSeconds + 90 + T.transitionSeconds);
    expect(strengthItemSecondsV2({ ...item, rampUp: undefined, sets: 1, measure: { type: "distance", minMeters: 20, maxMeters: 40 } })).toBe(T.setSetupSeconds + 40 + T.transitionSeconds);
  });

  it("every template × equipment profile: each dose step stays inside the planner's slot for it, the short Force inside 30 min", () => {
    const slot: Record<StrengthDoseStepV2, number> = {
      LIGHT: PLAN_ROLE_DOSES_V2.consolidation.forceDurationMin,
      MODERATE: PLAN_ROLE_DOSES_V2.build.forceDurationMin,
      MODERATE_PLUS: PLAN_ROLE_DOSES_V2.build_plus.forceDurationMin,
    };
    const seen: number[] = [];
    for (const sessionKind of KINDS) {
      for (const athleteTier of TIERS) {
        for (const equipment of PROFILES) {
          for (const doseStep of ["LIGHT", "MODERATE", "MODERATE_PLUS"] as const) {
            const loadProfile = doseStep === "LIGHT" ? "LIGHT" : "MODERATE";
            const minutes = estimateStrengthDurationMinutesV2(buildStrengthPrescriptionV2Content({ sessionKind, athleteTier, equipment, loadProfile, doseStep, catalog: MANIFEST }));
            expect(minutes, `${sessionKind} ${athleteTier} ${equipment.join("+")} ${doseStep}`).toBeLessThanOrEqual(slot[doseStep]);
          }
          const short = estimateStrengthDurationMinutesV2(buildStrengthPrescriptionV2Content({ sessionKind, athleteTier, equipment, loadProfile: "LIGHT", catalog: MANIFEST, variant: "short" }));
          expect(short, `${sessionKind} ${athleteTier} ${equipment.join("+")} short`).toBeLessThanOrEqual(30);
          seen.push(short);
        }
      }
    }
    // The short Force is a real session, not an empty shell.
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(20);
  });

  it("deterministic: same content → same minutes; ids do not matter", () => {
    const a = buildStrengthPrescriptionV2Content({ sessionKind: "STRENGTH_UPPER", athleteTier: "intermediate", equipment: ["dumbbells", "bench"], loadProfile: "MODERATE", catalog: MANIFEST });
    const b = buildStrengthPrescriptionV2Content({ sessionKind: "STRENGTH_UPPER", athleteTier: "intermediate", equipment: ["dumbbells", "bench"], loadProfile: "MODERATE", catalog: MANIFEST });
    expect(estimateStrengthDurationMinutesV2(a)).toBe(estimateStrengthDurationMinutesV2(b));
    expect(estimateStrengthDurationMinutesV2(a)).toBe(47);
  });
});
