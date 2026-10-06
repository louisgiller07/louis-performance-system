/**
 * `buildPlanInputSnapshot` — Supabase repositories → `PlanInputSnapshot`
 * (V0.5_008 architecture lock). Same role, for the V0.4/V0.5 generation
 * pipeline, that `buildRawContext.ts` already plays for M1: pure read +
 * translation, zero write, zero coaching logic, zero call into
 * planning-engine's pipeline or prescription-engine. Throws explicitly
 * ({@link GenerationBlockedError} family, or a validator's own error) rather
 * than fabricating a value for data that isn't there — never a permissive
 * default (full availability, complete equipment, a guessed athlete tier or
 * discipline).
 *
 * Ownership split, per V0.5_008: `PlanInputSnapshot` itself belongs to
 * planning-engine (frozen contract, zero I/O there); constructing one from
 * live data belongs here. `deps` mirrors `RunDailyForDeps`'s own shape
 * exactly — an injectable seam for orchestration testing with plain mocks,
 * never an IoC framework; production callers pass only `(client, athleteId,
 * today, horizon)`.
 *
 * `horizon` (V0.5_041/042) is the generated plan's own `{startDate,
 * endDate}` (from `deriveTrainingPlanBlock`) — required, no default. It is
 * used for exactly one thing: loading `races` over the plan's full range
 * via `getRacesOverlappingRange`, never M1's fixed `getRacesInWindow`
 * window. Every other field (availability/recentHistory/lockedDates/
 * profile) is deliberately unaffected — see V0.5_041's own audit for why
 * none of them need horizon-awareness today.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PlanInputSnapshot,
  PlanInputAvailability,
  PlanInputAvailabilityWindow,
  PlanInputAvailabilityException,
  PlanInputRace,
  PlanInputLockedDate,
  PlanInputTechnicalPriorities,
} from "planning-engine";
import {
  assertAvailabilityDeclared,
  assertValidStrengthExperienceTier,
  assertValidEquipment,
  assertValidTerrainAccess,
  assertValidPriorityAreas,
  GenerationBlockedError,
} from "planning-engine";

import { getAthleteCoachingContext } from "./repositories/athleteCoachingContextRepo.js";
import { getPerformanceProfileFor } from "./repositories/athletePerformanceProfileRepo.js";
import { getAvailabilityWindowsFor, type AthleteAvailabilityWindowRawRow } from "./repositories/athleteAvailabilityWindowsRepo.js";
import { getAvailabilityExceptionsFor, type AthleteAvailabilityExceptionRawRow } from "./repositories/athleteAvailabilityExceptionsRepo.js";
import { getLockedDatesFor, type AthleteLockedDateRawRow } from "./repositories/athleteLockedDatesRepo.js";
import { getRacesOverlappingRange, type RaceCalendarRawRow } from "./repositories/raceCalendarRepo.js";
import { getRecentSessions } from "./repositories/completedSessionsRepo.js";
import { mapPlanInputRecentHistory } from "./mapping/mapPlanInputRecentHistory.js";

/**
 * Injectable seam — same reasoning as `RunDailyForDeps`/`ProjectTrainingPlanDeps`:
 * lets orchestration (call counts, exact arguments) be unit-tested with
 * plain mocks, without a live DB. Production callers never need to pass
 * this. No DI framework — a plain object defaulting to the real repository
 * functions.
 */
export interface BuildPlanInputSnapshotDeps {
  getAthleteCoachingContext: typeof getAthleteCoachingContext;
  getPerformanceProfileFor: typeof getPerformanceProfileFor;
  getAvailabilityWindowsFor: typeof getAvailabilityWindowsFor;
  getAvailabilityExceptionsFor: typeof getAvailabilityExceptionsFor;
  getLockedDatesFor: typeof getLockedDatesFor;
  getRacesOverlappingRange: typeof getRacesOverlappingRange;
  getRecentSessions: typeof getRecentSessions;
}

const DEFAULT_DEPS: BuildPlanInputSnapshotDeps = {
  getAthleteCoachingContext,
  getPerformanceProfileFor,
  getAvailabilityWindowsFor,
  getAvailabilityExceptionsFor,
  getLockedDatesFor,
  getRacesOverlappingRange,
  getRecentSessions,
};

/** The generated plan's own horizon (V0.5_041 lock) — deliberately just the two dates the Planning Engine's race window actually needs, never the full `TrainingPlanBlock` (mode/name/primaryFocus/sequenceNumber are irrelevant here). Required, no default: a caller that forgets it must fail to compile, never silently fall back to an M1-shaped window. */
export interface PlanInputSnapshotHorizon {
  startDate: string;
  endDate: string;
}

function mapAvailabilityWindow(row: AthleteAvailabilityWindowRawRow): PlanInputAvailabilityWindow {
  return {
    dayOfWeek: row.day_of_week as PlanInputAvailabilityWindow["dayOfWeek"],
    startTime: row.start_time,
    endTime: row.end_time,
    ...(row.label !== null ? { label: row.label } : {}),
    // BUG-V2-1 — 'any' (legacy) maps to no field at all: a legacy snapshot,
    // its hash and its planning stay exactly what they were.
    ...(row.activity === "physical" || row.activity === "riding" ? { activity: row.activity } : {}),
  };
}

function mapAvailabilityException(row: AthleteAvailabilityExceptionRawRow): PlanInputAvailabilityException {
  return {
    date: row.date,
    available: row.available,
    ...(row.note !== null ? { note: row.note } : {}),
  };
}

function mapLockedDate(row: AthleteLockedDateRawRow): PlanInputLockedDate {
  return {
    date: row.date,
    ...(row.reason !== null ? { reason: row.reason } : {}),
  };
}

/**
 * `event_name`/`start_date`/`end_date`/`priority` are all real `NOT NULL`
 * columns, and `priority` is a genuine Postgres enum (`race_priority`) —
 * unlike `strength_experience_tier` (plain `text` + a non-blank CHECK
 * only), the DB itself already rules out an unrecognized `priority` value,
 * so no extra runtime validation is warranted here (see V0.5_009 report).
 */
function mapRace(row: RaceCalendarRawRow): PlanInputRace {
  return {
    eventName: row.event_name as string,
    startDate: row.start_date as string,
    endDate: row.end_date as string,
    priority: row.priority as PlanInputRace["priority"],
  };
}

/**
 * `technical_priorities` is `jsonb not null default '{}'::jsonb` — a real,
 * legitimate value once a Performance Setup row exists, but its 3 sub-keys
 * may each be individually absent. Structural normalization only (missing
 * key -> empty array), never a coaching default — V0.5_008 §5.
 */
/**
 * Deterministic generation snapshot (fix of a pre-existing bug, see
 * docs/11_DECISION_LOG.md "Snapshot de génération déterministe"). The
 * collections below are read without a guaranteed SQL order, and their
 * position carries no meaning for any planner rule (windows: set of
 * days + longest window per day; exceptions: map by date; locked dates: set;
 * recent sessions: counts and sums only). Their DB order used to leak into
 * the persisted snapshot and its hash, so the same data could produce a
 * different hash and break `generation_request_id` idempotence. They are
 * put in one canonical order, on their business fields, before the
 * snapshot is built (so the persisted and the hashed snapshot are the same
 * canonical object). Ordered collections are untouched: races (already
 * ordered by the query) and every profile array (stored JSONB order;
 * priorityAreas order is meaningful).
 */
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Day of week → start time → end time → label (absent first) → activity (absent first, BUG-V2-1). */
export function compareAvailabilityWindows(a: PlanInputAvailabilityWindow, b: PlanInputAvailabilityWindow): number {
  return (
    a.dayOfWeek - b.dayOfWeek ||
    compareText(a.startTime, b.startTime) ||
    compareText(a.endTime, b.endTime) ||
    compareText(a.label ?? "", b.label ?? "") ||
    compareText(a.activity ?? "", b.activity ?? "")
  );
}

/** Date (unique per athlete) → availability → note (absent first). */
export function compareAvailabilityExceptions(a: PlanInputAvailabilityException, b: PlanInputAvailabilityException): number {
  return compareText(a.date, b.date) || Number(a.available) - Number(b.available) || compareText(a.note ?? "", b.note ?? "");
}

/** Date (unique per athlete) → reason (absent first). */
export function compareLockedDates(a: PlanInputLockedDate, b: PlanInputLockedDate): number {
  return compareText(a.date, b.date) || compareText(a.reason ?? "", b.reason ?? "");
}

function normalizeTechnicalPriorities(raw: unknown): PlanInputTechnicalPriorities {
  const obj = (raw !== null && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    strengths: Array.isArray(obj.strengths) ? (obj.strengths as string[]) : [],
    weaknesses: Array.isArray(obj.weaknesses) ? (obj.weaknesses as string[]) : [],
    priorityAreas: Array.isArray(obj.priorityAreas) ? (obj.priorityAreas as string[]) : [],
  };
}

/**
 * Builds a complete `PlanInputSnapshot` for `athleteId` as of `today`.
 * Read-only — zero write, zero RPC call, zero call into planning-engine's
 * pipeline or prescription-engine (that composition is a separate, later
 * orchestrator's job, not this function's).
 *
 * Every check below is a critical, blocking step — never wrapped in
 * try/catch, never turned into a warning (unlike `runDailyFor.ts`'s
 * best-effort steps): every field `PlanInputSnapshot` declares is
 * structurally required, so there is no "cosmetic" step here whose failure
 * could be tolerated. Throws {@link GenerationBlockedError} for data that is
 * validly absent, or a validator's own error (e.g.
 * `PlanningEngineValidationError` via `assertValidStrengthExperienceTier`)
 * for data that is present but malformed — never fabricates a value for
 * either case.
 */
export async function buildPlanInputSnapshot(
  client: SupabaseClient,
  athleteId: string,
  today: string,
  horizon: PlanInputSnapshotHorizon,
  deps: BuildPlanInputSnapshotDeps = DEFAULT_DEPS
): Promise<PlanInputSnapshot> {
  // --- Discipline / profil (athleteCoachingContextRepo) ---
  const coachingContext = await deps.getAthleteCoachingContext(client, athleteId);
  if (coachingContext.discipline === undefined) {
    throw new GenerationBlockedError("missing_discipline");
  }
  const discipline = coachingContext.discipline;
  const competitionLevel = coachingContext.competition_level;

  // --- Performance profile (athletePerformanceProfileRepo) ---
  const performanceProfile = await deps.getPerformanceProfileFor(client, athleteId);
  if (performanceProfile === null) {
    throw new GenerationBlockedError("missing_performance_profile");
  }
  if (performanceProfile.strength_experience_tier === null) {
    throw new GenerationBlockedError("missing_strength_experience_tier");
  }
  assertValidStrengthExperienceTier(performanceProfile.strength_experience_tier);
  const strengthExperienceTier = performanceProfile.strength_experience_tier;

  const seasonObjective = performanceProfile.season_objective ?? undefined;
  const equipment = performanceProfile.equipment as string[];
  const terrainAccess = performanceProfile.terrain_access as string[];
  const declaredLimitations = performanceProfile.declared_limitations as string[];
  const technicalPriorities = normalizeTechnicalPriorities(performanceProfile.technical_priorities);

  // V0.5_019 — equipment/terrainAccess/priorityAreas are present-but-malformed
  // checks (PlanningEngineValidationError), same category as the tier check
  // above, never GenerationBlockedError (reserved for validly absent data).
  // declaredLimitations/seasonObjective are deliberately NOT validated here —
  // no planning-engine/prescription-engine rule consumes either today
  // (V0.5_017/018 audits), so there is nothing a closed vocabulary could be
  // checked against without inventing one.
  assertValidEquipment(equipment);
  assertValidTerrainAccess(terrainAccess);
  assertValidPriorityAreas(technicalPriorities.priorityAreas);

  // --- Availability (athleteAvailabilityWindowsRepo / athleteAvailabilityExceptionsRepo) ---
  const [windowRows, exceptionRows] = await Promise.all([
    deps.getAvailabilityWindowsFor(client, athleteId),
    deps.getAvailabilityExceptionsFor(client, athleteId),
  ]);
  const availability: PlanInputAvailability = {
    windows: windowRows.map(mapAvailabilityWindow).sort(compareAvailabilityWindows),
    exceptions: exceptionRows.map(mapAvailabilityException).sort(compareAvailabilityExceptions),
  };
  assertAvailabilityDeclared(availability);

  // --- Locked dates (athleteLockedDatesRepo) — empty table is legitimate, never blocking ---
  const lockedDateRows = await deps.getLockedDatesFor(client, athleteId);
  const lockedDates = lockedDateRows.map(mapLockedDate).sort(compareLockedDates);

  // --- Races (raceCalendarRepo) — never blocking, an empty calendar is
  // legitimate. Horizon-aware (V0.5_041/042): loads exactly
  // [horizon.startDate, horizon.endDate] — the generated plan's own full
  // range, never M1's fixed short window (getRacesInWindow, untouched,
  // still used only by buildRawContext.ts).
  const raceRows = await deps.getRacesOverlappingRange(client, athleteId, horizon.startDate, horizon.endDate, today);
  const races = raceRows.map(mapRace);

  // --- Recent history (completedSessionsRepo + mapPlanInputRecentHistory, V0.5_006/007) ---
  const recentSessionRows = await deps.getRecentSessions(client, athleteId, today);
  // Chronological (session_date is unique per athlete): only the order of
  // recentSessionKinds depends on it. The shared read (also used by M1's
  // context) is left untouched; the snapshot canonicalizes its own copy.
  const recentHistory = mapPlanInputRecentHistory([...recentSessionRows].sort((a, b) => compareText(String(a.session_date), String(b.session_date))));

  return {
    discipline,
    ...(competitionLevel !== undefined ? { competitionLevel } : {}),
    ...(seasonObjective !== undefined ? { seasonObjective } : {}),
    races,
    availability,
    equipment,
    terrainAccess,
    strengthExperienceTier,
    declaredLimitations,
    technicalPriorities,
    lockedDates,
    recentHistory,
  };
}
