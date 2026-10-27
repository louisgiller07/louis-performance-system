/**
 * SPORT-PLAN-03 V2 contracts (HPM 2026-10-25) — how long a session really is, with ONE end. NON-PRESCRIPTIVE: it
 * measures and reports, it removes nothing. Plan generation checks every session against its slot and the daily
 * final prescription its single end (sessionContractChecksV2, V2-CONTRACTS-INTEGRATION-01); no display reads it.
 *
 * Force (convention C1): warm-up, ramp-up sets, work sets with their rests (both sides of unilateral work),
 * transitions and a single end. The end is the content's own `cool_down` block when it has one; otherwise the daily
 * cool-down of PHYS-01.1 (appendStrengthCoolDownV2, which adds nothing to a content that already ends) — never both.
 * The range uses the production timings (STRENGTH_TIMING_V2) at both bounds; its maximum equals
 * estimateStrengthDurationMinutesV2.
 *
 * Block protocols (e.g. recovery_active_v1, « R46 »): the required blocks and the full sheet (optional blocks as
 * prescribed) against the minutes the plan reserves. A sheet over its slot is NON CONFORME; no block is dropped.
 */
import { STRENGTH_TIMING_V2 } from "../../catalog/strengthDailyCatalogV2.js";
import { PROTOCOL_CATALOG_V2 } from "../../catalog/protocolCatalogV2.js";
import type { ExerciseMeasureV2, PrescriptionItemV2Content, PrescriptionV2 } from "../prescriptionV2.js";
import { appendStrengthCoolDownV2 } from "../strengthDailyV2.js";
import { SessionModelV2ContractError } from "../generationErrors.js";

const T = STRENGTH_TIMING_V2;

export type DurationBoundV2 = "min" | "max";
export type DurationVerdictV2 = "CONFORME" | "NON CONFORME À LA BORNE HAUTE" | "NON CONFORME";

export interface DurationRangeV2 {
  minMin: number;
  maxMin: number;
}

/** CONFORME: the maximum fits; À LA BORNE HAUTE: only the minimum fits; NON CONFORME: even the minimum overflows. */
export function durationVerdictV2(range: DurationRangeV2, slotMin: number): { verdict: DurationVerdictV2; overflowMin: number } {
  const overflowMin = Math.max(0, range.maxMin - slotMin);
  if (range.maxMin <= slotMin) return { verdict: "CONFORME", overflowMin };
  return { verdict: range.minMin <= slotMin ? "NON CONFORME À LA BORNE HAUTE" : "NON CONFORME", overflowMin };
}

function setWorkSeconds(measure: ExerciseMeasureV2, bound: DurationBoundV2): number {
  const sides = "perSide" in measure && measure.perSide ? 2 : 1;
  switch (measure.type) {
    case "reps":
      return (bound === "min" ? measure.min : measure.max) * T.repSeconds * sides;
    case "duration":
      return (bound === "min" ? measure.minSeconds : measure.maxSeconds) * sides;
    case "distance":
      return Math.ceil((bound === "min" ? measure.minMeters : measure.maxMeters) / T.metersPerSecond);
  }
}

/** Seconds of one item at a bound (the « max » is strengthItemSecondsV2); the second side of unilateral work apart. */
export function strengthItemSecondsRangeV2(item: PrescriptionItemV2Content, bound: DurationBoundV2): { seconds: number; secondSideSeconds: number } {
  if (item.kind !== "exercise") return { seconds: 0, secondSideSeconds: 0 };
  const rest = (bound === "min" ? item.restSeconds?.min : item.restSeconds?.max) ?? 0;
  const rampUp = item.rampUp ? (bound === "min" ? item.rampUp.sets.min : item.rampUp.sets.max) * (T.rampUpSetSeconds + T.rampUpRestSeconds) : 0;
  const work = setWorkSeconds(item.measure, bound);
  const unilateral = "perSide" in item.measure && item.measure.perSide;
  return { seconds: item.sets * (T.setSetupSeconds + work) + (item.sets - 1) * rest + T.transitionSeconds + rampUp, secondSideSeconds: unilateral ? item.sets * (work / 2) : 0 };
}

type StrengthBlocks = { blocks: readonly { role: string; items: readonly PrescriptionItemV2Content[] }[] };

/** Number of end (`cool_down`) blocks of a session: C1 requires at most one. */
export function countEndBlocksV2(prescription: { blocks: readonly { role: string }[] }): number {
  return prescription.blocks.filter((b) => b.role === "cool_down").length;
}

export interface StrengthSessionDurationV2 extends DurationRangeV2 {
  /** Where the single end comes from. */
  end: "content" | "daily_cool_down" | "none";
  endBlocks: number;
  secondSideMin: number;
}

/**
 * A Force session's duration under C1. `withDailyCoolDown`: the day adds PHYS-01.1's cool-down (true for a created
 * Force final prescription); it is counted only when the content has no end of its own.
 */
export function strengthSessionDurationV2(content: StrengthBlocks & { family: string; sessionKind: string }, options: { withDailyCoolDown: boolean }): StrengthSessionDurationV2 {
  const ownEnd = countEndBlocksV2(content) > 0;
  let blocks: StrengthBlocks["blocks"] = content.blocks;
  if (!ownEnd && options.withDailyCoolDown) {
    let n = 0;
    const shell = { ...content, blocks: content.blocks.map((b, i) => ({ ...b, blockId: `b${i}`, items: b.items })) } as unknown as PrescriptionV2;
    blocks = appendStrengthCoolDownV2(shell, () => `cd-${++n}`).blocks as unknown as StrengthBlocks["blocks"];
  }
  const total = (bound: DurationBoundV2) => blocks.reduce((s, b) => s + b.items.reduce((t, i) => t + strengthItemSecondsRangeV2(i, bound).seconds, 0), 0);
  const secondSide = blocks.reduce((s, b) => s + b.items.reduce((t, i) => t + strengthItemSecondsRangeV2(i, "max").secondSideSeconds, 0), 0);
  const endBlocks = countEndBlocksV2({ blocks });
  return {
    minMin: Math.ceil(total("min") / 60),
    maxMin: Math.ceil(total("max") / 60),
    end: ownEnd ? "content" : endBlocks > 0 ? "daily_cool_down" : "none",
    endBlocks,
    secondSideMin: Math.round(secondSide / 6) / 10,
  };
}

export interface ProtocolDurationV2 {
  protocolId: string;
  reservedMin: number;
  required: DurationRangeV2;
  /** Every block of the sheet, optional ones included as prescribed. */
  fullSheet: DurationRangeV2;
  verdict: DurationVerdictV2;
  overflowMin: number;
}

/** A block protocol against the minutes reserved for it; the verdict is the full sheet's (nothing removed). */
export function protocolDurationV2(protocolId: string, reservedMin: number): ProtocolDurationV2 {
  const protocol = PROTOCOL_CATALOG_V2[protocolId];
  if (protocol === undefined) throw new SessionModelV2ContractError(`unknown protocol ${protocolId}`);
  const sum = (blocks: typeof protocol.blocks, k: "min" | "max") => blocks.reduce((n, b) => n + (b.durationMinutes?.[k] ?? 0), 0);
  const required = protocol.blocks.filter((b) => !b.optional);
  const fullSheet = { minMin: sum(protocol.blocks, "min"), maxMin: sum(protocol.blocks, "max") };
  return { protocolId, reservedMin, required: { minMin: sum(required, "min"), maxMin: sum(required, "max") }, fullSheet, ...durationVerdictV2(fullSheet, reservedMin) };
}
