import { describe, expect, it } from "vitest";
import { DRILL_CATALOG, DRILL_CATALOG_ENTRIES, DRILL_CATALOG_VERSION } from "../../src/catalog/drillCatalog.js";
import {
  DH_DRILL_PASSES_RANGE_V2,
  DH_SKILLS_V2,
  DH_TECHNICAL_TIERS_V2,
  SESSION_DRILL_CATALOG_V2,
  SESSION_DRILL_CATALOG_V2_ENTRIES,
  SESSION_DRILL_CATALOG_V2_VERSION,
} from "../../src/catalog/sessionDrillCatalogV2.js";
import { COACHING_TEXT_CATALOG } from "../../src/catalog/coachingTextCatalog.js";
import { assertValidTerrainAccess } from "../../src/validation/validatePlanInputSnapshot.js";

// UX-11A.5a.2a — integrity of the Session Model V2 DH drill catalogue.
const V2 = SESSION_DRILL_CATALOG_V2_ENTRIES;
const TIER_ORDER = { beginner: 0, intermediate: 1, advanced: 2 } as const;
const fr = (id: string) => COACHING_TEXT_CATALOG[id]!.text["fr-CH"];

describe("Session Model V2 DH drill catalogue — identity and isolation from V1", () => {
  it("has its own version, distinct from the historical V1 drill catalogue version", () => {
    expect(SESSION_DRILL_CATALOG_V2_VERSION.length).toBeGreaterThan(0);
    expect(SESSION_DRILL_CATALOG_V2_VERSION).not.toBe(DRILL_CATALOG_VERSION);
  });

  it("holds exactly the 21 V1 drillIds, unique, all v1_enriched", () => {
    expect(V2).toHaveLength(21);
    const ids = V2.map((d) => d.drillId);
    expect(new Set(ids).size).toBe(21);
    expect([...ids].sort()).toEqual(DRILL_CATALOG_ENTRIES.map((d) => d.id).sort());
    expect(Object.keys(SESSION_DRILL_CATALOG_V2)).toHaveLength(21);
    for (const d of V2) expect(d.origin, d.drillId).toBe("v1_enriched");
  });

  it("keeps the V1 skill, difficulty (as explicit technicalTier) and required terrain of each drill", () => {
    for (const d of V2) {
      const v1 = DRILL_CATALOG[d.drillId]!;
      expect(d.skill, d.drillId).toBe(v1.skillTarget);
      expect(d.technicalTier, d.drillId).toBe(v1.difficulty);
      expect(d.requiredTerrain, d.drillId).toBe(v1.terrainRequirement);
    }
  });
});

describe("Session Model V2 DH drill catalogue — metadata validity", () => {
  it("uses the closed skill / tier / terrain vocabularies, with one drill per skill × tier", () => {
    for (const d of V2) {
      expect(DH_SKILLS_V2, d.drillId).toContain(d.skill);
      expect(DH_TECHNICAL_TIERS_V2, d.drillId).toContain(d.technicalTier);
      expect(() => assertValidTerrainAccess([d.requiredTerrain]), d.drillId).not.toThrow();
    }
    for (const skill of DH_SKILLS_V2) {
      for (const tier of DH_TECHNICAL_TIERS_V2) {
        expect(V2.filter((d) => d.skill === skill && d.technicalTier === tier), `${skill}/${tier}`).toHaveLength(1);
      }
    }
  });

  it("measures passes within the Session Model 4–8 rule", () => {
    expect(DH_DRILL_PASSES_RANGE_V2).toEqual({ min: 4, max: 8 });
    for (const d of V2) {
      expect(d.measureType, d.drillId).toBe("pass");
      expect(d.passes.min, d.drillId).toBeGreaterThanOrEqual(4);
      expect(d.passes.max, d.drillId).toBeLessThanOrEqual(8);
      expect(d.passes.min, d.drillId).toBeLessThanOrEqual(d.passes.max);
    }
  });

  it("progression and regression follow the tier chain within the same skill", () => {
    for (const d of V2) {
      for (const [ref, step] of [[d.progressesTo, 1], [d.regressesTo, -1]] as const) {
        if (ref === undefined) continue;
        const target = SESSION_DRILL_CATALOG_V2[ref];
        expect(target, `${d.drillId} → ${ref}`).toBeDefined();
        expect(target!.skill, `${d.drillId} → ${ref}`).toBe(d.skill);
        expect(TIER_ORDER[target!.technicalTier] - TIER_ORDER[d.technicalTier], `${d.drillId} → ${ref}`).toBe(step);
      }
      expect(d.progressesTo === undefined, d.drillId).toBe(d.technicalTier === "advanced");
      expect(d.regressesTo === undefined, d.drillId).toBe(d.technicalTier === "beginner");
    }
  });

  it("cueId, criterionId and vigilanceIds resolve to texts of the right kind; everything is PROVISIONAL", () => {
    for (const d of V2) {
      expect(COACHING_TEXT_CATALOG[d.cueId]?.kind, d.drillId).toBe("cue");
      expect(COACHING_TEXT_CATALOG[d.criterionId]?.kind, d.drillId).toBe("success_criterion");
      for (const id of d.vigilanceIds) expect(COACHING_TEXT_CATALOG[id]?.kind, `${d.drillId} ${id}`).toBe("vigilance");
      expect(d.validationStatus, d.drillId).toBe("PROVISIONAL");
    }
  });
});

describe("Session Model V2 DH texts — Session Model rules", () => {
  it("no cue or criterion prescribes a number of passages or uses the word 'run'", () => {
    for (const d of V2) {
      for (const text of [fr(d.cueId), fr(d.criterionId)]) {
        expect(text, d.drillId).not.toMatch(/\d+\s*(à\s*\d+\s*)?(passages?|runs?|descentes?|fois)\b/i);
        expect(text, d.drillId).not.toMatch(/\bruns?\b/i);
      }
    }
  });

  it("no criterion contains an aggregated success threshold", () => {
    for (const d of V2) expect(fr(d.criterionId), d.drillId).not.toMatch(/\d+\s*(sur|\/)\s*\d+|\bfois\b|\d/i);
  });

  it("no criterion requires a stopwatch; a cue may only mention it as optional", () => {
    for (const d of V2) {
      expect(fr(d.criterionId), d.drillId).not.toMatch(/chrono|seconde|%|\btemps\b/i);
      const cue = fr(d.cueId);
      if (/chrono/i.test(cue)) expect(cue, d.drillId).toMatch(/facultati/i);
    }
  });
});
