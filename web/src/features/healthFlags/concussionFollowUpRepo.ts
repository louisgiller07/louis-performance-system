// SPORT-SAFE-02 A5 (HPM 2026-10-22) — the rider declares the outcome of the medical assessment of their own
// concussion signal. Reads the CURRENT server state (signal status + attestations, RLS: own rows only) and records a
// DECLARATIVE attestation through record_health_flag_attestation (security definer: the athlete comes from the JWT,
// never from here; a service role or an operator cannot call it). Never a medical validation, never a document.
import { todayLocal } from "../../lib/date";
import { supabase } from "../../lib/supabase";

export const CONCUSSION_OUTCOMES = ["assessment_in_progress", "concussion_confirmed", "ruled_out", "full_return_authorised", "entered_in_error"] as const;
export type ConcussionOutcome = (typeof CONCUSSION_OUTCOMES)[number];
export const PROFESSIONAL_CATEGORIES = ["physician", "sports_physician", "physiotherapist", "other"] as const;
export type ProfessionalCategory = (typeof PROFESSIONAL_CATEGORIES)[number];

/** Outcomes that close the signal (a new daily analysis then decides). The others keep the suspension. */
export const CLOSING_OUTCOMES: ReadonlySet<ConcussionOutcome> = new Set(["ruled_out", "full_return_authorised", "entered_in_error"]);
/** Outcomes that need the date of the professional's decision. */
export const DATED_OUTCOMES: ReadonlySet<ConcussionOutcome> = new Set(["concussion_confirmed", "ruled_out", "full_return_authorised"]);

export interface ConcussionFollowUp {
  open: boolean;
  flagDate: string;
  /** The rider's last attestation on this signal, null when none (a signal from before the attestations). */
  lastOutcome: ConcussionOutcome | null;
  /** Today's check-in still declares a suspected concussion: a closure would be undone by the next analysis (A1). */
  checkinDeclaresConcussion: boolean;
}

/**
 * What the rider may declare from the current state — the server's own transitions:
 * - « in progress » and « confirmed » never reopen the coaching;
 * - a confirmed concussion ends only with a dated full return authorised;
 * - an entry error only before any assessment was declared;
 * - « full return authorised » (dated) is always possible: no open signal is ever locked for good.
 */
export function allowedOutcomes(last: ConcussionOutcome | null): ConcussionOutcome[] {
  if (last === null) return [...CONCUSSION_OUTCOMES];
  if (last === "concussion_confirmed") return ["full_return_authorised"];
  return ["concussion_confirmed", "ruled_out", "full_return_authorised"];
}

export class ConcussionFollowUpLoadError extends Error {
  constructor() {
    super("Impossible de charger ton suivi.");
    this.name = "ConcussionFollowUpLoadError";
  }
}

/** The signal's current state, read from the server (never a cached client state). */
export async function loadConcussionFollowUp(flagId: string): Promise<ConcussionFollowUp> {
  const [flag, attestations] = await Promise.all([
    supabase.from("health_flags").select("status, flag_date, athlete_id").eq("id", flagId).maybeSingle(),
    supabase.from("health_flag_attestations").select("outcome, recorded_at").eq("flag_id", flagId).order("recorded_at", { ascending: false }).limit(1),
  ]);
  if (flag.error || attestations.error || !flag.data) {
    console.error("concussionFollowUpRepo.load failed", flag.error?.code ?? attestations.error?.code ?? "not_found");
    throw new ConcussionFollowUpLoadError();
  }
  const row = flag.data as { status: string; flag_date: string; athlete_id: string };
  const checkin = await supabase.from("daily_checkins").select("suspected_concussion").eq("athlete_id", row.athlete_id).eq("checkin_date", todayLocal()).maybeSingle();
  if (checkin.error) {
    console.error("concussionFollowUpRepo.load failed", checkin.error.code);
    throw new ConcussionFollowUpLoadError();
  }
  const last = ((attestations.data ?? []) as { outcome: string }[])[0]?.outcome;
  return {
    open: row.status === "active" || row.status === "monitoring",
    flagDate: row.flag_date,
    lastOutcome: (CONCUSSION_OUTCOMES as readonly string[]).includes(last ?? "") ? (last as ConcussionOutcome) : null,
    checkinDeclaresConcussion: (checkin.data as { suspected_concussion: boolean | null } | null)?.suspected_concussion === true,
  };
}

export interface ConcussionAttestationInput {
  /** Device-generated, kept for a retry of the same declaration (idempotent on the server). */
  id: string;
  flagId: string;
  outcome: ConcussionOutcome;
  assessedOn: string | null;
  professionalCategory: ProfessionalCategory | null;
  enteredInErrorConfirmation: boolean;
}

export type ConcussionAttestationResult =
  | { ok: true; closed: boolean }
  | { ok: false; code: string; retryable: boolean };

export async function recordConcussionAttestation(input: ConcussionAttestationInput): Promise<ConcussionAttestationResult> {
  const { data, error } = await supabase.rpc("record_health_flag_attestation", {
    p_attestation: {
      id: input.id,
      flag_id: input.flagId,
      outcome: input.outcome,
      assessed_on: input.assessedOn,
      professional_category: input.professionalCategory,
      entered_in_error_confirmation: input.outcome === "entered_in_error" ? input.enteredInErrorConfirmation : null,
    },
  });
  if (error) {
    console.error("concussionFollowUpRepo.record failed", error.code);
    return { ok: false, code: "network", retryable: true };
  }
  const result = data as { status: string; code?: string; flag_status?: string };
  if (result.status === "recorded") return { ok: true, closed: result.flag_status === "resolved" };
  // A replay of the same declaration (same id, same content): already recorded.
  if (result.status === "unchanged") return { ok: true, closed: CLOSING_OUTCOMES.has(input.outcome) };
  return { ok: false, code: result.code ?? "unknown", retryable: false };
}
