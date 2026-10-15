// PHYS-01 / PHYS-01.1 — athlete-facing copy of the Force load guidance (UI
// labels only). The guidance itself is computed by the engine from the
// rider's own recorded sets of this exercise (never a 1RM, never a profile
// value); this file only says it in plain words: the load to use today, how
// it is counted (per dumbbell / total), and why, from what the rider did.
import { span } from "./finalPrescriptionV2Copy";
import type { ExerciseMeasureView, LoadBasisView, LoadGuidanceView, LoadReferenceView, RangeView } from "./finalPrescriptionV2Types";

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

/** "22 kg par haltère" / "57,5 kg". */
export function formatLoad(kg: number, basis: LoadBasisView): string {
  return basis === "per_dumbbell" ? `${formatKg(kg)} par haltère` : formatKg(kg);
}

const rirText = (r: RangeView | null) =>
  r === null ? "un peu de marge" : `${r.min === r.max ? r.min : `${r.min} à ${r.max}`} ${Math.max(r.min, r.max) > 1 ? "répétitions" : "répétition"} en réserve`;

/** "3 séries de 10" when every set had the same count, else "séries de 10, 9, 8". */
function setsSummary(ref: LoadReferenceView): string {
  const first = ref.reps[0]!;
  return ref.reps.every((n) => n === first) ? `${ref.reps.length} ${ref.reps.length > 1 ? "séries" : "série"} de ${first}` : `séries de ${ref.reps.join(", ")}`;
}

const rangeOf = (m: ExerciseMeasureView): RangeView | null => (m.type === "reps" ? { min: m.min, max: m.max } : null);

const HOLD_TEXT: Readonly<Record<"dose_up" | "pain" | "fatigue", string>> = {
  dose_up: "mais la séance d'aujourd'hui est déjà plus exigeante (plus de séries ou un effort cible plus haut) : une seule progression à la fois, garde cette charge.",
  pain: "mais tu as signalé une douleur aujourd'hui : pas d'augmentation, garde cette charge.",
  fatigue: "mais ton état du jour montre de la fatigue : pas d'augmentation, garde cette charge.",
};

export interface LoadGuidanceLines {
  headline: string;
  detail: string;
  /** The load to show next to the load field (target only). */
  suggestedKg: number | null;
}

/** The two lines shown under a work exercise: the load to use today, and why. */
export function loadGuidanceLines(g: LoadGuidanceView, measure: ExerciseMeasureView): LoadGuidanceLines {
  const basis = g.loadBasis;
  const note = basis === "per_dumbbell" ? " Indique la charge d'un seul haltère." : "";
  switch (g.mode) {
    case "calibrate":
      return {
        headline: "Charge : à trouver aujourd'hui",
        detail: `${g.reason === "history_without_load" ? "Aucune charge notée jusqu'ici. " : ""}Choisis une charge qui te laisse ${rirText(g.repsInReserve)} à la fin de chaque série. Note la charge utilisée : NALYNT s'en servira à la prochaine séance.${note}`,
        suggestedKg: null,
      };
    case "reference": {
      const ref = g.reference;
      if (g.reason === "history_too_old") {
        return {
          headline: "Charge : reprends progressivement",
          detail: `Ta dernière charge notée (${formatLoad(ref.loadKg, basis)}, le ${shortDate(ref.sessionDate)}) date de plus de 4 semaines : commence plus léger et ajuste pour garder ${rirText(g.repsInReserve)}.`,
          suggestedKg: null,
        };
      }
      const before = ref.repsRange ? ` pour ${span(ref.repsRange)} répétitions` : "";
      const today = rangeOf(measure);
      return {
        headline: `Charge : repère ${formatLoad(ref.loadKg, basis)} (dernière séance)`,
        detail: `Le ${shortDate(ref.sessionDate)} : ${setsSummary(ref)} à ${formatLoad(ref.loadKg, basis)}${before}. Aujourd'hui, la séance change${today ? ` (${span(today)} répétitions)` : ""} : ajuste la charge pour garder ${rirText(g.repsInReserve)}.`,
        suggestedKg: null,
      };
    }
    case "target": {
      const ref = g.reference;
      const range = ref.repsRange;
      const headline =
        g.change === "increase"
          ? `Charge conseillée : ${formatLoad(g.targetKg, basis)} (+${formatKg(g.stepKg)})`
          : g.change === "decrease"
            ? `Charge conseillée : ${formatLoad(g.targetKg, basis)} (−${formatKg(g.stepKg)})`
            : `Charge conseillée : ${formatLoad(g.targetKg, basis)} (comme la dernière fois)`;
      const when = `Le ${shortDate(ref.sessionDate)}`;
      const at = formatLoad(ref.loadKg, basis);
      let detail: string;
      switch (g.reason) {
        case "top_of_range_reached": {
          const done = `${when} : toutes tes séries à ${at} au haut de la fourchette${range ? ` (${range.max} répétitions)` : ""}${ref.rpeMax !== null ? `, RPE ${ref.rpeMax} au plus` : ""}`;
          detail = g.hold ? `${done}, ${HOLD_TEXT[g.hold]}` : `${done}. On monte d'un cran.`;
          break;
        }
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

/** The hint next to the load field: the advised load (never pre-filled) and how to count it. */
export function loadFieldHint(g: LoadGuidanceView | undefined, measure: ExerciseMeasureView): string | undefined {
  if (!g) return undefined;
  const kg = loadGuidanceLines(g, measure).suggestedKg;
  const basis = g.loadBasis === "per_dumbbell" ? "Charge d'un seul haltère." : undefined;
  if (kg === null) return basis;
  return `Conseillé : ${formatLoad(kg, g.loadBasis)}${basis ? `. ${basis}` : ""}`;
}
