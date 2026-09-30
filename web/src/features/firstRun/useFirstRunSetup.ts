import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { loadAvailabilityWindows, saveAvailabilityWindows, type AvailabilityDayOfWeek, type AvailabilityWindow } from "../performanceSetup/availabilityRepo";
import { loadPerformanceSetupAnswers, savePerformanceSetup, type PerformanceSetupAnswers } from "../performanceSetup/performanceSetupRepo";
import { loadOnboardingAnswers } from "../athleteOnboarding/athleteOnboardingRepo";
import type { PrimaryGoal, RidingDay } from "../athleteOnboarding/onboardingOptions";
import { loadFirstName } from "../today/todayContextRepo";
import { generateTrainingPlan, type GenerateTrainingPlanResult } from "../trainingPlanGeneration/generateTrainingPlan";
import { acceptTrainingPlan, type AcceptTrainingPlanResult } from "../trainingPlanReview/acceptTrainingPlan";
import { getActivePlanVersionId, getTrainingPlanDrafts, getTrainingPlanReview } from "../trainingPlanReview/trainingPlanReviewRepo";
import type { TrainingPlanReview } from "../trainingPlanReview/trainingPlanReviewTypes";
import { availabilityWindows, resumeStep, type SetupStep, type Slot } from "./firstRunPlan";

// UX-09 — the reads and writes behind "your training → your plan", through
// the repositories the configuration page already uses (no new table, no new
// endpoint, no text here):
// - availability: athlete_availability_windows (replaced by the typical window);
// - performance profile: athlete_performance_profiles, merged with what is
//   already saved (strengths, priorities… are never erased);
// - plan: the generate-training-plan / accept-training-plan Edge Functions.

export interface FirstRunSetupData {
  firstName: string | null;
  ridingDays: RidingDay[];
  primaryGoal: PrimaryGoal | null;
  windows: AvailabilityWindow[];
  profile: PerformanceSetupAnswers;
  resume: SetupStep | "done";
  draftId: string | null;
}

export type FirstRunSetupLoad = { status: "loading" } | { status: "error" } | { status: "loaded"; data: FirstRunSetupData };

export function useFirstRunSetup() {
  const { athleteId } = useAuth();
  const [load, setLoad] = useState<FirstRunSetupLoad>({ status: "loading" });

  useEffect(() => {
    if (!athleteId) return;
    let active = true;
    Promise.all([getActivePlanVersionId(), getTrainingPlanDrafts(), loadAvailabilityWindows(), loadPerformanceSetupAnswers(), loadOnboardingAnswers(), loadFirstName().catch(() => null)])
      .then(([activeId, drafts, windows, profile, onboarding, firstName]) => {
        if (!active) return;
        const draftId = drafts[0]?.id ?? null;
        setLoad({
          status: "loaded",
          data: {
            firstName,
            ridingDays: onboarding.preferredRidingDays,
            primaryGoal: onboarding.primaryGoal,
            windows,
            profile,
            draftId,
            resume: resumeStep({ hasActivePlan: activeId !== null, latestDraftId: draftId, windows, profile }),
          },
        });
      })
      .catch(() => {
        if (active) setLoad({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [athleteId]);

  // Stable across renders (effects can depend on them).
  const actions = useMemo(
    () => ({
      saveTraining: (days: readonly AvailabilityDayOfWeek[], slot: Slot, existing: readonly AvailabilityWindow[]): Promise<AvailabilityWindow[]> =>
        saveAvailabilityWindows(athleteId!, availabilityWindows(days, slot), existing.map((w) => w.id)),
      saveProfile: (profile: PerformanceSetupAnswers): Promise<void> => savePerformanceSetup(athleteId!, profile),
      generate: (generationRequestId: string, durationWeeks: number): Promise<GenerateTrainingPlanResult> => generateTrainingPlan({ generationRequestId, durationWeeks }),
      loadPlan: (planVersionId: string): Promise<TrainingPlanReview> => getTrainingPlanReview(planVersionId),
      start: (planVersionId: string): Promise<AcceptTrainingPlanResult> => acceptTrainingPlan(planVersionId),
    }),
    [athleteId]
  );

  return { load, ...actions };
}
