/**
 * `completed_sessions` rows → `PlanInputRecentHistory` (V0.5_006 decision
 * lock). planning-engine's own doc-comment on the type is the contract this
 * mapper implements verbatim: "Derived from `completed_sessions` history —
 * NOT athlete-declared, no new storage" (planning-engine/src/types/
 * planInputSnapshot.ts) — every field below comes from the SAME rows
 * `completedSessionsRepo.getRecentSessions()` already returns, no join
 * against `planned_sessions`.
 *
 * `recentSessionKinds` reuses {@link mapCompletedSessionRow} rather than
 * reading `session_type` directly. `session_type` (DbSessionType, the DB's
 * coarse enum) and `SessionKind` (planning-engine's rich vocabulary) are
 * different, non-interchangeable vocabularies — the same surjective,
 * non-invertible mapping problem documented for `planned_sessions`
 * (docs/05_DATA_MODEL.md §planned_sessions) applies identically here. Only
 * `intervention.kind`, already safely resolved by `mapCompletedSessionRow`
 * (M2_004), can populate a `SessionKind[]` without inventing an ambiguous
 * inversion — so a `skipped` row (whose `intervention` is always `NULL` by
 * construction, V0.3_007B) correctly contributes no kind, without this
 * mapper re-deriving that rule itself.
 *
 * `recentMissedOrReplacedCount` reads `completion_status` directly off the
 * raw row instead: routing it through `mapCompletedSessionRow` would lose
 * every `skipped` row (which always maps to `null` there), the exact
 * category this count exists to capture.
 *
 * Same raw rows as `recentLoad.ts`/`recentRecoveryContext.ts` already
 * consume — a fully independent mapper layered over them, never a second
 * query (same precedent as V0.3_008A's `recentRecoveryContext.ts`).
 */
import type { PlanInputRecentHistory } from "planning-engine";
import { mapCompletedSessionRow } from "./completedSessionRow.js";
import type { CompletedSessionRawRow } from "../repositories/completedSessionsRepo.js";

/**
 * Pure fold over `getRecentSessions()`'s already-windowed rows — no DB
 * access, no re-filtering by date (the repository's own window bound is
 * already exactly the scope this function operates over). Propagates
 * {@link InvalidCompletedSessionRowError}/`InvalidTrainingInterventionJsonError`
 * uncaught for a malformed row, same "never silently accept malformed data"
 * discipline as `buildRawContext.ts`'s own use of `mapCompletedSessionRow`.
 */
export function mapPlanInputRecentHistory(rows: readonly CompletedSessionRawRow[]): PlanInputRecentHistory {
  const recentSessionKinds: PlanInputRecentHistory["recentSessionKinds"] = [];
  let recentMissedOrReplacedCount = 0;
  let trailingVolumeMinutes = 0;

  for (const row of rows) {
    if (row.completion_status === "skipped" || row.completion_status === "replaced") {
      recentMissedOrReplacedCount += 1;
    }

    if (typeof row.actual_duration_min === "number") {
      trailingVolumeMinutes += row.actual_duration_min;
    }

    const mapped = mapCompletedSessionRow(row);
    if (mapped !== null) {
      recentSessionKinds.push(mapped.intervention.kind);
    }
  }

  return { recentSessionKinds, recentMissedOrReplacedCount, trailingVolumeMinutes };
}
