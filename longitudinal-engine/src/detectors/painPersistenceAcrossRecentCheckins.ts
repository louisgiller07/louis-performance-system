/**
 * M5_006C — pure, deterministic pain-persistence detector. Answers only
 * "is the same-location pain still reported at the next OBSERVED checkin,
 * at most 3 calendar days later" — never claims continuous pain across
 * missing dates, never causal, never a coaching recommendation, never a
 * pattern/aggregate (reserved for M5_006D). See docs/11_DECISION_LOG.md
 * (M5_006C) for the full design record.
 *
 * No Supabase, no network, no filesystem, no process env, no Date.now(),
 * no randomness, no mutable global state — same purity boundary as
 * calculators/**, relations/**, and every other detectors/** module.
 *
 * ===========================================================================
 * Consumption boundary
 * ===========================================================================
 * Consumes ONLY: the evaluation checkin's id/checkinDate/pain/painIntensity/
 * painNew/painLocationCode, plus the SAME five fields on whichever single
 * previous checkin (C-1, C-2, or C-3) is selected. Never reads
 * painTraumatic/painFunctionLoss/painGettingWorse/suspectedConcussion/
 * feverOrIllness, never sleepHours/sleepQuality/energy/workStress/
 * motivation/legFatigue/gripFatigue, never decisions/completed_sessions/
 * decision_outcomes/health_flags — see the detector's own test suite's
 * zero-consumption proofs. Safety (A1-A5) remains entirely separate and
 * frozen; this detector never derives a second-order signal from the same
 * pain checkin that Safety already reads.
 */
import type { AthleteDay, AthleteTimeline } from "../timeline/types.js";
import type { DailyCheckinSource } from "../types/sources.js";
import { MS_PER_DAY, formatUtcMs, materializeDateRange, parseCanonicalDateUtc } from "../timeline/range.js";
import { resolveUniqueDay } from "../relations/index.js";
import { CheckinNotFoundInTimelineError, DuplicateCheckinDateError, InsufficientTimelineCoverageError } from "./sleepEnergyErrors.js";
import { InconsistentPainStateError } from "./painPersistenceErrors.js";
import {
  PAIN_PERSISTENCE_LOOKBACK_DAYS,
  PAIN_PERSISTENCE_RULE_ID as RULE_ID,
  PAIN_PERSISTENCE_RULE_VERSION as RULE_VERSION,
} from "./painPersistenceConstants.js";
import type { DetectorEventType, PainPersistenceAmbiguityReason, PainPersistenceDetection, PainPersistenceTransitionKind } from "./painPersistenceTypes.js";

export interface DetectPainPersistenceAcrossRecentCheckinsInput {
  readonly timeline: AthleteTimeline;
  readonly evaluationCheckinId: string;
}

/** Reads exactly one calendar day's checkin, enforcing the duplicate-date invariant (0=absent, 1=valid, >1=DuplicateCheckinDateError). */
function readSingleCheckin(timeline: AthleteTimeline, date: string): DailyCheckinSource | null {
  const day: AthleteDay = resolveUniqueDay(timeline, date);
  if (day.checkins.length > 1) {
    throw new DuplicateCheckinDateError(date, day.checkins.length);
  }
  return day.checkins.length === 1 ? day.checkins[0]! : null;
}

/**
 * Validates the real DB's pain<=>intensity invariant — never
 * normalizes/coerces, only rejects. The real column is PostgreSQL INTEGER
 * in [0,10]: `painIntensity < 0`/`> 10` alone would silently accept `NaN`
 * (both comparisons are false for NaN) and any non-integer finite value
 * (e.g. 4.5, which a real INTEGER column can never hold) — `Number.isFinite`
 * and `Number.isInteger` close both gaps explicitly, never by rounding or
 * coercing the value itself.
 */
function assertConsistentPainState(checkin: DailyCheckinSource): void {
  const { id, pain, painIntensity } = checkin;
  if (pain === false && painIntensity !== null) {
    throw new InconsistentPainStateError(id, pain, painIntensity);
  }
  if (
    pain === true &&
    (painIntensity === null || !Number.isFinite(painIntensity) || !Number.isInteger(painIntensity) || painIntensity < 0 || painIntensity > 10)
  ) {
    throw new InconsistentPainStateError(id, pain, painIntensity);
  }
}

function bothLocationsEqual(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a === b;
}

function bothLocationsDiffer(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a !== b;
}

export function detectPainPersistenceAcrossRecentCheckins(input: DetectPainPersistenceAcrossRecentCheckinsInput): PainPersistenceDetection {
  const { timeline, evaluationCheckinId } = input;

  // Locate C — the only place this detector searches by id rather than by
  // date; every subsequent lookup is date-keyed via readSingleCheckin.
  let candidateDate: string | null = null;
  for (const day of timeline.days) {
    if (day.checkins.some((c) => c.id === evaluationCheckinId)) {
      candidateDate = day.date;
      break;
    }
  }
  if (candidateDate === null) {
    throw new CheckinNotFoundInTimelineError(evaluationCheckinId);
  }

  const candidateMs = parseCanonicalDateUtc(candidateDate, "evaluationCheckin.checkinDate");
  const windowStartDate = formatUtcMs(candidateMs - PAIN_PERSISTENCE_LOOKBACK_DAYS * MS_PER_DAY);

  // Coverage — checked BEFORE any previous-checkin/density logic, and
  // BEFORE materializing the consumed date range.
  if (timeline.range.fromDate > windowStartDate || timeline.range.toDate < candidateDate) {
    throw new InsufficientTimelineCoverageError(windowStartDate, candidateDate, timeline.range.fromDate, timeline.range.toDate);
  }

  // Duplicate-date invariant across the full consumed [C-3, C] range (4 dates).
  const consumedDates = materializeDateRange({ fromDate: windowStartDate, toDate: candidateDate });
  const checkinByDate = new Map<string, DailyCheckinSource | null>();
  for (const date of consumedDates) {
    checkinByDate.set(date, readSingleCheckin(timeline, date));
  }

  const candidate = checkinByDate.get(candidateDate)!;
  if (candidate === null || candidate.id !== evaluationCheckinId) {
    // Structurally unreachable against a well-formed timeline — defense in depth.
    throw new CheckinNotFoundInTimelineError(evaluationCheckinId);
  }
  assertConsistentPainState(candidate);

  const evaluationKey = `checkin:${candidate.id}:pain-persistence`;
  const evidenceKey = evaluationKey;

  // Previous-checkin search: C-1, then C-2, then C-3, in that exact order —
  // the FIRST present one wins; no checkin older than C-3 is ever consumed.
  let previous: DailyCheckinSource | null = null;
  for (let offset = 1; offset <= PAIN_PERSISTENCE_LOOKBACK_DAYS; offset++) {
    const date = formatUtcMs(candidateMs - offset * MS_PER_DAY);
    const row = checkinByDate.get(date)!;
    if (row !== null) {
      previous = row;
      break;
    }
  }

  if (previous === null) {
    return {
      kind: "no_evidence",
      detectorRuleId: RULE_ID,
      detectorRuleVersion: RULE_VERSION,
      evaluationKey,
      evidenceKey,
      eventDate: candidateDate,
      evaluationCheckinId: candidate.id,
      previousCheckinId: null,
      previousCheckinDate: null,
      reason: "no_recent_prior_checkin",
    };
  }
  assertConsistentPainState(previous);

  if (previous.pain === false) {
    return {
      kind: "no_evidence",
      detectorRuleId: RULE_ID,
      detectorRuleVersion: RULE_VERSION,
      evaluationKey,
      evidenceKey,
      eventDate: candidateDate,
      evaluationCheckinId: candidate.id,
      previousCheckinId: previous.id,
      previousCheckinDate: previous.checkinDate,
      reason: "prior_checkin_has_no_pain",
    };
  }

  // previous.pain === true from here on — always Evidence.
  let eventType: DetectorEventType;
  let transitionKind: PainPersistenceTransitionKind;
  const ambiguityReasons: PainPersistenceAmbiguityReason[] = [];

  if (candidate.pain === false) {
    eventType = "contradicting";
    transitionKind = "resolved";
  } else if (bothLocationsEqual(previous.painLocationCode, candidate.painLocationCode)) {
    transitionKind = "same_location_continuation";
    if (candidate.painNew === false) {
      eventType = "supporting";
    } else if (candidate.painNew === true) {
      eventType = "neutral";
      ambiguityReasons.push("current_marked_new");
    } else {
      eventType = "neutral";
      ambiguityReasons.push("current_pain_new_unknown");
    }
  } else if (bothLocationsDiffer(previous.painLocationCode, candidate.painLocationCode)) {
    eventType = "neutral";
    transitionKind = "different_location";
  } else {
    eventType = "neutral";
    transitionKind = "location_unknown";
  }

  const evaluationPainIntensity = candidate.pain ? candidate.painIntensity : null;
  const intensityDelta = candidate.pain && evaluationPainIntensity !== null ? evaluationPainIntensity - previous.painIntensity! : null;

  const gapDays = Math.round((parseCanonicalDateUtc(candidateDate, "candidateDate") - parseCanonicalDateUtc(previous.checkinDate, "previous.checkinDate")) / MS_PER_DAY);

  return {
    kind: "evidence",
    detectorRuleId: RULE_ID,
    detectorRuleVersion: RULE_VERSION,
    evaluationKey,
    evidenceKey,
    eventType,
    eventDate: candidateDate,
    observedValue: {
      evaluationCheckinId: candidate.id,
      evaluationCheckinDate: candidateDate,
      previousCheckinId: previous.id,
      previousCheckinDate: previous.checkinDate,
      gapDays,
      previousPain: previous.pain,
      evaluationPain: candidate.pain,
      previousPainLocationCode: previous.painLocationCode,
      evaluationPainLocationCode: candidate.painLocationCode,
      previousPainIntensity: previous.painIntensity,
      evaluationPainIntensity,
      intensityDelta,
      evaluationPainNew: candidate.painNew,
      transitionKind,
      ambiguityReasons,
    },
    sourceRefs: {
      evaluationCheckinId: candidate.id,
      previousCheckinId: previous.id,
    },
  };
}
