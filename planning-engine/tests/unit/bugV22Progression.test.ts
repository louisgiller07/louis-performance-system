import { describe, expect, it } from "vitest";
import {
  generatePlanV2InMemory,
  type ExerciseItemV2Content,
  type PlanInputSnapshotV2,
  type PlanV2InMemory,
} from "../../src/sessionModelV2/index.js";
import { runPlanningPipeline } from "../../src/pipeline/planningPipelineOrchestrator.js";
import { availabilityByDate } from "../../src/pipeline/availabilityActivity.js";
import { PLAN_DH_DURATION_STEPS_V2, PLAN_DOSE_POLICY_V2, PLAN_PROGRESSION_CAPS_V2, PLAN_ROLE_DOSES_V2 } from "../../src/catalog/planDosePolicyV2.js";
import { DH_DRILL_PASSES_RANGE_V2 } from "../../src/catalog/sessionDrillCatalogV2.js";
import { PROTOCOL_CATALOG_V2 } from "../../src/catalog/protocolCatalogV2.js";
import type { PlanInputAvailabilityWindow, PlanInputLockedDate } from "../../src/types/planInputSnapshot.js";
import type { WeekProgressionSummary } from "../../src/types/planWeek.js";

// BUG-V2-2 — a 6-week V2 block is a real progression (week roles, executable
// doses that change, races reshaping the block), never 6 cloned weeks, and
// BUG-V2-1 availability stays the top constraint. Doses are PROVISIONAL
// content; the assertions lock the mechanism and the current values.

const w = (dayOfWeek: PlanInputAvailabilityWindow["dayOfWeek"], startTime: string, endTime: string, activity?: "physical" | "riding"): PlanInputAvailabilityWindow => ({
  dayOfWeek,
  startTime,
  endTime,
  ...(activity !== undefined ? { activity } : {}),
});
// BUG-V2-1 case A: physical Mon 80 / Tue 90 / Thu 80 min in the evening, riding Saturday and Sunday.
const CASE_A_WINDOWS = [w(1, "18:00", "19:20", "physical"), w(2, "18:00", "19:30", "physical"), w(4, "18:00", "19:20", "physical"), w(6, "08:00", "18:00", "riding"), w(0, "08:00", "18:00", "riding")];
const NO_HISTORY = { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 };

function snapshot(overrides: Partial<PlanInputSnapshotV2> = {}): PlanInputSnapshotV2 {
  return {
    discipline: "Downhill",
    races: [],
    availability: { windows: CASE_A_WINDOWS, exceptions: [] },
    equipment: ["dumbbells", "bench"],
    terrainAccess: ["flow_trail", "bermed_trail", "technical_trail"],
    strengthExperienceTier: "intermediate",
    declaredLimitations: [],
    technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
    lockedDates: [],
    recentHistory: NO_HISTORY,
    dhTechnicalTier: "intermediate",
    ...overrides,
  };
}

const SIX_WEEKS = { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED" as const, primaryFocus: "Test", startDate: "2026-10-19", endDate: "2026-11-29" };
const race = (startDate: string, endDate: string) => ({ eventName: "Swiss Cup", startDate, endDate, priority: "A" as const });
const THURSDAYS: PlanInputLockedDate[] = ["2026-10-22", "2026-10-29", "2026-11-05", "2026-11-12", "2026-11-19", "2026-11-26"].map((date) => ({ date, reason: "club" }));

const CASES = {
  A: snapshot(),
  B: snapshot({ races: [race("2026-11-28", "2026-11-29")] }),
  C: snapshot({ races: [race("2026-10-31", "2026-11-01")] }),
  D: snapshot({ availability: { windows: [w(2, "18:00", "18:45", "physical"), w(6, "09:00", "11:00", "riding")], exceptions: [] } }),
  E: snapshot({ availability: { windows: [w(1, "18:00", "19:30"), w(2, "18:00", "20:00"), w(6, "08:00", "18:00"), w(0, "06:00", "20:00")], exceptions: [] } }),
  F: snapshot({ recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 400 }, lockedDates: THURSDAYS }),
};

function plan(s: PlanInputSnapshotV2, block = SIX_WEEKS): PlanV2InMemory {
  let n = 0;
  const r = generatePlanV2InMemory({ block, snapshot: s, mintId: () => `id-${++n}` });
  if (r.status !== "generated") throw new Error(`expected a generated plan, got ${JSON.stringify(r)}`);
  return r.plan;
}

const progression = (week: PlanV2InMemory["weeks"][number]): WeekProgressionSummary => {
  if (week.doseSummary.progression === undefined) throw new Error(`week ${week.weekNumber} has no progression`);
  return week.doseSummary.progression;
};

/** One readable line per week: role / week type, cycle, targets, what was placed, why. */
function rows(p: PlanV2InMemory): string[] {
  return p.weeks.map((week) => {
    const g = progression(week);
    const t = g.targets;
    return `${g.role}/${week.weekType} c${g.cycle} F:${t.forceDoseStep ?? "-"}${t.forceDurationMin ?? ""} DH:${t.dhDurationMin ?? "-"}x${t.dhPasses ?? "-"} E:${t.aerobicDurationMin ?? "-"} | ${g.sessionCount}s ${g.physicalMinutes}+${g.ridingMinutes} | ${g.reasonCodes.join(",")}`;
  });
}

const workItems = (s: PlanV2InMemory["weeks"][number]["sessions"][number]) =>
  s.plannedPrescription.structure.blocks.filter((b) => b.role !== "warm_up").flatMap((b) => b.items) as ExerciseItemV2Content[];
const passes = (s: PlanV2InMemory["weeks"][number]["sessions"][number]) =>
  (s.plannedPrescription.structure.blocks.find((b) => b.role === "main")!.items[0] as unknown as { measure: { count: number } }).measure.count;

/** The executable content of a week, dates excluded (a cloned week has the same one). */
const weekContent = (week: PlanV2InMemory["weeks"][number]) => JSON.stringify(week.sessions.map((s) => [s.kind, s.durationMin, s.loadProfile, s.kind.startsWith("STRENGTH") ? workItems(s).map((i) => [i.sets, i.rpeTarget]) : s.kind === "DH_TECHNICAL" ? passes(s) : null]));

/** BUG-V2-1: every session sits on a date whose window of the right activity holds its duration; never on a locked date. */
function assertRespectsAvailability(p: PlanV2InMemory, s: PlanInputSnapshotV2): void {
  const sessions = p.weeks.flatMap((wk) => wk.sessions);
  const days = new Map(availabilityByDate(sessions.map((x) => x.date), s.availability, s.lockedDates).map((d) => [d.date, d]));
  for (const x of sessions) {
    const d = days.get(x.date)!;
    const fits = (c: number | null | undefined) => c === null || (c !== undefined && c >= x.durationMin);
    const ok = x.kind === "DH_TECHNICAL" ? fits(d.riding) : x.kind === "AEROBIC_BASE" ? fits(d.physical) || fits(d.riding) : fits(d.physical);
    expect(ok, `${x.kind} ${x.durationMin} min on ${x.date}`).toBe(true);
    expect(s.lockedDates.some((l) => l.date === x.date), `${x.date} is locked`).toBe(false);
  }
}

describe("BUG-V2-2 — case A: no race, 6 weeks", () => {
  const p = plan(CASES.A);

  it("introduction → build → build+ → consolidation → build (cycle 1) → build+ (cycle 1)", () => {
    expect(rows(p)).toEqual([
      "introduction/development c0 F:LIGHT45 DH:75x5 E:45 | 5s 135+150 | block_start_baseline",
      "build/development c0 F:MODERATE60 DH:90x6 E:45 | 5s 165+180 | cycle_progression",
      "build_plus/development c0 F:MODERATE_PLUS60 DH:90x7 E:60 | 5s 180+180 | cycle_progression",
      "consolidation/deload c0 F:LIGHT45 DH:60x4 E:- | 2s 45+60 | cycle_unload",
      "build/development c1 F:MODERATE60 DH:90x7 E:60 | 5s 180+180 | cycle_progression",
      "build_plus/development c1 F:MODERATE_PLUS60 DH:90x8 E:75 | 5s 195+180 | cycle_progression",
    ]);
    expect(p.weeks.map((wk) => wk.doseSummary.totalPlannedMinutes)).toEqual([285, 345, 360, 105, 360, 375]);
  });

  it("the real prescriptions change: Force sets / RPE, DH passages, endurance minutes", () => {
    const lower = p.weeks.map((wk) => wk.sessions.find((s) => s.kind === "STRENGTH_LOWER")!);
    expect(lower.map((s) => [workItems(s)[0]!.sets, workItems(s)[0]!.rpeTarget])).toEqual([
      [3, { min: 5, max: 6 }],
      [4, { min: 7, max: 8 }],
      [5, { min: 8, max: 8 }],
      [3, { min: 5, max: 6 }],
      [4, { min: 7, max: 8 }],
      [5, { min: 8, max: 8 }],
    ]);
    expect(p.weeks.map((wk) => wk.sessions.filter((s) => s.kind === "DH_TECHNICAL").map(passes))).toEqual([[5, 5], [6, 6], [7, 7], [4], [7, 7], [8, 8]]);
    expect(p.weeks.map((wk) => wk.sessions.filter((s) => s.kind === "AEROBIC_BASE").map((s) => s.durationMin))).toEqual([[45], [45], [60], [], [60], [75]]);
  });

  it("no two consecutive weeks are clones; the plan is deterministic (no randomness)", () => {
    const contents = p.weeks.map(weekContent);
    for (let i = 1; i < contents.length; i++) expect(contents[i], `week ${i + 1}`).not.toBe(contents[i - 1]);
    expect(plan(CASES.A).planSportFingerprint).toBe(p.planSportFingerprint);
  });

  it("every week explains its role in the rationale (closed phrases)", () => {
    expect(p.weeks.map((wk) => wk.rationale)).toEqual([
      "Introduction week: baseline doses to start the block.",
      "Build week: standard development load.",
      "Overload week: the highest load of the cycle.",
      "Consolidation week: reduced load to absorb the previous weeks.",
      "Build week: load raised from the previous cycle.",
      "Overload week: the highest load of the cycle.",
    ]);
    expect(p.weeks[2]!.sessions.every((s) => s.rationale === "Overload week: the highest load of the cycle.")).toBe(true);
  });
});

describe("BUG-V2-2 — case B: race in week 6", () => {
  const p = plan(CASES.B);

  it("build up, race-specific week, taper, race — the race reshapes the end of the block", () => {
    expect(rows(p)).toEqual([
      "introduction/development c0 F:LIGHT45 DH:75x5 E:45 | 5s 135+150 | block_start_baseline",
      "build/development c0 F:MODERATE60 DH:90x6 E:45 | 5s 165+180 | cycle_progression",
      "build_plus/development c0 F:MODERATE_PLUS60 DH:90x7 E:60 | 5s 180+180 | cycle_progression",
      "race_specific/development c0 F:MODERATE60 DH:90x8 E:45 | 4s 105+180 | race_in_two_weeks",
      "taper/taper c0 F:LIGHT45 DH:60x4 E:45 | 3s 90+60 | race_in_next_week",
      "race/race c0 F:- DH:-x- E:- | 0s 0+0 | race_in_week",
    ]);
  });

  it("race-specific: riding first (max passages), one Force session without overload; no heavy legs in the last two weeks", () => {
    const specific = p.weeks[3]!;
    expect(specific.sessions.filter((s) => s.kind.startsWith("STRENGTH")).map((s) => workItems(s)[0]!.sets)).toEqual([4]);
    expect(specific.sessions.filter((s) => s.kind === "DH_TECHNICAL").map(passes)).toEqual([8, 8]);
    for (const wk of p.weeks.slice(4)) {
      for (const s of wk.sessions.filter((x) => x.kind.startsWith("STRENGTH"))) expect([s.loadProfile, workItems(s)[0]!.sets]).toEqual(["LIGHT", 3]);
    }
    expect(p.weeks[5]!.sessions).toEqual([]);
  });

  it("a race week and a race-specific week differ from every development week", () => {
    const development = p.weeks.slice(0, 3).map(weekContent);
    for (const wk of p.weeks.slice(3)) expect(development).not.toContain(weekContent(wk));
  });
});

describe("BUG-V2-2 — case C: race in week 2", () => {
  it("taper, race, then a return week at baseline and a new build cycle", () => {
    expect(rows(plan(CASES.C))).toEqual([
      "taper/taper c0 F:LIGHT45 DH:60x4 E:45 | 3s 90+60 | race_in_next_week",
      "race/race c0 F:- DH:-x- E:- | 0s 0+0 | race_in_week",
      "introduction/development c0 F:LIGHT45 DH:75x5 E:45 | 5s 135+150 | post_race_reprise",
      "build/development c0 F:MODERATE60 DH:90x6 E:45 | 5s 165+180 | cycle_progression",
      "build_plus/development c0 F:MODERATE_PLUS60 DH:90x7 E:60 | 5s 180+180 | cycle_progression",
      "consolidation/deload c0 F:LIGHT45 DH:60x4 E:- | 2s 45+60 | cycle_unload",
    ]);
  });
});

describe("BUG-V2-2 — case D: low availability (physical Tue 45 min, riding Sat 2 h)", () => {
  const p = plan(CASES.D);

  it("Force shortened to LIGHT 45 to fit, DH carries the progression; never a session created to follow the curve", () => {
    expect(rows(p)).toEqual([
      "introduction/development c0 F:LIGHT45 DH:75x5 E:45 | 2s 45+75 | block_start_baseline",
      "build/development c0 F:LIGHT45 DH:90x6 E:45 | 2s 45+90 | cycle_progression,adapted_to_availability",
      "build_plus/development c0 F:LIGHT45 DH:90x7 E:60 | 2s 45+90 | cycle_progression,adapted_to_availability",
      "consolidation/deload c0 F:LIGHT45 DH:60x4 E:- | 2s 45+60 | cycle_unload",
      "build/development c1 F:LIGHT45 DH:90x7 E:60 | 2s 45+90 | cycle_progression,adapted_to_availability",
      "build_plus/development c1 F:LIGHT45 DH:90x8 E:75 | 2s 45+90 | cycle_progression,adapted_to_availability",
    ]);
    // At most one session per available day (2 days): the rest is reported, never forced.
    expect(p.weeks.every((wk) => wk.sessions.length <= 2)).toBe(true);
    expect(p.weeks[1]!.relaxedConstraints.length).toBeGreaterThan(0);
  });

  it("a DH window shorter than 90 min shortens the DH session and caps its passages (75 min → ≤ 6)", () => {
    const short = snapshot({ availability: { windows: [w(2, "18:00", "19:00", "physical"), w(6, "09:00", "10:15", "riding")], exceptions: [] }, recentHistory: { ...NO_HISTORY, trailingVolumeMinutes: 400 } });
    const q = plan(short);
    const dh = q.weeks.flatMap((wk) => wk.sessions.filter((s) => s.kind === "DH_TECHNICAL").map((s) => [s.durationMin, passes(s)]));
    expect(dh).toEqual([[75, 6], [75, 6], [60, 4], [75, 6], [75, 6], [60, 4]]);
  });
});

describe("BUG-V2-2 — case E: legacy profile (generic 'any' windows)", () => {
  it("still generates a progressive block (legacy windows serve every activity, as before BUG-V2-1)", () => {
    expect(rows(plan(CASES.E))).toEqual([
      "introduction/development c0 F:LIGHT45 DH:75x5 E:45 | 4s 90+150 | block_start_baseline",
      "build/development c0 F:MODERATE60 DH:90x6 E:45 | 4s 120+180 | cycle_progression",
      "build_plus/development c0 F:MODERATE_PLUS60 DH:90x7 E:60 | 4s 120+180 | cycle_progression",
      "consolidation/deload c0 F:LIGHT45 DH:60x4 E:- | 2s 45+60 | cycle_unload",
      "build/development c1 F:MODERATE60 DH:90x7 E:60 | 4s 120+180 | cycle_progression",
      "build_plus/development c1 F:MODERATE_PLUS60 DH:90x8 E:75 | 4s 120+180 | cycle_progression",
    ]);
  });

  it("a legacy snapshot with no recent history field values (zeros) and no availability exceptions generates", () => {
    expect(plan(snapshot({ availability: { windows: [w(1, "08:00", "20:00"), w(6, "08:00", "20:00")], exceptions: [] } })).weeks).toHaveLength(6);
  });
});

describe("BUG-V2-2 — case F: already loaded + a fixed club session every Thursday", () => {
  const p = plan(CASES.F);

  it("starts at build (recent training), holds the load in weeks with a fixed session — no mechanical increase", () => {
    expect(rows(p)).toEqual([
      "build/development c0 F:MODERATE60 DH:90x6 E:45 | 4s 120+180 | cycle_progression,recent_training_history,fixed_sessions_hold",
      "build/development c0 F:MODERATE60 DH:90x6 E:45 | 4s 120+180 | cycle_progression,fixed_sessions_hold",
      "consolidation/deload c0 F:LIGHT45 DH:60x4 E:- | 2s 45+60 | cycle_unload",
      "build/development c1 F:MODERATE60 DH:90x6 E:45 | 4s 120+180 | cycle_progression,fixed_sessions_hold",
      "build/development c1 F:MODERATE60 DH:90x6 E:45 | 4s 120+180 | cycle_progression,fixed_sessions_hold",
      "consolidation/deload c1 F:LIGHT45 DH:60x4 E:- | 2s 45+60 | cycle_unload",
    ]);
    const minutes = p.weeks.map((wk) => wk.doseSummary.totalPlannedMinutes);
    expect(Math.max(...minutes)).toBe(minutes[0]);
  });

  it("the fixed session's date is never planned over (never doubled)", () => {
    const dates = new Set(p.weeks.flatMap((wk) => wk.sessions.map((s) => s.date)));
    for (const l of THURSDAYS) expect(dates.has(l.date)).toBe(false);
  });
});

describe("BUG-V2-2 — holds and caps", () => {
  it("≥ 2 recent missed / replaced sessions postpone the first overload (cycle 0 only)", () => {
    const p = plan(snapshot({ recentHistory: { ...NO_HISTORY, recentMissedOrReplacedCount: 2 } }));
    expect(p.weeks.map((wk) => progression(wk).role)).toEqual(["introduction", "build", "build", "consolidation", "build", "build_plus"]);
    expect(progression(p.weeks[2]!).reasonCodes).toEqual(["cycle_progression", "recent_missed_sessions_hold"]);
    expect(p.weeks[2]!.rationale).toBe("Build week: standard development load. Overload postponed: several recent sessions were missed or replaced.");
  });

  it("a beginner never reaches MODERATE_PLUS: the overload week keeps 4 sets, DH and endurance still progress", () => {
    const p = plan(snapshot({ strengthExperienceTier: "beginner" }));
    const overload = p.weeks[2]!;
    expect(progression(overload)).toMatchObject({ role: "build_plus", targets: { forceDoseStep: "MODERATE", dhPasses: 7, aerobicDurationMin: 60 } });
    expect(progression(overload).reasonCodes).toContain("beginner_strength_cap");
    expect(overload.sessions.filter((s) => s.kind.startsWith("STRENGTH")).map((s) => workItems(s)[0]!.sets)).toEqual([4, 4]);
  });

  it("caps: DH passages ≤ the drill range, endurance ≤ its protocol maximum, over a long block", () => {
    expect(PLAN_PROGRESSION_CAPS_V2.dhPassesMax).toBe(DH_DRILL_PASSES_RANGE_V2.max);
    const total = PROTOCOL_CATALOG_V2["endurance_base_continuous"]!.totalDurationMinutes!;
    expect([PLAN_PROGRESSION_CAPS_V2.aerobicMinMin, PLAN_PROGRESSION_CAPS_V2.aerobicMaxMin]).toEqual([total.min, total.max]);
    // 12 weeks, 2-h physical windows (Case A's 80-min Thursday would itself cap endurance at 75).
    const wide = [w(1, "18:00", "20:00", "physical"), w(2, "18:00", "20:00", "physical"), w(4, "18:00", "20:00", "physical"), w(6, "08:00", "18:00", "riding"), w(0, "08:00", "18:00", "riding")];
    const long = plan(snapshot({ availability: { windows: wide, exceptions: [] } }), { ...SIX_WEEKS, endDate: "2027-01-10" });
    const all = long.weeks.flatMap((wk) => wk.sessions);
    expect(Math.max(...all.filter((s) => s.kind === "DH_TECHNICAL").map(passes))).toBe(8);
    expect(Math.max(...all.filter((s) => s.kind === "AEROBIC_BASE").map((s) => s.durationMin))).toBe(90);
    for (const step of PLAN_DH_DURATION_STEPS_V2) expect(step.maxPasses).toBeLessThanOrEqual(DH_DRILL_PASSES_RANGE_V2.max);
  });

  it("taper role dose = the v2.3 taper policy; build cycle 0 = the v2.3 development policy", () => {
    const { forceDoseStep: _t, dhPassesPerCycle: _tp, aerobicMinPerCycle: _ta, ...taper } = PLAN_ROLE_DOSES_V2.taper;
    expect(taper).toEqual(PLAN_DOSE_POLICY_V2.taper);
    const { forceDoseStep: _b, dhPassesPerCycle: _bp, aerobicMinPerCycle: _ba, ...build } = PLAN_ROLE_DOSES_V2.build;
    expect(build).toEqual(PLAN_DOSE_POLICY_V2.development);
  });

  it("role doses never reuse a legacy history-adjusted value (20 / 30 / 35 min endurance, 50 / 35 Force, 80 / 50 DH, 3 passages)", () => {
    for (const dose of Object.values(PLAN_ROLE_DOSES_V2)) {
      expect([20, 30, 35]).not.toContain(dose.aerobicBaseDurationMin);
      expect([50, 35]).not.toContain(dose.forceDurationMin);
      expect([80, 50]).not.toContain(dose.dhDurationMin);
      expect(dose.dhFocusedPasses).not.toBe(3);
    }
  });
});

describe("BUG-V2-2 — BUG-V2-1 stays the top constraint (cases A–F and the BUG-V2-1 cases)", () => {
  const BUG_V2_1 = {
    "V2-1 A": CASES.A,
    "V2-1 B (physical only)": snapshot({ availability: { windows: [w(1, "18:00", "19:30", "physical"), w(3, "18:00", "19:30", "physical"), w(5, "18:00", "19:30", "physical")], exceptions: [] }, dhTechnicalTier: null }),
    "V2-1 C (riding only)": snapshot({ availability: { windows: [w(6, "08:00", "18:00", "riding"), w(0, "08:00", "18:00", "riding")], exceptions: [] } }),
    "V2-1 D (both on one day)": snapshot({ availability: { windows: [w(6, "08:00", "18:00", "riding"), w(6, "18:00", "19:00", "physical"), w(2, "18:00", "19:00", "physical")], exceptions: [] } }),
    "V2-1 E (legacy)": CASES.E,
  };
  it.each(Object.entries({ ...CASES, ...BUG_V2_1 }))("%s: every session fits a window of its activity, never on a locked date", (_label, s) => {
    assertRespectsAvailability(plan(s), s);
  });

  it("physical-only rider: no DH ever, Force / endurance still progress", () => {
    const p = plan(BUG_V2_1["V2-1 B (physical only)"]);
    const all = p.weeks.flatMap((wk) => wk.sessions);
    expect(all.some((s) => s.kind === "DH_TECHNICAL")).toBe(false);
    expect(new Set(all.filter((s) => s.kind === "STRENGTH_LOWER").map((s) => workItems(s)[0]!.sets))).toEqual(new Set([3, 4, 5]));
  });
});

describe("BUG-V2-2 — V1 untouched", () => {
  it("the V1 pipeline (no dose model) produces no progression and the same development weeks as before", () => {
    const v1 = runPlanningPipeline({
      block: { ...SIX_WEEKS, id: "b", planVersionId: "v" },
      races: [],
      availability: { windows: CASE_A_WINDOWS, exceptions: [] },
      terrainAccess: ["flow_trail"],
      lockedDates: [],
      strengthExperienceTier: "intermediate",
      recentHistory: NO_HISTORY,
    });
    expect(v1.weeks.map((wk) => wk.weekType)).toEqual(["development", "development", "development", "development", "development", "development"]);
    expect(v1.weeks.every((wk) => wk.doseSummary.progression === undefined)).toBe(true);
    expect(v1.weeks.every((wk) => wk.rationale === "Standard development week.")).toBe(true);
  });
});
