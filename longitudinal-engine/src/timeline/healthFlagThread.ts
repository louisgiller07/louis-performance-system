import type { DailyCheckinSource, HealthFlagSource } from "../types/sources.js";
import type { HealthFlagThread } from "./types.js";
import { resolveLink } from "./linking.js";
import { sortedBy } from "./ordering.js";

export function buildHealthFlagThreads(
  healthFlags: readonly HealthFlagSource[],
  checkinsById: ReadonlyMap<string, DailyCheckinSource>
): readonly HealthFlagThread[] {
  return sortedBy(healthFlags, (f) => f.id).map((flag) => ({
    flag,
    openedOn: flag.flagDate,
    resolvedOn: flag.resolvedAt,
    linkedSourceCheckin: resolveLink(flag.sourceCheckinId, checkinsById),
  }));
}
