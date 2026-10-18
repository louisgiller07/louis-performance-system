/**
 * V2-L2-01a (HPM 2026-10-18, canon docs/05 « Historique de la génération V2 ») — the recent training history of a
 * V2 plan generation, from the facts the athlete really left: V1 debriefs, guided V2 executions and their results,
 * the day's decisions, check-ins and health signals. Pure and deterministic; nothing is invented.
 *
 * - Window: [today − 7, today] (the window of `getRecentSessions`, `completedSessionsRepo.ts`); later dates ignored.
 * - One fact per day, in this order (dayCompletion's, and the one-main-session-per-day lock): a V1 debrief
 *   done / partial / replaced; else a completed guided execution (the first by started_at, id); else a V1 `skipped`
 *   debrief; else nothing.
 * - Realised volume: a V1 debrief's declared minutes; a guided endurance session's recorded activity duration; the
 *   decided duration of a Force or DH session performed IN FULL (every prescribed work set / every pass). Anything
 *   else — partial, power, mobility, recovery, unqualifiable — counts 0.
 * - A missed V2 session needs explicit, verifiable evidence (see `missedEvidence`); any doubt → not counted.
 *
 * Only `trailingVolumeMinutes` and `recentMissedOrReplacedCount` come from here; the planner's thresholds (180 min,
 * 2 missed — PROVISIONAL) are unchanged.
 */
import { PROVISIONAL_THRESHOLDS } from "../../engine/provisionalThresholds.js";

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface PlanHistoryDebriefRowV2 {
  session_date: string;
  completion_status: string;
  actual_duration_min: number | null;
  change_reason: string | null;
  new_pain: boolean | null;
}
export interface PlanHistoryExecutionRowV2 {
  id: string;
  session_date: string;
  decision_id: string | null;
  final_prescription_id: string | null;
  started_at: string;
  events: readonly string[];
}
export interface PlanHistoryDecisionRowV2 {
  id: string;
  decision_date: string;
  created_at: string;
  daily_plan: unknown;
}
export interface PlanHistorySetRowV2 {
  id: string;
  execution_id: string;
  prescription_item_id: string | null;
  set_number: number;
  done: boolean;
  supersedes_id: string | null;
}
export interface PlanHistoryActivityRowV2 {
  id: string;
  execution_id: string;
  duration_seconds: number;
  supersedes_id: string | null;
}
export interface PlanHistoryCheckinRowV2 {
  checkin_date: string;
  pain: boolean | null;
  fever_or_illness: boolean | null;
  suspected_concussion: boolean | null;
}
export interface PlanHistoryHealthFlagRowV2 {
  flag_date: string;
  status: string;
  resolved_at: string | null;
}

export interface PlanHistoryFactsV2 {
  debriefs: readonly PlanHistoryDebriefRowV2[];
  executions: readonly PlanHistoryExecutionRowV2[];
  decisions: readonly PlanHistoryDecisionRowV2[];
  prescriptions: readonly { id: string; structure: unknown }[];
  sets: readonly PlanHistorySetRowV2[];
  activities: readonly PlanHistoryActivityRowV2[];
  checkins: readonly PlanHistoryCheckinRowV2[];
  healthFlags: readonly PlanHistoryHealthFlagRowV2[];
}

/** What one day contributed, for traceability and tests. */
export type PlanHistoryDayV2 =
  | { date: string; fact: "debrief_performed"; minutes: number }
  | { date: string; fact: "guided_completed"; family: string | null; realisation: "complete" | "partial" | null; minutes: number }
  | { date: string; fact: "debrief_skipped"; missed: boolean; why: string }
  | { date: string; fact: "none" };

export interface PlanHistoryV2 {
  trailingVolumeMinutes: number;
  recentMissedOrReplacedCount: number;
  days: PlanHistoryDayV2[];
}

/** Reasons a « Non réalisée » may count as a missed session; every other reason (pain, fatigue_control, coach_criterion, activity_change, other, none) never does. */
export const ELIGIBLE_MISSED_REASONS_V2: readonly string[] = ["time_life", "motivation", "weather_terrain", "mechanical"];
const NON_TRAINING_KINDS = ["REST", "RACE_ACTIVITY", "BIKE_MAINTENANCE"];
const PERFORMED_DEBRIEF = ["done", "partial", "replaced"];
/** The guided Force kinds (web `STRENGTH_SESSION_KINDS`); POWER is guided like Force but never credited here. */
const STRENGTH_SESSION_KINDS = ["STRENGTH_LOWER", "STRENGTH_UPPER"];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const byCreation = (a: PlanHistoryDecisionRowV2, b: PlanHistoryDecisionRowV2) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);

/** Rows no correction supersedes (a correction is itself never corrected). */
function active<T extends { id: string; supersedes_id: string | null }>(rows: readonly T[]): T[] {
  const superseded = new Set(rows.filter((r) => r.supersedes_id).map((r) => r.supersedes_id!.toLowerCase()));
  return rows.filter((r) => !superseded.has(r.id.toLowerCase()));
}

/** Every planned slot has exactly one active, performed result → true; a slot without → false; nothing to compare or two active results for one slot → null. */
function slotsPerformed(slots: readonly string[], sets: readonly PlanHistorySetRowV2[]): boolean | null {
  if (slots.length === 0) return null;
  const bySlot = new Map<string, PlanHistorySetRowV2>();
  for (const row of active(sets)) {
    if (row.prescription_item_id === null) continue;
    const key = `${row.prescription_item_id.toLowerCase()}#${row.set_number}`;
    if (bySlot.has(key)) return null;
    bySlot.set(key, row);
  }
  return slots.every((slot) => bySlot.get(slot)?.done === true);
}

const itemsOf = (structure: Record<string, unknown>, roles: readonly string[]) =>
  (Array.isArray(structure.blocks) ? structure.blocks : []).filter((b) => isObject(b) && roles.includes(String(b.role))).flatMap((b) => (Array.isArray((b as { items?: unknown }).items) ? ((b as { items: unknown[] }).items) : []));

/** PARTIAL-01's rule on the persisted prescription: Force (every work set) or DH (every pass of the one main drill). */
export function realisationV2(structure: unknown, sets: readonly PlanHistorySetRowV2[]): "complete" | "partial" | null {
  if (!isObject(structure)) return null;
  let slots: string[] | null = null;
  if (structure.family === "strength" && STRENGTH_SESSION_KINDS.includes(String(structure.sessionKind))) {
    slots = itemsOf(structure, ["main", "complementary"])
      .filter((i): i is Record<string, unknown> => isObject(i) && i.kind === "exercise")
      .flatMap((i) => {
        const count = Number.isInteger(i.sets) && (i.sets as number) > 0 ? (i.sets as number) : 0;
        return Array.from({ length: count }, (_, n) => `${String(i.prescriptionItemId).toLowerCase()}#${n + 1}`);
      });
  } else if (structure.family === "dh_technical") {
    const main = itemsOf(structure, ["main"]);
    const drill = main.length === 1 && isObject(main[0]) && main[0].kind === "drill" ? main[0] : null;
    const count = drill && isObject(drill.measure) && drill.measure.type === "pass" && Number.isInteger(drill.measure.count) && (drill.measure.count as number) > 0 ? (drill.measure.count as number) : 0;
    slots = drill ? Array.from({ length: count }, (_, n) => `${String(drill.prescriptionItemId).toLowerCase()}#${n + 1}`) : [];
  }
  if (slots === null) return null;
  const performed = slotsPerformed(slots, sets);
  return performed === null ? null : performed ? "complete" : "partial";
}

/** The decided effective duration of the execution's OWN decision (A07), or 0. */
function decidedMinutes(decision: PlanHistoryDecisionRowV2 | undefined): number {
  const plan = decision?.daily_plan;
  const minutes = isObject(plan) && isObject(plan.final_session) ? plan.final_session.duration_min : undefined;
  return Number.isInteger(minutes) && (minutes as number) > 0 ? (minutes as number) : 0;
}

/** A health signal covers `date`: open from its first day; closed through its resolution day; inconsistent dates or a closed signal without resolution day → the whole window. */
function coveredByHealth(date: string, flags: readonly PlanHistoryHealthFlagRowV2[]): boolean {
  return flags.some((f) => {
    const open = f.status === "active" || f.status === "monitoring";
    if (!open && (f.resolved_at === null || f.resolved_at < f.flag_date)) return true;
    if (f.flag_date > date) return false;
    return open || date <= f.resolved_at!;
  });
}

/** The explicit, verifiable evidence a « Non réalisée » needs to count as a missed session; the first missing one is returned. */
function missedEvidence(date: string, today: string, debrief: PlanHistoryDebriefRowV2, facts: PlanHistoryFactsV2): string | null {
  if (date >= today) return "not_past";
  if (debrief.change_reason === null || !ELIGIBLE_MISSED_REASONS_V2.includes(debrief.change_reason)) return "reason_not_eligible";
  if (debrief.new_pain === true) return "new_pain";
  const decisions = facts.decisions.filter((d) => d.decision_date === date).sort(byCreation);
  const latest = decisions[0];
  if (!latest || !isObject(latest.daily_plan)) return "no_decision";
  const plan = latest.daily_plan;
  const kind = isObject(plan.final_session) ? plan.final_session.kind : undefined;
  if (plan.decision === "REST" || typeof kind !== "string" || NON_TRAINING_KINDS.includes(kind)) return "no_training_due";
  const safety = decisions.some((d) => !isObject(d.daily_plan) || (Array.isArray(d.daily_plan.triggered_rules) && d.daily_plan.triggered_rules.some((r) => isObject(r) && r.layer === "A")));
  if (safety) return "safety_rule";
  const checkin = facts.checkins.find((c) => c.checkin_date === date);
  if (!checkin || checkin.pain !== false || checkin.fever_or_illness !== false || checkin.suspected_concussion !== false) return "health_not_cleared";
  if (coveredByHealth(date, facts.healthFlags)) return "health_signal";
  return null;
}

function guidedMinutes(execution: PlanHistoryExecutionRowV2, facts: PlanHistoryFactsV2): { family: string | null; realisation: "complete" | "partial" | null; minutes: number } {
  const structure = facts.prescriptions.find((p) => p.id === execution.final_prescription_id)?.structure;
  const family = isObject(structure) && typeof structure.family === "string" ? structure.family : null;
  if (family === "endurance") {
    const activities = active(facts.activities.filter((a) => a.execution_id === execution.id));
    const minutes = activities.length === 1 && Number.isInteger(activities[0]!.duration_seconds) && activities[0]!.duration_seconds > 0 ? Math.floor(activities[0]!.duration_seconds / 60) : 0;
    return { family, realisation: null, minutes };
  }
  const realisation = realisationV2(structure, facts.sets.filter((s) => s.execution_id === execution.id));
  const decision = facts.decisions.find((d) => d.id === execution.decision_id);
  return { family, realisation, minutes: realisation === "complete" ? decidedMinutes(decision) : 0 };
}

export function planHistoryV2(facts: PlanHistoryFactsV2, today: string): PlanHistoryV2 {
  const days: PlanHistoryDayV2[] = [];
  for (let offset = PROVISIONAL_THRESHOLDS.recentLoad.windowDays; offset >= 0; offset -= 1) {
    const date = addDays(today, -offset);
    const debrief = facts.debriefs.find((r) => r.session_date === date);
    if (debrief && PERFORMED_DEBRIEF.includes(debrief.completion_status)) {
      days.push({ date, fact: "debrief_performed", minutes: Number.isInteger(debrief.actual_duration_min) && debrief.actual_duration_min! > 0 ? debrief.actual_duration_min! : 0 });
      continue;
    }
    const completed = facts.executions
      .filter((e) => e.session_date === date && e.events.includes("completed"))
      .sort((a, b) => a.started_at.localeCompare(b.started_at) || a.id.localeCompare(b.id))[0];
    if (completed) {
      days.push({ date, fact: "guided_completed", ...guidedMinutes(completed, facts) });
      continue;
    }
    if (debrief && debrief.completion_status === "skipped") {
      const why = missedEvidence(date, today, debrief, facts);
      days.push({ date, fact: "debrief_skipped", missed: why === null, why: why ?? "missed" });
      continue;
    }
    days.push({ date, fact: "none" });
  }
  return {
    trailingVolumeMinutes: days.reduce((n, d) => n + ("minutes" in d ? d.minutes : 0), 0),
    recentMissedOrReplacedCount: days.filter((d) => d.fact === "debrief_skipped" && d.missed).length,
    days,
  };
}
