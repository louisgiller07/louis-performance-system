import { describe, expect, it } from "vitest";
import {
  sourceRequiresPlannedPrescription,
  validateFinalPrescriptionProvenance,
} from "../../src/validation/validateFinalPrescriptionProvenance.js";
import { PlanningEngineValidationError } from "../../src/validation/errors.js";
import type { FinalPrescriptionSource } from "../../src/types/prescription.js";

const ALL_SOURCES: FinalPrescriptionSource[] = [
  "head_coach_keep",
  "head_coach_modify",
  "head_coach_replace",
  "manual_override_same_kind",
  "manual_override_new_kind",
  "no_plan",
];

describe("FinalPrescriptionSource union — exhaustively handled", () => {
  it("sourceRequiresPlannedPrescription has a defined answer for all 6 source values", () => {
    for (const source of ALL_SOURCES) {
      expect(() => sourceRequiresPlannedPrescription(source)).not.toThrow();
    }
  });

  it("keep/modify/manual_override_same_kind require plannedPrescriptionId", () => {
    for (const source of ["head_coach_keep", "head_coach_modify", "manual_override_same_kind"] as const) {
      expect(sourceRequiresPlannedPrescription(source)).toBe(true);
    }
  });

  it("replace/manual_override_new_kind/no_plan must not carry plannedPrescriptionId", () => {
    for (const source of ["head_coach_replace", "manual_override_new_kind", "no_plan"] as const) {
      expect(sourceRequiresPlannedPrescription(source)).toBe(false);
    }
  });
});

describe("validateFinalPrescriptionProvenance", () => {
  it("accepts head_coach_keep with a plannedPrescriptionId", () => {
    expect(() =>
      validateFinalPrescriptionProvenance({ source: "head_coach_keep", plannedPrescriptionId: "pp1" })
    ).not.toThrow();
  });

  it("rejects head_coach_keep without a plannedPrescriptionId", () => {
    expect(() => validateFinalPrescriptionProvenance({ source: "head_coach_keep" })).toThrow(PlanningEngineValidationError);
  });

  it("accepts manual_override_new_kind with no plannedPrescriptionId (M0 Issue3 Q3)", () => {
    expect(() => validateFinalPrescriptionProvenance({ source: "manual_override_new_kind" })).not.toThrow();
  });

  it("rejects manual_override_new_kind carrying a plannedPrescriptionId", () => {
    expect(() =>
      validateFinalPrescriptionProvenance({ source: "manual_override_new_kind", plannedPrescriptionId: "pp1" })
    ).toThrow(PlanningEngineValidationError);
  });

  it("accepts no_plan with no plannedPrescriptionId", () => {
    expect(() => validateFinalPrescriptionProvenance({ source: "no_plan" })).not.toThrow();
  });
});
