import type { AvailabilityActivity, AvailabilityDayOfWeek, AvailabilityWindow, SaveAvailabilityWindowInput } from "../performanceSetup/availabilityRepo";
import type { RidingDay } from "../athleteOnboarding/onboardingOptions";

// BUG-V2-1 — the rider declares two separate weekly availabilities: physical
// training (strength, home trainer, running) and riding (bike / terrain). A
// day may have one, the other, both or none. Pure functions only.
//
// The planner reads a window's DAY and LENGTH (it must hold the session's
// duration), never its clock time: the editor asks for a duration only and
// stores it as one window per day and activity, from a fixed reference start
// (physical in the evening, riding from the morning).

/** Labels of the editor (shared with tests). */
export const AVAILABILITY_COPY = {
  physical: "Physique",
  physicalHint: "Renfo, home trainer, course.",
  riding: "Vélo",
  ridingHint: "Roulage, DH, terrain.",
  none: "Choisis au moins une disponibilité physique ou vélo.",
};

/** Minutes per day: 0 = not available. */
export interface DayAvailability {
  physical: number;
  riding: number;
}
export type WeekAvailability = Record<AvailabilityDayOfWeek, DayAvailability>;

/** Monday first, as everywhere in the app. */
export const WEEK_ORDER: readonly AvailabilityDayOfWeek[] = [1, 2, 3, 4, 5, 6, 0];

export interface DurationOption {
  minutes: number;
  label: string;
}

export const PHYSICAL_OPTIONS: readonly DurationOption[] = [
  { minutes: 0, label: "—" },
  { minutes: 30, label: "30 min" },
  { minutes: 45, label: "45 min" },
  { minutes: 60, label: "1 h" },
  { minutes: 75, label: "1 h 15" },
  { minutes: 90, label: "1 h 30" },
  { minutes: 120, label: "2 h" },
];

export const RIDING_OPTIONS: readonly DurationOption[] = [
  { minutes: 0, label: "—" },
  { minutes: 90, label: "1 h 30" },
  { minutes: 120, label: "2 h" },
  { minutes: 180, label: "3 h" },
  { minutes: 240, label: "Demi-journée" },
  { minutes: 600, label: "Journée" },
];

/** Reference start of the stored window (wall-clock, never read by the planner). */
const REFERENCE_START: Record<AvailabilityActivity, number> = { physical: 18 * 60, riding: 8 * 60 };

const RIDING_DAY_TO_DOW: Record<RidingDay, AvailabilityDayOfWeek> = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };

export function emptyWeek(): WeekAvailability {
  return { 0: { physical: 0, riding: 0 }, 1: { physical: 0, riding: 0 }, 2: { physical: 0, riding: 0 }, 3: { physical: 0, riding: 0 }, 4: { physical: 0, riding: 0 }, 5: { physical: 0, riding: 0 }, 6: { physical: 0, riding: 0 } };
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function windowMinutes(w: AvailabilityWindow): number {
  return Math.max(0, minutesOf(w.endTime) - minutesOf(w.startTime));
}

/** A legacy window longer than this is offered as riding time (a long day, typically the weekend), shorter as physical time. */
export const LEGACY_PHYSICAL_MAX_MINUTES = 120;

/**
 * What is saved, as an editable week (longest window per day and activity —
 * the planner's own rule). Legacy windows ("any", written before BUG-V2-1)
 * and the onboarding riding days are only a starting point, never saved
 * until the rider confirms: a short legacy window is offered as physical
 * time, a long one (> 2 h) as riding time, and an onboarding riding day as
 * a full riding day when nothing else says so. A brand-new rider starts
 * from the onboarding riding days.
 */
export function weekFromWindows(windows: readonly AvailabilityWindow[], ridingDays: readonly RidingDay[] = []): WeekAvailability {
  const week = emptyWeek();
  const typed = windows.some((w) => w.activity !== "any");
  for (const w of windows) {
    const minutes = windowMinutes(w);
    const asRiding = w.activity === "riding" || (w.activity === "any" && minutes > LEGACY_PHYSICAL_MAX_MINUTES);
    if (asRiding) week[w.dayOfWeek].riding = Math.max(week[w.dayOfWeek].riding, minutes);
    else week[w.dayOfWeek].physical = Math.max(week[w.dayOfWeek].physical, minutes);
  }
  if (!typed) {
    for (const day of ridingDays) {
      const dow = RIDING_DAY_TO_DOW[day];
      if (week[dow].riding === 0) week[dow].riding = 600;
    }
  }
  return week;
}

/** True once windows exist but none says physical or riding (a profile from before BUG-V2-1). */
export function isLegacyAvailability(windows: readonly AvailabilityWindow[]): boolean {
  return windows.length > 0 && windows.every((w) => w.activity === "any");
}

export function hasAnyAvailability(week: WeekAvailability): boolean {
  return WEEK_ORDER.some((d) => week[d].physical > 0 || week[d].riding > 0);
}

/** One window per day and activity with a duration; physical in the evening, riding from the morning. */
export function windowsFromWeek(week: WeekAvailability): SaveAvailabilityWindowInput[] {
  const out: SaveAvailabilityWindowInput[] = [];
  for (const dayOfWeek of WEEK_ORDER) {
    for (const activity of ["physical", "riding"] as const) {
      const minutes = week[dayOfWeek][activity];
      if (minutes <= 0) continue;
      const start = Math.min(REFERENCE_START[activity], 24 * 60 - minutes);
      out.push({ dayOfWeek, startTime: clock(start), endTime: clock(start + minutes), activity });
    }
  }
  return out;
}

/** The option list for a select, with the saved value kept when it is not a preset (e.g. 1 h 20). */
export function optionsWith(options: readonly DurationOption[], current: number): readonly DurationOption[] {
  return options.some((o) => o.minutes === current) ? options : [...options, { minutes: current, label: durationLabel(current) }].sort((a, b) => a.minutes - b.minutes);
}

export function durationLabel(minutes: number): string {
  const riding = RIDING_OPTIONS.find((o) => o.minutes === minutes && o.minutes >= 240);
  if (riding) return riding.label;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

const DAY_SHORT: Record<AvailabilityDayOfWeek, string> = { 1: "Lun", 2: "Mar", 3: "Mer", 4: "Jeu", 5: "Ven", 6: "Sam", 0: "Dim" };

/** "Physique · Lun 1 h 30, Mar 1 h 30" / "Vélo · Sam Journée" — one line per activity that has a day. */
export function weekSummary(week: WeekAvailability): string[] {
  const line = (activity: AvailabilityActivity, title: string) => {
    const days = WEEK_ORDER.filter((d) => week[d][activity] > 0).map((d) => `${DAY_SHORT[d]} ${durationLabel(week[d][activity])}`);
    return days.length > 0 ? `${title} · ${days.join(", ")}` : null;
  };
  return [line("physical", "Physique"), line("riding", "Vélo")].filter((l): l is string => l !== null);
}
