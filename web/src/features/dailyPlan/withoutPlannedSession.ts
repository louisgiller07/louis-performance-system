// SPORT-RACE-01P (HPM 2026-10-19) — on the V2 path, a day the rider's programme has no session for keeps M1's
// recommendation only: NALYNT never invents a session (docs/03, ADR UX-11A.5c.0), the stored decision is blocked
// `final_prescription_no_lineage` / `no_planned_session`. The recommendation's duration is M1's own (e.g. the V1 DH
// session window, « 4 h »), never a V2 prescription: it is shown as advice, without that duration. A REST or the
// race activity is not concerned (nothing to prescribe).
import type { FinalPrescriptionV2State } from "../finalPrescriptionV2/finalPrescriptionV2Types";
import type { TrainingIntervention } from "./dailyPlanTypes";

export const WITHOUT_PLANNED_SESSION_SENTENCE = "Ton programme ne prévoit pas de séance ce jour-là : c'est un conseil, sans séance guidée ni durée prescrite.";

/** The stored decision's own blocked status (the V2 path only). */
export function isWithoutPlannedSession(status: string | null | undefined, detail: unknown): boolean {
  return status === "blocked" && typeof detail === "object" && detail !== null && (detail as { reason?: unknown }).reason === "no_planned_session";
}

export function withoutPlannedSessionOf(state: FinalPrescriptionV2State | undefined, finalSession: TrainingIntervention): boolean {
  if (finalSession.kind === "REST" || finalSession.kind === "RACE_ACTIVITY") return false;
  return state?.kind === "blocked" && state.code === "final_prescription_no_lineage" && isWithoutPlannedSession("blocked", state.detail);
}
