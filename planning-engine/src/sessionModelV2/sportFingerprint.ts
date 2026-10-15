/**
 * UX-11A.5b.2 — canonical sport fingerprint (ADR UX-11A.5b.0.1).
 *
 * Determinism is about SPORT CONTENT, never ids: the fingerprint is computed
 * on a canonical form that drops every identity / time field (at any depth)
 * and keeps everything else — session context the caller passes (e.g. date,
 * sessionKind), family, intent, protocol, catalogue manifest, block order and
 * roles, exercises / drills / activities, sets, measures, rests, RPE, text
 * ids, rampUp, durations, passages.
 *
 * PHYS-01: `loadGuidance` (a final Force item's load advice, read from the
 * rider's own history) is not session content and is excluded too — a KEEP
 * keeps the planned sport content whatever the rider's history says.
 *
 * Canonical form: object keys sorted, array order kept (block and item
 * order is content), `undefined` dropped. Same snapshot + horizon + planner
 * version + manifest → same fingerprint, whatever the UUIDs.
 *
 * Not written anywhere yet.
 */
import { createHash } from "node:crypto";

/** Identity and time fields excluded from the sport content, at any depth. */
export const SPORT_FINGERPRINT_EXCLUDED_KEYS: readonly string[] = [
  "planVersionId",
  "blockId",
  "weekId",
  "generatedPlanSessionId",
  "plannedPrescriptionId",
  "finalPrescriptionId",
  "prescriptionId",
  "prescriptionItemId",
  "derivedFromItemId",
  "generationRequestId",
  "decisionId",
  "generatedAt",
  "createdAt",
  "updatedAt",
  "recordedAt",
  "occurredAt",
  // PHYS-01 — derived daily from the rider's recorded sets, never session content.
  "loadGuidance",
  // PHYS-02 — advice from the rider's history (final endurance prescriptions only), not sport content.
  "enduranceGuidance",
  // PHYS-04 — bodyweight repetitions advice (final Force items only), not sport content.
  "repsGuidance",
];

const EXCLUDED = new Set(SPORT_FINGERPRINT_EXCLUDED_KEYS);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (EXCLUDED.has(key) || child === undefined) continue;
      out[key] = canonicalize(child);
    }
    return out;
  }
  return value;
}

/** Stable serialization of the sport content (identity / time fields removed, keys sorted). */
export function canonicalSportContent(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** SHA-256 (hex) of canonicalSportContent(value). */
export function sportFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalSportContent(value)).digest("hex");
}
