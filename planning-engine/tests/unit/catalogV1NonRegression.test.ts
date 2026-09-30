import { describe, expect, it } from "vitest";
import { EXERCISE_CATALOG, EXERCISE_CATALOG_ENTRIES, EXERCISE_CATALOG_VERSION } from "../../src/catalog/exerciseCatalog.js";
import { DRILL_CATALOG_ENTRIES, DRILL_CATALOG_VERSION } from "../../src/catalog/drillCatalog.js";
import { SESSION_EXERCISE_CATALOG_V2_ENTRIES } from "../../src/catalog/sessionExerciseCatalogV2.js";

// UX-11A.5a.1 — non-regression lock on the V1 catalogues. The Session Model
// V2 content lives in a separate catalogue (sessionExerciseCatalogV2.ts) and
// must never change what V1 plans are built from. These snapshots were
// recorded BEFORE any V2 file existed; a diff here means V1 changed.
describe("V1 catalogues — frozen by UX-11A.5a.1", () => {
  it("keeps the historical V1 catalogue versions", () => {
    expect(EXERCISE_CATALOG_VERSION).toBe("v3");
    expect(DRILL_CATALOG_VERSION).toBe("v3");
  });

  it("keeps every V1 exercise entry byte-for-byte (21 entries)", () => {
    expect(EXERCISE_CATALOG_ENTRIES).toHaveLength(21);
    expect(EXERCISE_CATALOG_ENTRIES).toMatchSnapshot();
  });

  it("keeps every V1 drill entry byte-for-byte (21 entries)", () => {
    expect(DRILL_CATALOG_ENTRIES).toHaveLength(21);
    expect(DRILL_CATALOG_ENTRIES).toMatchSnapshot();
  });

  it("keeps the four legacy AMRAP doses exactly as they are for V1 plans", () => {
    for (const id of ["bodyweight_squat", "pushup", "pull_up", "hanging_leg_raise"]) {
      expect(EXERCISE_CATALOG[id]?.repScheme, id).toEqual({ type: "amrap" });
      expect(EXERCISE_CATALOG[id]?.supportedModalities, id).toContain("amrap");
    }
  });

  it("UX-11A.5a.3 — the two V1 mobility exercises keep their exact legacy entry (V2 metadata lives only in the V2 catalogue)", () => {
    expect(EXERCISE_CATALOG["hip_flexor_mobility"]).toEqual({
      id: "hip_flexor_mobility",
      displayName: "Hip Flexor Mobility Flow",
      movementCategory: "mobility",
      equipmentRequirements: [],
      supportedModalities: ["time"],
      substitutions: [],
      repScheme: { type: "time", seconds: 60 },
      restSeconds: 15,
    });
    expect(EXERCISE_CATALOG["thoracic_rotation_mobility"]).toEqual({
      id: "thoracic_rotation_mobility",
      displayName: "Thoracic Rotation Mobility Flow",
      movementCategory: "mobility",
      equipmentRequirements: [],
      supportedModalities: ["time"],
      substitutions: [],
      repScheme: { type: "time", seconds: 45 },
      restSeconds: 15,
    });
  });

  it("UX-11A.5a.3 — no V2-only exercise is reachable from the V1 catalogue", () => {
    const v2Only = SESSION_EXERCISE_CATALOG_V2_ENTRIES.filter((x) => x.origin === "v2_only");
    expect(v2Only).toHaveLength(31);
    for (const e of v2Only) expect(EXERCISE_CATALOG[e.exerciseId], e.exerciseId).toBeUndefined();
  });
});
