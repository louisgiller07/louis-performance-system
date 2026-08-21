import { beforeEach, describe, expect, it } from "vitest";
import { assembleDay } from "../../../src/timeline/assembleDay.js";
import { groupByDate, indexById } from "../../../src/timeline/partitioning.js";
import { checkin, completedSession, decision, healthFlag, resetIdSequence } from "./fixtures.js";

beforeEach(() => resetIdSequence());

const DAY = "2026-08-12";

function assemble(opts: {
  checkins?: ReturnType<typeof checkin>[];
  decisions?: ReturnType<typeof decision>[];
  completedSessions?: ReturnType<typeof completedSession>[];
  healthFlags?: ReturnType<typeof healthFlag>[];
}) {
  const cks = opts.checkins ?? [];
  const decs = opts.decisions ?? [];
  const sess = opts.completedSessions ?? [];
  const flags = opts.healthFlags ?? [];
  return assembleDay(
    DAY,
    groupByDate(cks, (c) => c.checkinDate),
    groupByDate(decs, (d) => d.decisionDate),
    groupByDate(sess, (s) => s.sessionDate),
    indexById(decs),
    flags
  );
}

describe("assembleDay", () => {
  it("materializes an otherwise-empty day with only activeHealthContext populated", () => {
    const f = healthFlag({ flagDate: "2026-08-01", resolvedAt: null });
    const day = assemble({ healthFlags: [f] });
    expect(day.date).toBe(DAY);
    expect(day.checkins).toEqual([]);
    expect(day.decisions).toEqual([]);
    expect(day.completedSessions).toEqual([]);
    expect(day.healthEventsCreated).toEqual([]);
    expect(day.healthEventsResolved).toEqual([]);
    expect(day.activeHealthContext).toEqual([f]);
  });

  it("orders checkins by submittedAt ASC then id ASC", () => {
    const c1 = checkin({ id: "b", checkinDate: DAY, submittedAt: "2026-08-12T08:00:00.000Z" });
    const c2 = checkin({ id: "a", checkinDate: DAY, submittedAt: "2026-08-12T07:00:00.000Z" });
    const day = assemble({ checkins: [c1, c2] });
    expect(day.checkins.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("orders decisions by computedAt ASC then id ASC", () => {
    const d1 = decision({ id: "b", decisionDate: DAY, computedAt: "2026-08-12T09:00:00.000Z" });
    const d2 = decision({ id: "a", decisionDate: DAY, computedAt: "2026-08-12T08:00:00.000Z" });
    const day = assemble({ decisions: [d1, d2] });
    expect(day.decisions.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("orders completedSessions by id ASC, and resolves linkedDecision per session", () => {
    const d = decision({ id: "d1" });
    const s1 = completedSession({ id: "b", sessionDate: DAY, decisionId: "d1" });
    const s2 = completedSession({ id: "a", sessionDate: DAY, decisionId: null });
    const day = assemble({ decisions: [d], completedSessions: [s1, s2] });
    expect(day.completedSessions.map((c) => c.completedSession.id)).toEqual(["a", "b"]);
    expect(day.completedSessions[0]?.linkedDecision).toEqual({ kind: "absent", reason: "fk_null" });
    expect(day.completedSessions[1]?.linkedDecision).toEqual({ kind: "explicit", ref: d });
  });

  describe("health event partitioning", () => {
    it("healthEventsCreated only includes flags whose flagDate equals this day", () => {
      const created = healthFlag({ flagDate: DAY });
      const before = healthFlag({ flagDate: "2026-08-01" });
      const day = assemble({ healthFlags: [created, before] });
      expect(day.healthEventsCreated).toEqual([created]);
    });

    it("healthEventsResolved only includes flags whose resolvedAt equals this day", () => {
      const resolvedToday = healthFlag({ flagDate: "2026-08-01", resolvedAt: DAY });
      const resolvedLater = healthFlag({ flagDate: "2026-08-01", resolvedAt: "2026-08-20" });
      const day = assemble({ healthFlags: [resolvedToday, resolvedLater] });
      expect(day.healthEventsResolved).toEqual([resolvedToday]);
    });

    it("a flag opened and resolved on the same day appears in both healthEventsCreated and healthEventsResolved", () => {
      const sameDay = healthFlag({ flagDate: DAY, resolvedAt: DAY });
      const day = assemble({ healthFlags: [sameDay] });
      expect(day.healthEventsCreated).toEqual([sameDay]);
      expect(day.healthEventsResolved).toEqual([sameDay]);
      expect(day.activeHealthContext).toEqual([sameDay]);
    });

    it("activeHealthContext includes concurrent flags independently, ordered by flagDate ASC then id ASC", () => {
      const older = healthFlag({ id: "z", flagDate: "2026-08-01", resolvedAt: null });
      const newer = healthFlag({ id: "a", flagDate: "2026-08-05", resolvedAt: null });
      const day = assemble({ healthFlags: [newer, older] });
      expect(day.activeHealthContext.map((f) => f.id)).toEqual(["z", "a"]);
    });

    it("a resolved-before-day flag never appears in activeHealthContext", () => {
      const resolved = healthFlag({ flagDate: "2026-07-01", resolvedAt: "2026-08-01" });
      const day = assemble({ healthFlags: [resolved] });
      expect(day.activeHealthContext).toEqual([]);
    });
  });
});
