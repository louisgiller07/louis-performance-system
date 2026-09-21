import { describe, expect, it } from "vitest";
import { EXERCISE_CATALOG_ENTRIES, EXERCISE_CATALOG_VERSION } from "../../src/catalog/exerciseCatalog.js";
import { DRILL_CATALOG_ENTRIES, DRILL_CATALOG_VERSION } from "../../src/catalog/drillCatalog.js";
import { validateCatalogConsistency } from "../../src/validation/validateCatalog.js";
import { PlanningEngineValidationError } from "../../src/validation/errors.js";

describe("exercise catalog", () => {
  it("has a non-blank version string", () => {
    expect(EXERCISE_CATALOG_VERSION.length).toBeGreaterThan(0);
  });

  it("passes internal consistency validation (unique ids, no dangling references, valid deprecation)", () => {
    expect(() =>
      validateCatalogConsistency("exercise catalog", EXERCISE_CATALOG_ENTRIES, (entry) => entry.substitutions)
    ).not.toThrow();
  });

  it("has at least one bodyweight (equipment-free) exercise per represented movement category", () => {
    const categories = new Set(EXERCISE_CATALOG_ENTRIES.map((e) => e.movementCategory));
    for (const category of categories) {
      const hasBodyweightOption = EXERCISE_CATALOG_ENTRIES.some(
        (e) => e.movementCategory === category && e.equipmentRequirements.length === 0
      );
      expect(hasBodyweightOption, `category "${category}" has no equipment-free option`).toBe(true);
    }
  });

  it("rejects a catalogue with a duplicate id", () => {
    const withDuplicate = [...EXERCISE_CATALOG_ENTRIES, { ...EXERCISE_CATALOG_ENTRIES[0]! }];
    expect(() => validateCatalogConsistency("exercise catalog", withDuplicate)).toThrow(PlanningEngineValidationError);
  });

  it("rejects a catalogue with a dangling progressesTo reference", () => {
    const broken = [{ ...EXERCISE_CATALOG_ENTRIES[0]!, id: "test_entry", progressesTo: "does_not_exist", substitutions: [] }];
    expect(() => validateCatalogConsistency("exercise catalog", broken)).toThrow(PlanningEngineValidationError);
  });

  it("rejects a deprecated entry with no replacedBy", () => {
    const broken = [{ ...EXERCISE_CATALOG_ENTRIES[0]!, id: "test_entry", deprecated: true, substitutions: [] }];
    expect(() => validateCatalogConsistency("exercise catalog", broken)).toThrow(PlanningEngineValidationError);
  });
});

describe("DH drill catalog", () => {
  it("has a non-blank version string", () => {
    expect(DRILL_CATALOG_VERSION.length).toBeGreaterThan(0);
  });

  it("passes internal consistency validation", () => {
    expect(() => validateCatalogConsistency("drill catalog", DRILL_CATALOG_ENTRIES)).not.toThrow();
  });

  it("covers every skill named in the M0 golden-scenario set", () => {
    const requiredSkills = ["braking", "cornering", "line_choice", "steep_terrain", "roots_rocks", "jumps", "race_execution"];
    const coveredSkills = new Set(DRILL_CATALOG_ENTRIES.map((d) => d.skillTarget));
    for (const skill of requiredSkills) {
      expect(coveredSkills.has(skill), `skill "${skill}" has no drill`).toBe(true);
    }
  });

  it("has at least one weekend-viable (non-bike-park-only) terrain drill for cornering", () => {
    // Sanity check supporting golden Scenario F (weekend-only DH access) —
    // not every drill can require bike-park-specific terrain.
    const corneringDrills = DRILL_CATALOG_ENTRIES.filter((d) => d.skillTarget === "cornering");
    expect(corneringDrills.some((d) => d.terrainRequirement !== "bike_park_jump_line")).toBe(true);
  });
});
