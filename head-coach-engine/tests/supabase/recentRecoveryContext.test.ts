import { describe, it, expect } from "vitest";
import { mapRecentRecoveryContext } from "../../src/supabase/mapping/recentRecoveryContext.js";
import type { CompletedSessionRawRow } from "../../src/supabase/repositories/completedSessionsRepo.js";

const TODAY = "2026-08-24";
const D1 = "2026-08-23"; // today - 1
const D2 = "2026-08-22"; // today - 2

function row(overrides: Partial<CompletedSessionRawRow> = {}): CompletedSessionRawRow {
  return {
    session_date: D1,
    session_type: "DH_TECHNICAL",
    intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
    completion_status: "partial",
    post_leg_fatigue: 7,
    post_grip_fatigue: 7,
    change_reason: "fatigue_control",
    ...overrides,
  };
}

describe("V0.3_008A — mapRecentRecoveryContext (Previous-Day Recovery Continuity)", () => {
  it("PARTIAL + fatigue_control on D-1 -> full context", () => {
    const result = mapRecentRecoveryContext([row()], TODAY);
    expect(result).toEqual({
      session_date: D1,
      completion_status: "partial",
      change_reason: "fatigue_control",
      post_leg_fatigue: 7,
      post_grip_fatigue: 7,
    });
  });

  it("REPLACED + fatigue_control on D-1 -> eligible", () => {
    const result = mapRecentRecoveryContext([row({ completion_status: "replaced" })], TODAY);
    expect(result?.completion_status).toBe("replaced");
  });

  it("SKIPPED + fatigue_control on D-1 -> eligible even though intervention is null", () => {
    const result = mapRecentRecoveryContext([row({ completion_status: "skipped", intervention: null })], TODAY);
    expect(result).toEqual({
      session_date: D1,
      completion_status: "skipped",
      change_reason: "fatigue_control",
      post_leg_fatigue: 7,
      post_grip_fatigue: 7,
    });
  });

  it("SKIPPED with no post-fatigue values recorded -> nulls carried through, never fabricated", () => {
    const result = mapRecentRecoveryContext(
      [row({ completion_status: "skipped", intervention: null, post_leg_fatigue: null, post_grip_fatigue: null })],
      TODAY
    );
    expect(result?.post_leg_fatigue).toBeNull();
    expect(result?.post_grip_fatigue).toBeNull();
  });

  it("DONE cannot carry change_reason under the real contract, but this pure mapper is still defensively inert for it -> undefined", () => {
    const result = mapRecentRecoveryContext([row({ completion_status: "done", change_reason: null })], TODAY);
    expect(result).toBeUndefined();
  });

  it.each(["weather_terrain", "mechanical", "time_life", "activity_change", "motivation", "coach_criterion", "other"])(
    "change_reason=%s on D-1 -> inert (undefined) in V0.3_008A",
    (reason) => {
      const result = mapRecentRecoveryContext([row({ change_reason: reason })], TODAY);
      expect(result).toBeUndefined();
    }
  );

  it("change_reason=pain on D-1 -> inert (undefined) — pain stays fully outside recovery context", () => {
    const result = mapRecentRecoveryContext([row({ change_reason: "pain" })], TODAY);
    expect(result).toBeUndefined();
  });

  it("change_reason=null on D-1 (e.g. a DONE row) -> undefined", () => {
    const result = mapRecentRecoveryContext([row({ change_reason: null })], TODAY);
    expect(result).toBeUndefined();
  });

  it("D-2 (2 days old) fatigue_control PARTIAL -> ignored, never reached back to", () => {
    const result = mapRecentRecoveryContext([row({ session_date: D2 })], TODAY);
    expect(result).toBeUndefined();
  });

  it("same-day (today's own) record must never become today's own recovery context", () => {
    const result = mapRecentRecoveryContext([row({ session_date: TODAY })], TODAY);
    expect(result).toBeUndefined();
  });

  it("no completed session at all on D-1 -> undefined", () => {
    const result = mapRecentRecoveryContext([], TODAY);
    expect(result).toBeUndefined();
  });

  it("a D-1 row exists but only a D-2/D-3 fatigue_control row is otherwise present -> still undefined (no reaching past D-1)", () => {
    const result = mapRecentRecoveryContext(
      [row({ session_date: D2, completion_status: "partial" }), row({ session_date: "2026-08-21", completion_status: "replaced" })],
      TODAY
    );
    expect(result).toBeUndefined();
  });

  it("multiple rows in the window, only the exact D-1 one is picked, never the nearest/most-recent one", () => {
    const result = mapRecentRecoveryContext(
      [
        row({ session_date: TODAY, completion_status: "partial" }), // same-day, must be ignored
        row({ session_date: D1, completion_status: "replaced" }), // the only eligible one
        row({ session_date: D2, completion_status: "skipped" }), // too old, must be ignored
      ],
      TODAY
    );
    expect(result?.session_date).toBe(D1);
    expect(result?.completion_status).toBe("replaced");
  });
});
