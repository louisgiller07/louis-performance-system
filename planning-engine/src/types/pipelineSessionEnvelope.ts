/**
 * PipelineSessionEnvelope (V0.4_113B) — pure data-transport contract for
 * the future pipeline orchestrator (not built). Carries a session's stable
 * identity (date, domain, kind) alongside whatever payload the current
 * pipeline stage has computed. No logic lives here — see V0.4_113A for
 * why: each pure pipeline module (SessionKindAssignment, LoadDerivation,
 * HistoryAdjuster) keeps its own narrow input/output exactly as already
 * designed and built, never importing this type — only the future
 * orchestrator threads it between stage calls.
 *
 * Deliberately does not carry loadProfile/durationMin/doseTarget directly
 * (those belong in `payload`, whatever shape the current stage produces),
 * nor template/weekType/recentHistory/equipment/availability/lockedDates
 * (week-level orchestration context, never part of the per-session
 * envelope — see V0.4_113A's own distinction between per-session and
 * week-level data).
 *
 * `domain: SessionDomain` is imported from pipeline/weekSegmenter.ts, not
 * from ./sharedVocabulary.ts — SessionDomain's placement there (rather
 * than alongside SessionKind, where it conceptually belongs) was already
 * flagged as a known architectural gap in V0.4_113/113A and is
 * deliberately not corrected by this ticket. This file reuses the same
 * types/ -> pipeline/ import direction already introduced by
 * types/planVersion.ts (V0.4_112A) for RelaxedConstraint.domain — not a
 * new pattern, the same one reused.
 */
import type { SessionDomain } from "../pipeline/weekSegmenter.js";
import type { SessionKind } from "./sharedVocabulary.js";

export interface PipelineSessionEnvelope<T> {
  date: string; // ISO date
  domain: SessionDomain;
  kind: SessionKind;
  payload: T;
}
