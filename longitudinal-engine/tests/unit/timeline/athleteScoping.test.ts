import { beforeEach, describe, expect, it } from "vitest";
import { assertAthleteScoped, TimelineAthleteMismatchError } from "../../../src/timeline/athleteScoping.js";
import { ATHLETE_A, ATHLETE_B, checkin, decision, resetIdSequence } from "./fixtures.js";

beforeEach(() => resetIdSequence());

describe("assertAthleteScoped", () => {
  it("passes silently when every row in every family belongs to the expected athlete", () => {
    const sources = {
      checkins: [checkin({ athleteId: ATHLETE_A }), checkin({ athleteId: ATHLETE_A })],
      decisions: [decision({ athleteId: ATHLETE_A })],
    };
    expect(() => assertAthleteScoped(sources, ATHLETE_A)).not.toThrow();
  });

  it("treats empty arrays as valid", () => {
    const sources = { checkins: [], decisions: [], completedSessions: [], outcomes: [], healthFlags: [] };
    expect(() => assertAthleteScoped(sources, ATHLETE_A)).not.toThrow();
  });

  it("throws TimelineAthleteMismatchError when a row in one family belongs to a different athlete", () => {
    const sources = { checkins: [checkin({ id: "c1", athleteId: ATHLETE_B })] };
    expect(() => assertAthleteScoped(sources, ATHLETE_A)).toThrow(TimelineAthleteMismatchError);
  });

  it("reports every offending family, not just the first one found", () => {
    const sources = {
      checkins: [checkin({ id: "c-bad", athleteId: ATHLETE_B }), checkin({ id: "c-ok", athleteId: ATHLETE_A })],
      decisions: [decision({ id: "d-ok", athleteId: ATHLETE_A })],
      completedSessions: [],
      outcomes: [],
      healthFlags: [{ id: "f-bad", athleteId: ATHLETE_B }],
    };

    let caught: TimelineAthleteMismatchError | undefined;
    try {
      assertAthleteScoped(sources, ATHLETE_A);
    } catch (error) {
      caught = error as TimelineAthleteMismatchError;
    }

    expect(caught).toBeInstanceOf(TimelineAthleteMismatchError);
    expect(caught?.expectedAthleteId).toBe(ATHLETE_A);
    expect(caught?.offendingSources).toEqual({
      checkins: ["c-bad"],
      healthFlags: ["f-bad"],
    });
    // decisions/completedSessions/outcomes had no mismatch — must not appear at all.
    expect(Object.keys(caught?.offendingSources ?? {})).toEqual(["checkins", "healthFlags"]);
  });

  it("caps offending ids at 10 per source family", () => {
    const badCheckins = Array.from({ length: 15 }, (_, i) => checkin({ id: `bad-${i}`, athleteId: ATHLETE_B }));
    let caught: TimelineAthleteMismatchError | undefined;
    try {
      assertAthleteScoped({ checkins: badCheckins }, ATHLETE_A);
    } catch (error) {
      caught = error as TimelineAthleteMismatchError;
    }
    expect(caught?.offendingSources.checkins).toHaveLength(10);
  });
});
