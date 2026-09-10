import { describe, expect, it } from "vitest";
import { matchPerformedSession, buildLinkedSessionsByDecisionId, NO_COMPLETED_SESSION_COPY, SAME_DAY_UNASSOCIATED_COPY } from "./historyPerformedMatch";
import type { CompletedSessionRecord } from "../completedSession/completedSessionTypes";

function session(overrides: Partial<CompletedSessionRecord> = {}): CompletedSessionRecord {
  return {
    id: "cs-1",
    session_date: "2026-08-19",
    decision_id: "d-1",
    session_type: "DH_TECHNICAL",
    completion_status: "done",
    actual_duration_min: 120,
    rpe: 7,
    post_leg_fatigue: 5,
    post_grip_fatigue: 4,
    new_pain: false,
    new_pain_note: null,
    intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
    main_content: null,
    session_load: 84,
    updated_at: "2026-08-19T20:00:00Z",
    technical_outcome: "yes",
    change_reason: null,
    change_reason_note: null,
    ...overrides,
  };
}

describe("matchPerformedSession — V0.3_007D exact FK association (§12/§13/§14)", () => {
  it("CASE A: an exact decision_id match -> linked, carrying the exact session", () => {
    const s = session({ decision_id: "d-1", session_date: "2026-08-19" });
    const result = matchPerformedSession("d-1", "2026-08-19", [s]);
    expect(result).toEqual({ kind: "linked", session: s });
  });

  it("CASE C: no session at all on that date -> none, never inferred as skipped", () => {
    const result = matchPerformedSession("d-1", "2026-08-19", []);
    expect(result).toEqual({ kind: "none" });
  });

  it("CASE B: a same-day session exists but decision_id is NULL (free/unlinked) -> same_day_unassociated, never fabricated as this decision's performed truth", () => {
    const free = session({ decision_id: null, session_date: "2026-08-19" });
    const result = matchPerformedSession("d-1", "2026-08-19", [free]);
    expect(result).toEqual({ kind: "same_day_unassociated" });
  });

  it("CASE B: a same-day session exists but decision_id points to a DIFFERENT decision -> same_day_unassociated, never shown as this decision's performed truth", () => {
    const otherDecisionSession = session({ decision_id: "d-2", session_date: "2026-08-19" });
    const result = matchPerformedSession("d-1", "2026-08-19", [otherDecisionSession]);
    expect(result).toEqual({ kind: "same_day_unassociated" });
  });

  it("two decisions same day (A/B), completed linked to A -> A gets linked, B gets same_day_unassociated (never A's performed data)", () => {
    const linkedToA = session({ decision_id: "decision-A", session_date: "2026-08-19" });
    const allSessions = [linkedToA];

    const resultA = matchPerformedSession("decision-A", "2026-08-19", allSessions);
    const resultB = matchPerformedSession("decision-B", "2026-08-19", allSessions);

    expect(resultA).toEqual({ kind: "linked", session: linkedToA });
    expect(resultB).toEqual({ kind: "same_day_unassociated" });
  });

  it("ignores a session on a different date entirely -> none for a date with no session, regardless of unrelated dates present", () => {
    const otherDateSession = session({ decision_id: "d-1", session_date: "2026-08-20" });
    const result = matchPerformedSession("d-1", "2026-08-19", [otherDateSession]);
    expect(result).toEqual({ kind: "none" });
  });
});

describe("buildLinkedSessionsByDecisionId — V0.3_007D list indicator (§15)", () => {
  it("includes only exact decision_id links, keyed by decision id", () => {
    const linked = session({ decision_id: "d-1" });
    const map = buildLinkedSessionsByDecisionId([linked]);
    expect(map.get("d-1")).toBe(linked);
    expect(map.size).toBe(1);
  });

  it("excludes a free/unlinked session (decision_id null) — no decision id to key it by", () => {
    const free = session({ decision_id: null });
    const map = buildLinkedSessionsByDecisionId([free]);
    expect(map.size).toBe(0);
  });

  it("two decisions same day, completed linked to A only -> map has an entry for A, none for B", () => {
    const linkedToA = session({ decision_id: "decision-A" });
    const map = buildLinkedSessionsByDecisionId([linkedToA]);
    expect(map.has("decision-A")).toBe(true);
    expect(map.has("decision-B")).toBe(false);
  });
});

describe("locked athlete-facing copy (§28)", () => {
  it("never claims a genuinely skipped session for CASE C", () => {
    expect(NO_COMPLETED_SESSION_COPY).toBe("Pas de séance enregistrée.");
    expect(NO_COMPLETED_SESSION_COPY.toLowerCase()).not.toContain("non faite");
    expect(NO_COMPLETED_SESSION_COPY.toLowerCase()).not.toContain("skip");
  });

  it("CASE B copy is neutral and never exposes another session's details", () => {
    expect(SAME_DAY_UNASSOCIATED_COPY).toBe("Une séance a été enregistrée ce jour-là, mais elle n'est pas associée à ce plan.");
  });
});
