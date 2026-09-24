import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlannedPrescriptionForGeneratedSession } from "../../src/supabase/repositories/trainingPlanPlannedPrescriptionsRepo.js";

interface CapturedQuery {
  table?: string;
  eqColumn?: string;
  eqValue?: string;
}

/**
 * Minimal fake Supabase client chain — same technique as
 * raceCalendarRepo.test.ts (V0.5_042): captures the exact `.eq()` argument
 * issued, and resolves `.maybeSingle()` with caller-supplied data/error.
 */
function fakeClient(result: { data: unknown; error: { message: string } | null }, captured: CapturedQuery): SupabaseClient {
  return {
    from(table: string) {
      captured.table = table;
      return {
        select() {
          return {
            eq(column: string, value: string) {
              captured.eqColumn = column;
              captured.eqValue = value;
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
  } as unknown as SupabaseClient;
}

const RAW_ROW = {
  id: "prescription-1",
  generated_plan_session_id: "session-1",
  schema_version: "v1",
  catalog_version: "v1",
  structure: { domain: "strength", schemaVersion: "v1", blocks: [] },
};

describe("getPlannedPrescriptionForGeneratedSession — V0.5_047/048", () => {
  it("found: maps the row into a PlannedPrescription", async () => {
    const captured: CapturedQuery = {};
    const client = fakeClient({ data: RAW_ROW, error: null }, captured);

    const result = await getPlannedPrescriptionForGeneratedSession(client, "session-1");

    expect(result).toEqual({
      id: "prescription-1",
      generatedPlanSessionId: "session-1",
      schemaVersion: "v1",
      catalogVersion: "v1",
      structure: { domain: "strength", schemaVersion: "v1", blocks: [] },
    });
  });

  it("missing: no row -> null", async () => {
    const captured: CapturedQuery = {};
    const client = fakeClient({ data: null, error: null }, captured);

    const result = await getPlannedPrescriptionForGeneratedSession(client, "session-without-prescription");

    expect(result).toBeNull();
  });

  it("Supabase error propagates as a real Error, never silently returns null", async () => {
    const captured: CapturedQuery = {};
    const client = fakeClient({ data: null, error: { message: "connection reset" } }, captured);

    await expect(getPlannedPrescriptionForGeneratedSession(client, "session-1")).rejects.toThrow(/connection reset/);
  });

  it("filters by exactly generated_plan_session_id, never by date or plan version", async () => {
    const captured: CapturedQuery = {};
    const client = fakeClient({ data: null, error: null }, captured);

    await getPlannedPrescriptionForGeneratedSession(client, "session-42");

    expect(captured.table).toBe("training_plan_planned_prescriptions");
    expect(captured.eqColumn).toBe("generated_plan_session_id");
    expect(captured.eqValue).toBe("session-42");
  });
});
