import { describe, expect, it } from "vitest";
import {
  appendStrengthCoolDownV2,
  assignPrescriptionIds,
  buildSessionModelV2CatalogManifest,
  buildStrengthPrescriptionV2Content,
  estimateStrengthDurationMinutesV2,
  shortenStrengthContentV2,
  strengthItemSecondsV2,
  type ExerciseItemV2Content,
  type PrescriptionV2,
} from "../../src/sessionModelV2/index.js";
import { PLAN_ROLE_DOSES_V2 } from "../../src/catalog/planDosePolicyV2.js";
import { STRENGTH_TIMING_V2 } from "../../src/catalog/strengthDailyCatalogV2.js";
import type { StrengthDoseStepV2 } from "../../src/catalog/strengthDoseCatalogV2.js";

// PHYS-01.1 — a Force session's real duration, computed from its content (conservative upper bounds):
// warm-up, every work set, every rest, every transition, the ramp-up and the cool-down are counted.

const MANIFEST = buildSessionModelV2CatalogManifest();
const KINDS = ["STRENGTH_LOWER", "STRENGTH_UPPER"] as const;
const TIERS = ["beginner", "intermediate", "advanced"] as const;
const PROFILES: readonly (readonly string[])[] = [[], ["dumbbells"], ["dumbbells", "bench"], ["resistance_bands"], ["pull_up_bar"], ["barbell"], ["barbell", "squat_rack", "dumbbells", "bench", "resistance_bands", "cable_machine", "pull_up_bar"]];
const T = STRENGTH_TIMING_V2;
let n = 0;
const mint = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const final = (content: Parameters<typeof assignPrescriptionIds>[0], extent: "full" | "mobility" = "full"): PrescriptionV2 => appendStrengthCoolDownV2(assignPrescriptionIds(content, mint), mint, extent);

/** The same estimate, decomposed: what a 30-minute session really holds. */
function components(p: PrescriptionV2) {
  const sum = { warmUp: 0, work: 0, rests: 0, transitions: 0, rampUp: 0, coolDown: 0 };
  for (const b of p.blocks) {
    for (const i of b.items as ExerciseItemV2Content[]) {
      const measure = i.measure;
      const set = T.setSetupSeconds + (measure.type === "reps" ? measure.max * T.repSeconds * (measure.perSide ? 2 : 1) : measure.type === "duration" ? measure.maxSeconds * (measure.perSide ? 2 : 1) : measure.maxMeters);
      const rests = (i.sets - 1) * (i.restSeconds?.max ?? 0);
      const ramp = i.rampUp ? i.rampUp.sets.max * (T.rampUpSetSeconds + T.rampUpRestSeconds) : 0;
      expect(strengthItemSecondsV2(i)).toBe(i.sets * set + rests + T.transitionSeconds + ramp);
      if (b.role === "warm_up") sum.warmUp += i.sets * set + rests;
      else if (b.role === "cool_down") sum.coolDown += i.sets * set + rests;
      else {
        sum.work += i.sets * set;
        sum.rests += rests;
        sum.rampUp += ramp;
      }
      sum.transitions += T.transitionSeconds;
    }
  }
  return sum;
}

describe("PHYS-01.1 — Force duration estimate", () => {
  it("one exercise: sets × (setup + work) + the rests between its sets + one transition (+ ramp-up for the principal), upper bounds", () => {
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
    expect(strengthItemSecondsV2(item)).toBe(3 * (T.setSetupSeconds + 10 * T.repSeconds) + 2 * 120 + T.transitionSeconds + 2 * (T.rampUpSetSeconds + T.rampUpRestSeconds));
    expect(strengthItemSecondsV2({ ...item, rampUp: undefined, sets: 1, measure: { type: "duration", minSeconds: 30, maxSeconds: 45, perSide: true } })).toBe(T.setSetupSeconds + 90 + T.transitionSeconds);
    expect(strengthItemSecondsV2({ ...item, rampUp: undefined, sets: 1, measure: { type: "distance", minMeters: 20, maxMeters: 40 } })).toBe(T.setSetupSeconds + 40 + T.transitionSeconds);
  });

  it("every template × equipment × dose: the full session with its cool-down stays inside the planner's slot (the slots are unchanged)", () => {
    const slot: Record<StrengthDoseStepV2, number> = {
      LIGHT: PLAN_ROLE_DOSES_V2.consolidation.forceDurationMin,
      MODERATE: PLAN_ROLE_DOSES_V2.build.forceDurationMin,
      MODERATE_PLUS: PLAN_ROLE_DOSES_V2.build_plus.forceDurationMin,
    };
    for (const sessionKind of KINDS)
      for (const athleteTier of TIERS)
        for (const equipment of PROFILES)
          for (const doseStep of ["LIGHT", "MODERATE", "MODERATE_PLUS"] as const) {
            const content = buildStrengthPrescriptionV2Content({ sessionKind, athleteTier, equipment, loadProfile: doseStep === "LIGHT" ? "LIGHT" : "MODERATE", doseStep, catalog: MANIFEST });
            expect(estimateStrengthDurationMinutesV2(final(content)), `${sessionKind} ${athleteTier} ${equipment.join("+")} ${doseStep}`).toBeLessThanOrEqual(slot[doseStep]);
          }
  });

  it("a session shortened for 30 minutes still holds the full warm-up, every set and every rest of the work it keeps, the transitions and a cool-down", () => {
    // LIGHT (2 exercises) and MODERATE (the principal alone): the steps the A10 ladder reaches at 30 min.
    for (const sessionKind of KINDS)
      for (const athleteTier of TIERS)
        for (const [loadProfile, slots] of [["LIGHT", 2], ["MODERATE", 1]] as const) {
          const content = buildStrengthPrescriptionV2Content({ sessionKind, athleteTier, equipment: ["dumbbells", "bench"], loadProfile, catalog: MANIFEST });
          const short = final(shortenStrengthContentV2(content, slots), "mobility");
          const c = components(short);
          expect(estimateStrengthDurationMinutesV2(short), `${sessionKind} ${athleteTier} ${loadProfile}`).toBeLessThanOrEqual(30);
          expect(Object.values(c).every((v) => v > 0), JSON.stringify(c)).toBe(true);
          expect(Math.ceil((c.warmUp + c.work + c.rests + c.transitions + c.rampUp + c.coolDown) / 60)).toBe(estimateStrengthDurationMinutesV2(short));
          // Nothing in the kept work is lighter than planned: same sets, rests and RPE as the full session.
          const keptWork = short.blocks.filter((b) => b.role === "main" || b.role === "complementary").flatMap((b) => b.items);
          const fullWork = assignPrescriptionIds(content, mint).blocks.filter((b) => b.role === "main" || b.role === "complementary").flatMap((b) => b.items);
          const dose = (i: (typeof keptWork)[number]) => (i.kind === "exercise" ? [i.exerciseId, i.sets, i.measure, i.rpeTarget, i.restSeconds] : null);
          expect(keptWork.map(dose)).toEqual(fullWork.slice(0, slots).map(dose));
        }
  });

  it("deterministic: same content → same minutes; ids do not matter", () => {
    const content = buildStrengthPrescriptionV2Content({ sessionKind: "STRENGTH_UPPER", athleteTier: "intermediate", equipment: ["dumbbells", "bench"], loadProfile: "MODERATE", catalog: MANIFEST });
    expect(estimateStrengthDurationMinutesV2(final(content))).toBe(estimateStrengthDurationMinutesV2(final(content)));
    expect(estimateStrengthDurationMinutesV2(final(content))).toBe(47);
  });
});
