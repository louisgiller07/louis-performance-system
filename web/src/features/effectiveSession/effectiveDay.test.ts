import { describe, expect, it } from "vitest";
import { effectiveDay, effectiveDays, weekCounts, type EffectiveExecution, type EffectiveSources } from "./effectiveDay";
import type { DecisionHistoryRow } from "../history/historyTypes";
import type { DailyPlan, TrainingIntervention } from "../dailyPlan/dailyPlanTypes";
import type { CompletedSessionRecord } from "../completedSession/completedSessionTypes";
import { KEEP_PLAN } from "../history/historyFixtures";

// A07 — one effective session per day: execution > latest decision > plan.

const DAY = "2026-10-15";
const FORCE_60: TrainingIntervention = { kind: "STRENGTH_LOWER", load_profile: "MODERATE", duration_min: 60 };
const FORCE_LIGHT_45: TrainingIntervention = { kind: "STRENGTH_LOWER", load_profile: "LIGHT", duration_min: 45 };
const DH_90: TrainingIntervention = { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 };
const UPPER_45: TrainingIntervention = { kind: "STRENGTH_UPPER", load_profile: "LIGHT", duration_min: 45 };

function plan(decision: DailyPlan["decision"], final: TrainingIntervention, planned: TrainingIntervention | null): DailyPlan {
  return { ...KEEP_PLAN, decision, final_session: final, planned_session_before: planned, date: DAY, training: { ...KEEP_PLAN.training, session_type: final, ...(final.duration_min !== undefined ? { duration_min: final.duration_min } : {}) } };
}
function decision(id: string, createdAt: string, p: DailyPlan): DecisionHistoryRow {
  return { id, decisionDate: DAY, createdAt, finalSessionDb: "STRENGTH_A", activeModeDb: null, confidenceLevelDb: null, dailyPlan: p };
}
function execution(id: string, decisionId: string, startedAt: string, events: string[]): EffectiveExecution {
  return { executionId: id, sessionDate: DAY, decisionId, finalPrescriptionId: `fp-${decisionId}`, startedAt, events };
}
const sources = (over: Partial<EffectiveSources>): EffectiveSources => ({ decisions: [], executions: [], legacy: [], planned: [{ date: DAY, session: FORCE_60 }], ...over });

describe("A07 — effective session precedence", () => {
  it("A — no daily decision: the planned session, status planned", () => {
    expect(effectiveDay(DAY, sources({}))).toMatchObject({ session: FORCE_60, status: "planned", source: "planned", adaptation: null });
  });

  it("B — KEEP: the same session, decided, no adaptation", () => {
    expect(effectiveDay(DAY, sources({ decisions: [decision("d1", "t1", plan("KEEP", FORCE_60, FORCE_60))] }))).toMatchObject({ session: FORCE_60, status: "decided", source: "decision", adaptation: null, decisionId: "d1" });
  });

  it("C — MODIFY Force 60 → LIGHT 45: the effective session is the 45-min one (the persisted V2 final session), the plan stays as « planned »", () => {
    const day = effectiveDay(DAY, sources({ decisions: [decision("d1", "t1", plan("MODIFY", FORCE_LIGHT_45, FORCE_60))] }));
    expect(day).toMatchObject({ session: FORCE_LIGHT_45, adaptation: "MODIFY", planned: FORCE_60 });
  });

  it("E — REPLACE DH → Force: the Force everywhere, the DH only as what was planned", () => {
    expect(effectiveDay(DAY, sources({ planned: [{ date: DAY, session: DH_90 }], decisions: [decision("d1", "t1", plan("REPLACE", UPPER_45, DH_90))] }))).toMatchObject({ session: UPPER_45, adaptation: "REPLACE", planned: DH_90 });
  });

  it("F — REPLACE Force → active recovery", () => {
    expect(effectiveDay(DAY, sources({ decisions: [decision("d1", "t1", plan("REPLACE", { kind: "RECOVERY_ACTIVE" }, FORCE_60))] })).session).toEqual({ kind: "RECOVERY_ACTIVE" });
  });

  it("G — REST: a rest day (status rest, session REST), never a missed session in the week counts", () => {
    const day = effectiveDay(DAY, sources({ decisions: [decision("d1", "t1", plan("REST", { kind: "REST" }, FORCE_60))] }));
    expect(day).toMatchObject({ session: { kind: "REST" }, status: "rest", adaptation: "REST" });
    expect(weekCounts([day])).toEqual({ plannedCount: 0, performedCount: 0 });
  });

  it("H — an open execution: in progress, on its OWN decision even when a newer decision exists (frozen prescription)", () => {
    const d1 = decision("d1", "t1", plan("MODIFY", FORCE_LIGHT_45, FORCE_60));
    const d2 = decision("d2", "t2", plan("REST", { kind: "REST" }, FORCE_60));
    expect(effectiveDay(DAY, sources({ decisions: [d1, d2], executions: [execution("e1", "d1", "2026-10-15T17:00:00Z", ["started"])] }))).toMatchObject({
      session: FORCE_LIGHT_45,
      status: "in_progress",
      source: "execution",
      decisionId: "d1",
      finalPrescriptionId: "fp-d1",
    });
  });

  it("I / K — a completed execution stays authoritative after a newer decision (R9-UI-01)", () => {
    const d1 = decision("d1", "t1", plan("REPLACE", UPPER_45, DH_90));
    const d2 = decision("d2", "t2", plan("KEEP", DH_90, DH_90));
    const day = effectiveDay(DAY, sources({ decisions: [d1, d2], executions: [execution("e1", "d1", "2026-10-15T17:00:00Z", ["started", "completed"])] }));
    expect(day).toMatchObject({ session: UPPER_45, status: "completed", source: "execution", decisionId: "d1", adaptation: "REPLACE" });
    expect(weekCounts([day])).toEqual({ plannedCount: 1, performedCount: 1 });
  });

  it("J — abandoned then restarted: the restart is the active one, then the completed one; abandoned alone reads « abandoned »", () => {
    const d1 = decision("d1", "t1", plan("KEEP", FORCE_60, FORCE_60));
    const abandoned = execution("e1", "d1", "2026-10-15T17:00:00Z", ["started", "abandoned"]);
    expect(effectiveDay(DAY, sources({ decisions: [d1], executions: [abandoned] }))).toMatchObject({ status: "abandoned", source: "decision" });
    expect(effectiveDay(DAY, sources({ decisions: [d1], executions: [abandoned, execution("e2", "d1", "2026-10-15T17:30:00Z", ["started"])] }))).toMatchObject({ status: "in_progress", executionId: "e2" });
    expect(effectiveDay(DAY, sources({ decisions: [d1], executions: [abandoned, execution("e2", "d1", "2026-10-15T17:30:00Z", ["started", "completed"])] }))).toMatchObject({ status: "completed", executionId: "e2" });
  });

  it("a legacy debrief completes the day without changing which session it was; a legacy « skipped » is a non-performed day", () => {
    const d1 = decision("d1", "t1", plan("MODIFY", FORCE_LIGHT_45, FORCE_60));
    const legacy = (status: string) => [{ session_date: DAY, completion_status: status } as unknown as CompletedSessionRecord];
    expect(effectiveDay(DAY, sources({ decisions: [d1], legacy: legacy("done") }))).toMatchObject({ session: FORCE_LIGHT_45, status: "completed" });
    expect(effectiveDay(DAY, sources({ decisions: [d1], legacy: legacy("skipped") }))).toMatchObject({ status: "skipped" });
  });

  it("L — the same rows give the same days (reload)", () => {
    const s = sources({ decisions: [decision("d1", "t1", plan("MODIFY", FORCE_LIGHT_45, FORCE_60))], executions: [execution("e1", "d1", "2026-10-15T17:00:00Z", ["started", "completed"])] });
    expect(effectiveDays([DAY], s)).toEqual(effectiveDays([DAY], JSON.parse(JSON.stringify(s))));
  });

  it("week counts: a REPLACE counts once (as its replacement), a REST is not planned, completions are counted by day", () => {
    const d = (date: string, p: DailyPlan, events: string[] | null) => ({
      decisions: [{ ...decision(`d-${date}`, "t1", { ...p, date }), decisionDate: date }],
      executions: events ? [{ ...execution(`e-${date}`, `d-${date}`, `${date}T17:00:00Z`, events), sessionDate: date }] : [],
    });
    const a = d("2026-10-13", plan("REPLACE", UPPER_45, DH_90), ["started", "completed"]);
    const b = d("2026-10-14", plan("REST", { kind: "REST" }, FORCE_60), null);
    const c = d("2026-10-15", plan("KEEP", FORCE_60, FORCE_60), null);
    const all: EffectiveSources = { decisions: [...a.decisions, ...b.decisions, ...c.decisions], executions: [...a.executions], legacy: [], planned: [] };
    expect(weekCounts(effectiveDays(["2026-10-13", "2026-10-14", "2026-10-15"], all))).toEqual({ plannedCount: 2, performedCount: 1 });
  });
});
