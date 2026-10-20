import { describe, expect, it } from "vitest";
import { DH_DAY_KINDS, isHeavyLowerBodyForce, isManualHeavyLowerBodyForce, upcomingDhFor, type UpcomingDhInput } from "./heavyLowerBeforeDh";
import { HEAVY_LOWER_BEFORE_DH } from "./weekPresentation";
import type { PlannedSessionRow, TrainingIntervention } from "./planningTypes";
import type { PlanDaySession } from "./weekPresentation";

// V1-WARN-01 — detection of a heavy lower-body Force planned by hand at J-1 / J-2 of a known DH day or
// race, from the data the planning screen loaded. Positive and negative cases; nothing is ever guessed.

const DATES = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
const MON = DATES[0]!;

/** `source: null` = a row without any source (never defaulted). */
function row(date: string, intervention: TrainingIntervention | null, source: PlannedSessionRow["source"] | null = "manual", sessionType: PlannedSessionRow["session_type"] = "STRENGTH_A"): PlannedSessionRow {
  return { planned_date: date, session_type: sessionType, intervention, planned_intent: null, is_committed: false, ...(source ? { source } : {}) };
}
const HEAVY_LOWER = { kind: "STRENGTH_LOWER", load_profile: "HEAVY" } as TrainingIntervention;
const DH = (kind = "DH_TECHNICAL") => ({ kind, load_profile: "MODERATE", duration_min: 90 }) as TrainingIntervention;
const PLAN_DH: PlanDaySession = { kind: "DH_TECHNICAL", loadProfile: "MODERATE", durationMin: 90 };

function input(over: Partial<UpcomingDhInput> & { rowsByDate?: Record<string, PlannedSessionRow> } = {}): UpcomingDhInput {
  const rows = Object.fromEntries(DATES.map((d) => [d, over.rowsByDate?.[d] ?? null]));
  return { dates: DATES, rows, planByDate: {}, planKnown: true, racesByDate: {}, racesKnown: true, ...over };
}

describe("V1-WARN-01 — what is a heavy lower-body Force planned by hand", () => {
  it("STRENGTH_LOWER at HEAVY only; never MODERATE, never upper body, never another kind", () => {
    expect(isHeavyLowerBodyForce("STRENGTH_LOWER", "HEAVY")).toBe(true);
    expect(isHeavyLowerBodyForce("STRENGTH_LOWER", "MODERATE")).toBe(false);
    expect(isHeavyLowerBodyForce("STRENGTH_UPPER", "HEAVY")).toBe(false);
    expect(isHeavyLowerBodyForce("STRENGTH_FULL_LIGHT", "HEAVY")).toBe(false);
    expect(isHeavyLowerBodyForce("POWER", "HEAVY")).toBe(false);
    expect(isHeavyLowerBodyForce("", null)).toBe(false);
  });

  it("only a manual row with an explicit intervention: a generated, unsourced or legacy row is never assumed", () => {
    expect(isManualHeavyLowerBodyForce(row(MON, HEAVY_LOWER, "manual"))).toBe(true);
    expect(isManualHeavyLowerBodyForce(row(MON, HEAVY_LOWER, "generated"))).toBe(false);
    expect(isManualHeavyLowerBodyForce(row(MON, HEAVY_LOWER, null))).toBe(false);
    expect(isManualHeavyLowerBodyForce(row(MON, null, "manual", "STRENGTH_A"))).toBe(false); // coarse STRENGTH_A is ambiguous
    expect(isManualHeavyLowerBodyForce(null)).toBe(false);
  });
});

describe("V1-WARN-01 — the known DH day or race at J+1 / J+2", () => {
  it("positive: a DH session the next day → J-1; two days later → J-2; the nearest wins", () => {
    expect(upcomingDhFor(MON, input({ rowsByDate: { "2026-11-03": row("2026-11-03", DH()) } }))).toEqual({ daysBefore: 1, date: "2026-11-03", what: "dh" });
    expect(upcomingDhFor(MON, input({ rowsByDate: { "2026-11-04": row("2026-11-04", DH()) } }))).toEqual({ daysBefore: 2, date: "2026-11-04", what: "dh" });
    expect(upcomingDhFor(MON, input({ rowsByDate: { "2026-11-03": row("2026-11-03", DH()), "2026-11-04": row("2026-11-04", DH()) } }))?.daysBefore).toBe(1);
  });

  it("positive: every DH riding kind counts, from a planned row or from the active plan when no row exists", () => {
    for (const kind of DH_DAY_KINDS) {
      expect(upcomingDhFor(MON, input({ rowsByDate: { "2026-11-03": row("2026-11-03", DH(kind)) } }))?.what, kind).toBe("dh");
    }
    expect(upcomingDhFor(MON, input({ planByDate: { "2026-11-03": PLAN_DH } }))).toEqual({ daysBefore: 1, date: "2026-11-03", what: "dh" });
  });

  it("positive: a race on J+1 or J+2 counts (race overlay loaded)", () => {
    const race = { eventName: "Hot Trail", startDate: "2026-11-04", endDate: "2026-11-04", priority: "A" as const };
    expect(upcomingDhFor(MON, input({ racesByDate: { "2026-11-04": [race] } }))).toEqual({ daysBefore: 2, date: "2026-11-04", what: "race" });
  });

  it("negative: J+3, a non-DH day, PUMPTRACK or bike maintenance → nothing", () => {
    expect(upcomingDhFor(MON, input({ rowsByDate: { "2026-11-05": row("2026-11-05", DH()) } }))).toBeNull();
    expect(upcomingDhFor(MON, input({ rowsByDate: { "2026-11-03": row("2026-11-03", { kind: "AEROBIC_BASE", load_profile: "MODERATE" } as TrainingIntervention) } }))).toBeNull();
    expect(upcomingDhFor(MON, input({ rowsByDate: { "2026-11-03": row("2026-11-03", { kind: "PUMPTRACK", load_profile: "MODERATE" } as TrainingIntervention) } }))).toBeNull();
    expect(upcomingDhFor(MON, input({ rowsByDate: { "2026-11-03": row("2026-11-03", { kind: "BIKE_MAINTENANCE" } as TrainingIntervention) } }))).toBeNull();
  });

  it("negative: the rider's own row prevails over the plan (plan DH turned into rest → no DH)", () => {
    expect(upcomingDhFor(MON, input({ rowsByDate: { "2026-11-03": row("2026-11-03", { kind: "REST" } as TrainingIntervention, "manual", "REST") }, planByDate: { "2026-11-03": PLAN_DH } }))).toBeNull();
  });

  it("negative, never guessed: a legacy DH row without intervention, an unknown plan, an unloaded race overlay", () => {
    expect(upcomingDhFor(MON, input({ rowsByDate: { "2026-11-03": row("2026-11-03", null, "manual", "DH_TECHNICAL") } }))).toBeNull();
    expect(upcomingDhFor(MON, input({ planByDate: { "2026-11-03": PLAN_DH }, planKnown: false }))).toBeNull();
    const race = { eventName: "Hot Trail", startDate: "2026-11-03", endDate: "2026-11-03", priority: "A" as const };
    expect(upcomingDhFor(MON, input({ racesByDate: { "2026-11-03": [race] }, racesKnown: false }))).toBeNull();
  });

  it("negative: nothing is assumed beyond the loaded dates (horizon end)", () => {
    const lastDay = DATES[DATES.length - 1]!;
    expect(upcomingDhFor(lastDay, input())).toBeNull();
    expect(upcomingDhFor(DATES[5]!, input({ rowsByDate: {} }))).toBeNull();
  });
});

describe("V1-WARN-01 — across two weeks (detection dates = 7 displayed days + 2 lookahead days)", () => {
  // Monday 2026-11-02 … Sunday 2026-11-08 displayed; Monday 2026-11-09 and Tuesday 2026-11-10 read for detection only.
  const WEEK = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10"];
  const across = (rowsByDate: Record<string, PlannedSessionRow>, races: Record<string, { eventName: string; startDate: string; endDate: string; priority: "A" }[]> = {}) =>
    input({ dates: WEEK, rows: Object.fromEntries(WEEK.map((d) => [d, rowsByDate[d] ?? null])), racesByDate: races });
  const FRI = "2026-11-06", SAT = "2026-11-07", SUN = "2026-11-08", NEXT_MON = "2026-11-09", NEXT_TUE = "2026-11-10";

  it("heavy Force Friday, DH Saturday → J-1", () => {
    expect(upcomingDhFor(FRI, across({ [SAT]: row(SAT, DH()) }))).toEqual({ daysBefore: 1, date: SAT, what: "dh" });
  });
  it("heavy Force Saturday, DH the next Monday → J-2, across the week", () => {
    expect(upcomingDhFor(SAT, across({ [NEXT_MON]: row(NEXT_MON, DH()) }))).toEqual({ daysBefore: 2, date: NEXT_MON, what: "dh" });
  });
  it("heavy Force Sunday, DH the next Monday (J-1) or Tuesday (J-2), across the week", () => {
    expect(upcomingDhFor(SUN, across({ [NEXT_MON]: row(NEXT_MON, DH()) }))).toEqual({ daysBefore: 1, date: NEXT_MON, what: "dh" });
    expect(upcomingDhFor(SUN, across({ [NEXT_TUE]: row(NEXT_TUE, DH("DH_LIGHT")) }))).toEqual({ daysBefore: 2, date: NEXT_TUE, what: "dh" });
  });
  it("a race the next Monday counts too; nothing beyond Tuesday is assumed", () => {
    const race = { eventName: "Hot Trail", startDate: NEXT_MON, endDate: NEXT_MON, priority: "A" as const };
    expect(upcomingDhFor(SUN, across({}, { [NEXT_MON]: [race] }))).toEqual({ daysBefore: 1, date: NEXT_MON, what: "race" });
    expect(upcomingDhFor(NEXT_TUE, across({}))).toBeNull();
  });
});

describe("V1-WARN-01 — approved wording (HPM 2026-10-20)", () => {
  it("title, statement and advice exactly as approved; nothing certifies any other session", () => {
    expect(HEAVY_LOWER_BEFORE_DH).toEqual({
      title: "Force lourde avant une journée DH",
      body: "Tu as ajouté une séance de Force lourde du bas du corps un ou deux jours avant une journée DH prévue.",
      advice: "Cet enchaînement n'a pas été validé par le coach NALYNT. Vérifie que ta récupération est suffisante et adapte ton entraînement si nécessaire.",
    });
    for (const t of Object.values(HEAVY_LOWER_BEFORE_DH)) expect(t).not.toMatch(/interdit|dangereu|blessure|médical|certifi|toutes tes séances/i);
  });
});
