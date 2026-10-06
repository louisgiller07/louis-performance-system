import { describe, expect, it } from "vitest";
import { planStartLine, planStartPhrase, planStartsLater } from "./planStart";

describe("BUG-V2-3 — plan start line", () => {
  it("relative to the rider's today: tomorrow, later, today", () => {
    expect(planStartLine("2026-10-07", "2026-10-06")).toBe("Ton programme commence demain, mercredi 7 octobre.");
    expect(planStartLine("2026-10-09", "2026-10-06")).toBe("Ton programme commence le vendredi 9 octobre.");
    expect(planStartPhrase("2026-10-06", "2026-10-06")).toBe("aujourd'hui");
  });

  it("month / year boundaries are calendar days", () => {
    expect(planStartPhrase("2026-11-01", "2026-10-31")).toBe("demain, dimanche 1 novembre");
    expect(planStartPhrase("2027-01-01", "2026-12-31")).toBe("demain, vendredi 1 janvier");
  });

  it("the plan starts later only when its start date is after today", () => {
    expect(planStartsLater("2026-10-07", "2026-10-06")).toBe(true);
    expect(planStartsLater("2026-10-06", "2026-10-06")).toBe(false);
    expect(planStartsLater("2026-10-05", "2026-10-06")).toBe(false);
  });
});
