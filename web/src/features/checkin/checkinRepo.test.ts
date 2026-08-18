import { describe, expect, it, vi, beforeEach } from "vitest";
import { loadCheckin, saveCheckin, CheckinLoadError, CheckinSaveError } from "./checkinRepo";

vi.mock("../../lib/supabase", () => ({
  supabase: { from: vi.fn() },
}));

import { supabase } from "../../lib/supabase";

const mockedFrom = supabase.from as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("checkinRepo.loadCheckin", () => {
  it("returns null when no row exists for the date", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq2 = vi.fn(() => ({ maybeSingle }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const select = vi.fn(() => ({ eq: eq1 }));
    mockedFrom.mockReturnValue({ select });

    const result = await loadCheckin("athlete-1", "2026-08-19");

    expect(result).toBeNull();
    expect(mockedFrom).toHaveBeenCalledWith("daily_checkins");
    expect(eq1).toHaveBeenCalledWith("athlete_id", "athlete-1");
    expect(eq2).toHaveBeenCalledWith("checkin_date", "2026-08-19");
  });

  it("returns the row when one exists", async () => {
    const row = { checkin_date: "2026-08-19", sleep_hours: 7.5, pain: false };
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
    mockedFrom.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }),
    });

    const result = await loadCheckin("athlete-1", "2026-08-19");

    expect(result).toEqual(row);
  });

  it("throws a clean CheckinLoadError (no raw DB error leaked) on failure", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: { code: "500", message: "relation does not exist" } });
    mockedFrom.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }),
    });

    await expect(loadCheckin("athlete-1", "2026-08-19")).rejects.toThrow(CheckinLoadError);
    await expect(loadCheckin("athlete-1", "2026-08-19")).rejects.not.toThrow(/relation does not exist/);
  });
});

describe("checkinRepo.saveCheckin", () => {
  it("upserts with onConflict athlete_id,checkin_date and returns the persisted row", async () => {
    const savedRow = { checkin_date: "2026-08-19", sleep_hours: 7.5, pain: false };
    const single = vi.fn().mockResolvedValue({ data: savedRow, error: null });
    const select = vi.fn(() => ({ single }));
    const upsert = vi.fn(() => ({ select }));
    mockedFrom.mockReturnValue({ upsert });

    const values = {
      sleep_hours: 7.5,
      sleep_quality: 7,
      sleep_wake_ups: 1,
      energy: 7,
      work_stress: 3,
      motivation: 8,
      leg_fatigue: 3,
      grip_fatigue: 3,
      pain: false,
      pain_intensity: null,
      pain_new: false,
      pain_location_code: null,
      pain_traumatic: false,
      pain_function_loss: false,
      pain_getting_worse: false,
      suspected_concussion: false,
      fever_or_illness: false,
      free_comment: null,
    } as const;

    const result = await saveCheckin("athlete-1", "2026-08-19", values);

    expect(result).toEqual(savedRow);
    expect(upsert).toHaveBeenCalledWith(
      { athlete_id: "athlete-1", checkin_date: "2026-08-19", ...values },
      { onConflict: "athlete_id,checkin_date" }
    );
  });

  it("throws a clean CheckinSaveError on failure", async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate key" } });
    mockedFrom.mockReturnValue({ upsert: () => ({ select: () => ({ single }) }) });

    await expect(
      saveCheckin("athlete-1", "2026-08-19", {
        sleep_hours: 7.5,
        sleep_quality: 7,
        sleep_wake_ups: 1,
        energy: 7,
        work_stress: 3,
        motivation: 8,
        leg_fatigue: 3,
        grip_fatigue: 3,
        pain: false,
        pain_intensity: null,
        pain_new: false,
        pain_location_code: null,
        pain_traumatic: false,
        pain_function_loss: false,
        pain_getting_worse: false,
        suspected_concussion: false,
        fever_or_illness: false,
        free_comment: null,
      })
    ).rejects.toThrow(CheckinSaveError);
  });
});
