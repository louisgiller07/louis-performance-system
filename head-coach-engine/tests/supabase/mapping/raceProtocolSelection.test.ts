/**
 * SPORT-RACE-01P.3 (HPM 2026-10-19, proposition A) — the one rule M1's daily context and the V2 plan share: a pre-event
 * protocol only for a race explicitly identified as the series it was written for. Never from a duration, a name, a
 * free-text series or a stored format alone; formats without a protocol unchanged.
 */
import { describe, expect, it } from "vitest";
import { RACE_SERIES_CODES, SERIES_PROTOCOL_FORMAT, selectRaceProtocolFormat } from "../../../src/supabase/mapping/raceProtocolSelection.js";
import type { RaceFormat } from "../../../src/types/index.js";

const LEGACY = "without the explicit series it was written for";

describe("SPORT-RACE-01P.3 — selectRaceProtocolFormat", () => {
  it("the two explicitly identified series keep their protocol format, with no warning", () => {
    expect(selectRaceProtocolFormat("Hot Trail", "HOT_TRAIL_2DAY", "HOT_TRAIL_SERIES")).toEqual({ race_format: "HOT_TRAIL_2DAY", protocol: true });
    expect(selectRaceProtocolFormat("iXS Lenzerheide", "IXS_3DAY", "IXS")).toEqual({ race_format: "IXS_3DAY", protocol: true });
  });

  it("only those two series have a protocol", () => {
    expect(SERIES_PROTOCOL_FORMAT).toEqual({ HOT_TRAIL_SERIES: "HOT_TRAIL_2DAY", IXS: "IXS_3DAY" });
    expect(RACE_SERIES_CODES).toEqual([
      "HOT_TRAIL_SERIES",
      "IXS",
      "SWISS_OTHER",
      "UCI_WORLD_CUP",
      "UCI_WORLD_CHAMPS",
      "FR_COUPE_DE_FRANCE_DH",
      "FR_CHAMPIONNAT_DE_FRANCE_DH",
      "FR_REGIONAL_DH",
      "FR_OTHER_DH",
      "OTHER",
    ]);
  });

  it("a protocol format without its series is ambiguous — legacy row, free-text or variant label, another competition, the other protocol's series: OTHER with a warning", () => {
    const cases: [RaceFormat, unknown][] = [
      ["HOT_TRAIL_2DAY", null],
      ["HOT_TRAIL_2DAY", undefined],
      ["IXS_3DAY", null],
      ["HOT_TRAIL_2DAY", "Hot Trail Series (Swiss DH Cup)"],
      ["HOT_TRAIL_2DAY", "hot_trail_series"],
      ["HOT_TRAIL_2DAY", " HOT_TRAIL_SERIES"],
      ["IXS_3DAY", "iXS European Cup"],
      ["IXS_3DAY", "ixs"],
      ["HOT_TRAIL_2DAY", "SWISS_OTHER"],
      ["HOT_TRAIL_2DAY", "FR_COUPE_DE_FRANCE_DH"],
      ["IXS_3DAY", "FR_CHAMPIONNAT_DE_FRANCE_DH"],
      ["IXS_3DAY", "UCI_WORLD_CUP"],
      ["IXS_3DAY", "FR_REGIONAL_DH"],
      ["HOT_TRAIL_2DAY", "IXS"],
      ["IXS_3DAY", "HOT_TRAIL_SERIES"],
      ["HOT_TRAIL_2DAY", 42],
    ];
    for (const [format, series] of cases) {
      const selection = selectRaceProtocolFormat("R", format, series);
      expect(selection.race_format, `${format} / ${String(series)}`).toBe("OTHER");
      expect(selection.protocol).toBe(false);
      expect(selection.warning).toContain(LEGACY);
    }
  });

  it("formats without a protocol stay as stored, whatever the series, with no warning — the series never creates a protocol", () => {
    const cases: [RaceFormat, unknown][] = [
      ["SWISS_CUP", null],
      ["UCI_WC", null],
      ["UCI_WORLDS", null],
      ["OTHER", null],
      ["OTHER", "SWISS_OTHER"],
      ["OTHER", "UCI_WORLD_CUP"],
      ["OTHER", "FR_COUPE_DE_FRANCE_DH"],
      ["OTHER", "FR_CHAMPIONNAT_DE_FRANCE_DH"],
      ["OTHER", "FR_REGIONAL_DH"],
      ["OTHER", "FR_OTHER_DH"],
      ["OTHER", "OTHER"],
      ["OTHER", "HOT_TRAIL_SERIES"],
      ["SWISS_CUP", "IXS"],
    ];
    for (const [format, series] of cases) {
      expect(selectRaceProtocolFormat("R", format, series), `${format} / ${String(series)}`).toEqual({ race_format: format, protocol: false });
    }
  });

  it("a NULL format stays OTHER with its existing warning", () => {
    const selection = selectRaceProtocolFormat("Course locale", null, "FR_REGIONAL_DH");
    expect(selection.race_format).toBe("OTHER");
    expect(selection.protocol).toBe(false);
    expect(selection.warning).toContain("has race_format = NULL");
  });
});
