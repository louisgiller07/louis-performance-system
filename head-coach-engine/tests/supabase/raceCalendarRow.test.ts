import { describe, it, expect } from "vitest";
import { mapRaceCalendarRow, InvalidRaceCalendarRowError } from "../../src/supabase/mapping/raceCalendarRow.js";

describe("M2 read path — mapRaceCalendarRow", () => {
  it("maps a valid race_format identically, with no warning", () => {
    const { race, warnings } = mapRaceCalendarRow({
      event_name: "La Berra",
      start_date: "2026-08-16",
      end_date: "2026-08-16",
      priority: "A",
      race_format: "HOT_TRAIL_2DAY",
    });

    expect(race).toEqual({
      event_name: "La Berra",
      event_start: "2026-08-16",
      event_end: "2026-08-16",
      priority: "A",
      race_format: "HOT_TRAIL_2DAY",
    });
    expect(warnings).toEqual([]);
  });

  it("maps a NULL race_format to OTHER and emits an explicit warning", () => {
    const { race, warnings } = mapRaceCalendarRow({
      event_name: "Course locale",
      start_date: "2026-08-20",
      end_date: "2026-08-20",
      priority: "C",
      race_format: null,
    });

    expect(race.race_format).toBe("OTHER");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Course locale");
    expect(warnings[0]).toContain("NULL");
  });

  it("rejects a non-null race_format that is not a recognized RaceFormat, rather than folding it into OTHER", () => {
    expect(() =>
      mapRaceCalendarRow({
        event_name: "Course inconnue",
        start_date: "2026-08-20",
        end_date: "2026-08-20",
        priority: "C",
        race_format: "NOT_A_REAL_FORMAT",
      })
    ).toThrow(InvalidRaceCalendarRowError);
  });

  it("never populates race_phase — no DB column backs it", () => {
    const { race } = mapRaceCalendarRow({
      event_name: "La Berra",
      start_date: "2026-08-16",
      end_date: "2026-08-16",
      priority: "A",
      race_format: "HOT_TRAIL_2DAY",
    });

    expect(race.race_phase).toBeUndefined();
  });

  it("rejects a missing priority", () => {
    expect(() =>
      mapRaceCalendarRow({ event_name: "X", start_date: "2026-08-16", end_date: "2026-08-16", priority: null })
    ).toThrow(InvalidRaceCalendarRowError);
  });
});
