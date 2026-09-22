import { describe, expect, it } from "vitest";
import { adjustHistory, InvalidAdjustmentError, type HistoryAdjusterInput } from "../../src/pipeline/historyAdjuster.js";
import { deriveLoad } from "../../src/pipeline/loadDerivation.js";
import { WEEK_TEMPLATE_CATALOG } from "../../src/catalog/weekTemplateCatalog.js";
import type { PlanInputRecentHistory } from "../../src/types/planInputSnapshot.js";

function recentHistory(overrides: Partial<PlanInputRecentHistory> = {}): PlanInputRecentHistory {
  return { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 300, ...overrides };
}

function baseInput(overrides: Partial<HistoryAdjusterInput> = {}): HistoryAdjusterInput {
  const kind = overrides.kind ?? "STRENGTH_LOWER";
  return {
    baseline: deriveLoad({ kind, template: WEEK_TEMPLATE_CATALOG.development!, strengthExperienceTier: "intermediate", weekType: "development" }),
    kind,
    recentHistory: recentHistory(),
    ...overrides,
  };
}

describe("adjustHistory — below threshold", () => {
  it("recentMissedOrReplacedCount < 3 returns the baseline unchanged, adjusted=false", () => {
    const input = baseInput({ recentHistory: recentHistory({ recentMissedOrReplacedCount: 2 }) });

    const result = adjustHistory(input);

    expect(result.adjusted).toBe(false);
    expect(result.adjustmentReason).toBeUndefined();
    expect(result).toMatchObject(input.baseline);
  });
});

describe("adjustHistory — threshold reached", () => {
  it("recentMissedOrReplacedCount >= 3 sets adjusted=true with a non-blank adjustmentReason", () => {
    const input = baseInput({ recentHistory: recentHistory({ recentMissedOrReplacedCount: 3 }) });

    const result = adjustHistory(input);

    expect(result.adjusted).toBe(true);
    expect(result.adjustmentReason).toBeTruthy();
    expect(result.adjustmentReason).toMatch(/missed|replaced/i);
  });

  it("strength: setVolume and targetRpeOrRir are reduced, never higher than baseline", () => {
    const input = baseInput({ kind: "STRENGTH_LOWER", recentHistory: recentHistory({ recentMissedOrReplacedCount: 5 }) });
    const baselineTarget = input.baseline.doseTarget as { domain: "strength"; setVolume: number; targetRpeOrRir: number };

    const result = adjustHistory(input);
    const adjustedTarget = result.doseTarget as { domain: "strength"; setVolume: number; targetRpeOrRir: number };

    expect(adjustedTarget.setVolume).toBeLessThan(baselineTarget.setVolume);
    expect(adjustedTarget.targetRpeOrRir).toBeLessThanOrEqual(baselineTarget.targetRpeOrRir);
  });

  it("dh_technical: focusedRunsCount is reduced, never higher than baseline", () => {
    const input = baseInput({ kind: "DH_TECHNICAL", recentHistory: recentHistory({ recentMissedOrReplacedCount: 3 }) });
    const baselineTarget = input.baseline.doseTarget as { domain: "dh_technical"; focusedRunsCount: number };

    const result = adjustHistory(input);
    const adjustedTarget = result.doseTarget as { domain: "dh_technical"; focusedRunsCount: number };

    expect(adjustedTarget.focusedRunsCount).toBeLessThan(baselineTarget.focusedRunsCount);
  });

  it("aerobic: intensityZone/duration are never increased (forced to the lighter zone)", () => {
    const input = baseInput({ kind: "AEROBIC_BASE", recentHistory: recentHistory({ recentMissedOrReplacedCount: 3 }) });

    const result = adjustHistory(input);
    const adjustedTarget = result.doseTarget as { domain: "aerobic"; intensityZone: "easy" | "moderate" };

    expect(adjustedTarget.intensityZone).toBe("easy");
    expect(result.durationMin).toBeLessThanOrEqual(input.baseline.durationMin);
  });
});

describe("adjustHistory — invariants", () => {
  it("never returns a kind field — kind is structurally never touched by this module", () => {
    const input = baseInput({ recentHistory: recentHistory({ recentMissedOrReplacedCount: 5 }) });

    const result = adjustHistory(input);

    expect(result).not.toHaveProperty("kind");
  });

  it("doseTarget.domain is always preserved, even when reduced", () => {
    const input = baseInput({ kind: "DH_TECHNICAL", recentHistory: recentHistory({ recentMissedOrReplacedCount: 3 }) });

    const result = adjustHistory(input);

    expect(result.doseTarget.domain).toBe("dh_technical");
  });

  it("durationMin is always a positive number after adjustment", () => {
    const input = baseInput({ recentHistory: recentHistory({ recentMissedOrReplacedCount: 3 }) });

    const result = adjustHistory(input);

    expect(result.durationMin).toBeGreaterThan(0);
  });

  it("loadProfile never increases (MODERATE steps down to LIGHT, LIGHT stays LIGHT)", () => {
    const LOAD_ORDER = { LIGHT: 0, MODERATE: 1, HEAVY: 2 } as const;
    const input = baseInput({ recentHistory: recentHistory({ recentMissedOrReplacedCount: 3 }) });

    const result = adjustHistory(input);

    expect(LOAD_ORDER[result.loadProfile!]).toBeLessThanOrEqual(LOAD_ORDER[input.baseline.loadProfile!]);
  });
});

describe("adjustHistory — no forbidden input", () => {
  it("only reads baseline/kind/recentHistory — extra unrelated properties never change the output", () => {
    const input = baseInput({ recentHistory: recentHistory({ recentMissedOrReplacedCount: 4 }) });
    const polluted = { ...input, equipment: [], races: [], weekType: "race", template: {}, strengthExperienceTier: "advanced" } as unknown as HistoryAdjusterInput;

    expect(adjustHistory(polluted)).toEqual(adjustHistory(input));
  });
});

describe("adjustHistory — determinism", () => {
  it("the same input produces the exact same output on repeated calls", () => {
    const input = baseInput({ recentHistory: recentHistory({ recentMissedOrReplacedCount: 3 }) });

    expect(adjustHistory(input)).toEqual(adjustHistory(input));
  });

  it("the same input produces the exact same output on repeated calls (below threshold)", () => {
    const input = baseInput({ recentHistory: recentHistory({ recentMissedOrReplacedCount: 1 }) });

    expect(adjustHistory(input)).toEqual(adjustHistory(input));
  });
});

describe("adjustHistory — InvalidAdjustmentError", () => {
  it("throws if a reduction would drive a value to zero or below", () => {
    const input = baseInput({
      kind: "STRENGTH_LOWER",
      baseline: { loadProfile: "LIGHT", durationMin: 1, doseTarget: { domain: "strength", setVolume: 12, targetRpeOrRir: 7 } },
      recentHistory: recentHistory({ recentMissedOrReplacedCount: 3 }),
    });

    expect(() => adjustHistory(input)).toThrow(InvalidAdjustmentError);
  });
});
