/**
 * GeneratedPlanSession — immutable session belonging to a generated
 * TrainingPlanWeek. V0.4 remains one session per day (M0 Issue: general
 * multi-session is deferred; the constraint is scoped to THIS layer via
 * `UNIQUE(planVersionId, date)`, not reused from the live `planned_sessions`
 * table, so a later version can widen it without restructuring this model).
 *
 * Deliberately does NOT include a stored `lockStatus`/execution-state field
 * (M0 Issue 3 self-correction): whether this date's projection was
 * manually overridden is derived at read time from `planned_sessions.
 * origin`, never stored here — this type has zero mutable fields.
 */
import type { SessionKind, LoadProfile } from "./sharedVocabulary.js";

export type SessionDoseTarget =
  | { domain: "strength"; setVolume: number; targetRpeOrRir: number }
  | { domain: "dh_technical"; skillTargets: string[]; focusedRunsCount: number }
  | { domain: "aerobic"; intensityZone: "easy" | "moderate" }
  | { domain: "recovery" };

export interface GeneratedPlanSession {
  id: string;
  weekId: string;
  planVersionId: string;
  date: string; // ISO date

  kind: SessionKind;
  /** Only meaningful when `kind` is a load-variable SessionKind (see sharedVocabulary.LOAD_VARIABLE_SESSION_KINDS) — undefined for fixed-load kinds. */
  loadProfile?: LoadProfile;
  durationMin?: number;
  focus?: string;

  doseTarget: SessionDoseTarget;
  rationale: string;

  /** Provenance for this specific date's generation — distinct from the version-level generation_trigger, since a regeneration may leave many sessions unchanged for stability (M0 §I design goal) while only a few carry a "why this one changed" note. */
  generationNote?: string;
}
