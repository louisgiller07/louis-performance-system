/**
 * V0.3_008B — Technical Continuity V1. Pure resolver, no I/O: given the
 * bounded `completed_sessions` technical candidates (newest first,
 * `completedSessionsRepo.ts#getRecentTechnicalCandidates`) and the batched
 * `decisions` rows they claim to link to (`decisionsRepo.ts#getDecisionsByIds`),
 * resolves the single most-recent VALID technical fact.
 *
 * The newest candidate row does NOT automatically win — only the newest
 * candidate that resolves CLEANLY does. A malformed newest candidate
 * (unlinked/mismatched decision, missing `execution_task`, invalid
 * kind/outcome) is skipped in favor of the next-older bounded candidate,
 * never treated as "no context" outright — see docs/11_DECISION_LOG.md
 * V0.3_008B.
 *
 * Every skip case enumerated explicitly (never a generic try/catch):
 * `completion_status` not DONE/PARTIAL (defensive re-verification — the
 * normal V0.3_007C write contract already guarantees `technical_outcome`
 * is non-null only for those two statuses, but this reads via the
 * privileged admin client with no RLS, so a malformed historical row, e.g.
 * REPLACED with a stray non-null `technical_outcome`, must never be
 * silently accepted on DB-filter trust alone), decision missing from the
 * batch, `decision.decision_date !== candidate.session_date` (defensive
 * date-consistency check — the canonical `completed-session` write path
 * already guarantees this, this only covers legacy/malformed/unexpected
 * privileged data), missing/empty `execution_task` on the linked decision
 * (real case for any decision predating V0.3_008B0), `intervention.kind`
 * absent or not DH-family, `technical_outcome` outside `"yes" | "partial" |
 * "no"`.
 */
import type { CompletedSessionRawRow } from "../repositories/completedSessionsRepo.js";
import type { DecisionRawRow } from "../repositories/decisionsRepo.js";
import type { RecentTechnicalContext } from "../../types/rawContext.js";
import type { TrainingInterventionKind } from "../../types/trainingIntervention.js";
import { isDhFamilyKind } from "../../domains/dhPrescription.js";

const VALID_OUTCOMES: ReadonlySet<string> = new Set(["yes", "partial", "no"]);
const VALID_COMPLETION_STATUSES: ReadonlySet<string> = new Set(["done", "partial"]);

function toUtcDays(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year as number, (month as number) - 1, day as number) / 86_400_000;
}

/** Whole calendar days between two ISO dates (b − a) — never elapsed-millisecond/hour arithmetic, so timezone/DST never shifts eligibility. */
function daysBetween(a: string, b: string): number {
  return toUtcDays(b) - toUtcDays(a);
}

function extractExecutionTask(dailyPlan: unknown): string | undefined {
  if (typeof dailyPlan !== "object" || dailyPlan === null) return undefined;
  const dh = (dailyPlan as Record<string, unknown>).dh_or_technical;
  if (typeof dh !== "object" || dh === null) return undefined;
  const task = (dh as Record<string, unknown>).execution_task;
  return typeof task === "string" && task.trim().length > 0 ? task : undefined;
}

function extractDhFamilyKind(intervention: unknown): TrainingInterventionKind | undefined {
  if (typeof intervention !== "object" || intervention === null) return undefined;
  const kind = (intervention as Record<string, unknown>).kind;
  if (typeof kind !== "string") return undefined;
  return isDhFamilyKind(kind as TrainingInterventionKind) ? (kind as TrainingInterventionKind) : undefined;
}

/**
 * Returns `undefined` (never `null`, matching every other optional
 * `RawContext` field) when no candidate in the bounded window resolves
 * cleanly — including when `candidates` is empty.
 */
export function resolveRecentTechnicalContext(
  candidates: readonly CompletedSessionRawRow[],
  decisionsById: ReadonlyMap<string, DecisionRawRow>,
  today: string
): RecentTechnicalContext | undefined {
  for (const candidate of candidates) {
    const decisionId = candidate.decision_id;
    const sessionDate = candidate.session_date;
    const outcome = candidate.technical_outcome;
    const completionStatus = candidate.completion_status;
    if (typeof decisionId !== "string" || typeof sessionDate !== "string") continue;
    if (typeof completionStatus !== "string" || !VALID_COMPLETION_STATUSES.has(completionStatus)) continue;
    if (typeof outcome !== "string" || !VALID_OUTCOMES.has(outcome)) continue;

    const decision = decisionsById.get(decisionId);
    if (!decision) continue;
    if (decision.decision_date !== sessionDate) continue; // defensive date-consistency check

    const execution_task = extractExecutionTask(decision.daily_plan);
    if (execution_task === undefined) continue;

    const kind = extractDhFamilyKind(candidate.intervention);
    if (kind === undefined) continue;

    return {
      source_decision_id: decisionId,
      session_date: sessionDate,
      kind,
      execution_task,
      technical_outcome: outcome as "yes" | "partial" | "no",
      age_days: daysBetween(sessionDate, today),
    };
  }
  return undefined;
}
