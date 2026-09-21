import { describe, expect, it } from "vitest";
import { GOLDEN_SCENARIOS } from "../fixtures/goldenScenarios.js";
import {
  noBackToBackHeavyStrength,
  noHeavySessionBeforeRace,
  strengthSlotsStayStrength,
  noSessionOnBlockedDates,
  dhSessionsOnlyOnAllowedDates,
  strengthVolumeDidNotEscalate,
  loadProfilePresenceMatchesKind,
} from "../fixtures/invariants.js";
import { assertAvailabilityDeclared, GenerationBlockedError } from "../../src/validation/validatePlanInputSnapshot.js";
import { validateFinalPrescriptionProvenance } from "../../src/validation/validateFinalPrescriptionProvenance.js";
import type { GeneratedPlanSession } from "../../src/types/generatedSession.js";

describe("golden scenarios — internal consistency", () => {
  it("all 10 required scenarios (A-J) are present, each with at least one principle and one forbidden outcome", () => {
    const ids = GOLDEN_SCENARIOS.map((s) => s.id);
    expect(ids).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);
    for (const scenario of GOLDEN_SCENARIOS) {
      expect(scenario.expectedPrinciples.length, `${scenario.id} has no principles`).toBeGreaterThan(0);
      expect(scenario.forbiddenOutcomes.length, `${scenario.id} has no forbidden outcomes`).toBeGreaterThan(0);
    }
  });

  it("every scenario except J declares at least one availability window (only J tests the missing-availability path)", () => {
    for (const scenario of GOLDEN_SCENARIOS) {
      if (scenario.id === "J") continue;
      expect(scenario.inputSnapshot.availability.windows.length, `${scenario.id} unexpectedly has no availability`).toBeGreaterThan(0);
    }
  });
});

describe("scenario J — missing availability blocks generation (M0 Issue 4)", () => {
  const scenarioJ = GOLDEN_SCENARIOS.find((s) => s.id === "J")!;

  it("has zero declared availability windows", () => {
    expect(scenarioJ.inputSnapshot.availability.windows).toEqual([]);
  });

  it("assertAvailabilityDeclared throws GenerationBlockedError for scenario J's snapshot", () => {
    expect(() => assertAvailabilityDeclared(scenarioJ.inputSnapshot.availability)).toThrow(GenerationBlockedError);
  });

  it("a fully-declared availability (scenario A) never triggers the block", () => {
    const scenarioA = GOLDEN_SCENARIOS.find((s) => s.id === "A")!;
    expect(() => assertAvailabilityDeclared(scenarioA.inputSnapshot.availability)).not.toThrow();
  });
});

describe("scenario I — manual override provenance (M0 Issue 3)", () => {
  it("a FinalPrescription with source=manual_override_new_kind and no plannedPrescriptionId is valid", () => {
    expect(() =>
      validateFinalPrescriptionProvenance({ source: "manual_override_new_kind", plannedPrescriptionId: undefined })
    ).not.toThrow();
  });

  it("a FinalPrescription with source=manual_override_new_kind carrying a plannedPrescriptionId is rejected", () => {
    expect(() =>
      validateFinalPrescriptionProvenance({ source: "manual_override_new_kind", plannedPrescriptionId: "pp-original" })
    ).toThrow();
  });
});

function session(date: string, kind: GeneratedPlanSession["kind"], loadProfile?: GeneratedPlanSession["loadProfile"]): GeneratedPlanSession {
  return {
    id: `s-${date}`,
    weekId: "w1",
    planVersionId: "v1",
    date,
    kind,
    ...(loadProfile !== undefined ? { loadProfile } : {}),
    doseTarget: { domain: "recovery" },
    rationale: "fixture",
  };
}

describe("invariant checkers — correct against synthetic data (M3 will reuse these)", () => {
  it("noBackToBackHeavyStrength: flags two HEAVY strength sessions on consecutive days", () => {
    const sessions = [session("2026-10-19", "STRENGTH_LOWER", "HEAVY"), session("2026-10-20", "STRENGTH_UPPER", "HEAVY")];
    expect(noBackToBackHeavyStrength(sessions)).toBe(false);
  });

  it("noBackToBackHeavyStrength: passes when HEAVY strength days are spaced out", () => {
    const sessions = [session("2026-10-19", "STRENGTH_LOWER", "HEAVY"), session("2026-10-22", "STRENGTH_UPPER", "HEAVY")];
    expect(noBackToBackHeavyStrength(sessions)).toBe(true);
  });

  it("noHeavySessionBeforeRace: flags a HEAVY session within the protected window", () => {
    const sessions = [session("2026-10-23", "STRENGTH_LOWER", "HEAVY")];
    expect(noHeavySessionBeforeRace(sessions, "2026-10-24", 2)).toBe(false);
  });

  it("noHeavySessionBeforeRace: passes when HEAVY sessions are outside the window", () => {
    const sessions = [session("2026-10-18", "STRENGTH_LOWER", "HEAVY")];
    expect(noHeavySessionBeforeRace(sessions, "2026-10-24", 2)).toBe(true);
  });

  it("strengthSlotsStayStrength: flags when a strength slot was silently swapped away", () => {
    const sessions = [session("2026-10-19", "DH_LIGHT")];
    expect(strengthSlotsStayStrength(sessions, 1)).toBe(false);
  });

  it("noSessionOnBlockedDates: flags a session generated on a blocked date", () => {
    const sessions = [session("2026-10-22", "DH_TECHNICAL")];
    expect(noSessionOnBlockedDates(sessions, ["2026-10-22"])).toBe(false);
  });

  it("dhSessionsOnlyOnAllowedDates: flags a DH session on a weekday when only weekends are allowed", () => {
    const sessions = [session("2026-10-21", "DH_TECHNICAL")]; // a Wednesday
    expect(dhSessionsOnlyOnAllowedDates(sessions, ["2026-10-24", "2026-10-25"])).toBe(false);
  });

  it("strengthVolumeDidNotEscalate: flags an increase after missed sessions", () => {
    expect(strengthVolumeDidNotEscalate(12, 16)).toBe(false);
    expect(strengthVolumeDidNotEscalate(12, 10)).toBe(true);
  });

  it("loadProfilePresenceMatchesKind: flags a load-variable kind missing loadProfile, and a fixed-load kind carrying one", () => {
    expect(loadProfilePresenceMatchesKind([session("2026-10-19", "STRENGTH_LOWER")])).toBe(false);
    expect(loadProfilePresenceMatchesKind([session("2026-10-19", "REST", "LIGHT")])).toBe(false);
    expect(loadProfilePresenceMatchesKind([session("2026-10-19", "REST")])).toBe(true);
  });
});
