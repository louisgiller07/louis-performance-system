import { describe, expect, it } from "vitest";
import { translateRaceFormat, translateRacePhase, translateRacePriority } from "./raceLabels";

describe("raceLabels (REV-016b)", () => {
  it("validated race formats: official names kept, generic formats translated", () => {
    expect(translateRaceFormat("IXS_3DAY")).toBe("iXS, 3 jours");
    expect(translateRaceFormat("HOT_TRAIL_2DAY")).toBe("Hot Trail, 2 jours");
    expect(translateRaceFormat("SWISS_CUP")).toBe("Swiss Cup");
    expect(translateRaceFormat("UCI_WC")).toBe("Coupe du monde UCI");
    expect(translateRaceFormat("UCI_WORLDS")).toBe("Championnats du monde UCI");
  });

  it("priority A_PLUS → A+, others unchanged", () => {
    expect(["A_PLUS", "A", "B", "C"].map(translateRacePriority)).toEqual(["A+", "A", "B", "C"]);
  });

  it("validated in-progress race phases", () => {
    expect(["TRACKWALK", "PRACTICE", "PRACTICE_TIMED", "QUALI", "FINAL", "RACE_DAY_GENERIC"].map(translateRacePhase)).toEqual([
      "reconnaissance",
      "entraînements",
      "entraînements chronométrés",
      "qualifications",
      "finale",
      "jour de course",
    ]);
  });

  it("unknown, inherited, empty, null, undefined → null (callers keep the original sentence)", () => {
    for (const value of ["OTHER", "PRE_EVENT", "toString", "", null, undefined]) {
      expect(translateRaceFormat(value === "PRE_EVENT" ? "UNKNOWN_FORMAT" : value)).toBeNull();
      expect(translateRacePhase(value === "OTHER" ? "PRE_EVENT" : value)).toBeNull();
      expect(translateRacePriority(value === "OTHER" ? "A_MINUS" : value)).toBeNull();
    }
  });
});
