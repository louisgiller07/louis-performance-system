/**
 * UX-11A.5b.3 — pure helper: the 0-based ordinal of every DH_TECHNICAL
 * session of ONE plan version, in plan date order. The DH builder's
 * rotation (priorityAreas[ordinal % n]) reads it; the builder never derives
 * it itself.
 *
 * One session per day (training_plan_generated_sessions unique
 * (plan_version_id, date)), so the date is a complete order: no tie-break,
 * never an id. Two DH sessions on the same date violate that contract and
 * are refused, never silently ordered.
 */
import type { SessionKind } from "../../types/sharedVocabulary.js";
import { SessionModelV2ContractError } from "../generationErrors.js";
import { DH_V2_SESSION_KIND } from "./dhPrescriptionV2.js";

export interface PlanSessionRef {
  /** ISO date (YYYY-MM-DD) of the planned session. */
  date: string;
  kind: SessionKind;
}

/** date → ordinal, for the DH_TECHNICAL sessions only. */
export function deriveDhSessionOrdinals(sessions: readonly PlanSessionRef[]): ReadonlyMap<string, number> {
  const dates = sessions.filter((s) => s.kind === DH_V2_SESSION_KIND).map((s) => s.date);
  const sorted = [...dates].sort();
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1]) throw new SessionModelV2ContractError(`two DH sessions on ${sorted[i]} (one session per day)`);
  }
  return new Map(sorted.map((date, ordinal) => [date, ordinal]));
}
