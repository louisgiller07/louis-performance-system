import { supabase } from "../../lib/supabase";

// PILOT_022 (REV-01) — whether a persisted daily decision still matches the
// check-in and planned session it was computed from. Evaluated server-side by
// the `daily_decision_currency` view (RLS-scoped via security_invoker) from the
// input versions daily-run persisted with the decision — never from client
// state, so the answer survives navigation, reload and a new mount.

export type DecisionStaleReason = "checkin_changed" | "planned_session_changed";

export interface DecisionCurrency {
  isCurrent: boolean;
  staleReason: DecisionStaleReason | null;
}

export class DecisionCurrencyError extends Error {
  constructor() {
    super("Impossible de vérifier si ton plan du jour est encore à jour.");
    this.name = "DecisionCurrencyError";
  }
}

export async function loadDecisionCurrency(decisionId: string): Promise<DecisionCurrency> {
  const { data, error } = await supabase
    .from("daily_decision_currency")
    .select("is_current, stale_reason")
    .eq("decision_id", decisionId)
    .maybeSingle();

  // Never assume a decision is current when it cannot be verified.
  if (error || !data) {
    if (error) console.error("decisionCurrencyRepo.loadDecisionCurrency failed", error.code);
    throw new DecisionCurrencyError();
  }

  const row = data as { is_current: boolean | null; stale_reason: string | null };
  return {
    isCurrent: row.is_current === true,
    staleReason: row.stale_reason === "planned_session_changed" ? "planned_session_changed" : row.is_current === true ? null : "checkin_changed",
  };
}
