/**
 * V0.4_101 — unit coverage for athleteAvailabilityExceptionsRepo.ts (mocked
 * SupabaseClient, no network). See athleteAvailabilityExceptionsRepo.
 * integration.test.ts for the real-DB schema/RLS proof.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getAvailabilityExceptionsFor,
  upsertAvailabilityException,
  type AthleteAvailabilityExceptionRawRow,
} from "../../src/supabase/repositories/athleteAvailabilityExceptionsRepo.js";

interface MockResult {
  data: unknown;
  error: { message: string } | null;
}

function mockReadClient(result: MockResult): { client: SupabaseClient; eq: ReturnType<typeof vi.fn> } {
  const eq = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as unknown as SupabaseClient, eq };
}

function mockWriteClient(result: { error: { message: string } | null }): {
  client: SupabaseClient;
  upsert: ReturnType<typeof vi.fn>;
} {
  const upsert = vi.fn().mockResolvedValue(result);
  const from = vi.fn(() => ({ upsert }));
  return { client: { from } as unknown as SupabaseClient, upsert };
}

const ROWS: AthleteAvailabilityExceptionRawRow[] = [
  { id: "e1", date: "2026-10-03", available: false, note: "travel" },
  { id: "e2", date: "2026-10-10", available: true, note: null },
];

describe("getAvailabilityExceptionsFor", () => {
  it("returns every exception row for the athlete", async () => {
    const { client, eq } = mockReadClient({ data: ROWS, error: null });

    const result = await getAvailabilityExceptionsFor(client, "athlete-1");

    expect(result).toEqual(ROWS);
    expect(eq).toHaveBeenCalledWith("athlete_id", "athlete-1");
  });

  it("returns an empty array when the athlete has declared no exceptions — never an error", async () => {
    const { client } = mockReadClient({ data: [], error: null });

    const result = await getAvailabilityExceptionsFor(client, "athlete-2");

    expect(result).toEqual([]);
  });

  it("propagates a Supabase error instead of silently returning an empty array", async () => {
    const { client } = mockReadClient({ data: null, error: { message: "connection reset" } });

    await expect(getAvailabilityExceptionsFor(client, "athlete-3")).rejects.toThrow(/athlete_availability_exceptions/);
  });
});

describe("upsertAvailabilityException", () => {
  it("upserts the merged athlete_id + exception fields, conflict target (athlete_id, date)", async () => {
    const { client, upsert } = mockWriteClient({ error: null });

    await upsertAvailabilityException(client, "athlete-1", { date: "2026-10-03", available: false, note: "travel" });

    expect(upsert).toHaveBeenCalledWith(
      { athlete_id: "athlete-1", date: "2026-10-03", available: false, note: "travel" },
      { onConflict: "athlete_id,date" }
    );
  });

  it("propagates a Supabase error instead of resolving silently", async () => {
    const { client } = mockWriteClient({ error: { message: "constraint violation" } });

    await expect(upsertAvailabilityException(client, "athlete-1", { date: "2026-10-03", available: false })).rejects.toThrow(
      /athlete_availability_exceptions/
    );
  });
});
