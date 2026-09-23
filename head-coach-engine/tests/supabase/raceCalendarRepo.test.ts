import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRacesInWindow, getRacesOverlappingRange } from "../../src/supabase/repositories/raceCalendarRepo.js";

const ATHLETE_ID = "athlete-1";

interface FakeRaceRow {
  athlete_id: string;
  event_name: string;
  start_date: string;
  end_date: string;
  priority: string;
  race_format: string | null;
  status: string;
}

interface CapturedQuery {
  athleteId?: string;
  lte?: string;
  gte?: string;
}

/**
 * A minimal in-memory stand-in for the real `race_calendar` Postgres query
 * — captures the exact .eq/.lte/.gte arguments the function under test
 * issues, and replicates the SAME inclusive overlap predicate confirmed
 * against the real schema (V0.5_041 §2: `start_date <= windowEnd AND
 * end_date >= windowStart`) to decide which fixture rows "the query" would
 * return. This proves getRacesOverlappingRange/getRacesInWindow correctly
 * construct that query and correctly apply isRaceCoachingRelevant to
 * whatever it returns — it does NOT re-prove that Postgres itself evaluates
 * the overlap predicate (that is proven against a real local Supabase
 * instance elsewhere, e.g. buildRawContext.integration.test.ts,
 * projectTrainingPlan.integration.test.ts — same discipline already
 * established by tests/raceCalendarStatus.test.ts's own module doc for
 * isRaceCoachingRelevant).
 */
function fakeClient(rows: readonly FakeRaceRow[], captured: CapturedQuery): SupabaseClient {
  return {
    from(table: string) {
      if (table !== "race_calendar") throw new Error(`unexpected table: ${table}`);
      return {
        select() {
          return {
            eq(column: string, value: string) {
              if (column === "athlete_id") captured.athleteId = value;
              return {
                lte(_column: string, value2: string) {
                  captured.lte = value2;
                  return {
                    async gte(_column2: string, value3: string) {
                      captured.gte = value3;
                      const matching = rows.filter(
                        (r) => r.athlete_id === captured.athleteId && r.start_date <= captured.lte! && r.end_date >= captured.gte!
                      );
                      return { data: matching, error: null };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

function race(overrides: Partial<FakeRaceRow> = {}): FakeRaceRow {
  return {
    athlete_id: ATHLETE_ID,
    event_name: "Test race",
    start_date: "2026-10-10",
    end_date: "2026-10-10",
    priority: "A",
    race_format: null,
    status: "planned",
    ...overrides,
  };
}

describe("getRacesOverlappingRange — V0.5_041/042", () => {
  const TODAY = "2026-09-23";
  const START = "2026-10-01";
  const END = "2026-10-14";

  it("a race entirely inside [startDate, endDate] is included", async () => {
    const r = race({ start_date: "2026-10-05", end_date: "2026-10-06" });
    const client = fakeClient([r], {});

    const result = await getRacesOverlappingRange(client, ATHLETE_ID, START, END, TODAY);

    expect(result).toContainEqual(r);
  });

  it("a race entirely before the window (endDate < startDate) is excluded", async () => {
    const r = race({ start_date: "2026-09-01", end_date: "2026-09-05" }); // ends well before START
    const client = fakeClient([r], {});

    const result = await getRacesOverlappingRange(client, ATHLETE_ID, START, END, TODAY);

    expect(result).toHaveLength(0);
  });

  it("a race entirely after the window (startDate > endDate) is excluded", async () => {
    const r = race({ start_date: "2026-11-01", end_date: "2026-11-02" }); // starts well after END
    const client = fakeClient([r], {});

    const result = await getRacesOverlappingRange(client, ATHLETE_ID, START, END, TODAY);

    expect(result).toHaveLength(0);
  });

  it("a race overlapping the window's start (startDate - 2 -> startDate + 1) is included", async () => {
    const r = race({ start_date: "2026-09-29", end_date: "2026-10-02" }); // START-2 -> START+1
    const client = fakeClient([r], {});

    const result = await getRacesOverlappingRange(client, ATHLETE_ID, START, END, TODAY);

    expect(result).toContainEqual(r);
  });

  it("a race overlapping the window's end (endDate - 1 -> endDate + 2) is included", async () => {
    const r = race({ start_date: "2026-10-13", end_date: "2026-10-16" }); // END-1 -> END+2
    const client = fakeClient([r], {});

    const result = await getRacesOverlappingRange(client, ATHLETE_ID, START, END, TODAY);

    expect(result).toContainEqual(r);
  });

  it("issues the query with exactly the caller-supplied [startDate, endDate], never M1's thresholds", async () => {
    const captured: CapturedQuery = {};
    const client = fakeClient([], captured);

    await getRacesOverlappingRange(client, ATHLETE_ID, START, END, TODAY);

    expect(captured.athleteId).toBe(ATHLETE_ID);
    expect(captured.lte).toBe(END);
    expect(captured.gte).toBe(START);
  });

  it.each(["cancelled", "skipped"] as const)("a %s race inside the window overlap is still excluded via isRaceCoachingRelevant", async (status) => {
    const r = race({ start_date: "2026-10-05", end_date: "2026-10-06", status });
    const client = fakeClient([r], {});

    const result = await getRacesOverlappingRange(client, ATHLETE_ID, START, END, TODAY);

    expect(result).toHaveLength(0);
  });

  it("a planned race inside the window overlap is included", async () => {
    const r = race({ start_date: "2026-10-05", end_date: "2026-10-06", status: "planned" });
    const client = fakeClient([r], {});

    const result = await getRacesOverlappingRange(client, ATHLETE_ID, START, END, TODAY);

    expect(result).toContainEqual(r);
  });
});

describe("getRacesInWindow — M1 non-regression (V0.5_041/042)", () => {
  // Hardcoded expected literal dates, never derived from the production
  // thresholds (PROVISIONAL_THRESHOLDS/TECHNIQUE_POLICY) — importing and
  // reusing those constants here would make this test tautological (it
  // would still pass even if the constants were accidentally changed).
  // today=2026-09-23 -> windowStart = today-2 = 2026-09-21, windowEnd =
  // today+14 = 2026-10-07 (computed independently, matching V0.5_041's own
  // audited values: postEventWindowDays=2, max(preEventWindowDays=7,
  // raceProximityWindowDays=14)=14).
  const TODAY = "2026-09-23";
  const EXPECTED_WINDOW_START = "2026-09-21";
  const EXPECTED_WINDOW_END = "2026-10-07";

  it("still builds exactly [today-2, today+14] — unchanged by the addition of getRacesOverlappingRange", async () => {
    const captured: CapturedQuery = {};
    const client = fakeClient([], captured);

    await getRacesInWindow(client, ATHLETE_ID, TODAY);

    expect(captured.athleteId).toBe(ATHLETE_ID);
    expect(captured.lte).toBe(EXPECTED_WINDOW_END);
    expect(captured.gte).toBe(EXPECTED_WINDOW_START);
  });
});
