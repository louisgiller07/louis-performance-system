import { beforeEach, describe, expect, it } from "vitest";
import { buildHealthFlagThreads } from "../../../src/timeline/healthFlagThread.js";
import { indexById } from "../../../src/timeline/partitioning.js";
import { checkin, healthFlag, resetIdSequence } from "./fixtures.js";

beforeEach(() => resetIdSequence());

describe("buildHealthFlagThreads", () => {
  it("carries openedOn/resolvedOn straight from flagDate/resolvedAt", () => {
    const f = healthFlag({ flagDate: "2026-08-01", resolvedAt: "2026-08-10" });
    const threads = buildHealthFlagThreads([f], new Map());
    expect(threads[0]?.openedOn).toBe("2026-08-01");
    expect(threads[0]?.resolvedOn).toBe("2026-08-10");
  });

  it("resolvedOn is null for a still-open flag", () => {
    const f = healthFlag({ resolvedAt: null });
    const threads = buildHealthFlagThreads([f], new Map());
    expect(threads[0]?.resolvedOn).toBeNull();
  });

  it("resolves linkedSourceCheckin explicitly when sourceCheckinId matches the pool", () => {
    const c = checkin({ id: "c1" });
    const f = healthFlag({ sourceCheckinId: "c1" });
    const threads = buildHealthFlagThreads([f], indexById([c]));
    expect(threads[0]?.linkedSourceCheckin).toEqual({ kind: "explicit", ref: c });
  });

  it("linkedSourceCheckin is fk_null when sourceCheckinId is null", () => {
    const f = healthFlag({ sourceCheckinId: null });
    const threads = buildHealthFlagThreads([f], new Map());
    expect(threads[0]?.linkedSourceCheckin).toEqual({ kind: "absent", reason: "fk_null" });
  });

  it("orders threads by id ASC regardless of input order", () => {
    const f1 = healthFlag({ id: "f2" });
    const f2 = healthFlag({ id: "f1" });
    const threads = buildHealthFlagThreads([f1, f2], new Map());
    expect(threads.map((t) => t.flag.id)).toEqual(["f1", "f2"]);
  });
});
