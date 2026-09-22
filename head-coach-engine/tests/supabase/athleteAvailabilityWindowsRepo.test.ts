/**
 * V0.4_101 — unit coverage for athleteAvailabilityWindowsRepo.ts (mocked
 * SupabaseClient, no network). See athleteAvailabilityWindowsRepo.
 * integration.test.ts for the real-DB schema/RLS proof.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getAvailabilityWindowsFor,
  insertAvailabilityWindow,
  type AthleteAvailabilityWindowRawRow,
} from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";

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
  insert: ReturnType<typeof vi.fn>;
} {
  const insert = vi.fn().mockResolvedValue(result);
  const from = vi.fn(() => ({ insert }));
  return { client: { from } as unknown as SupabaseClient, insert };
}

const ROWS: AthleteAvailabilityWindowRawRow[] = [
  { id: "w1", day_of_week: 2, start_time: "17:00:00", end_time: "19:00:00", label: "Tuesday evening" },
  { id: "w2", day_of_week: 6, start_time: "09:00:00", end_time: "17:00:00", label: null },
];

describe("getAvailabilityWindowsFor", () => {
  it("returns every window row for the athlete", async () => {
    const { client, eq } = mockReadClient({ data: ROWS, error: null });

    const result = await getAvailabilityWindowsFor(client, "athlete-1");

    expect(result).toEqual(ROWS);
    expect(eq).toHaveBeenCalledWith("athlete_id", "athlete-1");
  });

  it("returns an empty array when the athlete has declared no windows — never an error", async () => {
    const { client } = mockReadClient({ data: [], error: null });

    const result = await getAvailabilityWindowsFor(client, "athlete-2");

    expect(result).toEqual([]);
  });

  it("returns an empty array when data is null, never throws on that alone", async () => {
    const { client } = mockReadClient({ data: null, error: null });

    const result = await getAvailabilityWindowsFor(client, "athlete-3");

    expect(result).toEqual([]);
  });

  it("propagates a Supabase error instead of silently returning an empty array", async () => {
    const { client } = mockReadClient({ data: null, error: { message: "connection reset" } });

    await expect(getAvailabilityWindowsFor(client, "athlete-4")).rejects.toThrow(/athlete_availability_windows/);
  });
});

describe("insertAvailabilityWindow", () => {
  it("inserts the merged athlete_id + window fields", async () => {
    const { client, insert } = mockWriteClient({ error: null });

    await insertAvailabilityWindow(client, "athlete-1", {
      day_of_week: 2,
      start_time: "17:00:00",
      end_time: "19:00:00",
      label: "Tuesday evening",
    });

    expect(insert).toHaveBeenCalledWith({
      athlete_id: "athlete-1",
      day_of_week: 2,
      start_time: "17:00:00",
      end_time: "19:00:00",
      label: "Tuesday evening",
    });
  });

  it("propagates a Supabase error instead of resolving silently", async () => {
    const { client } = mockWriteClient({ error: { message: "check violation" } });

    await expect(
      insertAvailabilityWindow(client, "athlete-1", { day_of_week: 2, start_time: "17:00:00", end_time: "19:00:00" })
    ).rejects.toThrow(/athlete_availability_windows/);
  });
});
