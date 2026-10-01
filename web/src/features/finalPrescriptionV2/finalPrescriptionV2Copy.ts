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

