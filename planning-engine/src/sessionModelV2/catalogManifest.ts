/**
 * UX-11A.5b.2 — Session Model V2 catalogue manifest (ADR UX-11A.5b.0.1).
 *
 * One aggregate version + the version of every component that can shape a
 * V2 prescription, built from the real component constants (never a copy
 * maintained by hand elsewhere). Legacy versions (exerciseCatalog "v3",
 * drillCatalog "v3", PRESCRIPTION_SCHEMA_VERSION "v1") are unrelated and
 * unchanged.
 *
 * `templates` is null: no content-template catalogue exists yet (Force
 * composition, warm-up choice — UX-11A.5b.3+). It is deliberately not a fake
 * placeholder catalogue; a generator that needs templates must refuse to run
 * while it is null (OPEN until the template catalogue is created).
 *
 * Any component version change must come with a new aggregate version
 * (locked by test).
 */
import { SESSION_EXERCISE_CATALOG_V2_VERSION } from "../catalog/sessionExerciseCatalogV2.js";
import { SESSION_DRILL_CATALOG_V2_VERSION } from "../catalog/sessionDrillCatalogV2.js";
import { INTENT_CATALOG_V2_VERSION } from "../catalog/intentCatalogV2.js";
import { PROTOCOL_CATALOG_V2_VERSION } from "../catalog/protocolCatalogV2.js";
import { COACHING_TEXT_CATALOG_VERSION } from "../catalog/coachingTextCatalog.js";

export const SESSION_MODEL_V2_AGGREGATE_VERSION = "session-model-v2.0";

export interface SessionModelV2CatalogManifest {
  aggregate: string;
  exercises: string;
  drills: string;
  intents: string;
  protocols: string;
  texts: string;
  /** null until a content-template catalogue exists (OPEN). */
  templates: string | null;
}

export const SESSION_MODEL_V2_MANIFEST_KEYS = ["aggregate", "exercises", "drills", "intents", "protocols", "texts", "templates"] as const;

export function buildSessionModelV2CatalogManifest(): SessionModelV2CatalogManifest {
  return {
    aggregate: SESSION_MODEL_V2_AGGREGATE_VERSION,
    exercises: SESSION_EXERCISE_CATALOG_V2_VERSION,
    drills: SESSION_DRILL_CATALOG_V2_VERSION,
    intents: INTENT_CATALOG_V2_VERSION,
    protocols: PROTOCOL_CATALOG_V2_VERSION,
    texts: COACHING_TEXT_CATALOG_VERSION,
    templates: null,
  };
}
