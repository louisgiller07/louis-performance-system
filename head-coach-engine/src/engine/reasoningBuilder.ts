import type { TriggeredRule } from "../types/triggeredRule.js";
import type { TrainingInterventionKind } from "../types/trainingIntervention.js";

/**
 * V0.3.011 — explicit separation between two conceptually distinct uses of
 * `triggered_rules`, per the locked architecture (docs/11_DECISION_LOG.md
 * V0.3.011):
 *
 *  A. Decision reasoning — factors that actually explain the FINAL
 *     decision. Feeds `reasoning`, `training.objective` (the "Pourquoi
 *     cette décision ?" text shown to the athlete).
 *  B. Monitoring context — informative signals with no automatic effect on
 *     the session (C3.7 today, and only C3.7 — see
 *     MONITORING_ONLY_RULE_IDS below). Surfaced via `monitoring` and the
 *     full `triggered_rules` audit trail, never via A.
 *
 * This module only SELECTS which already-triggered rules are eligible for
 * A — it never decides which rules fire, never touches `session` or
 * `decision`, and never removes anything from `triggered_rules` itself
 * (the complete audit trail is untouched, built and returned by
 * buildDailyPlan.ts exactly as before). No coaching rule, threshold, or
 * decision logic lives here or is changed by this module — see training.ts
 * (frozen since V0.3.010, C3.7's wording only).
 */

/**
 * Rule ids that are always Monitoring Context (B) — informational only,
 * never decision-affecting. C3.7 (recent_load RED) is the only current
 * member: confirmed intentional soft/non-binding signal (see training.ts
 * and docs/12_BACKLOG.md §Gaps de revue externe post-V0.3_006C) — SIM-002
 * was never about making it binding, only about it leaking into the text
 * that explains a decision it never influenced.
 */
const MONITORING_ONLY_RULE_IDS = new Set(["C3.7"]);

/**
 * Rule ids whose own text explicitly claims the session's nature was
 * preserved (C3.3, MENTAL_RED) — true of their OWN local, load-only
 * effect, but stale/misleading once a LATER rule in the same run
 * (C3.5/C3.6/pain/soft-constraint/A5) has since changed the kind (SIM-003).
 * Only excluded from A in that specific case — see
 * `selectDecisionReasoningRules` below. A genuine KEEP/same-nature MODIFY
 * still shows this text normally (regression-tested).
 */
const NATURE_PRESERVED_RULE_IDS = new Set(["C3.3", "MENTAL_RED"]);

export interface DecisionReasoningInput {
  triggeredRules: TriggeredRule[];
  /** The kind being compared against for KEEP/MODIFY/REPLACE labeling — see buildDailyPlan.ts `comparisonBase`. */
  comparisonBaseKind: TrainingInterventionKind;
  finalSessionKind: TrainingInterventionKind;
  /** Passed in rather than re-implemented here — buildDailyPlan.ts's own MODIFY_EQUIVALENT_KIND_PAIRS-aware `isSameNature`, the single source of truth for "same nature" already used for `decision` itself. */
  isSameNature: (a: TrainingInterventionKind, b: TrainingInterventionKind) => boolean;
}

/**
 * Selects the subset of `triggeredRules` eligible to explain the FINAL
 * decision (layer A). Never mutates or reorders `triggeredRules` — the
 * full audit trail (layer B's other consumer) stays exactly as produced by
 * the domain/arbitration rules, untouched by this selection.
 */
export function selectDecisionReasoningRules({
  triggeredRules,
  comparisonBaseKind,
  finalSessionKind,
  isSameNature,
}: DecisionReasoningInput): TriggeredRule[] {
  const natureChanged = !isSameNature(comparisonBaseKind, finalSessionKind);
  return triggeredRules.filter((rule) => {
    if (MONITORING_ONLY_RULE_IDS.has(rule.rule_id)) return false;
    if (natureChanged && NATURE_PRESERVED_RULE_IDS.has(rule.rule_id)) return false;
    return true;
  });
}

/** Joins the selected decision-reasoning rules into the athlete-facing `reasoning` text, with the existing no-signal fallback. */
export function joinDecisionReasoning(reasoningRules: TriggeredRule[]): string {
  return reasoningRules.length > 0
    ? reasoningRules.map((r) => r.detail).join(" ")
    : "Aucun signal particulier — séance maintenue telle quelle.";
}
