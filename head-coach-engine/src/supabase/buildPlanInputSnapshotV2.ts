/**
 * UX-11A.5b.5a — runtime constructor of `PlanInputSnapshotV2`.
 *
 * Reuses the historical `buildPlanInputSnapshot` unchanged (same reads, same
 * validations, same blocking errors) and adds the rider-declared
 * `dhTechnicalTier` (nullable). The performance profile is read ONCE: the V1
 * builder's own read is captured and reused for the DH tier, so both parts of
 * the snapshot come from the same row. After this function returns, a V2 plan
 * never reads the live profile again.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanInputSnapshotV2 } from "planning-engine/session-model-v2";
import { buildPlanInputSnapshot, type BuildPlanInputSnapshotDeps, type PlanInputSnapshotHorizon } from "./buildPlanInputSnapshot.js";
import { getAthleteCoachingContext } from "./repositories/athleteCoachingContextRepo.js";
import { getPerformanceProfileFor, type AthletePerformanceProfileRawRow } from "./repositories/athletePerformanceProfileRepo.js";
import { getAvailabilityWindowsFor } from "./repositories/athleteAvailabilityWindowsRepo.js";
import { getAvailabilityExceptionsFor } from "./repositories/athleteAvailabilityExceptionsRepo.js";
import { getLockedDatesFor } from "./repositories/athleteLockedDatesRepo.js";
import { getRacesOverlappingRange } from "./repositories/raceCalendarRepo.js";
import { getRecentSessions } from "./repositories/completedSessionsRepo.js";

/** Same repositories as buildPlanInputSnapshot's own defaults. */
const DEFAULT_DEPS: BuildPlanInputSnapshotDeps = {
  getAthleteCoachingContext,
  getPerformanceProfileFor,
  getAvailabilityWindowsFor,
  getAvailabilityExceptionsFor,
  getLockedDatesFor,
  getRacesOverlappingRange,
  getRecentSessions,
};

const DH_TECHNICAL_TIERS = ["beginner", "intermediate", "advanced"] as const;

export class InvalidDhTechnicalTierError extends Error {
  constructor(value: string) {
    super(`athlete_performance_profiles.dh_technical_tier has an unknown value: ${JSON.stringify(value)}`);
    this.name = "InvalidDhTechnicalTierError";
  }
}

export async function buildPlanInputSnapshotV2(
  client: SupabaseClient,
  athleteId: string,
  today: string,
  horizon: PlanInputSnapshotHorizon,
  deps: BuildPlanInputSnapshotDeps = DEFAULT_DEPS
): Promise<PlanInputSnapshotV2> {
  let profile: AthletePerformanceProfileRawRow | null | undefined;
  const capturing: BuildPlanInputSnapshotDeps = {
    ...deps,
    getPerformanceProfileFor: async (c, id) => {
      profile = await deps.getPerformanceProfileFor(c, id);
      return profile;
    },
  };

  const snapshot = await buildPlanInputSnapshot(client, athleteId, today, horizon, capturing);

  // buildPlanInputSnapshot has already refused a missing profile; the row is captured.
  const raw = profile?.dh_technical_tier ?? null;
  if (raw !== null && !(DH_TECHNICAL_TIERS as readonly string[]).includes(raw)) throw new InvalidDhTechnicalTierError(raw);

  return { ...snapshot, dhTechnicalTier: raw as PlanInputSnapshotV2["dhTechnicalTier"] };
}
