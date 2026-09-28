// REV-014 — athlete-facing zone labels for the Today health signal.
// head-coach-engine's Safety rules A2/A4 (rules/safety.ts, frozen M1) build
// `health_flag_to_create.reason` as "<French sentence> — <pain_location_code>"
// (the code appended only when a zone was declared), and DailyPlanView's
// "Attention santé" banner used to show it verbatim ("… — knee_R").
// Presentation only: the stored reason is never changed, so already-
// persisted decisions (History) are cleaned at display time too. Labels come
// from the one canonical PAIN_LOCATION_LABELS (checkinTypes.ts) — never a
// second copy.
import { PAIN_LOCATION_LABELS, type PainLocationCode } from "../checkin/checkinTypes";

/** Canonical French label for a pain_location_code ("knee_R" -> "Genou droit"), or `null` for anything that is not one of its own keys (inherited names like "toString" never match). */
export function translateHealthZone(code: unknown): string | null {
  if (typeof code !== "string" || !Object.prototype.hasOwnProperty.call(PAIN_LOCATION_LABELS, code)) return null;
  return PAIN_LOCATION_LABELS[code as PainLocationCode];
}

// The trailing " — <code>" segment safety.ts appends. A code is a lowercase
// identifier with optional "_"-joined parts ("lower_back", "knee_R"), so a
// French word or label ending the sentence is never mistaken for one.
const TRAILING_ZONE_CODE = / — ([a-z]+(?:_[A-Za-z]+)*)$/;

/**
 * The athlete-safe health signal reason: a known trailing zone code becomes
 * its canonical label ("Douleur nouvelle sévère (8/10) — Genou droit"); an
 * unknown one is removed together with its dash ("Douleur nouvelle sévère
 * (8/10)"). Every other character of the sentence is left untouched.
 * `undefined` for a missing, non-string or blank reason, so the caller keeps
 * its own generic fallback.
 */
export function sanitizeHealthSignalReason(reason: unknown): string | undefined {
  if (typeof reason !== "string" || reason.trim() === "") return undefined;
  const match = TRAILING_ZONE_CODE.exec(reason);
  if (match === null) return reason;
  const sentence = reason.slice(0, match.index);
  const label = translateHealthZone(match[1]);
  return label !== null ? `${sentence} — ${label}` : sentence;
}
