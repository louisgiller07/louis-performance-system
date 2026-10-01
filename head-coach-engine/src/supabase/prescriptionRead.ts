/**
 * UX-11A.5b.1 — reader guard for stored prescriptions (ADR UX-11A.5b.0.1).
 *
 * A reader states honestly what it can interpret. A reader that does not
 * implement a format returns "unsupported_by_reader" for it — never
 * "supported" just because a type for that format exists somewhere, never
 * a cast of a v2 (or unknown) structure into a v1 type, never a silent
 * drop. No reader implements v2 yet: `TV2` is `never` everywhere today.
 */

/** Stable warning / diagnostic code emitted when a reader meets a format it does not implement. */
export const PRESCRIPTION_SCHEMA_UNSUPPORTED = "prescription_schema_unsupported";

export type PrescriptionRead<TV1, TV2> =
  | { status: "supported"; schemaVersion: "v1"; prescription: TV1 }
  | { status: "supported"; schemaVersion: "v2"; prescription: TV2 }
  | { status: "unsupported_by_reader"; schemaVersion: string; prescriptionId: string };
