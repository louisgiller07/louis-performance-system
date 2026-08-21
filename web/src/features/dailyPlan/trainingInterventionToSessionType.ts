// Mirrors head-coach-engine/src/mapping/trainingInterventionToDbSessionType.ts
// EXACTLY — this is the real, canonical, deterministic mapping the backend
// itself uses to compute decisions.final_session (the coarse public.session_type
// enum) from a DailyPlan's rich final_session TrainingIntervention. See
// head-coach-engine/src/supabase/mapping/dailyPlanToDecisionRow.ts:
//   final_session: mapTrainingInterventionToDbSessionType(dailyPlan.final_session)
// Reproduced here (not imported — web/ has no shared build boundary with
// head-coach-engine, same discipline as this file's own TrainingIntervention
// type mirror) so M5_003's post-session card can preselect the EXACT coarse
// session_type that was actually persisted for a given decisionId — never
// RECOVERY or any other invented default.
//
// CoarseSessionType is intentionally the same literal set as completedSession's
// own SessionType, spelled out locally rather than imported, so this file
// stays self-contained within the dailyPlan feature — the two types are
// structurally identical and interchangeable by TypeScript's own rules.
import type { TrainingIntervention } from "./dailyPlanTypes";

export type CoarseSessionType =
  | "STRENGTH_A"
  | "STRENGTH_B"
  | "AEROBIC_BASE"
  | "AEROBIC_INTERVALS"
  | "DH_TECHNICAL"
  | "DH_PERFORMANCE"
  | "RECOVERY"
  | "REST"
  | "BIKE_MAINTENANCE"
  | "RACE_PREP";

export function mapTrainingInterventionToSessionType(intervention: TrainingIntervention): CoarseSessionType {
  switch (intervention.kind) {
    case "STRENGTH_LOWER":
      return intervention.load_profile === "LIGHT" ? "STRENGTH_B" : "STRENGTH_A";
    case "STRENGTH_UPPER":
      return intervention.load_profile === "HEAVY" ? "STRENGTH_A" : "STRENGTH_B";
    case "POWER":
      return intervention.load_profile === "HEAVY" ? "STRENGTH_A" : "STRENGTH_B";
    case "GRIP_WORK":
      return intervention.load_profile === "HEAVY" ? "STRENGTH_A" : "STRENGTH_B";
    case "STRENGTH_FULL_LIGHT":
      return "STRENGTH_B";
    case "AEROBIC_BASE":
      return "AEROBIC_BASE";
    case "AEROBIC_INTERVALS":
      return "AEROBIC_INTERVALS";
    case "DH_TECHNICAL":
      return "DH_TECHNICAL";
    case "PUMPTRACK":
      return "DH_TECHNICAL";
    case "DH_PERFORMANCE":
      return "DH_PERFORMANCE";
    case "DH_LIGHT":
      return "RECOVERY";
    case "MOBILITY":
      return "RECOVERY";
    case "RECOVERY_ACTIVE":
      return "RECOVERY";
    case "REST":
      return "REST";
    case "BIKE_MAINTENANCE":
      return "BIKE_MAINTENANCE";
    case "RACE_ACTIVITY":
      return "RACE_PREP";
  }
}
