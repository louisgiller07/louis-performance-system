import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getProjectedGeneratedSessionIdForDate } from "../../src/supabase/repositories/plannedSessionsRepo.js";

const ATHLETE_ID = "athlete-1";
const DATE = "2026-09-23";

interface CapturedQuery {
  tables: string[];
  athleteId?: string;
  date?: string;
}

type Result = { data: unknown; error: { message: string } | null };

/**
 * Minimal fake Supabase client chain — same technique as
 * raceCalendarRepo.test.ts/trainingPlanPlannedPrescriptionsRepo.test.ts.
 * `getPlannedSessionFor` (untouched) is not exercised here. Each table gets its
 * own canned result: `planned_sessions` for the row, and
 * `training_plan_current_version` for the current-plan check (PILOT_022).
 */
function fakeClient(results: Record<string, Result>, captured: CapturedQuery): SupabaseClient {
  return {
    from(table: string) {
      captured.tables.push(table);
      const result = results[table] ?? { data: null, error: null };
      const chain = {
        eq(column: string, value: string) {
          if (table === "planned_sessions" && column === "athlete_id") captured.athleteId = value;
          if (column === "planned_date") captured.date = value;
          return chain;
        },
        async maybeSingle() {
          return result;
        },
      };
      return {
        select() {
          return chain;
        },
      };
    },
  } as unknown as SupabaseClient;
}

const CURRENT_VERSION: Result = { data: { plan_version_id: "version-B" }, error: null };

function plannedRow(overrides: Record<string, unknown>): Result {
  return {
    data: { source: "generated", source_plan_version_id: "version-B", source_generated_session_id: "session-1", ...overrides },
    error: null,
  };
}

describe("getProjectedGeneratedSessionIdForDate — V0.5_047/048", () => {
  it("a generated session of the current plan returns its source_generated_session_id", async () => {
    const captured: CapturedQuery = { tables: [] };
    const client = fakeClient({ planned_sessions: plannedRow({}), training_plan_current_version: CURRENT_VERSION }, captured);

    const result = await getProjectedGeneratedSessionIdForDate(client, ATHLETE_ID, DATE);

    expect(result).toBe("session-1");
  });

  it("a manual/legacy session (no lineage) returns null, never an error", async () => {
    const captured: CapturedQuery = { tables: [] };
    const client = fakeClient(
      { planned_sessions: plannedRow({ source: "manual", source_plan_version_id: null, source_generated_session_id: null }), training_plan_current_version: CURRENT_VERSION },
      captured
    );

    const result = await getProjectedGeneratedSessionIdForDate(client, ATHLETE_ID, DATE);

    expect(result).toBeNull();
  });

  it("no planned_sessions row at all for the date returns null", async () => {
    const captured: CapturedQuery = { tables: [] };
    const client = fakeClient({ planned_sessions: { data: null, error: null } }, captured);

    const result = await getProjectedGeneratedSessionIdForDate(client, ATHLETE_ID, DATE);

    expect(result).toBeNull();
  });

  it("a Supabase query failure propagates as a real Error", async () => {
    const captured: CapturedQuery = { tables: [] };
    const client = fakeClient({ planned_sessions: { data: null, error: { message: "connection reset" } } }, captured);

    await expect(getProjectedGeneratedSessionIdForDate(client, ATHLETE_ID, DATE)).rejects.toThrow(/connection reset/);
  });

  it("filters by exactly athlete_id and planned_date", async () => {
    const captured: CapturedQuery = { tables: [] };
    const client = fakeClient({ planned_sessions: { data: null, error: null } }, captured);

    await getProjectedGeneratedSessionIdForDate(client, ATHLETE_ID, DATE);

    expect(captured.tables[0]).toBe("planned_sessions");
    expect(captured.athleteId).toBe(ATHLETE_ID);
    expect(captured.date).toBe(DATE);
  });
});

// PILOT_022 (REV-02) — ownership decides, not the lineage columns a manual edit leaves behind.
describe("getProjectedGeneratedSessionIdForDate — ownership and current plan (PILOT_022)", () => {
  it("a MANUAL row that still carries a generated lineage (strength session manually changed to aerobic) returns null", async () => {
    const captured: CapturedQuery = { tables: [] };
    const client = fakeClient({ planned_sessions: plannedRow({ source: "manual" }), training_plan_current_version: CURRENT_VERSION }, captured);

    const result = await getProjectedGeneratedSessionIdForDate(client, ATHLETE_ID, DATE);

    expect(result).toBeNull();
  });

  it("a generated row left by a superseded plan version returns null", async () => {
    const captured: CapturedQuery = { tables: [] };
    const client = fakeClient(
      { planned_sessions: plannedRow({ source_plan_version_id: "version-A" }), training_plan_current_version: CURRENT_VERSION },
      captured
    );

    const result = await getProjectedGeneratedSessionIdForDate(client, ATHLETE_ID, DATE);

    expect(result).toBeNull();
  });

  it("a generated row when the athlete has no current plan returns null", async () => {
    const captured: CapturedQuery = { tables: [] };
    const client = fakeClient({ planned_sessions: plannedRow({}), training_plan_current_version: { data: null, error: null } }, captured);

    const result = await getProjectedGeneratedSessionIdForDate(client, ATHLETE_ID, DATE);

    expect(result).toBeNull();
  });
});
