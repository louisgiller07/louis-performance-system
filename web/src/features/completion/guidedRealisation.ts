// PARTIAL-01 (HPM 2026-10-18) — how much of its own frozen prescription a COMPLETED guided session recorded. The very
// rules the session used to ask « Terminer quand même ? » (strengthProgress / dhProgress): every prescribed work set /
// pass performed → "complete"; fewer → "partial". A family without a prescribed unit count (endurance, recovery,
// mobility) is complete once completed: its completion IS the activity recorded. Read only: nothing is invented, no
// reason for stopping is guessed. null: the realisation cannot be told (ambiguous results, no main drill).
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
      return progress.recorded < progress.slots.length ? "partial" : "complete";
    }
    if (isGuidedDhPrescription(prescription)) {
      const progress = dhProgress(prescription, setResults);
      if (!progress) return null;
      return progress.recorded < progress.slots.length ? "partial" : "complete";
    }
    return "complete";
  } catch {
    // UX-11B.2.6 — several active results for one slot are never arbitrated.
    return null;
  }
}
