import { describe, expect, it } from "vitest";
import {
  ELIGIBLE_MISSED_REASONS_V2,
  planHistoryV2,
  realisationV2,
  type PlanHistoryActivityRowV2,
  type PlanHistoryDecisionRowV2,
  type PlanHistoryExecutionRowV2,
  type PlanHistoryFactsV2,
  type PlanHistorySetRowV2,
} from "../../../src/supabase/mapping/planHistoryV2.js";

// V2-L2-01a (HPM 2026-10-18, canon docs/05 « Historique de la génération V2 ») — the pure history of a V2 generation.

const TODAY = "2026-11-02";
const WINDOW = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"];

const EMPTY: PlanHistoryFactsV2 = { debriefs: [], executions: [], decisions: [], prescriptions: [], sets: [], activities: [], checkins: [], healthFlags: [] };
const facts = (over: Partial<PlanHistoryFactsV2>): PlanHistoryFactsV2 => ({ ...EMPTY, ...over });

const exercise = (id: string, sets: number) => ({ kind: "exercise", prescriptionItemId: id, exerciseId: "goblet_squat", sets, measure: { type: "reps", min: 6, max: 8 } });
/** Force: 2 + 2 main sets, 1 complementary set (5 slots); the warm-up exercise takes no result. */
const STRENGTH = {
  family: "strength",
  sessionKind: "STRENGTH_LOWER",
  blocks: [
    { role: "warm_up", items: [exercise("W1", 2)] },
    { role: "main", items: [exercise("A1", 2), exercise("A2", 2)] },
    { role: "complementary", items: [exercise("B1", 1)] },
  ],
};
const DH = {
  family: "dh_technical",
  sessionKind: "DH_TECHNICAL",
  blocks: [
    { role: "warm_up", items: [] },
    { role: "main", items: [{ kind: "drill", prescriptionItemId: "D1", drillId: "corner_entry", measure: { type: "pass", count: 3 } }] },
  ],
};
const POWER = { family: "power", sessionKind: "POWER", blocks: [{ role: "main", items: [exercise("P1", 2)] }] };
const ENDURANCE = { family: "endurance", sessionKind: "AEROBIC_BASE", blocks: [{ role: "main", items: [] }] };
const MOBILITY = { family: "mobility", sessionKind: "MOBILITY", blocks: [{ role: "main", items: [] }] };

const decision = (id: string, date: string, plan: { decision?: string; kind?: string; duration?: number; layers?: string[] } | null, createdAt = `${date}T06:00:00Z`): PlanHistoryDecisionRowV2 => ({
  id,
  decision_date: date,
  created_at: createdAt,
  daily_plan:
    plan === null
      ? null
      : {
          decision: plan.decision ?? "KEEP",
          final_session: { kind: plan.kind ?? "STRENGTH_LOWER", ...(plan.duration !== undefined ? { duration_min: plan.duration } : {}) },
          triggered_rules: (plan.layers ?? []).map((layer, i) => ({ layer, rule_id: `R${i}`, detail: "" })),
        },
});
const execution = (id: string, date: string, events: string[], startedAt = `${date}T17:00:00Z`): PlanHistoryExecutionRowV2 => ({
  id,
  session_date: date,
  decision_id: `dec-${id}`,
  final_prescription_id: `fp-${id}`,
  started_at: startedAt,
  events,
});
let n = 0;
const result = (execution_id: string, item: string, set_number: number, done = true, supersedes_id: string | null = null): PlanHistorySetRowV2 => ({
  id: `set-${++n}`,
  execution_id,
  prescription_item_id: item,
  set_number,
  done,
  supersedes_id,
});
const allSets = (exec: string, structure: typeof STRENGTH | typeof DH | typeof POWER) =>
  structure.blocks
    .filter((b) => b.role === "main" || b.role === "complementary")
    .flatMap((b) => b.items as Array<{ prescriptionItemId: string; sets?: number; measure: { count?: number } }>)
    .flatMap((i) => Array.from({ length: i.sets ?? i.measure.count ?? 0 }, (_, k) => result(exec, i.prescriptionItemId, k + 1)));
const activity = (execution_id: string, duration_seconds: number, id = `act-${++n}`, supersedes_id: string | null = null): PlanHistoryActivityRowV2 => ({ id, execution_id, duration_seconds, supersedes_id });

/** A guided session of `date`: its own decision (duration), prescription, results. */
function guided(id: string, date: string, structure: unknown, opts: { duration?: number; kind?: string; sets?: PlanHistorySetRowV2[]; activities?: PlanHistoryActivityRowV2[]; events?: string[] } = {}): Partial<PlanHistoryFactsV2> {
  return {
    executions: [execution(id, date, opts.events ?? ["started", "completed"])],
    decisions: [decision(`dec-${id}`, date, { kind: opts.kind ?? "STRENGTH_LOWER", ...(opts.duration !== undefined ? { duration: opts.duration } : {}) })],
    prescriptions: [{ id: `fp-${id}`, structure }],
    sets: opts.sets ?? [],
    activities: opts.activities ?? [],
  };
}
function merge(...parts: Partial<PlanHistoryFactsV2>[]): PlanHistoryFactsV2 {
  const out: { [K in keyof PlanHistoryFactsV2]: unknown[] } = { debriefs: [], executions: [], decisions: [], prescriptions: [], sets: [], activities: [], checkins: [], healthFlags: [] };
  for (const p of parts) for (const k of Object.keys(out) as (keyof PlanHistoryFactsV2)[]) out[k].push(...((p[k] as unknown[]) ?? []));
  return out as unknown as PlanHistoryFactsV2;
}

/** A « Non réalisée » with every piece of evidence a missed session needs. */
function provenMissed(date: string, reason = "time_life"): Partial<PlanHistoryFactsV2> {
  return {
    debriefs: [{ session_date: date, completion_status: "skipped", actual_duration_min: null, change_reason: reason, new_pain: false }],
    decisions: [decision(`d-${date}`, date, { kind: "DH_TECHNICAL", duration: 75 })],
    checkins: [{ checkin_date: date, pain: false, fever_or_illness: false, suspected_concussion: false }],
  };
}
const skippedDay = (h: ReturnType<typeof planHistoryV2>, date: string) => h.days.find((d) => d.date === date);

describe("planHistoryV2 — window and empty history", () => {
  it("no fact → 0 minutes, 0 missed; the 8 days [today − 7, today], each without fact", () => {
    const h = planHistoryV2(EMPTY, TODAY);
    expect([h.trailingVolumeMinutes, h.recentMissedOrReplacedCount]).toEqual([0, 0]);
    expect(h.days).toEqual(WINDOW.map((date) => ({ date, fact: "none" })));
  });

  it("facts before the window or after today (simulation clock) are ignored", () => {
    const h = planHistoryV2(
      merge(
        { debriefs: [{ session_date: "2026-10-25", completion_status: "done", actual_duration_min: 300, change_reason: null, new_pain: false }] },
        { debriefs: [{ session_date: "2026-11-03", completion_status: "done", actual_duration_min: 300, change_reason: null, new_pain: false }] },
        guided("future", "2026-11-05", STRENGTH, { duration: 60, sets: allSets("future", STRENGTH) }),
        provenMissed("2026-11-04"),
        provenMissed("2026-10-25")
      ),
      TODAY
    );
    expect([h.trailingVolumeMinutes, h.recentMissedOrReplacedCount]).toEqual([0, 0]);
  });
});

describe("planHistoryV2 — realised volume", () => {
  it("Force 60 complete + DH 90 complete + endurance 52 min recorded = 202 minutes exactly", () => {
    const h = planHistoryV2(
      merge(
        guided("f", "2026-10-27", STRENGTH, { duration: 60, sets: allSets("f", STRENGTH) }),
        guided("dh", "2026-10-29", DH, { duration: 90, kind: "DH_TECHNICAL", sets: allSets("dh", DH) }),
        guided("e", "2026-10-31", ENDURANCE, { duration: 45, kind: "AEROBIC_BASE", activities: [activity("e", 52 * 60 + 59)] })
      ),
      TODAY
    );
    expect([h.trailingVolumeMinutes, h.recentMissedOrReplacedCount]).toEqual([202, 0]);
    expect(h.days.filter((d) => d.fact !== "none")).toEqual([
      { date: "2026-10-27", fact: "guided_completed", family: "strength", realisation: "complete", minutes: 60 },
      { date: "2026-10-29", fact: "guided_completed", family: "dh_technical", realisation: "complete", minutes: 90 },
      { date: "2026-10-31", fact: "guided_completed", family: "endurance", realisation: null, minutes: 52 },
    ]);
  });

  it("partial Force / DH → 0 minute, never missed; the endurance minutes stay", () => {
    const fSets = allSets("f", STRENGTH).slice(0, 4);
    const dhSets = allSets("dh", DH).slice(0, 1);
    const h = planHistoryV2(
      merge(
        guided("f", "2026-10-27", STRENGTH, { duration: 60, sets: fSets }),
        guided("dh", "2026-10-29", DH, { duration: 90, kind: "DH_TECHNICAL", sets: dhSets }),
        guided("e", "2026-10-31", ENDURANCE, { kind: "AEROBIC_BASE", activities: [activity("e", 52 * 60)] })
      ),
      TODAY
    );
    expect([h.trailingVolumeMinutes, h.recentMissedOrReplacedCount]).toEqual([52, 0]);
    expect(h.days.filter((d) => d.fact === "guided_completed").map((d) => ("realisation" in d ? d.realisation : undefined))).toEqual(["partial", "partial", null]);
  });

  it("the active result decides: a set corrected to not done → partial; a not-done set corrected to done → complete", () => {
    const sets = allSets("f", STRENGTH);
    const corrected = [...sets, result("f", "A1", 1, false, sets[0]!.id)];
    expect(realisationV2(STRENGTH, corrected)).toBe("partial");
    const notDone = sets.map((s, i) => (i === 0 ? { ...s, done: false } : s));
    expect(realisationV2(STRENGTH, notDone)).toBe("partial");
    expect(realisationV2(STRENGTH, [...notDone, result("f", "A1", 1, true, notDone[0]!.id)])).toBe("complete");
    // Item ids compare case-insensitively (uuid text); a warm-up or « other exercise » row never fills a work slot.
    expect(realisationV2(STRENGTH, sets.map((s) => ({ ...s, prescription_item_id: s.prescription_item_id!.toLowerCase() })))).toBe("complete");
    expect(realisationV2(STRENGTH, [...sets.slice(1), result("f", "W1", 1)])).toBe("partial");
    expect(realisationV2(STRENGTH, [...sets.slice(1), { ...result("f", "A1", 1), prescription_item_id: null }])).toBe("partial");
  });

  it("unqualifiable → 0 minute: two active results for one slot, unreadable or missing prescription, no work slot, no main drill", () => {
    const sets = allSets("f", STRENGTH);
    expect(realisationV2(STRENGTH, [...sets, result("f", "A1", 1)])).toBeNull();
    expect(realisationV2(null, sets)).toBeNull();
    expect(realisationV2({ ...STRENGTH, blocks: [STRENGTH.blocks[0]] }, sets)).toBeNull();
    expect(realisationV2({ ...STRENGTH, sessionKind: "STRENGTH_FULL" }, sets)).toBeNull();
    expect(realisationV2({ ...DH, blocks: [{ role: "main", items: [...DH.blocks[1]!.items, ...DH.blocks[1]!.items] }] }, allSets("dh", DH))).toBeNull();
    expect(realisationV2({ ...DH, blocks: [{ role: "main", items: [{ ...DH.blocks[1]!.items[0], measure: { type: "reps", count: 3 } }] }] }, allSets("dh", DH))).toBeNull();
    const h = planHistoryV2(
      merge(
        guided("dup", "2026-10-27", STRENGTH, { duration: 60, sets: [...sets.map((s) => ({ ...s, execution_id: "dup" })), result("dup", "A1", 1)] }),
        { ...guided("nofp", "2026-10-28", STRENGTH, { duration: 60, sets: allSets("nofp", STRENGTH) }), prescriptions: [] }
      ),
      TODAY
    );
    expect(h.trailingVolumeMinutes).toBe(0);
  });

  it("power, mobility, recovery → 0 minute, even complete; a complete Force without decided duration → 0", () => {
    const h = planHistoryV2(
      merge(
        guided("p", "2026-10-27", POWER, { duration: 30, kind: "POWER", sets: allSets("p", POWER) }),
        guided("m", "2026-10-28", MOBILITY, { duration: 30, kind: "MOBILITY" }),
        guided("r", "2026-10-29", { family: "recovery", sessionKind: "RECOVERY", blocks: [] }, { duration: 30, kind: "RECOVERY" }),
        guided("f", "2026-10-30", STRENGTH, { sets: allSets("f", STRENGTH) })
      ),
      TODAY
    );
    expect(h.trailingVolumeMinutes).toBe(0);
    expect(h.days.filter((d) => d.fact === "guided_completed").map((d) => ("family" in d ? [d.family, d.realisation, d.minutes] : null))).toEqual([
      ["power", null, 0],
      ["mobility", null, 0],
      ["recovery", null, 0],
      ["strength", "complete", 0],
    ]);
  });

  it("endurance: the one active activity, floored to the minute; corrected → the correction; two active or none → 0", () => {
    const one = (acts: PlanHistoryActivityRowV2[]) => planHistoryV2(merge(guided("e", "2026-10-31", ENDURANCE, { kind: "AEROBIC_BASE", activities: acts })), TODAY).trailingVolumeMinutes;
    expect(one([activity("e", 59)])).toBe(0);
    expect(one([activity("e", 3599)])).toBe(59);
    expect(one([activity("e", 3600, "o1"), activity("e", 1800, "c1", "o1")])).toBe(30);
    expect(one([activity("e", 3600), activity("e", 1800)])).toBe(0);
    expect(one([])).toBe(0);
  });

  it("V1 debriefs: done / partial / replaced count their declared minutes (absent → 0), as before", () => {
    const h = planHistoryV2(
      facts({
        debriefs: [
          { session_date: "2026-10-26", completion_status: "done", actual_duration_min: 50, change_reason: null, new_pain: false },
          { session_date: "2026-10-27", completion_status: "partial", actual_duration_min: 30, change_reason: "time_life", new_pain: false },
          { session_date: "2026-10-28", completion_status: "replaced", actual_duration_min: 40, change_reason: "activity_change", new_pain: false },
          { session_date: "2026-10-29", completion_status: "done", actual_duration_min: null, change_reason: null, new_pain: false },
        ],
      }),
      TODAY
    );
    expect([h.trailingVolumeMinutes, h.recentMissedOrReplacedCount]).toEqual([120, 0]);
  });
});

describe("planHistoryV2 — one fact per day (no double counting)", () => {
  it("a V1 debrief done and a completed guided session the same day → the debrief only", () => {
    const h = planHistoryV2(
      merge(
        { debriefs: [{ session_date: "2026-10-27", completion_status: "done", actual_duration_min: 40, change_reason: null, new_pain: false }] },
        guided("f", "2026-10-27", STRENGTH, { duration: 60, sets: allSets("f", STRENGTH) })
      ),
      TODAY
    );
    expect(h.trailingVolumeMinutes).toBe(40);
  });

  it("a V1 « Non réalisée » then a completed guided session the same day → realised, never missed", () => {
    const h = planHistoryV2(merge(provenMissed("2026-10-27"), guided("f", "2026-10-27", STRENGTH, { duration: 60, sets: allSets("f", STRENGTH) })), TODAY);
    expect([h.trailingVolumeMinutes, h.recentMissedOrReplacedCount]).toEqual([60, 0]);
  });

  it("two completed executions the same day → the first by started_at then id, counted once", () => {
    const a = guided("a", "2026-10-27", STRENGTH, { duration: 60, sets: allSets("a", STRENGTH) });
    const b = guided("b", "2026-10-27", DH, { duration: 90, kind: "DH_TECHNICAL", sets: allSets("b", DH) });
    a.executions = [execution("a", "2026-10-27", ["started", "completed"], "2026-10-27T18:00:00Z")];
    b.executions = [execution("b", "2026-10-27", ["started", "completed"], "2026-10-27T09:00:00Z")];
    expect(planHistoryV2(merge(a, b), TODAY).trailingVolumeMinutes).toBe(90);
  });

  it("an open, paused or abandoned execution → no fact (never volume, never missed)", () => {
    const h = planHistoryV2(
      merge(
        guided("o", "2026-10-27", STRENGTH, { duration: 60, events: ["started"], sets: allSets("o", STRENGTH) }),
        guided("p", "2026-10-28", STRENGTH, { duration: 60, events: ["started", "paused"], sets: allSets("p", STRENGTH) }),
        guided("x", "2026-10-29", STRENGTH, { duration: 60, events: ["started", "abandoned"], sets: allSets("x", STRENGTH) })
      ),
      TODAY
    );
    expect([h.trailingVolumeMinutes, h.recentMissedOrReplacedCount]).toEqual([0, 0]);
    expect(h.days.every((d) => d.fact === "none")).toBe(true);
  });

  it("the duration is the execution's OWN decision's, never a later decision of the day", () => {
    const g = guided("f", "2026-10-27", STRENGTH, { duration: 60, sets: allSets("f", STRENGTH) });
    g.decisions = [...g.decisions!, decision("later", "2026-10-27", { duration: 30 }, "2026-10-27T20:00:00Z")];
    expect(planHistoryV2(merge(g), TODAY).trailingVolumeMinutes).toBe(60);
  });
});

describe("planHistoryV2 — missed V2 session: every piece of evidence, or not counted", () => {
  it("two proven « Non réalisée » (time_life, motivation) → 2 missed", () => {
    const h = planHistoryV2(merge(provenMissed("2026-10-28", "time_life"), provenMissed("2026-10-30", "motivation")), TODAY);
    expect([h.trailingVolumeMinutes, h.recentMissedOrReplacedCount]).toEqual([0, 2]);
    expect(skippedDay(h, "2026-10-28")).toEqual({ date: "2026-10-28", fact: "debrief_skipped", missed: true, why: "missed" });
  });

  it("each eligible reason counts; every other reason, or none, never does", () => {
    for (const reason of ELIGIBLE_MISSED_REASONS_V2) expect(planHistoryV2(merge(provenMissed("2026-10-28", reason)), TODAY).recentMissedOrReplacedCount).toBe(1);
    for (const reason of ["pain", "fatigue_control", "coach_criterion", "activity_change", "other"]) {
      const h = planHistoryV2(merge(provenMissed("2026-10-28", reason)), TODAY);
      expect([h.recentMissedOrReplacedCount, (skippedDay(h, "2026-10-28") as { why: string }).why]).toEqual([0, "reason_not_eligible"]);
    }
    const none = provenMissed("2026-10-28");
    none.debriefs = [{ ...none.debriefs![0]!, change_reason: null }];
    expect(planHistoryV2(merge(none), TODAY).recentMissedOrReplacedCount).toBe(0);
  });

  it("today itself is never missed (the day is not over)", () => {
    const h = planHistoryV2(merge(provenMissed(TODAY)), TODAY);
    expect([h.recentMissedOrReplacedCount, (skippedDay(h, TODAY) as { why: string }).why]).toEqual([0, "not_past"]);
  });

  it("new pain declared on the debrief → not counted", () => {
    const p = provenMissed("2026-10-28");
    p.debriefs = [{ ...p.debriefs![0]!, new_pain: true }];
    expect((skippedDay(planHistoryV2(merge(p), TODAY), "2026-10-28") as { why: string }).why).toBe("new_pain");
  });

  it("no decision, a pre-M2 decision without plan, or a day with no training due (REST, race, maintenance) → not counted", () => {
    const why = (p: Partial<PlanHistoryFactsV2>) => (skippedDay(planHistoryV2(merge(p), TODAY), "2026-10-28") as { missed: boolean; why: string });
    expect(why({ ...provenMissed("2026-10-28"), decisions: [] })).toEqual(expect.objectContaining({ missed: false, why: "no_decision" }));
    expect(why({ ...provenMissed("2026-10-28"), decisions: [decision("d", "2026-10-28", null)] }).why).toBe("no_decision");
    expect(why({ ...provenMissed("2026-10-28"), decisions: [decision("d", "2026-10-28", { decision: "REST", kind: "REST" })] }).why).toBe("no_training_due");
    expect(why({ ...provenMissed("2026-10-28"), decisions: [decision("d", "2026-10-28", { kind: "RACE_ACTIVITY" })] }).why).toBe("no_training_due");
    expect(why({ ...provenMissed("2026-10-28"), decisions: [decision("d", "2026-10-28", { kind: "BIKE_MAINTENANCE" })] }).why).toBe("no_training_due");
  });

  it("several decisions the same day: the LATEST decides what was due; ANY safety rule of the day (layer A) prevents the count", () => {
    const day = "2026-10-28";
    const why = (decisions: PlanHistoryDecisionRowV2[]) => (skippedDay(planHistoryV2(merge({ ...provenMissed(day), decisions }), TODAY), day) as { why: string }).why;
    // training then REST (context changed during the day) → nothing due
    expect(why([decision("a", day, { kind: "DH_TECHNICAL" }, `${day}T06:00:00Z`), decision("b", day, { decision: "REST", kind: "REST" }, `${day}T12:00:00Z`)])).toBe("no_training_due");
    // REST then training → due
    expect(why([decision("a", day, { decision: "REST", kind: "REST" }, `${day}T06:00:00Z`), decision("b", day, { kind: "DH_TECHNICAL" }, `${day}T12:00:00Z`)])).toBe("missed");
    // same created_at → id desc decides (deterministic)
    expect(why([decision("b", day, { decision: "REST", kind: "REST" }, `${day}T06:00:00Z`), decision("a", day, { kind: "DH_TECHNICAL" }, `${day}T06:00:00Z`)])).toBe("no_training_due");
    // a safety rule earlier in the day, a training decision later → not counted
    expect(why([decision("a", day, { decision: "REST", kind: "REST", layers: ["A"] }, `${day}T06:00:00Z`), decision("b", day, { kind: "DH_TECHNICAL", layers: ["B"] }, `${day}T12:00:00Z`)])).toBe("safety_rule");
    // a pre-M2 decision the same day (no plan to inspect) → doubt → not counted
    expect(why([decision("a", day, null, `${day}T06:00:00Z`), decision("b", day, { kind: "DH_TECHNICAL" }, `${day}T12:00:00Z`)])).toBe("safety_rule");
    // non-safety layers never prevent it
    expect(why([decision("b", day, { kind: "DH_TECHNICAL", layers: ["B", "C", "ARBITRATION"] })])).toBe("missed");
  });

  it("the day's check-in must exist and clear pain, illness and concussion explicitly", () => {
    const day = "2026-10-28";
    const why = (checkins: PlanHistoryFactsV2["checkins"]) => (skippedDay(planHistoryV2(merge({ ...provenMissed(day), checkins }), TODAY), day) as { why: string }).why;
    const clear = { checkin_date: day, pain: false, fever_or_illness: false, suspected_concussion: false };
    expect(why([])).toBe("health_not_cleared");
    expect(why([{ ...clear, checkin_date: "2026-10-27" }])).toBe("health_not_cleared");
    expect(why([{ ...clear, pain: true }])).toBe("health_not_cleared");
    expect(why([{ ...clear, pain: null }])).toBe("health_not_cleared");
    expect(why([{ ...clear, fever_or_illness: true }])).toBe("health_not_cleared");
    expect(why([{ ...clear, suspected_concussion: null }])).toBe("health_not_cleared");
    expect(why([clear])).toBe("missed");
  });

  it("a health signal covering the day prevents the count: open since before, closed on or after it, inconsistent", () => {
    const day = "2026-10-28";
    const why = (healthFlags: PlanHistoryFactsV2["healthFlags"]) => (skippedDay(planHistoryV2(merge({ ...provenMissed(day), healthFlags }), TODAY), day) as { why: string }).why;
    expect(why([{ flag_date: "2026-10-20", status: "active", resolved_at: null }])).toBe("health_signal");
    expect(why([{ flag_date: day, status: "active", resolved_at: null }])).toBe("health_signal");
    expect(why([{ flag_date: "2026-10-20", status: "monitoring", resolved_at: null }])).toBe("health_signal");
    expect(why([{ flag_date: "2026-10-20", status: "resolved", resolved_at: day }])).toBe("health_signal");
    expect(why([{ flag_date: "2026-10-20", status: "resolved", resolved_at: "2026-10-30" }])).toBe("health_signal");
    // closed without resolution day, or resolution before opening → the whole window
    expect(why([{ flag_date: "2026-10-30", status: "resolved", resolved_at: null }])).toBe("health_signal");
    expect(why([{ flag_date: "2026-10-30", status: "resolved", resolved_at: "2026-10-29" }])).toBe("health_signal");
    expect(why([{ flag_date: "2026-09-10", status: "resolved", resolved_at: "2026-09-01" }])).toBe("health_signal");
    // closed before the day, or opened after it → does not cover it
    expect(why([{ flag_date: "2026-10-20", status: "resolved", resolved_at: "2026-10-27" }])).toBe("missed");
    expect(why([{ flag_date: "2026-10-29", status: "active", resolved_at: null }])).toBe("missed");
  });

  it("absence of result, an open or stopped session, a rest day, a replacement → never missed", () => {
    const day = "2026-10-28";
    const h = planHistoryV2(
      merge(
        { decisions: [decision("d1", "2026-10-26", { kind: "DH_TECHNICAL", duration: 75 })], checkins: [{ checkin_date: "2026-10-26", pain: false, fever_or_illness: false, suspected_concussion: false }] },
        guided("o", "2026-10-27", STRENGTH, { duration: 60, events: ["started", "abandoned"] }),
        { decisions: [decision("d3", day, { decision: "REST", kind: "REST" })] },
        { debriefs: [{ session_date: "2026-10-29", completion_status: "replaced", actual_duration_min: 0, change_reason: "time_life", new_pain: false }] }
      ),
      TODAY
    );
    expect(h.recentMissedOrReplacedCount).toBe(0);
  });
});

describe("planHistoryV2 — determinism", () => {
  it("the same facts in any order → the same history", () => {
    const parts = merge(
      guided("f", "2026-10-27", STRENGTH, { duration: 60, sets: allSets("f", STRENGTH) }),
      guided("dh", "2026-10-29", DH, { duration: 90, kind: "DH_TECHNICAL", sets: allSets("dh", DH).slice(0, 2) }),
      guided("e", "2026-10-31", ENDURANCE, { kind: "AEROBIC_BASE", activities: [activity("e", 3100)] }),
      provenMissed("2026-10-28"),
      provenMissed("2026-10-30", "motivation")
    );
    const reversed = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, [...(v as unknown[])].reverse()])) as unknown as PlanHistoryFactsV2;
    expect(planHistoryV2(reversed, TODAY)).toEqual(planHistoryV2(parts, TODAY));
    expect(planHistoryV2(parts, TODAY)).toMatchObject({ trailingVolumeMinutes: 111, recentMissedOrReplacedCount: 2 });
  });
});
