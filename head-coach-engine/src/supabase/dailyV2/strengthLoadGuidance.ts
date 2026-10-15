/**
 * PHYS-01 — Force load guidance on today's final prescription (integration
 * layer). After the V2 reconciliation produced a Force final prescription,
 * the rider's completed sets of its loadable work exercises are read
 * (strengthSetHistoryRepo) and the pure rule of planning-engine
 * (attachStrengthLoadGuidanceV2) attaches `loadGuidance` to those items. The
 * result is validated as a final prescription before it is persisted.
 *
 * Advisory and best-effort: a read failure or an invalid result never blocks
 * the daily decision — the prescription is kept without guidance and a
 * stable warning says why. M1's decision, the content, the doses and the
 * durations are never changed here. Nothing is written here.
 *
 * PHYS-04: the same read also gives the bodyweight repetitions guidance
 * (`repsGuidance`, attachBodyweightRepsGuidanceV2) to the work exercises that
 * need no equipment — one history read, one validation, same warnings.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  attachBodyweightRepsGuidanceV2,
  attachStrengthLoadGuidanceV2,
  bodyweightRepsGuidanceExerciseIdsV2,
  strengthLoadGuidanceExerciseIdsV2,
  validatePrescriptionV2,
  type FinalPrescriptionWithinTodayTimeV2Result,
  type PrescriptionV2,
  type StrengthExerciseSessionRecordV2,
} from "planning-engine/session-model-v2/daily";
import { getCompletedStrengthSetHistory, type StrengthSetHistoryRead } from "../repositories/strengthSetHistoryRepo.js";

/** History read before the decision date (days) — STRENGTH_LOAD_GUIDANCE_POLICY_V2.historyWindowDays. */
export const STRENGTH_HISTORY_WINDOW_DAYS = 56;

export const LOAD_GUIDANCE_WARNINGS = {
  readFailed: "phys01_load_guidance_history_unavailable",
  invalid: "phys01_load_guidance_invalid",
} as const;

export type WithLoadGuidanceResult = FinalPrescriptionWithinTodayTimeV2Result & { loadGuidanceWarning?: string };

export interface StrengthLoadGuidanceDeps {
  getCompletedStrengthSetHistory: typeof getCompletedStrengthSetHistory;
}

const DEFAULT_DEPS: StrengthLoadGuidanceDeps = { getCompletedStrengthSetHistory };

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** What the day's prescription asked for this item (work blocks, repetitions only); null when unknown. */
function prescribedItem(structure: unknown, prescriptionItemId: string | null): StrengthExerciseSessionRecordV2["prescribed"] {
  if (!isObj(structure) || !Array.isArray(structure.blocks) || prescriptionItemId === null) return null;
  for (const block of structure.blocks) {
    if (!isObj(block) || (block.role !== "main" && block.role !== "complementary") || !Array.isArray(block.items)) continue;
    for (const item of block.items) {
      if (!isObj(item) || item.prescriptionItemId !== prescriptionItemId) continue;
      const m = item.measure;
      if (!isObj(m) || m.type !== "reps" || typeof m.min !== "number" || typeof m.max !== "number" || typeof item.sets !== "number") return null;
      const rpe = isObj(item.rpeTarget) && typeof item.rpeTarget.min === "number" && typeof item.rpeTarget.max === "number" ? { min: item.rpeTarget.min, max: item.rpeTarget.max } : null;
      return { sets: item.sets, reps: { min: m.min, max: m.max }, rpeTarget: rpe };
    }
  }
  return null;
}

/**
 * The read rows as per-exercise session records (pure): active results only
 * (a corrected row is replaced by its correction), repetition sets only, one
 * record per completed execution and exercise, oldest first.
 */
export function toStrengthHistoryByExercise(read: StrengthSetHistoryRead): Record<string, StrengthExerciseSessionRecordV2[]> {
  const superseded = new Set(read.sets.map((s) => s.supersedes_id).filter((id): id is string => id !== null));
  const executions = new Map(read.executions.map((e) => [e.executionId, e]));
  const grouped = new Map<string, { executionId: string; exerciseId: string; rows: typeof read.sets }>();
  for (const row of read.sets) {
    if (superseded.has(row.id) || row.exercise_id === null || row.measure_type !== "reps" || !executions.has(row.execution_id)) continue;
    const key = `${row.execution_id}|${row.exercise_id}`;
    const entry = grouped.get(key) ?? { executionId: row.execution_id, exerciseId: row.exercise_id, rows: [] };
    entry.rows.push(row);
    grouped.set(key, entry);
  }
  const out: Record<string, StrengthExerciseSessionRecordV2[]> = {};
  const ordered = [...grouped.values()].sort((a, b) => {
    const da = executions.get(a.executionId)!.sessionDate;
    const db = executions.get(b.executionId)!.sessionDate;
    return da < db ? -1 : da > db ? 1 : a.executionId < b.executionId ? -1 : a.executionId > b.executionId ? 1 : 0;
  });
  for (const g of ordered) {
    const execution = executions.get(g.executionId)!;
    const rows = [...g.rows].sort((a, b) => a.set_number - b.set_number || (a.id < b.id ? -1 : 1));
    (out[g.exerciseId] ??= []).push({
      sessionDate: execution.sessionDate,
      prescribed: prescribedItem(execution.structure, rows[0]!.prescription_item_id),
      sets: rows.map((r) => ({ setNumber: r.set_number, done: r.done, reps: r.measure_value, loadKg: num(r.load_kg), rpe: num(r.rpe_actual) })),
    });
  }
  return out;
}

/**
 * Today's final prescription with its load guidance (Force only). Any other
 * result — REST, blocked, another family, no loadable work exercise — is
 * returned unchanged, without any read.
 */
export async function withStrengthLoadGuidance(
  result: FinalPrescriptionWithinTodayTimeV2Result,
  client: SupabaseClient,
  athleteId: string,
  today: string,
  deps: StrengthLoadGuidanceDeps = DEFAULT_DEPS,
  todayHold?: "pain" | "fatigue"
): Promise<WithLoadGuidanceResult> {
  if (result.status !== "created") return result;
  const structure: PrescriptionV2 = result.finalPrescription.structure;
  const exerciseIds = [...new Set([...strengthLoadGuidanceExerciseIdsV2(structure), ...bodyweightRepsGuidanceExerciseIdsV2(structure)])];
  if (exerciseIds.length === 0) return result;

  let history: Record<string, StrengthExerciseSessionRecordV2[]>;
  try {
    history = toStrengthHistoryByExercise(await deps.getCompletedStrengthSetHistory(client, athleteId, exerciseIds, addDays(today, -STRENGTH_HISTORY_WINDOW_DAYS), today));
  } catch {
    return { ...result, loadGuidanceWarning: LOAD_GUIDANCE_WARNINGS.readFailed };
  }
  const guided = attachBodyweightRepsGuidanceV2(attachStrengthLoadGuidanceV2(structure, today, history, todayHold), today, history, todayHold);
  if (!validatePrescriptionV2(guided, { stage: "final" }).ok) return { ...result, loadGuidanceWarning: LOAD_GUIDANCE_WARNINGS.invalid };
  return { ...result, finalPrescription: { ...result.finalPrescription, structure: guided } };
}
