// UX-11C.2 — athlete-facing copy of the guided Force module (UI labels only).
import type { SetResultRow } from "../executionState";

export const STRENGTH_COPY = {
  current: "À faire maintenant",
  noResult: "Pas encore de résultat",
  corrected: "corrigée",
  correctedOnce: "Série déjà corrigée : une série ne se corrige qu'une fois.",
  perSide: "(par côté)",
  unsupportedItem: "La saisie n'est pas disponible pour cet exercice dans cette version de l'application.",
  needOneWorkSet: "Enregistre au moins une série de travail pour pouvoir terminer la séance.",
  finishEntryFirst: "Enregistre ou annule la série en cours de saisie avant de terminer.",
} as const;

/** A recorded result, in the rider's words — only what was actually entered. */
export function formatResult(r: SetResultRow, perSide: boolean): string {
  const side = perSide ? " par côté" : "";
  const value =
    r.measure_type === "reps" ? `${r.measure_value} ${r.measure_value === 1 ? "répétition" : "répétitions"}${side}` : r.measure_type === "duration" ? `${r.measure_value} s${side}` : `${r.measure_value ?? ""}`;
  const parts = [r.done ? value : "non réalisée"];
  if (r.rpe_actual !== null) parts.push(`RPE ${r.rpe_actual}`);
  if (r.load_kg !== null) parts.push(`${r.load_kg} kg`);
  return parts.join(" · ");
}
