/**
 * PHYS-02 — endurance guidance from the rider's own recorded sessions
 * (advisory, never a dose change; no heart rate, FTP or zone is ever used).
 *
 * The reference is the most recent completed session of the SAME protocol
 * (`endurance_base_continuous` or `endurance_intervals_3min`) in the history
 * window, as the rider recorded it: activity, real duration, optional
 * distance, optional session RPE. Nothing is inferred from a missing value.
 *
 * One reminder only, restating the prescription: for the base endurance
 * protocol, a recorded RPE above today's main-block RPE target → keep the
 * effort where full sentences are possible. Intervals: the recorded RPE is
 * the whole session's (work and easy minutes together), never compared with
 * the RPE of the repetitions — reference only.
 *
 * Attached under the additive root key `enduranceGuidance` of a final
 * endurance prescription (validated by validatePrescriptionV2); a previous
 * reader ignores it.
 */
import { ENDURANCE_GUIDANCE_POLICY_V2, ENDURANCE_GUIDANCE_RULES_VERSION } from "../catalog/enduranceGuidancePolicyV2.js";
import type { PrescriptionV2 } from "./prescriptionV2.js";

export const ENDURANCE_GUIDANCE_KEY = "enduranceGuidance";
export const ENDURANCE_BASE_GUIDED_PROTOCOL_ID = "endurance_base_continuous";

/** One completed endurance session, as recorded (the active activity result of its execution). */
export interface EnduranceSessionRecordV2 {
  sessionDate: string;
  /** The protocol of the final prescription the session was performed against. */
  protocolId: string;
  activityId: string;
  durationSeconds: number;
  distanceM: number | null;
  rpeActual: number | null;
}

export interface EnduranceGuidanceV2 {
  ruleVersion: string;
  reference: { sessionDate: string; activityId: string; durationSeconds: number; distanceM: number | null; rpeActual: number | null };
  /** Base endurance only: the reference RPE was above today's main-block target. */
  effortAboveTarget?: { rpeActual: number; rpeTargetMax: number };
}

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** The guidance of today's final endurance prescription, or null (other family, no protocol, no usable history). */
export function enduranceGuidanceV2(today: { date: string; prescription: PrescriptionV2 }, history: readonly EnduranceSessionRecordV2[]): EnduranceGuidanceV2 | null {
  const p = today.prescription;
  if (p.family !== "endurance" || p.protocolId === undefined) return null;
  const candidates = history
    .filter((h) => h.protocolId === p.protocolId && h.sessionDate < today.date && daysBetween(h.sessionDate, today.date) <= ENDURANCE_GUIDANCE_POLICY_V2.historyWindowDays)
    .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate));
  const last = candidates[0];
  if (!last) return null;
  const guidance: EnduranceGuidanceV2 = {
    ruleVersion: ENDURANCE_GUIDANCE_RULES_VERSION,
    reference: { sessionDate: last.sessionDate, activityId: last.activityId, durationSeconds: last.durationSeconds, distanceM: last.distanceM, rpeActual: last.rpeActual },
  };
  if (p.protocolId === ENDURANCE_BASE_GUIDED_PROTOCOL_ID && last.rpeActual !== null) {
    const target = p.blocks.find((b) => b.role === "main")?.rpeTarget;
    if (target !== undefined && last.rpeActual > target.max) guidance.effortAboveTarget = { rpeActual: last.rpeActual, rpeTargetMax: target.max };
  }
  return guidance;
}

/** Today's final endurance prescription with its guidance (unchanged when there is none). */
export function attachEnduranceGuidanceV2(structure: PrescriptionV2, guidance: EnduranceGuidanceV2 | null): PrescriptionV2 {
  if (guidance === null || structure.family !== "endurance") return structure;
  return { ...structure, enduranceGuidance: guidance };
}
