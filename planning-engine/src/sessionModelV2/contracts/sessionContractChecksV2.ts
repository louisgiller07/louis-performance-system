/**
 * V2-CONTRACTS-INTEGRATION-01 (HPM 2026-10-26) — the contracts a V2 session honours, checked where V2 sessions are
 * built: plan generation (generatePlanV2InMemory, every session) and the daily final prescription
 * (buildFinalPrescriptionV2, every document it builds). Checks only: no dose, count, block or duration is changed.
 *
 * - RPE (rpeSemanticsV2): a set RPE outside a Force work item, or an activity RPE outside endurance / recovery, is a
 *   contract error (fail closed). No builder produces one; scales and values are never converted.
 * - One end (C1, sessionDurationContractV2): more than one `cool_down` block is a contract error. A Force session's
 *   end is the daily cool-down of PHYS-01.1 when its content has none.
 * - Duration against the slot (C1): CONFORME, NON CONFORME À LA BORNE HAUTE or NON CONFORME with the overflow, or
 *   NON VÉRIFIABLE when the content does not say how long it lasts (DH: its parts are not timed). Reported, never
 *   corrected: an overflowing sheet keeps every block (R46).
 * - DH quota (dhRepetitionUnitV2): a stored `pass` count is read with its unit only when its drill's signed attribution
 *   states it (V2-DH-UNIT-01, readPassMeasureV2); otherwise UNKNOWN, kept for reading, its count reported blocked
 *   (`unit_unknown`) — never presented as valid, never converted into sections or runs.
 *
 * The result is carried in memory only; nothing here is persisted or shown (the persisted contract is unchanged).
 */
import type { PrescriptionV2Content } from "../prescriptionV2.js";
import { SessionModelV2ContractError } from "../generationErrors.js";
import { checkRpeSemanticsV2, type RpeTargetUseV2 } from "./rpeSemanticsV2.js";
import { countEndBlocksV2, durationVerdictV2, strengthSessionDurationV2, type DurationRangeV2, type DurationVerdictV2 } from "./sessionDurationContractV2.js";
import { checkDhSessionPlanV2, dhRepetitionCountV2, readPassMeasureV2, type DhRepetitionCountResultV2, type DhRepetitionUnitV2, type DhSessionPlanCheckV2, type DhSessionTimePlanV2 } from "./dhRepetitionUnitV2.js";

export type SlotDurationVerdictV2 = DurationVerdictV2 | "NON VÉRIFIABLE";

export interface SessionDurationCheckV2 {
  slotMin: number;
  verdict: SlotDurationVerdictV2;
  /** The content's range (null: it does not say how long it lasts). */
  range: DurationRangeV2 | null;
  /** Minutes over the slot at the range's maximum (null when not verifiable). */
  overflowMin: number | null;
  /** strength_c1: Force or power items under C1; blocks: the blocks' own minutes; not_timed: a block has none. */
  basis: "strength_c1" | "blocks" | "not_timed";
  /** C1 — where the single end comes from. */
  end: "content" | "daily_cool_down" | "none";
}

export interface DhQuotaCheckV2 {
  drillId: string;
  /** The stored count, kept for reading. */
  storedCount: number;
  unit: DhRepetitionUnitV2;
  count: DhRepetitionCountResultV2;
  sessionPlan: DhSessionPlanCheckV2;
}

export interface SessionContractChecksV2 {
  rpe: readonly RpeTargetUseV2[];
  duration: SessionDurationCheckV2;
  dh: readonly DhQuotaCheckV2[];
}

type Content = Pick<PrescriptionV2Content, "family" | "sessionKind" | "blocks">;

/** No part of a DH session is timed in the content (brief, warm-up, rides, climbs, pauses, free descents, end). */
const UNTIMED_DH_SESSION: DhSessionTimePlanV2 = { briefMin: null, warmUpMin: null, rideMinPerRepetition: null, climbMinPerRepetition: null, pauseMinPerRepetition: null, freeDescentsMin: null, endMin: null };

/** RPE semantics and at most one end: a violation is a contract error. Returns the RPE targets, classified. */
export function assertSessionContentContractsV2(content: Content, context: string): readonly RpeTargetUseV2[] {
  const rpe = checkRpeSemanticsV2(content);
  if (rpe.issues.length > 0) throw new SessionModelV2ContractError(`${context}: RPE semantics violated (${rpe.issues.map((i) => `${i.path} ${i.code}`).join(", ")})`);
  const ends = countEndBlocksV2(content);
  if (ends > 1) throw new SessionModelV2ContractError(`${context}: ${ends} end blocks, C1 allows one`);
  return rpe.targets;
}

/** C1 — the content's duration against the minutes the plan reserves for it. Nothing is removed or shortened. */
export function sessionDurationCheckV2(content: Content, slotMin: number): SessionDurationCheckV2 {
  if (content.family === "strength" || content.family === "power") {
    const c1 = strengthSessionDurationV2(content, { withDailyCoolDown: true });
    const range = { minMin: c1.minMin, maxMin: c1.maxMin };
    return { slotMin, ...durationVerdictV2(range, slotMin), range, basis: "strength_c1", end: c1.end };
  }
  const end = countEndBlocksV2(content) > 0 ? "content" : "none";
  if (content.blocks.some((b) => b.durationMinutes === undefined)) return { slotMin, verdict: "NON VÉRIFIABLE", range: null, overflowMin: null, basis: "not_timed", end };
  const range = content.blocks.reduce((r, b) => ({ minMin: r.minMin + b.durationMinutes!.min, maxMin: r.maxMin + b.durationMinutes!.max }), { minMin: 0, maxMin: 0 });
  return { slotMin, ...durationVerdictV2(range, slotMin), range, basis: "blocks", end };
}

/** Every DH drill count of a content, read with the unit it can be trusted with: an UNKNOWN unit admits no count. */
export function dhQuotaChecksV2(content: Content, sessionBudgetMin: number): DhQuotaCheckV2[] {
  return content.blocks.flatMap((b) =>
    b.items.flatMap((item) => {
      if (item.kind !== "drill") return [];
      const read = readPassMeasureV2(item.measure, item.drillId);
      const count = dhRepetitionCountV2({ unit: read.unit, repetitions: read.count, sessionBudgetMin, descentMinPerRepetition: read.descentMinutes });
      return [{ drillId: item.drillId, storedCount: read.count, unit: read.unit, count, sessionPlan: checkDhSessionPlanV2(count.dose, UNTIMED_DH_SESSION) }];
    })
  );
}

/** V2-DH-UNIT-01 — the drills of a content whose count has no reliable unit (none prescribable from it). */
export function unreliableDhQuotaDrillsV2(content: Content): string[] {
  return dhQuotaChecksV2(content, 0)
    .filter((q) => q.count.status !== "prescribed")
    .map((q) => q.drillId);
}

/** Every contract of one built session: RPE and one end enforced, duration and DH quota reported. */
export function checkSessionContractsV2(content: Content, slotMin: number, context: string): SessionContractChecksV2 {
  const rpe = assertSessionContentContractsV2(content, context);
  const duration = sessionDurationCheckV2(content, slotMin);
  if (duration.basis === "strength_c1" && duration.end === "none") throw new SessionModelV2ContractError(`${context}: a Force session without an end (C1)`);
  return { rpe, duration, dh: dhQuotaChecksV2(content, slotMin) };
}
