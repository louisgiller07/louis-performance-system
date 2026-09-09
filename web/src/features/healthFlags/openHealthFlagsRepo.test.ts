import { describe, expect, it, vi, beforeEach } from "vitest";
import { loadOpenHealthFlags, OpenHealthFlagsLoadError } from "./openHealthFlagsRepo";

vi.mock("../../lib/supabase", () => ({
  supabase: { from: vi.fn() },
}));

import { supabase } from "../../lib/supabase";

const mockedFrom = supabase.from as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
});

function mockChain(result: { data: unknown; error: unknown }) {
  const order = vi.fn().mockResolvedValue(result);
  const inFn = vi.fn(() => ({ order }));
  const eq = vi.fn(() => ({ in: inFn }));
  const select = vi.fn(() => ({ eq }));
  mockedFrom.mockReturnValue({ select });
  return { select, eq, in: inFn, order };
}

describe("openHealthFlagsRepo.loadOpenHealthFlags", () => {
  it("reads from health_flags, scoped to the caller's own athlete_id", async () => {
    const { eq } = mockChain({ data: [], error: null });
    await loadOpenHealthFlags("athlete-1");
    expect(mockedFrom).toHaveBeenCalledWith("health_flags");
    expect(eq).toHaveBeenCalledWith("athlete_id", "athlete-1");
  });

  it("filters to only open (active/monitoring) flags", async () => {
    const { in: inFn } = mockChain({ data: [], error: null });
    await loadOpenHealthFlags("athlete-1");
    expect(inFn).toHaveBeenCalledWith("status", ["active", "monitoring"]);
  });

  it("orders oldest first", async () => {
    const { order } = mockChain({ data: [], error: null });
    await loadOpenHealthFlags("athlete-1");
    expect(order).toHaveBeenCalledWith("flag_date", { ascending: true });
  });

  it("maps rows to type/flagDate only — never the row id or status", async () => {
    mockChain({ data: [{ flag_type: "concussion_suspect", flag_date: "2026-09-05" }], error: null });
    const flags = await loadOpenHealthFlags("athlete-1");
    expect(flags).toEqual([{ type: "concussion_suspect", flagDate: "2026-09-05" }]);
  });

  it("returns an empty array when nothing is open", async () => {
    mockChain({ data: [], error: null });
    expect(await loadOpenHealthFlags("athlete-1")).toEqual([]);
  });

  it("throws OpenHealthFlagsLoadError on a query error, never a raw Supabase error", async () => {
    mockChain({ data: null, error: { code: "PGRST000", message: "should never leak" } });
    await expect(loadOpenHealthFlags("athlete-1")).rejects.toThrow(OpenHealthFlagsLoadError);
  });
});
