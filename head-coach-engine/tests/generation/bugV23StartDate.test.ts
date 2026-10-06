import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanInputSnapshotV2, PlanV2InMemory } from "planning-engine/session-model-v2";
import { runInMemoryPlanGenerationV2 } from "../../src/generation/v2/runInMemoryPlanGenerationV2.js";
import { addCalendarDays, planStartDateFor, PRODUCT_TIMEZONE, productToday } from "../../src/supabase/productCalendar.js";

// BUG-V2-3 — a new plan starts the day after the product calendar's today
// (Europe/Zurich), in the morning as at 22:00; its first session is the next
// compatible day (BUG-V2-1), and the block progression (BUG-V2-2) is intact.

type Window = PlanInputSnapshotV2["availability"]["windows"][number];
const w = (dayOfWeek: Window["dayOfWeek"], startTime: string, endTime: string, activity?: "physical" | "riding"): Window => ({ dayOfWeek, startTime, endTime, ...(activity ? { activity } : {}) });
const ALL_DAY: Window[] = [0, 1, 2, 3, 4, 5, 6].map((d) => w(d as Window["dayOfWeek"], "08:00", "20:00"));

function snapshot(overrides: Partial<PlanInputSnapshotV2> = {}): PlanInputSnapshotV2 {
  return {
    discipline: "Downhill",
    races: [],
    availability: { windows: ALL_DAY, exceptions: [] },
    equipment: ["dumbbells", "bench"],
    terrainAccess: ["flow_trail", "bermed_trail"],
    strengthExperienceTier: "intermediate",
    declaredLimitations: [],
    technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
    lockedDates: [],
    recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 },
    dhTechnicalTier: "intermediate",
    ...overrides,
  };
}

/** The real generation path at a given server instant: product today → block → V2 plan. */
async function generateAt(now: Date, s: PlanInputSnapshotV2 = snapshot(), durationWeeks = 2): Promise<{ today: string; plan: PlanV2InMemory }> {
  const today = productToday(now);
  let n = 0;
  const result = await runInMemoryPlanGenerationV2(
    { planningModel: "v2", client: {} as SupabaseClient, athleteId: "a1", today, durationWeeks },
    { buildPlanInputSnapshotV2: async () => s, mintId: () => `id-${++n}` }
  );
  if (result.status !== "generated") throw new Error(`expected a generated plan, got ${JSON.stringify(result)}`);
  return { today, plan: result.plan };
}

const sessions = (p: PlanV2InMemory) => p.weeks.flatMap((wk) => wk.sessions);
const firstSessionDate = (p: PlanV2InMemory) => sessions(p).map((s) => s.date).sort()[0];

describe("BUG-V2-3 — product today (Europe/Zurich), never the UTC date", () => {
  it("is the Zurich calendar date in the morning, the afternoon and late in the evening", () => {
    expect(PRODUCT_TIMEZONE).toBe("Europe/Zurich");
    expect(productToday(new Date("2026-10-06T06:00:00Z"))).toBe("2026-10-06"); // 08:00 CEST
    expect(productToday(new Date("2026-10-06T13:00:00Z"))).toBe("2026-10-06"); // 15:00
    expect(productToday(new Date("2026-10-06T20:00:00Z"))).toBe("2026-10-06"); // 22:00
    expect(productToday(new Date("2026-10-06T21:59:59Z"))).toBe("2026-10-06"); // 23:59:59
  });

  it("F — around midnight UTC the local date is already the next day (where the UTC date is wrong)", () => {
    const now = new Date("2026-10-06T22:30:00Z"); // 00:30 CEST on 7 October
    expect(now.toISOString().slice(0, 10)).toBe("2026-10-06");
    expect(productToday(now)).toBe("2026-10-07");
    expect(productToday(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01"); // 00:30 CET, year boundary
  });

  it("DST changes (last Sunday of March / October) keep the right local date", () => {
    expect(productToday(new Date("2026-03-28T23:30:00Z"))).toBe("2026-03-29"); // 00:30 CET, the night clocks go forward
    expect(productToday(new Date("2026-03-29T21:30:00Z"))).toBe("2026-03-29"); // 23:30 CEST
    expect(productToday(new Date("2026-10-24T22:30:00Z"))).toBe("2026-10-25"); // 00:30 CEST, the night clocks go back
    expect(productToday(new Date("2026-10-25T22:30:00Z"))).toBe("2026-10-25"); // 23:30 CET
  });

  it("plan start = the next calendar day", () => {
    expect(planStartDateFor("2026-10-06")).toBe("2026-10-07");
    expect(planStartDateFor("2026-10-31")).toBe("2026-11-01");
    expect(planStartDateFor("2026-12-31")).toBe("2027-01-01");
    expect(addCalendarDays("2026-10-25", 1)).toBe("2026-10-26"); // DST night: still one calendar day
  });
});

describe("BUG-V2-3 — cases A to H (real V2 generation)", () => {
  it("A — morning (today available): the plan starts tomorrow, nothing today — the same explicit rule as in the evening", async () => {
    const { today, plan } = await generateAt(new Date("2026-10-06T06:00:00Z"));
    expect(today).toBe("2026-10-06");
    expect(plan.horizon.startDate).toBe("2026-10-07");
    expect(sessions(plan).some((s) => s.date <= today)).toBe(false);
    expect(firstSessionDate(plan)).toBe("2026-10-07");
  });

  it("B — 22:00: no session today, first session on the next compatible day; same plan as in the morning", async () => {
    const morning = await generateAt(new Date("2026-10-06T06:00:00Z"));
    const late = await generateAt(new Date("2026-10-06T20:00:00Z"));
    expect(sessions(late.plan).some((s) => s.date === "2026-10-06")).toBe(false);
    expect(firstSessionDate(late.plan)).toBe("2026-10-07");
    expect(late.plan.planSportFingerprint).toBe(morning.plan.planSportFingerprint);
  });

  it("C — a session already done today: the new plan has nothing on today's date (whatever today's history says)", async () => {
    const done = snapshot({ recentHistory: { recentSessionKinds: ["DH_TECHNICAL"], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 90 } });
    const { today, plan } = await generateAt(new Date("2026-10-06T16:00:00Z"), done);
    expect(sessions(plan).filter((s) => s.date === today)).toEqual([]);
  });

  it("D — today unavailable, tomorrow available: the first session is tomorrow", async () => {
    // Tuesday 6 Oct (today) has no window; Wednesday has a physical window.
    const s = snapshot({ availability: { windows: [w(3, "18:00", "19:30", "physical"), w(6, "08:00", "18:00", "riding")], exceptions: [] } });
    const { plan } = await generateAt(new Date("2026-10-06T08:00:00Z"), s);
    expect(firstSessionDate(plan)).toBe("2026-10-07");
    expect(sessions(plan).find((x) => x.date === "2026-10-07")!.kind).toMatch(/^STRENGTH_|AEROBIC_BASE/);
  });

  it("E — today and the next days are not riding days: no DH invented, the first DH is on the first riding window (BUG-V2-1)", async () => {
    // Riding only on Saturday; physical Wednesday and Thursday.
    const s = snapshot({ availability: { windows: [w(3, "18:00", "19:30", "physical"), w(4, "18:00", "19:30", "physical"), w(6, "08:00", "18:00", "riding")], exceptions: [] } });
    const { plan } = await generateAt(new Date("2026-10-06T19:00:00Z"), s);
    const dh = sessions(plan).filter((x) => x.kind === "DH_TECHNICAL").map((x) => x.date);
    expect(dh[0]).toBe("2026-10-10");
    expect(dh.every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 6)).toBe(true);
  });

  it("F — generated at 00:30 Zurich (22:30 UTC the day before): the plan starts the day after the LOCAL date", async () => {
    const { today, plan } = await generateAt(new Date("2026-10-06T22:30:00Z"));
    expect(today).toBe("2026-10-07");
    expect(plan.horizon.startDate).toBe("2026-10-08");
    expect(sessions(plan).some((s) => s.date <= "2026-10-07")).toBe(false);
  });

  it("G — a close race: the shifted start keeps race-specific, taper and race weeks (BUG-V2-2)", async () => {
    // Generated Monday 5 Oct → starts Tuesday 6 Oct; race Saturday 24 – Sunday 25 Oct, in week 3.
    const s = snapshot({ races: [{ eventName: "Swiss Cup", startDate: "2026-10-24", endDate: "2026-10-25", priority: "A" }] });
    const { plan } = await generateAt(new Date("2026-10-05T10:00:00Z"), s, 3);
    expect(plan.weeks.map((wk) => [wk.startDate, wk.weekType, wk.doseSummary.progression?.role])).toEqual([
      ["2026-10-06", "development", "race_specific"],
      ["2026-10-13", "taper", "taper"],
      ["2026-10-20", "race", "race"],
    ]);
    expect(plan.weeks[2]!.sessions).toEqual([]);
  });

  it("G — the block's roles are unchanged by the shift: introduction then build, no week duplicated", async () => {
    const { plan } = await generateAt(new Date("2026-10-06T20:00:00Z"));
    expect(plan.weeks.map((wk) => [wk.weekNumber, wk.startDate, wk.endDate, wk.doseSummary.progression?.role])).toEqual([
      [1, "2026-10-07", "2026-10-13", "introduction"],
      [2, "2026-10-14", "2026-10-20", "build"],
    ]);
  });

  it("H — legacy profile (generic windows only): generation works and still starts tomorrow", async () => {
    const s = snapshot({ availability: { windows: [w(1, "18:00", "19:30"), w(2, "18:00", "20:00"), w(6, "08:00", "18:00"), w(0, "06:00", "20:00")], exceptions: [] } });
    const { today, plan } = await generateAt(new Date("2026-10-06T20:00:00Z"), s);
    expect(sessions(plan).length).toBeGreaterThan(0);
    expect(sessions(plan).some((x) => x.date <= today)).toBe(false);
  });
});
