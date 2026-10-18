// PARTIAL-01 (HPM 2026-10-18) — how much of its own frozen prescription a COMPLETED guided session recorded, only
// where the persisted results can prove it. The very rules the session used to ask « Terminer quand même ? »
// (strengthProgress / dhProgress): every prescribed work set / pass performed → "complete"; fewer → "partial".
// Finalisation HPM: endurance (one activity of any duration is enough to complete, never compared with the prescribed
// duration), recovery (no result at all) and every other family only prove the session was closed → null, shown
// neutrally (« Terminée »). Read only: nothing is invented, no duration or reason for stopping is guessed. null also
// when nothing can be told (no work set prescribed, no main drill, ambiguous results).
import type { FinalPrescriptionV2View } from "../finalPrescriptionV2/finalPrescriptionV2Types";
import type { SetResultRow } from "../guidedSession/executionState";
import { isGuidedStrengthPrescription, strengthProgress } from "../guidedSession/strength/strengthSets";
import { dhProgress, isGuidedDhPrescription } from "../guidedSession/dh/dhPasses";

/** A completed session, against what it prescribed (V2: its own results; V1: the debrief's completion_status). */
export type SessionRealisation = "complete" | "partial";

export function guidedRealisationOf(prescription: FinalPrescriptionV2View, setResults: readonly SetResultRow[]): SessionRealisation | null {
  try {
    if (isGuidedStrengthPrescription(prescription)) {
      const progress = strengthProgress(prescription, setResults);
      if (progress.slots.length === 0) return null;
      return progress.recorded < progress.slots.length ? "partial" : "complete";
    }
    if (isGuidedDhPrescription(prescription)) {
      const progress = dhProgress(prescription, setResults);
      if (!progress) return null;
      return progress.recorded < progress.slots.length ? "partial" : "complete";
    }
    return null;
  } catch {
    // UX-11B.2.6 — several active results for one slot are never arbitrated.
    return null;
  }
}
