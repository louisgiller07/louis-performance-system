import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { PrimaryButton } from "../../components/PrimaryButton";
import { SecondaryButton } from "../../components/SecondaryButton";
import { useEffectiveToday } from "../../lib/simulationClock";
import { formatDuration } from "../dailyPlan/durationLabels";
import { PRIMARY_GOAL_LABELS } from "../athleteOnboarding/onboardingCopy";
import {
  EQUIPMENT_LABELS,
  EQUIPMENT_OPTIONS,
  STRENGTH_EXPERIENCE_TIER_LABELS,
  STRENGTH_EXPERIENCE_TIER_OPTIONS,
  TERRAIN_LABELS,
  TERRAIN_OPTIONS,
  DH_TECHNICAL_TIER_OPTIONS,
  DH_TECHNICAL_TIER_LABELS,
  DH_TECHNICAL_TIER_DESCRIPTIONS,
  TECHNICAL_PRIORITY_OPTIONS,
  TECHNICAL_PRIORITY_LABELS,
  MAX_PRIORITY_AREAS,
  toggleOrderedPriority,
  type DhTechnicalTier,
  type Equipment,
  type StrengthExperienceTier,
  type Terrain,
} from "../performanceSetup/performanceSetupOptions";
import type { AvailabilityDayOfWeek, AvailabilityWindow } from "../performanceSetup/availabilityRepo";
import type { PerformanceSetupAnswers } from "../performanceSetup/performanceSetupRepo";
import type { TrainingPlanReview } from "../trainingPlanReview/trainingPlanReviewTypes";
import type { GenerateTrainingPlanError } from "../trainingPlanGeneration/generateTrainingPlanErrors";
import { translateWeekType } from "../trainingLabels/trainingLabels";
import { sessionTitle } from "../program/programPresentation";
import { FirstRunShell, ChoiceList } from "./FirstRunShell";
import { useFirstRunSetup, type FirstRunSetupData } from "./useFirstRunSetup";
import { WEEK_ORDER, initialSlot, initialTrainingDays, isValidSlot, nextSessions, planWeekCount, presetFor, type SetupStep, type Slot } from "./firstRunPlan";
import {
  BUILDING,
  CUSTOM_SLOT,
  DAY_FULL,
  DAY_SHORT,
  DEFAULT_PLAN_WEEKS,
  PLAN_DURATIONS,
  READY,
  SETUP_STEPS,
  SHELL,
  TIME_SLOTS,
  slotHours,
} from "./firstRunPresentation";

// UX-09 — "your training → your plan", the second half of the first run
// (/start once onboarding is completed): training days + one typical window,
// terrain, DH technical tier + 1–3 ordered priorities (UX-11A.5a.2b),
// strength experience (+ optional equipment), how long to prepare,
// then NALYNT builds the first plan and the rider starts it. Resumes where it
// stopped; every finer setting waits for "Affiner ton profil".
const BUILD_MIN_MS = 2800;
const SESSION_DAY = new Intl.DateTimeFormat("fr-CH", { weekday: "short", day: "numeric", month: "short" });

function sessionDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const label = SESSION_DAY.format(new Date(y!, m! - 1, d!));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function Chip({ pressed, onClick, children, label }: { pressed: boolean; onClick: () => void; children: string; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      onClick={onClick}
      className={`ux-press min-h-11 rounded-full border px-4 text-sm ${pressed ? "border-gold bg-gold text-bg" : "border-line text-ink/85 hover:border-gold/50"}`}
    >
      {children}
    </button>
  );
}

export function FirstRunSetup() {
  const setup = useFirstRunSetup();
  if (setup.load.status === "loading") return <FirstRunShell chapter={2} title={SHELL.loading} />;
  if (setup.load.status === "error") return <FirstRunShell chapter={2} title="Oups" question="Impossible de charger ta préparation. Réessaie dans un instant." />;
  if (setup.load.data.resume === "done") return <Navigate to="/today" replace />;
  return <FirstRunSteps data={setup.load.data} setup={setup} />;
}

function FirstRunSteps({ data, setup }: { data: FirstRunSetupData; setup: ReturnType<typeof useFirstRunSetup> }) {
  const navigate = useNavigate();
  const today = useEffectiveToday();
  const [step, setStep] = useState<SetupStep>(data.resume as SetupStep);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [windows, setWindows] = useState<AvailabilityWindow[]>(data.windows);
  const [days, setDays] = useState<AvailabilityDayOfWeek[]>(() => initialTrainingDays(data.windows, data.ridingDays));
  const [slot, setSlot] = useState<Slot | null>(() => initialSlot(data.windows));
  const [custom, setCustom] = useState(() => initialSlot(data.windows) !== null && presetFor(initialSlot(data.windows)) === null);
  const [profile, setProfile] = useState<PerformanceSetupAnswers>(data.profile);
  const [weeks, setWeeks] = useState<number>(DEFAULT_PLAN_WEEKS);

  const [requestId, setRequestId] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<GenerateTrainingPlanError | null>(null);
  const [built, setBuilt] = useState(false);
  const [review, setReview] = useState<TrainingPlanReview | null>(null);
  const { loadPlan } = setup;

  // Resuming on an already generated first plan: show it.
  useEffect(() => {
    if (step !== "ready" || review || !data.draftId) return;
    let active = true;
    loadPlan(data.draftId)
      .then((loaded) => {
        if (active) setReview(loaded);
      })
      .catch(() => {
        if (active) setError("Impossible de charger ton plan. Réessaie dans un instant.");
      });
    return () => {
      active = false;
    };
  }, [step, review, data.draftId, loadPlan]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Une erreur inattendue s'est produite. Réessaie.");
    } finally {
      setBusy(false);
    }
  }

  function toggleDay(day: AvailabilityDayOfWeek) {
    setDays((current) => (current.includes(day) ? current.filter((d) => d !== day) : WEEK_ORDER.filter((d) => d === day || current.includes(d))));
  }

  function toggle<T extends string>(list: readonly T[], value: T): T[] {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  }

  async function build() {
    const id = requestId ?? crypto.randomUUID();
    setRequestId(id);
    setBuildError(null);
    setBuilt(false);
    setStep("building");
    const [result] = await Promise.all([setup.generate(id, weeks), new Promise((resolve) => window.setTimeout(resolve, BUILD_MIN_MS))]);
    if (!result.ok) {
      setBuildError(result.error);
      // A retryable failure keeps the same intention (idempotent retry); any other needs a fresh one.
      if (!result.error.retryable) setRequestId(null);
      return;
    }
    setRequestId(null);
    try {
      const loaded = await setup.loadPlan(result.data.planVersionId);
      setBuilt(true);
      window.setTimeout(() => {
        setReview(loaded);
        setStep("ready");
      }, 1200);
    } catch {
      setBuildError({ code: "load_failed", message: "Ton plan est prêt, mais impossible de l'afficher. Réessaie.", retryable: true, action: "retry" } as GenerateTrainingPlanError);
    }
  }

  async function startPlan() {
    if (!review) return;
    await run(async () => {
      const result = await setup.start(review.version.id);
      if (!result.ok) throw new Error(result.error.message);
      navigate("/today", { replace: true, state: { firstDay: true } });
    });
  }

  if (step === "training") {
    const copy = SETUP_STEPS.training;
    const valid = days.length > 0 && isValidSlot(slot);
    return (
      <FirstRunShell
        chapter={copy.chapter}
        title={copy.title}
        question={copy.question}
        hint={copy.hint}
        onNext={() =>
          void run(async () => {
            setWindows(await setup.saveTraining(days, slot!, windows));
            setStep(
              profile.terrainAccess.length === 0
                ? "terrain"
                : profile.dhTechnicalTier === null || profile.priorityAreas.length === 0
                  ? "technique"
                  : profile.strengthExperienceTier === null
                    ? "strength"
                    : "preparation"
            );
          })
        }
        nextDisabled={!valid}
        busy={busy}
        error={error}
        stepKey="training"
      >
        <div role="group" aria-label={copy.question} className="grid grid-cols-7 gap-1.5">
          {WEEK_ORDER.map((day) => (
            <button
              key={day}
              type="button"
              aria-pressed={days.includes(day)}
              aria-label={DAY_FULL[day]}
              onClick={() => toggleDay(day)}
              className={`ux-press min-h-12 rounded-lg border text-xs font-semibold ${days.includes(day) ? "border-gold bg-gold text-bg" : "border-line text-ink/80"}`}
            >
              {DAY_SHORT[day]}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-base text-ink">{copy.slotQuestion}</p>
          <div role="group" aria-label={copy.slotQuestion} className="grid grid-cols-2 gap-2">
            {TIME_SLOTS.map((preset) => {
              const pressed = !custom && slot?.start === preset.start && slot?.end === preset.end;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => {
                    setCustom(false);
                    setSlot({ start: preset.start, end: preset.end });
                  }}
                  className={`ux-press min-h-14 rounded-lg border px-3 py-2 text-left ${pressed ? "border-gold bg-gold/12" : "border-line hover:border-gold/50"}`}
                >
                  <span className="block text-sm font-medium text-ink">{preset.label}</span>
                  <span className="block text-xs text-muted">{slotHours(preset.start, preset.end)}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            aria-pressed={custom}
            onClick={() => {
              setCustom(true);
              setSlot((current) => current ?? { start: "", end: "" });
            }}
            className={`ux-press min-h-11 rounded-lg border px-3 text-left text-sm ${custom ? "border-gold bg-gold/12 text-ink" : "border-line text-ink/80"}`}
          >
            {CUSTOM_SLOT}
          </button>
          {custom && (
            <div className="flex items-center gap-3">
              <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
                {copy.customStart}
                <input type="time" value={slot?.start ?? ""} onChange={(e) => setSlot((s) => ({ start: e.target.value, end: s?.end ?? "" }))} className="rounded border border-line bg-card px-3 py-2.5 text-base text-ink" />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
                {copy.customEnd}
                <input type="time" value={slot?.end ?? ""} onChange={(e) => setSlot((s) => ({ start: s?.start ?? "", end: e.target.value }))} className="rounded border border-line bg-card px-3 py-2.5 text-base text-ink" />
              </label>
            </div>
          )}
          <p className="text-xs text-muted">{copy.later}</p>
        </div>
      </FirstRunShell>
    );
  }

  if (step === "terrain") {
    const copy = SETUP_STEPS.terrain;
    return (
      <FirstRunShell
        chapter={copy.chapter}
        title={copy.title}
        question={copy.question}
        hint={copy.hint}
        onBack={() => setStep("training")}
        onNext={() => setStep("technique")}
        nextDisabled={profile.terrainAccess.length === 0}
        stepKey="terrain"
      >
        <ChoiceList<Terrain>
          options={TERRAIN_OPTIONS}
          labels={TERRAIN_LABELS}
          selected={profile.terrainAccess}
          onToggle={(value) => setProfile((p) => ({ ...p, terrainAccess: toggle(p.terrainAccess, value) }))}
          label={copy.question}
          columns={2}
        />
      </FirstRunShell>
    );
  }

  if (step === "technique") {
    const copy = SETUP_STEPS.technique;
    const tier = profile.dhTechnicalTier;
    const priorities = profile.priorityAreas;
    const complete = tier !== null && priorities.length >= 1 && priorities.length <= MAX_PRIORITY_AREAS;
    return (
      <FirstRunShell
        chapter={copy.chapter}
        title={copy.title}
        question={copy.question}
        onBack={() => setStep("terrain")}
        onNext={() =>
          void run(async () => {
            await setup.saveTechnique({ dhTechnicalTier: tier!, priorityAreas: priorities });
            setStep("strength");
          })
        }
        nextDisabled={!complete}
        busy={busy}
        error={error}
        stepKey="technique"
      >
        <ChoiceList<DhTechnicalTier>
          options={DH_TECHNICAL_TIER_OPTIONS}
          labels={DH_TECHNICAL_TIER_LABELS}
          descriptions={DH_TECHNICAL_TIER_DESCRIPTIONS}
          selected={tier ? [tier] : []}
          onToggle={(value) => setProfile((p) => ({ ...p, dhTechnicalTier: value }))}
          label={copy.question}
        />
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <p className="text-base text-ink">{copy.prioritiesQuestion}</p>
          <p className="text-xs text-muted">{copy.prioritiesHint}</p>
          <div role="group" aria-label={copy.prioritiesQuestion} className="flex flex-wrap gap-2">
            {TECHNICAL_PRIORITY_OPTIONS.map((item) => {
              const rank = priorities.indexOf(item) + 1;
              const full = rank === 0 && priorities.length >= MAX_PRIORITY_AREAS;
              return (
                <button
                  key={item}
                  type="button"
                  aria-pressed={rank > 0}
                  aria-label={rank > 0 ? `${TECHNICAL_PRIORITY_LABELS[item]}, ${copy.rank(rank)}` : TECHNICAL_PRIORITY_LABELS[item]}
                  disabled={full}
                  onClick={() => setProfile((p) => ({ ...p, priorityAreas: toggleOrderedPriority(p.priorityAreas, item) }))}
                  className={`ux-press flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm disabled:opacity-40 ${rank > 0 ? "border-gold bg-gold text-bg" : "border-line text-ink/85 hover:border-gold/50"}`}
                >
                  {rank > 0 && (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-bg text-xs font-bold text-gold" aria-hidden="true">
                      {rank}
                    </span>
                  )}
                  {TECHNICAL_PRIORITY_LABELS[item]}
                </button>
              );
            })}
          </div>
        </div>
      </FirstRunShell>
    );
  }

  if (step === "strength") {
    const copy = SETUP_STEPS.strength;
    return (
      <FirstRunShell
        chapter={copy.chapter}
        title={copy.title}
        question={copy.question}
        onBack={() => setStep("technique")}
        onNext={() =>
          void run(async () => {
            await setup.saveProfile(profile);
            setStep("preparation");
          })
        }
        nextDisabled={profile.strengthExperienceTier === null || profile.terrainAccess.length === 0}
        busy={busy}
        error={error}
        stepKey="strength"
      >
        <ChoiceList<StrengthExperienceTier>
          options={STRENGTH_EXPERIENCE_TIER_OPTIONS}
          labels={STRENGTH_EXPERIENCE_TIER_LABELS}
          selected={profile.strengthExperienceTier ? [profile.strengthExperienceTier] : []}
          onToggle={(value) => setProfile((p) => ({ ...p, strengthExperienceTier: value }))}
          label={copy.question}
        />
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <p className="text-base text-ink">{copy.equipmentQuestion}</p>
          <p className="text-xs text-muted">{copy.equipmentHint}</p>
          <div role="group" aria-label={copy.equipmentQuestion} className="flex flex-wrap gap-2">
            {EQUIPMENT_OPTIONS.map((item) => (
              <Chip key={item} pressed={profile.equipment.includes(item)} onClick={() => setProfile((p) => ({ ...p, equipment: toggle<Equipment>(p.equipment, item) }))}>
                {EQUIPMENT_LABELS[item]}
              </Chip>
            ))}
          </div>
        </div>
      </FirstRunShell>
    );
  }

  if (step === "preparation") {
    const copy = SETUP_STEPS.preparation;
    return (
      <FirstRunShell
        chapter={copy.chapter}
        title={copy.title}
        question={copy.question}
        onBack={() => setStep("strength")}
        onNext={() =>
          void run(async () => {
            await setup.saveProfile(profile);
            void build();
          })
        }
        nextLabel={copy.build}
        busy={busy}
        error={error}
        stepKey="preparation"
      >
        <div role="group" aria-label={copy.question} className="grid grid-cols-2 gap-2">
          {PLAN_DURATIONS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={weeks === n}
              onClick={() => setWeeks(n)}
              className={`ux-press min-h-14 rounded-lg border font-display text-2xl font-extrabold uppercase ${weeks === n ? "border-gold bg-gold/12 text-ink" : "border-line text-ink/80"}`}
            >
              {copy.weeks(n)}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-2 border-t border-line pt-4 text-sm text-ink/85">
          {copy.objectiveLabel}
          <input
            type="text"
            value={profile.seasonObjective ?? ""}
            placeholder={copy.objectivePlaceholder}
            maxLength={200}
            onChange={(e) => setProfile((p) => ({ ...p, seasonObjective: e.target.value }))}
            className="rounded-lg border border-line bg-card px-4 py-3 text-base text-ink placeholder:text-muted"
          />
        </label>
      </FirstRunShell>
    );
  }

  if (step === "building") {
    return (
      <FirstRunShell chapter={3} title={BUILDING.title} stepKey="building">
        <ul className="flex flex-col gap-3" aria-live="polite">
          {BUILDING.checklist.map((item, index) => (
            <li key={item} className="ux-enter flex items-center gap-3 text-lg text-ink" style={{ ["--d" as string]: `${300 + index * 450}ms` }}>
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-gold/60 text-gold" aria-hidden="true">
                ✓
              </span>
              {item}
            </li>
          ))}
        </ul>
        {built && <p className="ux-enter font-display text-2xl font-extrabold uppercase leading-tight text-gold">{BUILDING.done}</p>}
        {buildError && (
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4">
            <p role="alert" className="text-sm text-red-400">
              {buildError.message}
            </p>
            {buildError.retryable ? (
              <PrimaryButton onClick={() => void build()}>{BUILDING.retry}</PrimaryButton>
            ) : (
              <SecondaryButton onClick={() => setStep("terrain")}>{BUILDING.fixSetup}</SecondaryButton>
            )}
          </div>
        )}
      </FirstRunShell>
    );
  }

  // "ready" — the first plan, before the first day.
  const objective = profile.seasonObjective?.trim() || (data.primaryGoal ? PRIMARY_GOAL_LABELS[data.primaryGoal] : null);
  const firstWeek = review?.blocks[0]?.weeks[0] ?? null;
  const sessions = review ? nextSessions(review, today) : [];
  return (
    <FirstRunShell chapter={3} title={READY.title} stepKey="ready" onNext={() => void startPlan()} nextLabel={busy ? READY.starting : READY.start} nextDisabled={!review} busy={busy} error={error}>
      {!review ? (
        <div className="ux-skeleton h-64 rounded-2xl" aria-hidden="true" />
      ) : (
        <section aria-label={READY.title} className="ux-enter ux-grain relative overflow-hidden rounded-2xl border border-gold/40 bg-card p-5">
          <dl className="flex flex-col">
            {objective && (
              <div className="border-b border-line pb-3">
                <dt className="text-xs uppercase tracking-[0.18em] text-muted">{READY.preparation}</dt>
                <dd className="mt-1 font-display text-2xl font-extrabold uppercase leading-tight text-ink">{objective}</dd>
                <dd className="text-sm text-ink/70">{READY.weeks(planWeekCount(review))}</dd>
              </div>
            )}
            {firstWeek && translateWeekType(firstWeek.weekType) && (
              <div className="border-b border-line py-3">
                <dt className="text-xs uppercase tracking-[0.18em] text-muted">{READY.week1}</dt>
                <dd className="mt-1 font-display text-2xl font-extrabold uppercase leading-tight text-gold">{translateWeekType(firstWeek.weekType)}</dd>
              </div>
            )}
            {sessions.length > 0 && (
              <div className="pt-3">
                <dt className="text-xs uppercase tracking-[0.18em] text-muted">{READY.nextSessions}</dt>
                <dd>
                  <ul className="mt-1">
                    {sessions.map((session) => (
                      <li key={session.id} className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-b-0">
                        <span className="font-display text-lg font-extrabold uppercase text-ink">{sessionTitle(session)}</span>
                        <span className="text-right text-xs text-muted">
                          {sessionDay(session.date)}
                          {session.durationMin !== null ? ` · ${formatDuration(session.durationMin)}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
          </dl>
          <p className="mt-5 border-t border-line pt-4 font-display text-xl font-extrabold uppercase leading-tight text-ink">
            {READY.promise[0]}
            <br />
            <span className="text-gold">{READY.promise[1]}</span>
          </p>
        </section>
      )}
    </FirstRunShell>
  );
}
