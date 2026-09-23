import { describe, it, expect } from "vitest";
import { mapPlanInputRecentHistory } from "../../../src/supabase/mapping/mapPlanInputRecentHistory.js";
import type { CompletedSessionRawRow } from "../../../src/supabase/repositories/completedSessionsRepo.js";

function row(overrides: Partial<CompletedSessionRawRow> = {}): CompletedSessionRawRow {
  return {
    session_date: "2026-09-01",
    session_type: "STRENGTH_A",
    intervention: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" },
    completion_status: "done",
    actual_duration_min: 60,
    ...overrides,
  };
}

describe("mapPlanInputRecentHistory — V0.5_007", () => {
  it("excludes a 'done' row from recentMissedOrReplacedCount", () => {
    const result = mapPlanInputRecentHistory([row({ completion_status: "done" })]);
    expect(result.recentMissedOrReplacedCount).toBe(0);
  });

  it("excludes a 'partial' row from recentMissedOrReplacedCount", () => {
    const result = mapPlanInputRecentHistory([row({ completion_status: "partial" })]);
    expect(result.recentMissedOrReplacedCount).toBe(0);
  });

  it("counts a 'skipped' row in recentMissedOrReplacedCount", () => {
    const result = mapPlanInputRecentHistory([row({ completion_status: "skipped", intervention: null, actual_duration_min: null })]);
    expect(result.recentMissedOrReplacedCount).toBe(1);
  });

  it("counts a 'replaced' row in recentMissedOrReplacedCount", () => {
    const result = mapPlanInputRecentHistory([row({ completion_status: "replaced" })]);
    expect(result.recentMissedOrReplacedCount).toBe(1);
  });

  it("returns zeroed-out fields for an empty history — never an error", () => {
    const result = mapPlanInputRecentHistory([]);
    expect(result).toEqual({ recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 });
  });

  it("aggregates correctly across multiple rows of mixed statuses", () => {
    const rows: CompletedSessionRawRow[] = [
      row({ session_date: "2026-08-28", completion_status: "done", intervention: { kind: "AEROBIC_BASE", load_profile: "MODERATE" }, actual_duration_min: 90 }),
      row({ session_date: "2026-08-29", completion_status: "skipped", intervention: null, actual_duration_min: null }),
      row({ session_date: "2026-08-30", completion_status: "replaced", intervention: { kind: "DH_LIGHT", load_profile: "LIGHT" }, actual_duration_min: 45 }),
      row({ session_date: "2026-08-31", completion_status: "partial", intervention: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" }, actual_duration_min: 30 }),
    ];

    const result = mapPlanInputRecentHistory(rows);

    expect(result.recentMissedOrReplacedCount).toBe(2); // skipped + replaced
    expect(result.trailingVolumeMinutes).toBe(165); // 90 + 45 + 30 (skipped row's null contributes 0)
    expect(result.recentSessionKinds).toEqual(["AEROBIC_BASE", "DH_LIGHT", "STRENGTH_UPPER"]); // skipped excluded, order preserved
  });

  it("is pure — the same input produces the exact same output on repeated calls, and never mutates its argument", () => {
    const rows: CompletedSessionRawRow[] = [row({ completion_status: "replaced" }), row({ session_date: "2026-09-02", completion_status: "skipped", intervention: null })];
    const snapshot = JSON.parse(JSON.stringify(rows));

    const first = mapPlanInputRecentHistory(rows);
    const second = mapPlanInputRecentHistory(rows);

    expect(first).toEqual(second);
    expect(rows).toEqual(snapshot);
  });
});
