import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  loadPlannedSessions,
  savePlannedSession,
  deletePlannedSession,
  InvalidPlannedInterventionError,
  PlanningLoadError,
  PlanningSaveError,
  PlanningDeleteError,
} from "./planningRepo";

vi.mock("../../lib/supabase", () => ({
  supabase: { from: vi.fn() },
}));

import { supabase } from "../../lib/supabase";

const mockedFrom = supabase.from as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
});

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
    expect(select).toHaveBeenCalledWith("planned_date, session_type, intervention, planned_intent");
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
    mockedFrom.mockReturnValue({ upsert });

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

  it("saves a fixed-load kind without a load_profile key in the intervention payload", async () => {
    const savedRow = {
      planned_date: "2026-08-19",
      session_type: "REST",
      intervention: { kind: "REST" },
      planned_intent: null,
    };
    const single = vi.fn().mockResolvedValue({ data: savedRow, error: null });
    const upsert = vi.fn((_payload: Record<string, unknown>) => ({ select: () => ({ single }) }));
    mockedFrom.mockReturnValue({ upsert });

    await savePlannedSession("athlete-1", "2026-08-19", "REST", null);

    const payload = upsert.mock.calls[0][0];
    expect(payload.intervention).toEqual({ kind: "REST" });
    expect(Object.prototype.hasOwnProperty.call(payload.intervention as object, "load_profile")).toBe(false);
  });

  it("throws a clean PlanningSaveError (no raw DB error leaked) on failure", async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate key" } });
    mockedFrom.mockReturnValue({ upsert: () => ({ select: () => ({ single }) }) });

    await expect(savePlannedSession("athlete-1", "2026-08-19", "REST", null)).rejects.toThrow(PlanningSaveError);
  });
});

describe("planningRepo.deletePlannedSession", () => {
  it("deletes by athlete_id + planned_date", async () => {
    const eq2 = vi.fn().mockResolvedValue({ error: null });
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const del = vi.fn(() => ({ eq: eq1 }));
    mockedFrom.mockReturnValue({ delete: del });

    await deletePlannedSession("athlete-1", "2026-08-19");

    expect(mockedFrom).toHaveBeenCalledWith("planned_sessions");
    expect(eq1).toHaveBeenCalledWith("athlete_id", "athlete-1");
    expect(eq2).toHaveBeenCalledWith("planned_date", "2026-08-19");
  });

  it("throws a clean PlanningDeleteError (no raw DB error leaked) on failure", async () => {
    const eq2 = vi.fn().mockResolvedValue({ error: { code: "500", message: "boom" } });
    mockedFrom.mockReturnValue({ delete: () => ({ eq: () => ({ eq: eq2 }) }) });

    await expect(deletePlannedSession("athlete-1", "2026-08-19")).rejects.toThrow(PlanningDeleteError);
  });
});
