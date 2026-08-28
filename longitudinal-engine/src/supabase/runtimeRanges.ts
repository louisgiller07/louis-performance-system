/**
 * V0.3_001A — the runtime-layer date/range constants that sit ABOVE the
 * frozen M5_006D/M5_007 pure contracts. See docs/06_ARCHITECTURE.md
 * §V0.3_001 and docs/11_DECISION_LOG.md for the full derivation/validation
 * record — none of this belongs inside `aggregateEffectivePatternEvidence.ts`
 * or `buildPatternInsightCandidates.ts` themselves, which stay unmodified.
 *
 * Two conceptually DIFFERENT ranges are defined here, deliberately never
 * merged even though they happen to share the same floor date:
 *
 * - `INSIGHT_AGGREGATION_RANGE` — the M5_007 static, immutable, explicit
 *   insight range. Used ONLY for `pattern_evidence_current_effective`
 *   reads, `aggregateEffectivePatternEvidence`, `PatternInsightSnapshot`'s
 *   own `rangeFromDate`/`rangeToDate`, and the review freshness token.
 *   MUST NEVER be passed to `buildTimeline` — `buildTimeline` materializes
 *   one `AthleteDay` per calendar date in its input range (confirmed by
 *   direct inspection: `materializeDateRange` + `dates.map(assembleDay)`),
 *   so passing an ~8000-year span would attempt to allocate ~2.92 million
 *   `AthleteDay` objects.
 * - `DOMAIN_HISTORY_FLOOR_DATE` — the shared sentinel floor both
 *   `INSIGHT_AGGREGATION_RANGE` and the longitudinal SOURCE QUERY bounds
 *   use (see `assembleAthleteTimeline.ts`) — a cheap `.gte()/.lte()`
 *   WHERE-clause bound, never enumerated, unlike `buildTimeline`'s own
 *   range.
 *
 * Floor/ceiling validated empirically against M5_006D's own locked
 * `parseCanonicalDateUtc` (`timeline/range.ts`): `1900-01-01` deliberately
 * sits above JS `Date.UTC`'s legacy 0-99-year special-casing zone (a year
 * in that zone silently gets reinterpreted as 19xx — confirmed by direct
 * round-trip testing); `9999-12-31` is the true ceiling of the canonical
 * `YYYY-MM-DD` 4-digit-year parser (`^(\d{4})-(\d{2})-(\d{2})$`) — no year
 * above 9999 is representable at all in this format.
 */
import type { DateRange } from "../types/adapter.js";

/** Never derived from the clock — a fixed domain constant. */
export const DOMAIN_HISTORY_FLOOR_DATE = "1900-01-01";
const DOMAIN_HISTORY_CEILING_DATE = "9999-12-31";

/**
 * The M5_007 insight/review static aggregation range — locked, immutable,
 * clock-independent. Passed EXPLICITLY to `aggregateEffectivePatternEvidence`/
 * `buildPatternInsightCandidates` call sites; never a default hidden
 * inside those pure functions themselves.
 */
export const INSIGHT_AGGREGATION_RANGE: DateRange = { fromDate: DOMAIN_HISTORY_FLOOR_DATE, toDate: DOMAIN_HISTORY_CEILING_DATE };
