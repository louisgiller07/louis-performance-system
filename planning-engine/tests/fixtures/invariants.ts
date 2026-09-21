/**
 * Reusable, pure invariant-checker functions over a hypothetical
 * GeneratedPlanSession[] week — shared test infrastructure for the golden
 * scenarios (M0 §H / M1 §8). These do NOT test a real planner (none exists
 * yet) — they test that the CHECKS THEMSELVES are correct against synthetic
 * data, so M3's future planner test suite can import and reuse them
 * unchanged rather than re-deriving the same invariants from scratch.
 */
import type { GeneratedPlanSession } from "../../src/types/generatedSession.js";
import { LOAD_VARIABLE_SESSION_KINDS } from "../../src/types/sharedVocabulary.js";

const STRENGTH_KINDS = new Set(["STRENGTH_LOWER", "STRENGTH_UPPER", "STRENGTH_FULL_LIGHT", "POWER"]);
const DH_KINDS = new Set(["DH_TECHNICAL", "DH_PERFORMANCE", "DH_LIGHT"]);

function byDateAscending(sessions: readonly GeneratedPlanSession[]): GeneratedPlanSession[] {
  return [...sessions].sort((a, b) => a.date.localeCompare(b.date));
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** Scenario A — no two HEAVY strength sessions on consecutive calendar days. */
export function noBackToBackHeavyStrength(sessions: readonly GeneratedPlanSession[]): boolean {
  const heavyStrength = byDateAscending(sessions).filter((s) => STRENGTH_KINDS.has(s.kind) && s.loadProfile === "HEAVY");
  for (let i = 1; i < heavyStrength.length; i++) {
    if (daysBetween(heavyStrength[i - 1]!.date, heavyStrength[i]!.date) <= 1) return false;
  }
  return true;
}

/** Scenarios B/C — no HEAVY session within `windowDays` days before `raceDate` (inclusive). */
export function noHeavySessionBeforeRace(sessions: readonly GeneratedPlanSession[], raceDate: string, windowDays: number): boolean {
  return sessions.every((s) => {
    if (s.loadProfile !== "HEAVY") return true;
    const diff = daysBetween(s.date, raceDate);
    return !(diff >= 0 && diff <= windowDays);
  });
}

/** Scenario D — every strength session's dose target implies equipment-compatible selection is the planner's job, but the KIND must stay strength (never silently swapped to a different domain to dodge an equipment constraint). */
export function strengthSlotsStayStrength(sessions: readonly GeneratedPlanSession[], expectedStrengthDayCount: number): boolean {
  return sessions.filter((s) => STRENGTH_KINDS.has(s.kind)).length === expectedStrengthDayCount;
}

/** Scenarios E/H — no GeneratedPlanSession exists on any date in `blockedDates`. */
export function noSessionOnBlockedDates(sessions: readonly GeneratedPlanSession[], blockedDates: readonly string[]): boolean {
  const blocked = new Set(blockedDates);
  return sessions.every((s) => !blocked.has(s.date));
}

/** Scenario F — every DH-family session falls on one of `allowedDates`. */
export function dhSessionsOnlyOnAllowedDates(sessions: readonly GeneratedPlanSession[], allowedDates: readonly string[]): boolean {
  const allowed = new Set(allowedDates);
  return sessions.filter((s) => DH_KINDS.has(s.kind)).every((s) => allowed.has(s.date));
}

/** Scenario G — the invariant is about what NEXT week's planner must not do given history; this checker validates a proposed dose_target against the "do not escalate" rule for the strength domain specifically. */
export function strengthVolumeDidNotEscalate(previousSetVolume: number, proposedSetVolume: number): boolean {
  return proposedSetVolume <= previousSetVolume;
}

/** Every LoadProfile-bearing session actually has one, and no fixed-load kind carries one — a basic sanity invariant reused across several scenarios. */
export function loadProfilePresenceMatchesKind(sessions: readonly GeneratedPlanSession[]): boolean {
  return sessions.every((s) => {
    const requiresLoadProfile = LOAD_VARIABLE_SESSION_KINDS.has(s.kind);
    return requiresLoadProfile ? s.loadProfile !== undefined : s.loadProfile === undefined;
  });
}
