import { describe, expect, it } from "vitest";
import { dayCompletion, hasGuidedCompletion, isDayDone, type GuidedCompletion } from "./dayCompletion";
import type { CompletedSessionRecord, CompletionStatus } from "../completedSession/completedSessionTypes";

// UX-11R.9 (F-5) — the one "day done" rule: legacy non-skipped first, else a completed guided session.
const DAY = "2026-10-05";
const legacy = (status: CompletionStatus, date = DAY) => ({ id: `cs-${status}`, session_date: date, completion_status: status }) as unknown as CompletedSessionRecord;
const guided = (date = DAY): GuidedCompletion => ({ executionId: "exec-1", sessionDate: date, decisionId: "dec-1", finalPrescriptionId: "fp-1" });

describe("dayCompletion (UX-11R.9)", () => {
  it("legacy only (V1): its status, as before", () => {
    expect(dayCompletion(DAY, [legacy("done")], [])).toMatchObject({ source: "legacy", status: "done" });
    expect(dayCompletion(DAY, [legacy("partial")], [])).toMatchObject({ source: "legacy", status: "partial" });
    expect(dayCompletion(DAY, [legacy("replaced")], [])).toMatchObject({ source: "legacy", status: "replaced" });
  });

  it("guided only (V2 completed): the day is done", () => {
    expect(dayCompletion(DAY, [], [guided()])).toEqual({ source: "guided", date: DAY, guided: guided() });
    expect(isDayDone(DAY, [], [guided()])).toBe(true);
  });

  it("both exist (history): the legacy row wins", () => {
    expect(dayCompletion(DAY, [legacy("done")], [guided()])).toMatchObject({ source: "legacy", status: "done" });
  });

  it("legacy skipped never makes the day done; a guided completion still does", () => {
    expect(dayCompletion(DAY, [legacy("skipped")], [])).toBeNull();
    expect(dayCompletion(DAY, [legacy("skipped")], [guided()])).toMatchObject({ source: "guided" });
  });

  it("nothing, or another date → not done (an open or abandoned guided session never reaches the guided list)", () => {
    expect(isDayDone(DAY, [], [])).toBe(false);
    expect(isDayDone(DAY, [legacy("done", "2026-10-04")], [guided("2026-10-06")])).toBe(false);
  });

  it("hasGuidedCompletion: only the date's own guided completion", () => {
    expect(hasGuidedCompletion(DAY, [guided()])).toBe(true);
    expect(hasGuidedCompletion(DAY, [guided("2026-10-06")])).toBe(false);
  });
});
