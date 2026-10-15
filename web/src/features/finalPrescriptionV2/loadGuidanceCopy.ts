// PHYS-01 — athlete-facing copy of the Force load guidance (UI labels only).
// The guidance itself is computed by the engine from the rider's own recorded
// sets (never a 1RM, never a profile value); this file only says it in plain
// words: the load to use today, and why, from what the rider did last time.
import { span } from "./finalPrescriptionV2Copy";
import type { ExerciseMeasureView, LoadGuidanceView, LoadReferenceView, RangeView } from "./finalPrescriptionV2Types";

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** "13 oct." — from an ISO date, without any time zone shift. */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
}

/** "22 kg", "57,5 kg". */
export function formatKg(kg: number): string {
  return `${Number.isInteger(kg) ? kg : kg.toFixed(1).replace(".", ",")} kg`;
}

const rirText = (r: RangeView | null) =>
  r === null ? "un peu de marge" : `${r.min === r.max ? r.min : `${r.min} à ${r.max}`} ${Math.max(r.min, r.max) > 1 ? "répétitions" : "répétition"} en réserve`;

/** "3 séries de 10" when every set had the same count, else "séries de 10, 9, 8". */
function setsSummary(ref: LoadReferenceView): string {
  const first = ref.reps[0]!;
  return ref.reps.every((n) => n === first) ? `${ref.reps.length} ${ref.reps.length > 1 ? "séries" : "série"} de ${first}` : `séries de ${ref.reps.join(", ")}`;
}

const rangeOf = (m: ExerciseMeasureView): RangeView | null => (m.type === "reps" ? { min: m.min, max: m.max } : null);

export interface LoadGuidanceLines {
  headline: string;
  detail: string;
  /** The load to show next to the load field (target only). */
  suggestedKg: number | null;
}

/** The two lines shown under a work exercise: the load to use today, and why. */
export function loadGuidanceLines(g: LoadGuidanceView, measure: ExerciseMeasureView): LoadGuidanceLines {
  switch (g.mode) {
    case "calibrate":
      return {
        headline: "Charge : à trouver aujourd'hui",
        detail: `${g.reason === "history_without_load" ? "Aucune charge notée jusqu'ici. " : ""}Choisis une charge qui te laisse ${rirText(g.repsInReserve)} à la fin de chaque série. Note la charge utilisée : NALYNT s'en servira à la prochaine séance.`,
        suggestedKg: null,
      };
    case "reference": {
      const ref = g.reference;
      if (g.reason === "history_too_old") {
        return {
          headline: "Charge : reprends progressivement",
          detail: `Ta dernière charge notée (${formatKg(ref.loadKg)}, le ${shortDate(ref.sessionDate)}) date de plus de 4 semaines : commence plus léger et ajuste pour garder ${rirText(g.repsInReserve)}.`,
          suggestedKg: null,
        };
      }
      const before = ref.repsRange ? ` pour ${span(ref.repsRange)} répétitions` : "";
      const today = rangeOf(measure);
      return {
        headline: `Charge : repère ${formatKg(ref.loadKg)} (dernière séance)`,
        detail: `Le ${shortDate(ref.sessionDate)} : ${setsSummary(ref)} à ${formatKg(ref.loadKg)}${before}. Aujourd'hui, la séance change${today ? ` (${span(today)} répétitions)` : ""} : ajuste la charge pour garder ${rirText(g.repsInReserve)}.`,
        suggestedKg: null,
      };
    }
    case "target": {
      const ref = g.reference;
      const range = ref.repsRange;
      const headline =
        g.change === "increase"
          ? `Charge conseillée : ${formatKg(g.targetKg)} (+${formatKg(g.stepKg)})`
          : g.change === "decrease"
            ? `Charge conseillée : ${formatKg(g.targetKg)} (−${formatKg(g.stepKg)})`
            : `Charge conseillée : ${formatKg(g.targetKg)} (comme la dernière fois)`;
      const when = `Le ${shortDate(ref.sessionDate)}`;
      const at = formatKg(ref.loadKg);
      let detail: string;
      switch (g.reason) {
        case "top_of_range_reached":
          detail = `${when} : toutes tes séries à ${at} au haut de la fourchette${range ? ` (${range.max} répétitions)` : ""}${ref.rpeMax !== null ? `, RPE ${ref.rpeMax} au plus` : ""}. On monte d'un cran.`;
          break;
        case "within_range":
          detail = `${when} : ${setsSummary(ref)} à ${at}. Monte quand toutes tes séries atteignent ${range ? `${range.max} répétitions` : "le haut de la fourchette"} sans dépasser l'effort prévu.`;
          break;
        case "below_range":
          detail =
            g.change === "decrease"
              ? `${when}, une série est restée sous ${range ? `${range.min} répétitions` : "la fourchette"} à ${at} : on redescend d'un cran pour faire toute la fourchette.`
              : `${when}, une série est restée sous ${range ? `${range.min} répétitions` : "la fourchette"} : garde cette charge et vise toute la fourchette.`;
          break;
        case "effort_too_high":
          detail =
            g.change === "decrease"
              ? `${when}, l'effort est monté à RPE ${ref.rpeMax} à ${at}, au-dessus de l'effort prévu : on redescend d'un cran.`
              : `${when}, l'effort est monté à RPE ${ref.rpeMax} : garde cette charge et reste dans l'effort prévu.`;
          break;
      }
      return { headline, detail: `${detail} Si cette charge n'est pas disponible, prends la plus proche et note-la.`, suggestedKg: g.targetKg };
    }
  }
}
