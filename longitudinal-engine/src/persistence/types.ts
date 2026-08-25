/**
 * M5_006A — persistence-layer result shapes. Distinct from the detector's
 * own result types (detectors/types.ts): this is what the adapter/RPC round
 * trip produces, not what the pure detector computed.
 */
export type PersistPatternEvidenceAction = "inserted" | "superseded" | "unchanged";

export type PersistPatternEvidenceAdapterResult =
  | { readonly action: "skipped_no_evidence" }
  | {
      readonly action: PersistPatternEvidenceAction;
      readonly identityId: string;
      readonly revisionId: string;
      readonly revisionNumber: number;
    };
