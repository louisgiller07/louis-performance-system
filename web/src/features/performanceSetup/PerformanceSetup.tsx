import { StateCard } from "../../components/StateCard";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../../auth/AuthContext";
import { PageShell } from "../../components/PageShell";
import { AppHeader } from "../../components/AppHeader";
import { PrimaryButton } from "../../components/PrimaryButton";
import { SecondaryButton } from "../../components/SecondaryButton";
import { loadPerformanceSetupAnswers, savePerformanceSetup, PerformanceSetupError, type PerformanceSetupAnswers } from "./performanceSetupRepo";
import { loadAvailabilityWindows, type AvailabilityWindow } from "./availabilityRepo";
import {
  EQUIPMENT_OPTIONS,
  EQUIPMENT_LABELS,
  TERRAIN_OPTIONS,
  TERRAIN_LABELS,
  TECHNICAL_PRIORITY_OPTIONS,
  TECHNICAL_PRIORITY_LABELS,
  STRENGTH_EXPERIENCE_TIER_OPTIONS,
  STRENGTH_EXPERIENCE_TIER_LABELS,
  DH_TECHNICAL_TIER_OPTIONS,
  DH_TECHNICAL_TIER_LABELS,
  DH_TECHNICAL_TIER_DESCRIPTIONS,
  MAX_PRIORITY_AREAS,
  toggleOrderedPriority,
  type StrengthExperienceTier,
  type TechnicalPriority,
} from "./performanceSetupOptions";
import {
  loadOnboardingAnswers,
  saveDiscipline,
  saveCompetitionLevel,
  savePrimaryGoal,
  saveWeeklyTrainingHours,
  AthleteOnboardingError,
  type OnboardingAnswers,
} from "../athleteOnboarding/athleteOnboardingRepo";
import {
  DISCIPLINE_OPTIONS,
  COMPETITION_LEVEL_OPTIONS,
  PRIMARY_GOAL_OPTIONS,
  WEEKLY_TRAINING_HOURS_OPTIONS,
  type Discipline,
  type CompetitionLevel,
  type PrimaryGoal,
  type WeeklyTrainingHours,
} from "../athleteOnboarding/onboardingOptions";
import {
  DISCIPLINE_LABELS,
  COMPETITION_LEVEL_LABELS,
  PRIMARY_GOAL_LABELS,
  WEEKLY_TRAINING_HOURS_LABELS,
  RIDING_DAY_LABELS,
} from "../athleteOnboarding/onboardingCopy";
import { getActivePlanVersionId } from "../trainingPlanReview/trainingPlanReviewRepo";
import { TrainingPlanGenerationPanel } from "./TrainingPlanGenerationPanel";
import { AvailabilitySection, type AvailabilityGateState } from "./AvailabilitySection";
import { isLegacyAvailability, ridingDaysFromWindows, weekFromWindows, weekSummary } from "../availability/trainingAvailability";
import {
  ACTIONS,
  DAY_SHORT,
  DEFAULT_PLAN_WEEKS,
  EQUIPMENT,
  PLAN_DURATIONS,
  PRACTICE,
  PREPARATION,
  REFINE_PAGE,
  SECTION_TITLES,
  SLOTS,
  STRENGTHS,
  TERRAIN,
  hoursLabel,
  type RefineSectionId,
} from "./refinePresentation";

/**
 * /performance-setup — UX-10B-1 "Affiner ton profil". Six sections, each
 * showing what NALYNT already knows, with one [Modifier] and its own save,
 * through the existing repositories only:
 * - Ta pratique → athlete_onboarding_profiles (the answers of the first run,
 *   now editable) + the season objective (athlete_performance_profiles);
 * - Ton terrain / Ton matériel / Tes points forts → athlete_performance_profiles,
 *   written whole (savePerformanceSetup) merged with what is already saved,
 *   so a section never erases another one;
 * - Tes créneaux → AvailabilitySection (athlete_availability_windows);
 * - Ta préparation → TrainingPlanGenerationPanel (a NEW version; the current
 *   plan is never modified automatically, V0.5_036 gate kept: nothing is
 *   built while a section is being edited or without a saved window).
 * `declaredLimitations` stays unexposed (no engine rule consumes it).
 */

interface Practice {
  discipline: Discipline | null;
  competitionLevel: CompetitionLevel | null;
  primaryGoal: PrimaryGoal | null;
  weeklyTrainingHours: WeeklyTrainingHours | null;
  seasonObjective: string;
}

interface Saved {
  profile: PerformanceSetupAnswers;
  onboarding: OnboardingAnswers;
  windows: AvailabilityWindow[];
  hasActivePlan: boolean;
}

function toggleValue<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function joinLabels<T extends string>(values: readonly T[], labels: Record<T, string>): string {
  return values.map((value) => labels[value]).join(", ");
}

/** BUG-V2-1 — typed availability as "Physique · …" / "Vélo · …"; a legacy profile keeps its day / hours lines. */
function slotsSummary(windows: readonly AvailabilityWindow[]): string[] {
  if (!isLegacyAvailability(windows)) return weekSummary(weekFromWindows(windows));
  const order = [1, 2, 3, 4, 5, 6, 0];
  const groups = new Map<string, number[]>();
  for (const w of windows) {
    const key = `${w.startTime}|${w.endTime}`;
    groups.set(key, [...(groups.get(key) ?? []), w.dayOfWeek]);
  }
  return [...groups.entries()].map(([key, days]) => {
    const [start, end] = key.split("|");
    const dayList = order.filter((d) => days.includes(d)).map((d) => DAY_SHORT[d]).join(", ");
    return `${dayList} · ${hoursLabel(start!)} – ${hoursLabel(end!)}`;
  });
}

function Chips<T extends string>({ options, labels, selected, onToggle, label }: { options: readonly T[]; labels: Record<T, string>; selected: readonly T[]; onToggle: (value: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const pressed = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            aria-pressed={pressed}
            onClick={() => onToggle(option)}
            className={`ux-press min-h-11 rounded-full border px-4 text-sm ${pressed ? "border-gold bg-gold text-bg" : "border-line text-ink/85 hover:border-gold/50"}`}
          >
            {labels[option]}
          </button>
        );
      })}
    </div>
  );
}

/** UX-11A.5a.2b — ordered priorities: the rank is the click order, shown as 1 / 2 / 3. */
function OrderedPriorities({ selected, onToggle, label, rankLabel }: { selected: readonly TechnicalPriority[]; onToggle: (value: TechnicalPriority) => void; label: string; rankLabel: (n: number) => string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {TECHNICAL_PRIORITY_OPTIONS.map((option) => {
        const rank = selected.indexOf(option) + 1;
        const full = rank === 0 && selected.length >= MAX_PRIORITY_AREAS;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={rank > 0}
            aria-label={rank > 0 ? `${TECHNICAL_PRIORITY_LABELS[option]}, ${rankLabel(rank)}` : TECHNICAL_PRIORITY_LABELS[option]}
            disabled={full}
            onClick={() => onToggle(option)}
            className={`ux-press flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm disabled:opacity-40 ${rank > 0 ? "border-gold bg-gold text-bg" : "border-line text-ink/85 hover:border-gold/50"}`}
          >
            {rank > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-bg text-xs font-bold text-gold" aria-hidden="true">
                {rank}
              </span>
            )}
            {TECHNICAL_PRIORITY_LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}

function orderedLabels(values: readonly TechnicalPriority[]): string {
  return values.map((value, index) => `${index + 1}. ${TECHNICAL_PRIORITY_LABELS[value]}`).join(", ");
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-ink">{label}</p>
      {hint && <p className="-mt-1 text-xs text-muted">{hint}</p>}
      {children}
    </div>
  );
}

function Section({
  id,
  summary,
  open,
  onEdit,
  children,
  footer,
  justSaved,
}: {
  id: RefineSectionId;
  summary: ReactNode;
  open: boolean;
  onEdit?: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  justSaved?: boolean;
}) {
  const titleId = `refine-${id}`;
  return (
    <section id={id} aria-labelledby={titleId} className={`ux-enter rounded-2xl border bg-card p-5 ${open ? "border-gold/50" : "border-line"}`}>
      <div className="flex items-start justify-between gap-3">
        <h2 id={titleId} className="font-display text-2xl font-extrabold uppercase leading-none text-ink">
          {SECTION_TITLES[id]}
        </h2>
        {!open && onEdit && (
          <button type="button" onClick={onEdit} className="ux-press min-h-11 shrink-0 text-sm font-medium text-gold underline-offset-4 hover:underline" aria-label={`${ACTIONS.edit} ${SECTION_TITLES[id].toLowerCase()}`}>
            {ACTIONS.edit}
          </button>
        )}
      </div>
      {!open && <div className="mt-3 flex flex-col gap-1 text-sm text-ink/80">{summary}</div>}
      {!open && justSaved && (
        <div role="status" className="mt-3 border-t border-line pt-3 text-sm">
          <p className="text-gold">{`${ACTIONS.saved} ${ACTIONS.rebuildHint}`}</p>
          <a href="#preparation" className="ux-press mt-1 inline-flex min-h-11 items-center text-ink/80 underline-offset-4 hover:text-gold hover:underline">
            {ACTIONS.rebuildLink}
          </a>
        </div>
      )}
      {open && <div className="mt-4 flex flex-col gap-5">{children}</div>}
      {open && footer && <div className="mt-5 flex flex-col gap-2 border-t border-line pt-4">{footer}</div>}
    </section>
  );
}

export function PerformanceSetup() {
  const { athleteId } = useAuth();
  const [saved, setSaved] = useState<Saved | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState<RefineSectionId | null>(null);
  const [justSaved, setJustSaved] = useState<RefineSectionId | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState<PerformanceSetupAnswers | null>(null);
  const [practiceDraft, setPracticeDraft] = useState<Practice | null>(null);
  const [availabilityGate, setAvailabilityGate] = useState<AvailabilityGateState>({ loading: true, dirty: false, saving: false, hasSavedAvailability: false });

  useEffect(() => {
    if (!athleteId) return;
    let active = true;
    Promise.all([loadPerformanceSetupAnswers(), loadOnboardingAnswers(), loadAvailabilityWindows(), getActivePlanVersionId().catch(() => null)])
      .then(([profile, onboarding, windows, activeId]) => {
        if (active) setSaved({ profile, onboarding, windows, hasActivePlan: activeId !== null });
      })
      .catch(() => {
        if (active) setLoadError(REFINE_PAGE.loadError);
      });
    return () => {
      active = false;
    };
  }, [athleteId]);

  const onWindowsSaved = useCallback((windows: AvailabilityWindow[]) => {
    setSaved((current) => (current ? { ...current, windows } : current));
    setJustSaved("slots");
  }, []);

  if (loadError) {
    return (
      <PageShell header={<AppHeader />}>
        <StateCard tone="error" title="Profil indisponible">
          {loadError}
        </StateCard>
      </PageShell>
    );
  }

  if (!saved) {
    return (
      <PageShell header={<AppHeader />}>
        <div className="flex flex-col gap-3" aria-busy="true">
          <p className="sr-only">Chargement…</p>
          <div className="ux-skeleton h-24 rounded-2xl" />
          <div className="ux-skeleton h-32 rounded-2xl" />
          <div className="ux-skeleton h-32 rounded-2xl" />
        </div>
      </PageShell>
    );
  }

  const { profile, onboarding, windows } = saved;

  function edit(id: RefineSectionId) {
    setError(null);
    setJustSaved(null);
    setProfileDraft(profile);
    setPracticeDraft({
      discipline: onboarding.discipline,
      competitionLevel: onboarding.competitionLevel,
      primaryGoal: onboarding.primaryGoal,
      weeklyTrainingHours: onboarding.weeklyTrainingHours,
      seasonObjective: profile.seasonObjective ?? "",
    });
    setOpen(id);
  }

  function cancel() {
    setOpen(null);
    setError(null);
  }

  async function run(id: RefineSectionId, action: () => Promise<void>) {
    if (!athleteId || saving) return;
    setSaving(true);
    setError(null);
    try {
      await action();
      setOpen(null);
      setJustSaved(id);
    } catch (err) {
      setError(err instanceof PerformanceSetupError || err instanceof AthleteOnboardingError ? err.message : ACTIONS.genericError);
    } finally {
      setSaving(false);
    }
  }

  function saveProfile(id: RefineSectionId) {
    const next = profileDraft!;
    return run(id, async () => {
      await savePerformanceSetup(athleteId!, next);
      setSaved((current) => (current ? { ...current, profile: next } : current));
    });
  }

  function savePractice() {
    const draft = practiceDraft!;
    return run("practice", async () => {
      const id = athleteId!;
      if (draft.discipline !== onboarding.discipline) await saveDiscipline(id, draft.discipline!);
      if (draft.competitionLevel !== onboarding.competitionLevel) await saveCompetitionLevel(id, draft.competitionLevel!);
      if (draft.primaryGoal !== onboarding.primaryGoal) await savePrimaryGoal(id, draft.primaryGoal!);
      if (draft.weeklyTrainingHours !== onboarding.weeklyTrainingHours) await saveWeeklyTrainingHours(id, draft.weeklyTrainingHours!);
      const objective = draft.seasonObjective.trim() || null;
      const nextProfile = { ...profile, seasonObjective: objective };
      if (objective !== (profile.seasonObjective?.trim() || null)) await savePerformanceSetup(id, nextProfile);
      setSaved((current) =>
        current
          ? {
              ...current,
              profile: nextProfile,
              onboarding: {
                discipline: draft.discipline,
                competitionLevel: draft.competitionLevel,
                primaryGoal: draft.primaryGoal,
                weeklyTrainingHours: draft.weeklyTrainingHours,
                // P1 — the onboarding answer is only the first pre-fill of the slots: never edited here.
                preferredRidingDays: onboarding.preferredRidingDays,
              },
            }
          : current
      );
    });
  }

  const footer = (canSave: boolean, onSave: () => void) => (
    <>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <SecondaryButton onClick={cancel} disabled={saving} className="min-h-12 px-5">
          {ACTIONS.cancel}
        </SecondaryButton>
        <PrimaryButton onClick={onSave} disabled={!canSave || saving} className="flex-1">
          {saving ? ACTIONS.saving : ACTIONS.save}
        </PrimaryButton>
      </div>
    </>
  );

  const p = practiceDraft;
  const d = profileDraft;
  const practiceComplete = !!p && !!p.discipline && !!p.competitionLevel && !!p.primaryGoal && !!p.weeklyTrainingHours;
  // P1 riding days single source — the slots are the only truth after the first run (never preferred_riding_days).
  const ridingDays = ridingDaysFromWindows(windows);
  const ridingDaysLine = ridingDays.length > 0 ? PRACTICE.summaryRidingDays(joinLabels(ridingDays, RIDING_DAY_LABELS).toLowerCase()) : PRACTICE.noRidingSlot;
  function goToSlots() {
    edit("slots");
    document.getElementById("slots")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }
  const availabilityReady = open === "slots" ? !availabilityGate.loading && !availabilityGate.dirty && !availabilityGate.saving && availabilityGate.hasSavedAvailability : windows.length > 0;
  const configurationReady = (open === null || open === "slots" || open === "preparation") && !saving && availabilityReady;

  return (
    <PageShell header={<AppHeader />}>
      <section aria-labelledby="refine-title" className="ux-enter">
        <p className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.22em] text-gold">
          <span className="h-px w-5 bg-gold" aria-hidden="true" />
          {REFINE_PAGE.kicker}
        </p>
        <h1 id="refine-title" className="mt-3 font-display text-[clamp(2.5rem,11vw,3.25rem)] font-extrabold uppercase leading-[0.92] text-ink">
          {REFINE_PAGE.title}
        </h1>
        <p className="mt-2 text-base text-ink/80">{REFINE_PAGE.intro}</p>
        <p className="mt-3 border-l border-gold/60 pl-3 text-sm text-ink/75">{REFINE_PAGE.planNote}</p>
      </section>

      <Section
        id="practice"
        open={open === "practice"}
        onEdit={() => edit("practice")}
        justSaved={justSaved === "practice"}
        summary={
          <>
            <p className="font-medium text-ink">
              {[onboarding.discipline && DISCIPLINE_LABELS[onboarding.discipline], onboarding.competitionLevel && COMPETITION_LEVEL_LABELS[onboarding.competitionLevel]].filter(Boolean).join(" · ")}
            </p>
            {onboarding.primaryGoal && <p>{PRACTICE.summaryGoal(PRIMARY_GOAL_LABELS[onboarding.primaryGoal])}</p>}
            {onboarding.weeklyTrainingHours && (
              <p>{PRACTICE.summaryHours(WEEKLY_TRAINING_HOURS_LABELS[onboarding.weeklyTrainingHours])}</p>
            )}
            <p>{ridingDaysLine}</p>
            <button type="button" onClick={goToSlots} className="ux-press min-h-11 self-start text-sm font-medium text-gold underline-offset-4 hover:underline">
              {PRACTICE.editSlots}
            </button>
            {profile.seasonObjective && <p>{PRACTICE.summarySeason(profile.seasonObjective)}</p>}
          </>
        }
        footer={footer(practiceComplete, () => void savePractice())}
      >
        {p && (
          <>
            <Field label={PRACTICE.discipline}>
              <Chips options={DISCIPLINE_OPTIONS} labels={DISCIPLINE_LABELS} selected={p.discipline ? [p.discipline] : []} onToggle={(v) => setPracticeDraft({ ...p, discipline: v })} label={PRACTICE.discipline} />
            </Field>
            <Field label={PRACTICE.level}>
              <Chips options={COMPETITION_LEVEL_OPTIONS} labels={COMPETITION_LEVEL_LABELS} selected={p.competitionLevel ? [p.competitionLevel] : []} onToggle={(v) => setPracticeDraft({ ...p, competitionLevel: v })} label={PRACTICE.level} />
            </Field>
            <Field label={PRACTICE.goal}>
              <Chips options={PRIMARY_GOAL_OPTIONS} labels={PRIMARY_GOAL_LABELS} selected={p.primaryGoal ? [p.primaryGoal] : []} onToggle={(v) => setPracticeDraft({ ...p, primaryGoal: v })} label={PRACTICE.goal} />
            </Field>
            <Field label={PRACTICE.hours}>
              <Chips options={WEEKLY_TRAINING_HOURS_OPTIONS} labels={WEEKLY_TRAINING_HOURS_LABELS} selected={p.weeklyTrainingHours ? [p.weeklyTrainingHours] : []} onToggle={(v) => setPracticeDraft({ ...p, weeklyTrainingHours: v })} label={PRACTICE.hours} />
            </Field>
            <Field label={PRACTICE.ridingDays} hint={PRACTICE.ridingDaysHint}>
              <p className="text-sm text-ink/80">{ridingDaysLine}</p>
            </Field>
            <label className="flex flex-col gap-2 text-sm font-medium text-ink">
              {PRACTICE.seasonObjective}
              <input
                type="text"
                value={p.seasonObjective}
                maxLength={200}
                placeholder={PRACTICE.seasonObjectivePlaceholder}
                onChange={(e) => setPracticeDraft({ ...p, seasonObjective: e.target.value })}
                className="rounded-lg border border-line bg-bg px-4 py-3 text-base font-normal text-ink placeholder:text-muted"
              />
            </label>
          </>
        )}
      </Section>

      <Section
        id="terrain"
        open={open === "terrain"}
        onEdit={() => edit("terrain")}
        justSaved={justSaved === "terrain"}
        summary={<p>{profile.terrainAccess.length > 0 ? joinLabels(profile.terrainAccess, TERRAIN_LABELS) : TERRAIN.none}</p>}
        footer={footer(!!d && d.terrainAccess.length > 0, () => void saveProfile("terrain"))}
      >
        {d && (
          <Field label={TERRAIN.question} hint={TERRAIN.hint}>
            <Chips options={TERRAIN_OPTIONS} labels={TERRAIN_LABELS} selected={d.terrainAccess} onToggle={(v) => setProfileDraft({ ...d, terrainAccess: toggleValue(d.terrainAccess, v) })} label={TERRAIN.question} />
          </Field>
        )}
      </Section>

      <Section
        id="equipment"
        open={open === "equipment"}
        onEdit={() => edit("equipment")}
        justSaved={justSaved === "equipment"}
        summary={<p>{profile.equipment.length > 0 ? joinLabels(profile.equipment, EQUIPMENT_LABELS) : EQUIPMENT.bodyweight}</p>}
        footer={footer(true, () => void saveProfile("equipment"))}
      >
        {d && (
          <Field label={EQUIPMENT.question} hint={EQUIPMENT.hint}>
            <Chips options={EQUIPMENT_OPTIONS} labels={EQUIPMENT_LABELS} selected={d.equipment} onToggle={(v) => setProfileDraft({ ...d, equipment: toggleValue(d.equipment, v) })} label={EQUIPMENT.question} />
          </Field>
        )}
      </Section>

      <Section
        id="strengths"
        open={open === "strengths"}
        onEdit={() => edit("strengths")}
        justSaved={justSaved === "strengths"}
        summary={
          <>
            {profile.strengths.length > 0 && <p>{STRENGTHS.summaryStrengths(joinLabels(profile.strengths, TECHNICAL_PRIORITY_LABELS))}</p>}
            {profile.weaknesses.length > 0 && <p>{STRENGTHS.summaryWeaknesses(joinLabels(profile.weaknesses, TECHNICAL_PRIORITY_LABELS))}</p>}
            <p>{profile.priorityAreas.length > 0 ? STRENGTHS.summaryPriorities(orderedLabels(profile.priorityAreas)) : STRENGTHS.noPriorities}</p>
            <p>{profile.dhTechnicalTier ? STRENGTHS.summaryDhTier(DH_TECHNICAL_TIER_LABELS[profile.dhTechnicalTier]) : STRENGTHS.noDhTier}</p>
            {profile.strengthExperienceTier && <p>{STRENGTHS.summaryTier(STRENGTH_EXPERIENCE_TIER_LABELS[profile.strengthExperienceTier])}</p>}
          </>
        }
        footer={footer(!!d && d.priorityAreas.length <= MAX_PRIORITY_AREAS, () => void saveProfile("strengths"))}
      >
        {d && (
          <>
            <Field label={STRENGTHS.strengths}>
              <Chips options={TECHNICAL_PRIORITY_OPTIONS} labels={TECHNICAL_PRIORITY_LABELS} selected={d.strengths} onToggle={(v) => setProfileDraft({ ...d, strengths: toggleValue(d.strengths, v) })} label={STRENGTHS.strengths} />
            </Field>
            <Field label={STRENGTHS.weaknesses}>
              <Chips options={TECHNICAL_PRIORITY_OPTIONS} labels={TECHNICAL_PRIORITY_LABELS} selected={d.weaknesses} onToggle={(v) => setProfileDraft({ ...d, weaknesses: toggleValue(d.weaknesses, v) })} label={STRENGTHS.weaknesses} />
            </Field>
            <Field label={STRENGTHS.priorities} hint={STRENGTHS.prioritiesHint}>
              <OrderedPriorities selected={d.priorityAreas} onToggle={(v) => setProfileDraft({ ...d, priorityAreas: toggleOrderedPriority(d.priorityAreas, v) })} label={STRENGTHS.priorities} rankLabel={STRENGTHS.rank} />
              {d.priorityAreas.length > MAX_PRIORITY_AREAS && <p className="text-xs text-gold">{STRENGTHS.tooManyPriorities}</p>}
            </Field>
            <Field label={STRENGTHS.dhTier}>
              <div role="group" aria-label={STRENGTHS.dhTier} className="flex flex-col gap-2">
                {DH_TECHNICAL_TIER_OPTIONS.map((tier) => {
                  const pressed = d.dhTechnicalTier === tier;
                  return (
                    <button
                      key={tier}
                      type="button"
                      aria-pressed={pressed}
                      onClick={() => setProfileDraft({ ...d, dhTechnicalTier: tier })}
                      className={`ux-press rounded-lg border px-4 py-3 text-left ${pressed ? "border-gold bg-gold/12" : "border-line hover:border-gold/50"}`}
                    >
                      <span className="block text-sm font-medium text-ink">{DH_TECHNICAL_TIER_LABELS[tier]}</span>
                      <span className="block text-xs text-muted">{DH_TECHNICAL_TIER_DESCRIPTIONS[tier]}</span>
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label={STRENGTHS.tier}>
              <Chips<StrengthExperienceTier>
                options={STRENGTH_EXPERIENCE_TIER_OPTIONS}
                labels={STRENGTH_EXPERIENCE_TIER_LABELS}
                selected={d.strengthExperienceTier ? [d.strengthExperienceTier] : []}
                onToggle={(v) => setProfileDraft({ ...d, strengthExperienceTier: v })}
                label={STRENGTHS.tier}
              />
            </Field>
          </>
        )}
      </Section>

      <Section
        id="slots"
        open={open === "slots"}
        onEdit={() => edit("slots")}
        justSaved={justSaved === "slots"}
        summary={windows.length > 0 ? slotsSummary(windows).map((line) => <p key={line}>{line}</p>) : <p>{SLOTS.none}</p>}
        footer={
          <SecondaryButton onClick={cancel} className="min-h-12">
            {ACTIONS.close}
          </SecondaryButton>
        }
      >
        <AvailabilitySection bare onGateStateChange={setAvailabilityGate} onSaved={onWindowsSaved} ridingDays={onboarding.preferredRidingDays} />
      </Section>

      <section id="preparation" aria-labelledby="refine-preparation" className="ux-enter scroll-mt-4">
        <h2 id="refine-preparation" className="sr-only">
          {SECTION_TITLES.preparation}
        </h2>
        <TrainingPlanGenerationPanel
          configurationReady={configurationReady}
          durationPresets={PLAN_DURATIONS}
          defaultDurationWeeks={DEFAULT_PLAN_WEEKS}
          title={SECTION_TITLES.preparation}
          prominentTitle
          description={saved.hasActivePlan ? PREPARATION.description : PREPARATION.descriptionFirst}
          generateLabel={saved.hasActivePlan ? PREPARATION.rebuild : PREPARATION.build}
          durationQuestion={PREPARATION.question}
          notReadyHint={windows.length === 0 ? SLOTS.none : PREPARATION.notReady}
        />
      </section>
    </PageShell>
  );
}
