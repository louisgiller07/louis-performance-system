/**
 * PHYS-02 — endurance guidance on today's final prescription (integration
 * layer). After the V2 reconciliation produced an endurance final
 * prescription, the rider's completed endurance sessions are read
 * (enduranceActivityHistoryRepo) and the pure rule of planning-engine
 * (enduranceGuidanceV2) attaches `enduranceGuidance`: the last session of the
 * same protocol, as recorded. The result is validated as a final
 * prescription before it is persisted.
 *
 * Advisory and best-effort, like the Force load guidance: a read failure or
 * an invalid result never blocks the daily decision — the prescription is
 * kept without guidance and a stable warning says why. M1's decision, the
 * content, the doses and the durations are never changed. Nothing is
 * written here.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  attachEnduranceGuidanceV2,
  enduranceGuidanceV2,
  validatePrescriptionV2,
  type EnduranceSessionRecordV2,
  type PrescriptionV2,
} from "planning-engine/session-model-v2/daily";
import { getCompletedEnduranceActivityHistory, type EnduranceActivityHistoryRead } from "../repositories/enduranceActivityHistoryRepo.js";
import type { WithLoadGuidanceResult } from "./strengthLoadGuidance.js";

/** History read before the decision date (days) — ENDURANCE_GUIDANCE_POLICY_V2.historyWindowDays. */
export const ENDURANCE_HISTORY_WINDOW_DAYS = 28;

export const ENDURANCE_GUIDANCE_WARNINGS = {
  readFailed: "phys02_endurance_guidance_history_unavailable",
  invalid: "phys02_endurance_guidance_invalid",
} as const;

export type WithEnduranceGuidanceResult = WithLoadGuidanceResult & { enduranceGuidanceWarning?: string };

export interface EnduranceGuidanceDeps {
  getCompletedEnduranceActivityHistory: typeof getCompletedEnduranceActivityHistory;
}

const DEFAULT_DEPS: EnduranceGuidanceDeps = { getCompletedEnduranceActivityHistory };

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * The read rows as endurance session records (pure): executions of an
 * endurance final prescription with a protocol, each with its ACTIVE activity
 * result (a corrected row is replaced by its correction); an execution
 * without a result is skipped. Oldest first.
 */
export function toEnduranceSessionRecords(read: EnduranceActivityHistoryRead): EnduranceSessionRecordV2[] {
  const superseded = new Set(read.activities.map((a) => a.supersedes_id).filter((id): id is string => id !== null));
  const out: EnduranceSessionRecordV2[] = [];
  for (const execution of read.executions) {
    const s = execution.structure;
    if (!isObj(s) || s.family !== "endurance" || typeof s.protocolId !== "string") continue;
    const active = read.activities.filter((a) => a.execution_id === execution.executionId && !superseded.has(a.id));
    const row = active[active.length - 1];
    if (!row) continue;
    out.push({
      sessionDate: execution.sessionDate,
      protocolId: s.protocolId,
      activityId: row.activity_id,
      durationSeconds: row.duration_seconds,
      distanceM: row.distance_m,
      rpeActual: num(row.rpe_actual),
    });
  }
  return out.sort((a, b) => (a.sessionDate < b.sessionDate ? -1 : a.sessionDate > b.sessionDate ? 1 : 0));
}

/**
 * Today's final prescription with its endurance guidance (endurance only).
 * Any other result — REST, blocked, another family — is returned unchanged,
 * without any read.
 */
export async function withEnduranceGuidance(
  result: WithLoadGuidanceResult,
  client: SupabaseClient,
  athleteId: string,
  today: string,
  deps: EnduranceGuidanceDeps = DEFAULT_DEPS
): Promise<WithEnduranceGuidanceResult> {
  if (result.status !== "created") return result;
  const structure: PrescriptionV2 = result.finalPrescription.structure;
  if (structure.family !== "endurance" || structure.protocolId === undefined) return result;

  let history: EnduranceSessionRecordV2[];
  try {
    history = toEnduranceSessionRecords(await deps.getCompletedEnduranceActivityHistory(client, athleteId, addDays(today, -ENDURANCE_HISTORY_WINDOW_DAYS), today));
  } catch {
    return { ...result, enduranceGuidanceWarning: ENDURANCE_GUIDANCE_WARNINGS.readFailed };
  }
  const guided = attachEnduranceGuidanceV2(structure, enduranceGuidanceV2({ date: today, prescription: structure }, history));
  if (guided === structure) return result;
  if (!validatePrescriptionV2(guided, { stage: "final" }).ok) return { ...result, enduranceGuidanceWarning: ENDURANCE_GUIDANCE_WARNINGS.invalid };
  return { ...result, finalPrescription: { ...result.finalPrescription, structure: guided } };
}
