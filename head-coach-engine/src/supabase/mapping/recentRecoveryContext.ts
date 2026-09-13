/**
 * V0.3_008A — Previous-Day Recovery Continuity. Derives `RecentRecoveryContext`
 * from the same raw `completed_sessions` rows `completedSessionsRepo.ts#getRecentSessions`
 * already fetches for `recentLoad` — deliberately a SEPARATE, independent
 * mapper from `mapCompletedSessionRow` (completedSessionRow.ts), never
 * reusing it: that mapper returns `null` for any row with no recoverable
 * `TrainingIntervention` (always true for `skipped`, by construction), but
 * a `skipped` D-1 row is exactly one of the three eligible statuses here
 * (see docs/11_DECISION_LOG.md V0.3_008A). Keeping this fully separate
 * means `recentLoad`'s own pipeline (mapCompletedSessionRow, recentLoad.ts)
 * is untouched byte-for-byte by this slice.
 *
 * D-1 ONLY — never "most recent performed session regardless of age".
 * Eligibility: `change_reason === "fatigue_control"` AND
 * `completion_status` ∈ {partial, replaced, skipped}. `done` is excluded
 * both semantically (nothing to explain — the session went as planned) and
 * structurally (the V0.3_007C contract rejects a non-null change_reason for
 * `done`, so a `done` row can never actually carry `fatigue_control`).
 * Every other change_reason remains inert in V0.3_008A by design — see the
 * ticket's explicit lock, not a temporary omission.
 */
import type { CompletedSessionRawRow } from "../repositories/completedSessionsRepo.js";
import type { RecentRecoveryContext } from "../../types/rawContext.js";

const ELIGIBLE_STATUSES: ReadonlySet<string> = new Set(["partial", "replaced", "skipped"]);

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toFatigueValue(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/**
 * Returns `undefined` (never `null`, matching every other optional
 * `RawContext` field) whenever no eligible D-1 row exists — including when
 * D-1 has no completed session at all, a different change_reason, `done`,
 * or the session is D-2-or-older / same-day (both structurally impossible
 * to match here since only the exact `today - 1` date string is checked).
 */
export function mapRecentRecoveryContext(rows: readonly CompletedSessionRawRow[], today: string): RecentRecoveryContext | undefined {
  const yesterday = addDays(today, -1);
  const row = rows.find((r) => r.session_date === yesterday);
  if (!row) return undefined;

  if (row.change_reason !== "fatigue_control") return undefined;
  if (typeof row.completion_status !== "string" || !ELIGIBLE_STATUSES.has(row.completion_status)) return undefined;

  return {
    session_date: yesterday,
    completion_status: row.completion_status as "partial" | "replaced" | "skipped",
    change_reason: "fatigue_control",
    post_leg_fatigue: toFatigueValue(row.post_leg_fatigue),
    post_grip_fatigue: toFatigueValue(row.post_grip_fatigue),
  };
}
