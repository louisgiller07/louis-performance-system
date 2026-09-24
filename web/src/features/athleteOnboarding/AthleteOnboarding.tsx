import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { HealthDataConsentCheckbox } from "../privacy/HealthDataConsentCheckbox";
import { PRIVACY_NOTICE_VERSION } from "../privacy/privacyNotice";
import { PrimaryButton } from "../../components/PrimaryButton";
import {
  loadOnboardingAnswers,
  saveDiscipline,
  saveCompetitionLevel,
  savePrimaryGoal,
  saveWeeklyTrainingHours,
  completeOnboarding,
  AthleteOnboardingError,
} from "./athleteOnboardingRepo";
import {
  DISCIPLINE_OPTIONS,
  COMPETITION_LEVEL_OPTIONS,
  PRIMARY_GOAL_OPTIONS,
  WEEKLY_TRAINING_HOURS_OPTIONS,
  RIDING_DAY_OPTIONS,
  type Discipline,
  type CompetitionLevel,
  type PrimaryGoal,
  type WeeklyTrainingHours,
  type RidingDay,
} from "./onboardingOptions";
import { INTRO_COPY, STEP_COPY, PRIMARY_GOAL_DESCRIPTIONS, COMPLETION_COPY } from "./onboardingCopy";

const TOTAL_STEPS = 5;

/** First step whose answer is still missing — where the wizard resumes after a refresh. */
function firstUnansweredStep(answers: {
  discipline: string | null;
  competitionLevel: string | null;
  primaryGoal: string | null;
  weeklyTrainingHours: string | null;
}): number {
  if (!answers.discipline) return 1;
  if (!answers.competitionLevel) return 2;
  if (!answers.primaryGoal) return 3;
  if (!answers.weeklyTrainingHours) return 4;
  return 5;
}

interface ChoiceCardProps {
  label: string;
  description?: string;
  selected: boolean;
  onClick: () => void;
}

function ChoiceCard({ label, description, selected, onClick }: ChoiceCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border px-4 py-3.5 text-left transition-colors ${
        selected ? "border-gold bg-gold/10 text-ink" : "border-white/10 bg-bg text-ink hover:border-white/25"
      }`}
    >
      <span className="block text-base">{label}</span>
      {description && <span className="mt-1 block text-sm text-muted">{description}</span>}
    </button>
  );
}

/** Subtle, dependency-free fade/slide-in — re-triggers whenever its `key` changes (e.g. on step change). */
function FadeIn({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className={`transition-all duration-500 ease-out ${visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}>
      {children}
    </div>
  );
}

function ProgressBar({ step }: { step: number }) {
  return (
    <div className="flex w-full flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted">
        Step {step} of {TOTAL_STEPS}
      </p>
      <div className="flex gap-1.5">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full ${i < step ? "bg-gold" : "bg-white/10"}`} />
        ))}
      </div>
    </div>
  );
}

/**
 * V0.3_008A — Athlete Onboarding V1, Niveau 1 (obligatoire). Rendered by
 * RequireAuth exactly like AthleteBootstrap, one level further: once
 * `athleteResolution.status === "resolved"` but `!onboardingCompleted`. Each
 * step saves immediately on Continue (see athleteOnboardingRepo.ts) — no
 * local-only draft state — so a browser refresh resumes at the right step
 * instead of losing progress. Collects data only: no coaching logic, no
 * engine call.
 */
export function AthleteOnboarding() {
  const { athleteId, refreshAthlete } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  // Explicit health-data consent — never pre-checked, required to complete onboarding.
  const [healthDataConsent, setHealthDataConsent] = useState(false);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Only shown on a genuinely fresh start (nothing answered yet) — a
  // returning athlete resuming mid-wizard skips straight to their step.
  const [showIntro, setShowIntro] = useState(false);

  const [discipline, setDiscipline] = useState<Discipline | null>(null);
  const [competitionLevel, setCompetitionLevel] = useState<CompetitionLevel | null>(null);
  const [primaryGoal, setPrimaryGoal] = useState<PrimaryGoal | null>(null);
  const [weeklyTrainingHours, setWeeklyTrainingHours] = useState<WeeklyTrainingHours | null>(null);
  const [ridingDays, setRidingDays] = useState<RidingDay[]>([]);

  useEffect(() => {
    if (!athleteId) return;
    let active = true;

    loadOnboardingAnswers()
      .then((answers) => {
        if (!active) return;
        setDiscipline(answers.discipline);
        setCompetitionLevel(answers.competitionLevel);
        setPrimaryGoal(answers.primaryGoal);
        setWeeklyTrainingHours(answers.weeklyTrainingHours);
        setRidingDays(answers.preferredRidingDays);
        const resumeStep = firstUnansweredStep(answers);
        setStep(resumeStep);
        setShowIntro(resumeStep === 1);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError("Impossible de charger ton profil. Réessaie.");
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [athleteId]);

  function toggleRidingDay(day: RidingDay) {
    setRidingDays((current) => (current.includes(day) ? current.filter((d) => d !== day) : [...current, day]));
  }

  async function handleContinue() {
    if (!athleteId || saving) return;
    setError(null);
    setSaving(true);
    try {
      if (step === 1 && discipline) {
        await saveDiscipline(athleteId, discipline);
      } else if (step === 2 && competitionLevel) {
        await saveCompetitionLevel(athleteId, competitionLevel);
      } else if (step === 3 && primaryGoal) {
        await savePrimaryGoal(athleteId, primaryGoal);
      } else if (step === 4 && weeklyTrainingHours) {
        await saveWeeklyTrainingHours(athleteId, weeklyTrainingHours);
      } else if (step === 5 && ridingDays.length > 0 && competitionLevel && primaryGoal && weeklyTrainingHours && healthDataConsent) {
        await completeOnboarding(athleteId, {
          competitionLevel,
          primaryGoal,
          weeklyTrainingHours,
          preferredRidingDays: ridingDays,
          privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
        });
        setDone(true);
        setSaving(false);
        return;
      }
      setStep((s) => Math.min(s + 1, TOTAL_STEPS));
    } catch (err) {
      setError(err instanceof AthleteOnboardingError ? err.message : "Une erreur inattendue s'est produite. Réessaie.");
    } finally {
      setSaving(false);
    }
  }

  function handleBack() {
    setError(null);
    setStep((s) => Math.max(1, s - 1));
  }

  async function handleEnter() {
    await refreshAthlete();
    // A brand-new athlete has no training plan yet: the next step is always the setup page.
    navigate("/performance-setup", { replace: true });
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-bg text-sm text-muted">Loading…</div>;
  }

  if (showIntro) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4 py-8 text-center">
        <FadeIn>
          <div className="w-full max-w-105">
            <p className="text-2xl font-bold uppercase tracking-[0.2em] text-gold">{INTRO_COPY.title}</p>
            <p className="mt-4 text-lg font-semibold text-ink">{INTRO_COPY.subtitle}</p>
            <p className="mt-4 text-sm leading-relaxed text-muted">{INTRO_COPY.description}</p>
            <PrimaryButton
              onClick={() => setShowIntro(false)}
              className="mt-8 w-full min-h-12.5 text-base tracking-wide"
            >
              {INTRO_COPY.cta}
            </PrimaryButton>
          </div>
        </FadeIn>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4 py-8 text-center">
        <FadeIn>
          <div className="w-full max-w-105">
            <p className="text-2xl font-bold uppercase tracking-[0.2em] text-gold">Nalynt</p>
            <p className="mt-6 text-xl font-bold text-ink">{COMPLETION_COPY.title}</p>
            <ul className="mt-6 flex flex-col gap-2 text-left">
              {COMPLETION_COPY.checklist.map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm text-ink">
                  <span className="text-gold" aria-hidden="true">
                    ✓
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm text-muted">{COMPLETION_COPY.text}</p>
            <PrimaryButton onClick={() => void handleEnter()} className="mt-8 w-full min-h-12.5 text-base tracking-wide">
              {COMPLETION_COPY.cta}
            </PrimaryButton>
          </div>
        </FadeIn>
      </div>
    );
  }

  const canContinue =
    (step === 1 && !!discipline) ||
    (step === 2 && !!competitionLevel) ||
    (step === 3 && !!primaryGoal) ||
    (step === 4 && !!weeklyTrainingHours) ||
    (step === 5 && ridingDays.length > 0 && !!competitionLevel && !!primaryGoal && !!weeklyTrainingHours && healthDataConsent);

  return (
    <div className="flex min-h-screen flex-col items-center bg-bg px-4 py-8">
      <div className="flex w-full max-w-105 flex-col gap-6">
        <ProgressBar step={step} />

        <FadeIn key={step}>
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div>
                <h1 className="text-2xl font-bold text-ink">{STEP_COPY[1].title}</h1>
                {STEP_COPY[1].hint && <p className="mt-2 text-sm text-muted">{STEP_COPY[1].hint}</p>}
              </div>
              <div className="flex flex-col gap-2.5">
                {DISCIPLINE_OPTIONS.map((option) => (
                  <ChoiceCard key={option} label={option} selected={discipline === option} onClick={() => setDiscipline(option)} />
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-4">
              <div>
                <h1 className="text-2xl font-bold text-ink">{STEP_COPY[2].title}</h1>
                {STEP_COPY[2].hint && <p className="mt-2 text-sm text-muted">{STEP_COPY[2].hint}</p>}
              </div>
              <div className="flex flex-col gap-2.5">
                {COMPETITION_LEVEL_OPTIONS.map((option) => (
                  <ChoiceCard
                    key={option}
                    label={option}
                    selected={competitionLevel === option}
                    onClick={() => setCompetitionLevel(option)}
                  />
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-4">
              <div>
                <h1 className="text-2xl font-bold text-ink">{STEP_COPY[3].title}</h1>
                {STEP_COPY[3].hint && <p className="mt-2 text-sm text-muted">{STEP_COPY[3].hint}</p>}
              </div>
              <div className="flex flex-col gap-2.5">
                {PRIMARY_GOAL_OPTIONS.map((option) => (
                  <ChoiceCard
                    key={option}
                    label={option}
                    description={PRIMARY_GOAL_DESCRIPTIONS[option]}
                    selected={primaryGoal === option}
                    onClick={() => setPrimaryGoal(option)}
                  />
                ))}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col gap-4">
              <div>
                <h1 className="text-2xl font-bold text-ink">{STEP_COPY[4].title}</h1>
                {STEP_COPY[4].hint && <p className="mt-2 text-sm text-muted">{STEP_COPY[4].hint}</p>}
              </div>
              <div className="flex flex-col gap-2.5">
                {WEEKLY_TRAINING_HOURS_OPTIONS.map((option) => (
                  <ChoiceCard
                    key={option}
                    label={option}
                    selected={weeklyTrainingHours === option}
                    onClick={() => setWeeklyTrainingHours(option)}
                  />
                ))}
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="flex flex-col gap-4">
              <div>
                <h1 className="text-2xl font-bold text-ink">{STEP_COPY[5].title}</h1>
                {STEP_COPY[5].hint && <p className="mt-2 text-sm text-muted">{STEP_COPY[5].hint}</p>}
                <p className="mt-1 text-sm text-muted">Select all that apply.</p>
              </div>
              <div className="flex flex-col gap-2.5">
                {RIDING_DAY_OPTIONS.map((option) => (
                  <ChoiceCard
                    key={option}
                    label={option}
                    selected={ridingDays.includes(option)}
                    onClick={() => toggleRidingDay(option)}
                  />
                ))}
              </div>
              <HealthDataConsentCheckbox checked={healthDataConsent} onChange={setHealthDataConsent} disabled={saving} />
            </div>
          )}
        </FadeIn>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          {step > 1 && (
            <button
              type="button"
              onClick={handleBack}
              disabled={saving}
              className="min-h-12.5 flex-1 rounded border border-white/10 text-sm font-semibold uppercase tracking-wide text-muted hover:border-white/25 disabled:opacity-40"
            >
              Back
            </button>
          )}
          <PrimaryButton
            onClick={() => void handleContinue()}
            disabled={!canContinue || saving}
            className="min-h-12.5 flex-1 text-base tracking-wide"
          >
            {saving ? "Saving…" : "Continue"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
