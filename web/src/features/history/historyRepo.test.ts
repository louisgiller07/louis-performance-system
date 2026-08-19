import { describe, expect, it, vi, beforeEach } from "vitest";
import { loadDecisionHistory, loadDecisionById, HistoryLoadError } from "./historyRepo";

vi.mock("../../lib/supabase", () => ({
  supabase: { from: vi.fn() },
}));

import { supabase } from "../../lib/supabase";

const mockedFrom = supabase.from as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
});

function mockHistoryChain(result: { data: unknown; error: unknown }) {
  const limit = vi.fn().mockResolvedValue(result);
  const order2 = vi.fn(() => ({ limit }));
  const order1 = vi.fn(() => ({ order: order2 }));
  const eq = vi.fn(() => ({ order: order1 }));
  const select = vi.fn(() => ({ eq }));
  mockedFrom.mockReturnValue({ select });
  return { select, eq, order1, order2, limit };
}

describe("historyRepo.loadDecisionHistory", () => {
  it("reads via the caller's own Supabase client only (no service role) — the mocked module never exposes anything but the RLS-scoped client", async () => {
    mockHistoryChain({ data: [], error: null });
    await loadDecisionHistory("athlete-1");
    expect(mockedFrom).toHaveBeenCalledWith("decisions");
  });

  it("filters to the caller's own athlete_id as a UX-level filter on top of RLS", async () => {
    const { eq } = mockHistoryChain({ data: [], error: null });
    await loadDecisionHistory("athlete-1");
    expect(eq).toHaveBeenCalledWith("athlete_id", "athlete-1");
  });

  it("orders by the real decision_date and created_at columns, both descending", async () => {
    const { order1, order2 } = mockHistoryChain({ data: [], error: null });
    await loadDecisionHistory("athlete-1");
    expect(order1).toHaveBeenCalledWith("decision_date", { ascending: false });
    expect(order2).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("defaults to a limit of 30 decisions, not 30 days", async () => {
    const { limit } = mockHistoryChain({ data: [], error: null });
    await loadDecisionHistory("athlete-1");
    expect(limit).toHaveBeenCalledWith(30);
  });

  it("honors an explicit limit override", async () => {
    const { limit } = mockHistoryChain({ data: [], error: null });
    await loadDecisionHistory("athlete-1", 5);
    expect(limit).toHaveBeenCalledWith(5);
  });

  it("returns multiple same-day decisions distinctly — no map[date] dedup", async () => {
    const rowA = {
      id: "d-1",
      decision_date: "2026-08-19",
      created_at: "2026-08-19T08:00:00Z",
      final_session: "REST",
      active_mode: "IN_SEASON",
      confidence_level: "MEDIUM",
      daily_plan: {},
    };
    const rowB = {
      id: "d-2",
      decision_date: "2026-08-19",
      created_at: "2026-08-19T18:42:00Z",
      final_session: "RECOVERY",
      active_mode: "IN_SEASON",
      confidence_level: "LOW",
      daily_plan: {},
    };
    mockHistoryChain({ data: [rowB, rowA], error: null });

    const result = await loadDecisionHistory("athlete-1");

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(["d-2", "d-1"]);
  });

  it("maps DB rows to camelCase without inventing any field", async () => {
    const row = {
      id: "d-1",
      decision_date: "2026-08-19",
      created_at: "2026-08-19T08:00:00Z",
      final_session: "REST",
      active_mode: "IN_SEASON",
      confidence_level: "MEDIUM",
      daily_plan: { decision: "REST" },
    };
    mockHistoryChain({ data: [row], error: null });

    const result = await loadDecisionHistory("athlete-1");

    expect(result).toEqual([
      {
        id: "d-1",
        decisionDate: "2026-08-19",
        createdAt: "2026-08-19T08:00:00Z",
        finalSessionDb: "REST",
        activeModeDb: "IN_SEASON",
        confidenceLevelDb: "MEDIUM",
        dailyPlan: { decision: "REST" },
      },
    ]);
  });

  it("maps a pre-M2 legacy row's null active_mode/confidence_level as null, never fabricated", async () => {
    const row = {
      id: "d-0",
      decision_date: "2026-08-01",
      created_at: "2026-08-01T08:00:00Z",
      final_session: "REST",
      active_mode: null,
      confidence_level: null,
      daily_plan: null,
    };
    mockHistoryChain({ data: [row], error: null });

    const result = await loadDecisionHistory("athlete-1");

    expect(result[0].activeModeDb).toBeNull();
    expect(result[0].confidenceLevelDb).toBeNull();
  });

  it("throws a clean HistoryLoadError (no raw PostgREST message leaked) on failure", async () => {
    mockHistoryChain({ data: null, error: { code: "42501", message: "permission denied for table decisions" } });

    await expect(loadDecisionHistory("athlete-1")).rejects.toThrow(HistoryLoadError);
    await expect(loadDecisionHistory("athlete-1")).rejects.not.toThrow(/permission denied/);
  });
});

describe("historyRepo.loadDecisionById", () => {
  function mockDetailChain(result: { data: unknown; error: unknown }) {
    const maybeSingle = vi.fn().mockResolvedValue(result);
    const eq2 = vi.fn(() => ({ maybeSingle }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const select = vi.fn(() => ({ eq: eq1 }));
    mockedFrom.mockReturnValue({ select });
    return { eq1, eq2 };
  }

  it("filters by athlete_id and id — RLS remains the real security boundary either way", async () => {
    const { eq1, eq2 } = mockDetailChain({ data: null, error: null });
    await loadDecisionById("athlete-1", "decision-1");
    expect(eq1).toHaveBeenCalledWith("athlete_id", "athlete-1");
    expect(eq2).toHaveBeenCalledWith("id", "decision-1");
  });

  it("returns null when no matching row is found (not owned, or doesn't exist)", async () => {
    mockDetailChain({ data: null, error: null });
    const result = await loadDecisionById("athlete-1", "decision-1");
    expect(result).toBeNull();
  });

  it("returns the mapped row when found", async () => {
    const row = {
      id: "d-1",
      decision_date: "2026-08-19",
      created_at: "2026-08-19T08:00:00Z",
      final_session: "REST",
      active_mode: "IN_SEASON",
      confidence_level: "MEDIUM",
      daily_plan: { decision: "REST" },
    };
    mockDetailChain({ data: row, error: null });

    const result = await loadDecisionById("athlete-1", "d-1");

    expect(result).toEqual({
      id: "d-1",
      decisionDate: "2026-08-19",
      createdAt: "2026-08-19T08:00:00Z",
      finalSessionDb: "REST",
      activeModeDb: "IN_SEASON",
      confidenceLevelDb: "MEDIUM",
      dailyPlan: { decision: "REST" },
    });
  });

  it("throws a clean HistoryLoadError on failure", async () => {
    mockDetailChain({ data: null, error: { code: "500", message: "internal error" } });
    await expect(loadDecisionById("athlete-1", "d-1")).rejects.toThrow(HistoryLoadError);
  });
});
