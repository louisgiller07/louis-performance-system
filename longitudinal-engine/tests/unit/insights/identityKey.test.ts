/**
 * V0.3_001C post-implementation correction -- a focused proof that
 * `identityKey`'s runtime separator is the historical NUL character
 * (U+0000, written in source as the literal escape `\u0000`), never a
 * space. The source file itself contains no raw NUL bytes anywhere --
 * only this textual escape, evaluated by the JS runtime at template-
 * literal time. Imports directly from the module (not the public
 * `insights/index.ts` barrel) -- `identityKey` is exported only for this
 * direct test, never re-exported as part of the package's public surface.
 */
import { describe, expect, it } from "vitest";
import { identityKey } from "../../../src/insights/buildPatternInsightCandidates.js";

describe("identityKey -- historical runtime separator semantics", () => {
  it("joins the 4 components with U+0000 (NUL), not a space or any other character", () => {
    const key = identityKey("athlete-a", "detector-b", "1.0.0", "kind-c");
    expect(key).toBe("athlete-a\u0000detector-b\u00001.0.0\u0000kind-c");
    expect(key).not.toBe("athlete-a detector-b 1.0.0 kind-c");
  });

  it("the separator character is exactly U+0000 -- splitting on it recovers the 4 original components", () => {
    const key = identityKey("a", "b", "c", "d");
    const parts = key.split("\u0000");
    expect(parts).toEqual(["a", "b", "c", "d"]);
    // Confirm no literal space separator is present anywhere in the key.
    expect(key.includes(" ")).toBe(false);
  });

  it("distinct tuples never collide (NUL cannot occur inside any real component)", () => {
    const keyA = identityKey("athlete-a", "recommendation_vs_actual_execution", "1.0.0", "recommendation_execution_alignment");
    const keyB = identityKey("athlete-b", "recommendation_vs_actual_execution", "1.0.0", "recommendation_execution_alignment");
    const keyC = identityKey("athlete-a", "sleep_quality_to_same_day_energy_correlation", "1.0.0", "sleep_energy_same_day_association");
    expect(new Set([keyA, keyB, keyC]).size).toBe(3);
  });
});
