// V0.3_008B — Athlete Onboarding UX Enhancement. Presentation copy only —
// no persisted values, nothing consumed by athleteOnboardingRepo.ts or the
// wizard's step/save logic. Kept separate from onboardingOptions.ts (which
// defines the actual option values written to the DB) so a wording change
// here can never accidentally touch what gets persisted.
import type { PrimaryGoal } from "./onboardingOptions";

export const INTRO_COPY = {
  title: "Welcome to NALYNT",
  subtitle: "Your AI performance coach starts by understanding you.",
  description:
    "Every athlete is different. Your goals, your schedule and your riding style shape your performance journey.",
  cta: "Build my athlete profile",
};

export interface StepCopy {
  title: string;
  hint?: string;
}

export const STEP_COPY: Record<1 | 2 | 3 | 4 | 5, StepCopy> = {
  1: { title: "What do you ride?", hint: "This helps NALYNT understand your riding environment." },
  2: {
    title: "Where are you today in your journey?",
    hint: "Knowing your current level helps NALYNT set realistic progression goals.",
  },
  3: { title: "What do you want NALYNT to help you achieve?" },
  4: {
    title: "How much time can you invest in your progression?",
    hint: "Your available time helps create realistic recommendations.",
  },
  5: {
    title: "When can NALYNT help you train around your riding?",
    hint: "Your schedule helps us build realistic recommendations.",
  },
};

export const PRIMARY_GOAL_DESCRIPTIONS: Record<PrimaryGoal, string> = {
  "Race performance": "Be faster when it matters.",
  Consistency: "Reduce mistakes and repeat your best riding.",
  "Technical skills": "Build stronger fundamentals and confidence.",
  Fitness: "Improve strength and endurance.",
  "Injury prevention": "Train smarter and stay on your bike.",
};

export const COMPLETION_COPY = {
  title: "Your athlete profile is ready.",
  checklist: ["Your discipline", "Your experience level", "Your goals", "Your availability"],
  text: "Next: set up your training profile and availability to generate your first training plan.",
  cta: "Set up my training plan",
};
