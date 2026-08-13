import { describe, it, expect } from "vitest";
import { mapTrainingInterventionToDbSessionType } from "../src/mapping/trainingInterventionToDbSessionType.js";
import type { TrainingIntervention } from "../src/types/trainingIntervention.js";
import type { DbSessionType } from "../src/types/dbSessionType.js";

describe("T8 — Mapping TrainingIntervention ↔ DbSessionType", () => {
  it("T8.1 — STRENGTH_UPPER HEAVY → STRENGTH_A", () => {
    expect(mapTrainingInterventionToDbSessionType({ kind: "STRENGTH_UPPER", load_profile: "HEAVY" })).toBe(
      "STRENGTH_A",
    );
  });

  it("T8.2 — STRENGTH_UPPER LIGHT → STRENGTH_B", () => {
    expect(mapTrainingInterventionToDbSessionType({ kind: "STRENGTH_UPPER", load_profile: "LIGHT" })).toBe(
      "STRENGTH_B",
    );
  });

  it("T8.3 — RECOVERY_ACTIVE → RECOVERY, load_profile ignoré", () => {
    expect(mapTrainingInterventionToDbSessionType({ kind: "RECOVERY_ACTIVE" })).toBe("RECOVERY");
  });

  describe("T8.4 — Déterminisme du mapping sur la table canonique complète", () => {
    const canonicalTable: Array<[TrainingIntervention, DbSessionType]> = [
      [{ kind: "STRENGTH_LOWER", load_profile: "HEAVY" }, "STRENGTH_A"],
      [{ kind: "STRENGTH_LOWER", load_profile: "MODERATE" }, "STRENGTH_A"],
      [{ kind: "STRENGTH_LOWER", load_profile: "LIGHT" }, "STRENGTH_B"],
      [{ kind: "STRENGTH_UPPER", load_profile: "HEAVY" }, "STRENGTH_A"],
      [{ kind: "STRENGTH_UPPER", load_profile: "MODERATE" }, "STRENGTH_B"],
      [{ kind: "STRENGTH_UPPER", load_profile: "LIGHT" }, "STRENGTH_B"],
      [{ kind: "POWER", load_profile: "HEAVY" }, "STRENGTH_A"],
      [{ kind: "POWER", load_profile: "MODERATE" }, "STRENGTH_B"],
      [{ kind: "POWER", load_profile: "LIGHT" }, "STRENGTH_B"],
      [{ kind: "GRIP_WORK", load_profile: "HEAVY" }, "STRENGTH_A"],
      [{ kind: "GRIP_WORK", load_profile: "MODERATE" }, "STRENGTH_B"],
      [{ kind: "GRIP_WORK", load_profile: "LIGHT" }, "STRENGTH_B"],
      [{ kind: "STRENGTH_FULL_LIGHT", load_profile: "LIGHT" }, "STRENGTH_B"],
      [{ kind: "AEROBIC_BASE", load_profile: "LIGHT" }, "AEROBIC_BASE"],
      [{ kind: "AEROBIC_INTERVALS", load_profile: "MODERATE" }, "AEROBIC_INTERVALS"],
      [{ kind: "DH_TECHNICAL", load_profile: "MODERATE" }, "DH_TECHNICAL"],
      [{ kind: "PUMPTRACK", load_profile: "LIGHT" }, "DH_TECHNICAL"],
      [{ kind: "DH_PERFORMANCE", load_profile: "HEAVY" }, "DH_PERFORMANCE"],
      [{ kind: "DH_LIGHT", load_profile: "LIGHT" }, "RECOVERY"],
      [{ kind: "MOBILITY" }, "RECOVERY"],
      [{ kind: "RECOVERY_ACTIVE" }, "RECOVERY"],
      [{ kind: "REST" }, "REST"],
      [{ kind: "BIKE_MAINTENANCE" }, "BIKE_MAINTENANCE"],
      [{ kind: "RACE_ACTIVITY" }, "RACE_PREP"],
    ];

    it.each(canonicalTable)("%o → %s (déterministe, deux appels identiques)", (intervention, expected) => {
      expect(mapTrainingInterventionToDbSessionType(intervention)).toBe(expected);
      expect(mapTrainingInterventionToDbSessionType(intervention)).toBe(expected);
    });
  });
});
