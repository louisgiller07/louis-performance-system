import { describe, expect, it } from "vitest";
// Test-only cross-boundary read of the engine catalogue (same pattern as exerciseLabels.test.ts): every catalogue
// drill must have a translation whose English source is exactly the catalogue text — a catalogue edit fails here.
import { DRILL_CATALOG_ENTRIES } from "../../../../planning-engine/src/catalog/drillCatalog.js";
import { DRILL_INSTRUCTION_LABELS, translateDrillExecutionCue, translateDrillSuccessCriterion } from "./drillInstructionLabels";

const ALL_FRENCH = Object.values(DRILL_INSTRUCTION_LABELS).flatMap((t) => [t.executionCue, t.successCriterion]);
const ALL_ENGLISH = Object.values(DRILL_INSTRUCTION_LABELS).flatMap((t) => [t.sourceExecutionCue, t.sourceSuccessCriterion]);

describe("drillInstructionLabels — catalogue coverage (REV-015.4b)", () => {
  it("covers exactly the 21 drills of the engine catalogue", () => {
    expect(DRILL_CATALOG_ENTRIES).toHaveLength(21);
    expect(Object.keys(DRILL_INSTRUCTION_LABELS).sort()).toEqual(DRILL_CATALOG_ENTRIES.map((d) => d.id).sort());
  });

  it("every English source is exactly the catalogue text (42 texts)", () => {
    for (const drill of DRILL_CATALOG_ENTRIES) {
      const t = DRILL_INSTRUCTION_LABELS[drill.id]!;
      expect(t.sourceExecutionCue, `${drill.id} executionCue`).toBe(drill.executionCue);
      expect(t.sourceSuccessCriterion, `${drill.id} successCriteria`).toBe(drill.successCriteria);
    }
    expect(ALL_ENGLISH).toHaveLength(42);
  });
});

describe("drillInstructionLabels — exact source match (REV-015.4b)", () => {
  it("the exact catalogue text → its French translation, for all 42 texts", () => {
    for (const drill of DRILL_CATALOG_ENTRIES) {
      const t = DRILL_INSTRUCTION_LABELS[drill.id]!;
      expect(translateDrillExecutionCue(drill.id, drill.executionCue), drill.id).toBe(t.executionCue);
      expect(translateDrillSuccessCriterion(drill.id, drill.successCriteria), drill.id).toBe(t.successCriterion);
    }
  });

  it("a modified (drifted) English text keeps the stored original, never another sentence's translation", () => {
    const drifted = "Squeeze both brakes gently before each marked zone.";
    expect(translateDrillExecutionCue("braking_progressive_control", drifted)).toBe(drifted);
    expect(translateDrillSuccessCriterion("braking_progressive_control", "Speed controlled, no skidding.")).toBe("Speed controlled, no skidding.");
  });

  it("a known text under the wrong drill id is not translated (the pair must match)", () => {
    const cue = DRILL_INSTRUCTION_LABELS.jumps_step_down!.sourceExecutionCue;
    expect(translateDrillExecutionCue("braking_progressive_control", cue)).toBe(cue);
  });

  it("an unknown drill keeps the stored text (the instruction is never dropped)", () => {
    expect(translateDrillExecutionCue("unknown_drill_7", "Some future instruction.")).toBe("Some future instruction.");
    expect(translateDrillSuccessCriterion("toString", "Some future criterion.")).toBe("Some future criterion.");
  });

  it("missing, blank or non-string stored text → null, no crash", () => {
    for (const value of [null, undefined, "", "   ", 42]) {
      expect(translateDrillExecutionCue("braking_progressive_control", value)).toBeNull();
      expect(translateDrillSuccessCriterion("braking_progressive_control", value)).toBeNull();
      expect(translateDrillExecutionCue(undefined, value)).toBeNull();
    }
  });
});

describe("drillInstructionLabels — translation quality (REV-015.4b)", () => {
  it("no French text equals or contains a known English source", () => {
    for (const fr of ALL_FRENCH) for (const en of ALL_ENGLISH) expect(fr.includes(en), fr).toBe(false);
  });

  it("no English words left (kept DH terms: run, table-top, split, pop, kick) and no raw identifier", () => {
    for (const fr of ALL_FRENCH) {
      expect(fr, fr).not.toMatch(/\b(the|your|and|with|without|before|through|brakes?|speed|wheel|weight|landing|section at|rides?|keeps?)\b/i);
      expect(fr, fr).not.toMatch(/_/);
    }
  });

  it("validated REV-015.4a wording: point de corde, kick, virage relevé (never 'mur')", () => {
    expect(DRILL_INSTRUCTION_LABELS.cornering_flat_turn_precision!.executionCue).toContain("point de corde");
    expect(DRILL_INSTRUCTION_LABELS.jumps_table_top_basic!.executionCue).toContain("kick");
    expect(DRILL_INSTRUCTION_LABELS.cornering_berm_speed!.executionCue).toContain("virage relevé");
    for (const fr of ALL_FRENCH) expect(fr, fr).not.toMatch(/\bmur\b/);
  });
});
