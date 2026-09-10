import type { CompletedSessionSummary } from "../types/rawContext.js";
import type { DimensionState } from "../types/dimensions.js";
import { isFixedLoadKind } from "../types/trainingIntervention.js";
import { daysBetween } from "./dateUtils.js";
import { PROVISIONAL_THRESHOLDS } from "./provisionalThresholds.js";

/**
 * Dimension `recent_load` (charge 7 jours) — voir docs/07_GLOSSARY.md
 * (dimension canonique, échelle GREEN/AMBER/RED) et
 * docs/04_DAILY_DECISION_ENGINE.md §4 C3.7 (prose "HIGH ou VERY_HIGH",
 * qui reprend la terminologie du champ DB `athlete_state.fatigue_zone`
 * plutôt que l'échelle GREEN/AMBER/RED du moteur).
 *
 * Résolution retenue (documentée, non bloquante — voir résumé de session) :
 * `recent_load.level` reste GREEN/AMBER/RED comme les 5 autres dimensions,
 * conformément au vocabulaire canonique de docs/07_GLOSSARY.md. On mappe :
 *   GREEN ≈ LOW/NORMAL · AMBER ≈ HIGH · RED ≈ VERY_HIGH
 * Cette fonction est le SEUL endroit du moteur qui fait cette conversion —
 * centralisée pour éviter toute divergence ailleurs dans le code.
 */
/**
 * V0.3_007B — `completion_status = "skipped"` never counts: no activity
 * actually occurred, regardless of what was prescribed/logged. `done`/
 * `partial`/`replaced` all count using the ACTUAL performed
 * `intervention.load_profile` (never the prescribed one — for `replaced`
 * this is exactly what makes the count reflect reality) — deliberately no
 * fractional/partial weighting: intentionally conservative until a
 * validated duration/RPE-based load model exists (see
 * docs/11_DECISION_LOG.md V0.3_007B). This filter is belt-and-suspenders:
 * a `skipped` row should already have `intervention = null` and therefore
 * never reach this array at all (mapCompletedSessionRow excludes it
 * upstream) — this check guards against that invariant ever being violated,
 * never relies on it alone.
 */
export function computeRecentLoad(recentSessions: CompletedSessionSummary[], today: string): DimensionState {
  const t = PROVISIONAL_THRESHOLDS.recentLoad;

  const heavyOrModerateCount = recentSessions.filter((s) => {
    if (s.completion_status === "skipped") return false;
    const ageDays = daysBetween(s.date, today);
    if (ageDays < 0 || ageDays > t.windowDays) return false;
    if (isFixedLoadKind(s.intervention.kind)) return false;
    return s.intervention.load_profile === "HEAVY" || s.intervention.load_profile === "MODERATE";
  }).length;

  const isRed = heavyOrModerateCount >= t.redMinHeavyOrModerateSessions;
  const isAmber = !isRed && heavyOrModerateCount >= t.amberMinHeavyOrModerateSessions;

  const raw_signals = isRed ? ["recent_load_very_high"] : isAmber ? ["recent_load_high"] : [];
  const reasons = isRed || isAmber
    ? [`${heavyOrModerateCount} séance(s) HEAVY/MODERATE sur les ${t.windowDays} derniers jours`]
    : [];

  return {
    level: isRed ? "RED" : isAmber ? "AMBER" : "GREEN",
    score: 1 - Math.min(heavyOrModerateCount, t.redMinHeavyOrModerateSessions) / t.redMinHeavyOrModerateSessions,
    raw_signals,
    reasons,
  };
}
