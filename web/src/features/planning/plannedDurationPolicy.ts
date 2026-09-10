// V0.3_006C2 — Planned DH duration wiring. The ONE authoritative
// athlete-authored planned duration lives in `intervention.duration_min`
// (the same field head-coach-engine's resolveDhDuration already consumes,
// see head-coach-engine/src/domains/dhPrescription.ts and
// docs/03_COACHING_MODEL.md §DH Execution Guidance). `planned_sessions
// .planned_duration_min` (the separate reserved DB column) remains
// intentionally dormant/unused — see docs/11_DECISION_LOG.md V0.3_003A and
// V0.3_006C2. This is NOT a pure availability ceiling: it is exact on a
// true KEEP and only becomes an upper bound once the Head Coach adapts the
// session (V0.3_006B semantics, unchanged by this file).
import type { TrainingInterventionKind } from "./planningTypes";

// Mirrors head-coach-engine's DH-family kinds exactly (isDhFamilyKind,
// domains/dhPrescription.ts) — the only kinds this ticket exposes a planned
// duration for. Non-DH duration arbitration is undefined/accidental in the
// engine today (V0.3_006C2 investigation §Non-DH) and deliberately out of
// scope here.
const DH_FAMILY_PLANNABLE_KINDS: ReadonlySet<TrainingInterventionKind> = new Set([
  "DH_PERFORMANCE",
  "DH_TECHNICAL",
  "DH_LIGHT",
  "PUMPTRACK",
]);

export function isDhFamilyPlannableKind(kind: TrainingInterventionKind | ""): boolean {
  return kind !== "" && DH_FAMILY_PLANNABLE_KINDS.has(kind);
}

// V0.3_007C UI canary follow-up hotfix — a strictly NARROWER predicate than
// isDhFamilyPlannableKind above, for ONE purpose only: whether the planned-
// duration helper text may claim "remontées et pauses comprises". PUMPTRACK
// stays in DH_FAMILY_PLANNABLE_KINDS (a planned duration is still a
// legitimate field for it — that eligibility is unchanged) but is never
// lift-served, so claiming uplifts for it is simply false. Deliberately a
// small local duplicate rather than importing
// completedSession/dhFamilyKind.ts's equivalent isUpliftServedDhDurationKind
// — that module is purpose-built for the performed-activity side and pulling
// it into Planning would be a cross-feature dependency for three
// comparisons, not a genuine shared concept (same duplication discipline as
// DH_FAMILY_PLANNABLE_KINDS itself, see header comment above).
const UPLIFT_SERVED_DH_PLANNABLE_KINDS: ReadonlySet<TrainingInterventionKind> = new Set(["DH_PERFORMANCE", "DH_TECHNICAL", "DH_LIGHT"]);

export function isUpliftServedDhPlannableKind(kind: TrainingInterventionKind | ""): boolean {
  return kind !== "" && UPLIFT_SERVED_DH_PLANNABLE_KINDS.has(kind);
}

/**
 * 1h to 8h in 30-minute increments — athlete-authored scheduling intent, not
 * physiological precision. A closed preset list (never free numeric entry)
 * to avoid unit confusion and absurd values on a mobile-first control.
 */
export const PLANNED_DURATION_PRESETS_MIN: readonly number[] = Array.from({ length: 15 }, (_, i) => 60 + i * 30);

export function isPlannedDurationPreset(value: number): boolean {
  return PLANNED_DURATION_PRESETS_MIN.includes(value);
}

/** "2 h" / "2 h 30" — an exact athlete-chosen value, never "environ" (that qualifier belongs to formatDhSessionWindow's rendering of the engine's own provisional/adapted duration, a different concept). */
export function formatPlannedDuration(durationMin: number): string {
  const hours = Math.floor(durationMin / 60);
  const minutes = durationMin % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes}`;
}

export const PLANNED_DURATION_LABEL = "Durée prévue";
export const PLANNED_DURATION_NONE_LABEL = "Pas de durée prévue";

const PLANNED_DURATION_HELPER_DH =
  "Temps que tu prévois de consacrer à cette séance. Pour la DH, remontées et pauses comprises. Le coach peut la réduire si ton état demande une adaptation.";
const PLANNED_DURATION_HELPER_GENERIC =
  "Temps que tu prévois de consacrer à cette séance. Le coach peut la réduire si ton état demande une adaptation.";

/** V0.3_007C UI canary follow-up hotfix — PUMPTRACK is DH-family-plannable but never lift-served, so it gets the generic copy; DH_PERFORMANCE/DH_TECHNICAL/DH_LIGHT keep the uplift-aware one. Canonical meaning unchanged either way: this is still the athlete-authored intended session window, never an availability ceiling. */
export function getPlannedDurationHelper(kind: TrainingInterventionKind | ""): string {
  return isUpliftServedDhPlannableKind(kind) ? PLANNED_DURATION_HELPER_DH : PLANNED_DURATION_HELPER_GENERIC;
}
