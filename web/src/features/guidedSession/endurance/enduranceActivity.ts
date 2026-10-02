// UX-11C.4 — pure model of a guided endurance session: the ONE activity the
// rider actually performed (session_activity_results), chosen among the
// execution's own final prescription activitySelection. Actual ≠ prescribed:
// the prescribed duration / RPE are shown apart and never prefill the
// entry; no score, alert or judgement compares them.
// UI units → DB units, explicitly: minutes → duration_seconds (× 60),
// km → distance_m (× 1000, rounded to the meter), RPE 1–10 unchanged.
import type { FinalPrescriptionV2View, RangeView } from "../../finalPrescriptionV2/finalPrescriptionV2Types";
import type { ActivityResultRow } from "../executionState";

export interface ActivityOption {
  id: string;
  label: string;
}

export function isGuidedEndurancePrescription(p: FinalPrescriptionV2View): boolean {
  return p.family === "endurance";
}

/** The activities the prescription allows, in its order; missing, empty or duplicated → null (fail closed, never a default pick). */
export function allowedActivities(p: FinalPrescriptionV2View): ActivityOption[] | null {
  const options = p.activityOptions;
  if (!options || options.length === 0) return null;
  if (new Set(options.map((o) => o.id)).size !== options.length) return null;
  return options;
}

/** Planned duration = the sum of the blocks' durations (null when the prescription states none). */
export function plannedMinutes(p: FinalPrescriptionV2View): RangeView | null {
  const ranges = p.blocks.map((b) => b.durationMinutes).filter((r): r is RangeView => r !== undefined);
  if (ranges.length === 0) return null;
  return { min: ranges.reduce((t, r) => t + r.min, 0), max: ranges.reduce((t, r) => t + r.max, 0) };
}

/** The prescribed effort of the main block (shown next to the actual RPE, never replacing it). */
export const mainBlockRpe = (p: FinalPrescriptionV2View): RangeView | null => p.blocks.find((b) => b.role === "main")?.rpeTarget ?? null;

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

const MAX_INT = 2147483647;

export const minutesToSeconds = (minutes: number): number => minutes * 60;

/** km (≤ 3 decimals) → integer meters; rounding absorbs floating-point noise (18.4 × 1000 = 18400.000000000004). */
export const kmToMeters = (km: number): number => Math.round(km * 1000);

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

export const formatDistance = (meters: number): string => `${String(meters / 1000).replace(".", ",")} km`;

// ---------------------------------------------------------------------------
// Entry form → activity result (validated like the backend, never looser)
// ---------------------------------------------------------------------------

export interface ActivityFormValues {
  activityId: string | null;
  minutes: string;
  km: string;
  rpe: string;
}

export type ActivityFormErrors = Partial<Record<keyof ActivityFormValues, string>>;

export interface ActivityValues {
  activity_id: string;
  duration_seconds: number;
  distance_m: number | null;
  rpe_actual: number | null;
}

export const EMPTY_ACTIVITY_FORM: ActivityFormValues = { activityId: null, minutes: "", km: "", rpe: "" };

const normalize = (s: string) => s.trim().replace(",", ".");

export function validateActivityForm(allowed: readonly ActivityOption[], form: ActivityFormValues): { ok: true; value: ActivityValues } | { ok: false; errors: ActivityFormErrors } {
  const errors: ActivityFormErrors = {};
  if (form.activityId === null || !allowed.some((a) => a.id === form.activityId)) errors.activityId = "Choisis l'activité que tu as réellement faite.";

  const minutesText = normalize(form.minutes);
  const minutes = Number(minutesText);
  if (!/^\d+$/.test(minutesText) || minutes < 1 || minutesToSeconds(minutes) > MAX_INT) errors.minutes = "Indique la durée réalisée en minutes entières (1 ou plus).";

  const kmText = normalize(form.km);
  let distance: number | null = null;
  if (kmText !== "") {
    const meters = /^\d+(\.\d{1,3})?$/.test(kmText) ? kmToMeters(Number(kmText)) : NaN;
    if (!Number.isFinite(meters) || meters > MAX_INT) errors.km = "Indique une distance en km (0 ou plus, trois décimales au plus).";
    else distance = meters;
  }

  const rpeText = normalize(form.rpe);
  let rpe: number | null = null;
  if (rpeText !== "") {
    const value = /^\d+(\.\d)?$/.test(rpeText) ? Number(rpeText) : NaN;
    if (!Number.isFinite(value) || value < 1 || value > 10) errors.rpe = "Le RPE va de 1 à 10 (une décimale au plus).";
    else rpe = value;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { activity_id: form.activityId!, duration_seconds: minutesToSeconds(minutes), distance_m: distance, rpe_actual: rpe } };
}

/** A recorded result as editable values (a duration that is not a whole number of minutes is left to re-enter, never rounded silently). */
export const formFromActivity = (r: ActivityResultRow): ActivityFormValues => ({
  activityId: r.activity_id,
  minutes: r.duration_seconds % 60 === 0 ? String(r.duration_seconds / 60) : "",
  km: r.distance_m === null ? "" : String(r.distance_m / 1000),
  rpe: r.rpe_actual === null ? "" : String(r.rpe_actual),
});

export const isEmptyActivityForm = (f: ActivityFormValues) => f.activityId === null && f.minutes.trim() === "" && f.km.trim() === "" && f.rpe.trim() === "";

export const sameActivityValues = (r: ActivityResultRow, v: ActivityValues) =>
  r.activity_id === v.activity_id && r.duration_seconds === v.duration_seconds && r.distance_m === v.distance_m && r.rpe_actual === v.rpe_actual;
