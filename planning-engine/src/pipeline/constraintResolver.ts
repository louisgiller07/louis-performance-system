/**
 * ConstraintResolver (V0.4_111) — pure function that:
 *   1. converts WeekSegmenter's unplaceable slots into "placement_shortfall"
 *      RelaxedConstraint entries (never ignored, never merged);
 *   2. enforces noBackToBackHeavyStrength (tests/fixtures/invariants.ts) by
 *      reducing the later of two consecutive HEAVY strength sessions to
 *      MODERATE, recording a "recovery_spacing" RelaxedConstraint.
 *
 * Runs after HistoryAdjuster (V0.4_110) — `sessions` is already the
 * finalized per-session load. Never moves, recreates, or retypes a
 * session; never touches equipment/recentHistory/races; never calls
 * another pipeline module. See V0.4_111 design and V0.4_112/112A
 * (constraint vocabulary — ConstraintId is a closed union, no new member
 * introduced here).
 */
import type { SessionDomain, UnplaceableSlot } from "./weekSegmenter.js";
import type { SessionKind, LoadProfile } from "../types/sharedVocabulary.js";
import type { SessionDoseTarget } from "../types/generatedSession.js";
import type { RelaxedConstraint } from "../types/planVersion.js";

export interface ConstraintResolverSessionEntry {
  date: string; // ISO date
  domain: SessionDomain;
  kind: SessionKind;
  loadProfile?: LoadProfile;
  durationMin: number;
  doseTarget: SessionDoseTarget;
}

export interface ConstraintResolverInput {
  weekStartDate: string;
  weekEndDate: string;
  sessions: readonly ConstraintResolverSessionEntry[];
  unplaceable: readonly UnplaceableSlot[];
}

export interface ConstraintResolverResult {
  sessions: readonly ConstraintResolverSessionEntry[];
  relaxedConstraints: readonly RelaxedConstraint[];
}

export class InvalidSessionSequenceError extends Error {
  constructor(public readonly date: string) {
    super(`ConstraintResolver: more than one session found for date ${date} — one session per day is required`);
    this.name = "InvalidSessionSequenceError";
  }
}

/**
 * Mirrors tests/fixtures/invariants.ts's own STRENGTH_KINDS exactly —
 * duplicated deliberately, never imported from a test fixture into src/.
 */
const STRENGTH_KINDS: ReadonlySet<SessionKind> = new Set(["STRENGTH_LOWER", "STRENGTH_UPPER", "STRENGTH_FULL_LIGHT", "POWER"]);

function isHeavyStrength(session: ConstraintResolverSessionEntry): boolean {
  return session.domain === "strength" && STRENGTH_KINDS.has(session.kind) && session.loadProfile === "HEAVY";
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export function resolveConstraints(input: ConstraintResolverInput): ConstraintResolverResult {
  const byDate = new Map<string, ConstraintResolverSessionEntry>();
  for (const session of input.sessions) {
    if (byDate.has(session.date)) {
      throw new InvalidSessionSequenceError(session.date);
    }
    byDate.set(session.date, session);
  }

  const relaxedConstraints: RelaxedConstraint[] = [];

  // 1. unplaceable -> placement_shortfall, one entry per slot, never merged.
  for (const slot of input.unplaceable) {
    relaxedConstraints.push({
      constraintId: "placement_shortfall",
      reason: slot.reason,
      domain: slot.domain,
    });
  }

  // 2. noBackToBackHeavyStrength — scan in ascending date order; re-reading
  // `previous` fresh from `byDate` each iteration means an adjustment made
  // this iteration is visible to the next one, correctly handling 3+
  // consecutive HEAVY days without extra bookkeeping.
  const orderedDates = [...byDate.keys()].sort();

  for (let i = 1; i < orderedDates.length; i++) {
    const previous = byDate.get(orderedDates[i - 1]!)!;
    const current = byDate.get(orderedDates[i]!)!;

    if (isHeavyStrength(previous) && isHeavyStrength(current) && daysBetween(previous.date, current.date) === 1) {
      // Authorized adjustment only: HEAVY -> MODERATE on the later session.
      // kind/date/domain/doseTarget/durationMin are left untouched — the
      // design authorizes loadProfile alone, nothing else.
      byDate.set(current.date, { ...current, loadProfile: "MODERATE" });
      relaxedConstraints.push({
        constraintId: "recovery_spacing",
        reason: "Reduced heavy strength load to avoid consecutive heavy strength sessions",
        domain: "strength",
        date: current.date,
      });
    }
  }

  const sessions = orderedDates.map((date) => byDate.get(date)!);

  return { sessions, relaxedConstraints };
}
