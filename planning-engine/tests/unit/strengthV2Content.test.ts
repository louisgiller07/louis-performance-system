import { describe, expect, it } from "vitest";
import {
  STRENGTH_EXCLUDED_FAMILIES_V2,
  STRENGTH_FAMILIES_V2,
  STRENGTH_TEMPLATE_CATALOG_V2,
  STRENGTH_TEMPLATE_CATALOG_V2_ENTRIES,
  STRENGTH_TEMPLATE_CATALOG_V2_VERSION,
  STRENGTH_TRANSVERSAL_FAMILIES_V2,
} from "../../src/catalog/strengthTemplateCatalogV2.js";
import { STRENGTH_DOSE_CATALOG_V2, STRENGTH_DOSE_CATALOG_V2_VERSION, STRENGTH_LOAD_LEVELS_V2 } from "../../src/catalog/strengthDoseCatalogV2.js";
import { PLAN_DOSE_POLICY_V2, PLAN_DOSE_POLICY_V2_VERSION } from "../../src/catalog/planDosePolicyV2.js";
import { SESSION_EXERCISE_CATALOG_V2, SESSION_EXERCISE_CATALOG_V2_VERSION } from "../../src/catalog/sessionExerciseCatalogV2.js";
import { EXERCISE_CATALOG } from "../../src/catalog/exerciseCatalog.js";
import {
  allowedExerciseTiersV2,
  exerciseMinimumTierV2,
  isExerciseAllowedForTierV2,
  validateStrengthTemplatesV2,
} from "../../src/sessionModelV2/index.js";

// UX-11A.5a.4 — strength templates, strength doses and plan dose policy V2.
// Architecture validated; content PROVISIONAL — coaching validation required.

const ex = (id: string) => SESSION_EXERCISE_CATALOG_V2[id]!;

describe("Cumulative V2 tiers (an exercise's tier is the minimum level it needs)", () => {
  it("allowed tiers per athlete tier", () => {
    expect(allowedExerciseTiersV2("beginner")).toEqual(["beginner"]);
    expect(allowedExerciseTiersV2("intermediate")).toEqual(["beginner", "intermediate"]);
    expect(allowedExerciseTiersV2("advanced")).toEqual(["beginner", "intermediate", "advanced"]);
  });

  it("beginner: beginner exercises only", () => {
    expect(isExerciseAllowedForTierV2(ex("bodyweight_squat"), "beginner")).toBe(true);
    expect(isExerciseAllowedForTierV2(ex("goblet_squat"), "beginner")).toBe(false);
    expect(isExerciseAllowedForTierV2(ex("barbell_back_squat"), "beginner")).toBe(false);
  });

  it("intermediate: beginner + intermediate", () => {
    expect(isExerciseAllowedForTierV2(ex("bodyweight_squat"), "intermediate")).toBe(true);
    expect(isExerciseAllowedForTierV2(ex("goblet_squat"), "intermediate")).toBe(true);
    expect(isExerciseAllowedForTierV2(ex("barbell_back_squat"), "intermediate")).toBe(false);
  });

  it("advanced: beginner + intermediate + advanced", () => {
    for (const id of ["bodyweight_squat", "goblet_squat", "barbell_back_squat"]) expect(isExerciseAllowedForTierV2(ex(id), "advanced"), id).toBe(true);
  });

  it("the minimum tier is the lowest declared tier (multi-tier entries)", () => {
    expect(exerciseMinimumTierV2(ex("reverse_lunge"))).toBe("beginner"); // tiers [beginner, intermediate]
    expect(exerciseMinimumTierV2(ex("bulgarian_split_squat"))).toBe("intermediate"); // tiers [intermediate, advanced]
    expect(isExerciseAllowedForTierV2(ex("reverse_lunge"), "advanced")).toBe(true);
    expect(exerciseMinimumTierV2(ex("hip_90_90"))).toBe("beginner");
  });
});

describe("Strength template catalogue V2", () => {
  const T = STRENGTH_TEMPLATE_CATALOG_V2_ENTRIES;
  const get = (kind: "STRENGTH_LOWER" | "STRENGTH_UPPER", tier: string) => T.find((t) => t.sessionKind === kind && t.athleteTier === tier)!;

  it("has its own version and exactly six templates, one per session kind × athlete tier", () => {
    expect(STRENGTH_TEMPLATE_CATALOG_V2_VERSION).toBe("strength-templates-v2.1");
    expect(T).toHaveLength(6);
    expect(Object.keys(STRENGTH_TEMPLATE_CATALOG_V2).sort()).toEqual([
      "strength_lower_advanced_v1",
      "strength_lower_beginner_v1",
      "strength_lower_intermediate_v1",
      "strength_upper_advanced_v1",
      "strength_upper_beginner_v1",
      "strength_upper_intermediate_v1",
    ]);
    expect(T.every((t) => t.validationStatus === "PROVISIONAL")).toBe(true);
  });

  it("each template has a 3-exercise warm-up and exactly three non-empty work slots, principal first in main", () => {
    for (const t of T) {
      expect(t.warmUp.mobility.length + t.warmUp.activation.length, t.templateId).toBe(3);
      expect(t.workSlots, t.templateId).toHaveLength(3);
      expect(t.workSlots[0]).toMatchObject({ blockRole: "main", role: "principal" });
      for (const slot of t.workSlots.slice(1)) expect(slot.blockRole, t.templateId).toBe("complementary");
      for (const slot of t.workSlots) expect(slot.candidates.length, t.templateId).toBeGreaterThan(0);
    }
  });

  it("families: LOWER / UPPER / transversal core as documented; grip and plyometric excluded and absent", () => {
    expect(STRENGTH_FAMILIES_V2).toEqual({
      STRENGTH_LOWER: ["squat", "hinge", "lunge", "lower_leg", "adductor", "carry"],
      STRENGTH_UPPER: ["push", "pull", "shoulder_health"],
    });
    expect(STRENGTH_TRANSVERSAL_FAMILIES_V2).toEqual(["core"]);
    expect(STRENGTH_EXCLUDED_FAMILIES_V2).toEqual(["grip", "plyometric"]);
    const used = T.flatMap((t) => [...t.warmUp.mobility.map((w) => w.exerciseId), ...t.warmUp.activation.map((w) => w.exerciseId), ...t.workSlots.flatMap((s) => s.candidates)]);
    for (const id of used) expect(["grip", "plyometric"], id).not.toContain(ex(id).family);
  });

  it("integrity: the six official templates have ZERO anomaly (ids, tiers, families, roles, warm-up protocol and sets, duplicates)", () => {
    expect(validateStrengthTemplatesV2(T)).toEqual([]);
  });

  it("warm-up sets are exact template content, inside each exercise's reference range", () => {
    const warmUps = Object.fromEntries(
      T.map((t) => [t.templateId, [...t.warmUp.mobility, ...t.warmUp.activation].map((w) => [w.exerciseId, w.sets])])
    );
    for (const id of ["strength_lower_beginner_v1", "strength_lower_intermediate_v1", "strength_lower_advanced_v1"]) {
      expect(warmUps[id]).toEqual([["hip_90_90", 1], ["knee_to_wall_ankle", 1], ["bird_dog", 2]]);
    }
    for (const id of ["strength_upper_beginner_v1", "strength_upper_intermediate_v1", "strength_upper_advanced_v1"]) {
      expect(warmUps[id]).toEqual([["thoracic_rotation_mobility", 1], ["wrist_mobility", 1], ["bear_crawl", 2]]);
    }
  });

  it("the validator catches a broken template (tier, family, role, duplicate, warm-up)", () => {
    const base = get("STRENGTH_LOWER", "beginner");
    const broken = {
      ...base,
      templateId: "broken",
      warmUp: {
        ...base.warmUp,
        mobility: [{ exerciseId: "hip_90_90", sets: 3 }],
        activation: [
          { exerciseId: "bird_dog", sets: 2 },
          { exerciseId: "dead_bug", sets: 2 },
          { exerciseId: "bear_crawl", sets: 2 },
        ],
      },
      workSlots: [
        { blockRole: "main" as const, role: "principal" as const, candidates: ["barbell_back_squat"] },
        { blockRole: "complementary" as const, role: "secondary" as const, candidates: ["dead_hang", "glute_bridge"] },
        { blockRole: "complementary" as const, role: "unilateral" as const, candidates: ["glute_bridge"] },
      ] as const,
    };
    const codes = validateStrengthTemplatesV2([...T.filter((t) => t !== base), broken]).filter((i) => i.templateId === "broken").map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["invalid_warm_up", "tier_not_allowed", "family_not_allowed", "role_not_held", "duplicate_exercise"]));
    const sets = validateStrengthTemplatesV2([...T.filter((t) => t !== base), { ...base, templateId: "sets", warmUp: { ...base.warmUp, mobility: [{ exerciseId: "hip_90_90", sets: 3 }, { exerciseId: "knee_to_wall_ankle", sets: 1 }] } }]);
    expect(sets.filter((i) => i.templateId === "sets").map((i) => i.code)).toEqual(["invalid_warm_up_sets"]);
  });

  it("exact templates and candidate order (versioned content, never derived from the exercise catalogue)", () => {
    const shape = (t: (typeof T)[number]) => ({ warmUp: [...t.warmUp.mobility, ...t.warmUp.activation].map((w) => w.exerciseId), slots: t.workSlots.map((s) => [s.role, ...s.candidates]) });
    expect(shape(get("STRENGTH_LOWER", "beginner"))).toEqual({
      warmUp: ["hip_90_90", "knee_to_wall_ankle", "bird_dog"],
      slots: [["principal", "bodyweight_squat"], ["secondary", "glute_bridge"], ["unilateral", "reverse_lunge"]],
    });
    expect(shape(get("STRENGTH_LOWER", "intermediate")).slots).toEqual([
      ["principal", "goblet_squat", "bodyweight_squat"],
      ["secondary", "dumbbell_romanian_deadlift", "dumbbell_hip_thrust", "glute_bridge"],
      ["unilateral", "bulgarian_split_squat", "step_up", "single_leg_romanian_deadlift", "reverse_lunge"],
    ]);
    expect(shape(get("STRENGTH_LOWER", "advanced")).slots).toEqual([
      ["principal", "barbell_back_squat", "barbell_deadlift", "goblet_squat", "bodyweight_squat"],
      ["secondary", "barbell_romanian_deadlift", "dumbbell_romanian_deadlift", "dumbbell_hip_thrust", "glute_bridge"],
      ["unilateral", "bulgarian_split_squat", "step_up", "single_leg_romanian_deadlift", "reverse_lunge"],
    ]);
    expect(shape(get("STRENGTH_UPPER", "beginner"))).toEqual({
      warmUp: ["thoracic_rotation_mobility", "wrist_mobility", "bear_crawl"],
      slots: [["principal", "pushup"], ["secondary", "resistance_band_row", "floor_ytw_raise"], ["prevention", "dead_bug"]],
    });
    expect(shape(get("STRENGTH_UPPER", "intermediate")).slots).toEqual([
      ["principal", "dumbbell_bench_press", "pushup"],
      ["secondary", "one_arm_dumbbell_row", "lat_pulldown", "inverted_row", "resistance_band_row", "floor_ytw_raise"],
      ["prevention", "pallof_press", "dead_bug"],
    ]);
    expect(shape(get("STRENGTH_UPPER", "advanced")).slots).toEqual([
      ["principal", "barbell_bench_press", "dumbbell_bench_press", "pull_up", "pushup"],
      ["secondary", "lat_pulldown", "one_arm_dumbbell_row", "inverted_row", "resistance_band_row", "floor_ytw_raise"],
      ["prevention", "hanging_leg_raise", "pallof_press", "dead_bug"],
    ]);
  });

  it("an empty-equipment athlete may have no compatible candidate: that is a runtime block, not a catalogue error", () => {
    const main = get("STRENGTH_UPPER", "intermediate").workSlots[0]!;
    const bodyweightOnly = main.candidates.filter((id) => ex(id).requiredEquipment.length === 0);
    expect(bodyweightOnly).toEqual(["pushup"]);
    const lowerAdvancedPrincipal = get("STRENGTH_LOWER", "advanced").workSlots[0]!.candidates;
    expect(lowerAdvancedPrincipal.at(-1)).toBe("bodyweight_squat");
  });
});

describe("Strength dose catalogue V2", () => {
  it("has its own version, LIGHT and MODERATE only (HEAVY absent)", () => {
    expect(STRENGTH_DOSE_CATALOG_V2_VERSION).toBe("strength-doses-v2.1");
    expect([...STRENGTH_LOAD_LEVELS_V2]).toEqual(["LIGHT", "MODERATE"]);
    expect(Object.keys(STRENGTH_DOSE_CATALOG_V2).sort()).toEqual(["LIGHT", "MODERATE"]);
    expect("HEAVY" in STRENGTH_DOSE_CATALOG_V2).toBe(false);
  });

  const row = (level: "LIGHT" | "MODERATE", role: "principal" | "secondary" | "unilateral" | "prevention") => {
    const d = STRENGTH_DOSE_CATALOG_V2[level][role];
    return { sets: d.sets, volume: d.volume, rpe: d.rpeTarget, rest: d.restSeconds };
  };

  it("MODERATE exact", () => {
    expect(row("MODERATE", "principal")).toEqual({ sets: 4, volume: { source: "dose_catalog", reps: { min: 6, max: 8 } }, rpe: { min: 7, max: 8 }, rest: { min: 120, max: 180 } });
    expect(row("MODERATE", "secondary")).toEqual({ sets: 3, volume: { source: "dose_catalog", reps: { min: 8, max: 12 } }, rpe: { min: 7, max: 7 }, rest: { min: 90, max: 90 } });
    expect(row("MODERATE", "unilateral")).toEqual({ sets: 3, volume: { source: "dose_catalog", reps: { min: 8, max: 10 } }, rpe: { min: 7, max: 7 }, rest: { min: 60, max: 90 } });
    expect(row("MODERATE", "prevention")).toEqual({ sets: 2, volume: { source: "exercise_reference" }, rpe: { min: 6, max: 7 }, rest: { min: 45, max: 60 } });
  });

  it("LIGHT exact", () => {
    expect(row("LIGHT", "principal")).toEqual({ sets: 3, volume: { source: "dose_catalog", reps: { min: 8, max: 10 } }, rpe: { min: 5, max: 6 }, rest: { min: 90, max: 120 } });
    expect(row("LIGHT", "secondary")).toEqual({ sets: 2, volume: { source: "dose_catalog", reps: { min: 10, max: 12 } }, rpe: { min: 5, max: 6 }, rest: { min: 60, max: 90 } });
    expect(row("LIGHT", "unilateral")).toEqual({ sets: 2, volume: { source: "dose_catalog", reps: { min: 8, max: 10 } }, rpe: { min: 5, max: 6 }, rest: { min: 60, max: 60 } });
    expect(row("LIGHT", "prevention")).toEqual({ sets: 2, volume: { source: "exercise_reference" }, rpe: { min: 5, max: 6 }, rest: { min: 45, max: 60 } });
  });

  it("sets are exact positive integers; prevention takes its measure from the exercise reference explicitly (no empty object); everything PROVISIONAL", () => {
    for (const level of STRENGTH_LOAD_LEVELS_V2) {
      for (const [role, d] of Object.entries(STRENGTH_DOSE_CATALOG_V2[level])) {
        expect(Number.isInteger(d.sets) && d.sets > 0, `${level}/${role}`).toBe(true);
        expect(d.validationStatus).toBe("PROVISIONAL");
        expect(d.volume.source, `${level}/${role}`).toBe(role === "prevention" ? "exercise_reference" : "dose_catalog");
      }
    }
  });

  it("every prevention candidate of the templates has a usable reference measure (no conversion needed)", () => {
    const prevention = STRENGTH_TEMPLATE_CATALOG_V2_ENTRIES.flatMap((t) => t.workSlots.filter((s) => s.role === "prevention").flatMap((s) => s.candidates));
    expect([...new Set(prevention)].sort()).toEqual(["dead_bug", "hanging_leg_raise", "pallof_press"]);
    for (const id of prevention) {
      const ref = ex(id).referencePrescription;
      expect(ex(id).measureType === "reps" ? ref.reps : ref.durationSeconds, id).toBeDefined();
    }
    // dose-catalog rows only define reps: every principal / secondary / unilateral candidate is measured in reps.
    const others = STRENGTH_TEMPLATE_CATALOG_V2_ENTRIES.flatMap((t) => t.workSlots.filter((s) => s.role !== "prevention").flatMap((s) => s.candidates));
    expect(new Set(others.map((id) => ex(id).measureType))).toEqual(new Set(["reps"]));
  });
});

describe("UX-11A.5a.4.1 — floor_ytw_raise holds `secondary` in V2 only", () => {
  it("V2 roles: warm_up, prevention and secondary; first role (reference dose) unchanged; catalogue version bumped", () => {
    expect(ex("floor_ytw_raise").roles).toEqual(["warm_up", "prevention", "secondary"]);
    expect(SESSION_EXERCISE_CATALOG_V2_VERSION).toBe("session-exercises-v2.1");
  });

  it("the V1 exercise is unchanged", () => {
    expect(EXERCISE_CATALOG["floor_ytw_raise"]).toMatchObject({ id: "floor_ytw_raise", movementCategory: "pull" });
    expect(JSON.stringify(EXERCISE_CATALOG["floor_ytw_raise"])).not.toMatch(/secondary/);
  });
});

describe("V2 Plan Dose Policy", () => {
  it("development = MODERATE 60 min / 6 / 45; taper = LIGHT 45 min / 4 / 45; race = no normal session (v2.1)", () => {
    expect(PLAN_DOSE_POLICY_V2_VERSION).toBe("plan-dose-policy-v2.1");
    expect(PLAN_DOSE_POLICY_V2).toEqual({
      development: { forceLoad: "MODERATE", forceDurationMin: 60, dhFocusedPasses: 6, aerobicBaseDurationMin: 45 },
      taper: { forceLoad: "LIGHT", forceDurationMin: 45, dhFocusedPasses: 4, aerobicBaseDurationMin: 45 },
      race: null,
      validationStatus: "PROVISIONAL",
    });
  });

  it("never produces a legacy history-adjusted or taper value (20 / 30 / 35 min, 3 / 5 passages)", () => {
    for (const week of [PLAN_DOSE_POLICY_V2.development, PLAN_DOSE_POLICY_V2.taper]) {
      expect([20, 30, 35]).not.toContain(week.aerobicBaseDurationMin);
      expect([50, 35]).not.toContain(week.forceDurationMin); // legacy history-adjusted Force durations
      expect([3, 5]).not.toContain(week.dhFocusedPasses);
    }
  });
});
