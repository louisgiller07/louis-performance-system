import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getProjectedGeneratedSessionIdForDate } from "../../src/supabase/repositories/plannedSessionsRepo.js";

const ATHLETE_ID = "athlete-1";
const DATE = "2026-09-23";

interface CapturedQuery {
  table?: string;
  athleteId?: string;
  date?: string;
}

/**
 * Minimal fake Supabase client chain — same technique as
 * raceCalendarRepo.test.ts/trainingPlanPlannedPrescriptionsRepo.test.ts.
 * `getPlannedSessionFor` (untouched by this ticket) is not exercised here
 * — this file covers only the new V0.5_047/048 addition.
 */
function fakeClient(result: { data: unknown; error: { message: string } | null }, captured: CapturedQuery): SupabaseClient {
  return {
    from(table: string) {
      captured.table = table;
      return {
        select() {
          return {
            eq(column: string, value: string) {
              if (column === "athlete_id") captured.athleteId = value;
              if (column === "planned_date") captured.date = value;
              return {
                eq(column2: string, value2: string) {
                  if (column2 === "athlete_id") captured.athleteId = value2;
                  if (column2 === "planned_date") captured.date = value2;
                  return {
                    async maybeSingle() {
                      return result;
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe("getProjectedGeneratedSessionIdForDate — V0.5_047/048", () => {
  it("a generated/projected session returns its source_generated_session_id", async () => {
    const captured: CapturedQuery = {};
    const client = fakeClient({ data: { source_generated_session_id: "session-1" }, error: null }, captured);

    const result = await getProjectedGeneratedSessionIdForDate(client, ATHLETE_ID, DATE);

    expect(result).toBe("session-1");
  });

  it("a manual/legacy session (no lineage) returns null, never an error", async () => {
    const captured: CapturedQuery = {};
    const client = fakeClient({ data: { source_generated_session_id: null }, error: null }, captured);

    const result = await getProjectedGeneratedSessionIdForDate(client, ATHLETE_ID, DATE);

    expect(result).toBeNull();
  });

  it("no planned_sessions row at all for the date returns null", async () => {
    const captured: CapturedQuery = {};
    const client = fakeClient({ data: null, error: null }, captured);

    const result = await getProjectedGeneratedSessionIdForDate(client, ATHLETE_ID, DATE);

    expect(result).toBeNull();
  });

  it("a Supabase query failure propagates as a real Error", async () => {
    const captured: CapturedQuery = {};
    const client = fakeClient({ data: null, error: { message: "connection reset" } }, captured);

    await expect(getProjectedGeneratedSessionIdForDate(client, ATHLETE_ID, DATE)).rejects.toThrow(/connection reset/);
  });

  it("filters by exactly athlete_id and planned_date", async () => {
    const captured: CapturedQuery = {};
    const client = fakeClient({ data: null, error: null }, captured);

    await getProjectedGeneratedSessionIdForDate(client, ATHLETE_ID, DATE);

    expect(captured.table).toBe("planned_sessions");
    expect(captured.athleteId).toBe(ATHLETE_ID);
    expect(captured.date).toBe(DATE);
  });
});
