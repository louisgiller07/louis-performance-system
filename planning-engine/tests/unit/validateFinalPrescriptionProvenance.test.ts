import { describe, expect, it } from "vitest";
import {
  requiresPlanVersion,
  requiresPlannedPrescription,
  requiresAdaptationRules,
  validateFinalPrescriptionProvenance,
} from "../../src/validation/validateFinalPrescriptionProvenance.js";
import { PlanningEngineValidationError } from "../../src/validation/errors.js";
import type { ActiveSessionOrigin, ReconciliationAction } from "../../src/types/prescription.js";

const ALL_ORIGINS: ActiveSessionOrigin[] = [
  "generated",
  "manual_override_same_kind",
  "manual_override_new_kind",
  "no_canonical_plan",
];

const ALL_ACTIONS: ReconciliationAction[] = ["keep", "modify", "replace"];

function fixture(overrides: {
  activeSessionOrigin: ActiveSessionOrigin;
  reconciliationAction: ReconciliationAction;
  planVersionId?: string;
  plannedPrescriptionId?: string;
  adaptationRuleIds?: string[];
}) {
  return {
    planVersionId: undefined,
    plannedPrescriptionId: undefined,
    adaptationRuleIds: [],
    ...overrides,
  };
}

describe("ActiveSessionOrigin / ReconciliationAction unions — exhaustively handled", () => {
  it("requiresPlanVersion has a defined answer for all 4 origin values", () => {
    for (const origin of ALL_ORIGINS) {
      expect(() => requiresPlanVersion(origin)).not.toThrow();
    }
  });

  it("requiresPlannedPrescription has a defined answer for all 12 origin x action combinations", () => {
    for (const origin of ALL_ORIGINS) {
      for (const action of ALL_ACTIONS) {
        expect(() => requiresPlannedPrescription(origin, action)).not.toThrow();
      }
    }
  });

  it("requiresAdaptationRules has a defined answer for all 3 action values", () => {
    for (const action of ALL_ACTIONS) {
      expect(() => requiresAdaptationRules(action)).not.toThrow();
    }
  });
});

describe("requiresPlanVersion — governed only by activeSessionOrigin", () => {
  it("true for generated/manual_override_same_kind/manual_override_new_kind", () => {
    for (const origin of ["generated", "manual_override_same_kind", "manual_override_new_kind"] as const) {
      expect(requiresPlanVersion(origin)).toBe(true);
    }
  });

  it("false for no_canonical_plan", () => {
    expect(requiresPlanVersion("no_canonical_plan")).toBe(false);
  });
});

describe("requiresPlannedPrescription — governed by both axes (M2 closure: replace always breaks lineage)", () => {
  it("true for generated/manual_override_same_kind combined with keep/modify", () => {
    for (const origin of ["generated", "manual_override_same_kind"] as const) {
      for (const action of ["keep", "modify"] as const) {
        expect(requiresPlannedPrescription(origin, action)).toBe(true);
      }
    }
  });

  it("false for any origin combined with replace, even when same-kind lineage exists", () => {
    for (const origin of ALL_ORIGINS) {
      expect(requiresPlannedPrescription(origin, "replace")).toBe(false);
    }
  });

  it("false for manual_override_new_kind/no_canonical_plan regardless of action", () => {
    for (const origin of ["manual_override_new_kind", "no_canonical_plan"] as const) {
      for (const action of ALL_ACTIONS) {
        expect(requiresPlannedPrescription(origin, action)).toBe(false);
      }
    }
  });
});

describe("requiresAdaptationRules — governed only by reconciliationAction", () => {
  it("false for keep", () => {
    expect(requiresAdaptationRules("keep")).toBe(false);
  });

  it("true for modify/replace", () => {
    expect(requiresAdaptationRules("modify")).toBe(true);
    expect(requiresAdaptationRules("replace")).toBe(true);
  });
});

describe("validateFinalPrescriptionProvenance — all 12 origin x action combinations are valid (M2 closure §B)", () => {
  const cases: Array<{
    origin: ActiveSessionOrigin;
    action: ReconciliationAction;
    planVersionId?: string;
    plannedPrescriptionId?: string;
    adaptationRuleIds: string[];
  }> = [
    { origin: "generated", action: "keep", planVersionId: "v1", plannedPrescriptionId: "pp1", adaptationRuleIds: [] },
    { origin: "generated", action: "modify", planVersionId: "v1", plannedPrescriptionId: "pp1", adaptationRuleIds: ["r1"] },
    { origin: "generated", action: "replace", planVersionId: "v1", adaptationRuleIds: ["r1"] },
    { origin: "manual_override_same_kind", action: "keep", planVersionId: "v1", plannedPrescriptionId: "pp1", adaptationRuleIds: [] },
    { origin: "manual_override_same_kind", action: "modify", planVersionId: "v1", plannedPrescriptionId: "pp1", adaptationRuleIds: ["r1"] },
    { origin: "manual_override_same_kind", action: "replace", planVersionId: "v1", adaptationRuleIds: ["r1"] },
    { origin: "manual_override_new_kind", action: "keep", planVersionId: "v1", adaptationRuleIds: [] },
    { origin: "manual_override_new_kind", action: "modify", planVersionId: "v1", adaptationRuleIds: ["r1"] },
    { origin: "manual_override_new_kind", action: "replace", planVersionId: "v1", adaptationRuleIds: ["r1"] },
    { origin: "no_canonical_plan", action: "keep", adaptationRuleIds: [] },
    { origin: "no_canonical_plan", action: "modify", adaptationRuleIds: ["r1"] },
    { origin: "no_canonical_plan", action: "replace", adaptationRuleIds: ["r1"] },
  ];

  for (const { origin, action, planVersionId, plannedPrescriptionId, adaptationRuleIds } of cases) {
    it(`accepts activeSessionOrigin=${origin} + reconciliationAction=${action}`, () => {
      expect(() =>
        validateFinalPrescriptionProvenance(
          fixture({ activeSessionOrigin: origin, reconciliationAction: action, planVersionId, plannedPrescriptionId, adaptationRuleIds })
        )
      ).not.toThrow();
    });
  }
});

describe("validateFinalPrescriptionProvenance — rejects invalid combinations", () => {
  it("rejects generated+keep missing planVersionId", () => {
    expect(() =>
      validateFinalPrescriptionProvenance(
        fixture({ activeSessionOrigin: "generated", reconciliationAction: "keep", plannedPrescriptionId: "pp1" })
      )
    ).toThrow(PlanningEngineValidationError);
  });

  it("rejects no_canonical_plan carrying a planVersionId", () => {
    expect(() =>
      validateFinalPrescriptionProvenance(
        fixture({ activeSessionOrigin: "no_canonical_plan", reconciliationAction: "keep", planVersionId: "v1" })
      )
    ).toThrow(PlanningEngineValidationError);
  });

  it("rejects generated+keep missing plannedPrescriptionId", () => {
    expect(() =>
      validateFinalPrescriptionProvenance(fixture({ activeSessionOrigin: "generated", reconciliationAction: "keep", planVersionId: "v1" }))
    ).toThrow(PlanningEngineValidationError);
  });

  it("rejects manual_override_new_kind carrying a plannedPrescriptionId (M0 Issue3 Q3)", () => {
    expect(() =>
      validateFinalPrescriptionProvenance(
        fixture({
          activeSessionOrigin: "manual_override_new_kind",
          reconciliationAction: "keep",
          planVersionId: "v1",
          plannedPrescriptionId: "pp-original",
        })
      )
    ).toThrow(PlanningEngineValidationError);
  });

  it("rejects generated+replace still carrying a plannedPrescriptionId (replace always breaks lineage)", () => {
    expect(() =>
      validateFinalPrescriptionProvenance(
        fixture({
          activeSessionOrigin: "generated",
          reconciliationAction: "replace",
          planVersionId: "v1",
          plannedPrescriptionId: "pp1",
          adaptationRuleIds: ["r1"],
        })
      )
    ).toThrow(PlanningEngineValidationError);
  });

  it("rejects keep with a non-empty adaptationRuleIds", () => {
    expect(() =>
      validateFinalPrescriptionProvenance(
        fixture({
          activeSessionOrigin: "generated",
          reconciliationAction: "keep",
          planVersionId: "v1",
          plannedPrescriptionId: "pp1",
          adaptationRuleIds: ["r1"],
        })
      )
    ).toThrow(PlanningEngineValidationError);
  });

  it("rejects modify with an empty adaptationRuleIds", () => {
    expect(() =>
      validateFinalPrescriptionProvenance(
        fixture({
          activeSessionOrigin: "generated",
          reconciliationAction: "modify",
          planVersionId: "v1",
          plannedPrescriptionId: "pp1",
          adaptationRuleIds: [],
        })
      )
    ).toThrow(PlanningEngineValidationError);
  });
});
