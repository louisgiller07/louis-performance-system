import { describe, it, expect } from "vitest";
import { computeRecentLoad } from "../src/engine/recentLoad.js";
import type { CompletedSessionSummary, CompletionStatus } from "../src/types/rawContext.js";
import { PROVISIONAL_THRESHOLDS } from "../src/engine/provisionalThresholds.js";

/**
 * V0.3_007B — `completion_status` correctness for `recent_load`. Before
 * this ticket, `CompletedSessionSummary` had no `completion_status` field
 * at all, so a `skipped`/`partial` HEAVY-or-MODERATE session counted
 * identically to a `done` one — a real, if previously dormant (see
 * docs/11_DECISION_LOG.md V0.3_007B), coaching-correctness bug. No
 * fractional/duration/RPE-based weighting is introduced here — this file
 * only proves the count-based model now respects whether an activity
 * actually happened.
 */

const TODAY = "2026-01-08"; // Louis's fixture window default (7-day lookback)

function session(daysAgo: number, load: "HEAVY" | "MODERATE" | "LIGHT", completion_status: CompletionStatus): CompletedSessionSummary {
  const [y, m, d] = TODAY.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return {
    date: date.toISOString().slice(0, 10),
    intervention: { kind: "DH_PERFORMANCE", load_profile: load },
    completion_status,
  };
}

const RED_MIN = PROVISIONAL_THRESHOLDS.recentLoad.redMinHeavyOrModerateSessions;
const AMBER_MIN = PROVISIONAL_THRESHOLDS.recentLoad.amberMinHeavyOrModerateSessions;

describe("computeRecentLoad — completion_status correctness (V0.3_007B)", () => {
  it("A. DONE HEAVY counts", () => {
    const sessions = Array.from({ length: RED_MIN }, (_, i) => session(i, "HEAVY", "done"));
    const result = computeRecentLoad(sessions, TODAY);
    expect(result.level).toBe("RED");
  });

  it("B. DONE MODERATE counts", () => {
    const sessions = Array.from({ length: RED_MIN }, (_, i) => session(i, "MODERATE", "done"));
    const result = computeRecentLoad(sessions, TODAY);
    expect(result.level).toBe("RED");
  });

  it("C. PARTIAL HEAVY counts exactly once (no fractional weighting)", () => {
    const sessions = [session(0, "HEAVY", "partial"), ...Array.from({ length: AMBER_MIN - 1 }, (_, i) => session(i + 1, "HEAVY", "done"))];
    // AMBER_MIN sessions total (1 partial + the rest done) reach the AMBER
    // threshold exactly — proving the partial session counted as ONE full
    // session, not zero and not a fraction.
    const result = computeRecentLoad(sessions, TODAY);
    expect(result.level).toBe("AMBER");
    const oneFewer = sessions.slice(1); // drop the partial session entirely
    const withoutPartial = computeRecentLoad(oneFewer, TODAY);
    expect(withoutPartial.level).toBe("GREEN");
  });

  it("D. REPLACED counts using the ACTUAL performed intervention, not the prescribed one", () => {
    // The prescribed session is irrelevant here — completed_sessions.intervention
    // already represents what actually happened (M2_004), so a "replaced"
    // row with a HEAVY actual intervention counts as HEAVY, with no separate
    // prescribed-session lookup or special-casing required.
    const sessions = Array.from({ length: RED_MIN }, (_, i) => session(i, "HEAVY", "replaced"));
    const result = computeRecentLoad(sessions, TODAY);
    expect(result.level).toBe("RED");
  });

  it("E. SKIPPED HEAVY-prescribed session does NOT count", () => {
    const sessions = Array.from({ length: RED_MIN }, (_, i) => session(i, "HEAVY", "skipped"));
    const result = computeRecentLoad(sessions, TODAY);
    expect(result.level).toBe("GREEN");
    expect(result.raw_signals).toEqual([]);
  });

  it("E2. a mix of enough HEAVY sessions to reach RED, plus extra SKIPPED HEAVY sessions, stays at the count from the real ones only", () => {
    const real = Array.from({ length: RED_MIN }, (_, i) => session(i, "HEAVY", "done"));
    const skipped = Array.from({ length: 3 }, (_, i) => session(i, "HEAVY", "skipped"));
    const result = computeRecentLoad([...real, ...skipped], TODAY);
    const realOnly = computeRecentLoad(real, TODAY);
    expect(result).toEqual(realOnly);
  });

  it("F. a LIGHT / fixed-load activity never counts, existing behavior unchanged", () => {
    const sessions = [
      session(0, "LIGHT", "done"),
      { date: TODAY, intervention: { kind: "REST" } as const, completion_status: "done" as const },
    ];
    const result = computeRecentLoad(sessions, TODAY);
    expect(result.level).toBe("GREEN");
  });

});

// G (legacy null-intervention exclusion) is proved in
// tests/supabase/completedSessionRow.test.ts instead — computeRecentLoad
// itself only ever receives already-resolved CompletedSessionSummary values
// (intervention always present); the null-intervention exclusion is owned
// entirely upstream by mapCompletedSessionRow, never by this function.
