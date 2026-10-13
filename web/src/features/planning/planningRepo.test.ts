import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  loadPlannedSessions,
  savePlannedSession,
  deletePlannedSession,
  InvalidPlannedInterventionError,
  PlanningLoadError,
  PlanningSaveError,
  PlanningDeleteError,
  PlanningDayLockedError,
} from "./planningRepo";

vi.mock("../../lib/supabase", () => ({
  supabase: { from: vi.fn() },
}));

import { supabase } from "../../lib/supabase";

const mockedFrom = supabase.from as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
});

/** P0-3 — every save / delete first reads the day's executions and completed sessions (day lock). */
function routePlanned(plannedTable: unknown, executions: unknown[] = [], completed: unknown[] = []) {
  mockedFrom.mockImplementation((table: string) => {
    if (table === "session_executions") return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: executions, error: null }) }) }) };
    if (table === "completed_sessions") return { select: () => ({ eq: () => ({ eq: () => ({ neq: () => ({ limit: () => Promise.resolve({ data: completed, error: null }) }) }) }) }) };
    return plannedTable;
  });
}

describe("planningRepo.loadPlannedSessions", () => {
  it("selects the minimal columns for the athlete's date range, ascending", async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const lte = vi.fn(() => ({ order }));
    const gte = vi.fn(() => ({ lte }));
    const eq = vi.fn(() => ({ gte }));
    const select = vi.fn(() => ({ eq }));
    mockedFrom.mockReturnValue({ select });

    const result = await loadPlannedSessions("athlete-1", "2026-08-01", "2026-08-31");

    expect(result).toEqual([]);
    expect(mockedFrom).toHaveBeenCalledWith("planned_sessions");
    expect(select).toHaveBeenCalledWith("planned_date, session_type, intervention, planned_intent, is_committed, source");
    expect(eq).toHaveBeenCalledWith("athlete_id", "athlete-1");
    expect(gte).toHaveBeenCalledWith("planned_date", "2026-08-01");
    expect(lte).toHaveBeenCalledWith("planned_date", "2026-08-31");
    expect(order).toHaveBeenCalledWith("planned_date", { ascending: true });
  });

  it("throws a clean PlanningLoadError (no raw DB error leaked) on failure", async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: { code: "500", message: "relation does not exist" } });
    mockedFrom.mockReturnValue({
      select: () => ({ eq: () => ({ gte: () => ({ lte: () => ({ order }) }) }) }),
    });

    await expect(loadPlannedSessions("athlete-1", "2026-08-01", "2026-08-31")).rejects.toThrow(PlanningLoadError);
  });
});

describe("planningRepo.savePlannedSession", () => {
  it("rejects RACE_ACTIVITY before ever calling the network", async () => {
    await expect(savePlannedSession("athlete-1", "2026-08-19", "RACE_ACTIVITY", null)).rejects.toThrow(
      InvalidPlannedInterventionError
    );
    expect(mockedFrom).not.toHaveBeenCalled();
  });

  it("rejects an invalid (kind, load_profile) pair before ever calling the network", async () => {
    await expect(savePlannedSession("athlete-1", "2026-08-19", "DH_TECHNICAL", null)).rejects.toThrow(
      InvalidPlannedInterventionError
    );
    expect(mockedFrom).not.toHaveBeenCalled();
  });

  it("upserts session_type/intervention/planned_intent(null)/source('manual') and omits the five inert columns", async () => {
    const savedRow = {
      planned_date: "2026-08-19",
      session_type: "DH_TECHNICAL",
      intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
      planned_intent: null,
    };
    const single = vi.fn().mockResolvedValue({ data: savedRow, error: null });
    const select = vi.fn(() => ({ single }));
    const upsert = vi.fn((_payload: Record<string, unknown>, _opts: { onConflict: string }) => ({ select }));
    routePlanned({ upsert });

    const result = await savePlannedSession("athlete-1", "2026-08-19", "DH_TECHNICAL", "MODERATE");

    expect(result).toEqual(savedRow);
    expect(upsert).toHaveBeenCalledWith(
      {
        athlete_id: "athlete-1",
        planned_date: "2026-08-19",
        session_type: "DH_TECHNICAL",
        intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
        planned_intent: null,
        source: "manual",
        is_committed: false,
        source_plan_version_id: null,
        source_generated_session_id: null,
      },
      { onConflict: "athlete_id,planned_date" }
    );
    const payload = upsert.mock.calls[0][0];
    for (const inertColumn of [
      "primary_objective",
      "planned_duration_min",
      "planned_time_of_day",
      "training_block_id",
      "notes",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(payload, inertColumn)).toBe(false);
    }
  });

  it("saves is_committed=true when explicitly requested (V0.3_005A)", async () => {
    const savedRow = {
      planned_date: "2026-08-19",
      session_type: "DH_TECHNICAL",
      intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
      planned_intent: null,
      is_committed: true,
    };
    const single = vi.fn().mockResolvedValue({ data: savedRow, error: null });
    const upsert = vi.fn((_payload: Record<string, unknown>) => ({ select: () => ({ single }) }));
    routePlanned({ upsert });

    await savePlannedSession("athlete-1", "2026-08-19", "DH_TECHNICAL", "MODERATE", true);

    const payload = upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.is_committed).toBe(true);
  });

  it("saves a fixed-load kind without a load_profile key in the intervention payload", async () => {
    const savedRow = {
      planned_date: "2026-08-19",
      session_type: "REST",
      intervention: { kind: "REST" },
      planned_intent: null,
    };
    const single = vi.fn().mockResolvedValue({ data: savedRow, error: null });
    const upsert = vi.fn((_payload: Record<string, unknown>) => ({ select: () => ({ single }) }));
    routePlanned({ upsert });

    await savePlannedSession("athlete-1", "2026-08-19", "REST", null);

    const payload = upsert.mock.calls[0][0];
    expect(payload.intervention).toEqual({ kind: "REST" });
    expect(Object.prototype.hasOwnProperty.call(payload.intervention as object, "load_profile")).toBe(false);
  });

  it("throws a clean PlanningSaveError (no raw DB error leaked) on failure", async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate key" } });
    routePlanned({ upsert: () => ({ select: () => ({ single }) }) });

    await expect(savePlannedSession("athlete-1", "2026-08-19", "REST", null)).rejects.toThrow(PlanningSaveError);
  });

  // V0.3_006C2 — planned DH duration wiring.
  describe("planned duration (V0.3_006C2)", () => {
    it("includes duration_min in the intervention payload for a DH kind with a valid preset duration", async () => {
      const savedRow = {
        planned_date: "2026-08-19",
        session_type: "DH_PERFORMANCE",
        intervention: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 120 },
        planned_intent: null,
      };
      const single = vi.fn().mockResolvedValue({ data: savedRow, error: null });
      const upsert = vi.fn((_payload: Record<string, unknown>) => ({ select: () => ({ single }) }));
      routePlanned({ upsert });

      await savePlannedSession("athlete-1", "2026-08-19", "DH_PERFORMANCE", "HEAVY", false, "120");

      const payload = upsert.mock.calls[0][0] as Record<string, unknown>;
      expect(payload.intervention).toEqual({ kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 120 });
      // planned_duration_min (the separate reserved column) stays dormant — never written.
      expect(Object.prototype.hasOwnProperty.call(payload, "planned_duration_min")).toBe(false);
    });

    it("omits duration_min entirely from the intervention payload when no duration is passed (default null)", async () => {
      const savedRow = {
        planned_date: "2026-08-19",
        session_type: "DH_PERFORMANCE",
        intervention: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
        planned_intent: null,
      };
      const single = vi.fn().mockResolvedValue({ data: savedRow, error: null });
      const upsert = vi.fn((_payload: Record<string, unknown>) => ({ select: () => ({ single }) }));
      routePlanned({ upsert });

      await savePlannedSession("athlete-1", "2026-08-19", "DH_PERFORMANCE", "HEAVY");

      const payload = upsert.mock.calls[0][0] as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(payload.intervention as object, "duration_min")).toBe(false);
    });

    // Reproduces §12 (DH → non-DH must never leave a stale duration_min):
    // the caller (PlanningDayCard) resets its own draft on any kind change,
    // but this proves the repo/validation boundary independently rejects a
    // duration passed alongside a non-DH kind, defense-in-depth.
    it("rejects a duration for a non-DH kind before ever calling the network", async () => {
      await expect(savePlannedSession("athlete-1", "2026-08-19", "STRENGTH_UPPER", "MODERATE", false, "120")).rejects.toThrow(
        InvalidPlannedInterventionError
      );
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it("rejects an out-of-preset duration value before ever calling the network", async () => {
      await expect(savePlannedSession("athlete-1", "2026-08-19", "DH_PERFORMANCE", "HEAVY", false, "47")).rejects.toThrow(
        InvalidPlannedInterventionError
      );
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it("rejects a non-numeric duration value before ever calling the network", async () => {
      await expect(
        savePlannedSession("athlete-1", "2026-08-19", "DH_PERFORMANCE", "HEAVY", false, "not-a-number")
      ).rejects.toThrow(InvalidPlannedInterventionError);
      expect(mockedFrom).not.toHaveBeenCalled();
    });
  });
});

describe("planningRepo.deletePlannedSession", () => {
  it("deletes by athlete_id + planned_date", async () => {
    const eq2 = vi.fn().mockResolvedValue({ error: null });
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const del = vi.fn(() => ({ eq: eq1 }));
    routePlanned({ delete: del });

    await deletePlannedSession("athlete-1", "2026-08-19");

    expect(mockedFrom).toHaveBeenCalledWith("planned_sessions");
    expect(eq1).toHaveBeenCalledWith("athlete_id", "athlete-1");
    expect(eq2).toHaveBeenCalledWith("planned_date", "2026-08-19");
  });

  it("throws a clean PlanningDeleteError (no raw DB error leaked) on failure", async () => {
    const eq2 = vi.fn().mockResolvedValue({ error: { code: "500", message: "boom" } });
    routePlanned({ delete: () => ({ eq: () => ({ eq: eq2 }) }) });

    await expect(deletePlannedSession("athlete-1", "2026-08-19")).rejects.toThrow(PlanningDeleteError);
  });
});

// P0-3 (HPM 2026-10-13) — a started or completed day is never replaced silently (same rules as record_session_execution).
describe("planningRepo — P0-3 day lock and lineage", () => {
  const upsertOk = () => {
    const upsert = vi.fn(() => ({ select: () => ({ single: vi.fn().mockResolvedValue({ data: {}, error: null }) }) }));
    return { upsert };
  };

  it("an execution started and not ended locks the day: no write", async () => {
    const table = upsertOk();
    routePlanned(table, [{ id: "e", execution_events: [{ event_type: "started" }] }]);
    await expect(savePlannedSession("athlete-1", "2026-10-13", "STRENGTH_UPPER", "MODERATE")).rejects.toThrow(PlanningDayLockedError);
    expect(table.upsert).not.toHaveBeenCalled();
  });

  it("a completed execution locks the day", async () => {
    const table = upsertOk();
    routePlanned(table, [{ id: "e", execution_events: [{ event_type: "started" }, { event_type: "completed" }] }]);
    await expect(savePlannedSession("athlete-1", "2026-10-13", "REST", null)).rejects.toThrow(PlanningDayLockedError);
    expect(table.upsert).not.toHaveBeenCalled();
  });

  it("a legacy completed session (not skipped) locks the day; removing the session is refused too", async () => {
    const del = vi.fn();
    routePlanned({ delete: del }, [], [{ id: "c" }]);
    await expect(deletePlannedSession("athlete-1", "2026-10-13")).rejects.toThrow(PlanningDayLockedError);
    expect(del).not.toHaveBeenCalled();
  });

  it("an abandoned execution does not lock the day (a restart is allowed, like the RPC)", async () => {
    const table = upsertOk();
    routePlanned(table, [{ id: "e", execution_events: [{ event_type: "started" }, { event_type: "abandoned" }] }]);
    await savePlannedSession("athlete-1", "2026-10-13", "STRENGTH_UPPER", "MODERATE");
    expect(table.upsert).toHaveBeenCalledTimes(1);
  });

  it("F3 — a manual write clears the generated lineage it replaces", async () => {
    const table = upsertOk();
    routePlanned(table);
    await savePlannedSession("athlete-1", "2026-10-13", "STRENGTH_UPPER", "MODERATE");
    const payload = (table.upsert.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect([payload.source, payload.source_plan_version_id, payload.source_generated_session_id]).toEqual(["manual", null, null]);
  });

  it("a write that loses a race (session started meanwhile) is refused by the server lock (NX201): same PlanningDayLockedError, save and delete", async () => {
    const locked = { code: "NX201", message: "planned_session_day_locked", details: "2026-10-13" };
    routePlanned({ upsert: () => ({ select: () => ({ single: vi.fn().mockResolvedValue({ data: null, error: locked }) }) }) });
    await expect(savePlannedSession("athlete-1", "2026-10-13", "STRENGTH_UPPER", "MODERATE")).rejects.toThrow(PlanningDayLockedError);
    routePlanned({ delete: () => ({ eq: () => ({ eq: vi.fn().mockResolvedValue({ error: locked }) }) }) });
    await expect(deletePlannedSession("athlete-1", "2026-10-13")).rejects.toThrow(PlanningDayLockedError);
  });
});
