import { describe, expect, it, vi, beforeEach } from "vitest";
import { loadRacesInRange, groupRacesByDate, RaceOverlayLoadError } from "./raceOverlayRepo";
import type { RaceOverlayEvent } from "./raceOverlayRepo";

vi.mock("../../lib/supabase", () => ({
  supabase: { from: vi.fn() },
}));

import { supabase } from "../../lib/supabase";

const mockedFrom = supabase.from as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
});

function mockRaceChain(result: { data: unknown; error: unknown }) {
  const gte = vi.fn().mockResolvedValue(result);
  const lte = vi.fn(() => ({ gte }));
  const inFilter = vi.fn(() => ({ lte }));
  const eq = vi.fn(() => ({ in: inFilter }));
  const select = vi.fn(() => ({ eq }));
  mockedFrom.mockReturnValue({ select });
  return { eq, inFilter, lte, gte };
}

describe("raceOverlayRepo.loadRacesInRange", () => {
  it("reads via the caller's own Supabase client only (RLS-scoped, no service role)", async () => {
    mockRaceChain({ data: [], error: null });
    await loadRacesInRange("athlete-1", "2026-08-19", "2026-08-25");
    expect(mockedFrom).toHaveBeenCalledWith("race_calendar");
  });

  it("J: athlete isolation — filters by the caller's own athlete_id", async () => {
    const { eq } = mockRaceChain({ data: [], error: null });
    await loadRacesInRange("athlete-1", "2026-08-19", "2026-08-25");
    expect(eq).toHaveBeenCalledWith("athlete_id", "athlete-1");
  });

  it("filters to only the canonical active statuses (planned/registered/confirmed) — reuses the schema's own definition, never a cancelled/skipped race", async () => {
    const { inFilter } = mockRaceChain({ data: [], error: null });
    await loadRacesInRange("athlete-1", "2026-08-19", "2026-08-25");
    expect(inFilter).toHaveBeenCalledWith("status", ["planned", "registered", "confirmed"]);
  });

  it("filters by the exact overlap window (start_date <= toDate AND end_date >= fromDate)", async () => {
    const { lte, gte } = mockRaceChain({ data: [], error: null });
    await loadRacesInRange("athlete-1", "2026-08-19", "2026-08-25");
    expect(lte).toHaveBeenCalledWith("start_date", "2026-08-25");
    expect(gte).toHaveBeenCalledWith("end_date", "2026-08-19");
  });

  it("K: returns an empty array when no events exist — Planning behaves exactly as before", async () => {
    mockRaceChain({ data: [], error: null });
    const result = await loadRacesInRange("athlete-1", "2026-08-19", "2026-08-25");
    expect(result).toEqual([]);
  });

  it("maps DB rows to camelCase without inventing any field", async () => {
    mockRaceChain({
      data: [{ event_name: "EDC Verbier", start_date: "2026-09-11", end_date: "2026-09-13", priority: "A_PLUS" }],
      error: null,
    });
    const result = await loadRacesInRange("athlete-1", "2026-09-08", "2026-09-14");
    expect(result).toEqual([{ eventName: "EDC Verbier", startDate: "2026-09-11", endDate: "2026-09-13", priority: "A_PLUS" }]);
  });

  it("L: throws a clean RaceOverlayLoadError (never the raw PostgREST message) on failure", async () => {
    mockRaceChain({ data: null, error: { code: "500", message: "internal error" } });
    await expect(loadRacesInRange("athlete-1", "2026-08-19", "2026-08-25")).rejects.toThrow(RaceOverlayLoadError);
    await expect(loadRacesInRange("athlete-1", "2026-08-19", "2026-08-25")).rejects.not.toThrow(/internal error/);
  });
});

describe("raceOverlayRepo.groupRacesByDate", () => {
  // Planning horizon fixture: today=2026-09-08 -> J+6=2026-09-14.
  const HORIZON = ["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14"];

  it("A: an event fully inside the horizon is displayed on its exact day", () => {
    const event: RaceOverlayEvent = { eventName: "Sortie club", startDate: "2026-09-10", endDate: "2026-09-10", priority: "C" };
    const byDate = groupRacesByDate([event], HORIZON);
    expect(byDate["2026-09-10"]).toEqual([event]);
    expect(byDate["2026-09-09"]).toEqual([]);
    expect(byDate["2026-09-11"]).toEqual([]);
  });

  it("B: an event entirely outside the horizon is not displayed on any horizon day", () => {
    const event: RaceOverlayEvent = { eventName: "Course lointaine", startDate: "2026-10-01", endDate: "2026-10-01", priority: "B" };
    const byDate = groupRacesByDate([event], HORIZON);
    for (const date of HORIZON) {
      expect(byDate[date]).toEqual([]);
    }
  });

  it("C: a multi-day event fully inside the horizon is displayed on every one of its canonical days", () => {
    // EDC Verbier: Friday/Saturday/Sunday.
    const verbier: RaceOverlayEvent = { eventName: "EDC Verbier", startDate: "2026-09-11", endDate: "2026-09-13", priority: "A_PLUS" };
    const byDate = groupRacesByDate([verbier], HORIZON);
    expect(byDate["2026-09-11"]).toEqual([verbier]);
    expect(byDate["2026-09-12"]).toEqual([verbier]);
    expect(byDate["2026-09-13"]).toEqual([verbier]);
    expect(byDate["2026-09-10"]).toEqual([]);
    expect(byDate["2026-09-14"]).toEqual([]);
  });

  it("D: an event starting before the horizon and overlapping it is visible only on the intersecting day(s)", () => {
    const event: RaceOverlayEvent = { eventName: "Course chevauchante début", startDate: "2026-09-05", endDate: "2026-09-09", priority: "B" };
    const byDate = groupRacesByDate([event], HORIZON);
    // 2026-09-05..07 are before the horizon (today=09-08) and never appear as keys at all.
    expect(byDate["2026-09-08"]).toEqual([event]);
    expect(byDate["2026-09-09"]).toEqual([event]);
    expect(byDate["2026-09-10"]).toEqual([]);
  });

  it("E: an event ending after the horizon is visible only through J+6", () => {
    const event: RaceOverlayEvent = { eventName: "Course chevauchante fin", startDate: "2026-09-13", endDate: "2026-09-20", priority: "B" };
    const byDate = groupRacesByDate([event], HORIZON);
    expect(byDate["2026-09-13"]).toEqual([event]);
    expect(byDate["2026-09-14"]).toEqual([event]);
    // The horizon itself only has 7 keys (today..J+6) — nothing beyond J+6 is ever produced.
    expect(Object.keys(byDate)).toHaveLength(7);
  });

  it("K: no events at all -> every horizon day maps to an empty array", () => {
    const byDate = groupRacesByDate([], HORIZON);
    for (const date of HORIZON) {
      expect(byDate[date]).toEqual([]);
    }
  });
});
