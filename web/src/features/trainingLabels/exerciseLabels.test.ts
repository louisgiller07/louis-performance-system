import { describe, expect, it } from "vitest";
// Cross-boundary read of the engine catalogue, test-only (same pattern as the dailyPlan tests importing
// head-coach-engine): guards that every catalogue id has a French label — a new catalogue entry fails here
// instead of silently rendering the neutral fallback.
import { EXERCISE_CATALOG_ENTRIES } from "../../../../planning-engine/src/catalog/exerciseCatalog.js";
import { DRILL_CATALOG_ENTRIES } from "../../../../planning-engine/src/catalog/drillCatalog.js";
import {
  DRILL_LABELS,
  EXERCISE_LABELS,
  translateDrill,
  translateExercise,
  UNKNOWN_DRILL_LABEL,
  UNKNOWN_EXERCISE_LABEL,
} from "./exerciseLabels";

const UNKNOWN_VALUES = ["unknown_exercise_42", "Goblet Squat", "GOBLET_SQUAT", "toString", "constructor", "", "   ", null, undefined, 7];

describe("translateExercise (REV-015.3)", () => {
  it("covers exactly every exercise of the engine catalogue", () => {
    expect(Object.keys(EXERCISE_LABELS).sort()).toEqual(EXERCISE_CATALOG_ENTRIES.map((e) => e.id).sort());
  });

  it("every catalogue exercise has a label that is not its id nor its English catalogue name (except kept sport terms)", () => {
    const keptAsIs = new Set(["pallof_press"]); // "Pallof press": validated sport term, same words as the catalogue name
    for (const entry of EXERCISE_CATALOG_ENTRIES) {
      const label = translateExercise(entry.id);
      expect(label, entry.id).not.toBeNull();
      expect(label, entry.id).not.toBe(entry.id);
      expect(label, entry.id).not.toMatch(/_/);
      if (!keptAsIs.has(entry.id)) expect(label, entry.id).not.toBe(entry.displayName);
    }
  });

  it("validated product wording", () => {
    expect(translateExercise("goblet_squat")).toBe("Goblet squat");
    expect(translateExercise("pallof_press")).toBe("Pallof press");
    expect(translateExercise("floor_ytw_raise")).toBe("Élévations Y-T-W au sol");
    expect(translateExercise("bodyweight_hip_hinge")).toBe("Flexion de hanches au poids du corps");
    expect(translateExercise("pushup")).toBe("Pompes");
    expect(translateExercise("barbell_deadlift")).toBe("Soulevé de terre à la barre");
  });

  it("unknown, empty, null, undefined, inherited → null (callers show 'Exercice')", () => {
    for (const value of UNKNOWN_VALUES) expect(translateExercise(value), String(value)).toBeNull();
    expect(UNKNOWN_EXERCISE_LABEL).toBe("Exercice");
  });
});

describe("translateDrill (REV-015.3)", () => {
  it("covers exactly every drill of the engine catalogue", () => {
    expect(Object.keys(DRILL_LABELS).sort()).toEqual(DRILL_CATALOG_ENTRIES.map((d) => d.id).sort());
  });

  it("every catalogue drill has a French label, never its id or English catalogue name", () => {
    for (const entry of DRILL_CATALOG_ENTRIES) {
      const label = translateDrill(entry.id);
      expect(label, entry.id).not.toBeNull();
      expect(label, entry.id).not.toBe(entry.id);
      expect(label, entry.id).not.toBe(entry.displayName);
      expect(label, entry.id).not.toMatch(/_/);
    }
  });

  it("validated product wording", () => {
    expect(translateDrill("braking_progressive_control")).toBe("Freinage progressif");
    expect(translateDrill("race_execution_full_run_sim")).toBe("Simulation de run complet");
    expect(translateDrill("jumps_table_top_basic")).toBe("Bases des table-tops");
    expect(translateDrill("jumps_step_down")).toBe("Confiance sur les step-downs");
  });

  it("unknown, empty, null, undefined, inherited → null (callers show 'Exercice technique')", () => {
    for (const value of UNKNOWN_VALUES) expect(translateDrill(value), String(value)).toBeNull();
    expect(UNKNOWN_DRILL_LABEL).toBe("Exercice technique");
  });
});
