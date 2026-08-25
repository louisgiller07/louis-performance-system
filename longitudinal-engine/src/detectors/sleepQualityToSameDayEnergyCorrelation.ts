/**
 * M5_006B — pure, deterministic same-day sleep-quality/energy correlation
 * detector. Answers only "does this candidate day's own sleepQuality/energy
 * pairing sit at matching or opposing extremes of this athlete's own
 * 60-day baseline distribution" — a descriptive correlation only, never
 * causal, never a coaching recommendation, never a pattern/aggregate
 * (reserved for M5_006D). See docs/11_DECISION_LOG.md (M5_006B) for the
 * full design record.
 *
 * No Supabase, no network, no filesystem, no process env, no Date.now(),
 * no randomness, no mutable global state — same purity boundary as
 * calculators/**, relations/**, and detectors/recommendationVsActualExecution.ts.
 *
 * ===========================================================================
 * Temporal semantics — LOCKED, no next-day lookup of any kind
 * ===========================================================================
 * sleepQuality on date D = the sleep immediately preceding D (i.e. the
 * value already stored on that day's own checkin row — the DB schema
 * already encodes "last night's sleep" as part of day D's checkin, there is
 * no separate "sleep date" column to look up). energy on date D = the
 * energy experienced during D. The observation is therefore simply
 * `C.sleepQuality <-> C.energy` on the SAME checkin row — never a
 * next-day/previous-day cross-reference of any kind.
 *
 * ===========================================================================
 * Consumption boundary
 * ===========================================================================
 * Consumes ONLY: the candidate checkin's id/checkinDate/sleepQuality/
 * energy/feverOrIllness/suspectedConcussion, plus the SAME five fields on
 * every checkin in the 60-day baseline window. workStress is explicitly
 * NEVER read (see the detector's own test suite's zero-consumption proof).
 */
import type { AthleteDay, AthleteTimeline } from "../timeline/types.js";
import type { DailyCheckinSource } from "../types/sources.js";
import { MS_PER_DAY, formatUtcMs, materializeDateRange, parseCanonicalDateUtc } from "../timeline/range.js";
import { resolveUniqueDay } from "../relations/index.js";
import { CheckinNotFoundInTimelineError, DuplicateCheckinDateError, InsufficientTimelineCoverageError } from "./sleepEnergyErrors.js";
import {
  SLEEP_ENERGY_BASELINE_WINDOW_DAYS,
  SLEEP_ENERGY_MIN_BASELINE_DISTINCT_VALUES,
  SLEEP_ENERGY_MIN_BASELINE_OBSERVATIONS,
  SLEEP_ENERGY_RANKING_METHOD,
  SLEEP_ENERGY_RULE_ID as RULE_ID,
  SLEEP_ENERGY_RULE_VERSION as RULE_VERSION,
} from "./sleepEnergyConstants.js";
import type { DetectorEventType, RatingHistogram, SleepEnergyBucket, SleepEnergyConfounderReason, SleepEnergyDetection } from "./sleepEnergyTypes.js";

export interface DetectSleepQualityToSameDayEnergyCorrelationInput {
  readonly timeline: AthleteTimeline;
  readonly evaluationCheckinId: string;
}

/** Reads exactly one calendar day's checkin, enforcing the duplicate-date invariant (0=absent, 1=valid, >1=DuplicateCheckinDateError) — the real DB's UNIQUE(athlete_id, checkin_date) means >1 only happens against a malformed synthetic timeline. */
function readSingleCheckin(timeline: AthleteTimeline, date: string): DailyCheckinSource | null {
  const day: AthleteDay = resolveUniqueDay(timeline, date);
  if (day.checkins.length > 1) {
    throw new DuplicateCheckinDateError(date, day.checkins.length);
  }
  return day.checkins.length === 1 ? day.checkins[0]! : null;
}

function emptyHistogram(): number[] {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
}

/**
 * Empirical midrank percentile (B7 lock, empirical_midrank_v1): for
 * candidate value v against baseline values, L = count strictly below v,
 * E = count equal to v, N = baseline size; percentile = (L + 0.5*E) / N.
 * Raw JS numeric result — no rounding, never collapsed to a coarser
 * discrete rank (e.g. R7) that would misclassify ties like the locked
 * 15x7+6x8 regression example.
 */
function empiricalMidrankPercentile(candidate: number, baseline: readonly number[]): number {
  let below = 0;
  let equal = 0;
  for (const v of baseline) {
    if (v < candidate) below++;
    else if (v === candidate) equal++;
  }
  return (below + 0.5 * equal) / baseline.length;
}

function bucketFromPercentile(p: number): SleepEnergyBucket {
  if (p < 0.2) return "Q1";
  if (p < 0.4) return "Q2";
  if (p < 0.6) return "Q3";
  if (p < 0.8) return "Q4";
  return "Q5";
}

type BucketCategory = "bottom" | "middle" | "top";

function bucketCategory(bucket: SleepEnergyBucket): BucketCategory {
  if (bucket === "Q1" || bucket === "Q2") return "bottom";
  if (bucket === "Q3") return "middle";
  return "top";
}

/** Classification matrix (B8 lock, exact, all 25 Q x Q cells): any Q3 -> neutral; bottom+bottom / top+top -> supporting; bottom+top (either order) -> contradicting. */
function classify(sleepBucket: SleepEnergyBucket, energyBucket: SleepEnergyBucket): DetectorEventType {
  const sleepCat = bucketCategory(sleepBucket);
  const energyCat = bucketCategory(energyBucket);
  if (sleepCat === "middle" || energyCat === "middle") return "neutral";
  return sleepCat === energyCat ? "supporting" : "contradicting";
}

function buildHistogram(values: readonly number[]): RatingHistogram {
  const bins = emptyHistogram();
  for (const v of values) {
    bins[v]!++;
  }
  return bins as unknown as RatingHistogram;
}

function distinctCount(values: readonly number[]): number {
  return new Set(values).size;
}

export function detectSleepQualityToSameDayEnergyCorrelation(input: DetectSleepQualityToSameDayEnergyCorrelationInput): SleepEnergyDetection {
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
  const baselineStartDate = formatUtcMs(candidateMs - SLEEP_ENERGY_BASELINE_WINDOW_DAYS * MS_PER_DAY);
  const baselineEndDate = formatUtcMs(candidateMs - 1 * MS_PER_DAY);

  // Coverage — checked BEFORE any baseline density/variance logic, and
  // BEFORE materializing the consumed date range (which would otherwise
  // throw a misleading InconsistentTimelineDayError for a date genuinely
  // outside the supplied timeline, rather than this detector's own,
  // clearer contract violation).
  if (timeline.range.fromDate > baselineStartDate || timeline.range.toDate < candidateDate) {
    throw new InsufficientTimelineCoverageError(baselineStartDate, candidateDate, timeline.range.fromDate, timeline.range.toDate);
  }

  // Duplicate-date invariant + candidate lookup, over the full consumed
  // [C-60, C] range in one sweep (61 dates).
  const consumedDates = materializeDateRange({ fromDate: baselineStartDate, toDate: candidateDate });
  const checkinByDate = new Map<string, DailyCheckinSource | null>();
  for (const date of consumedDates) {
    checkinByDate.set(date, readSingleCheckin(timeline, date));
  }

  const candidate = checkinByDate.get(candidateDate)!;
  if (candidate === null || candidate.id !== evaluationCheckinId) {
    // Structurally unreachable against a well-formed timeline (the day
    // lookup above found this exact id on this exact date) — kept as
    // defense in depth, same philosophy as every other belt-and-suspenders
    // check in this package.
    throw new CheckinNotFoundInTimelineError(evaluationCheckinId);
  }

  const evaluationKey = `checkin:${candidate.id}:sleep-energy`;
  const evidenceKey = evaluationKey;

  if (candidate.sleepQuality === null) {
    return {
      kind: "no_evidence",
      detectorRuleId: RULE_ID,
      detectorRuleVersion: RULE_VERSION,
      evaluationKey,
      evidenceKey,
      eventDate: candidateDate,
      evaluationCheckinId: candidate.id,
      reason: "evaluation_checkin_missing_sleep_quality",
    };
  }
  if (candidate.energy === null) {
    return {
      kind: "no_evidence",
      detectorRuleId: RULE_ID,
      detectorRuleVersion: RULE_VERSION,
      evaluationKey,
      evidenceKey,
      eventDate: candidateDate,
      evaluationCheckinId: candidate.id,
      reason: "evaluation_checkin_missing_energy",
    };
  }

  // Baseline collection — window = C-60..C-1 inclusive, C itself excluded.
  // Independent distributions: a row contributes to sleep iff
  // sleepQuality !== null, and to energy iff energy !== null (a row can
  // contribute to one, both, or neither).
  const sleepValues: number[] = [];
  const energyValues: number[] = [];
  const baselineCheckinIds = new Set<string>();
  for (const date of consumedDates) {
    if (date === candidateDate) continue;
    const row = checkinByDate.get(date)!;
    if (row === null) continue;
    let contributed = false;
    if (row.sleepQuality !== null) {
      sleepValues.push(row.sleepQuality);
      contributed = true;
    }
    if (row.energy !== null) {
      energyValues.push(row.energy);
      contributed = true;
    }
    if (contributed) baselineCheckinIds.add(row.id);
  }

  if (sleepValues.length < SLEEP_ENERGY_MIN_BASELINE_OBSERVATIONS || energyValues.length < SLEEP_ENERGY_MIN_BASELINE_OBSERVATIONS) {
    return {
      kind: "no_evidence",
      detectorRuleId: RULE_ID,
      detectorRuleVersion: RULE_VERSION,
      evaluationKey,
      evidenceKey,
      eventDate: candidateDate,
      evaluationCheckinId: candidate.id,
      reason: "insufficient_baseline_data",
    };
  }

  const sleepDistinct = distinctCount(sleepValues);
  const energyDistinct = distinctCount(energyValues);
  if (sleepDistinct < SLEEP_ENERGY_MIN_BASELINE_DISTINCT_VALUES || energyDistinct < SLEEP_ENERGY_MIN_BASELINE_DISTINCT_VALUES) {
    return {
      kind: "no_evidence",
      detectorRuleId: RULE_ID,
      detectorRuleVersion: RULE_VERSION,
      evaluationKey,
      evidenceKey,
      eventDate: candidateDate,
      evaluationCheckinId: candidate.id,
      reason: "baseline_variance_insufficient",
    };
  }

  const sleepPercentile = empiricalMidrankPercentile(candidate.sleepQuality, sleepValues);
  const energyPercentile = empiricalMidrankPercentile(candidate.energy, energyValues);
  const sleepBucket = bucketFromPercentile(sleepPercentile);
  const energyBucket = bucketFromPercentile(energyPercentile);

  let eventType = classify(sleepBucket, energyBucket);

  // Confounders — never affect a NoEvidence outcome (already returned
  // above); only ever force a valid Evidence's eventType to neutral. Fixed
  // deterministic reason order: fever_or_illness, then suspected_concussion.
  const confounderReasons: SleepEnergyConfounderReason[] = [];
  if (candidate.feverOrIllness === true) confounderReasons.push("fever_or_illness");
  if (candidate.suspectedConcussion === true) confounderReasons.push("suspected_concussion");
  if (confounderReasons.length > 0) {
    eventType = "neutral";
  }

  const sortedBaselineCheckinIds = Array.from(baselineCheckinIds).sort();

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
      sleepQuality: candidate.sleepQuality,
      energy: candidate.energy,
      sleepPercentile,
      energyPercentile,
      sleepBucket,
      energyBucket,
      baselineWindowStartDate: baselineStartDate,
      baselineWindowEndDate: baselineEndDate,
      sleepBaselineObservationCount: sleepValues.length,
      energyBaselineObservationCount: energyValues.length,
      sleepBaselineDistinctValueCount: sleepDistinct,
      energyBaselineDistinctValueCount: energyDistinct,
      sleepBaselineHistogram: buildHistogram(sleepValues),
      energyBaselineHistogram: buildHistogram(energyValues),
      rankingMethod: SLEEP_ENERGY_RANKING_METHOD,
      confounderReasons,
    },
    sourceRefs: {
      evaluationCheckinId: candidate.id,
      baselineCheckinIds: sortedBaselineCheckinIds,
    },
  };
}
