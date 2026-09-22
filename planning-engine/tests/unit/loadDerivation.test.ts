import { describe, expect, it } from "vitest";
import { deriveLoad, UnsupportedSessionKindError, type LoadDerivationInput } from "../../src/pipeline/loadDerivation.js";
import { WEEK_TEMPLATE_CATALOG } from "../../src/catalog/weekTemplateCatalog.js";

function baseInput(overrides: Partial<LoadDerivationInput> = {}): LoadDerivationInput {
  return {
    kind: "STRENGTH_LOWER",
    template: WEEK_TEMPLATE_CATALOG.development!,
    strengthExperienceTier: "intermediate",
    weekType: "development",
    ...overrides,
  };
}

describe("deriveLoad — domain outputs", () => {
  it("STRENGTH_LOWER produces a strength doseTarget with a loadProfile", () => {
    const result = deriveLoad(baseInput({ kind: "STRENGTH_LOWER" }));

    expect(result.doseTarget.domain).toBe("strength");
    expect(result.loadProfile).toBeDefined();
  });

  it("STRENGTH_UPPER produces a strength doseTarget with a loadProfile", () => {
    const result = deriveLoad(baseInput({ kind: "STRENGTH_UPPER" }));

    expect(result.doseTarget.domain).toBe("strength");
    expect(result.loadProfile).toBeDefined();
  });

  it("DH_TECHNICAL produces a dh_technical doseTarget with a loadProfile", () => {
    const result = deriveLoad(baseInput({ kind: "DH_TECHNICAL" }));

    expect(result.doseTarget.domain).toBe("dh_technical");
    expect(result.loadProfile).toBeDefined();
  });

  it("AEROBIC_BASE produces an aerobic doseTarget", () => {
    const result = deriveLoad(baseInput({ kind: "AEROBIC_BASE" }));

    expect(result.doseTarget.domain).toBe("aerobic");
  });
});

describe("deriveLoad — kind -> domain correspondence", () => {
  const cases: Array<[import("../../src/types/sharedVocabulary.js").SessionKind, "strength" | "dh_technical" | "aerobic"]> = [
    ["STRENGTH_LOWER", "strength"],
    ["STRENGTH_UPPER", "strength"],
    ["STRENGTH_FULL_LIGHT", "strength"],
    ["POWER", "strength"],
    ["DH_TECHNICAL", "dh_technical"],
    ["DH_PERFORMANCE", "dh_technical"],
    ["DH_LIGHT", "dh_technical"],
    ["AEROBIC_BASE", "aerobic"],
    ["AEROBIC_INTERVALS", "aerobic"],
  ];

  for (const [kind, expectedDomain] of cases) {
    it(`${kind} always produces doseTarget.domain === "${expectedDomain}"`, () => {
      const result = deriveLoad(baseInput({ kind }));
      expect(result.doseTarget.domain).toBe(expectedDomain);
    });
  }
});

describe("deriveLoad — unsupported kinds", () => {
  const unsupported: Array<import("../../src/types/sharedVocabulary.js").SessionKind> = [
    "GRIP_WORK",
    "PUMPTRACK",
    "MOBILITY",
    "RECOVERY_ACTIVE",
    "REST",
    "BIKE_MAINTENANCE",
    "RACE_ACTIVITY",
  ];

  for (const kind of unsupported) {
    it(`throws UnsupportedSessionKindError for ${kind}`, () => {
      expect(() => deriveLoad(baseInput({ kind }))).toThrow(UnsupportedSessionKindError);
    });
  }
});

describe("deriveLoad — durationMin", () => {
  it("is always a positive number, across every supported domain", () => {
    for (const kind of ["STRENGTH_LOWER", "DH_TECHNICAL", "AEROBIC_BASE"] as const) {
      const result = deriveLoad(baseInput({ kind }));
      expect(result.durationMin).toBeGreaterThan(0);
    }
  });
});

describe("deriveLoad — taper reduction (Golden Scenario C)", () => {
  it("taper produces a shorter durationMin than development, for the same kind", () => {
    const development = deriveLoad(baseInput({ kind: "STRENGTH_LOWER", weekType: "development" }));
    const taper = deriveLoad(baseInput({ kind: "STRENGTH_LOWER", weekType: "taper" }));

    expect(taper.durationMin).toBeLessThan(development.durationMin);
  });

  it("taper never uses a heavier loadProfile than development for the same kind", () => {
    const LOAD_ORDER = { LIGHT: 0, MODERATE: 1, HEAVY: 2 } as const;
    const development = deriveLoad(baseInput({ kind: "STRENGTH_LOWER", weekType: "development" }));
    const taper = deriveLoad(baseInput({ kind: "STRENGTH_LOWER", weekType: "taper" }));

    expect(LOAD_ORDER[taper.loadProfile!]).toBeLessThanOrEqual(LOAD_ORDER[development.loadProfile!]);
  });

  it("taper reduces strength setVolume and targetRpeOrRir versus development", () => {
    const development = deriveLoad(baseInput({ kind: "STRENGTH_LOWER", weekType: "development" }));
    const taper = deriveLoad(baseInput({ kind: "STRENGTH_LOWER", weekType: "taper" }));

    const devTarget = development.doseTarget as { domain: "strength"; setVolume: number; targetRpeOrRir: number };
    const taperTarget = taper.doseTarget as { domain: "strength"; setVolume: number; targetRpeOrRir: number };

    expect(taperTarget.setVolume).toBeLessThan(devTarget.setVolume);
    expect(taperTarget.targetRpeOrRir).toBeLessThan(devTarget.targetRpeOrRir);
  });

  it("deload/race/recovery share the same baseline as development — no distinction invented beyond taper", () => {
    const development = deriveLoad(baseInput({ kind: "STRENGTH_LOWER", weekType: "development" }));
    const deload = deriveLoad(baseInput({ kind: "STRENGTH_LOWER", weekType: "deload" }));
    const recovery = deriveLoad(baseInput({ kind: "STRENGTH_LOWER", weekType: "recovery" }));

    expect(deload).toEqual(development);
    expect(recovery).toEqual(development);
  });
});

describe("deriveLoad — no forbidden input", () => {
  it("only reads kind/template/weekType — extra unrelated properties on the input never change the output", () => {
    const input = baseInput();
    const polluted = { ...input, recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 99, trailingVolumeMinutes: 0 }, equipment: [], races: [] } as unknown as LoadDerivationInput;

    expect(deriveLoad(polluted)).toEqual(deriveLoad(input));
  });
});

describe("deriveLoad — determinism", () => {
  it("the same input produces the exact same output on repeated calls", () => {
    const input = baseInput({ kind: "DH_TECHNICAL", weekType: "taper" });

    expect(deriveLoad(input)).toEqual(deriveLoad(input));
  });
});
