// V0.3_006A1 — presentation-boundary sanitization for triggered rules.
// head-coach-engine/src/rules/**/domains/**/**.ts are never touched by this
// file: `triggered_rules`/`reasoning`/`monitoring`/`protection` on the
// underlying DailyPlan stay byte-for-byte what the engine emitted (still
// fully present for technicalMetadata/debug/history audit) — only what
// gets rendered as athlete copy changes. An explicit ALLOWLISTED mapping of
// known technical terms/rule_ids only — never an uncontrolled generic
// string-replacement engine.
//
// Known cases needing this (V0.3_006A1 A5, V0.3_006C1 PAIN_NON_SAFETY/
// MENTAL_RED/raw pain-location codes) are documented at each override
// below. If a future rule's `detail`/monitoring/protection text needs the
// same treatment, add it here, not by rewriting engine wording (see
// docs/11_DECISION_LOG.md V0.3_006A: this is presentation sanitization, not
// a clinical/product wording decision).
import { PAIN_LOCATION_CODES, PAIN_LOCATION_LABELS, type PainLocationCode } from "../checkin/checkinTypes";
import type { DailyPlan, TriggeredRule } from "./dailyPlanTypes";

// Factual system-state statement only — never a claim about which activity
// is medically safe, never a return-to-activity recommendation. Wording
// locked by the V0.3_006A1 architecture decision.
const A5_ATHLETE_SAFE_DETAIL =
  "Un signal de suspicion de commotion déclaré précédemment est toujours actif. Les restrictions de sécurité associées restent appliquées.";

// V0.3_006C1 (A5 copy-leak hotfix) — "Suspicion de commotion déclarée — REST
// et orientation médicale immédiate" (rules/safety.ts A1) exposed the raw
// English action token "REST" verbatim. A1's `detail` is a single static
// template (no dynamic interpolation) — same mechanism as A5/MENTAL_RED.
const A1_ATHLETE_SAFE_DETAIL = "Suspicion de commotion déclarée — repos et orientation médicale immédiate";

// V0.3_006C1 — "Mental RED — réduction..." (domains/training.ts's
// MENTAL_RED rule, layer C) exposed the internal dimension-level jargon
// verbatim. Fixed replacement: MENTAL_RED's detail is a single static
// template (no dynamic interpolation), so a plain string override is
// sufficient — same mechanism as A5.
const MENTAL_RED_ATHLETE_SAFE_DETAIL = "Charge mentale élevée — séance adaptée pour réduire la charge cognitive.";

/**
 * rule_id -> {exact raw detail this override applies to, athlete-safe
 * replacement}, for rules whose `detail` is a single static template (never
 * for a rule whose detail is dynamically interpolated — those need their
 * own function, see PAIN_NON_SAFETY below). Keyed by rule_id for lookup,
 * but only substitutes when `rule.detail` matches the exact known raw text —
 * an allowlist of known (rule_id, detail) pairs, not a blind rule_id-only
 * substitution (V0.3_006C1 A5 copy-leak hotfix: a rule_id alone is not a
 * reliable enough key — e.g. tests exercising generic layer-A rendering
 * reuse "A1" as a stand-in id with unrelated detail text, which must be
 * left untouched, not accidentally rewritten into the real A1 sentence).
 */
const FIXED_RULE_OVERRIDES: Readonly<Record<string, { rawDetail: string; safeDetail: string }>> = {
  A1: {
    rawDetail: "Suspicion de commotion déclarée — REST et orientation médicale immédiate",
    safeDetail: A1_ATHLETE_SAFE_DETAIL,
  },
  A5: {
    rawDetail: "Flag concussion_suspect actif non résolu — DH interdit tant que non validé médicalement",
    safeDetail: A5_ATHLETE_SAFE_DETAIL,
  },
  MENTAL_RED: {
    rawDetail: "Mental RED — réduction de la charge cognitive/structurelle, nature physique préservée",
    safeDetail: MENTAL_RED_ATHLETE_SAFE_DETAIL,
  },
};

/**
 * V0.3_006C1 — PAIN_NON_SAFETY's `detail` (rules/painNonSafety.ts) is
 * dynamically interpolated with the raw `pain_location_code` and varies by
 * whether the session was solicited ("... adaptation de la séance" vs "...
 * séance non concernée"), so it cannot use a single fixed override string.
 * Extracts the raw code from the parenthesized segment, maps it through the
 * canonical PAIN_LOCATION_LABELS, and rebuilds an athlete-safe sentence —
 * never exposing "non-SAFETY" or the raw code. Falls back to "une zone"
 * only if the code is somehow not a known value (defensive, never expected
 * given the code always comes from the canonical enum).
 */
function sanitizePainNonSafetyDetail(detail: string): string {
  const match = detail.match(/\(([^)]+)\)/);
  const rawZone = match?.[1];
  const zoneLabel = rawZone !== undefined && rawZone in PAIN_LOCATION_LABELS ? PAIN_LOCATION_LABELS[rawZone as PainLocationCode] : "une zone";
  const solicited = !detail.includes("séance non concernée");
  return solicited
    ? `Douleur signalée — ${zoneLabel} — séance adaptée et surveillance renforcée.`
    : `Douleur signalée — ${zoneLabel} — surveillance renforcée, séance non concernée par cette zone.`;
}

function resolveOverrideFor(rule: TriggeredRule): string | undefined {
  if (rule.rule_id === "PAIN_NON_SAFETY") return sanitizePainNonSafetyDetail(rule.detail);
  const override = FIXED_RULE_OVERRIDES[rule.rule_id];
  return override && rule.detail === override.rawDetail ? override.safeDetail : undefined;
}

/** The athlete-safe text for one triggered rule — `rule.detail` unchanged unless this specific rule_id is known to need sanitization. */
export function athleteSafeRuleDetail(rule: TriggeredRule): string {
  return resolveOverrideFor(rule) ?? rule.detail;
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
    const safe = resolveOverrideFor(rule);
    if (safe) reasoning = reasoning.split(rule.detail).join(safe);
  }
  return reasoning;
}

/**
 * V0.3_006C1 (A5 copy-leak hotfix) — the athlete-safe equivalent of
 * `dailyPlan.training.objective`. The engine sets this field to the last
 * triggered rule's raw `detail` (`buildDailyPlan.ts`) — a field never
 * covered by `athleteSafeRuleDetail`/`athleteSafeReasoning` (those only
 * handle `triggered_rules`/`reasoning`), so a rule with a registered
 * override (e.g. A5's "Flag concussion_suspect actif non résolu...") still
 * leaked its raw technical wording into the Training card. Same targeted-
 * match approach as `athleteSafeReasoning`: only an objective that is
 * exactly a known-bad rule detail is substituted — every other objective
 * (including the fixed "Repos complet — SAFETY" A1 uses, which never equals
 * a rule detail) passes through completely unchanged.
 */
export function athleteSafeTrainingObjective(dailyPlan: DailyPlan): string | undefined {
  const objective = dailyPlan.training.objective;
  if (objective === undefined) return undefined;
  for (const rule of dailyPlan.triggered_rules) {
    const safe = resolveOverrideFor(rule);
    if (safe && objective === rule.detail) return safe;
  }
  return objective;
}

/**
 * V0.3_006C1 — word-boundary-safe replacement of any of the 33 known,
 * canonical `pain_location_code` values wherever they appear in a string —
 * an explicit allowlist (never a blind/uncontrolled find-and-replace).
 * `\b` correctly avoids matching a code as a substring of an unrelated
 * word (e.g. "other" never matches inside "another").
 */
function replaceKnownPainLocationCodes(text: string): string {
  let result = text;
  for (const code of PAIN_LOCATION_CODES) {
    result = result.replace(new RegExp(`\\b${code}\\b`, "g"), PAIN_LOCATION_LABELS[code]);
  }
  return result;
}

/**
 * Athlete-safe `monitoring.observe` — `PAIN_NON_SAFETY`'s monitoring entry
 * embeds the raw `pain_location_code` directly (e.g. "... (wrist_L,
 * intensité 4/10) ..."), never sanitized by `athleteSafeRuleDetail` (that
 * only covers `triggered_rules`/`reasoning`). The underlying
 * `dailyPlan.monitoring.observe` array is never mutated — only the
 * rendered copy.
 */
export function athleteSafeMonitoring(dailyPlan: DailyPlan): string[] {
  return dailyPlan.monitoring.observe.map(replaceKnownPainLocationCodes);
}

/** Athlete-safe `protection.do_not_do` — same raw-code leak as monitoring, same fix. */
export function athleteSafeProtection(dailyPlan: DailyPlan): string[] {
  return dailyPlan.protection.do_not_do.map(replaceKnownPainLocationCodes);
}

/** Whether an active Safety-layer (A) rule is present — used to give Safety-driven restrictions visual/textual priority over generic Recovery content. Presentation ordering only; never changes which activities are considered allowed. */
export function hasActiveSafetyRule(dailyPlan: DailyPlan): boolean {
  return dailyPlan.triggered_rules.some((rule) => rule.layer === "A");
}
