import { describe, it, expect } from "vitest";
import { buildDailyPlan } from "../src/engine/buildDailyPlan.js";
import { inferFallbackSession } from "../src/domains/fallbackInference.js";
import { baseRawContext } from "../fixtures/louis.js";

describe("T6 — Absence de planned_session", () => {
  it("T6.1 — Fallback d'inférence quand planned_session = null", () => {
    const ctx = baseRawContext({
      today: "2026-08-24", // lundi, hors fenêtre de toute course du calendrier
      active_mode: "OFF_SEASON_DEVELOPMENT",
      planned_session: null,
    });

    const plan = buildDailyPlan(ctx);

    expect(plan.event_context).toBeUndefined();
    expect(plan.triggered_rules.some((r) => r.rule_id === "INFERENCE_FALLBACK")).toBe(true);
    expect(plan.final_session).toEqual({ kind: "RECOVERY_ACTIVE" });
    // planned_session_before must stay null — "never planned" remains
    // distinct from any baseline the engine had to infer.
    expect(plan.planned_session_before).toBeNull();
  });

  // V0.3_004A — le fallback n'est plus un split hebdomadaire personnel à
  // Louis : il doit être identique, générique, quel que soit le jour de la
  // semaine. Un second athlète sans planning ne doit jamais recevoir le
  // split Lundi haut / Mardi bas / ... d'un autre athlète.
  describe("V0.3_004A — fallback générique, identique sur les 7 jours (aucun split personnel)", () => {
    const WEEKDAYS: Array<{ label: string; date: string }> = [
      { label: "lundi", date: "2026-08-24" },
      { label: "mardi", date: "2026-08-25" },
      { label: "mercredi", date: "2026-08-26" },
      { label: "jeudi", date: "2026-08-27" },
      { label: "vendredi", date: "2026-08-28" },
      { label: "samedi", date: "2026-08-29" },
      { label: "dimanche", date: "2026-08-30" },
    ];

    for (const { label, date } of WEEKDAYS) {
      it(`${label} (${date}) → RECOVERY_ACTIVE, jamais le split Louis`, () => {
        const result = inferFallbackSession(date);
        expect(result).toEqual({ kind: "RECOVERY_ACTIVE" });
      });
    }

    it("is deterministic across repeated calls for the same date", () => {
      const first = inferFallbackSession("2026-08-24");
      const second = inferFallbackSession("2026-08-24");
      expect(first).toEqual(second);
    });

    // End-to-end proof (not just the pure fallback function in isolation):
    // no race protocol + no planned_session, through the real buildDailyPlan
    // arbitration, for all 7 weekdays.
    for (const { label, date } of WEEKDAYS) {
      it(`buildDailyPlan — ${label} (${date}), no planned session, no race: final_session=RECOVERY_ACTIVE, planned_session_before stays null`, () => {
        const ctx = baseRawContext({
          today: date,
          active_mode: "OFF_SEASON_DEVELOPMENT",
          planned_session: null,
          upcoming_races: [], // isolate the fallback behavior from the fixture's own race calendar dates
        });
        const plan = buildDailyPlan(ctx);
        expect(plan.final_session).toEqual({ kind: "RECOVERY_ACTIVE" });
        expect(plan.planned_session_before).toBeNull();
      });
    }
  });

  describe("V0.3_004A — Safety REST toujours prioritaire sur le fallback générique", () => {
    it("suspected_concussion → REST malgré planned_session=null (SAFETY gagne avant tout fallback)", () => {
      const ctx = baseRawContext({
        today: "2026-08-24",
        planned_session: null,
        checkin: { suspected_concussion: true },
      });
      const plan = buildDailyPlan(ctx);
      expect(plan.final_session).toEqual({ kind: "REST" });
      expect(plan.triggered_rules.some((r) => r.rule_id === "INFERENCE_FALLBACK")).toBe(false);
    });
  });

  describe("V0.3_004C — active_mode UNSPECIFIED (aucun training_blocks courant)", () => {
    it("E — UNSPECIFIED + checkin neutre + pas de plan + pas de course → plan valide, RECOVERY_ACTIVE", () => {
      const ctx = baseRawContext({
        today: "2026-08-24",
        active_mode: "UNSPECIFIED",
        planned_session: null,
        upcoming_races: [],
      });
      const plan = buildDailyPlan(ctx);
      expect(plan.active_mode).toBe("UNSPECIFIED");
      expect(plan.final_session).toEqual({ kind: "RECOVERY_ACTIVE" });
      expect(plan.planned_session_before).toBeNull();
    });

    it("F — UNSPECIFIED + suspected_concussion → REST, Safety reste seule autorité", () => {
      const ctx = baseRawContext({
        today: "2026-08-24",
        active_mode: "UNSPECIFIED",
        planned_session: null,
        upcoming_races: [],
        checkin: { suspected_concussion: true },
      });
      const plan = buildDailyPlan(ctx);
      expect(plan.active_mode).toBe("UNSPECIFIED");
      expect(plan.final_session).toEqual({ kind: "REST" });
    });

    it("G — UNSPECIFIED + course en cours → le protocole de course garde le contrôle de la séance finale (jamais RECOVERY_ACTIVE, jamais une contrainte de mode)", () => {
      // VERBIER (fixtures/louis.ts RACE_CALENDAR) : 2026-09-11..2026-09-13.
      // today au milieu de cette plage -> event_context.in_progress = true.
      const ctx = baseRawContext({
        today: "2026-09-12",
        active_mode: "UNSPECIFIED",
        planned_session: null,
      });
      const plan = buildDailyPlan(ctx);
      expect(plan.active_mode).toBe("UNSPECIFIED");
      expect(plan.event_context?.in_progress).toBe(true);
      expect(plan.final_session.kind).toBe("RACE_ACTIVITY");
      expect(plan.final_session.kind).not.toBe("RECOVERY_ACTIVE");
    });
  });
});
