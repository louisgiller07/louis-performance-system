/**
 * PHYS-01.1 — what in today's state forbids an automatic load increase in the
 * Force load guidance (integration layer, pure). Read from M1's own inputs
 * and output, never re-deciding anything: M1 is unchanged.
 *
 * - pain: the day's check-in reports a pain (any intensity) — a pain that does
 *   not stop the session still never comes with a heavier load;
 * - fatigue: M1 triggered one of its fatigue / load rules (C3.3 systemic,
 *   C3.5 grip, C3.6 legs, C3.7 recent load very high).
 * Pain wins when both are present. A decrease is never held (see the rule).
 */
import type { DailyPlan } from "../../types/index.js";

export const LOAD_HOLD_FATIGUE_RULE_IDS: readonly string[] = ["C3.3", "C3.5", "C3.6", "C3.7"];

export function todayLoadHold(checkin: { pain?: boolean } | null | undefined, dailyPlan: Pick<DailyPlan, "triggered_rules">): "pain" | "fatigue" | undefined {
  if (checkin?.pain === true) return "pain";
  if (dailyPlan.triggered_rules.some((r) => LOAD_HOLD_FATIGUE_RULE_IDS.includes(r.rule_id))) return "fatigue";
  return undefined;
}
