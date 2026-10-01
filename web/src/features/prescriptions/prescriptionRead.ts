// UX-11A.5b.1 — reader guard for stored prescriptions (ADR UX-11A.5b.0.1).
// Hand-maintained mirror of head-coach-engine/src/supabase/prescriptionRead.ts
// (web never imports the engine packages).
//
// A reader states honestly what it can interpret. The web implements v1
// only: any other schema version is "unsupported_by_reader" — never cast
// into a v1 type, never dropped silently, never a reason to reject a whole
// response. `TV2` is `never` everywhere until a real v2 renderer exists.

/** Stable diagnostic code for a prescription format this reader does not implement. */
export const PRESCRIPTION_SCHEMA_UNSUPPORTED = "prescription_schema_unsupported";

/** The only prescription format the web can interpret today. */
export const SUPPORTED_PRESCRIPTION_SCHEMA_VERSION = "v1";

export type PrescriptionRead<TV1, TV2> =
  | { status: "supported"; schemaVersion: "v1"; prescription: TV1 }
  | { status: "supported"; schemaVersion: "v2"; prescription: TV2 }
  | { status: "unsupported_by_reader"; schemaVersion: string; prescriptionId: string };

/** Athlete-facing copy for a prescription the app cannot display yet (no technical wording). */
export const PRESCRIPTION_UNAVAILABLE_MESSAGE = "Le détail de cette séance n'est pas disponible dans cette version.";
