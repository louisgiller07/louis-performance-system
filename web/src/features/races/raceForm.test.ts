import { describe, expect, it } from "vitest";
import { endDateFor, validateRaceDraft, type RaceDraft } from "./raceForm";
import { raceColumnsFromDraft } from "./raceRepo";
import { RACE_SERIES, raceProtocolOf } from "./raceProtocol";
import { mapRaceCalendarRow } from "../../../../head-coach-engine/src/supabase/mapping/raceCalendarRow.ts";
import { RACE_SERIES_CODES, selectRaceProtocolFormat } from "../../../../head-coach-engine/src/supabase/mapping/raceProtocolSelection.ts";

// A09 — the race form's pure rules, and the row it writes is the row the engine reads.
// SPORT-RACE-01P.3 — the competition is named explicitly; the web's protocol rule is the engine's.
const TODAY = "2026-10-07";
const draft = (over: Partial<RaceDraft> = {}): RaceDraft => ({ eventName: "Hot Trail", startDate: "2026-10-17", endDate: "2026-10-18", priority: "A", raceFormat: "HOT_TRAIL_2DAY", series: "HOT_TRAIL_SERIES", ...over });

describe("A09 — race form rules", () => {
  it("a protocol format sets the end date from the start; any other keeps it (never before the start)", () => {
    expect(endDateFor("HOT_TRAIL_2DAY", "2026-10-17", "2026-10-30")).toBe("2026-10-18");
    expect(endDateFor("IXS_3DAY", "2026-10-30", "2026-10-30")).toBe("2026-11-01");
    expect(endDateFor("OTHER", "2026-10-17", "2026-10-20")).toBe("2026-10-20");
    expect(endDateFor("OTHER", "2026-10-17", "2026-10-10")).toBe("2026-10-17");
    expect(endDateFor(null, "2026-10-17", "2026-10-19")).toBe("2026-10-19");
  });

  it("validation: name, a listed competition (never preselected), dates, order, no race entirely past (effective today), protocol duration", () => {
    expect(validateRaceDraft(draft(), TODAY)).toBeNull();
    expect(validateRaceDraft(draft({ eventName: "  " }), TODAY)).toBe("Donne un nom à ta course.");
    expect(validateRaceDraft(draft({ series: null, raceFormat: null }), TODAY)).toBe("Choisis la compétition.");
    expect(validateRaceDraft(draft({ series: "Hot Trail Series (Swiss DH Cup)" }), TODAY)).toBe("Choisis la compétition."); // free text: not a listed competition
    expect(validateRaceDraft(draft({ series: "FR_COUPE_DE_FRANCE_DH" }), TODAY)).toBe("Choisis la compétition."); // a Coupe de France never writes the 2-day format
    expect(validateRaceDraft(draft({ series: "FR_COUPE_DE_FRANCE_DH", raceFormat: "OTHER" }), TODAY)).toBeNull();
    expect(validateRaceDraft(draft({ startDate: "" }), TODAY)).toBe("Indique les dates de la course.");
    expect(validateRaceDraft(draft({ series: "FR_REGIONAL_DH", raceFormat: "OTHER", endDate: "2026-10-16" }), TODAY)).toBe("La fin doit être le même jour que le début ou après.");
    expect(validateRaceDraft(draft({ startDate: "2026-10-05", endDate: "2026-10-06" }), TODAY)).toBe("Cette course est déjà terminée : ajoute une course à venir.");
    expect(validateRaceDraft(draft({ startDate: "2026-10-06", endDate: "2026-10-07" }), TODAY)).toBeNull(); // ends today: not past
    expect(validateRaceDraft(draft({ series: "IXS", raceFormat: "IXS_3DAY" }), TODAY)).toBe("Cette compétition dure 3 jours : ajuste les dates.");
    expect(validateRaceDraft(draft({ series: "FR_CHAMPIONNAT_DE_FRANCE_DH", raceFormat: "OTHER", endDate: "2026-10-19" }), TODAY)).toBeNull(); // a 3-day French championship: free dates, no protocol
    expect(validateRaceDraft(draft({ series: "OTHER", raceFormat: "OTHER", startDate: "2026-10-17", endDate: "2026-10-26" }), TODAY)).toBeNull(); // no invented maximum
  });

  it("an existing race keeps the competition / format it was stored with (legacy « 2 jours », A+ Swiss Cup, free text), never silently converted", () => {
    const legacy = { raceFormat: "HOT_TRAIL_2DAY", series: null };
    expect(validateRaceDraft(draft({ series: null }), TODAY, legacy)).toBeNull();
    expect(validateRaceDraft(draft({ series: null }), TODAY)).toBe("Choisis la compétition.");
    expect(validateRaceDraft(draft({ priority: "A_PLUS", raceFormat: "SWISS_CUP", series: null }), TODAY, { raceFormat: "SWISS_CUP", series: null })).toBeNull();
    const freeText = { raceFormat: "IXS_3DAY", series: "iXS European Cup" };
    expect(validateRaceDraft(draft({ ...freeText, endDate: "2026-10-19" }), TODAY, freeText)).toBeNull();
  });

  it("contract: every competition the form offers writes a row the engine's mapRaceCalendarRow accepts unchanged, without a warning, and gets the same protocol in the web and in the engine", () => {
    expect(RACE_SERIES.map((option) => option.code)).toEqual([...RACE_SERIES_CODES]);
    for (const option of RACE_SERIES) {
      const days = option.days ?? 1;
      const d = draft({ series: option.code, raceFormat: option.raceFormat, endDate: days === 3 ? "2026-10-19" : days === 2 ? "2026-10-18" : "2026-10-17", priority: "B" });
      expect(validateRaceDraft(d, TODAY), option.code).toBeNull();
      const row = raceColumnsFromDraft(d);
      expect(row.series).toBe(option.code);
      const { race, warnings } = mapRaceCalendarRow(row as never);
      expect(warnings, option.code).toEqual([]);
      expect([race.event_name, race.priority, race.race_format]).toEqual([d.eventName, d.priority, option.raceFormat]);
      expect(raceProtocolOf(d.raceFormat, d.series) !== null, option.code).toBe(selectRaceProtocolFormat(d.eventName, option.raceFormat, option.code).protocol);
    }
    // An existing A+ / Swiss Cup race kept as is.
    const kept = draft({ priority: "A_PLUS", raceFormat: "SWISS_CUP", series: null });
    const { race, warnings } = mapRaceCalendarRow(raceColumnsFromDraft(kept) as never);
    expect(warnings).toEqual([]);
    expect([race.priority, race.race_format]).toEqual(["A_PLUS", "SWISS_CUP"]);
  });

  it("mirror: the web's protocol rule is the engine's for stored pairs, legacy and label variants included (never a protocol from a duration or a free text)", () => {
    const pairs: [string | null, string | null][] = [
      ["HOT_TRAIL_2DAY", "HOT_TRAIL_SERIES"],
      ["IXS_3DAY", "IXS"],
      ["HOT_TRAIL_2DAY", null],
      ["IXS_3DAY", null],
      ["HOT_TRAIL_2DAY", "Hot Trail Series (Swiss DH Cup)"],
      ["IXS_3DAY", "iXS DHC"],
      ["IXS_3DAY", "ixs"],
      ["HOT_TRAIL_2DAY", "FR_COUPE_DE_FRANCE_DH"],
      ["IXS_3DAY", "FR_CHAMPIONNAT_DE_FRANCE_DH"],
      ["HOT_TRAIL_2DAY", "IXS"],
      ["OTHER", "HOT_TRAIL_SERIES"],
      ["SWISS_CUP", null],
      ["UCI_WC", null],
      ["UCI_WORLDS", null],
      ["OTHER", "FR_REGIONAL_DH"],
      [null, null],
    ];
    for (const [format, series] of pairs) {
      const engine = selectRaceProtocolFormat("R", format as never, series);
      expect(raceProtocolOf(format, series) !== null, `${format} / ${series}`).toBe(engine.protocol);
    }
  });
});
