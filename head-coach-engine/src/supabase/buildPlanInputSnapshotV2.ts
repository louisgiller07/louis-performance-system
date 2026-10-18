/**
 * UX-11A.5b.5a — runtime constructor of `PlanInputSnapshotV2`.
 *
 * Reuses the historical `buildPlanInputSnapshot` unchanged (same reads, same
 * validations, same blocking errors) and adds the rider-declared
 * `dhTechnicalTier` (nullable). The performance profile is read ONCE: the V1
 * builder's own read is captured and reused for the DH tier, so both parts of
 * the snapshot come from the same row. After this function returns, a V2 plan
 * never reads the live profile again.
 *
 * V2-L2-01a — with `v2History` (flag `NALYNT_V2_L2_HISTORY_ENABLED`, OFF by
 * default), the recent volume and missed-session count come from the V2
 * history (mapping/planHistoryV2.ts, canon docs/05); `recentSessionKinds` and
 * every other field stay the historical ones. Without it, the snapshot is
 * exactly the historical one.
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
import { readPlanHistoryFactsV2 } from "./repositories/planHistoryV2Repo.js";
import { planHistoryV2 } from "./mapping/planHistoryV2.js";

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

export interface BuildPlanInputSnapshotV2Options {
  /** V2-L2-01a — read the V2 history; anything but `true` keeps the historical snapshot. */
  v2History?: boolean;
  readPlanHistoryFactsV2?: typeof readPlanHistoryFactsV2;
}

export async function buildPlanInputSnapshotV2(
  client: SupabaseClient,
  athleteId: string,
  today: string,
  horizon: PlanInputSnapshotHorizon,
  deps: BuildPlanInputSnapshotDeps = DEFAULT_DEPS,
  options: BuildPlanInputSnapshotV2Options = {}
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

  const historical: PlanInputSnapshotV2 = { ...snapshot, dhTechnicalTier: raw as PlanInputSnapshotV2["dhTechnicalTier"] };
  if (options.v2History !== true) return historical;

  // A failed or capped read throws: the generation is refused, never fed an empty history.
  const facts = await (options.readPlanHistoryFactsV2 ?? readPlanHistoryFactsV2)(client, athleteId, today);
  const history = planHistoryV2(facts, today);
  return {
    ...historical,
    recentHistory: { ...historical.recentHistory, trailingVolumeMinutes: history.trailingVolumeMinutes, recentMissedOrReplacedCount: history.recentMissedOrReplacedCount },
  };
}
