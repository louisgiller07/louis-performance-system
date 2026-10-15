/**
 * PHYS-04 — pure MOBILITY prescription builder (Session Model V2), from the
 * `mobility_routine_v1` protocol only (protocolCatalogV2, ADR UX-11A.5a.3 and
 * its mobility-duration correction): the routine by targeted zone — hips,
 * ankles, spine, wrists (light) — ended by long-exhale breathing; every
 * exercise in duration, at its own catalogue reference (one set), with its
 * cue and vigilances. Same rule as the active recovery builder: the
 * protocol's ranges ARE the prescription, no dose is invented or adjusted.
 *
 * `atMinimum` (the rider's time today, A10): every block at its protocol
 * minimum (22 min in total), never below — the declared minimum of the
 * protocol, not a new dose.
 *
 * A mobility session is NOT active recovery (recovery_active_v1: a very easy
 * activity, mobility and breathing optional) nor a cool-down (the last
 * block of a Force, power or endurance session). Never a treatment: no
 * stretch is prescribed for an injury.
 */
import { PROTOCOL_CATALOG_V2 } from "../../catalog/protocolCatalogV2.js";
import type { SessionModelV2CatalogManifest } from "../catalogManifest.js";
import { SessionModelV2ContractError } from "../generationErrors.js";
import type { BlockV2Content, PrescriptionV2Content } from "../prescriptionV2.js";
import { protocolSessionBlockV2 } from "./recoveryActivePrescriptionV2.js";

export const MOBILITY_PROTOCOL_ID = "mobility_routine_v1";

function mobilityProtocol() {
  const protocol = PROTOCOL_CATALOG_V2[MOBILITY_PROTOCOL_ID];
  if (!protocol || protocol.family !== "mobility" || protocol.scope !== "session" || protocol.intentId === null || !protocol.sessionKinds.includes("MOBILITY")) {
    throw new SessionModelV2ContractError(`${MOBILITY_PROTOCOL_ID} is not a usable mobility session protocol`);
  }
  if (protocol.blocks.some((b) => b.optional || b.durationMinutes === undefined)) {
    throw new SessionModelV2ContractError(`${MOBILITY_PROTOCOL_ID} must have required blocks with a duration range only`);
  }
  return protocol;
}

/** The protocol's declared total range (22–30 min). */
export function mobilityDurationRangeV2(): { min: number; max: number } {
  return { ...mobilityProtocol().totalDurationMinutes };
}

export function buildMobilityPrescriptionV2Content(input: { catalog: SessionModelV2CatalogManifest; atMinimum?: boolean }): PrescriptionV2Content {
  const protocol = mobilityProtocol();
  const blocks: BlockV2Content[] = protocol.blocks.map((block) => {
    const content = protocolSessionBlockV2(block, MOBILITY_PROTOCOL_ID);
    if (!input.atMinimum) return content;
    const min = block.durationMinutes!.min;
    return { ...content, durationMinutes: { min, max: min } };
  });
  return {
    schemaVersion: "v2",
    family: "mobility",
    sessionKind: "MOBILITY",
    intentId: protocol.intentId!,
    protocolId: protocol.protocolId,
    catalog: input.catalog,
    blocks,
  };
}
