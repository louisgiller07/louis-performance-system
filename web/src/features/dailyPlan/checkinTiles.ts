import type { CheckinField } from "./coachInsights";
import type { CheckinRow } from "../checkin/checkinTypes";

// UX-04 / UX-07 — the athlete's own check-in answers as they were declared
// ("Ton état du jour" on Today and in History): values, never a judgment.
export interface CheckinTile {
  field: CheckinField;
  label: string;
  value: string;
  detail?: string;
}

export function checkinTiles(checkin: CheckinRow): CheckinTile[] {
  const tiles: CheckinTile[] = [];
  if (checkin.sleep_hours !== null) {
    const hours = `${String(checkin.sleep_hours).replace(".", ",")} h`;
    tiles.push({ field: "sleep", label: "Sommeil", value: hours, detail: checkin.sleep_quality !== null ? `qualité ${checkin.sleep_quality}/10` : undefined });
  }
  if (checkin.energy !== null) tiles.push({ field: "energy", label: "Énergie", value: `${checkin.energy}/10` });
  if (checkin.leg_fatigue !== null) tiles.push({ field: "leg_fatigue", label: "Fatigue jambes", value: `${checkin.leg_fatigue}/10` });
  if (checkin.grip_fatigue !== null) tiles.push({ field: "grip_fatigue", label: "Avant-bras", value: `${checkin.grip_fatigue}/10` });
  return tiles;
}
