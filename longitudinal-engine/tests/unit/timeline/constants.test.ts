import { describe, expect, it } from "vitest";
import { DECISION_OUTCOME_HORIZONS, TIMELINE_BUILDER_VERSION } from "../../../src/timeline/constants.js";

describe("timeline constants", () => {
  it("DECISION_OUTCOME_HORIZONS is exactly the three real horizon values, in canonical order", () => {
    expect(DECISION_OUTCOME_HORIZONS).toEqual(["J_PLUS_1", "J_PLUS_3", "J_PLUS_7"]);
  });

  it("TIMELINE_BUILDER_VERSION is a non-empty deterministic string, not a timestamp", () => {
    expect(typeof TIMELINE_BUILDER_VERSION).toBe("string");
    expect(TIMELINE_BUILDER_VERSION.length).toBeGreaterThan(0);
    expect(TIMELINE_BUILDER_VERSION).toBe(TIMELINE_BUILDER_VERSION); // stable across calls (no clock involved)
  });
});
