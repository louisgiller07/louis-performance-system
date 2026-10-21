/**
 * PARTIAL-01-L2 (HPM 2026-10-21) — the rider's REAL session history, normalized for the future V2 generator: one entry
 * per V1 debrief (`completed_sessions`) and one per guided V2 execution (`session_executions` and its events, set and
 * activity results, frozen prescription), with the day's decided session beside it. Pure and deterministic.
 *
 * Read model only. Nothing here is wired to a decision, a generation or a progression rule; no threshold of any kind
 * (progression, RPE, fatigue) is defined or applied.
 *
 * Every value says how it is known (`HistoryValue`):
 * - `real`, `recorded`: entered in the app while the session ran (set and activity results, lifecycle events);
 * - `real`, `declared`: declared by the rider afterwards (V1 debrief);
 * - `estimated`: derived from other values (only `completed_sessions.session_load`);
 * - `planned`: the decided session or the frozen prescription — never the work done;
 * - `absent`, with its reason. An absent value is never filled in, converted or copied from the planned side.
 *
 * Outcome rules (canon docs/05, ADR PARTIAL-01, ADR UX-11B):
 * - V1: `done` → completed, `partial` → partial, `replaced` → replaced, `skipped` → not_done, as DECLARED.
 * - V2: a `completed` event + every prescribed work set / pass done → completed; fewer → partial (`realisationV2`, the
 *   PARTIAL-01 rule, reused as is); a `completed` event without a provable realisation → completed_unqualified, never
 *   completed; an `abandoned` event → abandoned; no terminal event → open. A partial session is never completed.
 * - No record for a day is no entry: never a skipped, missed or failed session.
 * - Free texts (notes, comments, pain note) are not read.
 */
import { parseTrainingIntervention } from "./parseTrainingIntervention.js";
import { realisationV2 } from "./planHistoryV2.js";

/** Why a value is absent. */
export type HistoryAbsenceReason =
  /** The product does not collect this value for this kind of record. */
  | "not_collected"
  /** Left empty by the rider, or null in the stored record. */
  | "not_entered"
  /** The planned source carries no value for it. */
  | "not_specified"
  /** Meaningless for this record (e.g. the duration of a session not performed). */
  | "not_applicable"
  /** No decision or prescription is linked to the record. */
  | "not_linked"
  /** The linked data cannot be read or decoded unambiguously. */
  | "not_readable";

export type HistoryValue<T> =
  | { status: "real"; basis: "recorded" | "declared"; value: T; source: string }
  | { status: "estimated"; value: T; source: string; method: string }
  | { status: "planned"; value: T; source: string }
  | { status: "absent"; reason: HistoryAbsenceReason; source: string | null };

// ---------------------------------------------------------------------------------------------------------------------
// Input facts (rows as read by sessionResultHistoryRepo.ts)
// ---------------------------------------------------------------------------------------------------------------------

export interface SessionHistoryDebriefRow {
  id: string;
  session_date: string;
  session_type: string;
  completion_status: string;
  actual_duration_min: number | null;
  rpe: number | null;
  session_load: number | string | null;
  intervention: unknown;
  decision_id: string | null;
  post_leg_fatigue: number | null;
  post_grip_fatigue: number | null;
  new_pain: boolean | null;
  technical_outcome: string | null;
  change_reason: string | null;
}
export interface SessionHistoryEventRow {
  event_type: string;
  occurred_at: string;
  event_seq: number | string;
}
export interface SessionHistoryExecutionRow {
  id: string;
  session_date: string;
  decision_id: string | null;
  final_prescription_id: string | null;
  started_at: string;
  events: readonly SessionHistoryEventRow[];
}
export interface SessionHistoryDecisionRow {
  id: string;
  decision_date: string;
  /** `decisions.daily_plan->final_session` (null for a pre-M2 decision). */
  final_session: unknown;
}
export interface SessionHistoryPrescriptionRow {
  id: string;
  structure: unknown;
}
export interface SessionHistorySetRow {
  id: string;
  execution_id: string;
  prescription_item_id: string | null;
  exercise_id: string | null;
  other_exercise_name: string | null;
  set_number: number;
  done: boolean;
  measure_type: string;
  measure_value: number | string | null;
  load_kg: number | string | null;
  rpe_actual: number | string | null;
  success: boolean | null;
  supersedes_id: string | null;
}
export interface SessionHistoryActivityRow {
  id: string;
  execution_id: string;
  activity_id: string;
  duration_seconds: number | string;
  distance_m: number | string | null;
  rpe_actual: number | string | null;
  supersedes_id: string | null;
}
export interface SessionHistoryFacts {
  debriefs: readonly SessionHistoryDebriefRow[];
  executions: readonly SessionHistoryExecutionRow[];
  decisions: readonly SessionHistoryDecisionRow[];
  prescriptions: readonly SessionHistoryPrescriptionRow[];
  sets: readonly SessionHistorySetRow[];
  activities: readonly SessionHistoryActivityRow[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Normalized history
// ---------------------------------------------------------------------------------------------------------------------

export type SessionOutcome = "completed" | "partial" | "completed_unqualified" | "replaced" | "not_done" | "abandoned" | "open";
/** What the outcome rests on: the rider's declaration, the results against the frozen prescription, or only the lifecycle events. */
export type SessionOutcomeBasis = "declared_by_rider" | "results_vs_frozen_prescription" | "lifecycle_event";
export type UnqualifiedReason = "family_without_provable_realisation" | "prescription_not_readable" | "ambiguous_results";

/** The day's decided session the record is linked to (`decisions.daily_plan.final_session`): planned, never performed. */
export interface DecidedSessionView {
  decisionId: string | null;
  kind: HistoryValue<string>;
  loadProfile: HistoryValue<string>;
  durationMin: HistoryValue<number>;
}

export interface RiderFeedbackView {
  technicalOutcome: HistoryValue<string>;
  changeReason: HistoryValue<string>;
  postLegFatigue: HistoryValue<number>;
  postGripFatigue: HistoryValue<number>;
  newPain: HistoryValue<boolean>;
}

export interface PerformedV1 {
  /** The activity really performed, as declared (`completed_sessions.intervention`, never the prescribed one). */
  intervention: HistoryValue<{ kind: string; loadProfile: string | null; durationMin: number | null }>;
  /** Coarse DB type; for a session not performed, the type the rider chose for it. */
  sessionType: HistoryValue<string>;
  durationMin: HistoryValue<number>;
  /** Session RPE, 0–10, declared after the session. */
  sessionRpe: HistoryValue<number>;
}

export interface V1DebriefEntry {
  source: "v1_debrief";
  recordId: string;
  date: string;
  outcome: SessionOutcome;
  outcomeBasis: "declared_by_rider";
  decided: DecidedSessionView;
  performed: PerformedV1;
  /** `actual_duration_min × rpe / 10`, derived by the database: an estimate, never a measured load. */
  estimatedLoad: HistoryValue<number>;
  feedback: RiderFeedbackView;
}

export interface PlannedItemV2 {
  prescriptionItemId: string;
  itemKind: "exercise" | "drill";
  /** `exerciseId` or `drillId` of the catalogue. */
  catalogId: string;
  blockRole: string;
  /** Prescribed work sets (exercise) or passes (drill). */
  prescribedCount: number;
  /** As prescribed (a range for reps / duration / distance; a count for passes). */
  measure: Readonly<Record<string, unknown>>;
}
export interface PlannedPrescriptionV2 {
  family: string;
  sessionKind: string;
  /** Work items only (`main` / `complementary` blocks): warm-up and ramp-up are instructions, never recorded. */
  items: PlannedItemV2[];
  activityIds: string[];
}

export interface PerformedSetV2 {
  setNumber: number;
  done: boolean;
  measureType: string;
  measureValue: HistoryValue<number>;
  loadKg: HistoryValue<number>;
  rpe: HistoryValue<number>;
  success: HistoryValue<boolean>;
  /** This active result is a correction of an earlier one. */
  corrected: boolean;
}
export interface PerformedItemV2 {
  prescriptionItemId: string;
  exerciseId: string | null;
  /** Active results only (corrections applied), by set number. */
  sets: PerformedSetV2[];
}
export interface PerformedActivityV2 {
  activityId: string;
  durationSeconds: number;
  distanceM: HistoryValue<number>;
  /** RPE of the whole endurance activity, 1–10. */
  rpe: HistoryValue<number>;
  corrected: boolean;
}
export interface PerformedV2 {
  items: PerformedItemV2[];
  /** « Autre exercice » results: real work outside the prescription. */
  unprescribedSets: Array<{ otherExerciseName: string } & PerformedSetV2>;
  activity: HistoryValue<PerformedActivityV2>;
  /** Only an endurance activity records a duration; Force, DH, power, mobility and recovery record none. */
  durationSeconds: HistoryValue<number>;
  /** No session RPE is collected for a guided session. */
  sessionRpe: HistoryValue<number>;
  /** Results replaced by a correction (not counted). */
  correctionsApplied: number;
}
export interface LifecycleV2 {
  startedAt: HistoryValue<string>;
  /** Time of the terminal event. Elapsed time includes pauses: it is not a training duration. */
  endedAt: HistoryValue<string>;
  events: string[];
}
/** Factual counts of the prescribed work slots (item × set / pass); no judgement, whatever the outcome. */
export interface SlotCountsV2 {
  prescribed: number;
  withDoneResult: number;
  withoutResult: number;
  ambiguous: number;
}

export interface V2ExecutionEntry {
  source: "v2_guided_execution";
  recordId: string;
  date: string;
  outcome: SessionOutcome;
  outcomeBasis: Exclude<SessionOutcomeBasis, "declared_by_rider">;
  unqualifiedReason: UnqualifiedReason | null;
  decided: DecidedSessionView;
  prescription: HistoryValue<PlannedPrescriptionV2>;
  performed: PerformedV2;
  slots: SlotCountsV2 | null;
  lifecycle: LifecycleV2;
  feedback: RiderFeedbackView;
}

export type SessionHistoryEntry = V1DebriefEntry | V2ExecutionEntry;

export interface SessionResultHistory {
  from: string;
  to: string;
  entries: SessionHistoryEntry[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Throws on a malformed or reversed window: the history is never read over an undefined range. */
export function assertHistoryWindow(from: string, to: string): void {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) throw new RangeError(`Invalid session history window [${from}, ${to}]`);
}

const recorded = <T>(value: T, source: string): HistoryValue<T> => ({ status: "real", basis: "recorded", value, source });
const declared = <T>(value: T, source: string): HistoryValue<T> => ({ status: "real", basis: "declared", value, source });
const planned = <T>(value: T, source: string): HistoryValue<T> => ({ status: "planned", value, source });
const absent = <T>(reason: HistoryAbsenceReason, source: string | null): HistoryValue<T> => ({ status: "absent", reason, source });

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** numeric columns come back as strings from PostgREST. */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const lower = (id: string) => id.toLowerCase();

const FIXED_LOAD_KINDS = ["MOBILITY", "RECOVERY_ACTIVE", "REST", "BIKE_MAINTENANCE", "RACE_ACTIVITY"];
const V1_OUTCOMES: Readonly<Record<string, SessionOutcome>> = { done: "completed", partial: "partial", replaced: "replaced", skipped: "not_done" };
/** The guided kinds PARTIAL-01 qualifies (`realisationV2`). */
const QUALIFIED_STRENGTH_KINDS = ["STRENGTH_LOWER", "STRENGTH_UPPER"];
const WORK_BLOCK_ROLES = ["main", "complementary"];

function decidedSession(decisionId: string | null, decisions: readonly SessionHistoryDecisionRow[]): DecidedSessionView {
  const S = "decisions.daily_plan.final_session";
  if (decisionId === null) return { decisionId, kind: absent("not_linked", null), loadProfile: absent("not_linked", null), durationMin: absent("not_linked", null) };
  const fs = decisions.find((d) => lower(d.id) === lower(decisionId))?.final_session;
  if (!isObject(fs) || typeof fs.kind !== "string") return { decisionId, kind: absent("not_readable", S), loadProfile: absent("not_readable", S), durationMin: absent("not_readable", S) };
  const loadProfile = typeof fs.load_profile === "string" ? planned(fs.load_profile, `${S}.load_profile`) : absent<string>(FIXED_LOAD_KINDS.includes(fs.kind) ? "not_applicable" : "not_specified", `${S}.load_profile`);
  const minutes = num(fs.duration_min);
  const durationMin = minutes !== null && Number.isInteger(minutes) && minutes > 0 ? planned(minutes, `${S}.duration_min`) : absent<number>(fs.kind === "REST" ? "not_applicable" : "not_specified", `${S}.duration_min`);
  return { decisionId, kind: planned(fs.kind, `${S}.kind`), loadProfile, durationMin };
}

const NOT_COLLECTED_FEEDBACK: RiderFeedbackView = {
  technicalOutcome: absent("not_collected", null),
  changeReason: absent("not_collected", null),
  postLegFatigue: absent("not_collected", null),
  postGripFatigue: absent("not_collected", null),
  newPain: absent("not_collected", null),
};

// ---------------------------------------------------------------------------------------------------------------------
// V1 debrief
// ---------------------------------------------------------------------------------------------------------------------

function v1Entry(row: SessionHistoryDebriefRow, decisions: readonly SessionHistoryDecisionRow[]): V1DebriefEntry {
  const outcome = V1_OUTCOMES[row.completion_status];
  if (!outcome) throw new Error(`Unknown completion_status "${row.completion_status}" (completed_sessions ${row.id})`);
  const T = "completed_sessions";
  const skipped = row.completion_status === "skipped";

  let intervention: PerformedV1["intervention"];
  if (row.intervention === null || row.intervention === undefined) intervention = absent(skipped ? "not_applicable" : "not_entered", `${T}.intervention`);
  else {
    try {
      const parsed = parseTrainingIntervention(row.intervention);
      intervention = declared({ kind: parsed.kind, loadProfile: parsed.load_profile ?? null, durationMin: parsed.duration_min ?? null }, `${T}.intervention`);
    } catch {
      intervention = absent("not_readable", `${T}.intervention`);
    }
  }
  const rest = row.session_type === "REST" || (intervention.status === "real" && intervention.value.kind === "REST");
  /** Not performed, or a declared rest: no duration, no RPE (canon). */
  const missing = skipped || rest ? "not_applicable" : "not_entered";
  const duration = num(row.actual_duration_min);
  const rpe = num(row.rpe);
  const load = num(row.session_load);
  const declaredOr = <V>(value: V | null, column: string, reason: HistoryAbsenceReason = "not_entered"): HistoryValue<V> => (value === null ? absent(reason, `${T}.${column}`) : declared(value, `${T}.${column}`));

  return {
    source: "v1_debrief",
    recordId: row.id,
    date: row.session_date,
    outcome,
    outcomeBasis: "declared_by_rider",
    decided: decidedSession(row.decision_id, decisions),
    performed: {
      intervention,
      sessionType: declared(row.session_type, `${T}.session_type`),
      durationMin: declaredOr(duration, "actual_duration_min", missing),
      sessionRpe: declaredOr(rpe, "rpe", missing),
    },
    estimatedLoad:
      load === null
        ? absent(missing, `${T}.session_load`)
        : { status: "estimated", value: load, source: `${T}.session_load`, method: "actual_duration_min × rpe / 10, derived by trigger trg_compute_session_load" },
    feedback: {
      // Asked only after a DH session done or partial, linked to a decision with a technical task (canon).
      technicalOutcome: declaredOr(row.technical_outcome, "technical_outcome", row.completion_status === "done" || row.completion_status === "partial" ? "not_entered" : "not_applicable"),
      // Rejected for a session done as planned (canon): absent there by construction.
      changeReason: declaredOr(row.change_reason, "change_reason", row.completion_status === "done" ? "not_applicable" : "not_entered"),
      postLegFatigue: declaredOr(num(row.post_leg_fatigue), "post_leg_fatigue"),
      postGripFatigue: declaredOr(num(row.post_grip_fatigue), "post_grip_fatigue"),
      newPain: declaredOr(row.new_pain, "new_pain"),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// V2 guided execution
// ---------------------------------------------------------------------------------------------------------------------

/** Rows no correction supersedes (a correction is itself never corrected). */
function activeRows<R extends { id: string; supersedes_id: string | null }>(rows: readonly R[]): R[] {
  const superseded = new Set(rows.filter((r) => r.supersedes_id !== null).map((r) => lower(r.supersedes_id!)));
  return rows.filter((r) => !superseded.has(lower(r.id)));
}

function plannedPrescription(structure: unknown): PlannedPrescriptionV2 | null {
  if (!isObject(structure) || typeof structure.family !== "string" || typeof structure.sessionKind !== "string" || !Array.isArray(structure.blocks)) return null;
  const items: PlannedItemV2[] = [];
  for (const block of structure.blocks) {
    if (!isObject(block) || !WORK_BLOCK_ROLES.includes(String(block.role)) || !Array.isArray(block.items)) continue;
    for (const item of block.items) {
      if (!isObject(item) || typeof item.prescriptionItemId !== "string" || !isObject(item.measure)) return null;
      if (item.kind === "exercise" && typeof item.exerciseId === "string" && Number.isInteger(item.sets) && (item.sets as number) > 0) {
        items.push({ prescriptionItemId: item.prescriptionItemId, itemKind: "exercise", catalogId: item.exerciseId, blockRole: String(block.role), prescribedCount: item.sets as number, measure: { ...item.measure } });
      } else if (item.kind === "drill" && typeof item.drillId === "string" && item.measure.type === "pass" && Number.isInteger(item.measure.count) && (item.measure.count as number) > 0) {
        items.push({ prescriptionItemId: item.prescriptionItemId, itemKind: "drill", catalogId: item.drillId, blockRole: String(block.role), prescribedCount: item.measure.count as number, measure: { ...item.measure } });
      } else return null;
    }
  }
  const ids = isObject(structure.activitySelection) && Array.isArray(structure.activitySelection.activityIds) ? structure.activitySelection.activityIds.map(String) : [];
  return { family: structure.family, sessionKind: structure.sessionKind, items, activityIds: ids };
}

function performedSet(row: SessionHistorySetRow): PerformedSetV2 {
  const R = "exercise_set_results";
  const pass = row.measure_type === "pass";
  const value = num(row.measure_value);
  const load = num(row.load_kg);
  const rpe = num(row.rpe_actual);
  return {
    setNumber: row.set_number,
    done: row.done,
    measureType: row.measure_type,
    measureValue: pass ? absent("not_applicable", `${R}.measure_value`) : value === null ? absent(row.done ? "not_entered" : "not_applicable", `${R}.measure_value`) : recorded(value, `${R}.measure_value`),
    // A DH pass records neither load nor RPE; Force asks for both, optionally.
    loadKg: load !== null ? recorded(load, `${R}.load_kg`) : absent(pass ? "not_collected" : "not_entered", `${R}.load_kg`),
    rpe: rpe !== null ? recorded(rpe, `${R}.rpe_actual`) : absent(pass ? "not_collected" : "not_entered", `${R}.rpe_actual`),
    // A pass may be evaluated (or not); a Force set never shows the question.
    success: row.success !== null ? recorded(row.success, `${R}.success`) : absent(pass ? "not_entered" : "not_collected", `${R}.success`),
    corrected: row.supersedes_id !== null,
  };
}

function slotCounts(items: readonly PlannedItemV2[], sets: readonly SessionHistorySetRow[]): SlotCountsV2 | null {
  if (items.length === 0) return null;
  const counts: SlotCountsV2 = { prescribed: 0, withDoneResult: 0, withoutResult: 0, ambiguous: 0 };
  for (const item of items) {
    for (let n = 1; n <= item.prescribedCount; n += 1) {
      const rows = sets.filter((s) => s.prescription_item_id !== null && lower(s.prescription_item_id) === lower(item.prescriptionItemId) && s.set_number === n);
      counts.prescribed += 1;
      if (rows.length === 0) counts.withoutResult += 1;
      else if (rows.length > 1) counts.ambiguous += 1;
      else if (rows[0]!.done) counts.withDoneResult += 1;
    }
  }
  return counts;
}

function v2Entry(execution: SessionHistoryExecutionRow, facts: SessionHistoryFacts): V2ExecutionEntry {
  const E = "session_executions";
  const P = "decision_final_prescriptions.structure";
  const events = [...execution.events].sort((a, b) => Number(a.event_seq) - Number(b.event_seq));
  const terminal = events.find((e) => e.event_type === "completed") ?? events.find((e) => e.event_type === "abandoned");

  const structure = execution.final_prescription_id === null ? undefined : facts.prescriptions.find((p) => lower(p.id) === lower(execution.final_prescription_id!))?.structure;
  const plan = structure === undefined ? null : plannedPrescription(structure);
  const prescription: HistoryValue<PlannedPrescriptionV2> =
    execution.final_prescription_id === null ? absent("not_linked", null) : plan === null ? absent("not_readable", P) : planned(plan, P);

  const allSets = facts.sets.filter((s) => lower(s.execution_id) === lower(execution.id));
  const sets = activeRows(allSets);
  const activities = activeRows(facts.activities.filter((a) => lower(a.execution_id) === lower(execution.id)));
  const items = new Map<string, PerformedItemV2>();
  const unprescribedSets: PerformedV2["unprescribedSets"] = [];
  for (const row of [...sets].sort((a, b) => a.set_number - b.set_number || a.id.localeCompare(b.id))) {
    if (row.prescription_item_id === null) {
      unprescribedSets.push({ otherExerciseName: row.other_exercise_name ?? "", ...performedSet(row) });
      continue;
    }
    const key = lower(row.prescription_item_id);
    const item = items.get(key) ?? { prescriptionItemId: row.prescription_item_id, exerciseId: row.exercise_id, sets: [] };
    item.sets.push(performedSet(row));
    items.set(key, item);
  }

  const A = "session_activity_results";
  const endurance = plan?.family === "endurance";
  let activity: HistoryValue<PerformedActivityV2>;
  if (activities.length > 1) activity = absent("not_readable", A);
  else if (activities.length === 0) activity = absent(endurance || plan === null ? "not_entered" : "not_applicable", A);
  else {
    const a = activities[0]!;
    const distance = num(a.distance_m);
    const rpe = num(a.rpe_actual);
    activity = recorded(
      {
        activityId: a.activity_id,
        durationSeconds: num(a.duration_seconds) ?? 0,
        distanceM: distance === null ? absent("not_entered", `${A}.distance_m`) : recorded(distance, `${A}.distance_m`),
        rpe: rpe === null ? absent("not_entered", `${A}.rpe_actual`) : recorded(rpe, `${A}.rpe_actual`),
        corrected: a.supersedes_id !== null,
      },
      A
    );
  }
  const durationSeconds: HistoryValue<number> =
    activity.status === "real"
      ? recorded(activity.value.durationSeconds, `${A}.duration_seconds`)
      : plan !== null && !endurance
        ? absent("not_collected", null)
        : absent(activity.status === "absent" ? activity.reason : "not_entered", `${A}.duration_seconds`);

  let outcome: SessionOutcome;
  let outcomeBasis: V2ExecutionEntry["outcomeBasis"] = "lifecycle_event";
  let unqualifiedReason: UnqualifiedReason | null = null;
  const slots = plan === null ? null : slotCounts(plan.items, sets);
  if (terminal?.event_type === "completed") {
    const realisation = plan === null ? null : realisationV2(structure, allSets);
    if (realisation !== null) {
      outcome = realisation === "complete" ? "completed" : "partial";
      outcomeBasis = "results_vs_frozen_prescription";
    } else {
      outcome = "completed_unqualified";
      const qualifiable = plan !== null && ((plan.family === "strength" && QUALIFIED_STRENGTH_KINDS.includes(plan.sessionKind)) || plan.family === "dh_technical");
      unqualifiedReason = plan === null ? "prescription_not_readable" : (slots?.ambiguous ?? 0) > 0 ? "ambiguous_results" : qualifiable ? "prescription_not_readable" : "family_without_provable_realisation";
    }
  } else outcome = terminal?.event_type === "abandoned" ? "abandoned" : "open";

  return {
    source: "v2_guided_execution",
    recordId: execution.id,
    date: execution.session_date,
    outcome,
    outcomeBasis,
    unqualifiedReason,
    decided: decidedSession(execution.decision_id, facts.decisions),
    prescription,
    performed: {
      // In the prescription's order; results of an item the prescription does not list (or an unreadable one) after, by id.
      items: [...items.values()].sort((a, b) => {
        const rank = (id: string) => {
          const i = plan?.items.findIndex((p) => lower(p.prescriptionItemId) === lower(id)) ?? -1;
          return i === -1 ? Number.MAX_SAFE_INTEGER : i;
        };
        return rank(a.prescriptionItemId) - rank(b.prescriptionItemId) || lower(a.prescriptionItemId).localeCompare(lower(b.prescriptionItemId));
      }),
      unprescribedSets,
      activity,
      durationSeconds,
      sessionRpe: absent("not_collected", null),
      correctionsApplied: allSets.length - sets.length + (facts.activities.filter((a) => lower(a.execution_id) === lower(execution.id)).length - activities.length),
    },
    slots,
    lifecycle: {
      startedAt: recorded(execution.started_at, `${E}.started_at`),
      endedAt: terminal ? recorded(terminal.occurred_at, "execution_events.occurred_at") : absent("not_applicable", "execution_events"),
      events: events.map((e) => e.event_type),
    },
    // No debrief, fatigue, pain or reason is collected after a guided session (canon: « à venir »).
    feedback: NOT_COLLECTED_FEEDBACK,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Every record dated in [from, to], by date; on one day the guided attempts first (by start), then the V1 debrief —
 * which can coexist only with an attempt stopped before any result (canon F-5, INT-01). Nothing is merged, collapsed
 * or deduplicated: several sessions close together stay several entries.
 */
export function sessionResultHistory(facts: SessionHistoryFacts, from: string, to: string): SessionResultHistory {
  assertHistoryWindow(from, to);
  const inWindow = (date: string) => date >= from && date <= to;
  const v2 = facts.executions
    .filter((e) => inWindow(e.session_date))
    .sort((a, b) => a.session_date.localeCompare(b.session_date) || a.started_at.localeCompare(b.started_at) || a.id.localeCompare(b.id))
    .map((e) => v2Entry(e, facts));
  const v1 = facts.debriefs.filter((d) => inWindow(d.session_date)).map((d) => v1Entry(d, facts.decisions));
  const entries = [...v2, ...v1].sort((a, b) => a.date.localeCompare(b.date) || (a.source === b.source ? 0 : a.source === "v2_guided_execution" ? -1 : 1));
  return { from, to, entries };
}
