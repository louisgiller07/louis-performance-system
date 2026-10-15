/**
 * PHYS-02.1 — may the intervals LIGHT fallback (base endurance: road bike, rolling MTB, home trainer,
 * running) be proposed given today's pain? Integration layer, pure; M1 is unchanged.
 *
 * Only the EXISTING rule is used: M1's PAIN_NON_SAFETY zone classification (rules/painNonSafety.ts),
 * evaluated read-only on the fallback session. No data relates an endurance activity to a body zone
 * (no activity-level rule, declared limitations never read by the V2 builders), so no activity is
 * ever judged compatible on its own:
 * - cleared: no pain today, or a pain in a zone that rule says endurance does not solicit
 *   (upper body / grip);
 * - not cleared: a pain endurance solicits (lower limbs), a pain without location (the rule's cautious
 *   reading), or a zone the rule leaves unclassified (back, neck… : an open product decision). The
 *   fallback is then not proposed: a safe, explicit state, never an activity chosen for the rider.
 * A blocking pain never reaches this point (P0-SAFE: REST, no session).
 */
import { evaluatePainNonSafety } from "../../rules/painNonSafety.js";
import { SignalTrace } from "../../engine/signalTrace.js";
import type { DailyCheckin } from "../../types/checkin.js";

export type EnduranceFallbackPainGate = { cleared: true } | { cleared: false; zone: "lower" | "other" | "unspecified" };

export function enduranceFallbackPainGate(checkin: DailyCheckin | null | undefined): EnduranceFallbackPainGate {
  if (!checkin?.pain) return { cleared: true };
  const evaluation = evaluatePainNonSafety(checkin, { kind: "AEROBIC_BASE", load_profile: "LIGHT" }, new SignalTrace());
  if (evaluation !== null && evaluation.zone_category === "upper_grip" && evaluation.adapted_session === undefined) return { cleared: true };
  if (!checkin.pain_location_code) return { cleared: false, zone: "unspecified" };
  return { cleared: false, zone: evaluation?.zone_category === "lower" ? "lower" : "other" };
}
