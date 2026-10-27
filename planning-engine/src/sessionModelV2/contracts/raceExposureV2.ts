/**
 * SPORT-PLAN-03 V2 contracts (HPM 2026-10-25) — planned and realised exposure around a race. NON-PRESCRIPTIVE: a pure
 * ledger, read by no summary, plan or daily decision yet; declarations are INPUTS (no store exists for them).
 *
 * Four kinds, never mixed: the race, official practice (reconnaissance, official training), habitual DH (planned DH
 * sessions and DH declared outside the app), recovery. A future race is a load to expect (« prevue »); a past one is
 * realised only when declared done — otherwise « passee_non_confirmee »; declared not done → « non_faite ». Minutes,
 * runs and their unit come from a declaration or stay null: never invented, never a default. One entry per date and
 * kind: a declaration replaces the planned entry of that date and kind (no double count).
 */
import type { DhRepetitionUnitV2 } from "./dhRepetitionUnitV2.js";

export const EXPOSURE_KINDS_V2 = ["race", "official_practice", "dh_habitual", "recovery"] as const;
export type ExposureKindV2 = (typeof EXPOSURE_KINDS_V2)[number];
export type ExposureStatusV2 = "prevue" | "realisee" | "passee_non_confirmee" | "non_faite";

export interface ExposureDeclarationV2 {
  date: string;
  kind: ExposureKindV2;
  done: boolean;
  minutes?: number | null;
  runs?: number | null;
  unit?: DhRepetitionUnitV2;
}

export interface ExposureEntryV2 {
  date: string;
  kind: ExposureKindV2;
  status: ExposureStatusV2;
  source: "race_calendar" | "plan" | "declaration";
  minutes: number | null;
  runs: number | null;
  unit: DhRepetitionUnitV2 | null;
}

const DAY_MS = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export function exposureLedgerV2(input: {
  races: readonly { startDate: string; endDate: string }[];
  /** Planned sessions of the two plan-backed kinds. */
  planned: readonly { date: string; kind: "dh_habitual" | "recovery" }[];
  declarations?: readonly ExposureDeclarationV2[];
  asOf: string;
}): ExposureEntryV2[] {
  const declarations = input.declarations ?? [];
  const entries = new Map<string, ExposureEntryV2>();
  const key = (date: string, kind: ExposureKindV2) => `${date}|${kind}`;
  const fromDeclaration = (d: ExposureDeclarationV2): ExposureEntryV2 => ({
    date: d.date,
    kind: d.kind,
    status: d.done ? "realisee" : "non_faite",
    source: "declaration",
    minutes: d.minutes ?? null,
    runs: d.runs ?? null,
    unit: d.unit ?? (d.runs != null ? "UNKNOWN" : null),
  });
  const expected = (date: string, kind: ExposureKindV2, source: ExposureEntryV2["source"]): ExposureEntryV2 => {
    const declared = declarations.find((d) => d.date === date && d.kind === kind);
    if (declared !== undefined) return fromDeclaration(declared);
    return { date, kind, status: date > input.asOf ? "prevue" : "passee_non_confirmee", source, minutes: null, runs: null, unit: null };
  };
  for (const race of input.races) for (let d = race.startDate; d <= race.endDate; d = addDays(d, 1)) entries.set(key(d, "race"), expected(d, "race", "race_calendar"));
  for (const p of input.planned) entries.set(key(p.date, p.kind), expected(p.date, p.kind, "plan"));
  // Declarations without a planned or calendar entry (official practice, DH outside the app): their own entries.
  for (const d of declarations) if (!entries.has(key(d.date, d.kind))) entries.set(key(d.date, d.kind), fromDeclaration(d));
  return [...entries.values()].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

/** Per kind: expected, realised (known minutes only), unconfirmed, not done. Nothing is converted or estimated. */
export function exposureSummaryV2(entries: readonly ExposureEntryV2[]): Readonly<Record<ExposureKindV2, { prevues: number; realisees: number; passeesNonConfirmees: number; nonFaites: number; minutesRealiseesConnues: number; realiseesSansDuree: number }>> {
  return Object.fromEntries(
    EXPOSURE_KINDS_V2.map((k) => {
      const of = entries.filter((e) => e.kind === k);
      const realised = of.filter((e) => e.status === "realisee");
      return [
        k,
        {
          prevues: of.filter((e) => e.status === "prevue").length,
          realisees: realised.length,
          passeesNonConfirmees: of.filter((e) => e.status === "passee_non_confirmee").length,
          nonFaites: of.filter((e) => e.status === "non_faite").length,
          minutesRealiseesConnues: realised.reduce((n, e) => n + (e.minutes ?? 0), 0),
          realiseesSansDuree: realised.filter((e) => e.minutes === null).length,
        },
      ];
    })
  ) as Record<ExposureKindV2, { prevues: number; realisees: number; passeesNonConfirmees: number; nonFaites: number; minutesRealiseesConnues: number; realiseesSansDuree: number }>;
}
