/**
 * UX-11A.5b.3 — pure AEROBIC_BASE prescription builder (Session Model V2).
 *
 * Content only: no id, no UUID, no I/O. Not wired into any engine.
 *
 * Uses ONLY the `endurance_base_continuous` protocol (protocolCatalogV2):
 * - intent: the protocol's own `intentId` (explicit catalogue relation);
 * - activitySelection: "restricted" over the protocol's `activityOptions`,
 *   in catalogue order — the builder never picks the activity; BUG-V2-1: on
 *   a day without riding availability only the off-terrain options
 *   (home trainer, running) are offered — never an invented bike outing;
 * - blocks: the protocol blocks with their duration, RPE, talk test and
 *   instructions, `items: []` (no fake item).
 *
 * Duration resolution (arithmetic, not a choice inside a range): every
 * block except `main` has a fixed duration; main = session duration − the
 * fixed blocks. Valid only if main stays inside the protocol's main range.
 * Otherwise `unsupported_protocol_duration`: no clamping, no proportional
 * compression, no invented shorter protocol.
 */
import { PROTOCOL_CATALOG_V2, type ProtocolBlockV2 } from "../../catalog/protocolCatalogV2.js";
import type { SessionKind } from "../../types/sharedVocabulary.js";
import type { SessionModelV2CatalogManifest } from "../catalogManifest.js";
import type { BlockV2Content, PrescriptionV2Content } from "../prescriptionV2.js";
import { SessionModelV2ContractError, SessionModelV2GenerationBlockedError } from "../generationErrors.js";

export const AEROBIC_BASE_PROTOCOL_ID = "endurance_base_continuous";

export interface AerobicBasePrescriptionV2Input {
  sessionKind: SessionKind;
  /** The planned session's durationMin. */
  durationMin: number;
  catalog: SessionModelV2CatalogManifest;
  /** BUG-V2-1 — riding availability on the session's date; absent = available (legacy behavior). */
  ridingAvailable?: boolean;
}

/** BUG-V2-1 — endurance activities that need neither a riding window nor terrain. */
export const OFF_TERRAIN_ENDURANCE_ACTIVITIES_V2 = ["home_trainer", "running"] as const;

function fixedDuration(block: ProtocolBlockV2): number {
  const d = block.durationMinutes;
  if (!d || d.min !== d.max) throw new SessionModelV2ContractError(`protocol block ${block.role} has no fixed duration`);
  return d.min;
}

export function buildAerobicBasePrescriptionV2Content(input: AerobicBasePrescriptionV2Input): PrescriptionV2Content {
  const protocol = PROTOCOL_CATALOG_V2[AEROBIC_BASE_PROTOCOL_ID];
  if (!protocol || protocol.family !== "endurance" || protocol.scope !== "session" || protocol.intentId === null) {
    throw new SessionModelV2ContractError(`${AEROBIC_BASE_PROTOCOL_ID} is not a usable endurance session protocol`);
  }
  if (!protocol.sessionKinds.includes(input.sessionKind as (typeof protocol.sessionKinds)[number])) {
    throw new SessionModelV2ContractError(`${AEROBIC_BASE_PROTOCOL_ID} does not cover session kind ${input.sessionKind}`);
  }
  if (protocol.activityOptions.length === 0) {
    throw new SessionModelV2ContractError(`${AEROBIC_BASE_PROTOCOL_ID} declares no restricted activity list`);
  }
  if (!Number.isInteger(input.durationMin) || input.durationMin <= 0) {
    throw new SessionModelV2ContractError(`durationMin must be a positive integer, got ${input.durationMin}`);
  }

  const mains = protocol.blocks.filter((b) => b.role === "main");
  if (mains.length !== 1 || protocol.blocks.some((b) => b.optional)) {
    throw new SessionModelV2ContractError(`${AEROBIC_BASE_PROTOCOL_ID} must have exactly one main block and no optional block`);
  }
  const main = mains[0]!;
  const fixedTotal = protocol.blocks.filter((b) => b !== main).reduce((sum, b) => sum + fixedDuration(b), 0);
  const mainMinutes = input.durationMin - fixedTotal;
  const mainRange = main.durationMinutes;
  if (!mainRange) throw new SessionModelV2ContractError(`${AEROBIC_BASE_PROTOCOL_ID} main block has no duration range`);
  if (mainMinutes < mainRange.min || mainMinutes > mainRange.max) {
    throw new SessionModelV2GenerationBlockedError("unsupported_protocol_duration", {
      protocolId: AEROBIC_BASE_PROTOCOL_ID,
      sessionKind: input.sessionKind,
      durationMin: input.durationMin,
      supportedTotalMinutes: { ...protocol.totalDurationMinutes },
    });
  }

  const activityIds =
    input.ridingAvailable === false
      ? protocol.activityOptions.filter((a) => (OFF_TERRAIN_ENDURANCE_ACTIVITIES_V2 as readonly string[]).includes(a))
      : [...protocol.activityOptions];
  if (activityIds.length === 0) {
    throw new SessionModelV2ContractError(`${AEROBIC_BASE_PROTOCOL_ID} offers no off-terrain activity for a day without riding availability`);
  }

  const blocks: BlockV2Content[] = protocol.blocks.map((block) => {
    const minutes = block === main ? mainMinutes : fixedDuration(block);
    return {
      role: block.role,
      ...(block.focus !== undefined ? { focus: block.focus } : {}),
      durationMinutes: { min: minutes, max: minutes },
      ...(block.targetRpe !== undefined ? { rpeTarget: { ...block.targetRpe } } : {}),
      ...(block.talkTestId !== undefined ? { talkTestId: block.talkTestId } : {}),
      instructionIds: [...block.instructionIds],
      items: [],
    };
  });

  return {
    schemaVersion: "v2",
    family: "endurance",
    sessionKind: input.sessionKind,
    intentId: protocol.intentId,
    protocolId: AEROBIC_BASE_PROTOCOL_ID,
    activitySelection: { mode: "restricted", activityIds },
    catalog: input.catalog,
    blocks,
  };
}
