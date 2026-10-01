import { describe, expect, it } from "vitest";
import { decodeFinalPrescriptionV2 } from "./decodeFinalPrescriptionV2";
import { FIXTURES_GENERATED_FROM, keepFinalPrescription } from "../../test/fixtures/finalPrescriptionV2Fixtures";
import { COACHING_TEXTS_V1_0 } from "./coachingTextsV1_0.generated";
import type { ExerciseItemView } from "./finalPrescriptionV2Types";

const text = (id: string) => COACHING_TEXTS_V1_0[id]!.text;

describe("decodeFinalPrescriptionV2 — genuine engine documents", () => {
  it("fixtures were produced under the supported version", () => {
    expect(FIXTURES_GENERATED_FROM).toBe("session-model-v2.5");
  });

  it("Force: intent, ordered blocks and items, exact sets, measures, RPE, rest, ramp-up, cues and vigilances, all resolved by id", () => {
    const { record } = keepFinalPrescription("STRENGTH_LOWER");
    const r = decodeFinalPrescriptionV2(record);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.view.intent).toBe(text(`intent.${record.structure.intentId}`));
    expect(r.view.templateId).toBe(record.structure.templateId);
    expect(r.view.blocks.map((b) => b.role)).toEqual(record.structure.blocks.map((b: { role: string }) => b.role));
    const main = r.view.blocks.find((b) => b.role === "main")!.items[0] as ExerciseItemView;
    const raw = record.structure.blocks.find((b: { role: string }) => b.role === "main").items[0];
    expect(main).toMatchObject({ kind: "exercise", prescriptionItemId: raw.prescriptionItemId, exerciseId: raw.exerciseId, sets: raw.sets, measure: raw.measure, rpeTarget: raw.rpeTarget, restSeconds: raw.restSeconds });
    expect(main.cue).toBe(text(raw.cueId));
    expect(main.rampUp).toEqual({ instruction: text(raw.rampUp.instructionId), sets: { min: 1, max: 2 } });
    expect(main.vigilances).toEqual(raw.vigilanceIds.map(text));
    // No legacy dose field anywhere in the view.
    expect(JSON.stringify(r.view)).not.toMatch(/setVolume|targetRpeOrRir|intensityZone/);
  });

  it("DH: drill, number of passes, cue, success criterion, brief / warm-up / application / cool-down instructions", () => {
    const { record } = keepFinalPrescription("DH_TECHNICAL");
    const r = decodeFinalPrescriptionV2(record);
    if (!r.ok) throw new Error(r.reason);
    const drillRaw = record.structure.blocks.find((b: { role: string }) => b.role === "main").items[0];
    const drill = r.view.blocks.find((b) => b.role === "main")!.items[0]!;
    expect(drill).toMatchObject({ kind: "drill", drillId: drillRaw.drillId, passes: drillRaw.measure.count, cue: text(drillRaw.cueId), successCriterion: text(drillRaw.successCriterionId) });
    expect(r.view.blocks.map((b) => b.role)).toEqual(["brief", "warm_up", "main", "application", "cool_down"]);
    expect(r.view.blocks.find((b) => b.role === "brief")!.instructions).toEqual([text("instruction.dh.brief")]);
  });

  it("endurance: allowed activities, durations, RPE and talk test, no item", () => {
    const { record } = keepFinalPrescription("AEROBIC_BASE");
    const r = decodeFinalPrescriptionV2(record);
    if (!r.ok) throw new Error(r.reason);
    expect(r.view.activities).toEqual(["Vélo de route", "VTT roulant", "Home-trainer", "Course à pied"]);
    const main = r.view.blocks.find((b) => b.role === "main")!;
    expect(main.talkTest).toBe(text("instruction.endurance.talk_test_full_sentences"));
    expect(main.durationMinutes).toEqual(record.structure.blocks.find((b: { role: string }) => b.role === "main").durationMinutes);
    expect(r.view.blocks.every((b) => b.items.length === 0)).toBe(true);
  });
});

describe("decodeFinalPrescriptionV2 — version gate before any id resolution, fail-closed", () => {
  it.each([
    ["an older aggregate (session-model-v2.4)", "session-model-v2.4"],
    ["a future aggregate (session-model-v2.6)", "session-model-v2.6"],
  ])("%s → unsupported, even with ids the current tables do not know (nothing resolved)", (_label, aggregate) => {
    const { record } = keepFinalPrescription("STRENGTH_LOWER");
    record.structure.catalog.aggregate = aggregate;
    record.catalogVersion = aggregate;
    record.structure.blocks.find((b: { role: string }) => b.role === "main").items[0].exerciseId = "exercise_of_another_version";
    expect(decodeFinalPrescriptionV2(record)).toMatchObject({ ok: false, kind: "unsupported_schema_or_catalog" });
  });

  it("same aggregate but another component version (texts) → unsupported", () => {
    const { record } = keepFinalPrescription("DH_TECHNICAL");
    record.structure.catalog.texts = "coaching-text-v1.1";
    expect(decodeFinalPrescriptionV2(record)).toMatchObject({ ok: false, kind: "unsupported_schema_or_catalog" });
  });

  it("schema v1 or structure not v2 → unsupported (never cast)", () => {
    const a = keepFinalPrescription("STRENGTH_LOWER").record;
    a.schemaVersion = "v1";
    expect(decodeFinalPrescriptionV2(a)).toMatchObject({ ok: false, kind: "unsupported_schema_or_catalog" });
    const b = keepFinalPrescription("STRENGTH_LOWER").record;
    b.structure.schemaVersion = "v1";
    expect(decodeFinalPrescriptionV2(b)).toMatchObject({ ok: false, kind: "unsupported_schema_or_catalog" });
  });

  it.each<[string, (s: Record<string, any>, r: Record<string, any>) => void]>([
    ["catalog_version differs from the manifest aggregate", (_s, r) => (r.catalogVersion = "session-model-v2.4")],
    ["an unknown cue id", (s) => (s.blocks.find((b: { role: string }) => b.role === "main").items[0].cueId = "cue.unknown")],
    ["an unknown exercise", (s) => (s.blocks.find((b: { role: string }) => b.role === "main").items[0].exerciseId = "unknown_exercise")],
    ["an unknown vigilance", (s) => (s.blocks.find((b: { role: string }) => b.role === "main").items[0].vigilanceIds = ["vigilance.unknown"])],
    ["a text id of the wrong kind", (s) => (s.blocks.find((b: { role: string }) => b.role === "main").items[0].cueId = "vigilance.knee_pain_free_range")],
    ["an invalid measure", (s) => (s.blocks.find((b: { role: string }) => b.role === "main").items[0].measure = { type: "reps", min: 8, max: 6, perSide: false })],
    ["zero sets", (s) => (s.blocks.find((b: { role: string }) => b.role === "main").items[0].sets = 0)],
    ["an unknown block role", (s) => (s.blocks[0].role = "debrief")],
    ["an unknown item kind", (s) => (s.blocks.find((b: { role: string }) => b.role === "main").items[0].kind = "activity")],
  ])("%s → invalid (no partial rendering)", (_label, mutate) => {
    const { record } = keepFinalPrescription("STRENGTH_LOWER");
    mutate(record.structure, record);
    expect(decodeFinalPrescriptionV2(record)).toMatchObject({ ok: false, kind: "invalid" });
  });
});
