// UX-11C.3 — athlete-facing copy of the guided DH module (UI labels only;
// the drill's name, cue, criterion and vigilances come from the prescription).
// The word "série" never appears here: a DH result is a pass ("passage").
import type { SuccessChoice } from "./dhPasses";

export const DH_COPY = {
  current: "À faire maintenant",
  noResult: "Pas encore de résultat",
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

export const passesLabel = (n: number) => `${n} ${n > 1 ? "passages" : "passage"}`;
