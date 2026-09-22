import { describe, expect, it } from "vitest";
import { EXERCISE_CATALOG_ENTRIES, EXERCISE_CATALOG_VERSION, type PrescriptionModality } from "../../src/catalog/exerciseCatalog.js";
import { DRILL_CATALOG_ENTRIES, DRILL_CATALOG_VERSION } from "../../src/catalog/drillCatalog.js";
import { WEEK_TEMPLATE_CATALOG_ENTRIES, WEEK_TEMPLATE_CATALOG_VERSION, type WeekTemplateCatalogEntry } from "../../src/catalog/weekTemplateCatalog.js";
import { validateCatalogConsistency } from "../../src/validation/validateCatalog.js";
import { validatePrescriptionStructure } from "../../src/validation/validatePrescription.js";
import { PlanningEngineValidationError } from "../../src/validation/errors.js";
import type { RepScheme, StrengthPrescription } from "../../src/types/strengthPrescription.js";

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

  it("every repScheme's type is a modality already listed in that entry's supportedModalities (V0.4_138)", () => {
    const modalityForRepSchemeType: Record<RepScheme["type"], PrescriptionModality> = {
      fixed: "fixed_reps",
      range: "rep_range",
      time: "time",
      amrap: "amrap",
    };
    for (const entry of EXERCISE_CATALOG_ENTRIES) {
      if (entry.repScheme === undefined) continue;
      const requiredModality = modalityForRepSchemeType[entry.repScheme.type];
      expect(
        entry.supportedModalities,
        `entry "${entry.id}" has repScheme.type "${entry.repScheme.type}" but does not list "${requiredModality}" in supportedModalities`
      ).toContain(requiredModality);
    }
  });

  it("every repScheme passes structural validation — reuses validatePrescriptionStructure, never reimplements validateRepScheme's checks", () => {
    for (const entry of EXERCISE_CATALOG_ENTRIES) {
      if (entry.repScheme === undefined) continue;
      const syntheticStructure: StrengthPrescription = {
        domain: "strength",
        schemaVersion: "v1",
        blocks: [
          {
            role: "work",
            exerciseId: entry.id,
            sets: 1,
            repScheme: entry.repScheme,
            intensity: { type: "bodyweight" },
            restSeconds: entry.restSeconds ?? 0,
          },
        ],
      };
      expect(() => validatePrescriptionStructure(syntheticStructure), `entry "${entry.id}"'s repScheme failed validation`).not.toThrow();
    }
  });

  it("no restSeconds is negative (V0.4_138)", () => {
    for (const entry of EXERCISE_CATALOG_ENTRIES) {
      if (entry.restSeconds === undefined) continue;
      expect(entry.restSeconds, `entry "${entry.id}" has a negative restSeconds`).toBeGreaterThanOrEqual(0);
    }
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

  it("every drill has a non-blank executionCue (V0.4_138)", () => {
    for (const entry of DRILL_CATALOG_ENTRIES) {
      expect(entry.executionCue.trim().length, `drill "${entry.id}" has a blank executionCue`).toBeGreaterThan(0);
    }
  });
});

describe("week template catalog", () => {
  it("has a non-blank version string", () => {
    expect(WEEK_TEMPLATE_CATALOG_VERSION.length).toBeGreaterThan(0);
  });

  it("passes internal consistency validation (unique ids, no dangling references, valid deprecation)", () => {
    expect(() => validateCatalogConsistency("week template catalog", WEEK_TEMPLATE_CATALOG_ENTRIES)).not.toThrow();
  });

  it("rejects a catalogue with a duplicate id", () => {
    const withDuplicate = [...WEEK_TEMPLATE_CATALOG_ENTRIES, { ...WEEK_TEMPLATE_CATALOG_ENTRIES[0]! }];
    expect(() => validateCatalogConsistency("week template catalog", withDuplicate)).toThrow(PlanningEngineValidationError);
  });

  it("rejects a deprecated entry with no replacedBy", () => {
    const broken: WeekTemplateCatalogEntry[] = [{ ...WEEK_TEMPLATE_CATALOG_ENTRIES[0]!, id: "test_entry", deprecated: true }];
    expect(() => validateCatalogConsistency("week template catalog", broken)).toThrow(PlanningEngineValidationError);
  });

  it("has exactly one non-deprecated entry per WeekType — weekType is a function to a template, not a one-to-many relation", () => {
    const requiredWeekTypes = ["development", "deload", "taper", "race", "recovery"] as const;
    for (const weekType of requiredWeekTypes) {
      const matches = WEEK_TEMPLATE_CATALOG_ENTRIES.filter((e) => e.weekType === weekType && !e.deprecated);
      expect(matches, `weekType "${weekType}" must have exactly one non-deprecated entry`).toHaveLength(1);
    }
  });

  it("never carries a date, weekday, exercise id, drill id, or exact duration — slot counts only (V0.4_103 scope boundary)", () => {
    for (const entry of WEEK_TEMPLATE_CATALOG_ENTRIES) {
      const keys = Object.keys(entry);
      for (const forbidden of ["date", "dayOfWeek", "exerciseId", "drillId", "durationMin"]) {
        expect(keys, `entry "${entry.id}" must not declare "${forbidden}"`).not.toContain(forbidden);
      }
    }
  });

  it("development matches golden Scenario A verbatim: strength x2, DH-technical x2, aerobic x1", () => {
    const development = WEEK_TEMPLATE_CATALOG_ENTRIES.find((e) => e.id === "development")!;
    expect(development).toMatchObject({ strengthSlotCount: 2, dhTechnicalSlotCount: 2, aerobicSlotCount: 1 });
  });

  it("race has zero strength slots — the most conservative reading of golden Scenario B's \"no new-stimulus strength work\"", () => {
    const race = WEEK_TEMPLATE_CATALOG_ENTRIES.find((e) => e.id === "race")!;
    expect(race.strengthSlotCount).toBe(0);
  });

  it("race and taper both represent reduced volume relative to development, per golden Scenarios B/C", () => {
    const development = WEEK_TEMPLATE_CATALOG_ENTRIES.find((e) => e.id === "development")!;
    const race = WEEK_TEMPLATE_CATALOG_ENTRIES.find((e) => e.id === "race")!;
    const taper = WEEK_TEMPLATE_CATALOG_ENTRIES.find((e) => e.id === "taper")!;
    const total = (e: WeekTemplateCatalogEntry) => e.strengthSlotCount + e.dhTechnicalSlotCount + e.aerobicSlotCount;

    expect(total(taper)).toBeLessThan(total(development));
    expect(total(race)).toBeLessThan(total(taper));
  });

  it("recovery is the only template whose purpose is rest — restEmphasis distinguishes it from race, which also has zero tracked-domain slots", () => {
    const recovery = WEEK_TEMPLATE_CATALOG_ENTRIES.find((e) => e.id === "recovery")!;
    const othersWithRestEmphasis = WEEK_TEMPLATE_CATALOG_ENTRIES.filter((e) => e.id !== "recovery" && e.restEmphasis);

    expect(recovery.restEmphasis).toBe(true);
    expect(othersWithRestEmphasis).toHaveLength(0);
  });

  it("every entry carries a non-blank rationale — never a silent slot count with no stated reason", () => {
    for (const entry of WEEK_TEMPLATE_CATALOG_ENTRIES) {
      expect(entry.rationale.trim().length, `entry "${entry.id}" has a blank rationale`).toBeGreaterThan(0);
    }
  });
});
