/**
 * P0 — M1 UPWARD MODIFY NORMAL PATH (HPM 2026-10-07, ADR P0-M1-UPWARD).
 *
 * Canonical rule: when a real planned session exists for today, the Daily
 * engine never raises its load automatically. The multi-week plan already
 * decided the load (progression, taper); daily signals and protocols may
 * keep, lower, replace (for a valid reason) or rest — never raise.
 *
 * Applied once, at the END of the arbitration (after the race protocol
 * baseline, training-domain rules, non-Safety pain, mode soft constraints
 * and the Safety swap), so every present and future upward path is covered
 * by the same invariant — not a T-6 special case.
 *
 * Scope: the final session and the planned session belong to the SAME
 * activity family (rules/committedActivityFamily.ts groups) and both carry a
 * `load_profile`. Only `load_profile` is lowered back to the planned one; the
 * kind (a legitimate change within the family, e.g. legs RED: lower → upper
 * body) is kept. Different families are never compared (no cross-family
 * load score); no planned session → nothing to cap.
 */
import type { LoadProfile, TrainingIntervention } from "../types/trainingIntervention.js";
import { sameIntervention } from "../types/trainingIntervention.js";
import { activityFamily } from "./committedActivityFamily.js";

export const PLANNED_LOAD_CAP_RULE_ID = "PLANNED_LOAD_CAP";

const LOAD_RANK: Readonly<Record<LoadProfile, number>> = { LIGHT: 0, MODERATE: 1, HEAVY: 2 };

/** The session with its load lowered back to the planned one, or `null` when nothing is raised. */
export function capToPlannedLoad(session: TrainingIntervention, planned: TrainingIntervention | null): TrainingIntervention | null {
  if (planned === null || planned.load_profile === undefined || session.load_profile === undefined) return null;
  const family = activityFamily(session.kind);
  if (family === null || family !== activityFamily(planned.kind)) return null;
  if (LOAD_RANK[session.load_profile] <= LOAD_RANK[planned.load_profile]) return null;
  return { ...session, load_profile: planned.load_profile } as TrainingIntervention;
}

/**
 * Audit detail (engine vocabulary; the web shows a plain sentence instead,
 * see web/src/features/dailyPlan/safetyPresentation.ts): the planned session,
 * the stronger proposal and where it came from, the session kept.
 */
export function plannedLoadCapDetail(planned: TrainingIntervention, proposal: TrainingIntervention, kept: TrainingIntervention, raceProtocol: TrainingIntervention | null): string {
  const source = raceProtocol !== null && sameIntervention(proposal, raceProtocol) ? "protocole T-X" : "arbitrage du jour";
  return (
    `Séance planifiée ${planned.kind} ${planned.load_profile} — proposition ${proposal.kind} ${proposal.load_profile} (${source}) ` +
    `plafonnée à la charge planifiée : ${kept.kind} ${kept.load_profile}.`
  );
}
