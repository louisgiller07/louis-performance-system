import { describe, expect, it } from "vitest";
import { DRILL_INSTRUCTION_LABELS } from "./drillInstructionLabels";
import { DRILL_LABELS, EXERCISE_LABELS } from "./exerciseLabels";

// UX-11A.5a.2a — the V1 French translations stay exactly as they are. The
// Session Model V2 sport text lives in the domain library
// (planning-engine/src/catalog/coachingTextCatalog.ts), never here.
// Recorded before any V2 DH text existed.
describe("V1 training label translations — frozen", () => {
  it("keeps the V1 DH instruction translations (cues and criteria)", () => {
    expect(DRILL_INSTRUCTION_LABELS).toMatchSnapshot();
  });

  it("keeps the V1 exercise and drill names", () => {
    expect({ EXERCISE_LABELS, DRILL_LABELS }).toMatchSnapshot();
  });
});
