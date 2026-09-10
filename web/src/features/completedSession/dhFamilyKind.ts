// V0.3_007C — mirrors web/src/features/planning/plannedDurationPolicy.ts's
// `DH_FAMILY_PLANNABLE_KINDS`/`isDhFamilyPlannableKind` exactly (itself
// mirroring head-coach-engine's `isDhFamilyKind`, domains/dhPrescription.ts)
// — duplicated, not imported (same cross-feature discipline as every other
// small vocabulary mirror in this codebase). Used here to gate whether a
// PERFORMED activity is compatible with actually executing a linked
// decision's DH technical task: `dh_or_technical.execution_task` only ever
// concerns DH-family riding, so asking "did you execute it" only makes
// sense when the performed activity itself is DH-family too.
import type { TrainingInterventionKind } from "./performedInterventionTypes";

const DH_FAMILY_KINDS: ReadonlySet<TrainingInterventionKind> = new Set(["DH_PERFORMANCE", "DH_TECHNICAL", "DH_LIGHT", "PUMPTRACK"]);

export function isDhFamilyKind(kind: TrainingInterventionKind | ""): boolean {
  return kind !== "" && DH_FAMILY_KINDS.has(kind);
}
