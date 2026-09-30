import { describe, expect, it } from "vitest";
import { DAY, EDITOR, PAGE, dayBadge, dayState, planSessionsByDate } from "./weekPresentation";
import type { PlannedSessionRow } from "./planningTypes";

const row = (source?: PlannedSessionRow["source"]): PlannedSessionRow => ({
  planned_date: "2026-10-01",
  session_type: "REST",
  intervention: { kind: "REST" },
  planned_intent: null,
  is_committed: false,
  ...(source ? { source } : {}),
});
const plan = { kind: "DH_TECHNICAL", loadProfile: "MODERATE", durationMin: 90 };

describe("weekPresentation — where a day stands (UX-10B-2B)", () => {
  it.each([
    ["projection row", row("generated"), null, true, "plan"],
    ["plan day not projected yet", null, plan, true, "plan"],
    ["athlete's change of a plan day", row("manual"), plan, true, "modified"],
    ["athlete's session on a free day", row("manual"), null, true, "added"],
    ["nothing at all", null, null, true, "free"],
    ["plan unreadable, no row", null, null, false, "unknown"],
    ["plan unreadable, athlete row", row("manual"), null, false, "manual-unknown"],
  ] as const)("%s → %s", (_label, r, p, known, expected) => {
    expect(dayState(r, p, known)).toBe(expected);
  });

  it("badges: Prévue par ton plan / Modifiée par toi, never a guessed origin", () => {
    expect(dayBadge("plan", null)).toBe("Prévue par ton plan");
    expect(dayBadge("modified", row("manual"))).toBe("Modifiée par toi");
    expect(dayBadge("added", row())).toBeNull();
    expect(dayBadge("free", null)).toBeNull();
  });

  it("keeps only the plan's sessions inside the 7-day window, one per date", () => {
    const sessions = [
      { id: "a", date: "2026-10-01", kind: "REST", loadProfile: null, durationMin: null },
      { id: "b", date: "2026-10-01", kind: "DH_LIGHT", loadProfile: "LIGHT", durationMin: 60 },
      { id: "c", date: "2026-12-01", kind: "DH_LIGHT", loadProfile: "LIGHT", durationMin: 60 },
    ] as unknown as Parameters<typeof planSessionsByDate>[0];
    expect(planSessionsByDate(sessions, ["2026-10-01", "2026-10-02"])).toEqual({
      "2026-10-01": { kind: "REST", loadProfile: null, durationMin: null },
    });
  });

  it("never uses the old tool vocabulary or claims learning", () => {
    const text = [...Object.values(PAGE), ...Object.values(DAY), ...Object.values(EDITOR)].filter((v) => typeof v === "string") as string[];
    for (const value of text) {
      expect(value).not.toMatch(/le coach|apprend|analys|Non planifié|Activité engagée|Retirer du planning/i);
    }
  });
});
