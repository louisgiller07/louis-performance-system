/**
 * `athlete_coaching_profiles` row → `RawContext.coaching_profile`
 * (V0.3_004A). Pure pass-through of two nullable text columns — no
 * validation/enum needed (unlike health_flags/planned_sessions), and no
 * fabricated default: a NULL column stays absent on the mapped object.
 */
import type { CoachingProfile } from "../../types/index.js";
import type { AthleteCoachingProfileRawRow } from "../repositories/athleteCoachingProfileRepo.js";

export function mapCoachingProfileRow(row: AthleteCoachingProfileRawRow): CoachingProfile {
  return {
    ...(row.technique_primary_focus !== null ? { technique_primary_focus: row.technique_primary_focus } : {}),
    ...(row.mental_pre_race_cue !== null ? { mental_pre_race_cue: row.mental_pre_race_cue } : {}),
  };
}
