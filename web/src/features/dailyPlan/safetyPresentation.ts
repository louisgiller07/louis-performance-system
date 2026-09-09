// V0.3_006A1 — presentation-boundary sanitization for Safety-layer (A)
// triggered rules. head-coach-engine/src/rules/safety.ts is never touched by
// this file: `triggered_rules`/`reasoning` on the underlying DailyPlan stay
// byte-for-byte what the engine emitted (still fully present for
// technicalMetadata/debug/history audit) — only what gets rendered as
// athlete copy changes.
//
// Exactly one current triggered_rule needs this: A5's `detail` ("Flag
// concussion_suspect actif non résolu — DH interdit tant que non validé
// médicalement") embeds the internal HealthFlagType slug. A1-A4's own
// `detail` strings are already clean athlete-appropriate French — verified
// by inspection of rules/safety.ts — so they pass through unchanged here.
// If a future Safety rule's `detail` needs the same treatment, add it here,
// not by rewriting engine wording (see docs/11_DECISION_LOG.md V0.3_006A:
// this is presentation sanitization, not a clinical/product wording
// decision, which A5's own text explicitly avoided touching).
import type { DailyPlan, TriggeredRule } from "./dailyPlanTypes";

// Factual system-state statement only — never a claim about which activity
// is medically safe, never a return-to-activity recommendation. Wording
// locked by the V0.3_006A1 architecture decision.
const A5_ATHLETE_SAFE_DETAIL =
  "Un signal de suspicion de commotion déclaré précédemment est toujours actif. Les restrictions de sécurité associées restent appliquées.";

const SAFETY_RULE_OVERRIDES: Readonly<Record<string, string>> = {
  A5: A5_ATHLETE_SAFE_DETAIL,
};

/** The athlete-safe text for one triggered rule — `rule.detail` unchanged unless this specific rule_id is known to need sanitization. */
export function athleteSafeRuleDetail(rule: TriggeredRule): string {
  return SAFETY_RULE_OVERRIDES[rule.rule_id] ?? rule.detail;
}

/**
 * The athlete-safe equivalent of `dailyPlan.reasoning`. Deliberately a
 * targeted substring replacement, not a rebuild from triggered_rules: only
 * the exact known-bad `rule.detail` text (from a rule with a registered
 * override) is ever substituted, wherever it literally appears in
 * `dailyPlan.reasoning` — every other character of `reasoning` is passed
 * through completely untouched, so this can never diverge from the real
 * `reasoning` field for a rule that has no override, even in a test fixture
 * where `reasoning` and `triggered_rules` were set independently.
 */
export function athleteSafeReasoning(dailyPlan: DailyPlan): string {
  let reasoning = dailyPlan.reasoning;
  for (const rule of dailyPlan.triggered_rules) {
    const safe = SAFETY_RULE_OVERRIDES[rule.rule_id];
    if (safe) reasoning = reasoning.split(rule.detail).join(safe);
  }
  return reasoning;
}

/** Whether an active Safety-layer (A) rule is present — used to give Safety-driven restrictions visual/textual priority over generic Recovery content. Presentation ordering only; never changes which activities are considered allowed. */
export function hasActiveSafetyRule(dailyPlan: DailyPlan): boolean {
  return dailyPlan.triggered_rules.some((rule) => rule.layer === "A");
}
