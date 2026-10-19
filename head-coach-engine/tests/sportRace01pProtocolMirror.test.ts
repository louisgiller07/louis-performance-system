import { describe, expect, it } from "vitest";
import { RACE_PROTOCOL_TABLES_V2 } from "planning-engine/session-model-v2";
import { computeEventContext } from "../src/engine/eventContext.js";
import { computeRaceProtocolRecommendation } from "../src/rules/raceProtocol.js";
import type { RaceFormat, UpcomingRace } from "../src/types/index.js";

// SPORT-RACE-01P — the V2 planner places the pre-event sessions of a race from a mirror of M1's T-X tables
// (docs/04 §3). M1 (frozen) stays the source of truth: the mirror must say exactly what M1 recommends, day by day,
// for every format M1 has a table for, and nothing for the others.

const START = "2026-11-21";
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const race = (race_format: RaceFormat): UpcomingRace => ({ event_name: "Course", event_start: START, event_end: "2026-11-22", priority: "A", race_format });

function m1Table(format: RaceFormat) {
  const days: Record<number, unknown> = {};
  for (let x = 7; x >= 1; x--) {
    const today = addDays(START, -x);
    const context = computeEventContext(today, [race(format)]);
    const recommendation = context ? computeRaceProtocolRecommendation(context, today) : null;
    if (recommendation === null) continue;
    const s = recommendation.recommended_session;
    days[x] = { kind: s.kind, ...(s.load_profile !== undefined ? { loadProfile: s.load_profile } : {}), ...(s.duration_min !== undefined ? { durationMin: s.duration_min } : {}) };
  }
  return days;
}

describe("SPORT-RACE-01P — the planner's protocol table is M1's T-X table", () => {
  it("HOT_TRAIL_2DAY and IXS_3DAY: same kind, load and duration, every day from J-7 to J-1", () => {
    for (const format of ["HOT_TRAIL_2DAY", "IXS_3DAY"] as const) expect(m1Table(format)).toEqual(RACE_PROTOCOL_TABLES_V2[format]);
  });

  it("every other format has no pre-event protocol in M1, and none in the planner", () => {
    for (const format of ["SWISS_CUP", "UCI_WC", "UCI_WORLDS", "OTHER"] as const) {
      expect(m1Table(format)).toEqual({});
      expect(Object.keys(RACE_PROTOCOL_TABLES_V2)).not.toContain(format);
    }
  });
});
