import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../../auth/AuthContext";
import { useEffectiveToday } from "../../lib/simulationClock";
import { addDays, formatCalendarDate } from "../../lib/date";
import { PrimaryButton } from "../../components/PrimaryButton";
import { SecondaryButton } from "../../components/SecondaryButton";
import { Select } from "../../components/Select";
import { createRace, deleteRace, loadRaces, updateRace, type Race } from "./raceRepo";
import { endDateFor, validateRaceDraft, type RaceDraft } from "./raceForm";
import { FORMAT_OPTION_LABELS, NEW_RACE_FORMATS, NEW_RACE_PRIORITIES, PRIORITY_OPTION_LABELS, RACE_FORMAT_DAYS, RACES, formatLabel, type RacePriority } from "./racePresentation";

// A09 — « Tes courses » (Affiner ton profil): the rider's upcoming races
// (create / edit / delete) and the last 30 days (read-only, delete only).
// M1 reads race_calendar live every day; the V2 plan only at generation,
// which NALYNT runs during the beta — so no « Reconstruire » here.

const RECENT_DAYS = 30;
const INPUT = "rounded-lg border border-line bg-bg px-4 py-3 text-base font-normal text-ink placeholder:text-muted disabled:text-muted";

type Editing = { id: string | null; draft: RaceDraft; original: Race | null };

function dates(race: { startDate: string; endDate: string }): string {
  return race.startDate === race.endDate ? formatCalendarDate(race.startDate) : `${formatCalendarDate(race.startDate)} – ${formatCalendarDate(race.endDate)}`;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium text-ink">
      {label}
      {hint && <span className="-mt-1 text-xs font-normal text-muted">{hint}</span>}
      {children}
    </label>
  );
}

export function RacesSection() {
  const { athleteId } = useAuth();
  const today = useEffectiveToday();
  const [races, setRaces] = useState<Race[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!athleteId) return;
    let active = true;
    loadRaces(athleteId, addDays(today, -RECENT_DAYS))
      .then((loaded) => active && setRaces(loaded))
      .catch(() => active && setLoadError(true));
    return () => {
      active = false;
    };
  }, [athleteId, today]);

  const upcoming = (races ?? []).filter((r) => r.endDate >= today);
  const recent = (races ?? []).filter((r) => r.endDate < today).reverse();

  function startCreate() {
    setNotice(null);
    setError(null);
    setConfirmDelete(null);
    setEditing({ id: null, original: null, draft: { eventName: "", startDate: today, endDate: endDateFor("HOT_TRAIL_2DAY", today, today), priority: "B", raceFormat: "HOT_TRAIL_2DAY" } });
  }

  function startEdit(race: Race) {
    setNotice(null);
    setError(null);
    setConfirmDelete(null);
    setEditing({ id: race.id, original: race, draft: { eventName: race.eventName, startDate: race.startDate, endDate: race.endDate, priority: race.priority, raceFormat: race.raceFormat } });
  }

  function setDraft(next: Partial<RaceDraft>) {
    setEditing((current) => {
      if (!current) return current;
      const draft = { ...current.draft, ...next };
      return { ...current, draft: { ...draft, endDate: endDateFor(draft.raceFormat, draft.startDate, draft.endDate) } };
    });
  }

  async function save() {
    if (!editing || !athleteId) return;
    const problem = validateRaceDraft(editing.draft, today);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = editing.id === null ? await createRace(athleteId, editing.draft) : await updateRace(editing.id, editing.draft);
      setRaces((current) => [...(current ?? []).filter((r) => r.id !== saved.id), saved].sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0)));
      setEditing(null);
      setNotice(RACES.saved);
    } catch {
      setError(RACES.saveError);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteRace(id);
      setRaces((current) => (current ?? []).filter((r) => r.id !== id));
      setConfirmDelete(null);
      setNotice(RACES.deleted);
    } catch {
      setError(RACES.deleteError);
    } finally {
      setBusy(false);
    }
  }

  const draft = editing?.draft;
  // An existing race keeps its A+ / its stored format readable and selectable: never silently converted.
  const priorityOptions: RacePriority[] = editing?.original?.priority === "A_PLUS" ? ["A_PLUS", ...NEW_RACE_PRIORITIES] : [...NEW_RACE_PRIORITIES];
  const storedFormat = editing?.original?.raceFormat ?? null;
  const keepsStoredFormat = editing?.original !== null && editing?.original !== undefined && !(NEW_RACE_FORMATS as readonly (string | null)[]).includes(storedFormat);
  const fixedDays = draft?.raceFormat ? RACE_FORMAT_DAYS[draft.raceFormat] : undefined;

  function raceLine(race: Race, actions: ReactNode) {
    return (
      <li key={race.id} className="flex flex-col gap-1 border-t border-line pt-3 first:border-t-0 first:pt-0">
        <p className="font-medium text-ink">{race.eventName}</p>
        <p>{dates(race)}</p>
        <p>{`${PRIORITY_OPTION_LABELS[race.priority]} · ${formatLabel(race.raceFormat)}`}</p>
        {confirmDelete === race.id ? (
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <span>{RACES.confirmDelete(race.eventName)}</span>
            <SecondaryButton onClick={() => setConfirmDelete(null)} disabled={busy} className="min-h-11 px-4">
              {RACES.cancel}
            </SecondaryButton>
            <PrimaryButton onClick={() => void remove(race.id)} disabled={busy} className="min-h-11 px-4">
              {RACES.confirm}
            </PrimaryButton>
          </div>
        ) : (
          <div className="mt-1 flex gap-4">{actions}</div>
        )}
      </li>
    );
  }

  const linkButton = (label: string, onClick: () => void, name: string) => (
    <button type="button" onClick={onClick} disabled={busy || editing !== null} aria-label={`${label} ${name}`} className="ux-press min-h-11 text-sm font-medium text-gold underline-offset-4 hover:underline disabled:text-muted">
      {label}
    </button>
  );

  return (
    <section id="races" aria-labelledby="refine-races" className={`ux-enter rounded-2xl border bg-card p-5 ${editing ? "border-gold/50" : "border-line"}`}>
      <div className="flex items-start justify-between gap-3">
        <h2 id="refine-races" className="font-display text-2xl font-extrabold uppercase leading-none text-ink">
          {RACES.title}
        </h2>
        {!editing && races !== null && (
          <button type="button" onClick={startCreate} disabled={busy} className="ux-press min-h-11 shrink-0 text-sm font-medium text-gold underline-offset-4 hover:underline">
            {RACES.add}
          </button>
        )}
      </div>

      {loadError && (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {RACES.loadError}
        </p>
      )}

      {editing && draft ? (
        <div className="mt-4 flex flex-col gap-5">
          <Field label={RACES.name}>
            <input type="text" value={draft.eventName} maxLength={120} onChange={(e) => setDraft({ eventName: e.target.value })} className={INPUT} />
          </Field>
          <Field label={RACES.format} hint={draft.raceFormat === "OTHER" ? RACES.otherFormatHint : undefined}>
            <Select value={draft.raceFormat ?? ""} onChange={(e) => setDraft({ raceFormat: e.target.value === "" ? null : e.target.value })}>
              {keepsStoredFormat && <option value={storedFormat ?? ""}>{`${formatLabel(storedFormat)} ${RACES.existing}`}</option>}
              {NEW_RACE_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {FORMAT_OPTION_LABELS[f]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={RACES.start}>
            <input type="date" value={draft.startDate} min={today} onChange={(e) => setDraft({ startDate: e.target.value })} className={INPUT} />
          </Field>
          <Field label={RACES.end} hint={fixedDays !== undefined ? RACES.endFromFormat : undefined}>
            <input type="date" value={draft.endDate} min={draft.startDate} disabled={fixedDays !== undefined} onChange={(e) => setDraft({ endDate: e.target.value })} className={INPUT} />
          </Field>
          <Field label={RACES.priority}>
            <Select value={draft.priority} onChange={(e) => setDraft({ priority: e.target.value as RacePriority })}>
              {priorityOptions.map((p) => (
                <option key={p} value={p}>
                  {p === "A_PLUS" ? `${PRIORITY_OPTION_LABELS.A_PLUS} ${RACES.existing}` : PRIORITY_OPTION_LABELS[p]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            {error && (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}
            <div className="flex gap-3">
              <SecondaryButton onClick={() => setEditing(null)} disabled={busy} className="min-h-12 px-5">
                {RACES.cancel}
              </SecondaryButton>
              <PrimaryButton onClick={() => void save()} disabled={busy} className="flex-1">
                {busy ? RACES.saving : RACES.save}
              </PrimaryButton>
            </div>
          </div>
        </div>
      ) : (
        races !== null && (
          <div className="mt-3 flex flex-col gap-4 text-sm text-ink/80">
            {upcoming.length === 0 ? (
              <p>{RACES.none}</p>
            ) : (
              <ul className="flex flex-col gap-3">{upcoming.map((r) => raceLine(r, <>{linkButton(RACES.edit, () => startEdit(r), r.eventName)}{linkButton(RACES.delete, () => setConfirmDelete(r.id), r.eventName)}</>))}</ul>
            )}
            {recent.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">{RACES.recent}</h3>
                <ul className="flex flex-col gap-3">{recent.map((r) => raceLine(r, linkButton(RACES.delete, () => setConfirmDelete(r.id), r.eventName)))}</ul>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="border-t border-line pt-3 text-gold">
                {notice}
              </p>
            )}
          </div>
        )
      )}
    </section>
  );
}
