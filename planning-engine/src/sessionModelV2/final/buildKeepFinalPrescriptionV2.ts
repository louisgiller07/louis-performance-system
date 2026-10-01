/**
 * UX-11A.5c.1 — pure KEEP final prescription (ADR UX-11A.5c.0).
 *
 * KEEP = copy. The planned V2 prescription is copied verbatim (template,
 * protocol, activity selection, manifest, blocks, blockId,
 * prescriptionItemId, exercises / drills, sets, measures, RPE, rest, ramp-up,
 * text ids). No dose is recomputed, no sport builder is called, no
 * `derivedFromItemId` is added.
 *
 * A KEEP label from M1 is not enough: the copy is made only with real plan
 * lineage (current generated version, generated session, its V2 planned
 * prescription) and when the final session has exactly the planned kind,
 * load profile and (when it carries one) duration. Everything else is a
 * typed block, never a fallback:
 * - REST → `{ status: "none", reason: "rest" }` (no document);
 * - no lineage → `final_prescription_no_lineage`;
 * - KEEP hiding a difference, MODIFY, REPLACE → `final_prescription_adaptation_not_defined`
 *   (MODIFY / REPLACE before UX-11A.5c.5; upward MODIFY is never supported);
 * - a planned prescription written under another Session Model aggregate
 *   that this runtime can no longer validate → `final_prescription_catalog_mismatch`
 *   (expected after a catalogue upgrade; UX-11A.5c.3).
 *
 * Inputs are plain data (no M1 type is imported): the caller maps
 * `DailyPlan.decision` / `final_session` and the DB lineage onto them.
 * A malformed planned prescription under the runtime's own aggregate is a
 * contract error (thrown), never a block: it is a bug or corrupt data, not a
 * decision by design.
 */
import type { LoadProfile } from "../../types/sharedVocabulary.js";
import { SESSION_MODEL_V2_AGGREGATE_VERSION } from "../catalogManifest.js";
import { SessionModelV2ContractError } from "../generationErrors.js";
import type { PrescriptionV2 } from "../prescriptionV2.js";
import { validatePrescriptionV2 } from "../validatePrescriptionV2.js";
import type { FinalPrescriptionV2, FinalPrescriptionV2BlockCode, FinalPrescriptionV2Result } from "./finalPrescriptionV2.js";
import { validateKeepFinalPrescriptionV2 } from "./validateKeepFinalPrescriptionV2.js";

/** Head Coach arbitration label (DailyPlan.decision), same vocabulary. */
export type ArbitrationDecisionLabel = "KEEP" | "MODIFY" | "REPLACE" | "REST";

/** The decision side, mapped from M1's DailyPlan by the caller. */
export interface FinalPrescriptionDecisionInput {
  decisionId: string;
  decision: ArbitrationDecisionLabel;
  /** DailyPlan.final_session: kind, load_profile, duration_min. M1 kinds are wider than the generated ones. */
  finalSession: { kind: string; loadProfile?: LoadProfile; durationMin?: number };
}

/** Today's planned session lineage, read from the same planned_sessions row as the decision's provenance. */
export interface PlannedSessionLineageV2 {
  /** planned_sessions.source ("generated" while owned by the projection). */
  plannedSessionSource: string;
  sourcePlanVersionId: string | null;
  sourceGeneratedSessionId: string | null;
  /** The athlete's current accepted plan version. */
  currentPlanVersionId: string | null;
  /** The generated session the lineage points to (training_plan_generated_sessions). */
  generatedSession: { id: string; kind: string; loadProfile: LoadProfile | null; durationMin: number | null } | null;
}

/** A training_plan_planned_prescriptions row as read (structure not yet trusted). */
export interface PlannedPrescriptionRecordV2 {
  id: string;
  generatedPlanSessionId: string;
  schemaVersion: string;
  catalogVersion: string;
  structure: unknown;
}

export interface BuildKeepFinalPrescriptionV2Input {
  /** Id of the final prescription document (minted by the caller). */
  finalPrescriptionId: string;
  decision: FinalPrescriptionDecisionInput;
  /** null when today has no planned session row. */
  lineage: PlannedSessionLineageV2 | null;
  /** null when no planned prescription was found for the lineage. */
  plannedPrescription: PlannedPrescriptionRecordV2 | null;
}

const LOAD_RANK: Readonly<Record<LoadProfile, number>> = { LIGHT: 0, MODERATE: 1, HEAVY: 2 };

function blocked(code: FinalPrescriptionV2BlockCode, detail: Record<string, unknown>): FinalPrescriptionV2Result {
  return { status: "blocked", code, detail };
}

/** Lineage check (ADR UX-11A.5c.0 §1): returns the failing reason, or null when the lineage is real. */
function lineageFailure(lineage: PlannedSessionLineageV2 | null, planned: PlannedPrescriptionRecordV2 | null): string | null {
  if (lineage === null) return "no_planned_session";
  if (lineage.plannedSessionSource !== "generated") return "planned_session_not_generated";
  if (lineage.sourceGeneratedSessionId === null || lineage.sourcePlanVersionId === null) return "missing_generated_session_lineage";
  if (lineage.currentPlanVersionId === null || lineage.sourcePlanVersionId !== lineage.currentPlanVersionId) return "not_current_plan_version";
  if (lineage.generatedSession === null || lineage.generatedSession.id !== lineage.sourceGeneratedSessionId) return "generated_session_not_found";
  if (planned === null) return "no_planned_prescription";
  if (planned.generatedPlanSessionId !== lineage.sourceGeneratedSessionId) return "planned_prescription_of_another_session";
  return null;
}

/** The manifest aggregate a stored structure declares, if any (read before validation). */
function declaredAggregate(structure: unknown): string | undefined {
  const catalog = structure !== null && typeof structure === "object" ? (structure as { catalog?: unknown }).catalog : undefined;
  const aggregate = catalog !== null && typeof catalog === "object" ? (catalog as { aggregate?: unknown }).aggregate : undefined;
  return typeof aggregate === "string" ? aggregate : undefined;
}

/**
 * Parses the stored planned prescription. A structure from another Session
 * Model aggregate that the runtime can no longer validate is an expected
 * catalogue mismatch (returned as such); any other inconsistency is a
 * contract error (bug / corrupt data).
 */
function trustedPlannedStructure(planned: PlannedPrescriptionRecordV2, generatedKind: string): PrescriptionV2 | { catalogMismatch: Record<string, unknown> } {
  if (planned.schemaVersion !== "v2") {
    throw new SessionModelV2ContractError(`planned prescription ${planned.id} has schema_version "${planned.schemaVersion}", not v2 (no v2 → v1 fallback)`);
  }
  const validation = validatePrescriptionV2(planned.structure, { stage: "planned" });
  if (!validation.ok) {
    const aggregate = declaredAggregate(planned.structure);
    if (aggregate !== undefined && aggregate !== SESSION_MODEL_V2_AGGREGATE_VERSION) {
      return { catalogMismatch: { plannedAggregate: aggregate, runtimeAggregate: SESSION_MODEL_V2_AGGREGATE_VERSION } };
    }
    throw new SessionModelV2ContractError(`planned prescription ${planned.id} is invalid: ${validation.issues.map((i) => `${i.path} ${i.code}`).join(", ")}`);
  }
  const structure = validation.prescription;
  if (planned.catalogVersion !== structure.catalog.aggregate) {
    throw new SessionModelV2ContractError(`planned prescription ${planned.id} catalog_version "${planned.catalogVersion}" differs from its manifest aggregate "${structure.catalog.aggregate}"`);
  }
  if (structure.sessionKind !== generatedKind) {
    throw new SessionModelV2ContractError(`planned prescription ${planned.id} is for ${structure.sessionKind}, its generated session is ${generatedKind}`);
  }
  return structure;
}

export function buildKeepFinalPrescriptionV2(input: BuildKeepFinalPrescriptionV2Input): FinalPrescriptionV2Result {
  const { decision, lineage, plannedPrescription } = input;

  if (decision.decision === "REST") return { status: "none", reason: "rest" };
  // REPLACE never derives from the planned prescription; not defined before 5c.5.
  if (decision.decision === "REPLACE") return blocked("final_prescription_adaptation_not_defined", { reason: "replace_not_supported" });

  const failure = lineageFailure(lineage, plannedPrescription);
  if (failure !== null) return blocked("final_prescription_no_lineage", { reason: failure });
  const generated = lineage!.generatedSession!;
  const planned = plannedPrescription!;
  const trusted = trustedPlannedStructure(planned, generated.kind);
  if ("catalogMismatch" in trusted) return blocked("final_prescription_catalog_mismatch", trusted.catalogMismatch);
  const structure = trusted;

  const final = decision.finalSession;
  if (decision.decision === "MODIFY") {
    const upward = final.loadProfile !== undefined && generated.loadProfile !== null && LOAD_RANK[final.loadProfile] > LOAD_RANK[generated.loadProfile];
    return blocked("final_prescription_adaptation_not_defined", { reason: upward ? "upward_modify_not_supported" : "modify_not_supported" });
  }

  // KEEP: the label is not trusted alone — kind, load and any carried duration must match the plan.
  if (final.kind !== generated.kind) return blocked("final_prescription_adaptation_not_defined", { reason: "kind_mismatch", planned: generated.kind, final: final.kind });
  if ((final.loadProfile ?? null) !== generated.loadProfile) {
    return blocked("final_prescription_adaptation_not_defined", { reason: "load_profile_mismatch", planned: generated.loadProfile, final: final.loadProfile ?? null });
  }
  if (final.durationMin !== undefined && final.durationMin !== generated.durationMin) {
    return blocked("final_prescription_adaptation_not_defined", { reason: "duration_mismatch", planned: generated.durationMin, final: final.durationMin });
  }

  const finalPrescription: FinalPrescriptionV2 = {
    id: input.finalPrescriptionId,
    decisionId: decision.decisionId,
    planVersionId: lineage!.sourcePlanVersionId!,
    plannedPrescriptionId: planned.id,
    activeSessionOrigin: "generated",
    reconciliationAction: "keep",
    adaptationRuleIds: [],
    schemaVersion: "v2",
    catalogVersion: structure.catalog.aggregate,
    // Verbatim copy (JSON document): same ids, same content, nothing recomputed.
    structure: JSON.parse(JSON.stringify(structure)) as PrescriptionV2,
  };

  const check = validateKeepFinalPrescriptionV2(finalPrescription, { id: planned.id, structure });
  if (!check.ok) throw new SessionModelV2ContractError(`KEEP final prescription invariant violated: ${check.issues.join(", ")}`);
  return { status: "created", finalPrescription };
}
