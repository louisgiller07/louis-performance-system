import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assignPrescriptionIds, buildSessionModelV2CatalogManifest, buildStrengthPrescriptionV2Content, type PrescriptionV2 } from "planning-engine/session-model-v2";
import type { FinalPrescriptionWithinTodayTimeV2Result } from "planning-engine/session-model-v2/daily";
import { LOAD_GUIDANCE_WARNINGS, toStrengthHistoryByExercise, withStrengthLoadGuidance } from "../../src/supabase/dailyV2/strengthLoadGuidance.js";
import { todayLoadHold } from "../../src/supabase/dailyV2/todayLoadHold.js";
import type { StrengthSetHistoryRead, StrengthSetResultRow } from "../../src/supabase/repositories/strengthSetHistoryRepo.js";

// PHYS-01 — the integration layer of the Force load guidance: history read → pure rule → validated final prescription.

const TODAY = "2026-10-20";
const client = {} as SupabaseClient;
let n = 0;
const mint = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

function finalOf(structure: PrescriptionV2): FinalPrescriptionWithinTodayTimeV2Result {
  return {
    status: "created",
    finalPrescription: {
      id: mint(),
      decisionId: mint(),
      activeSessionOrigin: "generated",
      reconciliationAction: "keep",
      adaptationRuleIds: [],
      schemaVersion: "v2",
      catalogVersion: structure.catalog.aggregate,
      structure,
    },
  };
}
const upper = assignPrescriptionIds(
  buildStrengthPrescriptionV2Content({ sessionKind: "STRENGTH_UPPER", athleteTier: "intermediate", equipment: ["dumbbells", "bench"], loadProfile: "MODERATE", catalog: buildSessionModelV2CatalogManifest() }),
  mint
);
const benchItem = upper.blocks.find((b) => b.role === "main")!.items[0]!;

const row = (o: Partial<StrengthSetResultRow> & Pick<StrengthSetResultRow, "id" | "execution_id" | "set_number">): StrengthSetResultRow => ({
  prescription_item_id: benchItem.prescriptionItemId,
  exercise_id: "dumbbell_bench_press",
  done: true,
  measure_type: "reps",
  measure_value: 8,
  load_kg: "20.00",
  rpe_actual: "7.0",
  supersedes_id: null,
  ...o,
});
const read = (sets: StrengthSetResultRow[], structure: unknown = upper): StrengthSetHistoryRead => ({ executions: [{ executionId: "ex-1", sessionDate: "2026-10-13", structure }], sets });

describe("PHYS-01 — history mapping (pure)", () => {
  it("active results only (a correction replaces its original), repetitions only, what was prescribed that day", () => {
    const h = toStrengthHistoryByExercise(
      read([
        row({ id: "s1", execution_id: "ex-1", set_number: 1, measure_value: 6 }),
        row({ id: "s1b", execution_id: "ex-1", set_number: 1, measure_value: 8, supersedes_id: "s1" }),
        row({ id: "s2", execution_id: "ex-1", set_number: 2 }),
        row({ id: "s9", execution_id: "ex-1", set_number: 3, measure_type: "duration", measure_value: 30 }),
        row({ id: "x", execution_id: "ex-unknown", set_number: 1 }),
      ])
    );
    expect(h).toEqual({
      dumbbell_bench_press: [
        {
          sessionDate: "2026-10-13",
          prescribed: { sets: 4, reps: { min: 6, max: 8 }, rpeTarget: { min: 7, max: 8 } },
          sets: [
            { setNumber: 1, done: true, reps: 8, loadKg: 20, rpe: 7 },
            { setNumber: 2, done: true, reps: 8, loadKg: 20, rpe: 7 },
          ],
        },
      ],
    });
  });

  it("an item no longer found in its prescription → prescribed unknown (never guessed)", () => {
    expect(toStrengthHistoryByExercise(read([row({ id: "s1", execution_id: "ex-1", set_number: 1 })], { blocks: [] })).dumbbell_bench_press![0]!.prescribed).toBeNull();
  });
});

describe("PHYS-01 — withStrengthLoadGuidance", () => {
  it("Force: reads the loadable work exercises' history in the 56 days before today, attaches the guidance, validated", async () => {
    const sets = [1, 2, 3, 4].map((s) => row({ id: `s${s}`, execution_id: "ex-1", set_number: s }));
    const getCompletedStrengthSetHistory = vi.fn().mockResolvedValue(read(sets));
    const r = await withStrengthLoadGuidance(finalOf(upper), client, "athlete-1", TODAY, { getCompletedStrengthSetHistory });
    // PHYS-04 — the same read serves the bodyweight work exercise (dead_bug): one read for both guidances.
    expect(getCompletedStrengthSetHistory).toHaveBeenCalledWith(client, "athlete-1", ["dumbbell_bench_press", "one_arm_dumbbell_row", "dead_bug"], "2026-08-25", TODAY);
    expect(
      r.status === "created" && r.finalPrescription.structure.blocks.flatMap((b) => b.items).map((i) => (i.kind === "exercise" ? [i.exerciseId, i.loadGuidance?.mode ?? null, i.repsGuidance?.mode ?? null] : null))
    ).toEqual([
      ["thoracic_rotation_mobility", null, null],
      ["wrist_mobility", null, null],
      ["bear_crawl", null, null],
      ["dumbbell_bench_press", "target", null],
      ["one_arm_dumbbell_row", "calibrate", null],
      ["dead_bug", null, "calibrate"],
    ]);
    expect(r).not.toHaveProperty("loadGuidanceWarning");
    const bench = r.status === "created" ? r.finalPrescription.structure.blocks.find((b) => b.role === "main")!.items[0]! : null;
    expect(bench && bench.kind === "exercise" ? bench.loadGuidance : null).toMatchObject({ mode: "target", change: "increase", targetKg: 22 });
  });

  it("a history read failure never blocks the decision: same prescription, no guidance, stable warning", async () => {
    const original = finalOf(upper);
    const r = await withStrengthLoadGuidance(original, client, "athlete-1", TODAY, { getCompletedStrengthSetHistory: vi.fn().mockRejectedValue(new Error("network")) });
    expect(r).toEqual({ ...original, loadGuidanceWarning: LOAD_GUIDANCE_WARNINGS.readFailed });
  });

  it("an invalid guidance (e.g. a target above 1000 kg) is never persisted: no guidance, stable warning", async () => {
    const sets = [1, 2, 3, 4].map((s) => row({ id: `s${s}`, execution_id: "ex-1", set_number: s, load_kg: 999 }));
    const original = finalOf(upper);
    const r = await withStrengthLoadGuidance(original, client, "athlete-1", TODAY, { getCompletedStrengthSetHistory: vi.fn().mockResolvedValue(read(sets)) });
    expect(r).toEqual({ ...original, loadGuidanceWarning: LOAD_GUIDANCE_WARNINGS.invalid });
  });

  it("no read at all for REST, a blocked result, or a session without any guided work exercise", async () => {
    const getCompletedStrengthSetHistory = vi.fn();
    const rest: FinalPrescriptionWithinTodayTimeV2Result = { status: "none", reason: "rest" };
    expect(await withStrengthLoadGuidance(rest, client, "a", TODAY, { getCompletedStrengthSetHistory })).toBe(rest);
    const blocked: FinalPrescriptionWithinTodayTimeV2Result = { status: "blocked", code: "final_prescription_no_lineage", detail: {} };
    expect(await withStrengthLoadGuidance(blocked, client, "a", TODAY, { getCompletedStrengthSetHistory })).toBe(blocked);
    const bodyweight = assignPrescriptionIds(
      buildStrengthPrescriptionV2Content({ sessionKind: "STRENGTH_UPPER", athleteTier: "beginner", equipment: [], loadProfile: "MODERATE", catalog: buildSessionModelV2CatalogManifest() }),
      mint
    );
    const bw = finalOf(bodyweight);
    expect(getCompletedStrengthSetHistory).not.toHaveBeenCalled();
    // PHYS-04 — a bodyweight session is now read too (its repetitions guidance), never a load.
    const read = vi.fn().mockResolvedValue({ executions: [], sets: [] });
    const guided = await withStrengthLoadGuidance(bw, client, "a", TODAY, { getCompletedStrengthSetHistory: read });
    expect(read).toHaveBeenCalledWith(client, "a", ["pushup", "floor_ytw_raise", "dead_bug"], "2026-08-25", TODAY);
    expect(guided.status === "created" && guided.finalPrescription.structure.blocks.flatMap((b) => b.items).some((i) => i.kind === "exercise" && i.loadGuidance !== undefined)).toBe(false);
  });
});

describe("PHYS-01.1 — today's state never lets the load go up automatically", () => {
  const rule = (rule_id: string) => ({ layer: "C", rule_id, detail: "" });
  it("pain in today's check-in → pain; an M1 fatigue / load rule (C3.3, C3.5, C3.6, C3.7) → fatigue; pain wins; nothing → none", () => {
    expect(todayLoadHold({ pain: true }, { triggered_rules: [] })).toBe("pain");
    for (const id of ["C3.3", "C3.5", "C3.6", "C3.7"]) expect(todayLoadHold({ pain: false }, { triggered_rules: [rule(id)] as never })).toBe("fatigue");
    expect(todayLoadHold({ pain: true }, { triggered_rules: [rule("C3.6")] as never })).toBe("pain");
    expect(todayLoadHold({ pain: false }, { triggered_rules: [rule("C3.1")] as never })).toBeUndefined();
    expect(todayLoadHold(undefined, { triggered_rules: [] })).toBeUndefined();
  });

  it("the hold reaches the guidance: top of the range recorded, but pain today → same load, hold: pain", async () => {
    const sets = [1, 2, 3, 4].map((s) => row({ id: `s${s}`, execution_id: "ex-1", set_number: s }));
    const r = await withStrengthLoadGuidance(finalOf(upper), client, "athlete-1", TODAY, { getCompletedStrengthSetHistory: vi.fn().mockResolvedValue(read(sets)) }, "pain");
    const bench = r.status === "created" ? r.finalPrescription.structure.blocks.find((b) => b.role === "main")!.items[0]! : null;
    expect(bench && bench.kind === "exercise" ? bench.loadGuidance : null).toMatchObject({ mode: "target", change: "keep", hold: "pain", targetKg: 20 });
  });
});
