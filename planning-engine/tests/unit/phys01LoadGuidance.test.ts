import { describe, expect, it } from "vitest";
import {
  attachStrengthLoadGuidanceV2,
  assignPrescriptionIds,
  buildSessionModelV2CatalogManifest,
  buildStrengthPrescriptionV2Content,
  strengthLoadGuidanceExerciseIdsV2,
  strengthLoadGuidanceV2,
  strengthLoadStepKgV2,
  sportFingerprint,
  validatePrescriptionV2,
  type ExerciseItemV2,
  type ExerciseMeasureV2,
  type StrengthExerciseSessionRecordV2,
  type StrengthSetRecordV2,
} from "../../src/sessionModelV2/index.js";
import { STRENGTH_LOAD_GUIDANCE_RULES_VERSION } from "../../src/catalog/strengthLoadGuidancePolicyV2.js";

// PHYS-01 — Force load guidance: only the rider's own recorded loads, double progression, never a 1RM.

const TODAY = "2026-10-20";
const MODERATE_REPS: ExerciseMeasureV2 = { type: "reps", min: 6, max: 8, perSide: false };
const RPE_7_8 = { min: 7, max: 8 };
const BENCH = { exerciseId: "dumbbell_bench_press", sets: 4, measure: MODERATE_REPS, rpeTarget: RPE_7_8 };

const set = (setNumber: number, reps: number | null, loadKg: number | null, rpe: number | null = null, done = true): StrengthSetRecordV2 => ({ setNumber, done, reps, loadKg, rpe });
const session = (sessionDate: string, sets: StrengthSetRecordV2[], prescribed: StrengthExerciseSessionRecordV2["prescribed"] = { sets: 4, reps: { min: 6, max: 8 }, rpeTarget: RPE_7_8 }): StrengthExerciseSessionRecordV2 => ({ sessionDate, prescribed, sets });
const guide = (history: StrengthExerciseSessionRecordV2[], item = BENCH) => strengthLoadGuidanceV2({ item, today: TODAY, history });

describe("PHYS-01 — no reliable history: calibration by effort, never a number", () => {
  it("beginner without any history → calibrate / no_history, reps in reserve from today's RPE target (RIR = 10 − RPE)", () => {
    expect(guide([])).toEqual({ ruleVersion: STRENGTH_LOAD_GUIDANCE_RULES_VERSION, mode: "calibrate", reason: "no_history", repsInReserve: { min: 2, max: 3 } });
  });

  it("sets recorded without any load → calibrate / history_without_load (still no number)", () => {
    expect(guide([session("2026-10-13", [set(1, 8, null), set(2, 8, null)])])).toMatchObject({ mode: "calibrate", reason: "history_without_load" });
  });

  it("a session of TODAY is never its own reference (strictly before the decision date)", () => {
    expect(guide([session(TODAY, [set(1, 8, 20), set(2, 8, 20), set(3, 8, 20), set(4, 8, 20)])])).toMatchObject({ mode: "calibrate", reason: "no_history" });
  });
});

describe("PHYS-01 — same repetition range, recent reference: double progression, one step at most", () => {
  it("every prescribed set at the top of the range, effort within the target → +1 step (dumbbells: 2 kg)", () => {
    const g = guide([session("2026-10-13", [set(1, 8, 20, 7), set(2, 8, 20, 7), set(3, 8, 20, 7.5), set(4, 8, 20, 8)])]);
    expect(g).toEqual({
      ruleVersion: STRENGTH_LOAD_GUIDANCE_RULES_VERSION,
      mode: "target",
      reason: "top_of_range_reached",
      change: "increase",
      targetKg: 22,
      stepKg: 2,
      reference: { sessionDate: "2026-10-13", loadKg: 20, reps: [8, 8, 8, 8], setsPrescribed: 4, repsRange: { min: 6, max: 8 }, rpeMax: 8 },
    });
  });

  it("top of the range without any RPE recorded → +1 step (repetitions decide)", () => {
    expect(guide([session("2026-10-13", [set(1, 8, 20), set(2, 8, 20), set(3, 8, 20), set(4, 8, 20)])])).toMatchObject({ change: "increase", targetKg: 22 });
  });

  it("inside the range → same load", () => {
    expect(guide([session("2026-10-13", [set(1, 8, 20, 7), set(2, 7, 20, 8), set(3, 7, 20, 8), set(4, 6, 20, 8)])])).toMatchObject({ mode: "target", reason: "within_range", change: "keep", targetKg: 20 });
  });

  it("fewer sets than prescribed, even at the top → same load (never a step on incomplete work)", () => {
    expect(guide([session("2026-10-13", [set(1, 8, 20, 7), set(2, 8, 20, 7), set(3, 8, 20, 7)])])).toMatchObject({ change: "keep", reason: "within_range" });
  });

  it("top of the range but effort above the target → same load", () => {
    expect(guide([session("2026-10-13", [set(1, 8, 20, 9), set(2, 8, 20, 9), set(3, 8, 20, 9), set(4, 8, 20, 9)])])).toMatchObject({ change: "keep", reason: "within_range" });
  });

  it("a set below the range's minimum → −1 step", () => {
    expect(guide([session("2026-10-13", [set(1, 7, 20, 8), set(2, 6, 20, 8), set(3, 5, 20, 9), set(4, 5, 20, 9)])])).toMatchObject({ reason: "below_range", change: "decrease", targetKg: 18 });
  });

  it("effort ≥ target max + 2 → −1 step, before any other rule", () => {
    expect(guide([session("2026-10-13", [set(1, 8, 20, 10), set(2, 8, 20, 10), set(3, 8, 20, 10), set(4, 8, 20, 10)])])).toMatchObject({ reason: "effort_too_high", change: "decrease", targetKg: 18 });
  });

  it("never below one step: a decrease that would reach 0 keeps the load", () => {
    expect(guide([session("2026-10-13", [set(1, 4, 2, 9), set(2, 4, 2, 9)])])).toMatchObject({ reason: "below_range", change: "keep", targetKg: 2 });
  });

  it("working load = the load of most done sets (the lighter on a tie); warm-up-like lighter sets do not drive it", () => {
    const g = guide([session("2026-10-13", [set(1, 8, 16, 5), set(2, 8, 20, 7), set(3, 8, 20, 7), set(4, 8, 20, 8)])]);
    expect(g).toMatchObject({ mode: "target", reference: { loadKg: 20, reps: [8, 8, 8] } });
    expect(guide([session("2026-10-13", [set(1, 8, 22, 7), set(2, 8, 20, 7)])])).toMatchObject({ reference: { loadKg: 20 } });
  });

  it("the latest session with a load is the reference (an older better session is ignored)", () => {
    const g = guide([
      session("2026-10-06", [set(1, 8, 24, 7), set(2, 8, 24, 7), set(3, 8, 24, 7), set(4, 8, 24, 7)]),
      session("2026-10-13", [set(1, 7, 20, 7), set(2, 7, 20, 7), set(3, 7, 20, 7), set(4, 7, 20, 7)]),
    ]);
    expect(g).toMatchObject({ change: "keep", targetKg: 20, reference: { sessionDate: "2026-10-13" } });
  });

  it("barbell step = 2.5 kg; cable = 2.5 kg; dumbbells = 2 kg; bodyweight / bands → no guidance", () => {
    expect(strengthLoadStepKgV2("barbell_bench_press")).toBe(2.5);
    expect(strengthLoadStepKgV2("lat_pulldown")).toBe(2.5);
    expect(strengthLoadStepKgV2("goblet_squat")).toBe(2);
    expect(strengthLoadStepKgV2("pushup")).toBeNull();
    expect(strengthLoadStepKgV2("resistance_band_row")).toBeNull();
    const bar = { ...BENCH, exerciseId: "barbell_bench_press" };
    expect(guide([session("2026-10-13", [set(1, 8, 60, 7), set(2, 8, 60, 7), set(3, 8, 60, 7), set(4, 8, 60, 7)])], bar)).toMatchObject({ targetKg: 62.5, stepKg: 2.5 });
    expect(guide([], { ...BENCH, exerciseId: "pushup" })).toBeNull();
    expect(guide([], { ...BENCH, measure: { type: "duration", minSeconds: 30, maxSeconds: 45, perSide: false } })).toBeNull();
  });
});

describe("PHYS-01 — the last load is shown, never extrapolated", () => {
  it("reference older than 28 days → reference / history_too_old (restart by effort)", () => {
    expect(guide([session("2026-09-15", [set(1, 8, 20, 7), set(2, 8, 20, 7), set(3, 8, 20, 7), set(4, 8, 20, 7)])])).toMatchObject({
      mode: "reference",
      reason: "history_too_old",
      reference: { loadKg: 20, sessionDate: "2026-09-15" },
      repsInReserve: { min: 2, max: 3 },
    });
  });

  it("another repetition range today (e.g. the LIGHT session after a fatigue day) → reference / different_dose, no converted load", () => {
    const light = { ...BENCH, sets: 3, measure: { type: "reps" as const, min: 8, max: 10, perSide: false }, rpeTarget: { min: 5, max: 6 } };
    const g = guide([session("2026-10-13", [set(1, 8, 20, 7), set(2, 8, 20, 7), set(3, 8, 20, 7), set(4, 8, 20, 7)])], light);
    expect(g).toMatchObject({ mode: "reference", reason: "different_dose", reference: { loadKg: 20, repsRange: { min: 6, max: 8 } }, repsInReserve: { min: 4, max: 5 } });
    expect(g).not.toHaveProperty("targetKg");
  });

  it("an unknown prescription for the reference (no prescribed range) → reference / different_dose", () => {
    expect(guide([session("2026-10-13", [set(1, 8, 20, 7)], null)])).toMatchObject({ mode: "reference", reason: "different_dose" });
  });
});

describe("PHYS-01 — attached to a final Force prescription, work exercises only, validated", () => {
  const MANIFEST = buildSessionModelV2CatalogManifest();
  const counter = () => {
    let n = 0;
    return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  };
  const final = assignPrescriptionIds(
    buildStrengthPrescriptionV2Content({ sessionKind: "STRENGTH_UPPER", athleteTier: "intermediate", equipment: ["dumbbells", "bench", "resistance_bands"], loadProfile: "MODERATE", catalog: MANIFEST }),
    counter()
  );

  it("needs the history of the loadable work exercises only", () => {
    // dumbbell bench press + one-arm row carry a load; Pallof press (band) does not; warm-up / cool-down never.
    expect(strengthLoadGuidanceExerciseIdsV2(final)).toEqual(["dumbbell_bench_press", "one_arm_dumbbell_row"]);
  });

  it("guidance on those items only; the result validates as a FINAL prescription and is refused as a planned one", () => {
    const history = { dumbbell_bench_press: [session("2026-10-13", [set(1, 8, 20, 7), set(2, 8, 20, 7), set(3, 8, 20, 7), set(4, 8, 20, 7)])] };
    const guided = attachStrengthLoadGuidanceV2(final, TODAY, history);
    const items = guided.blocks.flatMap((b) => b.items.map((i) => [b.role, (i as ExerciseItemV2).exerciseId, (i as ExerciseItemV2).loadGuidance?.mode ?? null]));
    expect(items.filter(([, , mode]) => mode !== null)).toEqual([
      ["main", "dumbbell_bench_press", "target"],
      ["complementary", "one_arm_dumbbell_row", "calibrate"],
    ]);
    expect(validatePrescriptionV2(guided, { stage: "final" })).toMatchObject({ ok: true });
    expect(validatePrescriptionV2(guided, { stage: "planned" })).toMatchObject({ ok: false, issues: expect.arrayContaining([expect.objectContaining({ code: "load_guidance_not_allowed" })]) });
    // The input structure is never mutated.
    expect(JSON.stringify(final)).not.toMatch(/loadGuidance/);
  });

  it("the guidance is not session content: the sport fingerprint ignores it (a KEEP keeps the planned content)", () => {
    const history = { dumbbell_bench_press: [session("2026-10-13", [set(1, 8, 20, 7), set(2, 8, 20, 7), set(3, 8, 20, 7), set(4, 8, 20, 7)])] };
    expect(sportFingerprint(attachStrengthLoadGuidanceV2(final, TODAY, history))).toBe(sportFingerprint(final));
  });

  it("deterministic: same history and date → same guidance", () => {
    const history = { dumbbell_bench_press: [session("2026-10-13", [set(1, 8, 20, 7)])] };
    expect(attachStrengthLoadGuidanceV2(final, TODAY, history)).toEqual(attachStrengthLoadGuidanceV2(final, TODAY, history));
  });
});
