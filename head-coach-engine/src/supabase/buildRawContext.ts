/**
 * `RawContext` builder — Supabase → M1 `RawContext`. See
 * docs/06_ARCHITECTURE.md §Adapter Supabase (M2 — actif),
 * §Traduction lecture Supabase → RawContext.
 *
 * Pure read + translation: no write, no SAFETY/coaching logic, no
 * reimplementation of any M1 rule, no invented intervention, no computed
 * "readiness score". Every field is either read verbatim from a table
 * M1 actually consumes, or set to the one explicit constant the canon
 * requires (`active_experiments: []`).
 *
 * `RawContext.current_block`, `.availability`, `.life_constraints` are
 * intentionally never populated: they are optional on `RawContext` and,
 * per a full grep of `src/{engine,rules,domains}`, are not read by any M1
 * rule — building repositories for `training_blocks` (beyond the single
 * `mode` column) or `weekly_availability` would be data M1 never
 * consumes. See the M2 integration report for the grep evidence.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompletedSessionSummary, DbSessionType, RawContext } from "../types/index.js";

import { getCheckinFor } from "./repositories/dailyCheckinsRepo.js";
import { getCurrentTrainingModeRaw } from "./repositories/trainingBlocksRepo.js";
import { getPlannedSessionFor } from "./repositories/plannedSessionsRepo.js";
import { getRacesInWindow } from "./repositories/raceCalendarRepo.js";
import { getRecentSessions } from "./repositories/completedSessionsRepo.js";
import { getOpenHealthFlags } from "./repositories/healthFlagsRepo.js";
import { getTotalCheckinsCount, getTotalCompletedSessionsCount } from "./repositories/athleteCountsRepo.js";
import { getCoachingProfileFor } from "./repositories/athleteCoachingProfileRepo.js";

import { mapDailyCheckinRow } from "./mapping/dailyCheckinRow.js";
import { parseTrainingMode } from "./mapping/trainingMode.js";
import { mapPlannedSessionRow } from "./mapping/plannedSessionIntervention.js";
import { mapRaceCalendarRow } from "./mapping/raceCalendarRow.js";
import { mapCompletedSessionRow } from "./mapping/completedSessionRow.js";
import { mapHealthFlagRow } from "./mapping/healthFlagRow.js";
import { mapCoachingProfileRow } from "./mapping/coachingProfileRow.js";

export class NoCurrentCheckinError extends Error {
  constructor(athleteId: string, date: string) {
    super(`No daily_checkins row for athlete ${athleteId} on ${date} — cannot build RawContext.checkin.`);
    this.name = "NoCurrentCheckinError";
  }
}

export class NoCurrentTrainingBlockError extends Error {
  constructor(athleteId: string) {
    super(
      `No current training_blocks row (is_current = true) for athlete ${athleteId} — cannot determine ` +
        "RawContext.active_mode."
    );
    this.name = "NoCurrentTrainingBlockError";
  }
}

export interface BuildRawContextResult {
  rawContext: RawContext;
  /**
   * Non-fatal reconstruction warnings surfaced by the adapters — e.g. an
   * ambiguous legacy `planned_sessions.session_type` with no `intervention`
   * JSONB (docs/06_ARCHITECTURE.md §Fallback d'intervention en lecture), or
   * a `race_calendar.race_format` that was NULL and had to be reconciled
   * to `"OTHER"` (docs/11_DECISION_LOG.md). `RawContext`/M1 has no field
   * for these (frozen, not modified here), so they are carried alongside
   * the `RawContext` at this M2 boundary instead of being silently
   * dropped.
   */
  warnings: string[];
}

/**
 * Builds a complete `RawContext` for `athleteId` on `today` from Supabase.
 * Read-only — zero write. Throws explicitly ({@link NoCurrentCheckinError},
 * {@link NoCurrentTrainingBlockError}, or a mapper's own validation error)
 * rather than fabricating a value for data that isn't there.
 */
export async function buildRawContext(
  client: SupabaseClient,
  athleteId: string,
  today: string
): Promise<BuildRawContextResult> {
  const warnings: string[] = [];

  const checkinRow = await getCheckinFor(client, athleteId, today);
  if (!checkinRow) throw new NoCurrentCheckinError(athleteId, today);
  const checkin = mapDailyCheckinRow(checkinRow);

  const rawMode = await getCurrentTrainingModeRaw(client, athleteId);
  if (rawMode === null) throw new NoCurrentTrainingBlockError(athleteId);
  const active_mode = parseTrainingMode(rawMode);

  const plannedRow = await getPlannedSessionFor(client, athleteId, today);
  let planned_session = null as RawContext["planned_session"];
  let planned_intent: string | undefined;
  if (plannedRow) {
    const mapping = mapPlannedSessionRow({
      session_type: plannedRow.session_type as DbSessionType,
      intervention: plannedRow.intervention,
      planned_intent: plannedRow.planned_intent,
    });
    planned_session = mapping.planned_session;
    planned_intent = mapping.planned_intent ?? undefined;
    warnings.push(...mapping.warnings);
  }

  const raceRows = await getRacesInWindow(client, athleteId, today);
  const upcoming_races = raceRows.map((row) => {
    const mapping = mapRaceCalendarRow(row);
    warnings.push(...mapping.warnings);
    return mapping.race;
  });

  const sessionRows = await getRecentSessions(client, athleteId, today);
  const recent_sessions: CompletedSessionSummary[] = [];
  for (const row of sessionRows) {
    const mapped = mapCompletedSessionRow(row);
    if (mapped) recent_sessions.push(mapped);
  }

  const flagRows = await getOpenHealthFlags(client, athleteId);
  const active_health_flags = flagRows.map(mapHealthFlagRow);

  const n_total_checkins = await getTotalCheckinsCount(client, athleteId);
  const n_total_completed_sessions = await getTotalCompletedSessionsCount(client, athleteId);

  const coachingProfileRow = await getCoachingProfileFor(client, athleteId);
  const coaching_profile = coachingProfileRow ? mapCoachingProfileRow(coachingProfileRow) : undefined;

  const rawContext: RawContext = {
    today,
    checkin,
    planned_session,
    ...(planned_intent !== undefined ? { planned_intent } : {}),
    active_mode,
    upcoming_races,
    recent_sessions,
    active_experiments: [],
    active_health_flags,
    ...(coaching_profile !== undefined ? { coaching_profile } : {}),
    n_total_checkins,
    n_total_completed_sessions,
  };

  return { rawContext, warnings };
}
