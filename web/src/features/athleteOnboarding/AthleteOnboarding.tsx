import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { HealthDataConsentCheckbox } from "../privacy/HealthDataConsentCheckbox";
import { PRIVACY_NOTICE_VERSION } from "../privacy/privacyNotice";
import { loadFirstName } from "../today/todayContextRepo";
import { FirstRunShell, ChoiceList } from "../firstRun/FirstRunShell";
import { ONBOARDING_STEPS, SHELL, greeting } from "../firstRun/firstRunPresentation";
import {
  loadOnboardingAnswers,
  saveDiscipline,
  saveCompetitionLevel,
  savePrimaryGoal,
  saveWeeklyTrainingHours,
  saveRidingDays,
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
import {
  PRIMARY_GOAL_DESCRIPTIONS,
  DISCIPLINE_LABELS,
  COMPETITION_LEVEL_LABELS,
  PRIMARY_GOAL_LABELS,
  WEEKLY_TRAINING_HOURS_LABELS,
  RIDING_DAY_LABELS,
} from "./onboardingCopy";

const STEP_IDS = ["discipline", "level", "goal", "hours", "ridingDays", "consent"] as const;
type StepId = (typeof STEP_IDS)[number];

/** First step whose answer is still missing — where the first run resumes after a refresh. */
function firstUnansweredStep(answers: {
  discipline: string | null;
  competitionLevel: string | null;
  primaryGoal: string | null;
  weeklyTrainingHours: string | null;
  preferredRidingDays: readonly string[];
}): number {
  if (!answers.discipline) return 0;
  if (!answers.competitionLevel) return 1;
  if (!answers.primaryGoal) return 2;
  if (!answers.weeklyTrainingHours) return 3;
  if (answers.preferredRidingDays.length === 0) return 4;
  return 5;
}

/**
 * V0.3_008A / UX-09 — the "who you are" part of the first run, rendered by
 * RequireAuth at /start while onboarding is not completed. Each step saves
 * immediately (athleteOnboardingRepo), so a refresh resumes at the first
 * unanswered step. The consent step completes onboarding (the DB requires the
 * explicit health-data consent for it); RequireAuth then renders the rest of
 * the first run (FirstRunSetup) on the same route, with no page in between.
 * Collects data only: no coaching logic, no engine call.
 */
export function AthleteOnboarding() {
  const { athleteId, refreshAthlete } = useAuth();
  const [loading, setLoading] = useState(true);
  const [healthDataConsent, setHealthDataConsent] = useState(false);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState<string | null>(null);

  const [discipline, setDiscipline] = useState<Discipline | null>(null);
  const [competitionLevel, setCompetitionLevel] = useState<CompetitionLevel | null>(null);
  const [primaryGoal, setPrimaryGoal] = useState<PrimaryGoal | null>(null);
  const [weeklyTrainingHours, setWeeklyTrainingHours] = useState<WeeklyTrainingHours | null>(null);
  const [ridingDays, setRidingDays] = useState<RidingDay[]>([]);

  useEffect(() => {
    if (!athleteId) return;
    let active = true;
    loadFirstName()
      .then((name) => {
        if (active) setFirstName(name);
      })
      .catch(() => {});
    loadOnboardingAnswers()
      .then((answers) => {
        if (!active) return;
        setDiscipline(answers.discipline);
        setCompetitionLevel(answers.competitionLevel);
        setPrimaryGoal(answers.primaryGoal);
        setWeeklyTrainingHours(answers.weeklyTrainingHours);
        setRidingDays(answers.preferredRidingDays);
        setStep(firstUnansweredStep(answers));
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

  const id: StepId = STEP_IDS[step]!;
  const canContinue =
    (id === "discipline" && !!discipline) ||
    (id === "level" && !!competitionLevel) ||
    (id === "goal" && !!primaryGoal) ||
    (id === "hours" && !!weeklyTrainingHours) ||
    (id === "ridingDays" && ridingDays.length > 0) ||
    (id === "consent" && ridingDays.length > 0 && !!competitionLevel && !!primaryGoal && !!weeklyTrainingHours && healthDataConsent);

  async function handleContinue() {
    if (!athleteId || saving || !canContinue) return;
    setError(null);
    setSaving(true);
    try {
      if (id === "discipline") await saveDiscipline(athleteId, discipline!);
      else if (id === "level") await saveCompetitionLevel(athleteId, competitionLevel!);
      else if (id === "goal") await savePrimaryGoal(athleteId, primaryGoal!);
      else if (id === "hours") await saveWeeklyTrainingHours(athleteId, weeklyTrainingHours!);
      else if (id === "ridingDays") await saveRidingDays(athleteId, ridingDays);
      else {
        await completeOnboarding(athleteId, {
          competitionLevel: competitionLevel!,
          primaryGoal: primaryGoal!,
          weeklyTrainingHours: weeklyTrainingHours!,
          preferredRidingDays: ridingDays,
          privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
        });
        // RequireAuth now renders the rest of the first run on this same route.
        await refreshAthlete();
        return;
      }
      setStep((s) => Math.min(s + 1, STEP_IDS.length - 1));
    } catch (err) {
      setError(err instanceof AthleteOnboardingError ? err.message : "Une erreur inattendue s'est produite. Réessaie.");
    } finally {
      setSaving(false);
    }
  }

  function handleBack() {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  }

  if (loading) {
    return <FirstRunShell chapter={0} title={SHELL.loading} />;
  }

  const copy = ONBOARDING_STEPS[id];
  return (
    <FirstRunShell
      chapter={copy.chapter}
      title={copy.title}
      question={copy.question}
      hint={"hint" in copy ? copy.hint : undefined}
      onBack={step > 0 ? handleBack : undefined}
      onNext={() => void handleContinue()}
      nextDisabled={!canContinue}
      busy={saving}
      error={error}
      stepKey={id}
    >
      {id === "discipline" && (
        <>
          <p className="-mt-3 font-display text-xl font-extrabold uppercase leading-tight text-gold">{greeting(firstName)}</p>
          <ChoiceList options={DISCIPLINE_OPTIONS} labels={DISCIPLINE_LABELS} selected={discipline ? [discipline] : []} onToggle={setDiscipline} label={copy.question} />
        </>
      )}
      {id === "level" && (
        <ChoiceList options={COMPETITION_LEVEL_OPTIONS} labels={COMPETITION_LEVEL_LABELS} selected={competitionLevel ? [competitionLevel] : []} onToggle={setCompetitionLevel} label={copy.question} />
      )}
      {id === "goal" && (
        <ChoiceList
          options={PRIMARY_GOAL_OPTIONS}
          labels={PRIMARY_GOAL_LABELS}
          descriptions={PRIMARY_GOAL_DESCRIPTIONS}
          selected={primaryGoal ? [primaryGoal] : []}
          onToggle={setPrimaryGoal}
          label={copy.question}
        />
      )}
      {id === "hours" && (
        <ChoiceList options={WEEKLY_TRAINING_HOURS_OPTIONS} labels={WEEKLY_TRAINING_HOURS_LABELS} selected={weeklyTrainingHours ? [weeklyTrainingHours] : []} onToggle={setWeeklyTrainingHours} label={copy.question} />
      )}
      {id === "ridingDays" && <ChoiceList options={RIDING_DAY_OPTIONS} labels={RIDING_DAY_LABELS} selected={ridingDays} onToggle={toggleRidingDay} label={copy.question} columns={2} />}
      {id === "consent" && <HealthDataConsentCheckbox checked={healthDataConsent} onChange={setHealthDataConsent} disabled={saving} />}
    </FirstRunShell>
  );
}
