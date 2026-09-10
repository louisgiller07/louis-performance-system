import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  loadDecisionHistory,
  loadDecisionById,
  loadLatestDecisionForDate,
  loadValidDecisionsForDate,
  loadCompletedSessionsForDates,
  HistoryLoadError,
  TodayDecisionLoadError,
} from "./historyRepo";

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

describe("historyRepo.loadLatestDecisionForDate (NAL-003)", () => {
  // A minimal but fully isValidDailyPlan-passing shape — every field the
  // real validator (dailyPlanValidation.ts) actually checks.
  function validDailyPlan(reasoning: string) {
    return {
      decision: "KEEP",
      confidence: "MEDIUM",
      reasoning,
      active_mode: "IN_SEASON",
      training: { active: true },
      dh_or_technical: { active: false },
      mental: { active: false },
      recovery: { active: true, actions: [] },
      nutrition: { active: false },
      sleep: { active: false },
      protection: { do_not_do: [] },
      monitoring: { observe: [] },
      triggered_rules: [],
      planned_session_before: null,
      final_session: { kind: "REST" },
      overrode_race_protocol: false,
      engine_version: "test",
    };
  }

  function dbRow(id: string, createdAt: string, dailyPlan: unknown) {
    return {
      id,
      decision_date: "2026-08-19",
      created_at: createdAt,
      final_session: "REST",
      active_mode: "IN_SEASON",
      confidence_level: "MEDIUM",
      daily_plan: dailyPlan,
    };
  }

  function mockLatestChain(result: { data: unknown; error: unknown }) {
    const order = vi.fn().mockResolvedValue(result);
    const eq2 = vi.fn(() => ({ order }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const select = vi.fn(() => ({ eq: eq1 }));
    mockedFrom.mockReturnValue({ select });
    return { eq1, eq2, order };
  }

  it("F: filters by athlete_id and exactly decision_date — a previous day's decision is never returned for today", async () => {
    const { eq1, eq2 } = mockLatestChain({ data: [], error: null });
    await loadLatestDecisionForDate("athlete-1", "2026-08-19");
    expect(eq1).toHaveBeenCalledWith("athlete_id", "athlete-1");
    expect(eq2).toHaveBeenCalledWith("decision_date", "2026-08-19");
  });

  it("orders by created_at descending, with no server-side LIMIT — every same-day row must be considered for validity", async () => {
    const { order } = mockLatestChain({ data: [], error: null });
    await loadLatestDecisionForDate("athlete-1", "2026-08-19");
    expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("A: returns null when no decision exists for that date (RLS-filtered absence, not an error)", async () => {
    mockLatestChain({ data: [], error: null });
    const result = await loadLatestDecisionForDate("athlete-1", "2026-08-19");
    expect(result).toBeNull();
  });

  it("B: a single valid decision is returned, mapped", async () => {
    const row = dbRow("d-1", "2026-08-19T18:42:00Z", validDailyPlan("Plan du jour."));
    mockLatestChain({ data: [row], error: null });

    const result = await loadLatestDecisionForDate("athlete-1", "2026-08-19");

    expect(result).toEqual({
      id: "d-1",
      decisionDate: "2026-08-19",
      createdAt: "2026-08-19T18:42:00Z",
      finalSessionDb: "REST",
      activeModeDb: "IN_SEASON",
      confidenceLevelDb: "MEDIUM",
      dailyPlan: validDailyPlan("Plan du jour."),
    });
  });

  // --- Latest VALID decision selection (the fix) ---

  it("newest row invalid + older row valid -> the older valid decision is restored, never the newer invalid one", async () => {
    const newerInvalid = dbRow("d-newer-invalid", "2026-08-19T18:05:00Z", { decision: "NOT_A_REAL_SHAPE" });
    const olderValid = dbRow("d-older-valid", "2026-08-19T18:00:00Z", validDailyPlan("18:00 plan."));
    // Server returns newest-first, exactly as the real ORDER BY created_at DESC would.
    mockLatestChain({ data: [newerInvalid, olderValid], error: null });

    const result = await loadLatestDecisionForDate("athlete-1", "2026-08-19");

    expect(result?.id).toBe("d-older-valid");
    expect(result?.dailyPlan).toEqual(validDailyPlan("18:00 plan."));
  });

  it("newest row valid + older row also valid -> the newest valid decision wins", async () => {
    const newerValid = dbRow("d-newer-valid", "2026-08-19T18:05:00Z", validDailyPlan("18:05 plan."));
    const olderValid = dbRow("d-older-valid", "2026-08-19T18:00:00Z", validDailyPlan("18:00 plan."));
    mockLatestChain({ data: [newerValid, olderValid], error: null });

    const result = await loadLatestDecisionForDate("athlete-1", "2026-08-19");

    expect(result?.id).toBe("d-newer-valid");
  });

  it("every same-day row invalid -> null (normal generation state), never a malformed row surfaced", async () => {
    const invalidA = dbRow("d-invalid-a", "2026-08-19T18:05:00Z", { decision: "NOT_A_REAL_SHAPE" });
    const invalidB = dbRow("d-invalid-b", "2026-08-19T08:00:00Z", null);
    mockLatestChain({ data: [invalidA, invalidB], error: null });

    const result = await loadLatestDecisionForDate("athlete-1", "2026-08-19");

    expect(result).toBeNull();
  });

  it("H: throws a clean TodayDecisionLoadError (never HistoryLoadError, never the raw PostgREST message) on failure", async () => {
    mockLatestChain({ data: null, error: { code: "500", message: "internal error" } });
    await expect(loadLatestDecisionForDate("athlete-1", "2026-08-19")).rejects.toThrow(TodayDecisionLoadError);
    await expect(loadLatestDecisionForDate("athlete-1", "2026-08-19")).rejects.not.toThrow(/internal error/);
  });
});

// V0.3_007B — decision-linkage disambiguation for completed sessions.
describe("historyRepo.loadValidDecisionsForDate (V0.3_007B)", () => {
  function validDailyPlan(reasoning: string) {
    return {
      decision: "KEEP",
      confidence: "MEDIUM",
      reasoning,
      active_mode: "IN_SEASON",
      training: { active: true },
      dh_or_technical: { active: false },
      mental: { active: false },
      recovery: { active: true, actions: [] },
      nutrition: { active: false },
      sleep: { active: false },
      protection: { do_not_do: [] },
      monitoring: { observe: [] },
      triggered_rules: [],
      planned_session_before: null,
      final_session: { kind: "REST" },
      overrode_race_protocol: false,
      engine_version: "test",
    };
  }

  function dbRow(id: string, createdAt: string, dailyPlan: unknown) {
    return {
      id,
      decision_date: "2026-08-19",
      created_at: createdAt,
      final_session: "REST",
      active_mode: "IN_SEASON",
      confidence_level: "MEDIUM",
      daily_plan: dailyPlan,
    };
  }

  function mockChain(result: { data: unknown; error: unknown }) {
    const order = vi.fn().mockResolvedValue(result);
    const eq2 = vi.fn(() => ({ order }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const select = vi.fn(() => ({ eq: eq1 }));
    mockedFrom.mockReturnValue({ select });
    return { eq1, eq2, order };
  }

  it("filters by athlete_id and exactly decision_date", async () => {
    const { eq1, eq2 } = mockChain({ data: [], error: null });
    await loadValidDecisionsForDate("athlete-1", "2026-08-19");
    expect(eq1).toHaveBeenCalledWith("athlete_id", "athlete-1");
    expect(eq2).toHaveBeenCalledWith("decision_date", "2026-08-19");
  });

  it("orders by created_at ascending (chronological, earliest first)", async () => {
    const { order } = mockChain({ data: [], error: null });
    await loadValidDecisionsForDate("athlete-1", "2026-08-19");
    expect(order).toHaveBeenCalledWith("created_at", { ascending: true });
  });

  it("0 valid decisions -> empty array, never null, never an error", async () => {
    mockChain({ data: [], error: null });
    const result = await loadValidDecisionsForDate("athlete-1", "2026-08-19");
    expect(result).toEqual([]);
  });

  it("1 valid decision -> array of exactly that one, mapped", async () => {
    const row = dbRow("d-1", "2026-08-19T10:05:00Z", validDailyPlan("Plan A."));
    mockChain({ data: [row], error: null });

    const result = await loadValidDecisionsForDate("athlete-1", "2026-08-19");

    expect(result).toEqual([
      {
        id: "d-1",
        decisionDate: "2026-08-19",
        createdAt: "2026-08-19T10:05:00Z",
        finalSessionDb: "REST",
        activeModeDb: "IN_SEASON",
        confidenceLevelDb: "MEDIUM",
        dailyPlan: validDailyPlan("Plan A."),
      },
    ]);
  });

  it("2+ valid decisions -> all returned, in the server's (ascending) order, never collapsed to one", async () => {
    const first = dbRow("d-a", "2026-08-19T10:05:00Z", validDailyPlan("Plan A."));
    const second = dbRow("d-b", "2026-08-19T14:30:00Z", validDailyPlan("Plan B."));
    mockChain({ data: [first, second], error: null });

    const result = await loadValidDecisionsForDate("athlete-1", "2026-08-19");

    expect(result.map((r) => r.id)).toEqual(["d-a", "d-b"]);
  });

  it("an invalid/malformed same-day row is silently excluded, never surfaced as a selectable option", async () => {
    const valid = dbRow("d-valid", "2026-08-19T10:05:00Z", validDailyPlan("Plan A."));
    const invalid = dbRow("d-invalid", "2026-08-19T14:30:00Z", { decision: "NOT_A_REAL_SHAPE" });
    mockChain({ data: [valid, invalid], error: null });

    const result = await loadValidDecisionsForDate("athlete-1", "2026-08-19");

    expect(result.map((r) => r.id)).toEqual(["d-valid"]);
  });

  it("throws a clean TodayDecisionLoadError (never the raw PostgREST message) on failure", async () => {
    mockChain({ data: null, error: { code: "500", message: "internal error" } });
    await expect(loadValidDecisionsForDate("athlete-1", "2026-08-19")).rejects.toThrow(TodayDecisionLoadError);
    await expect(loadValidDecisionsForDate("athlete-1", "2026-08-19")).rejects.not.toThrow(/internal error/);
  });
});

// V0.3_007D — History: Prescribed vs Performed. Direct RLS SELECT on
// completed_sessions, never the completed-session Edge Function (single-
// date only, not batch-shaped) and never service_role — the exact same
// direct-table-read convention as decisions above.
describe("historyRepo.loadCompletedSessionsForDates (V0.3_007D)", () => {
  function mockCompletedChain(result: { data: unknown; error: unknown }) {
    const inFn = vi.fn().mockResolvedValue(result);
    const eq = vi.fn(() => ({ in: inFn }));
    const select = vi.fn(() => ({ eq }));
    mockedFrom.mockReturnValue({ select });
    return { select, eq, in: inFn };
  }

  function completedSessionRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "cs-1",
      session_date: "2026-08-19",
      decision_id: "d-1",
      session_type: "DH_TECHNICAL",
      completion_status: "done",
      actual_duration_min: 120,
      rpe: 7,
      post_leg_fatigue: 5,
      post_grip_fatigue: 4,
      new_pain: false,
      new_pain_note: null,
      intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
      main_content: null,
      session_load: 84,
      updated_at: "2026-08-19T20:00:00Z",
      technical_outcome: "yes",
      change_reason: null,
      change_reason_note: null,
      ...overrides,
    };
  }

  it("reads completed_sessions directly (never the completed-session Edge Function)", async () => {
    mockCompletedChain({ data: [], error: null });
    await loadCompletedSessionsForDates("athlete-1", ["2026-08-19"]);
    expect(mockedFrom).toHaveBeenCalledWith("completed_sessions");
  });

  it("filters by athlete_id", async () => {
    const { eq } = mockCompletedChain({ data: [], error: null });
    await loadCompletedSessionsForDates("athlete-1", ["2026-08-19"]);
    expect(eq).toHaveBeenCalledWith("athlete_id", "athlete-1");
  });

  it("filters session_date via .in() against the exact requested dates — never a continuous min/max range", async () => {
    const { in: inFn } = mockCompletedChain({ data: [], error: null });
    await loadCompletedSessionsForDates("athlete-1", ["2026-08-19", "2026-08-20"]);
    expect(inFn).toHaveBeenCalledWith("session_date", ["2026-08-19", "2026-08-20"]);
  });

  it("deduplicates the requested dates before querying — several same-day decisions never inflate the .in() list", async () => {
    const { in: inFn } = mockCompletedChain({ data: [], error: null });
    await loadCompletedSessionsForDates("athlete-1", ["2026-08-19", "2026-08-19", "2026-08-20", "2026-08-19"]);
    expect(inFn).toHaveBeenCalledWith("session_date", ["2026-08-19", "2026-08-20"]);
  });

  it("empty dates array -> [] with NO query issued at all (no wasted round-trip)", async () => {
    const result = await loadCompletedSessionsForDates("athlete-1", []);
    expect(result).toEqual([]);
    expect(mockedFrom).not.toHaveBeenCalled();
  });

  it("issues exactly ONE query regardless of how many dates are requested — no N+1", async () => {
    mockCompletedChain({ data: [], error: null });
    await loadCompletedSessionsForDates("athlete-1", ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"]);
    expect(mockedFrom).toHaveBeenCalledTimes(1);
  });

  it("returns every matching row, including a free/unlinked one (decision_id null) and one belonging to a different decision — no filtering by decision_id at this layer", async () => {
    const linked = completedSessionRow({ id: "cs-linked", session_date: "2026-08-19", decision_id: "d-1" });
    const free = completedSessionRow({ id: "cs-free", session_date: "2026-08-20", decision_id: null });
    const otherDecision = completedSessionRow({ id: "cs-other", session_date: "2026-08-21", decision_id: "d-999" });
    mockCompletedChain({ data: [linked, free, otherDecision], error: null });

    const result = await loadCompletedSessionsForDates("athlete-1", ["2026-08-19", "2026-08-20", "2026-08-21"]);

    expect(result.map((r) => r.id)).toEqual(["cs-linked", "cs-free", "cs-other"]);
  });

  it("throws a clean HistoryLoadError (never the raw PostgREST message) on failure", async () => {
    mockCompletedChain({ data: null, error: { code: "42501", message: "permission denied for table completed_sessions" } });
    await expect(loadCompletedSessionsForDates("athlete-1", ["2026-08-19"])).rejects.toThrow(HistoryLoadError);
    await expect(loadCompletedSessionsForDates("athlete-1", ["2026-08-19"])).rejects.not.toThrow(/permission denied/);
  });
});
