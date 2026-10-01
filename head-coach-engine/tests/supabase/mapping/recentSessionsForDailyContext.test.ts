import { describe, expect, it } from "vitest";
import { mapCompletedSessionRow } from "../../../src/supabase/mapping/completedSessionRow.js";
import { mergeRecentSessionsForDailyContext, RECENT_HISTORY_V2_CONFLICT_WARNING } from "../../../src/supabase/mapping/recentSessionsForDailyContext.js";
import type { CompletedSessionRawRow } from "../../../src/supabase/repositories/completedSessionsRepo.js";
import type { CompletedExecutionRow } from "../../../src/supabase/repositories/completedSessionExecutionsRepo.js";

// UX-11B.2.4b — the M1 recent-history bridge (pure merge).

const legacy = (date: string, completion_status = "done", intervention: unknown = { kind: "STRENGTH_LOWER", load_profile: "MODERATE" }): CompletedSessionRawRow => ({
  session_date: date,
  session_type: "STRENGTH_A",
  intervention,
  completion_status,
  actual_duration_min: 60,
});
const v2 = (id: string, date: string, finalSession: unknown = { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 }): CompletedExecutionRow => ({
  executionId: id,
  sessionDate: date,
  decisionId: `d-${id}`,
  finalSession,
});

describe("mergeRecentSessionsForDailyContext", () => {
  it("legacy only: exactly the summaries the legacy mapping produced (same content, date order)", () => {
    const rows = [legacy("2026-10-06"), legacy("2026-10-04", "skipped", null), legacy("2026-10-05", "partial", { kind: "AEROBIC_BASE", load_profile: "LIGHT" })];
    const { sessions, warnings } = mergeRecentSessionsForDailyContext(rows, []);
    const before = rows.map(mapCompletedSessionRow).filter((s) => s !== null);
    expect(sessions).toEqual([...before].sort((a, b) => (a!.date < b!.date ? -1 : 1)));
    expect(warnings).toEqual([]);
  });

  it("a completed V2 execution becomes one summary: its decision's final_session, status done", () => {
    const { sessions } = mergeRecentSessionsForDailyContext([], [v2("e1", "2026-10-07")]);
    expect(sessions).toEqual([{ date: "2026-10-07", intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 }, completion_status: "done" }]);
  });

  it("retry / replay of the same session on a day → ONE summary, never two loads", () => {
    const { sessions } = mergeRecentSessionsForDailyContext([], [v2("e1", "2026-10-07"), v2("e2", "2026-10-07")]);
    expect(sessions).toHaveLength(1);
  });

  it("two completed V2 sessions with different interventions on one day → none counted, explicit warning (no arbitrary choice)", () => {
    const { sessions, warnings } = mergeRecentSessionsForDailyContext([], [v2("e1", "2026-10-07"), v2("e2", "2026-10-07", { kind: "STRENGTH_UPPER", load_profile: "MODERATE" })]);
    expect(sessions).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(RECENT_HISTORY_V2_CONFLICT_WARNING);
  });

  it("validated rule (UX-11B.2.5): conflicting completions on a day without legacy row → neither the latest nor the heaviest is chosen, none is counted, warning", () => {
    const earlierLight = v2("e1", "2026-10-07", { kind: "AEROBIC_BASE", load_profile: "LIGHT" });
    const laterHeavy = v2("e9", "2026-10-07", { kind: "STRENGTH_LOWER", load_profile: "HEAVY" });
    for (const order of [[earlierLight, laterHeavy], [laterHeavy, earlierLight]]) {
      const { sessions, warnings } = mergeRecentSessionsForDailyContext([], order);
      expect(sessions).toEqual([]);
      expect(warnings).toEqual([expect.stringContaining(RECENT_HISTORY_V2_CONFLICT_WARNING)]);
    }
  });

  it("a day with a legacy summary takes no V2 entry (one main session per day; never counted twice)", () => {
    const { sessions } = mergeRecentSessionsForDailyContext([legacy("2026-10-07")], [v2("e1", "2026-10-07")]);
    expect(sessions).toEqual([{ date: "2026-10-07", intervention: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" }, completion_status: "done" }]);
  });

  it("the legacy day summary wins even when it has no intervention (the day is still the legacy row's)", () => {
    const { sessions } = mergeRecentSessionsForDailyContext([legacy("2026-10-07", "skipped", null)], [v2("e1", "2026-10-07")]);
    expect(sessions).toEqual([]);
  });

  it("mixed history: legacy days + V2 days, both present, date order", () => {
    const { sessions } = mergeRecentSessionsForDailyContext([legacy("2026-10-04"), legacy("2026-10-05")], [v2("e1", "2026-10-07"), v2("e0", "2026-10-06")]);
    expect(sessions.map((s) => s.date)).toEqual(["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"]);
  });

  it("a V2 execution whose decision has no final_session gives no entry (nothing invented)", () => {
    expect(mergeRecentSessionsForDailyContext([], [v2("e1", "2026-10-07", null)]).sessions).toEqual([]);
  });

  it("no execution never becomes skipped or replaced", () => {
    const { sessions } = mergeRecentSessionsForDailyContext([], []);
    expect(sessions).toEqual([]);
  });

  it("deterministic: any input order → the same context", () => {
    const rows = [legacy("2026-10-05"), legacy("2026-10-03"), legacy("2026-10-04")];
    const executions = [v2("e2", "2026-10-07"), v2("e1", "2026-10-06"), v2("e3", "2026-10-07")];
    const a = mergeRecentSessionsForDailyContext(rows, executions);
    const b = mergeRecentSessionsForDailyContext([...rows].reverse(), [...executions].reverse());
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
