import { describe, expect, it } from "vitest";
import { resolveLink } from "../../../src/timeline/linking.js";

describe("resolveLink", () => {
  const pool = new Map([["x1", { id: "x1", label: "found" }]]);

  it("resolves to explicit when the FK matches a row in the pool", () => {
    const link = resolveLink("x1", pool);
    expect(link).toEqual({ kind: "explicit", ref: { id: "x1", label: "found" } });
  });

  it("resolves to absent/fk_null when the FK itself is null", () => {
    const link = resolveLink(null, pool);
    expect(link).toEqual({ kind: "absent", reason: "fk_null" });
  });

  it("resolves to absent/source_missing_in_pool when the FK is non-null but not found", () => {
    const link = resolveLink("does-not-exist", pool);
    expect(link).toEqual({ kind: "absent", reason: "source_missing_in_pool" });
  });
});
