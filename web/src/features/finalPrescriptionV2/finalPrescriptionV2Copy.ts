// UX-11A.5c.4 — athlete-facing copy and number formatting of the read-only V2
// final prescription (UI labels only; coaching texts come from the versioned
// catalogue mirror).
import { PRESCRIPTION_UNAVAILABLE_MESSAGE } from "../prescriptions/prescriptionRead";
import type { ExerciseMeasureView, RangeView } from "./finalPrescriptionV2Types";

/** Neutral athlete-facing copy per blocked code; the code itself stays in data-code for debugging, never as the message. */
export const BLOCKED_MESSAGES: Readonly<Record<string, string>> = {
  final_prescription_no_lineage: "Le détail de la séance n'est pas disponible pour cette recommandation.",
  final_prescription_adaptation_not_defined: "L'adaptation détaillée n'est pas disponible pour cette recommandation.",
  final_prescription_catalog_mismatch: PRESCRIPTION_UNAVAILABLE_MESSAGE,
};
export const BLOCKED_FALLBACK_MESSAGE = BLOCKED_MESSAGES.final_prescription_no_lineage!;

/**
 * P0-3 — a precise, honest refusal for the rider's MANUAL session (detail.reason of the blocked decision):
 * never an empty session, never the raw reason.
 */
export const MANUAL_BLOCKED_MESSAGES: Readonly<Record<string, string>> = {
  manual_kind_not_supported: "NALYNT ne construit pas encore le contenu de ce type de séance ajoutée à la main. Choisis un autre type dans ton programme, ou réalise-la selon ton expérience.",
  manual_load_not_supported: "NALYNT ne propose pas encore de renfo en charge lourde. Choisis une charge modérée ou légère dans ton programme pour obtenir le détail de la séance.",
  manual_session_outside_current_plan: "Cette séance ajoutée à la main est en dehors de ton programme actuel : NALYNT n'en construit pas le contenu.",
  riding_not_available: "Ton profil n'a pas de créneau vélo ce jour-là : NALYNT ne construit pas de séance de vélo pour ce jour.",
};
/**
 * SPORT-SAFE-01R.2 (proposed copy, to be validated by HPM) — M1 asked for an adaptation and NALYNT has no guided version
 * lighter than the planned one (ADR A04 §6, `modify_not_supported`): facts only, no dose and no advice of its own.
 */
export const MODIFY_NOT_SUPPORTED_MESSAGE =
  "Ton état du jour demande d'adapter cette séance, mais NALYNT n'en a pas de version guidée plus légère que celle prévue : pas de séance guidée aujourd'hui.";

/**
 * PHYS-02 — why an intervals session has no daily document (detail.reason of the blocked decision): the
 * intervals session exists in one version only (6 × 3 min at RPE 8), never shorter; on a LIGHT day it is
 * replaced by light base endurance (PHYS-02.1), so these are the remaining, rare cases.
 */
export const REASON_BLOCKED_MESSAGES: Readonly<Record<string, string>> = {
  modify_not_supported: MODIFY_NOT_SUPPORTED_MESSAGE,
  intervals_load_not_supported: "Le fractionné n'existe qu'en une seule version (6 × 3 min à RPE 8) : NALYNT ne construit pas cette adaptation.",
  intervals_not_shortened: "Le fractionné n'est jamais raccourci : il ne tient pas dans le temps que tu as aujourd'hui.",
  // PHYS-02.1 — the light base endurance fallback is withheld for today's pain.
  // PHYS-03 — the power session has one dose and needs fresh legs and forearms.
  power_load_not_supported:
    "Ton état du jour demande moins d'intensité, et la séance de puissance n'existe qu'en une seule version (qualité maximale) : NALYNT ne propose pas de puissance allégée aujourd'hui.",
  power_fatigue_not_cleared:
    "Fatigue des jambes ou des avant-bras signalée aujourd'hui : la puissance demande une fraîcheur complète, NALYNT ne la propose pas aujourd'hui.",
  no_compatible_power_exercise: "NALYNT ne propose pas encore de séance de puissance à ton niveau déclaré.",
  // PHYS-04 — the mobility routine never goes below its protocol minimum (22 min).
  mobility_duration_not_supported: "La séance de mobilité dure au moins 22 minutes : elle ne tient pas dans le temps que tu as aujourd'hui.",
  intervals_fallback_pain_not_cleared:
    "Tu as signalé une douleur que l'endurance solliciterait. NALYNT ne sait pas encore quelle activité la ménage : aucune séance n'est proposée aujourd'hui à la place du fractionné.",
};
/** PHYS-02.1 — a manual intervals session at another load than moderate (detail.target = AEROBIC_INTERVALS). */
export const MANUAL_INTERVALS_LOAD_MESSAGE =
  "Le fractionné n'existe qu'en une seule version, à charge modérée. Choisis une charge modérée dans ton programme pour obtenir le détail de la séance.";
export const REST_MESSAGE = "Repos aujourd'hui : aucune séance à réaliser.";
export const MISSING_MESSAGE = "Le détail de ta séance est momentanément indisponible.";
export const INVALID_MESSAGE = "Le détail de cette séance n'est pas disponible.";

export const span = (r: RangeView, unit = ""): string => (r.min === r.max ? `${r.min}${unit}` : `${r.min}–${r.max}${unit}`);

export function formatSeconds(r: RangeView): string {
  return r.min % 60 === 0 && r.max % 60 === 0 && r.min > 0 ? span({ min: r.min / 60, max: r.max / 60 }, " min") : span(r, " s");
}

export function formatMeasure(m: ExerciseMeasureView): string {
  switch (m.type) {
    case "reps":
      return `${span({ min: m.min, max: m.max })} répétitions${m.perSide ? " par côté" : ""}`;
    case "duration":
      return `${formatSeconds({ min: m.minSeconds, max: m.maxSeconds })}${m.perSide ? " par côté" : ""}`;
    case "distance":
      return span({ min: m.minMeters, max: m.maxMeters }, " m");
  }
}

export const setsLabel = (n: number) => `${n} ${n > 1 ? "séries" : "série"}`;

