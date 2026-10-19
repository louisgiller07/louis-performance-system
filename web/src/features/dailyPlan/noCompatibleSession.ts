// SPORT-SAFE-01R.4 (HPM 2026-10-19) — the day A04 refused M1's adaptation (`modify_not_supported`: no guided version
// lighter than the planned one) and A10 found no admissible alternative because the rider's declared time is shorter
// than the refused session (`docs/04`, A10 « exception limitée »). Today then never presents that session as available:
// it says the declared time, the refused session's duration and that no compatible guided session exists. Facts from
// the stored decision (its blocked status and detail) and the day's check-in only; never a REST, never a recovery.
import type { FinalPrescriptionV2State } from "../finalPrescriptionV2/finalPrescriptionV2Types";

export interface NoCompatibleSession {
  /** daily_checkins.available_minutes_today, as declared by the rider. */
  availableMinutes: number;
  /** The refused session's duration (the blocked decision's detail.durationMin). */
  durationMin: number;
}

export const NO_COMPATIBLE_SESSION_TITLE = "Aucune séance compatible";

export function noCompatibleSessionOf(state: FinalPrescriptionV2State | undefined, availableMinutes: number | null | undefined): NoCompatibleSession | null {
  if (state?.kind !== "blocked" || state.detail?.reason !== "modify_not_supported") return null;
  const durationMin = state.detail.durationMin;
  if (typeof availableMinutes !== "number" || typeof durationMin !== "number" || availableMinutes >= durationMin) return null;
  return { availableMinutes, durationMin };
}

export function noCompatibleSessionSentence({ availableMinutes, durationMin }: NoCompatibleSession): string {
  return `Tu as indiqué ${availableMinutes} min aujourd'hui. La séance recommandée dure ${durationMin} min et NALYNT n'en a pas de version guidée plus légère : aucune séance guidée compatible aujourd'hui.`;
}
