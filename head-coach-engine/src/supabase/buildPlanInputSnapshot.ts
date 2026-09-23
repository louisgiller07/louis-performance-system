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
 * today)`.
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
import { getRacesInWindow, type RaceCalendarRawRow } from "./repositories/raceCalendarRepo.js";
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
  getRacesInWindow: typeof getRacesInWindow;
  getRecentSessions: typeof getRecentSessions;
}

const DEFAULT_DEPS: BuildPlanInputSnapshotDeps = {
  getAthleteCoachingContext,
  getPerformanceProfileFor,
  getAvailabilityWindowsFor,
  getAvailabilityExceptionsFor,
  getLockedDatesFor,
  getRacesInWindow,
  getRecentSessions,
};

function mapAvailabilityWindow(row: AthleteAvailabilityWindowRawRow): PlanInputAvailabilityWindow {
  return {
    dayOfWeek: row.day_of_week as PlanInputAvailabilityWindow["dayOfWeek"],
    startTime: row.start_time,
    endTime: row.end_time,
    ...(row.label !== null ? { label: row.label } : {}),
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
    windows: windowRows.map(mapAvailabilityWindow),
    exceptions: exceptionRows.map(mapAvailabilityException),
  };
  assertAvailabilityDeclared(availability);

  // --- Locked dates (athleteLockedDatesRepo) — empty table is legitimate, never blocking ---
  const lockedDateRows = await deps.getLockedDatesFor(client, athleteId);
  const lockedDates = lockedDateRows.map(mapLockedDate);

  // --- Races (raceCalendarRepo) — never blocking, an empty calendar is legitimate ---
  const raceRows = await deps.getRacesInWindow(client, athleteId, today);
  const races = raceRows.map(mapRace);

  // --- Recent history (completedSessionsRepo + mapPlanInputRecentHistory, V0.5_006/007) ---
  const recentSessionRows = await deps.getRecentSessions(client, athleteId, today);
  const recentHistory = mapPlanInputRecentHistory(recentSessionRows);

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
