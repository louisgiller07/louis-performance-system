// PHYS-02 — athlete-facing reading of an endurance prescription (UI wording
// only): what an RPE means in plain words, the repetitions of an intervals
// session as one part, and the rider's last session of the same protocol.
// Everything comes from the prescription; nothing is computed here but its
// wording. No heart rate, FTP or zone is ever shown.
import { span } from "./finalPrescriptionV2Copy";
import { shortDate } from "./loadGuidanceCopy";
import type { BlockView, EnduranceGuidanceView, FinalPrescriptionV2View, RangeView } from "./finalPrescriptionV2Types";

/** PROVISIONAL wording of the effort scale (RPE 1–10, with the talk test of 03), coaching validation required. */
export function enduranceRpeHint(r: RangeView): string {
  if (r.max <= 2) return "Très facile : aucun effort ressenti.";
  if (r.max <= 4) return "Facile : respiration aisée, tu peux parler en phrases complètes.";
  if (r.max <= 6) return "Soutenu : tu ne peux plus dire que des phrases courtes.";
  if (r.max <= 8) return "Difficile : tu ne peux dire que quelques mots.";
  return "Très difficile : proche de ton maximum.";
}

export interface IntervalsSummary {
  repetitions: number;
  workMinutes: number;
  workRpe: RangeView;
  easyMinutes: number;
  workInstruction: string;
  easyInstruction: string;
  /** The repetitions and the easy minutes between them. */
  totalMinutes: number;
}

const fixedMinutes = (b: BlockView): number | null => (b.durationMinutes && b.durationMinutes.min === b.durationMinutes.max ? b.durationMinutes.min : null);
const sameRange = (a: RangeView | undefined, b: RangeView | undefined) => a !== undefined && b !== undefined && a.min === b.min && a.max === b.max;

/**
 * The intervals of an intervals session: its main blocks, contiguous and
 * alternating work (duration + RPE) and easy (duration, no RPE), each with
 * one instruction and no item. Anything else → null (the blocks are then
 * shown one by one, as any prescription).
 */
export function intervalsSummary(p: FinalPrescriptionV2View): IntervalsSummary | null {
  if (p.family !== "endurance" || p.sessionKind !== "AEROBIC_INTERVALS") return null;
  const first = p.blocks.findIndex((b) => b.role === "main");
  const mains = p.blocks.filter((b) => b.role === "main");
  if (first < 0 || mains.length < 3 || mains.length % 2 === 0 || p.blocks.slice(first, first + mains.length).some((b) => b.role !== "main")) return null;
  const work = mains.filter((_, i) => i % 2 === 0);
  const easy = mains.filter((_, i) => i % 2 === 1);
  const w = work[0]!;
  const e = easy[0]!;
  const workMinutes = fixedMinutes(w);
  const easyMinutes = fixedMinutes(e);
  if (workMinutes === null || easyMinutes === null || !w.rpeTarget || w.instructions.length !== 1 || e.instructions.length !== 1) return null;
  const sameWork = work.every((b) => fixedMinutes(b) === workMinutes && sameRange(b.rpeTarget, w.rpeTarget) && b.items.length === 0 && b.instructions.length === 1 && b.instructions[0] === w.instructions[0]);
  const sameEasy = easy.every((b) => fixedMinutes(b) === easyMinutes && b.rpeTarget === undefined && b.items.length === 0 && b.instructions.length === 1 && b.instructions[0] === e.instructions[0]);
  if (!sameWork || !sameEasy) return null;
  return {
    repetitions: work.length,
    workMinutes,
    workRpe: w.rpeTarget,
    easyMinutes,
    workInstruction: w.instructions[0]!,
    easyInstruction: e.instructions[0]!,
    totalMinutes: work.length * workMinutes + easy.length * easyMinutes,
  };
}

/** "6 × 3 min à RPE 8, 2 min faciles entre les répétitions". */
export function intervalsSummaryLine(s: IntervalsSummary): string {
  return `${s.repetitions} × ${s.workMinutes} min à RPE ${span(s.workRpe)}, ${s.easyMinutes} min faciles entre les répétitions`;
}

const decimal = (n: number) => String(n).replace(".", ",");

export interface EnduranceGuidanceLines {
  headline: string;
  detail: string | null;
}

/** The rider's last session of the same protocol, as recorded, and the one reminder (base endurance). */
export function enduranceGuidanceLines(g: EnduranceGuidanceView, intervals: boolean): EnduranceGuidanceLines {
  const r = g.reference;
  const parts = [r.activityLabel, `${Math.round(r.durationSeconds / 60)} min`];
  if (r.distanceM !== null) parts.push(`${decimal(r.distanceM / 1000)} km`);
  if (r.rpeActual !== null) parts.push(intervals ? `RPE ressenti sur toute la séance : ${decimal(r.rpeActual)}` : `RPE ressenti : ${decimal(r.rpeActual)}`);
  const effort = g.effortAboveTarget;
  return {
    headline: `Ta dernière séance de ce type (${shortDate(r.sessionDate)}) : ${parts.join(", ")}.`,
    detail: effort
      ? `Tu avais noté RPE ${decimal(effort.rpeActual)} pour une cible de ${effort.rpeTargetMax} au plus : garde aujourd'hui un rythme où tu peux parler en phrases complètes.`
      : null,
  };
}
