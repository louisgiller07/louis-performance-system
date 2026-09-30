import type { DailyPlan } from "./dailyPlanTypes";

// UX-10A — what the day's decision means for the rider, in a coach's words.
// The engine keeps its own values (KEEP / MODIFY / REPLACE / REST, the
// confidence level); the rider never reads them: no "Maintenir", no
// "Adapter", no "Confiance moyenne". The "Pourquoi ?" sentence
// (coachInsights.coachWhy) says why.
export function missionStatus(dailyPlan: Pick<DailyPlan, "decision" | "planned_session_before">): string {
  switch (dailyPlan.decision) {
    case "MODIFY":
      return "NALYNT a adapté ton plan";
    case "REPLACE":
      return "NALYNT propose une séance adaptée";
    case "REST":
      return "NALYNT te propose de récupérer";
    default:
      return dailyPlan.planned_session_before === null ? "NALYNT te propose cette séance" : "Ta séance reste conforme au plan";
  }
}
