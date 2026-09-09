import type { TrainingIntervention, TrainingInterventionKind, LoadProfile } from "../types/trainingIntervention.js";
import type { TriggeredRule } from "../types/triggeredRule.js";
import {
  DH_DURATION_MIN,
  DH_GENERIC_FOCUS,
  DH_GENERIC_EXECUTION_TASK,
  DH_LOAD_GUIDANCE,
  DH_FATIGUE_MONITORING_NOTE,
  DH_IMMEDIATE_PAIN_MONITORING_NOTE,
} from "../config/sessionPrescriptionPolicy.js";

/**
 * Session Prescription V1 — DH-first (V0.3_006B). Pure helpers deriving an
 * executable prescription from the already-authoritative structures
 * (`final_session`, `dh_or_technical`, `mental`, `monitoring`) — no new
 * `DailyPlan` field, no duplicate source of truth. Must always be applied
 * to the FULLY arbitrated final session (after training-domain rules, pain,
 * soft constraints, and the A5 ZERO_DH swap) — never a baseline/planned/
 * pre-adaptation intervention, so a Safety override or a fatigue/pain
 * downgrade is always reflected, never a stale prescription.
 */

type DhKind = keyof typeof DH_DURATION_MIN;

const DH_FAMILY_KINDS: ReadonlySet<TrainingInterventionKind> = new Set(Object.keys(DH_DURATION_MIN) as DhKind[]);

export function isDhFamilyKind(kind: TrainingInterventionKind): kind is DhKind {
  return DH_FAMILY_KINDS.has(kind);
}

/**
 * Resolved DH technical focus — the athlete's configured
 * `technique_primary_focus` takes precedence; a fixed generic fallback is
 * used only when absent, never presented as learned personalization.
 * `undefined` for a non-DH-family kind (e.g. after a Safety A5 swap to
 * `RECOVERY_ACTIVE`, or A1's REST) — the caller must never fabricate a
 * focus for a session that isn't DH-family.
 */
export function resolveDhFocus(kind: TrainingInterventionKind, personalFocus: string | undefined): string | undefined {
  if (!isDhFamilyKind(kind)) return undefined;
  return personalFocus ?? DH_GENERIC_FOCUS[kind];
}

/**
 * V0.3_006C1 — the paired "how to work on it today" for `resolveDhFocus`.
 * Populated ONLY when the generic fallback path was taken (`personalFocus`
 * absent) — never derived from an athlete's arbitrary personal
 * `technique_primary_focus` free text, which cannot be turned into a
 * concrete observable task deterministically without an LLM. `focus` =
 * what is being worked on; `execution_task` = how. `undefined` for a
 * non-DH-family kind or whenever a personal focus is configured.
 */
export function resolveDhExecutionTask(kind: TrainingInterventionKind, personalFocus: string | undefined): string | undefined {
  if (!isDhFamilyKind(kind) || personalFocus !== undefined) return undefined;
  return DH_GENERIC_EXECUTION_TASK[kind];
}

/**
 * V0.3_006C1 (final correction) — deterministic riding-behavior guidance for
 * the FINAL `load_profile`. Substantive coaching prescription, so it must be
 * derived from the fully arbitrated final session (never the planned/
 * pre-adaptation one) exactly like `resolveDhFocus`/`resolveDhExecutionTask`.
 * `undefined` for a non-DH-family kind (e.g. after a Safety A5 swap to
 * `RECOVERY_ACTIVE`, or A1's REST) or when `loadProfile` is absent.
 */
export function resolveDhLoadGuidance(kind: TrainingInterventionKind, loadProfile: LoadProfile | undefined): string | undefined {
  if (!isDhFamilyKind(kind) || loadProfile === undefined) return undefined;
  return DH_LOAD_GUIDANCE[loadProfile];
}

/**
 * Resolved DH duration (minutes) — the approximate total session window,
 * not continuous riding time (see sessionPrescriptionPolicy.ts).
 *
 * Precedence (V0.3_006B, corrected):
 *  - No explicit `planned_session.duration_min` at all -> the provisional
 *    default for the FINAL kind/load combination.
 *  - Explicit duration present AND arbitration left kind/load completely
 *    unchanged from what was planned (a true KEEP) -> the explicit value,
 *    exactly, however it compares to the provisional table (full trust: the
 *    athlete stated what they're actually doing and nothing adapted it).
 *  - Explicit duration present AND arbitration changed kind and/or load ->
 *    MIN(explicit duration, provisional default for the final kind/load).
 *    The explicit duration becomes an UPPER BOUND once the coach has
 *    reduced the session — an adaptation that's supposed to reduce training
 *    demand must never silently lengthen a shorter athlete-constrained
 *    session up to a longer generic default (e.g. planned
 *    DH_PERFORMANCE/HEAVY/120min downgraded to MODERATE must stay 120, not
 *    balloon to the generic 270). It is never treated as a minimum/floor.
 *
 * `undefined` for a non-DH-family final kind (e.g. after a Safety A5 swap to
 * `RECOVERY_ACTIVE`, or A1's REST) regardless of any explicit planned value.
 */
export function resolveDhDuration(finalSession: TrainingIntervention, plannedSessionRaw: TrainingIntervention | null): number | undefined {
  if (!isDhFamilyKind(finalSession.kind) || finalSession.load_profile === undefined) return undefined;

  const provisional = DH_DURATION_MIN[finalSession.kind][finalSession.load_profile];
  const explicit = plannedSessionRaw !== null && typeof plannedSessionRaw.duration_min === "number" ? plannedSessionRaw.duration_min : undefined;
  if (explicit === undefined) return provisional;

  const unchangedFromPlanned = plannedSessionRaw!.kind === finalSession.kind && plannedSessionRaw!.load_profile === finalSession.load_profile;
  return unchangedFromPlanned ? explicit : Math.min(explicit, provisional);
}

/**
 * Returns `finalSession` with `duration_min` resolved per
 * {@link resolveDhDuration} — a plain passthrough for a non-DH-family kind
 * (never adds/removes fields on a non-DH session).
 */
export function withDhDuration(finalSession: TrainingIntervention, plannedSessionRaw: TrainingIntervention | null): TrainingIntervention {
  const duration_min = resolveDhDuration(finalSession, plannedSessionRaw);
  if (duration_min === undefined) return finalSession;
  return { ...finalSession, duration_min };
}

const FATIGUE_RULE_IDS: ReadonlySet<string> = new Set(["C3.3", "C3.5", "C3.6"]);

/**
 * `DH_FATIGUE_MONITORING_NOTE` when the final session is DH-family AND at
 * least one fatigue-driven training-domain rule (C3.3 systemic / C3.5 grip /
 * C3.6 legs) actually fired this run — `undefined` otherwise. Deliberately
 * a single fixed sentence regardless of how many fatigue rules fired (never
 * a duplicate warning).
 */
export function resolveDhFatigueMonitoringNote(finalSessionKind: TrainingInterventionKind, triggeredRules: readonly TriggeredRule[]): string | undefined {
  if (!isDhFamilyKind(finalSessionKind)) return undefined;
  const fatigueRuleFired = triggeredRules.some((rule) => FATIGUE_RULE_IDS.has(rule.rule_id));
  return fatigueRuleFired ? DH_FATIGUE_MONITORING_NOTE : undefined;
}

/**
 * V0.3_006C1 — `DH_IMMEDIATE_PAIN_MONITORING_NOTE` when non-Safety pain
 * (PAIN_NON_SAFETY) applied this run AND the final session remains
 * DH-family — `undefined` otherwise. Deliberately gated on "pain applied"
 * rather than "pain solicited this exact session": a declared pain while
 * riding DH deserves an interruption criterion even for an unclassified
 * ("other") location, which is the conservative choice. Additive to, never
 * a replacement for, the existing 24-48h post-session monitoring already
 * produced by evaluatePainNonSafety.
 */
export function resolveDhImmediatePainMonitoringNote(finalSessionKind: TrainingInterventionKind, painApplies: boolean): string | undefined {
  if (!isDhFamilyKind(finalSessionKind) || !painApplies) return undefined;
  return DH_IMMEDIATE_PAIN_MONITORING_NOTE;
}
