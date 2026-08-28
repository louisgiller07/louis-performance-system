// V0.3_001C — submit-review's own request-body validator. Pure, no I/O.
// Mirrors the strict-reject-unknown-fields discipline already established
// by daily-run/refresh-longitudinal: every field is exhaustively validated,
// unknown top-level keys (including any server-owned/browser-forbidden
// field: athleteId, candidateSnapshot, identityId, reviewId, ...) are
// rejected outright, never silently ignored. Values are used exactly as
// submitted for the freshness comparison — never sorted/rewritten/
// canonicalized here (the locked `fingerprintMatches` comparator is the
// only place that decides equality).
import { INSIGHT_COPY } from "../../../longitudinal-engine/dist/index.js";

const ALLOWED_TOP_LEVEL_KEYS = [
  "detectorRuleId",
  "detectorRuleVersion",
  "insightKind",
  "insightProjectorVersion",
  "rangeFromDate",
  "rangeToDate",
  "sourceEvidenceRefs",
  "decision",
  "reviewerNote",
] as const;

const REQUIRED_TOP_LEVEL_KEYS = [
  "detectorRuleId",
  "detectorRuleVersion",
  "insightKind",
  "insightProjectorVersion",
  "rangeFromDate",
  "rangeToDate",
  "sourceEvidenceRefs",
  "decision",
] as const;

const ALLOWED_DECISIONS = ["accepted_as_insight", "dismissed", "needs_more_evidence"] as const;
type AllowedDecision = (typeof ALLOWED_DECISIONS)[number];

const ALLOWED_EVENT_TYPES = ["supporting", "contradicting", "neutral"] as const;

const ALLOWED_SOURCE_REF_KEYS = ["identityId", "revisionId", "revisionNumber", "evaluationKey", "evidenceKey", "eventType", "eventDate"] as const;

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export interface ValidatedSourceEvidenceRef {
  readonly identityId: string;
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly evaluationKey: string;
  readonly evidenceKey: string;
  readonly eventType: "supporting" | "contradicting" | "neutral";
  readonly eventDate: string;
}

export interface ValidatedSubmitReviewRequest {
  readonly detectorRuleId: string;
  readonly detectorRuleVersion: string;
  readonly insightKind: string;
  readonly insightProjectorVersion: string;
  readonly rangeFromDate: string;
  readonly rangeToDate: string;
  readonly sourceEvidenceRefs: readonly ValidatedSourceEvidenceRef[];
  readonly decision: AllowedDecision;
  readonly reviewerNote: string | null;
}

export type ValidationResult = { readonly ok: true; readonly value: ValidatedSubmitReviewRequest } | { readonly ok: false; readonly message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validateSourceEvidenceRef(raw: unknown, index: number): { ok: true; value: ValidatedSourceEvidenceRef } | { ok: false; message: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, message: `sourceEvidenceRefs[${index}] must be an object.` };
  }
  const keys = Object.keys(raw);
  const unknown = keys.filter((k) => !(ALLOWED_SOURCE_REF_KEYS as readonly string[]).includes(k));
  if (unknown.length > 0) {
    return { ok: false, message: `sourceEvidenceRefs[${index}] has unknown propert${unknown.length === 1 ? "y" : "ies"}: ${unknown.join(", ")}.` };
  }
  const missing = ALLOWED_SOURCE_REF_KEYS.filter((k) => !(k in raw));
  if (missing.length > 0) {
    return { ok: false, message: `sourceEvidenceRefs[${index}] is missing required field(s): ${missing.join(", ")}.` };
  }

  if (!isNonEmptyString(raw.identityId)) return { ok: false, message: `sourceEvidenceRefs[${index}].identityId must be a non-empty string.` };
  if (!isNonEmptyString(raw.revisionId)) return { ok: false, message: `sourceEvidenceRefs[${index}].revisionId must be a non-empty string.` };
  if (typeof raw.revisionNumber !== "number" || !Number.isInteger(raw.revisionNumber) || raw.revisionNumber < 1) {
    return { ok: false, message: `sourceEvidenceRefs[${index}].revisionNumber must be a positive integer.` };
  }
  if (!isNonEmptyString(raw.evaluationKey)) return { ok: false, message: `sourceEvidenceRefs[${index}].evaluationKey must be a non-empty string.` };
  if (!isNonEmptyString(raw.evidenceKey)) return { ok: false, message: `sourceEvidenceRefs[${index}].evidenceKey must be a non-empty string.` };
  if (typeof raw.eventType !== "string" || !(ALLOWED_EVENT_TYPES as readonly string[]).includes(raw.eventType)) {
    return { ok: false, message: `sourceEvidenceRefs[${index}].eventType must be one of: ${ALLOWED_EVENT_TYPES.join(", ")}.` };
  }
  if (typeof raw.eventDate !== "string" || !DATE_FORMAT.test(raw.eventDate)) {
    return { ok: false, message: `sourceEvidenceRefs[${index}].eventDate must be a YYYY-MM-DD date string.` };
  }

  return {
    ok: true,
    value: {
      identityId: raw.identityId,
      revisionId: raw.revisionId,
      revisionNumber: raw.revisionNumber,
      evaluationKey: raw.evaluationKey,
      evidenceKey: raw.evidenceKey,
      eventType: raw.eventType as "supporting" | "contradicting" | "neutral",
      eventDate: raw.eventDate,
    },
  };
}

export function validateSubmitReviewRequest(body: unknown): ValidationResult {
  if (!isPlainObject(body)) {
    return { ok: false, message: "Request body must be a JSON object." };
  }

  const keys = Object.keys(body);
  const unknownKeys = keys.filter((k) => !(ALLOWED_TOP_LEVEL_KEYS as readonly string[]).includes(k));
  if (unknownKeys.length > 0) {
    return { ok: false, message: `Unknown propert${unknownKeys.length === 1 ? "y" : "ies"}: ${unknownKeys.join(", ")}.` };
  }
  const missingKeys = REQUIRED_TOP_LEVEL_KEYS.filter((k) => !(k in body));
  if (missingKeys.length > 0) {
    return { ok: false, message: `Missing required field(s): ${missingKeys.join(", ")}.` };
  }

  if (!isNonEmptyString(body.detectorRuleId)) return { ok: false, message: "detectorRuleId must be a non-empty string." };
  if (!isNonEmptyString(body.detectorRuleVersion)) return { ok: false, message: "detectorRuleVersion must be a non-empty string." };
  if (typeof body.insightKind !== "string" || !Object.prototype.hasOwnProperty.call(INSIGHT_COPY, body.insightKind)) {
    return { ok: false, message: "insightKind must be one of the registered insight kinds." };
  }
  if (!isNonEmptyString(body.insightProjectorVersion)) return { ok: false, message: "insightProjectorVersion must be a non-empty string." };
  if (typeof body.rangeFromDate !== "string" || !DATE_FORMAT.test(body.rangeFromDate)) return { ok: false, message: "rangeFromDate must be a YYYY-MM-DD date string." };
  if (typeof body.rangeToDate !== "string" || !DATE_FORMAT.test(body.rangeToDate)) return { ok: false, message: "rangeToDate must be a YYYY-MM-DD date string." };

  if (!Array.isArray(body.sourceEvidenceRefs)) {
    return { ok: false, message: "sourceEvidenceRefs must be an array." };
  }
  const validatedRefs: ValidatedSourceEvidenceRef[] = [];
  for (let i = 0; i < body.sourceEvidenceRefs.length; i++) {
    const result = validateSourceEvidenceRef(body.sourceEvidenceRefs[i], i);
    if (!result.ok) return { ok: false, message: result.message };
    validatedRefs.push(result.value);
  }

  if (typeof body.decision !== "string" || !(ALLOWED_DECISIONS as readonly string[]).includes(body.decision)) {
    return { ok: false, message: `decision must be one of: ${ALLOWED_DECISIONS.join(", ")}.` };
  }

  let reviewerNote: string | null = null;
  if ("reviewerNote" in body && body.reviewerNote !== undefined) {
    const raw = body.reviewerNote;
    if (raw !== null) {
      if (typeof raw !== "string" || raw.length < 1 || raw.length > 2000 || raw.trim() !== raw) {
        return { ok: false, message: "reviewerNote must be null, or a trimmed string of 1-2000 characters." };
      }
      reviewerNote = raw;
    }
  }

  return {
    ok: true,
    value: {
      detectorRuleId: body.detectorRuleId,
      detectorRuleVersion: body.detectorRuleVersion,
      insightKind: body.insightKind,
      insightProjectorVersion: body.insightProjectorVersion,
      rangeFromDate: body.rangeFromDate,
      rangeToDate: body.rangeToDate,
      sourceEvidenceRefs: validatedRefs,
      decision: body.decision as AllowedDecision,
      reviewerNote,
    },
  };
}
