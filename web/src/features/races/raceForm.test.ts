import { describe, expect, it } from "vitest";
import { endDateFor, validateRaceDraft, type RaceDraft } from "./raceForm";
import { raceColumnsFromDraft } from "./raceRepo";
import { mapRaceCalendarRow } from "../../../../head-coach-engine/src/supabase/mapping/raceCalendarRow.ts";

// A09 — the race form's pure rules, and the row it writes is the row the engine reads.
const TODAY = "2026-10-07";
const draft = (over: Partial<RaceDraft> = {}): RaceDraft => ({ eventName: "Hot Trail", startDate: "2026-10-17", endDate: "2026-10-18", priority: "A", raceFormat: "HOT_TRAIL_2DAY", ...over });

describe("A09 — race form rules", () => {
  it("a 2 / 3-day format sets the end date from the start; « Autre format » keeps it (never before the start)", () => {
    expect(endDateFor("HOT_TRAIL_2DAY", "2026-10-17", "2026-10-30")).toBe("2026-10-18");
    expect(endDateFor("IXS_3DAY", "2026-10-30", "2026-10-30")).toBe("2026-11-01");
    expect(endDateFor("OTHER", "2026-10-17", "2026-10-20")).toBe("2026-10-20");
    expect(endDateFor("OTHER", "2026-10-17", "2026-10-10")).toBe("2026-10-17");
  });

  it("validation: name, dates, order, no race entirely past (effective today), format / duration coherent", () => {
    expect(validateRaceDraft(draft(), TODAY)).toBeNull();
    expect(validateRaceDraft(draft({ eventName: "  " }), TODAY)).toBe("Donne un nom à ta course.");
    expect(validateRaceDraft(draft({ startDate: "" }), TODAY)).toBe("Indique les dates de la course.");
    expect(validateRaceDraft(draft({ raceFormat: "OTHER", endDate: "2026-10-16" }), TODAY)).toBe("La fin doit être le même jour que le début ou après.");
    expect(validateRaceDraft(draft({ startDate: "2026-10-05", endDate: "2026-10-06" }), TODAY)).toBe("Cette course est déjà terminée : ajoute une course à venir.");
    expect(validateRaceDraft(draft({ startDate: "2026-10-06", endDate: "2026-10-07" }), TODAY)).toBeNull(); // ends today: not past
    expect(validateRaceDraft(draft({ raceFormat: "IXS_3DAY" }), TODAY)).toBe("Une course sur 3 jours dure 3 jours : ajuste les dates.");
    expect(validateRaceDraft(draft({ raceFormat: "OTHER", startDate: "2026-10-17", endDate: "2026-10-26" }), TODAY)).toBeNull(); // no invented maximum
  });

  it("contract: every row the form writes is accepted by the engine's mapRaceCalendarRow, unchanged (A+ and an existing format included)", () => {
    for (const d of [
      draft(),
      draft({ raceFormat: "IXS_3DAY", endDate: "2026-10-19", priority: "B" }),
      draft({ raceFormat: "OTHER", priority: "C" }),
      draft({ priority: "A_PLUS", raceFormat: "SWISS_CUP" }),
    ]) {
      const row = raceColumnsFromDraft(d);
      const { race, warnings } = mapRaceCalendarRow(row as never);
      expect(warnings).toEqual([]);
      expect([race.event_name, race.priority, race.race_format]).toEqual([d.eventName, d.priority, d.raceFormat]);
    }
  });
});
