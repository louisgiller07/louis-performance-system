import { describe, expect, it } from "vitest";
import {
  attachStrengthLoadGuidanceV2,
  assignPrescriptionIds,
  buildSessionModelV2CatalogManifest,
  buildStrengthPrescriptionV2Content,
  sportFingerprint,
  strengthLoadGuidanceExerciseIdsV2,
  strengthLoadGuidanceV2,
  strengthLoadStepV2,
  validatePrescriptionV2,
  type ExerciseItemV2,
  type ExerciseMeasureV2,
  type StrengthExerciseSessionRecordV2,
  type StrengthSetRecordV2,
} from "../../src/sessionModelV2/index.js";
import { STRENGTH_LOAD_GUIDANCE_RULES_VERSION } from "../../src/catalog/strengthLoadGuidancePolicyV2.js";
import { STRENGTH_TEMPLATE_CATALOG_V2_ENTRIES } from "../../src/catalog/strengthTemplateCatalogV2.js";

// PHYS-01 / PHYS-01.1 — Force load guidance: only the rider's own recorded loads of THIS exercise, double
// progression, one lever at a time, never on a day of pain or fatigue, never a 1RM.

const TODAY = "2026-10-20";
const MODERATE_REPS: ExerciseMeasureV2 = { type: "reps", min: 6, max: 8, perSide: false };
const RPE_7_8 = { min: 7, max: 8 };
const BENCH = { exerciseId: "dumbbell_bench_press", sets: 4, measure: MODERATE_REPS, rpeTarget: RPE_7_8 };

const set = (setNumber: number, reps: number | null, loadKg: number | null, rpe: number | null = null, done = true): StrengthSetRecordV2 => ({ setNumber, done, reps, loadKg, rpe });
const session = (sessionDate: string, sets: StrengthSetRecordV2[], prescribed: StrengthExerciseSessionRecordV2["prescribed"] = { sets: 4, reps: { min: 6, max: 8 }, rpeTarget: RPE_7_8 }): StrengthExerciseSessionRecordV2 => ({ sessionDate, prescribed, sets });
const top4 = (date: string, kg = 20, rpe = 7.5) => session(date, [1, 2, 3, 4].map((i) => set(i, 8, kg, rpe)));
const guide = (history: StrengthExerciseSessionRecordV2[], item = BENCH, todayHold?: "pain" | "fatigue") => strengthLoadGuidanceV2({ item, today: TODAY, history, ...(todayHold ? { todayHold } : {}) });

describe("PHYS-01.1 — only what the rider really recorded, for this exercise", () => {
  it("no history → calibrate by effort (reps in reserve from today's RPE target), never a number", () => {
    expect(guide([])).toEqual({ ruleVersion: STRENGTH_LOAD_GUIDANCE_RULES_VERSION, mode: "calibrate", reason: "no_history", loadBasis: "per_dumbbell", repsInReserve: { min: 2, max: 3 } });
  });

  it("sets without a load, not-done sets, zero reps or a zero load are never a reference", () => {
    expect(guide([session("2026-10-13", [set(1, 8, null), set(2, 8, 0), set(3, 0, 20), set(4, 8, 20, 7, false)])])).toMatchObject({ mode: "calibrate", reason: "history_without_load" });
  });

  it("a session of TODAY is never its own reference (strictly before the decision date)", () => {
    expect(guide([top4(TODAY)])).toMatchObject({ mode: "calibrate", reason: "no_history" });
  });

  it("only this exercise: the history is keyed by exercise id — another variant (barbell bench press) is never read", () => {
    const final = assignPrescriptionIds(buildStrengthPrescriptionV2Content({ sessionKind: "STRENGTH_UPPER", athleteTier: "intermediate", equipment: ["dumbbells", "bench"], loadProfile: "MODERATE", catalog: buildSessionModelV2CatalogManifest() }), mint);
    const guided = attachStrengthLoadGuidanceV2(final, TODAY, { barbell_bench_press: [top4("2026-10-13", 60)] });
    const bench = guided.blocks.flatMap((b) => b.items).find((i) => i.kind === "exercise" && i.exerciseId === "dumbbell_bench_press") as ExerciseItemV2;
    expect(bench.loadGuidance).toMatchObject({ mode: "calibrate", reason: "no_history" });
  });

  it("a beginner never gets a kilogram: no loaded exercise exists in any beginner template", () => {
    const beginnerCandidates = STRENGTH_TEMPLATE_CATALOG_V2_ENTRIES.filter((t) => t.athleteTier === "beginner").flatMap((t) => t.workSlots.flatMap((s) => s.candidates));
    expect(beginnerCandidates.filter((id) => strengthLoadStepV2(id) !== null)).toEqual([]);
    for (const sessionKind of ["STRENGTH_LOWER", "STRENGTH_UPPER"] as const) {
      const final = assignPrescriptionIds(buildStrengthPrescriptionV2Content({ sessionKind, athleteTier: "beginner", equipment: ["dumbbells", "barbell", "cable_machine"], loadProfile: "MODERATE", catalog: buildSessionModelV2CatalogManifest() }), mint);
      expect(strengthLoadGuidanceExerciseIdsV2(final)).toEqual([]);
    }
  });
});

describe("PHYS-01.1 — units and steps", () => {
  it("dumbbells: per dumbbell, 2 kg; barbell and cable: total, 2.5 kg; kettlebell: 4 kg; bodyweight / bands: none", () => {
    expect(strengthLoadStepV2("dumbbell_bench_press")).toEqual({ stepKg: 2, loadBasis: "per_dumbbell" });
    expect(strengthLoadStepV2("goblet_squat")).toEqual({ stepKg: 2, loadBasis: "per_dumbbell" });
    expect(strengthLoadStepV2("barbell_bench_press")).toEqual({ stepKg: 2.5, loadBasis: "total" });
    expect(strengthLoadStepV2("lat_pulldown")).toEqual({ stepKg: 2.5, loadBasis: "total" });
    expect(strengthLoadStepV2("pushup")).toBeNull();
    expect(strengthLoadStepV2("resistance_band_row")).toBeNull();
    expect(guide([top4("2026-10-13", 60)], { ...BENCH, exerciseId: "barbell_bench_press" })).toMatchObject({ targetKg: 62.5, stepKg: 2.5, loadBasis: "total" });
    expect(guide([], { ...BENCH, measure: { type: "duration", minSeconds: 30, maxSeconds: 45, perSide: false } } as unknown as typeof BENCH)).toBeNull();
  });
});

describe("PHYS-01.1 — reps actually completed and RPE: double progression, one step at most", () => {
  it("every prescribed set at the top of the range, effort within the target → +1 step", () => {
    expect(guide([top4("2026-10-13")])).toEqual({
      ruleVersion: STRENGTH_LOAD_GUIDANCE_RULES_VERSION,
      mode: "target",
      reason: "top_of_range_reached",
      change: "increase",
      targetKg: 22,
      stepKg: 2,
      loadBasis: "per_dumbbell",
      reference: { sessionDate: "2026-10-13", loadKg: 20, reps: [8, 8, 8, 8], setsPrescribed: 4, repsRange: { min: 6, max: 8 }, rpeMax: 7.5 },
    });
  });

  it("top of the range with no RPE recorded → +1 step (repetitions decide)", () => {
    expect(guide([session("2026-10-13", [1, 2, 3, 4].map((i) => set(i, 8, 20)))])).toMatchObject({ change: "increase", targetKg: 22 });
  });

  it("inside the range → same load; fewer sets than prescribed → same load; effort above the target → same load", () => {
    expect(guide([session("2026-10-13", [set(1, 8, 20, 7), set(2, 7, 20, 8), set(3, 7, 20, 8), set(4, 6, 20, 8)])])).toMatchObject({ reason: "within_range", change: "keep", targetKg: 20 });
    expect(guide([session("2026-10-13", [set(1, 8, 20, 7), set(2, 8, 20, 7), set(3, 8, 20, 7)])])).toMatchObject({ reason: "within_range", change: "keep" });
    expect(guide([top4("2026-10-13", 20, 9)])).toMatchObject({ reason: "within_range", change: "keep" });
  });

  it("failure: a set below the range → −1 step; effort ≥ target + 2 → −1 step; never below one step", () => {
    expect(guide([session("2026-10-13", [set(1, 7, 20, 8), set(2, 6, 20, 8), set(3, 5, 20, 9), set(4, 5, 20, 9)])])).toMatchObject({ reason: "below_range", change: "decrease", targetKg: 18 });
    expect(guide([top4("2026-10-13", 20, 10)])).toMatchObject({ reason: "effort_too_high", change: "decrease", targetKg: 18 });
    expect(guide([session("2026-10-13", [set(1, 4, 2, 9), set(2, 4, 2, 9)])])).toMatchObject({ reason: "below_range", change: "keep", targetKg: 2 });
  });

  it("working load = the load of most done sets (the lighter on a tie)", () => {
    expect(guide([session("2026-10-13", [set(1, 8, 16, 5), set(2, 8, 20, 7), set(3, 8, 20, 7), set(4, 8, 20, 8)])])).toMatchObject({ reference: { loadKg: 20, reps: [8, 8, 8] } });
    expect(guide([session("2026-10-13", [set(1, 8, 22, 7), set(2, 8, 20, 7)])])).toMatchObject({ reference: { loadKg: 20 } });
  });
});

describe("PHYS-01.1 — never an automatic increase on a day of pain or fatigue, nor when the dose already goes up", () => {
  it("pain reported today → the increase is held (same load, hold: pain); fatigue signal → hold: fatigue", () => {
    expect(guide([top4("2026-10-13")], BENCH, "pain")).toMatchObject({ reason: "top_of_range_reached", change: "keep", hold: "pain", targetKg: 20 });
    expect(guide([top4("2026-10-13")], BENCH, "fatigue")).toMatchObject({ change: "keep", hold: "fatigue", targetKg: 20 });
  });

  it("a decrease is never held: failure still lowers the load on a painful day", () => {
    expect(guide([top4("2026-10-13", 20, 10)], BENCH, "pain")).toMatchObject({ change: "decrease", targetKg: 18 });
    expect(guide([top4("2026-10-13", 20, 10)], BENCH, "pain")).not.toHaveProperty("hold");
  });

  it("one lever at a time: today's dose heavier than the reference's (more sets, or a higher RPE target) → hold: dose_up", () => {
    expect(guide([top4("2026-10-13")], { ...BENCH, sets: 5 })).toMatchObject({ change: "keep", hold: "dose_up", targetKg: 20 });
    expect(guide([top4("2026-10-13")], { ...BENCH, rpeTarget: { min: 8, max: 9 } })).toMatchObject({ change: "keep", hold: "dose_up" });
    // Same or lighter dose than the reference: the increase applies.
    expect(guide([session("2026-10-13", [1, 2, 3, 4, 5].map((i) => set(i, 8, 20, 8)), { sets: 5, reps: { min: 6, max: 8 }, rpeTarget: { min: 8, max: 8 } })])).toMatchObject({ change: "increase", targetKg: 22 });
  });
});

describe("PHYS-01.1 — which session is the reference", () => {
  it("the latest session with TODAY'S repetition range within 28 days, even when a session of another dose came after it", () => {
    const g = guide([top4("2026-10-06", 20, 7), session("2026-10-13", [1, 2, 3].map((i) => set(i, 10, 16, 6)), { sets: 3, reps: { min: 8, max: 10 }, rpeTarget: { min: 5, max: 6 } })]);
    expect(g).toMatchObject({ mode: "target", change: "increase", targetKg: 22, reference: { sessionDate: "2026-10-06", loadKg: 20 } });
  });

  it("no session with today's range → the latest load is shown (different_dose), never converted", () => {
    const light = { ...BENCH, sets: 3, measure: { type: "reps" as const, min: 8, max: 10, perSide: false }, rpeTarget: { min: 5, max: 6 } };
    const g = guide([top4("2026-10-13")], light);
    expect(g).toMatchObject({ mode: "reference", reason: "different_dose", reference: { loadKg: 20, repsRange: { min: 6, max: 8 } }, repsInReserve: { min: 4, max: 5 } });
    expect(g).not.toHaveProperty("targetKg");
  });

  it("the latest load older than 28 days → history_too_old (restart by effort); a same-range session older than 28 days is not a target", () => {
    expect(guide([top4("2026-09-15")])).toMatchObject({ mode: "reference", reason: "history_too_old", reference: { sessionDate: "2026-09-15" } });
  });
});

let n = 0;
function mint() {
  return `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

describe("PHYS-01 — attached to a final Force prescription, work exercises only, validated", () => {
  const MANIFEST = buildSessionModelV2CatalogManifest();
  const final = assignPrescriptionIds(
    buildStrengthPrescriptionV2Content({ sessionKind: "STRENGTH_UPPER", athleteTier: "intermediate", equipment: ["dumbbells", "bench", "resistance_bands"], loadProfile: "MODERATE", catalog: MANIFEST }),
    mint
  );

  it("needs the history of the loadable work exercises only", () => {
    expect(strengthLoadGuidanceExerciseIdsV2(final)).toEqual(["dumbbell_bench_press", "one_arm_dumbbell_row"]);
  });

  it("guidance on those items only; valid as a FINAL prescription, refused on a planned one; today's hold carried to every item", () => {
    const guided = attachStrengthLoadGuidanceV2(final, TODAY, { dumbbell_bench_press: [top4("2026-10-13")] }, "pain");
    const items = guided.blocks.flatMap((b) => b.items.map((i) => [b.role, (i as ExerciseItemV2).exerciseId, (i as ExerciseItemV2).loadGuidance?.mode ?? null]));
    expect(items.filter(([, , mode]) => mode !== null)).toEqual([
      ["main", "dumbbell_bench_press", "target"],
      ["complementary", "one_arm_dumbbell_row", "calibrate"],
    ]);
    expect((guided.blocks.find((b) => b.role === "main")!.items[0] as ExerciseItemV2).loadGuidance).toMatchObject({ change: "keep", hold: "pain" });
    expect(validatePrescriptionV2(guided, { stage: "final" })).toMatchObject({ ok: true });
    expect(validatePrescriptionV2(guided, { stage: "planned" })).toMatchObject({ ok: false, issues: expect.arrayContaining([expect.objectContaining({ code: "load_guidance_not_allowed" })]) });
    expect(JSON.stringify(final)).not.toMatch(/loadGuidance/);
  });

  it("the guidance is not session content: the sport fingerprint ignores it", () => {
    expect(sportFingerprint(attachStrengthLoadGuidanceV2(final, TODAY, { dumbbell_bench_press: [top4("2026-10-13")] }))).toBe(sportFingerprint(final));
  });

  it("deterministic: same history, date and state → same guidance", () => {
    const h = { dumbbell_bench_press: [top4("2026-10-13")] };
    expect(attachStrengthLoadGuidanceV2(final, TODAY, h, "fatigue")).toEqual(attachStrengthLoadGuidanceV2(final, TODAY, h, "fatigue"));
  });
});
