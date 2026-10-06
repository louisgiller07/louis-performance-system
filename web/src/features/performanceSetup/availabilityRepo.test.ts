import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../lib/supabase", () => ({
  supabase: { from: vi.fn() },
}));

import { supabase } from "../../lib/supabase";
import {
  loadAvailabilityWindows,
  saveAvailabilityWindows,
  AvailabilityError,
  type AvailabilityWindow,
} from "./availabilityRepo";

const mockedFrom = supabase.from as unknown as ReturnType<typeof vi.fn>;
const ATHLETE_ID = "athlete-1";

interface RawRow {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  label: string | null;
  activity?: "any" | "physical" | "riding";
}

function rawRow(overrides: Partial<RawRow> = {}): RawRow {
  return { id: "row-1", day_of_week: 1, start_time: "18:00:00", end_time: "20:00:00", label: null, ...overrides };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("loadAvailabilityWindows", () => {
  it("returns an empty array when no rows exist", async () => {
    mockedFrom.mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) });

    const result = await loadAvailabilityWindows();

    expect(result).toEqual([]);
    expect(mockedFrom).toHaveBeenCalledWith("athlete_availability_windows");
  });

  it("maps existing rows and normalizes HH:MM:SS to HH:MM, without any timezone conversion", async () => {
    const selectMock = vi.fn().mockResolvedValue({
      data: [rawRow({ id: "row-1", day_of_week: 2, start_time: "17:00:00", end_time: "19:30:00", label: "Evening" })],
      error: null,
    });
    mockedFrom.mockReturnValue({ select: selectMock });

    const result = await loadAvailabilityWindows();

    expect(result).toEqual<AvailabilityWindow[]>([{ id: "row-1", dayOfWeek: 2, startTime: "17:00", endTime: "19:30", label: "Evening", activity: "any" }]);
    expect(selectMock).toHaveBeenCalledWith("id, day_of_week, start_time, end_time, label, activity");
  });

  it("BUG-V2-1 — reads the activity: physical / riding kept, 'any' or missing = a legacy window (both)", async () => {
    mockedFrom.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [rawRow({ id: "p", activity: "physical" }), rawRow({ id: "r", activity: "riding" }), rawRow({ id: "a", activity: "any" }), rawRow({ id: "old" })],
        error: null,
      }),
    });
    expect((await loadAvailabilityWindows()).map((w) => [w.id, w.activity])).toEqual([
      ["p", "physical"],
      ["r", "riding"],
      ["a", "any"],
      ["old", "any"],
    ]);
  });

  it("throws AvailabilityError, never a raw Supabase error, on failure", async () => {
    mockedFrom.mockReturnValue({ select: vi.fn().mockResolvedValue({ data: null, error: { code: "500", message: "boom" } }) });

    await expect(loadAvailabilityWindows()).rejects.toBeInstanceOf(AvailabilityError);
  });
});

describe("saveAvailabilityWindows — insert-then-delete replacement", () => {
  it("inserts the new rows before deleting the old ones, in that order", async () => {
    const callOrder: string[] = [];
    const table = {
      insert: vi.fn((_rows: unknown) => {
        callOrder.push("insert");
        return { select: vi.fn().mockResolvedValue({ data: [rawRow({ id: "new-1" })], error: null }) };
      }),
      delete: vi.fn(() => {
        callOrder.push("delete");
        return { in: vi.fn().mockResolvedValue({ error: null }) };
      }),
    };
    mockedFrom.mockReturnValue(table);

    await saveAvailabilityWindows(ATHLETE_ID, [{ dayOfWeek: 1, startTime: "18:00", endTime: "20:00", activity: "physical" }], ["old-1", "old-2"]);

    expect(callOrder).toEqual(["insert", "delete"]);
  });

  it("inserts with the athleteId attached to every new row", async () => {
    const insertMock = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) });
    mockedFrom.mockReturnValue({ insert: insertMock, delete: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ error: null }) }) });

    await saveAvailabilityWindows(
      ATHLETE_ID,
      [
        { dayOfWeek: 1, startTime: "18:00", endTime: "20:00", activity: "physical" },
        { dayOfWeek: 3, startTime: "07:00", endTime: "08:00", activity: "riding" },
      ],
      []
    );

    expect(insertMock).toHaveBeenCalledWith([
      { athlete_id: ATHLETE_ID, day_of_week: 1, start_time: "18:00", end_time: "20:00", activity: "physical" },
      { athlete_id: ATHLETE_ID, day_of_week: 3, start_time: "07:00", end_time: "08:00", activity: "riding" },
    ]);
  });

  it("deletes the old rows by their exact ids — never by athlete_id — so newly-inserted rows are never touched", async () => {
    const inMock = vi.fn().mockResolvedValue({ error: null });
    mockedFrom.mockReturnValue({
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [rawRow({ id: "new-1" })], error: null }) }),
      delete: vi.fn().mockReturnValue({ in: inMock }),
    });

    await saveAvailabilityWindows(ATHLETE_ID, [{ dayOfWeek: 1, startTime: "18:00", endTime: "20:00", activity: "physical" }], ["old-1", "old-2"]);

    expect(inMock).toHaveBeenCalledWith("id", ["old-1", "old-2"]);
  });

  it("returns the freshly-inserted rows, mapped and normalized, never fabricated frontend ids", async () => {
    mockedFrom.mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [rawRow({ id: "server-generated-id", start_time: "18:00:00", end_time: "20:00:00" })], error: null }),
      }),
      delete: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ error: null }) }),
    });

    const result = await saveAvailabilityWindows(ATHLETE_ID, [{ dayOfWeek: 1, startTime: "18:00", endTime: "20:00", activity: "physical" }], []);

    expect(result).toEqual<AvailabilityWindow[]>([
      { id: "server-generated-id", dayOfWeek: 1, startTime: "18:00", endTime: "20:00", label: null, activity: "any" },
    ]);
  });

  it("saving zero new windows only deletes the old rows — no insert call at all", async () => {
    const insertMock = vi.fn();
    const inMock = vi.fn().mockResolvedValue({ error: null });
    mockedFrom.mockReturnValue({ insert: insertMock, delete: vi.fn().mockReturnValue({ in: inMock }) });

    const result = await saveAvailabilityWindows(ATHLETE_ID, [], ["old-1"]);

    expect(insertMock).not.toHaveBeenCalled();
    expect(inMock).toHaveBeenCalledWith("id", ["old-1"]);
    expect(result).toEqual([]);
  });

  it("propagates an INSERT failure and never attempts the DELETE step", async () => {
    const deleteMock = vi.fn();
    mockedFrom.mockReturnValue({
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: null, error: { code: "500" } }) }),
      delete: deleteMock,
    });

    await expect(saveAvailabilityWindows(ATHLETE_ID, [{ dayOfWeek: 1, startTime: "18:00", endTime: "20:00", activity: "physical" }], ["old-1"])).rejects.toBeInstanceOf(
      AvailabilityError
    );
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("propagates a DELETE failure after a successful INSERT — the caller must not treat this as a successful save", async () => {
    mockedFrom.mockReturnValue({
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [rawRow({ id: "new-1" })], error: null }) }),
      delete: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ error: { code: "500" } }) }),
    });

    await expect(saveAvailabilityWindows(ATHLETE_ID, [{ dayOfWeek: 1, startTime: "18:00", endTime: "20:00", activity: "physical" }], ["old-1"])).rejects.toBeInstanceOf(
      AvailabilityError
    );
  });

  it("propagates a DELETE failure in the zero-new-windows case too", async () => {
    mockedFrom.mockReturnValue({
      insert: vi.fn(),
      delete: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ error: { code: "500" } }) }),
    });

    await expect(saveAvailabilityWindows(ATHLETE_ID, [], ["old-1"])).rejects.toBeInstanceOf(AvailabilityError);
  });

  it("skips the delete step entirely when there are no old rows to replace", async () => {
    const deleteMock = vi.fn();
    mockedFrom.mockReturnValue({
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [rawRow({ id: "new-1" })], error: null }) }),
      delete: deleteMock,
    });

    await saveAvailabilityWindows(ATHLETE_ID, [{ dayOfWeek: 1, startTime: "18:00", endTime: "20:00", activity: "physical" }], []);

    expect(deleteMock).not.toHaveBeenCalled();
  });
});
