/**
 * PHYS-02 — pure AEROBIC_INTERVALS prescription builder (Session Model V2).
 *
 * Content only: no id, no UUID, no I/O.
 *
 * Uses ONLY the `endurance_intervals_3min` protocol (protocolCatalogV2), as
 * locked by ADR UX-11A.5a.3 §5–6: 6 × 3 min at RPE 8, 2 min easy between the
 * repetitions (none after the last), warm-up and cool-down with duration and
 * instructions only (their RPE is deliberately undefined). The 4 × 3 min
 * variant is never selected (`autoSelectable: false`): no repetition count is
 * ever chosen here.
 *
 * Encoding (no new format): `PrescriptionV2` items are exercises or drills
 * only, so the protocol's intervals item is expanded into existing block
 * fields — one `main` block per work repetition (duration, RPE, the work
 * instruction) and one `main` block per easy recovery between two
 * repetitions (duration, the easy instruction), all with `items: []`.
 * The total stays the protocol's (15 + 6 × 3 + 5 × 2 + 10 = 53 min).
 *
 * activitySelection: as for the base protocol — restricted over the
 * protocol's options, only the off-terrain ones on a day without riding
 * availability (BUG-V2-1).
 */
import { PROTOCOL_CATALOG_V2, type ProtocolBlockV2, type ProtocolIntervalsItemV2 } from "../../catalog/protocolCatalogV2.js";
import type { SessionKind } from "../../types/sharedVocabulary.js";
import type { SessionModelV2CatalogManifest } from "../catalogManifest.js";
import type { BlockV2Content, PrescriptionV2Content } from "../prescriptionV2.js";
import { SessionModelV2ContractError } from "../generationErrors.js";
import { OFF_TERRAIN_ENDURANCE_ACTIVITIES_V2 } from "./aerobicBasePrescriptionV2.js";

export const AEROBIC_INTERVALS_PROTOCOL_ID = "endurance_intervals_3min";

export interface AerobicIntervalsPrescriptionV2Input {
  sessionKind: SessionKind;
  catalog: SessionModelV2CatalogManifest;
  /** BUG-V2-1 — riding availability on the session's date; absent = available. */
  ridingAvailable?: boolean;
}

const WORK_INSTRUCTION_ID = "instruction.endurance.intervals_work";
const EASY_INSTRUCTION_ID = "instruction.endurance.intervals_easy";

function fixedMinutes(block: ProtocolBlockV2): number {
  const d = block.durationMinutes;
  if (!d || d.min !== d.max) throw new SessionModelV2ContractError(`${AEROBIC_INTERVALS_PROTOCOL_ID} block ${block.role} has no fixed duration`);
  return d.min;
}

function wholeMinutes(seconds: number, what: string): number {
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds % 60 !== 0) throw new SessionModelV2ContractError(`${AEROBIC_INTERVALS_PROTOCOL_ID} ${what} is not a whole number of minutes`);
  return seconds / 60;
}

/** The protocol's generable intervals (never a variant). */
export function aerobicIntervalsProtocolV2(): { protocolTotalMinutes: number; intervals: ProtocolIntervalsItemV2 } {
  const protocol = PROTOCOL_CATALOG_V2[AEROBIC_INTERVALS_PROTOCOL_ID];
  if (!protocol || protocol.family !== "endurance" || protocol.scope !== "session" || protocol.intentId === null) {
    throw new SessionModelV2ContractError(`${AEROBIC_INTERVALS_PROTOCOL_ID} is not a usable endurance session protocol`);
  }
  const total = protocol.totalDurationMinutes;
  if (total.min !== total.max) throw new SessionModelV2ContractError(`${AEROBIC_INTERVALS_PROTOCOL_ID} has no fixed total duration`);
  const mains = protocol.blocks.filter((b) => b.role === "main");
  const item = mains.length === 1 && mains[0]!.items.length === 1 ? mains[0]!.items[0]! : undefined;
  if (!item || item.kind !== "intervals") throw new SessionModelV2ContractError(`${AEROBIC_INTERVALS_PROTOCOL_ID} must have one main block holding one intervals item`);
  return { protocolTotalMinutes: total.min, intervals: item };
}

/** The planned (and kept) duration of an intervals session: the protocol's fixed total. */
export function aerobicIntervalsDurationMinV2(): number {
  return aerobicIntervalsProtocolV2().protocolTotalMinutes;
}

export function buildAerobicIntervalsPrescriptionV2Content(input: AerobicIntervalsPrescriptionV2Input): PrescriptionV2Content {
  const protocol = PROTOCOL_CATALOG_V2[AEROBIC_INTERVALS_PROTOCOL_ID]!;
  const { protocolTotalMinutes, intervals } = aerobicIntervalsProtocolV2();
  if (!protocol.sessionKinds.includes(input.sessionKind as (typeof protocol.sessionKinds)[number])) {
    throw new SessionModelV2ContractError(`${AEROBIC_INTERVALS_PROTOCOL_ID} does not cover session kind ${input.sessionKind}`);
  }
  if (protocol.activityOptions.length === 0 || protocol.blocks.some((b) => b.optional)) {
    throw new SessionModelV2ContractError(`${AEROBIC_INTERVALS_PROTOCOL_ID} must declare its activities and no optional block`);
  }
  const activityIds =
    input.ridingAvailable === false
      ? protocol.activityOptions.filter((a) => (OFF_TERRAIN_ENDURANCE_ACTIVITIES_V2 as readonly string[]).includes(a))
      : [...protocol.activityOptions];
  if (activityIds.length === 0) throw new SessionModelV2ContractError(`${AEROBIC_INTERVALS_PROTOCOL_ID} offers no off-terrain activity for a day without riding availability`);

  const workMinutes = wholeMinutes(intervals.workSeconds, "work duration");
  const easyMinutes = wholeMinutes(intervals.easySeconds, "easy duration");
  const work = (): BlockV2Content => ({ role: "main", durationMinutes: { min: workMinutes, max: workMinutes }, rpeTarget: { ...intervals.workRpe }, instructionIds: [WORK_INSTRUCTION_ID], items: [] });
  const easy = (): BlockV2Content => ({ role: "main", durationMinutes: { min: easyMinutes, max: easyMinutes }, instructionIds: [EASY_INSTRUCTION_ID], items: [] });

  const blocks: BlockV2Content[] = protocol.blocks.flatMap((block): BlockV2Content[] => {
    if (block.role !== "main") {
      const minutes = fixedMinutes(block);
      return [
        {
          role: block.role,
          ...(block.focus !== undefined ? { focus: block.focus } : {}),
          durationMinutes: { min: minutes, max: minutes },
          ...(block.targetRpe !== undefined ? { rpeTarget: { ...block.targetRpe } } : {}),
          ...(block.talkTestId !== undefined ? { talkTestId: block.talkTestId } : {}),
          instructionIds: [...block.instructionIds],
          items: [],
        },
      ];
    }
    if (fixedMinutes(block) !== intervals.repetitions * workMinutes + (intervals.repetitions - 1) * easyMinutes) {
      throw new SessionModelV2ContractError(`${AEROBIC_INTERVALS_PROTOCOL_ID} main duration differs from its repetitions`);
    }
    return Array.from({ length: intervals.repetitions }, (_, i) => (i === 0 ? [work()] : [easy(), work()])).flat();
  });
  const total = blocks.reduce((sum, b) => sum + b.durationMinutes!.max, 0);
  if (total !== protocolTotalMinutes) throw new SessionModelV2ContractError(`${AEROBIC_INTERVALS_PROTOCOL_ID} expands to ${total} min, not ${protocolTotalMinutes}`);

  return {
    schemaVersion: "v2",
    family: "endurance",
    sessionKind: input.sessionKind,
    intentId: protocol.intentId!,
    protocolId: AEROBIC_INTERVALS_PROTOCOL_ID,
    activitySelection: { mode: "restricted", activityIds },
    catalog: input.catalog,
    blocks,
  };
}
