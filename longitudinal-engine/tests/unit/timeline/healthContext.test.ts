import { describe, expect, it } from "vitest";
import { isFlagActiveOnDay } from "../../../src/timeline/healthContext.js";
import { healthFlag } from "./fixtures.js";

describe("isFlagActiveOnDay", () => {
  it("is active when the flag started before the range and is still unresolved", () => {
    const flag = healthFlag({ flagDate: "2026-08-01", resolvedAt: null });
    expect(isFlagActiveOnDay(flag, "2026-08-12")).toBe(true);
  });

  it("is active for a flag open only within a narrow window", () => {
    const flag = healthFlag({ flagDate: "2026-08-10", resolvedAt: "2026-08-15" });
    expect(isFlagActiveOnDay(flag, "2026-08-12")).toBe(true);
  });

  it("is inactive once resolvedAt is before the day", () => {
    const flag = healthFlag({ flagDate: "2026-07-01", resolvedAt: "2026-08-05" });
    expect(isFlagActiveOnDay(flag, "2026-08-10")).toBe(false);
  });

  it("is active on the same day it opens and resolves (both boundaries inclusive)", () => {
    const flag = healthFlag({ flagDate: "2026-08-10", resolvedAt: "2026-08-10" });
    expect(isFlagActiveOnDay(flag, "2026-08-10")).toBe(true);
  });

  it("is inactive before flagDate", () => {
    const flag = healthFlag({ flagDate: "2026-08-10", resolvedAt: null });
    expect(isFlagActiveOnDay(flag, "2026-08-09")).toBe(false);
  });

  it("is active exactly on resolvedAt but inactive the day after", () => {
    const flag = healthFlag({ flagDate: "2026-08-01", resolvedAt: "2026-08-10" });
    expect(isFlagActiveOnDay(flag, "2026-08-10")).toBe(true);
    expect(isFlagActiveOnDay(flag, "2026-08-11")).toBe(false);
  });

  it("supports concurrent flags independently — one resolved, one still open", () => {
    const resolved = healthFlag({ flagDate: "2026-08-01", resolvedAt: "2026-08-05" });
    const open = healthFlag({ flagDate: "2026-08-03", resolvedAt: null });
    expect(isFlagActiveOnDay(resolved, "2026-08-10")).toBe(false);
    expect(isFlagActiveOnDay(open, "2026-08-10")).toBe(true);
  });
});
