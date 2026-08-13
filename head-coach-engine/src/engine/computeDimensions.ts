import type { DailyCheckin } from "../types/checkin.js";
import type { DimensionLevel, DimensionState } from "../types/dimensions.js";
import { PROVISIONAL_THRESHOLDS } from "./provisionalThresholds.js";

function level(red: boolean, amber: boolean): DimensionLevel {
  if (red) return "RED";
  if (amber) return "AMBER";
  return "GREEN";
}

/**
 * Dimension `systemic` (sommeil + énergie globale). Chaque cause produit son
 * propre signal — surtout ne pas fusionner sous un seul `sleep_deficit`
 * générique (voir docs/11_DECISION_LOG.md 2026-08-13) :
 *  - `sleep_deficit` — durée de sommeil insuffisante (sleep_hours)
 *  - `sleep_quality_low` — qualité de sommeil perçue basse
 *  - `energy_low` — énergie perçue basse
 *  - `sleep_fragmented` — réveils nocturnes fréquents (sleep_wake_ups)
 * Plusieurs signaux peuvent co-exister le même jour ; chacun peut ensuite
 * être consommé indépendamment par les règles de domaine (docs/03_COACHING_MODEL.md §3).
 */
export function computeSystemic(checkin: DailyCheckin): DimensionState {
  const t = PROVISIONAL_THRESHOLDS.systemic;
  const raw_signals: string[] = [];
  const reasons: string[] = [];

  const sleepHoursRed = checkin.sleep_hours < t.redMaxSleepHours;
  const sleepHoursAmber = !sleepHoursRed && checkin.sleep_hours < t.amberMaxSleepHours;
  const sleepQualityLow = checkin.sleep_quality <= t.amberMaxSleepQuality;
  const energyLow = checkin.energy <= t.amberMaxEnergy;
  const sleepFragmented = checkin.sleep_wake_ups >= t.amberMinWakeUps;

  if (sleepHoursRed || sleepHoursAmber) {
    raw_signals.push("sleep_deficit");
    reasons.push(`Sommeil ${checkin.sleep_hours}h — durée insuffisante`);
  }
  if (sleepQualityLow) {
    raw_signals.push("sleep_quality_low");
    reasons.push(`Qualité de sommeil perçue ${checkin.sleep_quality}/10`);
  }
  if (energyLow) {
    raw_signals.push("energy_low");
    reasons.push(`Énergie perçue ${checkin.energy}/10`);
  }
  if (sleepFragmented) {
    raw_signals.push("sleep_fragmented");
    reasons.push(`${checkin.sleep_wake_ups} réveil(s) nocturne(s)`);
  }

  const isRed = sleepHoursRed;
  const isAmber = !isRed && (sleepHoursAmber || sleepQualityLow || energyLow || sleepFragmented);

  const lvl = level(isRed, isAmber);
  const score = Math.max(0, Math.min(10, checkin.sleep_hours)) / 10;
  return { level: lvl, score, raw_signals, reasons };
}

export function computeLegs(checkin: DailyCheckin): DimensionState {
  const t = PROVISIONAL_THRESHOLDS.fatigue;
  const isRed = checkin.leg_fatigue >= t.redMinFatigue;
  const isAmber = !isRed && checkin.leg_fatigue >= t.amberMinFatigue;
  const raw_signals = isRed || isAmber ? ["leg_fatigue_high"] : [];
  const reasons = isRed || isAmber ? [`Fatigue jambes ${checkin.leg_fatigue}/10`] : [];
  return {
    level: level(isRed, isAmber),
    score: 1 - checkin.leg_fatigue / 10,
    raw_signals,
    reasons,
  };
}

export function computeArmsGrip(checkin: DailyCheckin): DimensionState {
  const t = PROVISIONAL_THRESHOLDS.fatigue;
  const isRed = checkin.grip_fatigue >= t.redMinFatigue;
  const isAmber = !isRed && checkin.grip_fatigue >= t.amberMinFatigue;
  const raw_signals = isRed || isAmber ? ["grip_fatigue_high"] : [];
  const reasons = isRed || isAmber ? [`Fatigue grip ${checkin.grip_fatigue}/10`] : [];
  return {
    level: level(isRed, isAmber),
    score: 1 - checkin.grip_fatigue / 10,
    raw_signals,
    reasons,
  };
}

export function computeMental(checkin: DailyCheckin): DimensionState {
  const t = PROVISIONAL_THRESHOLDS.mental;
  const stressRed = checkin.work_stress >= t.redMinStress;
  const stressAmber = !stressRed && checkin.work_stress >= t.amberMinStress;
  const motivationRed = checkin.motivation <= t.redMaxMotivation;
  const motivationAmber = !motivationRed && checkin.motivation <= t.amberMaxMotivation;

  const isRed = stressRed || motivationRed;
  const isAmber = !isRed && (stressAmber || motivationAmber);

  const raw_signals: string[] = [];
  const reasons: string[] = [];
  if (stressRed || stressAmber) {
    raw_signals.push("stress_high");
    reasons.push(`Stress travail ${checkin.work_stress}/10`);
  }
  if (motivationRed || motivationAmber) {
    raw_signals.push("motivation_low");
    reasons.push(`Motivation ${checkin.motivation}/10`);
  }

  return {
    level: level(isRed, isAmber),
    score: (10 - checkin.work_stress + checkin.motivation) / 20,
    raw_signals,
    reasons,
  };
}

/**
 * Dimension `health` — reflète la douleur non-SAFETY (la douleur SAFETY est
 * gérée séparément en couche A, voir rules/safety.ts). Le comportement
 * obligatoire monitoring/protection/adaptation pour la douleur non-SAFETY
 * vit dans rules/painNonSafety.ts, pas ici — cette fonction ne fait que
 * classer la dimension.
 */
export function computeHealth(checkin: DailyCheckin): DimensionState {
  const t = PROVISIONAL_THRESHOLDS.health;
  const hasPain = checkin.pain === true;
  const isRed = hasPain && checkin.pain_intensity >= t.redMinPainIntensity;
  const isAmber = hasPain && !isRed;

  const raw_signals = hasPain ? [`pain_present${checkin.pain_location_code ? `_${checkin.pain_location_code}` : ""}`] : [];
  const reasons = hasPain
    ? [`Douleur déclarée intensité ${checkin.pain_intensity}/10${checkin.pain_location_code ? ` (${checkin.pain_location_code})` : ""}`]
    : [];

  return {
    level: level(isRed, isAmber),
    score: hasPain ? 1 - checkin.pain_intensity / 10 : 1,
    raw_signals,
    reasons,
  };
}
