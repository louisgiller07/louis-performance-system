import { describe, expect, it } from "vitest";
import {
  assignPrescriptionIds,
  buildSessionModelV2CatalogManifest,
  buildStrengthPrescriptionV2Content,
  resolveStrengthSlotCandidate,
  sportFingerprint,
  strengthIntentFor,
  validatePrescriptionV2,
  SessionModelV2ContractError,
  SessionModelV2GenerationBlockedError,
  type ExerciseItemV2Content,
  type PrescriptionV2Content,
  type StrengthPrescriptionV2Input,
} from "../../src/sessionModelV2/index.js";

// UX-11A.5b.4 — pure Force builder. Content only (no ids); tests assign
// deterministic ids then validate the identified prescription.

const MANIFEST = buildSessionModelV2CatalogManifest();
const FULL_GYM = ["barbell", "squat_rack", "dumbbells", "bench", "resistance_bands", "cable_machine", "pull_up_bar"];

const build = (input: Partial<StrengthPrescriptionV2Input> & Pick<StrengthPrescriptionV2Input, "sessionKind" | "athleteTier">) =>
  buildStrengthPrescriptionV2Content({ equipment: [], loadProfile: "MODERATE", catalog: MANIFEST, ...input });

const items = (p: PrescriptionV2Content) => p.blocks.flatMap((b) => b.items) as ExerciseItemV2Content[];
const work = (p: PrescriptionV2Content) => p.blocks.filter((b) => b.role !== "warm_up").map((b) => (b.items[0] as ExerciseItemV2Content).exerciseId);

function counter() {
  let n = 0;
  return () => `id-${++n}`;
}

function assertValid(content: PrescriptionV2Content) {
  const result = validatePrescriptionV2(assignPrescriptionIds(content, counter()));
  expect(result.ok ? [] : result.issues).toEqual([]);
}

describe("Force builder — LOWER compositions by equipment profile", () => {
  it.each<[string, Partial<StrengthPrescriptionV2Input> & Pick<StrengthPrescriptionV2Input, "sessionKind" | "athleteTier">, string[]]>([
    ["beginner, no equipment", { sessionKind: "STRENGTH_LOWER", athleteTier: "beginner" }, ["bodyweight_squat", "glute_bridge", "reverse_lunge"]],
    ["intermediate, dumbbells + bench", { sessionKind: "STRENGTH_LOWER", athleteTier: "intermediate", equipment: ["dumbbells", "bench"] }, ["goblet_squat", "dumbbell_romanian_deadlift", "bulgarian_split_squat"]],
    ["intermediate, no equipment (ordered fallbacks)", { sessionKind: "STRENGTH_LOWER", athleteTier: "intermediate" }, ["bodyweight_squat", "glute_bridge", "single_leg_romanian_deadlift"]],
    ["advanced, full gym", { sessionKind: "STRENGTH_LOWER", athleteTier: "advanced", equipment: FULL_GYM }, ["barbell_back_squat", "barbell_romanian_deadlift", "bulgarian_split_squat"]],
    ["advanced, dumbbells only", { sessionKind: "STRENGTH_LOWER", athleteTier: "advanced", equipment: ["dumbbells"] }, ["goblet_squat", "dumbbell_romanian_deadlift", "single_leg_romanian_deadlift"]],
    ["advanced, barbell without rack", { sessionKind: "STRENGTH_LOWER", athleteTier: "advanced", equipment: ["barbell"] }, ["barbell_deadlift", "barbell_romanian_deadlift", "single_leg_romanian_deadlift"]],
  ])("%s", (_label, input, expected) => {
    const content = build(input);
    expect(work(content)).toEqual(expected);
    expect(content.intentId).toBe("lower_body_strength_control");
    assertValid(content);
  });
});

describe("Force builder — UPPER compositions by equipment profile (intent upper_bike_control)", () => {
  it.each<[string, Partial<StrengthPrescriptionV2Input> & Pick<StrengthPrescriptionV2Input, "sessionKind" | "athleteTier">, string[]]>([
    ["beginner, no equipment (floor_ytw_raise as secondary)", { sessionKind: "STRENGTH_UPPER", athleteTier: "beginner" }, ["pushup", "floor_ytw_raise", "dead_bug"]],
    ["beginner, bands", { sessionKind: "STRENGTH_UPPER", athleteTier: "beginner", equipment: ["resistance_bands"] }, ["pushup", "resistance_band_row", "dead_bug"]],
    ["intermediate, dumbbells + bench", { sessionKind: "STRENGTH_UPPER", athleteTier: "intermediate", equipment: ["dumbbells", "bench"] }, ["dumbbell_bench_press", "one_arm_dumbbell_row", "dead_bug"]],
    ["intermediate, bands only", { sessionKind: "STRENGTH_UPPER", athleteTier: "intermediate", equipment: ["resistance_bands"] }, ["pushup", "resistance_band_row", "pallof_press"]],
    ["intermediate, cable only", { sessionKind: "STRENGTH_UPPER", athleteTier: "intermediate", equipment: ["cable_machine"] }, ["pushup", "lat_pulldown", "dead_bug"]],
    ["advanced, full gym", { sessionKind: "STRENGTH_UPPER", athleteTier: "advanced", equipment: FULL_GYM }, ["barbell_bench_press", "lat_pulldown", "hanging_leg_raise"]],
    ["advanced, pull-up bar only", { sessionKind: "STRENGTH_UPPER", athleteTier: "advanced", equipment: ["pull_up_bar"] }, ["pull_up", "floor_ytw_raise", "hanging_leg_raise"]],
  ])("%s", (_label, input, expected) => {
    const content = build(input);
    expect(work(content)).toEqual(expected);
    expect(content.intentId).toBe("upper_bike_control");
    assertValid(content);
  });

  it("the UPPER intent is the unique selectable session-kind intent of the catalogue (no new intent created)", () => {
    expect(strengthIntentFor("STRENGTH_UPPER")).toBe("upper_bike_control");
    expect(strengthIntentFor("STRENGTH_LOWER")).toBe("lower_body_strength_control");
  });
});

describe("Force builder — doses", () => {
  const principal = (p: PrescriptionV2Content) => items(p).find((i) => i.role === "principal")!;

  it("MODERATE: exact rows of strength-doses-v2.1 (sets, reps, RPE, rest), perSide from the exercise", () => {
    const p = build({ sessionKind: "STRENGTH_LOWER", athleteTier: "intermediate", equipment: ["dumbbells", "bench"], loadProfile: "MODERATE" });
    const [main, secondary, unilateral] = items(p).slice(3);
    expect(main).toMatchObject({ role: "principal", sets: 4, measure: { type: "reps", min: 6, max: 8, perSide: false }, rpeTarget: { min: 7, max: 8 }, restSeconds: { min: 120, max: 180 } });
    expect(secondary).toMatchObject({ role: "secondary", sets: 3, measure: { type: "reps", min: 8, max: 12, perSide: false }, rpeTarget: { min: 7, max: 7 }, restSeconds: { min: 90, max: 90 } });
    expect(unilateral).toMatchObject({ role: "unilateral", sets: 3, measure: { type: "reps", min: 8, max: 10, perSide: true }, rpeTarget: { min: 7, max: 7 }, restSeconds: { min: 60, max: 90 } });
  });

  it("LIGHT: exact rows", () => {
    const p = build({ sessionKind: "STRENGTH_LOWER", athleteTier: "intermediate", equipment: ["dumbbells", "bench"], loadProfile: "LIGHT" });
    const [main, secondary, unilateral] = items(p).slice(3);
    expect(main).toMatchObject({ sets: 3, measure: { type: "reps", min: 8, max: 10 }, rpeTarget: { min: 5, max: 6 }, restSeconds: { min: 90, max: 120 } });
    expect(secondary).toMatchObject({ sets: 2, measure: { type: "reps", min: 10, max: 12 }, rpeTarget: { min: 5, max: 6 }, restSeconds: { min: 60, max: 90 } });
    expect(unilateral).toMatchObject({ sets: 2, measure: { type: "reps", min: 8, max: 10, perSide: true }, rpeTarget: { min: 5, max: 6 }, restSeconds: { min: 60, max: 60 } });
    expect(principal(p).sets).toBe(3);
  });

  it("prevention: sets / RPE / rest from the dose catalogue, measure from the exercise reference (no conversion)", () => {
    const dead = items(build({ sessionKind: "STRENGTH_UPPER", athleteTier: "beginner" })).find((i) => i.role === "prevention")!;
    expect(dead).toMatchObject({ exerciseId: "dead_bug", sets: 2, measure: { type: "reps", min: 8, max: 10, perSide: true }, rpeTarget: { min: 6, max: 7 }, restSeconds: { min: 45, max: 60 } });
    const pallof = items(build({ sessionKind: "STRENGTH_UPPER", athleteTier: "intermediate", equipment: ["resistance_bands"], loadProfile: "LIGHT" })).find((i) => i.role === "prevention")!;
    expect(pallof).toMatchObject({ exerciseId: "pallof_press", sets: 2, measure: { type: "reps", min: 12, max: 12, perSide: true }, rpeTarget: { min: 5, max: 6 } });
    const leg = items(build({ sessionKind: "STRENGTH_UPPER", athleteTier: "advanced", equipment: FULL_GYM })).find((i) => i.role === "prevention")!;
    expect(leg).toMatchObject({ exerciseId: "hanging_leg_raise", measure: { type: "reps", min: 12, max: 15, perSide: false } });
  });

  it("never reads legacy setVolume / targetRpeOrRir, and refuses any load level other than LIGHT / MODERATE", () => {
    expect(() => build({ sessionKind: "STRENGTH_LOWER", athleteTier: "beginner", loadProfile: "HEAVY" as never })).toThrow(SessionModelV2ContractError);
    const p = build({ sessionKind: "STRENGTH_LOWER", athleteTier: "beginner" });
    expect(JSON.stringify(p)).not.toMatch(/setVolume|targetRpeOrRir|kg|load/i);
  });
});

describe("Force builder — warm-up, rampUp, structure", () => {
  it("warm-up: exactly the template's three items, sets from the template, measure / rest / cue from the exercise, protocol instructions", () => {
    const p = build({ sessionKind: "STRENGTH_LOWER", athleteTier: "advanced", equipment: FULL_GYM });
    expect(p.blocks[0]).toEqual({
      role: "warm_up",
      instructionIds: ["instruction.strength_warm_up.mobility", "instruction.strength_warm_up.activation"],
      items: [
        { kind: "exercise", exerciseId: "hip_90_90", role: "warm_up", sets: 1, measure: { type: "duration", minSeconds: 45, maxSeconds: 60, perSide: true }, restSeconds: { min: 0, max: 15 }, cueId: "cue.hip_90_90", vigilanceIds: ["vigilance.mobility_no_forced_range"] },
        { kind: "exercise", exerciseId: "knee_to_wall_ankle", role: "warm_up", sets: 1, measure: { type: "duration", minSeconds: 30, maxSeconds: 45, perSide: true }, restSeconds: { min: 0, max: 15 }, cueId: "cue.knee_to_wall_ankle", vigilanceIds: ["vigilance.mobility_no_forced_range", "vigilance.knee_pain_free_range"] },
        { kind: "exercise", exerciseId: "bird_dog", role: "activation", sets: 2, measure: { type: "reps", min: 8, max: 8, perSide: true }, restSeconds: { min: 30, max: 30 }, cueId: "cue.bird_dog", vigilanceIds: ["vigilance.wrist_support_alternative"] },
      ],
    });
    const upper = build({ sessionKind: "STRENGTH_UPPER", athleteTier: "beginner" });
    expect(upper.blocks[0]!.items.map((i) => [(i as ExerciseItemV2Content).exerciseId, (i as ExerciseItemV2Content).sets])).toEqual([
      ["thoracic_rotation_mobility", 1],
      ["wrist_mobility", 1],
      ["bear_crawl", 2],
    ]);
    expect((upper.blocks[0]!.items[2] as ExerciseItemV2Content).measure).toEqual({ type: "duration", minSeconds: 20, maxSeconds: 30, perSide: false });
  });

  it("blocks: warm_up → main (principal) → complementary → complementary; no cool_down; rampUp on the principal only", () => {
    const p = build({ sessionKind: "STRENGTH_UPPER", athleteTier: "advanced", equipment: FULL_GYM });
    expect(p.blocks.map((b) => [b.role, b.items.length])).toEqual([
      ["warm_up", 3],
      ["main", 1],
      ["complementary", 1],
      ["complementary", 1],
    ]);
    const withRamp = items(p).filter((i) => i.rampUp !== undefined);
    expect(withRamp.map((i) => i.role)).toEqual(["principal"]);
    expect(withRamp[0]!.rampUp).toEqual({ instructionId: "instruction.strength_warm_up.main_movement_ramp", sets: { min: 1, max: 2 } });
    expect(JSON.stringify(p)).not.toMatch(/prescriptionItemId|blockId|derivedFromItemId/);
  });

  it("the stored exercise role is the slot role and is held by the exercise", () => {
    for (const kind of ["STRENGTH_LOWER", "STRENGTH_UPPER"] as const) {
      for (const tier of ["beginner", "intermediate", "advanced"] as const) {
        for (const equipment of [[], FULL_GYM]) {
          const p = build({ sessionKind: kind, athleteTier: tier, equipment });
          assertValid(p);
          expect(items(p).slice(3).map((i) => i.role)).toEqual(kind === "STRENGTH_LOWER" ? ["principal", "secondary", "unilateral"] : ["principal", "secondary", "prevention"]);
        }
      }
    }
  });
});

describe("Force builder — stability, fingerprint, blocks and contract errors", () => {
  it("same kind + tier + equipment → same composition and same fingerprint; there is no date or ordinal input at all", () => {
    const input = { sessionKind: "STRENGTH_LOWER" as const, athleteTier: "intermediate" as const, equipment: ["dumbbells", "bench"] };
    const a = build(input);
    const b = build({ ...input, equipment: ["bench", "dumbbells"] });
    expect(a).toEqual(b);
    expect(sportFingerprint(a)).toBe(sportFingerprint(b));
    // Extra fields (a date, an ordinal) are not part of the input contract and cannot change anything.
    const withNoise = buildStrengthPrescriptionV2Content({ ...input, loadProfile: "MODERATE", catalog: MANIFEST, ...({ date: "2026-10-05", dhSessionOrdinal: 7 } as object) });
    expect(withNoise).toEqual(a);
  });

  it.each([
    ["templates", "strength-templates-v9.9"],
    ["strengthDoses", "strength-doses-v9.9"],
    ["exercises", "session-exercises-v9.9"],
    ["planDosePolicy", "plan-dose-policy-v9.9"],
  ])("a different %s version changes the fingerprint", (key, value) => {
    const input = { sessionKind: "STRENGTH_UPPER" as const, athleteTier: "beginner" as const };
    expect(sportFingerprint(build({ ...input, catalog: { ...MANIFEST, [key]: value } }))).not.toBe(sportFingerprint(build(input)));
  });

  it("carries the current manifest", () => {
    expect(build({ sessionKind: "STRENGTH_LOWER", athleteTier: "beginner" }).catalog).toEqual({
      aggregate: "session-model-v2.2",
      exercises: "session-exercises-v2.1",
      drills: "session-drills-v2.0",
      intents: "session-intents-v2.0",
      protocols: "session-protocols-v2.0",
      texts: "coaching-text-v1.0",
      templates: "strength-templates-v2.1",
      strengthDoses: "strength-doses-v2.1",
      planDosePolicy: "plan-dose-policy-v2.0",
    });
  });

  it("slot resolution: ordered candidates only, tier then required equipment; optional equipment never blocks", () => {
    expect(resolveStrengthSlotCandidate({ candidates: ["barbell_back_squat", "goblet_squat"] }, "intermediate", ["barbell", "squat_rack", "dumbbells"])).toMatchObject({ ok: true, exercise: { exerciseId: "goblet_squat" } });
    // reverse_lunge has dumbbells as OPTIONAL equipment: still selected with no equipment.
    expect(resolveStrengthSlotCandidate({ candidates: ["reverse_lunge"] }, "beginner", [])).toMatchObject({ ok: true, exercise: { exerciseId: "reverse_lunge" } });
  });

  it("no compatible candidate → no_compatible_strength_exercise with an explanatory detail (current official templates always end with a no-equipment candidate)", () => {
    expect(resolveStrengthSlotCandidate({ candidates: ["barbell_back_squat", "goblet_squat"] }, "advanced", [])).toEqual({
      ok: false,
      examined: [
        { exerciseId: "barbell_back_squat", rejectedBecause: "equipment", missingEquipment: ["barbell", "squat_rack"] },
        { exerciseId: "goblet_squat", rejectedBecause: "equipment", missingEquipment: ["dumbbells"] },
      ],
    });
    expect(resolveStrengthSlotCandidate({ candidates: ["barbell_back_squat"] }, "beginner", FULL_GYM)).toEqual({ ok: false, examined: [{ exerciseId: "barbell_back_squat", rejectedBecause: "tier" }] });
    const error = new SessionModelV2GenerationBlockedError("no_compatible_strength_exercise", { slot: 0 });
    expect(error.code).toBe("no_compatible_strength_exercise");
  });

  it("contract errors: unknown session kind or tier", () => {
    expect(() => build({ sessionKind: "STRENGTH_FULL_LIGHT" as never, athleteTier: "beginner" })).toThrow(SessionModelV2ContractError);
    expect(() => build({ sessionKind: "STRENGTH_LOWER", athleteTier: "elite" as never })).toThrow(SessionModelV2ContractError);
  });
});
