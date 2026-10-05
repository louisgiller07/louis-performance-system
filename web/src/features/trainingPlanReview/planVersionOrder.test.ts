import { describe, expect, it } from "vitest";
import { isGeneratedAfter } from "./planVersionOrder";

// UX-11R.9 (F-4) — strictly more recent generated_at, microsecond-exact (PostgREST timestamps).
describe("isGeneratedAfter (UX-11R.9)", () => {
  it("the real D2A case: the 08:26 V1 draft is not newer than the 08:54 V2 plan", () => {
    expect(isGeneratedAfter("2026-10-05T08:26:32.118+00:00", "2026-10-05T08:54:18.973425+00:00")).toBe(false);
    expect(isGeneratedAfter("2026-10-05T08:54:18.973425+00:00", "2026-10-05T08:26:32.118+00:00")).toBe(true);
  });

  it("equal → not newer (stale)", () => {
    expect(isGeneratedAfter("2026-10-05T08:54:18.973425+00:00", "2026-10-05T08:54:18.973425+00:00")).toBe(false);
  });

  it("microseconds count, trailing zeros trimmed by PostgreSQL do not matter", () => {
    expect(isGeneratedAfter("2026-10-05T08:54:18.973426+00:00", "2026-10-05T08:54:18.973425+00:00")).toBe(true);
    expect(isGeneratedAfter("2026-10-05T08:54:18.97+00:00", "2026-10-05T08:54:18.970000+00:00")).toBe(false);
    expect(isGeneratedAfter("2026-10-05T08:54:19+00:00", "2026-10-05T08:54:18.999999+00:00")).toBe(true);
  });

  it("time zones are honoured; Z and +00 forms are accepted", () => {
    expect(isGeneratedAfter("2026-10-05T10:00:00+02:00", "2026-10-05T07:59:59Z")).toBe(true);
    expect(isGeneratedAfter("2026-10-05 08:00:00+00", "2026-10-05T08:00:00Z")).toBe(false);
  });

  it("unparseable input is never 'newer'", () => {
    expect(isGeneratedAfter("not a date", "2026-10-05T08:00:00Z")).toBe(false);
    expect(isGeneratedAfter("2026-10-05T08:00:00Z", "")).toBe(false);
  });
});
