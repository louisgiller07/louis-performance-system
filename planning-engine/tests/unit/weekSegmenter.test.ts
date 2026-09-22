import { describe, expect, it } from "vitest";
import { segmentWeek, InvalidWeekRangeError, type WeekSegmentationInput } from "../../src/pipeline/weekSegmenter.js";
import { WEEK_TEMPLATE_CATALOG } from "../../src/catalog/weekTemplateCatalog.js";
import type { PlanInputAvailability } from "../../src/types/planInputSnapshot.js";

// 2026-10-19 is a Monday; the week runs Mon..Sun (2026-10-19..2026-10-25).
// Sat=2026-10-24 (dayOfWeek 6), Sun=2026-10-25 (dayOfWeek 0).
const WEEK_START = "2026-10-19";
const WEEK_END = "2026-10-25";

const FULL_WEEK_AVAILABILITY: PlanInputAvailability = {
  windows: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek: dayOfWeek as PlanInputAvailability["windows"][number]["dayOfWeek"],
    startTime: "16:00",
    endTime: "20:00",
  })),
  exceptions: [],
};

function baseInput(overrides: Partial<WeekSegmentationInput> = {}): WeekSegmentationInput {
  return {
    weekStartDate: WEEK_START,
    weekEndDate: WEEK_END,
    template: WEEK_TEMPLATE_CATALOG.development!,
    availability: FULL_WEEK_AVAILABILITY,
    terrainAccess: ["flow_trail", "technical_trail"],
    lockedDates: [],
    ...overrides,
  };
}

describe("segmentWeek — basic placement", () => {
  it("places every slot the development template asks for, no unplaceable, with full availability", () => {
    const result = segmentWeek(baseInput());

    expect(result.unplaceable).toEqual([]);
    expect(result.placedSlots.filter((s) => s.domain === "strength")).toHaveLength(2);
    expect(result.placedSlots.filter((s) => s.domain === "dh_technical")).toHaveLength(2);
    expect(result.placedSlots.filter((s) => s.domain === "aerobic")).toHaveLength(1);
  });

  it("never places two domains on the same date", () => {
    const result = segmentWeek(baseInput());

    const dates = result.placedSlots.map((s) => s.date);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it("only places within [weekStartDate, weekEndDate]", () => {
    const result = segmentWeek(baseInput());

    for (const slot of result.placedSlots) {
      expect(slot.date >= WEEK_START && slot.date <= WEEK_END).toBe(true);
    }
  });

  it("a zero-slot template (e.g. race) places nothing and reports nothing unplaceable", () => {
    const result = segmentWeek(baseInput({ template: WEEK_TEMPLATE_CATALOG.race! }));

    expect(result.placedSlots).toEqual([]);
    expect(result.unplaceable).toEqual([]);
  });
});

describe("segmentWeek — availability", () => {
  it("excludes a locked date from every domain's candidates", () => {
    const result = segmentWeek(baseInput({ lockedDates: [{ date: "2026-10-19" }, { date: "2026-10-20" }] }));

    expect(result.placedSlots.some((s) => s.date === "2026-10-19" || s.date === "2026-10-20")).toBe(false);
  });

  it("an exception with available=false removes an otherwise-available date", () => {
    const availability: PlanInputAvailability = {
      windows: FULL_WEEK_AVAILABILITY.windows,
      exceptions: [{ date: "2026-10-19", available: false, note: "travel" }],
    };
    const result = segmentWeek(baseInput({ availability }));

    expect(result.placedSlots.some((s) => s.date === "2026-10-19")).toBe(false);
  });

  it("an exception with available=true grants a date whose day-of-week has no recurring window", () => {
    const noWeekdaysAvailability: PlanInputAvailability = {
      windows: [
        { dayOfWeek: 6, startTime: "09:00", endTime: "17:00" }, // Saturday only
      ],
      exceptions: [{ date: "2026-10-19", available: true }], // Monday, granted by exception
    };
    const result = segmentWeek(
      baseInput({
        availability: noWeekdaysAvailability,
        template: { ...WEEK_TEMPLATE_CATALOG.development!, strengthSlotCount: 1, dhTechnicalSlotCount: 0, aerobicSlotCount: 0 },
      })
    );

    expect(result.placedSlots).toEqual([{ date: "2026-10-19", domain: "strength" }]);
  });

  it("reports insufficient_available_dates when there are fewer candidate dates than the template needs", () => {
    const scarce: PlanInputAvailability = { windows: [{ dayOfWeek: 1, startTime: "16:00", endTime: "20:00" }], exceptions: [] }; // Monday only
    const result = segmentWeek(
      baseInput({ availability: scarce, template: { ...WEEK_TEMPLATE_CATALOG.development!, strengthSlotCount: 2, dhTechnicalSlotCount: 0, aerobicSlotCount: 0 } })
    );

    expect(result.placedSlots).toHaveLength(1);
    expect(result.unplaceable).toEqual([{ domain: "strength", reason: "insufficient_available_dates" }]);
  });
});

describe("segmentWeek — terrain (bike_park_jump_line weekend-only rule)", () => {
  it("restricts dh_technical to Saturday/Sunday when terrainAccess is exactly [bike_park_jump_line]", () => {
    const result = segmentWeek(baseInput({ terrainAccess: ["bike_park_jump_line"] }));

    const dhDates = result.placedSlots.filter((s) => s.domain === "dh_technical").map((s) => s.date);
    expect(dhDates.every((d) => d === "2026-10-24" || d === "2026-10-25")).toBe(true);
  });

  it("does not restrict dh_technical when any other terrain tag is present alongside bike_park_jump_line", () => {
    const result = segmentWeek(baseInput({ terrainAccess: ["bike_park_jump_line", "flow_trail"] }));

    // With full weekday availability and only 2 dh slots requested, a
    // weekday placement is possible once the rule no longer applies.
    const dhDates = result.placedSlots.filter((s) => s.domain === "dh_technical").map((s) => s.date);
    expect(dhDates).toHaveLength(2);
  });

  it("reports terrain_incompatible, not insufficient_available_dates, when weekend-only terrain leaves too few weekend dates", () => {
    const result = segmentWeek(
      baseInput({
        terrainAccess: ["bike_park_jump_line"],
        template: { ...WEEK_TEMPLATE_CATALOG.development!, strengthSlotCount: 0, dhTechnicalSlotCount: 3, aerobicSlotCount: 0 },
      })
    );

    expect(result.unplaceable).toEqual([{ domain: "dh_technical", reason: "terrain_incompatible" }]);
  });

  it("dh_technical is placed before strength/aerobic so weekend-only terrain isn't starved by domains with no such restriction", () => {
    // Only the weekend is available at all — if strength/aerobic were
    // placed first they could not possibly claim the only dh-eligible
    // dates anyway here, but this proves dh still gets exactly its 2 slots
    // on the 2 available weekend dates when terrain-restricted.
    const weekendOnlyAvailability: PlanInputAvailability = {
      windows: [
        { dayOfWeek: 6, startTime: "09:00", endTime: "17:00" },
        { dayOfWeek: 0, startTime: "09:00", endTime: "17:00" },
      ],
      exceptions: [],
    };
    const result = segmentWeek(
      baseInput({
        availability: weekendOnlyAvailability,
        terrainAccess: ["bike_park_jump_line"],
        template: { ...WEEK_TEMPLATE_CATALOG.development!, strengthSlotCount: 0, dhTechnicalSlotCount: 2, aerobicSlotCount: 0 },
      })
    );

    expect(result.unplaceable).toEqual([]);
    expect(result.placedSlots).toHaveLength(2);
    expect(result.placedSlots.every((s) => s.domain === "dh_technical")).toBe(true);
  });
});

describe("segmentWeek — conflict reporting, never silent", () => {
  it("never substitutes a domain to compensate for another domain's shortfall", () => {
    const scarce: PlanInputAvailability = { windows: [{ dayOfWeek: 1, startTime: "16:00", endTime: "20:00" }], exceptions: [] }; // Monday only
    const result = segmentWeek(
      baseInput({ availability: scarce, template: { ...WEEK_TEMPLATE_CATALOG.development!, strengthSlotCount: 1, dhTechnicalSlotCount: 1, aerobicSlotCount: 0 } })
    );

    // Only one candidate date exists for the whole week — dh_technical
    // (processed first) claims it; strength must be reported unplaceable,
    // never silently reassigned to a different domain or duplicated onto
    // the same date as dh_technical.
    expect(result.placedSlots).toEqual([{ date: "2026-10-19", domain: "dh_technical" }]);
    expect(result.unplaceable).toEqual([{ domain: "strength", reason: "insufficient_available_dates" }]);
  });
});

describe("segmentWeek — determinism", () => {
  it("the same input produces the exact same output on repeated calls", () => {
    const input = baseInput();

    expect(segmentWeek(input)).toEqual(segmentWeek(input));
  });
});

describe("segmentWeek — errors", () => {
  it("throws InvalidWeekRangeError when weekEndDate is before weekStartDate", () => {
    expect(() => segmentWeek(baseInput({ weekStartDate: "2026-10-25", weekEndDate: "2026-10-19" }))).toThrow(InvalidWeekRangeError);
  });
});
