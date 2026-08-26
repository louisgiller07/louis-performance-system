/**
 * Structural error taxonomy owned by the pain-persistence detector.
 * `CheckinNotFoundInTimelineError`, `InsufficientTimelineCoverageError`,
 * and `DuplicateCheckinDateError` are deliberately NOT redefined here —
 * they are already generic (checkin-lookup/coverage/duplicate-date
 * invariants, no sleep-energy-specific wording), owned by
 * sleepEnergyErrors.ts, and reused verbatim so there is exactly one
 * identity for each of those invariants across the whole detectors/**
 * package (same philosophy as detectors/errors.ts deliberately not
 * redefining the shared relations/** errors it propagates unwrapped).
 */

/**
 * The real DB enforces `pain=false <=> pain_intensity IS NULL` and
 * `pain=true <=> pain_intensity IS NOT NULL` (0-10 inclusive) — see
 * `daily_checkins_pain_intensity_check`/`pain_intensity_requires_pain` in
 * `supabase/migrations/20260814095000_baseline_v0_2.sql`. Should never
 * happen against a real Supabase-sourced timeline — kept as defense in
 * depth against a malformed synthetic timeline (e.g. in tests), same
 * philosophy as DuplicateCheckinDateError. Never normalized/coerced (e.g.
 * `pain=false` + `painIntensity=null` is never treated as intensity 0) —
 * the longitudinal detector preserves source semantics exactly.
 */
export class InconsistentPainStateError extends Error {
  constructor(checkinId: string, pain: boolean, painIntensity: number | null) {
    super(
      `InconsistentPainStateError: checkin "${checkinId}" has pain=${String(pain)} and painIntensity=${String(painIntensity)} — the real schema requires pain=false<=>painIntensity IS NULL, pain=true<=>painIntensity IS NOT NULL in [0,10]`
    );
    this.name = "InconsistentPainStateError";
  }
}
