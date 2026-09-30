import { describe, expect, it } from "vitest";
import {
  ENDURANCE_ACTIVITIES_V2,
  PROTOCOL_BLOCK_FOCUS_V2,
  PROTOCOL_CATALOG_V2,
  PROTOCOL_CATALOG_V2_ENTRIES,
  PROTOCOL_CATALOG_V2_VERSION,
  PROTOCOL_SCOPES_V2,
  type ProtocolBlockV2,
  type ProtocolIntervalsItemV2,
  type SessionProtocolV2,
} from "../../src/catalog/protocolCatalogV2.js";
import { MOBILITY_ZONES_V2, SESSION_EXERCISE_CATALOG_V2, SESSION_EXERCISE_CATALOG_V2_VERSION } from "../../src/catalog/sessionExerciseCatalogV2.js";
import { COACHING_TEXT_CATALOG, COACHING_TEXT_CATALOG_VERSION } from "../../src/catalog/coachingTextCatalog.js";
import { INTENT_CATALOG_V2, INTENT_CATALOG_V2_VERSION, SESSION_FAMILIES_V2 } from "../../src/catalog/intentCatalogV2.js";
import { DH_SESSION_FRAME_V2, SESSION_BLOCK_ROLES_V2 } from "../../src/catalog/sessionFrameV2.js";
import { SESSION_DRILL_CATALOG_V2_VERSION } from "../../src/catalog/sessionDrillCatalogV2.js";

// UX-11A.5a.3 — integrity of the Session Model V2 protocol catalogue
// (templates, not prescriptions). All content is PROVISIONAL — coaching
// validation required; no engine reads it yet (v2CatalogBoundaries.test.ts).
const P = PROTOCOL_CATALOG_V2_ENTRIES;
const blocks = (p: SessionProtocolV2): readonly ProtocolBlockV2[] => p.blocks;
const allBlocks = P.flatMap((p) => p.blocks.map((b) => ({ p, b })));
const itemsOf = (b: ProtocolBlockV2) => b.items;
const exerciseRefs = (b: ProtocolBlockV2) =>
  b.items.flatMap((i) =>
    i.kind === "exercise"
      ? [{ exerciseId: i.exerciseId, role: i.exerciseRole }]
      : i.kind === "exercise_choice"
        ? i.candidates.map((exerciseId) => ({ exerciseId, role: i.exerciseRole }))
        : []
  );

function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysDeep);
  if (value !== null && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => [k, ...keysDeep(v)]);
  return [];
}

describe("protocol catalogue V2 — identity", () => {
  it("has its own version, distinct from every other catalogue", () => {
    expect(PROTOCOL_CATALOG_V2_VERSION).toBe("session-protocols-v2.0");
    for (const other of [SESSION_EXERCISE_CATALOG_V2_VERSION, SESSION_DRILL_CATALOG_V2_VERSION, INTENT_CATALOG_V2_VERSION, COACHING_TEXT_CATALOG_VERSION]) {
      expect(PROTOCOL_CATALOG_V2_VERSION).not.toBe(other);
    }
  });

  it("contains exactly the five protocols of the phase 1 audit, with unique ids and a matching lookup map", () => {
    const ids = P.map((p) => p.protocolId);
    expect(ids).toEqual(["endurance_base_continuous", "endurance_intervals_3min", "mobility_routine_v1", "recovery_active_v1", "strength_warm_up_v1"]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(PROTOCOL_CATALOG_V2).sort()).toEqual([...ids].sort());
  });

  it("every protocol is PROVISIONAL", () => {
    for (const p of P) expect(p.validationStatus, p.protocolId).toBe("PROVISIONAL");
  });
});

describe("protocol catalogue V2 — structure and references", () => {
  it("scope, family, session kinds, block roles and focus use closed vocabularies", () => {
    for (const p of P) {
      expect(PROTOCOL_SCOPES_V2, p.protocolId).toContain(p.scope);
      expect(SESSION_FAMILIES_V2, p.protocolId).toContain(p.family);
      expect(p.sessionKinds.length, p.protocolId).toBeGreaterThan(0);
      expect(p.blocks.length, p.protocolId).toBeGreaterThan(0);
      for (const b of blocks(p)) {
        expect(SESSION_BLOCK_ROLES_V2, p.protocolId).toContain(b.role);
        if (b.focus !== undefined) expect(PROTOCOL_BLOCK_FOCUS_V2, p.protocolId).toContain(b.focus);
      }
      for (const a of p.activityOptions) expect(ENDURANCE_ACTIVITIES_V2, p.protocolId).toContain(a);
    }
  });

  it("a session protocol has an existing intent of its family covering its session kinds; a block template has none", () => {
    for (const p of P) {
      if (p.scope === "session") {
        const intent = INTENT_CATALOG_V2[p.intentId ?? ""];
        expect(intent, p.protocolId).toBeDefined();
        expect(intent!.family, p.protocolId).toBe(p.family);
        expect(intent!.selectable, p.protocolId).toBe(true);
        for (const kind of p.sessionKinds) expect(intent!.sessionKinds, p.protocolId).toContain(kind);
      } else {
        expect(p.intentId, p.protocolId).toBeNull();
      }
    }
  });

  it("every exercise reference exists in the V2 exercise catalogue and holds the role it plays", () => {
    for (const { p, b } of allBlocks) {
      for (const ref of exerciseRefs(b)) {
        const exercise = SESSION_EXERCISE_CATALOG_V2[ref.exerciseId];
        expect(exercise, `${p.protocolId} → ${ref.exerciseId}`).toBeDefined();
        expect(exercise!.roles, `${p.protocolId} → ${ref.exerciseId}`).toContain(ref.role);
      }
    }
  });

  it("an exercise choice has a sane count and enough distinct candidates", () => {
    for (const { p, b } of allBlocks) {
      for (const item of itemsOf(b)) {
        if (item.kind !== "exercise_choice") continue;
        expect(item.count.min, p.protocolId).toBeGreaterThanOrEqual(1);
        expect(item.count.min, p.protocolId).toBeLessThanOrEqual(item.count.max);
        expect(new Set(item.candidates).size, p.protocolId).toBe(item.candidates.length);
        expect(item.candidates.length, p.protocolId).toBeGreaterThanOrEqual(item.count.max);
      }
    }
  });

  it("instruction, talk-test and vigilance ids resolve to existing coaching texts of the right kind", () => {
    for (const p of P) {
      for (const id of p.vigilanceIds) expect(COACHING_TEXT_CATALOG[id]?.kind, `${p.protocolId} ${id}`).toBe("vigilance");
      for (const b of blocks(p)) {
        for (const id of b.instructionIds) expect(COACHING_TEXT_CATALOG[id]?.kind, `${p.protocolId} ${id}`).toBe("instruction");
        if (b.talkTestId !== undefined) {
          expect(COACHING_TEXT_CATALOG[b.talkTestId]?.kind, `${p.protocolId} ${b.talkTestId}`).toBe("instruction");
          expect(p.family, p.protocolId).toBe("endurance");
        }
      }
    }
  });

  it("every block carries something: an instruction, a talk test or an item", () => {
    for (const { p, b } of allBlocks) expect(b.instructionIds.length + b.items.length + (b.talkTestId ? 1 : 0), `${p.protocolId} ${b.role}`).toBeGreaterThan(0);
  });
});

describe("protocol catalogue V2 — durations, RPE and load", () => {
  it("durations are positive integer ranges; only the untimed strength ramp-up directive has no duration", () => {
    for (const { p, b } of allBlocks) {
      if (b.durationMinutes === undefined) {
        expect(`${p.protocolId}/${b.focus}`).toBe("strength_warm_up_v1/main_movement_prep");
        expect(b.items).toEqual([]);
        continue;
      }
      const { min, max } = b.durationMinutes;
      expect(Number.isInteger(min) && Number.isInteger(max), p.protocolId).toBe(true);
      expect(min, p.protocolId).toBeGreaterThan(0);
      expect(min, p.protocolId).toBeLessThanOrEqual(max);
    }
  });

  // UX-11A.5a.3 lock — semantic duration check. The shortest executable
  // session is made of the REQUIRED blocks at their minimum (an optional block
  // contributes 0); the longest one runs EVERY block at its maximum. The
  // declared total must be exactly that range, never a looser one.
  it("the declared total is exactly [sum of required block minimums, sum of every block maximum]", () => {
    const computed = P.map((p) => {
      const timed = p.blocks.filter((b) => b.durationMinutes !== undefined);
      const requiredMin = timed.reduce((sum, b) => sum + (b.optional ? 0 : b.durationMinutes!.min), 0);
      const allMax = timed.reduce((sum, b) => sum + b.durationMinutes!.max, 0);
      return [p.protocolId, { min: requiredMin, max: allMax }];
    });
    expect(Object.fromEntries(P.map((p) => [p.protocolId, p.totalDurationMinutes]))).toEqual(Object.fromEntries(computed));
  });

  it("locked totals: endurance base 45–90, intervals 53, mobility 22–30, recovery 20–55, strength warm-up 6–8 (ramp-up excluded)", () => {
    const totals = Object.fromEntries(P.map((p) => [p.protocolId, p.totalDurationMinutes]));
    expect(totals).toEqual({
      endurance_base_continuous: { min: 45, max: 90 },
      endurance_intervals_3min: { min: 53, max: 53 },
      mobility_routine_v1: { min: 22, max: 30 },
      recovery_active_v1: { min: 20, max: 55 },
      strength_warm_up_v1: { min: 6, max: 8 },
    });
  });

  it("6 × 3 min of work + 5 × 2 easy min between repetitions = 28 min; no easy part after the last repetition", () => {
    const main = PROTOCOL_CATALOG_V2["endurance_intervals_3min"]!.blocks.find((b) => b.role === "main")!;
    const item = main.items[0] as ProtocolIntervalsItemV2;
    expect(item.repetitions * item.workSeconds).toBe(6 * 3 * 60);
    expect((item.repetitions - 1) * item.easySeconds).toBe(5 * 2 * 60);
    expect(main.durationMinutes).toEqual({ min: 28, max: 28 });
  });

  it("an intervals block lasts exactly its repetitions and the easy parts between them", () => {
    for (const { p, b } of allBlocks) {
      for (const item of itemsOf(b).filter((i): i is ProtocolIntervalsItemV2 => i.kind === "intervals")) {
        const seconds = item.repetitions * item.workSeconds + (item.repetitions - 1) * item.easySeconds;
        expect(b.durationMinutes, p.protocolId).toEqual({ min: seconds / 60, max: seconds / 60 });
      }
    }
  });

  it("the minimal reference dose of the fixed exercises of a block fits in the block's maximum duration", () => {
    for (const { p, b } of allBlocks) {
      if (b.durationMinutes === undefined) continue;
      const minSeconds = b.items.reduce((sum, i) => {
        if (i.kind !== "exercise") return sum;
        const e = SESSION_EXERCISE_CATALOG_V2[i.exerciseId]!;
        return sum + e.referencePrescription.sets.min * (e.referencePrescription.durationSeconds?.min ?? 0) * (e.perSide ? 2 : 1);
      }, 0);
      expect(minSeconds, `${p.protocolId}/${b.focus ?? b.role}`).toBeLessThanOrEqual(b.durationMinutes.max * 60);
    }
  });

  it("every RPE target is an integer range between 1 and 10", () => {
    const rpes = allBlocks.flatMap(({ p, b }) => [
      ...(b.targetRpe ? [{ id: p.protocolId, rpe: b.targetRpe }] : []),
      ...b.items.flatMap((i) => (i.kind === "intervals" ? [{ id: p.protocolId, rpe: i.workRpe }] : [])),
    ]);
    expect(rpes.length).toBeGreaterThan(0);
    for (const { id, rpe } of rpes) {
      expect(Number.isInteger(rpe.min) && Number.isInteger(rpe.max), id).toBe(true);
      expect(rpe.min, id).toBeGreaterThanOrEqual(1);
      expect(rpe.max, id).toBeLessThanOrEqual(10);
      expect(rpe.min, id).toBeLessThanOrEqual(rpe.max);
    }
  });

  it("mobility and the strength warm-up carry no RPE; recovery never goes above RPE 3", () => {
    for (const { p, b } of allBlocks) {
      if (p.family === "mobility" || p.scope === "block_template") expect(b.targetRpe, p.protocolId).toBeUndefined();
      if (p.family === "recovery" && b.targetRpe) expect(b.targetRpe.max, p.protocolId).toBeLessThanOrEqual(3);
    }
  });

  it("no protocol prescribes a load, a percentage, a heart-rate zone or a power target, and none carries a prescriptionItemId", () => {
    const forbidden = /kg|load|1rm|percent|ftp|heart|hr_?zone|watt|prescriptionItemId/i;
    for (const p of P) expect(keysDeep(p).filter((k) => forbidden.test(k)), p.protocolId).toEqual([]);
  });
});

describe("protocol catalogue V2 — family rules (03 §3, §5)", () => {
  const get = (id: string) => PROTOCOL_CATALOG_V2[id]!;

  it("endurance: RPE on the main block with the talk test for the base session; the rider chooses among the four audited activities", () => {
    const base = get("endurance_base_continuous");
    expect(base.totalDurationMinutes).toEqual({ min: 45, max: 90 });
    const main = base.blocks.find((b) => b.role === "main")!;
    expect(main).toMatchObject({ durationMinutes: { min: 30, max: 75 }, targetRpe: { min: 3, max: 4 }, talkTestId: "instruction.endurance.talk_test_full_sentences" });
    expect(base.blocks.map((b) => [b.durationMinutes, b.targetRpe])).toEqual([
      [{ min: 10, max: 10 }, { min: 2, max: 3 }],
      [{ min: 30, max: 75 }, { min: 3, max: 4 }],
      [{ min: 5, max: 5 }, { min: 2, max: 2 }],
    ]);
    expect(base.blocks.map((b) => b.role)).toEqual(["warm_up", "main", "cool_down"]);
    for (const p of [base, get("endurance_intervals_3min")]) expect([...p.activityOptions], p.protocolId).toEqual(["road_bike", "mtb_rolling", "home_trainer", "running"]);
  });

  it("intervals: 6 × 3 min at RPE 8 with 2 easy minutes between; the 4 × 3 min variant is documented but never auto-selectable", () => {
    const p = get("endurance_intervals_3min");
    expect(p.blocks.map((b) => [b.role, b.durationMinutes])).toEqual([
      ["warm_up", { min: 15, max: 15 }],
      ["main", { min: 28, max: 28 }],
      ["cool_down", { min: 10, max: 10 }],
    ]);
    const item = p.blocks[1]!.items[0] as ProtocolIntervalsItemV2;
    expect(item).toMatchObject({ kind: "intervals", repetitions: 6, workSeconds: 180, workRpe: { min: 8, max: 8 }, easySeconds: 120 });
    expect(item.variants).toEqual([{ variantId: "4x3min", repetitions: 4, autoSelectable: false }]);
  });

  it("intervals: warm-up and cool-down RPE stay deliberately undefined (duration + instructions only), recorded as an open question", () => {
    const p = get("endurance_intervals_3min");
    for (const b of p.blocks.filter((x) => x.role !== "main")) {
      expect(b.targetRpe, b.role).toBeUndefined();
      expect(b.durationMinutes, b.role).toBeDefined();
      expect(b.instructionIds.length, b.role).toBeGreaterThan(0);
    }
    expect(p.openQuestions).toContain("endurance_intervals.warm_up_cool_down_rpe");
  });

  it("mobility: one block per targeted zone (hips, ankles, spine, wrists), duration-measured exercises of that zone, ending with breathing", () => {
    const p = get("mobility_routine_v1");
    expect(p.totalDurationMinutes).toEqual({ min: 22, max: 30 });
    // Block doses are content (PROVISIONAL), never adjusted to satisfy a total (ADR UX-11A.5a.3 lock, correction).
    expect(p.blocks.map((b) => b.durationMinutes)).toEqual([
      { min: 9, max: 11 },
      { min: 3, max: 4 },
      { min: 5, max: 7 },
      { min: 2, max: 3 },
      { min: 3, max: 5 },
    ]);
    expect(p.openQuestions).toContain("mobility_routine.total_25_min_pending_dose_validation");
    expect(p.blocks.map((b) => b.focus)).toEqual([...MOBILITY_ZONES_V2, "breathing"]);
    for (const b of p.blocks.slice(0, -1)) {
      for (const ref of exerciseRefs(b)) {
        const e = SESSION_EXERCISE_CATALOG_V2[ref.exerciseId]!;
        expect(e.zones, ref.exerciseId).toContain(b.focus);
        expect(e.measureType, ref.exerciseId).toBe("duration");
      }
    }
    expect(p.blocks.at(-1)).toMatchObject({ role: "cool_down", items: [{ kind: "exercise", exerciseId: "breathing_long_exhale" }] });
    expect(p.vigilanceIds).toContain("vigilance.mobility_no_forced_range");
    expect(exerciseRefs(p.blocks[1]!).map((r) => r.exerciseId)).toEqual(["knee_to_wall_ankle"]);
  });

  it("recovery: explicit intent, required low-intensity main block with a duration; mobility and breathing are optional", () => {
    const p = get("recovery_active_v1");
    expect(p.intentId).toBe("recovery_without_fatigue");
    const required = p.blocks.filter((b) => !b.optional);
    expect(required).toHaveLength(1);
    expect(required[0]).toMatchObject({ role: "main", durationMinutes: { min: 20, max: 40 }, targetRpe: { min: 2, max: 3 } });
    expect(p.blocks.filter((b) => b.optional).map((b) => b.focus)).toEqual(["mobility", "breathing"]);
    expect(p.totalDurationMinutes).toEqual({ min: 20, max: 55 });
  });

  it("recovery: no closed activity list (\"activité très facile\"), and never the endurance list by default", () => {
    const p = get("recovery_active_v1");
    expect(p.activityOptions).toEqual([]);
    expect(p.blocks[0]!.instructionIds).toEqual(["instruction.recovery.very_easy_activity"]);
    expect(p.openQuestions).toContain("recovery_active.activity_options");
  });

  it("single_leg_calf_raise is never part of the mobility routine or of active recovery", () => {
    for (const id of ["mobility_routine_v1", "recovery_active_v1"]) {
      const refs = get(id).blocks.flatMap((b) => exerciseRefs(b).map((r) => r.exerciseId));
      expect(refs, id).not.toContain("single_leg_calf_raise");
    }
  });

  it("strength warm-up: a block template with no intent — mobility then activation choices, then an untimed PROVISIONAL ramp-up directive (no dynamic exercise reference)", () => {
    const p = get("strength_warm_up_v1");
    expect(p.scope).toBe("block_template");
    expect(p.family).toBe("strength");
    expect(p.blocks.every((b) => b.role === "warm_up")).toBe(true);
    expect(p.blocks.map((b) => b.focus)).toEqual(["mobility", "activation", "main_movement_prep"]);
    expect(p.blocks[0]!.items).toMatchObject([{ kind: "exercise_choice", exerciseRole: "warm_up", count: { min: 1, max: 2 } }]);
    expect(p.blocks[1]!.items).toMatchObject([{ kind: "exercise_choice", exerciseRole: "activation", count: { min: 1, max: 2 } }]);
    expect(p.blocks[2]).toEqual({ role: "warm_up", focus: "main_movement_prep", optional: false, instructionIds: ["instruction.strength_warm_up.main_movement_ramp"], items: [] });
    expect(p.openQuestions).toContain("strength_warm_up.main_movement_ramp_sets");
  });

  it("strength warm-up: 3–4 light exercises in total from mobility + activation (1–2 each); 1 + 1 is never valid; the ramp-up is outside this count", () => {
    const p = get("strength_warm_up_v1");
    expect(p.exerciseCount).toEqual({ min: 3, max: 4 });
    const choices = p.blocks.flatMap((b) => b.items.filter((i) => i.kind === "exercise_choice"));
    expect(choices.map((c) => c.count)).toEqual([{ min: 1, max: 2 }, { min: 1, max: 2 }]);
    const valid: string[] = [];
    for (let mobility = choices[0]!.count.min; mobility <= choices[0]!.count.max; mobility++) {
      for (let activation = choices[1]!.count.min; activation <= choices[1]!.count.max; activation++) {
        const total = mobility + activation;
        if (total >= p.exerciseCount!.min && total <= p.exerciseCount!.max) valid.push(`${mobility}+${activation}`);
      }
    }
    expect(valid).toEqual(["1+2", "2+1", "2+2"]);
    const ramp = p.blocks.find((b) => b.focus === "main_movement_prep")!;
    expect(ramp.items).toEqual([]);
  });

  it("an exercise count, when declared, is reachable from the exercise choices of the protocol", () => {
    for (const p of P) {
      if (p.exerciseCount === undefined) continue;
      const choices = p.blocks.flatMap((b) => b.items.filter((i) => i.kind === "exercise_choice"));
      const min = choices.reduce((sum, c) => sum + c.count.min, 0);
      const max = choices.reduce((sum, c) => sum + c.count.max, 0);
      expect(p.exerciseCount.min, p.protocolId).toBeGreaterThanOrEqual(min);
      expect(p.exerciseCount.max, p.protocolId).toBeLessThanOrEqual(max);
      expect(p.exerciseCount.min, p.protocolId).toBeLessThanOrEqual(p.exerciseCount.max);
    }
  });
});

describe("protocol catalogue V2 — no duplication of the DH session frame", () => {
  it("no protocol is a DH protocol, targets a DH session kind or reuses a DH frame instruction", () => {
    const dhInstructions = new Set(DH_SESSION_FRAME_V2.flatMap((b) => b.instructionIds));
    for (const p of P) {
      expect(p.family, p.protocolId).not.toBe("dh_technical");
      for (const kind of p.sessionKinds) expect(kind, p.protocolId).not.toMatch(/^DH_|^PUMPTRACK$/);
      for (const b of p.blocks) {
        expect(b.role, p.protocolId).not.toBe("brief");
        expect(b.role, p.protocolId).not.toBe("application");
        for (const id of b.instructionIds) expect(dhInstructions.has(id), `${p.protocolId} ${id}`).toBe(false);
      }
    }
  });
});
