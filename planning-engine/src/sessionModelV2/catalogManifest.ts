/**
 * UX-11A.5b.2 — Session Model V2 catalogue manifest (ADR UX-11A.5b.0.1).
 *
 * One aggregate version + the version of every component that can shape a
 * V2 prescription, built from the real component constants (never a copy
 * maintained by hand elsewhere). Legacy versions (exerciseCatalog "v3",
 * drillCatalog "v3", PRESCRIPTION_SCHEMA_VERSION "v1") are unrelated and
 * unchanged.
 *
 * UX-11A.5a.4: `templates` is the strength template catalogue version and
 * `strengthDoses` the strength dose catalogue version (kept separate, never
 * hidden inside templates); aggregate bumped to session-model-v2.1.
 * UX-11A.5a.4.1: `planDosePolicy` (it shapes sport content, so it must be
 * traceable); exercises v2.1, templates v2.1, strengthDoses v2.1; aggregate
 * session-model-v2.2. UX-11A.5a.4.2: planDosePolicy v2.1 (Force durations),
 * aggregate session-model-v2.3. UX-11A.5a.4.3: planDosePolicy v2.2 (DH
 * duration), aggregate session-model-v2.4.
 *
 * Any component version change must come with a new aggregate version
 * (locked by test).
 */
import { SESSION_EXERCISE_CATALOG_V2_VERSION } from "../catalog/sessionExerciseCatalogV2.js";
import { SESSION_DRILL_CATALOG_V2_VERSION } from "../catalog/sessionDrillCatalogV2.js";
import { INTENT_CATALOG_V2_VERSION } from "../catalog/intentCatalogV2.js";
import { PROTOCOL_CATALOG_V2_VERSION } from "../catalog/protocolCatalogV2.js";
import { COACHING_TEXT_CATALOG_VERSION } from "../catalog/coachingTextCatalog.js";
import { STRENGTH_TEMPLATE_CATALOG_V2_VERSION } from "../catalog/strengthTemplateCatalogV2.js";
import { STRENGTH_DOSE_CATALOG_V2_VERSION } from "../catalog/strengthDoseCatalogV2.js";
import { PLAN_DOSE_POLICY_V2_VERSION } from "../catalog/planDosePolicyV2.js";

export const SESSION_MODEL_V2_AGGREGATE_VERSION = "session-model-v2.4";

export interface SessionModelV2CatalogManifest {
  aggregate: string;
  exercises: string;
  drills: string;
  intents: string;
  protocols: string;
  texts: string;
  templates: string;
  strengthDoses: string;
  planDosePolicy: string;
}

export const SESSION_MODEL_V2_MANIFEST_KEYS = ["aggregate", "exercises", "drills", "intents", "protocols", "texts", "templates", "strengthDoses", "planDosePolicy"] as const;

export function buildSessionModelV2CatalogManifest(): SessionModelV2CatalogManifest {
  return {
    aggregate: SESSION_MODEL_V2_AGGREGATE_VERSION,
    exercises: SESSION_EXERCISE_CATALOG_V2_VERSION,
    drills: SESSION_DRILL_CATALOG_V2_VERSION,
    intents: INTENT_CATALOG_V2_VERSION,
    protocols: PROTOCOL_CATALOG_V2_VERSION,
    texts: COACHING_TEXT_CATALOG_VERSION,
    templates: STRENGTH_TEMPLATE_CATALOG_V2_VERSION,
    strengthDoses: STRENGTH_DOSE_CATALOG_V2_VERSION,
    planDosePolicy: PLAN_DOSE_POLICY_V2_VERSION,
  };
}
