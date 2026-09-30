import { describe, expect, it } from "vitest";
import { EXERCISE_CATALOG, EXERCISE_CATALOG_ENTRIES, EXERCISE_CATALOG_VERSION } from "../../src/catalog/exerciseCatalog.js";
import {
  SESSION_EXERCISE_CATALOG_V2,
  SESSION_EXERCISE_CATALOG_V2_ENTRIES,
  SESSION_EXERCISE_CATALOG_V2_VERSION,
  SESSION_EXERCISE_FAMILIES_V2,
  SESSION_EXERCISE_ROLES_V2,
  SESSION_MEASURE_TYPES_V2,
  SESSION_TIERS_V2,
  type SessionExerciseRoleV2,
} from "../../src/catalog/sessionExerciseCatalogV2.js";
import {
  CANONICAL_COACHING_LOCALE,
  COACHING_TEXT_CATALOG,
  COACHING_TEXT_CATALOG_ENTRIES,
  COACHING_TEXT_CATALOG_VERSION,
  PROVISIONAL_NOTICE,
} from "../../src/catalog/coachingTextCatalog.js";
import { assertValidEquipment } from "../../src/validation/validatePlanInputSnapshot.js";

// UX-11A.5a.1 — integrity of the Session Model V2 exercise catalogue and of
// the canonical coaching text library. All content is PROVISIONAL —
// coaching validation required (ADR UX-11A.5a.1).

const V1_IDS = new Set(EXERCISE_CATALOG_ENTRIES.map((e) => e.id));
const V2 = SESSION_EXERCISE_CATALOG_V2_ENTRIES;

// Role envelopes at "charge modérée" — docs/03_COACHING_MODEL.md §Modèle de
// séance NALYNT V1, 5 (Force role table) and Puissance (3–5 × 3–5).
const REPS_ENVELOPES: Partial<Record<SessionExerciseRoleV2, { sets: [number, number]; reps: [number, number] }>> = {
  principal: { sets: [3, 5], reps: [6, 8] },
  secondary: { sets: [3, 4], reps: [8, 12] },
  unilateral: { sets: [3, 4], reps: [6, 12] },
  prevention: { sets: [2, 4], reps: [12, 20] },
  explosive: { sets: [3, 5], reps: [3, 5] },
};

describe("Session Model V2 exercise catalogue — identity and isolation from V1", () => {
  it("has its own version, distinct from the historical V1 catalogue version", () => {
    expect(SESSION_EXERCISE_CATALOG_V2_VERSION.length).toBeGreaterThan(0);
    expect(SESSION_EXERCISE_CATALOG_V2_VERSION).not.toBe(EXERCISE_CATALOG_VERSION);
  });

  it("has unique exerciseIds, and the lookup map matches the entries", () => {
    const ids = V2.map((e) => e.exerciseId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(SESSION_EXERCISE_CATALOG_V2).sort()).toEqual([...ids].sort());
  });

  it("enriched entries reuse an existing V1 id with identical required equipment; V2-only entries never collide with V1", () => {
    for (const e of V2) {
      if (e.origin === "v1_enriched") {
        expect(V1_IDS.has(e.exerciseId), `${e.exerciseId} should exist in V1`).toBe(true);
        expect([...e.requiredEquipment].sort(), e.exerciseId).toEqual([...EXERCISE_CATALOG[e.exerciseId]!.equipmentRequirements].sort());
      } else {
        expect(V1_IDS.has(e.exerciseId), `${e.exerciseId} must stay V2-only`).toBe(false);
      }
    }
  });

  it("covers 19 enriched V1 exercises and 24 new V2-only exercises in this slice (mobility comes with UX-11A.5a.3)", () => {
    expect(V2.filter((e) => e.origin === "v1_enriched")).toHaveLength(19);
    expect(V2.filter((e) => e.origin === "v2_only")).toHaveLength(24);
    expect(SESSION_EXERCISE_CATALOG_V2["hip_flexor_mobility"]).toBeUndefined();
    expect(SESSION_EXERCISE_CATALOG_V2["thoracic_rotation_mobility"]).toBeUndefined();
  });
});

describe("Session Model V2 exercise catalogue — metadata validity", () => {
  it("every entry is PROVISIONAL; none is VALIDATED because it existed in V1", () => {
    expect(PROVISIONAL_NOTICE).toBe("PROVISIONAL — coaching validation required");
    for (const e of V2) expect(e.validationStatus, e.exerciseId).toBe("PROVISIONAL");
  });

  it("roles, tiers, family and measure type use the closed V2 vocabularies", () => {
    for (const e of V2) {
      expect(e.roles.length, e.exerciseId).toBeGreaterThan(0);
      expect(new Set(e.roles).size, e.exerciseId).toBe(e.roles.length);
      for (const role of e.roles) expect(SESSION_EXERCISE_ROLES_V2, e.exerciseId).toContain(role);
      expect(e.tiers.length, e.exerciseId).toBeGreaterThan(0);
      for (const tier of e.tiers) expect(SESSION_TIERS_V2, e.exerciseId).toContain(tier);
      expect(SESSION_EXERCISE_FAMILIES_V2, e.exerciseId).toContain(e.family);
      expect(SESSION_MEASURE_TYPES_V2, e.exerciseId).toContain(e.measureType);
    }
  });

  it("required and optional equipment stay within the athlete's declarable equipment vocabulary", () => {
    for (const e of V2) {
      expect(() => assertValidEquipment([...e.requiredEquipment, ...e.optionalEquipment]), e.exerciseId).not.toThrow();
      for (const item of e.optionalEquipment) expect(e.requiredEquipment, e.exerciseId).not.toContain(item);
    }
  });

  it("the reference prescription carries exactly the volume of its measure type, with sane ranges and never a load", () => {
    const volumeFieldByMeasure = { reps: "reps", duration: "durationSeconds", distance: "distanceMeters" } as const;
    for (const e of V2) {
      const p = e.referencePrescription as unknown as Record<string, { min: number; max: number } | undefined>;
      const volumes = ["reps", "durationSeconds", "distanceMeters"].filter((k) => p[k] !== undefined);
      expect(volumes, e.exerciseId).toEqual([volumeFieldByMeasure[e.measureType]]);
      for (const key of ["sets", ...volumes, "restSeconds"]) {
        const range = p[key]!;
        expect(Number.isInteger(range.min) && Number.isInteger(range.max), `${e.exerciseId}.${key}`).toBe(true);
        expect(range.min, `${e.exerciseId}.${key}`).toBeLessThanOrEqual(range.max);
        expect(range.min, `${e.exerciseId}.${key}`).toBeGreaterThanOrEqual(0);
      }
      expect(p.sets!.min, e.exerciseId).toBeGreaterThanOrEqual(1);
      expect(Object.keys(e.referencePrescription).some((k) => /load|kg|percent|1rm/i.test(k)), e.exerciseId).toBe(false);
    }
  });

  it("the reference dose of a principal / secondary / unilateral / prevention / explosive exercise stays inside the 03 envelope of that role", () => {
    for (const e of V2) {
      const envelope = REPS_ENVELOPES[e.roles[0]!];
      if (!envelope || e.measureType !== "reps") continue;
      const { sets, reps } = e.referencePrescription;
      expect(sets.min, e.exerciseId).toBeGreaterThanOrEqual(envelope.sets[0]);
      expect(sets.max, e.exerciseId).toBeLessThanOrEqual(envelope.sets[1]);
      expect(reps!.min, e.exerciseId).toBeGreaterThanOrEqual(envelope.reps[0]);
      expect(reps!.max, e.exerciseId).toBeLessThanOrEqual(envelope.reps[1]);
    }
  });

  it("progression, regression and substitution references point to existing V2 entries, never to themselves", () => {
    for (const e of V2) {
      for (const ref of [e.progressesTo, e.regressesTo, ...e.substitutions].filter((x): x is string => x !== undefined)) {
        expect(SESSION_EXERCISE_CATALOG_V2[ref], `${e.exerciseId} → ${ref}`).toBeDefined();
        expect(ref, e.exerciseId).not.toBe(e.exerciseId);
      }
    }
  });

  it("cueId and vigilanceIds resolve to existing coaching texts of the right kind", () => {
    for (const e of V2) {
      expect(COACHING_TEXT_CATALOG[e.cueId]?.kind, `${e.exerciseId} cue`).toBe("cue");
      for (const id of e.vigilanceIds) expect(COACHING_TEXT_CATALOG[id]?.kind, `${e.exerciseId} ${id}`).toBe("vigilance");
    }
  });

  it("every role of this slice has at least one option that needs no equipment", () => {
    for (const role of SESSION_EXERCISE_ROLES_V2) {
      const hasBodyweight = V2.some((e) => e.roles.includes(role) && e.requiredEquipment.length === 0);
      expect(hasBodyweight, role).toBe(true);
    }
  });
});

describe("coaching text library", () => {
  it("has its own version and fr-CH as canonical locale", () => {
    expect(COACHING_TEXT_CATALOG_VERSION.length).toBeGreaterThan(0);
    expect(CANONICAL_COACHING_LOCALE).toBe("fr-CH");
  });

  it("has unique ids, a non-empty canonical text for each, and every entry is PROVISIONAL", () => {
    const ids = COACHING_TEXT_CATALOG_ENTRIES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of COACHING_TEXT_CATALOG_ENTRIES) {
      expect(t.text[CANONICAL_COACHING_LOCALE].trim().length, t.id).toBeGreaterThan(0);
      expect(t.validationStatus, t.id).toBe("PROVISIONAL");
      expect(t.id.startsWith(`${t.kind === "success_criterion" ? "criterion" : t.kind}.`), t.id).toBe(true);
    }
  });

  it("has no orphan text: every cue and vigilance is used by at least one V2 exercise", () => {
    const used = new Set(V2.flatMap((e) => [e.cueId, ...e.vigilanceIds]));
    for (const t of COACHING_TEXT_CATALOG_ENTRIES) expect(used.has(t.id), t.id).toBe(true);
  });

  it("vigilance texts are help, never a prohibition", () => {
    for (const t of COACHING_TEXT_CATALOG_ENTRIES.filter((x) => x.kind === "vigilance")) {
      expect(t.text["fr-CH"], t.id).not.toMatch(/interdit|contre-indiqué|jamais/i);
    }
  });
});
