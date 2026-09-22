/**
 * V0.4_101 — unit coverage for athleteLockedDatesRepo.ts (mocked
 * SupabaseClient, no network). See athleteLockedDatesRepo.integration.test.ts
 * for the real-DB schema/RLS proof.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getLockedDatesFor,
  upsertLockedDate,
  type AthleteLockedDateRawRow,
} from "../../src/supabase/repositories/athleteLockedDatesRepo.js";

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

const ROWS: AthleteLockedDateRawRow[] = [
  { id: "l1", date: "2026-11-01", reason: "coach-reserved rest day" },
  { id: "l2", date: "2026-11-08", reason: null },
];

describe("getLockedDatesFor", () => {
  it("returns every locked-date row for the athlete", async () => {
    const { client, eq } = mockReadClient({ data: ROWS, error: null });

    const result = await getLockedDatesFor(client, "athlete-1");

    expect(result).toEqual(ROWS);
    expect(eq).toHaveBeenCalledWith("athlete_id", "athlete-1");
  });

  it("returns an empty array when the athlete has declared no locked dates — never an error", async () => {
    const { client } = mockReadClient({ data: [], error: null });

    const result = await getLockedDatesFor(client, "athlete-2");

    expect(result).toEqual([]);
  });

  it("propagates a Supabase error instead of silently returning an empty array", async () => {
    const { client } = mockReadClient({ data: null, error: { message: "connection reset" } });

    await expect(getLockedDatesFor(client, "athlete-3")).rejects.toThrow(/athlete_locked_dates/);
  });
});

describe("upsertLockedDate", () => {
  it("upserts the merged athlete_id + locked-date fields, conflict target (athlete_id, date)", async () => {
    const { client, upsert } = mockWriteClient({ error: null });

    await upsertLockedDate(client, "athlete-1", { date: "2026-11-01", reason: "coach-reserved rest day" });

    expect(upsert).toHaveBeenCalledWith(
      { athlete_id: "athlete-1", date: "2026-11-01", reason: "coach-reserved rest day" },
      { onConflict: "athlete_id,date" }
    );
  });

  it("propagates a Supabase error instead of resolving silently", async () => {
    const { client } = mockWriteClient({ error: { message: "constraint violation" } });

    await expect(upsertLockedDate(client, "athlete-1", { date: "2026-11-01" })).rejects.toThrow(/athlete_locked_dates/);
  });
});
