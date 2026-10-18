// PHYS-04 — athlete-facing copy of the bodyweight repetitions guidance (UI
// wording only). The guidance is computed by the engine from the rider's own
// recorded repetitions of this exercise; this file only says it in plain
// words. Never a load, never another exercise.
import { span } from "./finalPrescriptionV2Copy";
import { shortDate } from "./loadGuidanceCopy";
import type { RepsGuidanceView } from "./finalPrescriptionV2Types";

export interface RepsGuidanceLines {
  headline: string;
  detail: string;
}

const repsList = (reps: number[]) => reps.join(", ");

export function repsGuidanceLines(g: RepsGuidanceView, range: { min: number; max: number }, perSide: boolean): RepsGuidanceLines {
  const side = perSide ? " par côté" : "";
  if (g.mode === "calibrate") {
    return {
      headline: `Première fois : ${span(range)} répétitions${side}`,
      detail: g.repsInReserve
        ? `Garde ${span(g.repsInReserve)} répétitions en réserve et note tes répétitions et ton RPE : la prochaine séance en tiendra compte.`
        : "Note tes répétitions et ton RPE : la prochaine séance en tiendra compte.",
    };
  }
  const ref = g.reference;
  const last = `${shortDate(ref.sessionDate)} : ${repsList(ref.reps)}${ref.rpeMax !== null ? ` (RPE ${String(ref.rpeMax).replace(".", ",")})` : ""}`;
  if (g.mode === "reference") {
    return { headline: `Dernière fois (${last})`, detail: g.reason === "history_too_old" ? "C'était il y a plus de 4 semaines : reprends dans la fourchette prévue." : "La fourchette a changé : reprends dans la fourchette prévue." };
  }
  const headline = `Vise ${g.targetReps} répétitions${side} par série`;
  const why =
    g.reason === "effort_too_high"
      ? "l'effort était trop élevé la dernière fois"
      : g.reason === "below_range"
        ? "une série était sous la fourchette la dernière fois"
        : g.reason === "top_of_range_reached"
          ? "tu étais au haut de la fourchette"
          : g.change === "increase"
            ? "une répétition de plus que ta série la plus courte"
            : "comme la dernière fois";
  const hold = g.hold === "pain" ? " Douleur signalée aujourd'hui : pas de hausse." : g.hold === "fatigue" ? " Fatigue détectée aujourd'hui : pas de hausse." : g.hold === "dose_up" ? " La séance compte déjà plus de séries : une progression à la fois." : "";
  const next = g.nextStep === "no_bodyweight_variant" ? " Pas encore de variante plus difficile sans matériel au catalogue : garde la qualité." : g.nextStep === "variant_not_validated" ? " La variante plus difficile n'est pas encore validée : garde cet exercice." : "";
  return { headline, detail: `Dernière fois ${last} — ${why}.${hold}${next}` };
}

/** The repetitions field hint: the advised repetitions, never a prefilled value. */
export function repsFieldHint(g: RepsGuidanceView | undefined): string | undefined {
  return g && g.mode === "target" ? `Conseillé : ${g.targetReps}` : undefined;
}
