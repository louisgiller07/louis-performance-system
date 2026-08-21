/**
 * Read-only Supabase adapter for the longitudinal source layer.
 *
 * HARD BOUNDARY: this file (and this whole package) never imports from
 * `head-coach-engine/src/**`. The Head Coach Engine is frozen and remains
 * exclusively M1/M2/M3's — this package is a sibling reader, not an
 * extension of it. See docs/11_DECISION_LOG.md (M5_002A).
 *
 * READ-ONLY INVARIANT: every method below issues exactly one `.select()`
 * query. This file contains no `.insert(`, `.update(`, `.upsert(`,
 * `.delete(`, or `.rpc(` call anywhere — grep for those tokens in this
 * file to verify. It never calls `persist_daily_run`,
 * `persist_completed_session`, or `persist_decision_outcome`. This adapter
 * is a source reader; the write paths for those tables live exclusively in
 * their own RPCs (see the M2_006/M5_001A/M5_001B migrations).
 *
 * OWNERSHIP: every query explicitly filters `.eq("athlete_id", athleteId)`,
 * even though a service-role client bypasses RLS — ownership scoping is
 * never left implicit. There is no "all athletes" query anywhere in this
 * module. Resolving which athlete is allowed to be read is a future
 * server-side orchestration concern (e.g. deriving it from a caller's JWT
 * before ever reaching this layer); this adapter only trusts the
 * `athleteId` it is given.
 *
 * SECRETS: this module never constructs or owns a Supabase client — it
 * receives one via the constructor (dependency injection). No secret
 * literal, no browser-vs-server assumption, lives in this package.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CompletedSessionSource,
  DailyCheckinSource,
  DateRange,
  DecisionOutcomeSource,
  DecisionSource,
  HealthFlagSource,
  LongitudinalSourceAdapter,
} from "../types/index.js";
import {
  mapCompletedSessionRow,
  mapDailyCheckinRow,
  mapDecisionOutcomeRow,
  mapDecisionRow,
  mapHealthFlagRow,
} from "./rowMapping.js";

const DAILY_CHECKIN_COLUMNS =
  "id, athlete_id, checkin_date, submitted_at, sleep_hours, sleep_quality, sleep_wake_ups, energy, leg_fatigue, grip_fatigue, motivation, work_stress, pain, pain_intensity, pain_new, pain_location_code, pain_traumatic, pain_function_loss, pain_getting_worse, suspected_concussion, fever_or_illness, free_comment";

const DECISION_COLUMNS =
  "id, athlete_id, decision_date, computed_at, final_session, planned_session_before, active_mode, confidence_level, daily_plan, engine_version, overridden_by_user, override_reason, source_checkin_id";

const COMPLETED_SESSION_COLUMNS =
  "id, athlete_id, session_date, decision_id, planned_session_id, session_type, completion_status, actual_duration_min, rpe, session_load, intervention, main_content, post_leg_fatigue, post_grip_fatigue, new_pain, new_pain_note";

const DECISION_OUTCOME_COLUMNS =
  "id, athlete_id, decision_id, horizon, calculator_id, calculator_version, input_snapshot, outcome_signals, calculated_at, created_at";

const HEALTH_FLAG_COLUMNS =
  "id, athlete_id, flag_date, flag_type, status, description, body_location, intensity, professional_consulted, professional_type, resolved_at, resolution_note, source_checkin_id, created_at";

/**
 * `decision_outcomes` has no plain `date` column of its own — range
 * membership is decided by the *decision being observed*, via an inner
 * join on `decisions`. PostgREST embedded-filter columns are addressed as
 * `"<referencedTable>.<column>"` inside `.gte`/`.lte`; `!inner` turns the
 * embed into a real SQL inner join, which is what makes the filter apply
 * to the outer `decision_outcomes` rows rather than only shaping a nested
 * array. See the module doc above and docs/11_DECISION_LOG.md (M5_002A)
 * for why `decision_date`, not `calculated_at`, is the correct anchor.
 */
const DECISION_OUTCOME_SELECT = `${DECISION_OUTCOME_COLUMNS}, decisions!inner(decision_date)`;

export class SupabaseLongitudinalSourceAdapter implements LongitudinalSourceAdapter {
  constructor(private readonly client: SupabaseClient) {}

  /** Ordered by checkin_date ASC, id ASC (stable tie-breaker). */
  async getDailyCheckins(athleteId: string, range: DateRange): Promise<DailyCheckinSource[]> {
    const { data, error } = await this.client
      .from("daily_checkins")
      .select(DAILY_CHECKIN_COLUMNS)
      .eq("athlete_id", athleteId)
      .gte("checkin_date", range.fromDate)
      .lte("checkin_date", range.toDate)
      .order("checkin_date", { ascending: true })
      .order("id", { ascending: true });

    if (error) throw new Error(`SupabaseLongitudinalSourceAdapter.getDailyCheckins: ${error.code}`);
    return (data ?? []).map((row) => mapDailyCheckinRow(row as Record<string, unknown>));
  }

  /**
   * Ordered by decision_date ASC, computed_at ASC, id ASC. decisions is
   * append-only — multiple rows can share the same decision_date, so a
   * single date-only sort would not be fully deterministic; computed_at
   * and finally id resolve any tie.
   */
  async getDecisions(athleteId: string, range: DateRange): Promise<DecisionSource[]> {
    const { data, error } = await this.client
      .from("decisions")
      .select(DECISION_COLUMNS)
      .eq("athlete_id", athleteId)
      .gte("decision_date", range.fromDate)
      .lte("decision_date", range.toDate)
      .order("decision_date", { ascending: true })
      .order("computed_at", { ascending: true })
      .order("id", { ascending: true });

    if (error) throw new Error(`SupabaseLongitudinalSourceAdapter.getDecisions: ${error.code}`);
    return (data ?? []).map((row) => mapDecisionRow(row as Record<string, unknown>));
  }

  /** Ordered by session_date ASC, id ASC. */
  async getCompletedSessions(athleteId: string, range: DateRange): Promise<CompletedSessionSource[]> {
    const { data, error } = await this.client
      .from("completed_sessions")
      .select(COMPLETED_SESSION_COLUMNS)
      .eq("athlete_id", athleteId)
      .gte("session_date", range.fromDate)
      .lte("session_date", range.toDate)
      .order("session_date", { ascending: true })
      .order("id", { ascending: true });

    if (error) throw new Error(`SupabaseLongitudinalSourceAdapter.getCompletedSessions: ${error.code}`);
    return (data ?? []).map((row) => mapCompletedSessionRow(row as Record<string, unknown>));
  }

  /**
   * Range membership is bounded by the *related decision's*
   * `decisions.decision_date` (inner-joined, see DECISION_OUTCOME_SELECT
   * above) — not by `calculated_at`. `calculated_at` is when the
   * calculator happened to run, which the schema itself documents as
   * potentially a delayed replay (see the decision_outcomes table's own
   * migration comment); a longitudinal read of "what happened around
   * decision_date X" must not silently drop an outcome that was computed
   * late, nor pull in an outcome for a decision outside `range` just
   * because it happened to be (re)computed inside it.
   *
   * Ordering cannot follow `decision_date` here: PostgREST/postgrest-js
   * explicitly documents that ordering by a referenced/embedded table's
   * column does not affect the ordering of the parent rows (only
   * filtering does, via `!inner`) — so the top-level order below uses the
   * columns actually available on `decision_outcomes` itself:
   * calculated_at ASC, decision_id ASC, horizon ASC (its enum labels
   * J_PLUS_1 < J_PLUS_3 < J_PLUS_7 sort both alphabetically and
   * chronologically), calculator_id ASC, calculator_version ASC, id ASC —
   * still fully deterministic, just not decision_date-ordered.
   */
  async getDecisionOutcomes(athleteId: string, range: DateRange): Promise<DecisionOutcomeSource[]> {
    const { data, error } = await this.client
      .from("decision_outcomes")
      .select(DECISION_OUTCOME_SELECT)
      .eq("athlete_id", athleteId)
      .gte("decisions.decision_date", range.fromDate)
      .lte("decisions.decision_date", range.toDate)
      .order("calculated_at", { ascending: true })
      .order("decision_id", { ascending: true })
      .order("horizon", { ascending: true })
      .order("calculator_id", { ascending: true })
      .order("calculator_version", { ascending: true })
      .order("id", { ascending: true });

    if (error) throw new Error(`SupabaseLongitudinalSourceAdapter.getDecisionOutcomes: ${error.code}`);
    return (data ?? []).map((row) => mapDecisionOutcomeRow(row as Record<string, unknown>));
  }

  /**
   * Range membership is lifecycle overlap, not `flag_date` alone: a flag
   * is included when its `[flag_date, resolved_at ?? open-ended]` interval
   * intersects `range` — i.e. `flag_date <= range.toDate AND
   * (resolved_at IS NULL OR resolved_at >= range.fromDate)`. A flag raised
   * before `range.fromDate` and still `active`/`monitoring` (unresolved)
   * throughout `range` is exactly the kind of signal a longitudinal read
   * of that period needs (e.g. "was there an unresolved injury during
   * this training block") — `flag_date`-only filtering would silently
   * drop it once the range no longer contains the flag's start date.
   * `resolved_at` is a plain `date` (same type as `flag_date`), so no UTC
   * boundary conversion is needed here, unlike decision_outcomes.
   *
   * Ordered by flag_date ASC, id ASC.
   */
  async getHealthFlags(athleteId: string, range: DateRange): Promise<HealthFlagSource[]> {
    const { data, error } = await this.client
      .from("health_flags")
      .select(HEALTH_FLAG_COLUMNS)
      .eq("athlete_id", athleteId)
      .lte("flag_date", range.toDate)
      .or(`resolved_at.is.null,resolved_at.gte.${range.fromDate}`)
      .order("flag_date", { ascending: true })
      .order("id", { ascending: true });

    if (error) throw new Error(`SupabaseLongitudinalSourceAdapter.getHealthFlags: ${error.code}`);
    return (data ?? []).map((row) => mapHealthFlagRow(row as Record<string, unknown>));
  }
}
