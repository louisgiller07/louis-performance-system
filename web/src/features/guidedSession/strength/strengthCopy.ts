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

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** A02 — the progress line, with the work sets marked « non réalisée » counted apart (never mixed with the performed ones). */
export function strengthProgressLine(p: { recorded: number; notDone: number; slots: readonly unknown[] }): string {
  const base = `Séries de travail réalisées : ${p.recorded} / ${p.slots.length}`;
  return p.notDone > 0 ? `${base} · ${plural(p.notDone, "non réalisée", "non réalisées")}` : base;
}

/** A02 — the partial-completion question says exactly what is missing. */
export function strengthPartialCompletionMessage(p: { recorded: number; notDone: number; missing: number; slots: readonly unknown[] }): string {
  const gaps = [
    p.missing > 0 ? `${plural(p.missing, "série de travail", "séries de travail")} sans résultat` : null,
    p.notDone > 0 ? `${plural(p.notDone, "série non réalisée", "séries non réalisées")}` : null,
  ].filter((g): g is string => g !== null);
  return `${p.recorded} ${p.recorded > 1 ? "séries de travail réalisées" : "série de travail réalisée"} sur ${p.slots.length} (${gaps.join(", ")}). Terminer quand même la séance avec ces résultats ?`;
}

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
