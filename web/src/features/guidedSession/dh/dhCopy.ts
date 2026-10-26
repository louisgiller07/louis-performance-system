// UX-11C.3 — athlete-facing copy of the guided DH module (UI labels only;
// the drill's name, cue, criterion and vigilances come from the prescription).
// The word "série" never appears here: a DH result is a pass ("passage").
import type { SuccessChoice } from "./dhPasses";

export const DH_COPY = {
  current: "À faire maintenant",
  noResult: "Pas encore de résultat",
  /** P0-4 — an empty pass of a session that can no longer take results (completed, stopped, consulted in History). */
  noResultRecorded: "Aucun résultat enregistré",
  recorded: "Enregistré",
  corrected: "corrigé",
  correctedOnce: "Passage déjà corrigé : un passage ne se corrige qu'une fois.",
  successQuestion: "Critère atteint ?",
  needOnePass: "Enregistre au moins un passage pour pouvoir terminer la séance.",
  invalid: "Le détail de cette séance n'est pas disponible.",
  partialCompletion:
    "Certains passages prévus n'ont pas de résultat enregistré. Terminer quand même la séance avec les passages actuellement enregistrés ?",
} as const;

export const SUCCESS_LABELS: Readonly<Record<SuccessChoice, string>> = {
  yes: "Oui",
  no: "Non",
  unrated: "Non évalué",
};

// V2-DH-UNIT-01 — the count in its stated unit (a historical count keeps « passages »).
export { dhCountLabel as passesLabel, dhRecordedCountLabel } from "../../finalPrescriptionV2/dhRepetitionUnitLabels";
