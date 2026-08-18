import { PAIN_LOCATION_CODES, type CheckinFormState, type CheckinInput } from "./checkinTypes";

// Ranges mirror the real DB CHECK constraints exactly (see
// supabase/migrations/20260814095000_baseline_v0_2.sql) — not invented.
const RANGE_0_10 = { min: 0, max: 10 } as const;
const RANGE_0_24 = { min: 0, max: 24 } as const;
const RANGE_0_20 = { min: 0, max: 20 } as const;

export type CheckinFieldErrors = Partial<Record<keyof CheckinFormState, string>>;

export type ValidateCheckinResult = { ok: true; values: CheckinInput } | { ok: false; errors: CheckinFieldErrors };

function inRange(value: number, range: { min: number; max: number }): boolean {
  return value >= range.min && value <= range.max;
}

function validateRequiredNumber(
  value: number | "",
  range: { min: number; max: number },
  label: string
): { value: number } | { error: string } {
  if (value === "") return { error: `${label} est requis.` };
  if (!Number.isFinite(value)) return { error: `${label} doit être un nombre.` };
  if (!inRange(value, range)) return { error: `${label} doit être entre ${range.min} et ${range.max}.` };
  return { value };
}

export function validateCheckin(state: CheckinFormState): ValidateCheckinResult {
  const errors: CheckinFieldErrors = {};

  const sleepHours = validateRequiredNumber(state.sleep_hours, RANGE_0_24, "Heures de sommeil");
  if ("error" in sleepHours) errors.sleep_hours = sleepHours.error;

  const sleepQuality = validateRequiredNumber(state.sleep_quality, RANGE_0_10, "Qualité du sommeil");
  if ("error" in sleepQuality) errors.sleep_quality = sleepQuality.error;

  const sleepWakeUps = validateRequiredNumber(state.sleep_wake_ups, RANGE_0_20, "Réveils nocturnes");
  if ("error" in sleepWakeUps) errors.sleep_wake_ups = sleepWakeUps.error;

  const energy = validateRequiredNumber(state.energy, RANGE_0_10, "Énergie");
  if ("error" in energy) errors.energy = energy.error;

  const workStress = validateRequiredNumber(state.work_stress, RANGE_0_10, "Stress professionnel");
  if ("error" in workStress) errors.work_stress = workStress.error;

  const motivation = validateRequiredNumber(state.motivation, RANGE_0_10, "Motivation");
  if ("error" in motivation) errors.motivation = motivation.error;

  const legFatigue = validateRequiredNumber(state.leg_fatigue, RANGE_0_10, "Fatigue jambes");
  if ("error" in legFatigue) errors.leg_fatigue = legFatigue.error;

  const gripFatigue = validateRequiredNumber(state.grip_fatigue, RANGE_0_10, "Fatigue avant-bras/grip");
  if ("error" in gripFatigue) errors.grip_fatigue = gripFatigue.error;

  // Health/safety tri-state fields: an unanswered (null) question must
  // always be rejected, never silently saved as "non" — this is the whole
  // point of the tri-state form state (see checkinTypes.ts).
  if (state.pain === null) {
    errors.pain = "Réponds Oui ou Non.";
  }
  if (state.suspected_concussion === null) {
    errors.suspected_concussion = "Réponds Oui ou Non.";
  }
  if (state.fever_or_illness === null) {
    errors.fever_or_illness = "Réponds Oui ou Non.";
  }

  // pain_intensity: required + 0-10 iff pain=true; must be absent iff pain=false
  // (mirrors the DB CHECK pain_intensity_requires_pain exactly).
  let painIntensity: number | null = null;
  if (state.pain === true) {
    const intensity = validateRequiredNumber(state.pain_intensity, RANGE_0_10, "Intensité de la douleur");
    if ("error" in intensity) {
      errors.pain_intensity = intensity.error;
    } else {
      painIntensity = intensity.value;
    }

    // pain_new / pain_traumatic / pain_function_loss / pain_getting_worse
    // are required booleans on every row saved by the M2 adapter, but only
    // meaningful (and only asked in the UI) when pain=true — an unanswered
    // one here must block the save, exactly like suspected_concussion.
    if (state.pain_new === null) errors.pain_new = "Réponds Oui ou Non.";
    if (state.pain_traumatic === null) errors.pain_traumatic = "Réponds Oui ou Non.";
    if (state.pain_function_loss === null) errors.pain_function_loss = "Réponds Oui ou Non.";
    if (state.pain_getting_worse === null) errors.pain_getting_worse = "Réponds Oui ou Non.";
  } else if (state.pain === false && state.pain_intensity !== "") {
    errors.pain_intensity = "L'intensité de la douleur ne doit être renseignée que si tu as répondu Oui à douleur.";
  }

  if (state.pain_location_code !== "" && !PAIN_LOCATION_CODES.includes(state.pain_location_code)) {
    errors.pain_location_code = "Localisation de douleur invalide.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  // Every branch above that could leave state.pain === null already added
  // `errors.pain` and returned early — state.pain is a real boolean here.
  const pain = state.pain as boolean;

  // When pain=false, the four pain criteria are not a safety decision —
  // they're simply not applicable ("no pain" trivially implies "false" for
  // all four), so the payload normalizes them rather than asking the user
  // to answer questions about a pain that doesn't exist.
  const values: CheckinInput = {
    sleep_hours: (sleepHours as { value: number }).value,
    sleep_quality: (sleepQuality as { value: number }).value,
    sleep_wake_ups: (sleepWakeUps as { value: number }).value,
    energy: (energy as { value: number }).value,
    work_stress: (workStress as { value: number }).value,
    motivation: (motivation as { value: number }).value,
    leg_fatigue: (legFatigue as { value: number }).value,
    grip_fatigue: (gripFatigue as { value: number }).value,
    pain,
    pain_intensity: painIntensity,
    pain_new: pain ? (state.pain_new as boolean) : false,
    pain_location_code: pain && state.pain_location_code !== "" ? state.pain_location_code : null,
    pain_traumatic: pain ? (state.pain_traumatic as boolean) : false,
    pain_function_loss: pain ? (state.pain_function_loss as boolean) : false,
    pain_getting_worse: pain ? (state.pain_getting_worse as boolean) : false,
    suspected_concussion: state.suspected_concussion as boolean,
    fever_or_illness: state.fever_or_illness as boolean,
    free_comment: state.free_comment.trim() === "" ? null : state.free_comment.trim(),
  };

  return { ok: true, values };
}
