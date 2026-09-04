// V0.3_004B — minimum sane validation for the one field athlete bootstrap
// collects. Deliberately not elaborate: trim, reject blank, cap length.
const MAX_NAME_LENGTH = 100;

export type ValidateAthleteNameResult = { ok: true; name: string } | { ok: false; error: string };

export function validateAthleteName(raw: string): ValidateAthleteNameResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Entre ton nom pour continuer." };
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Le nom doit faire au maximum ${MAX_NAME_LENGTH} caractères.` };
  }
  return { ok: true, name: trimmed };
}
