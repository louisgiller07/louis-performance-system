import { describe, expect, it } from "vitest";
import { EXERCISE_CATALOG, EXERCISE_CATALOG_ENTRIES, EXERCISE_CATALOG_VERSION } from "../../src/catalog/exerciseCatalog.js";
import { DRILL_CATALOG_ENTRIES, DRILL_CATALOG_VERSION } from "../../src/catalog/drillCatalog.js";

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
});
