/**
 * UX-11A.5c.1 — Final (daily) prescription V2: pure model.
 *
 * A final prescription is what the rider is asked to do today, attached to
 * ONE Head Coach decision. It mirrors `decision_final_prescriptions`
 * (migration v0_4_001d): provenance on two axes (active session origin,
 * reconciliation action), adaptation rule ids, schema / catalogue version and
 * a V2 `structure`. The structure IS a `PrescriptionV2` (no parallel type):
 * on a final prescription its items may carry `derivedFromItemId` (MODIFY,
 * UX-11A.5c.5 — never KEEP).
 *
 * Contract: ADR UX-11A.5c.0. A decision label is not a prescription: only a
 * KEEP with real plan lineage produces a document here; REST never produces
 * one; MODIFY / REPLACE produce none before UX-11A.5c.5. No fallback.
 * `generated_at` is set by the database, not by this pure model.
 */
import type { ActiveSessionOrigin, ReconciliationAction } from "../../types/prescription.js";
import type { PrescriptionV2 } from "../prescriptionV2.js";

export interface FinalPrescriptionV2 {
  id: string;
  /** The Head Coach decision this prescription belongs to. */
  decisionId: string;
  /** Present whenever a canonical plan covered the date (same presence rule as the DB). */
  planVersionId?: string;
  /** Present exactly for keep / modify with same-kind lineage (same presence rule as the DB). */
  plannedPrescriptionId?: string;
  activeSessionOrigin: ActiveSessionOrigin;
  reconciliationAction: ReconciliationAction;
  /** Empty iff keep. */
  adaptationRuleIds: readonly string[];
  schemaVersion: "v2";
  /** Always the manifest aggregate of `structure.catalog`. */
  catalogVersion: string;
  structure: PrescriptionV2;
}

/** Stable reasons why a decision gets no final prescription by design (ADR UX-11A.5c.0 §1, §6–§9). */
export const FINAL_PRESCRIPTION_V2_BLOCK_CODES = [
  "final_prescription_no_lineage",
  "final_prescription_adaptation_not_defined",
  "final_prescription_catalog_mismatch",
] as const;

export type FinalPrescriptionV2BlockCode = (typeof FINAL_PRESCRIPTION_V2_BLOCK_CODES)[number];

/** Typed error form of a block, for callers that prefer throwing. */
export class FinalPrescriptionV2BlockedError extends Error {
  constructor(
    public readonly code: FinalPrescriptionV2BlockCode,
    public readonly detail: Readonly<Record<string, unknown>> = {}
  ) {
    super(`Final prescription V2 not produced: ${code}`);
    this.name = "FinalPrescriptionV2BlockedError";
  }
}

/**
 * Outcome of the 5c.1 reconciliation:
 * - created: exactly one final prescription (KEEP with lineage only);
 * - none / rest: REST has no final prescription by definition (never an empty document);
 * - blocked: no final prescription, with a stable code and detail.
 */
export type FinalPrescriptionV2Result =
  | {
      status: "created";
      finalPrescription: FinalPrescriptionV2;
      /**
       * A07 — the effective session's duration (minutes) when the prescription
       * defines one: the planned duration (KEEP), the adapted one (MODIFY /
       * REPLACE). Absent when the content is a range (active recovery) or
       * unknown. Not a column: the V2 daily path carries it in the persisted
       * DailyPlan's final session.
       */
      effectiveDurationMin?: number;
    }
  | { status: "none"; reason: "rest" }
  | { status: "blocked"; code: FinalPrescriptionV2BlockCode; detail: Readonly<Record<string, unknown>> };
