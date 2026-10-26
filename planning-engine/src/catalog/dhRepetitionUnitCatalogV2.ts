/**
 * V2-DH-UNIT-01 (HPM 2026-10-26) — the unit of ONE counted repetition of a DH drill (session-drills-v2.0).
 *
 * - `SECTION`: a defined section of a track; `FULL_RUN`: a complete descent.
 * - An attribution exists only from an explicit, signed definition: `provenance` names the decisions that define it.
 *   It is never inferred from a drill's id, name, cue or criterion.
 * - Append-only: a stored prescription stating a unit stays valid only while its drill keeps that attribution.
 * - A drill without an attribution has no reliable unit: a NEW count of it is not reliable (UNKNOWN). A FULL_RUN count
 *   also needs the descent time of the rider's track (track data, which NALYNT does not hold yet).
 *
 * V2-DH-SPORT-GATE-01 (HPM 2026-10-26) — the attribution comes only from a COMPLETE sports sign-off of the drill: four
 * separate decisions U (unit), C (cue and criterion), D (dose) and S (safety), each with its own decision reference and
 * the exact content it signs. This module holds the data only; the gate that reads it against the content served, and
 * the only reader of a drill's unit, is the Session Model V2 gate (dhSportGateV2).
 *
 * V2-DH-SPORT-GATE-01B (HPM 2026-10-26) — C also binds the drill's displayed name; the texts every DH session shares
 * (the frame instructions and the session objectives) are signed ONCE for all drills (DH_SPORT_COMMON_SIGNOFF_V2),
 * and every drill's gate requires that common validation too.
 *
 * EMPTY: no drill is signed, and the common validation is absent. Adding either is a sports decision, and it changes
 * the drill catalogue's manifest.
 */
export const DH_REPETITION_UNIT_CATALOG_V2_VERSION = "dh-repetition-units-v2.0";

/** The units a drill and a stored count may state; UNKNOWN is only ever a reading (never stored). */
export const DH_STATED_REPETITION_UNITS_V2 = ["SECTION", "FULL_RUN"] as const;
export type DhStatedRepetitionUnitV2 = (typeof DH_STATED_REPETITION_UNITS_V2)[number];

export interface DhRepetitionUnitAttributionV2 {
  unit: DhStatedRepetitionUnitV2;
  /** The decisions that define the unit (the four sign-off references). Required, never empty. */
  provenance: string;
}

/** V2-DH-SPORT-GATE-01 — the four decisions of a drill's sign-off, signed separately (`decision`: its reference, e.g. a coach decision and its date). */
export const DH_SPORT_DECISIONS_V2 = ["unit", "cue", "dose", "safety"] as const;
export type DhSportDecisionV2 = (typeof DH_SPORT_DECISIONS_V2)[number];

export interface DhSportSignoffV2 {
  /** U — the unit of one counted passage. */
  unit: { decision: string; unit: DhStatedRepetitionUnitV2 };
  /** C — the exact displayed drill name, cue and success-criterion texts signed (fr-CH). */
  cue: { decision: string; drillName: string; cueText: string; criterionText: string };
  /** D — the exact DH dose terms signed (dhDoseTermsV2). */
  dose: { decision: string; doseTerms: string };
  /** S — the exact vigilance texts (in order), the light-week regression and the terrains signed. */
  safety: { decision: string; vigilanceTexts: readonly string[]; regressesTo: string | null; terrains: readonly string[] };
}

// V2-DH-ATTRIBUTION-01, V2-DH-SPORT-GATE-01 — frozen: a sign-off is a sports decision, never added at runtime.
export const DH_SPORT_SIGNOFFS_V2: Readonly<Record<string, DhSportSignoffV2>> = Object.freeze({});

/**
 * V2-DH-SPORT-GATE-01B — the ONE validation of the texts every DH session shares, signed once (never once per drill):
 * the frame instructions (brief, warm-up, application, cool-down) and the session objectives. `decision`: its reference.
 */
export interface DhSportCommonSignoffV2 {
  decision: string;
  /** The exact frame instructions served with every DH session, by block role, in frame order (fr-CH). */
  frame: readonly { role: string; text: string }[];
  /** The exact text of every DH session objective, by intent id (fr-CH). */
  objectives: Readonly<Record<string, string>>;
}

// V2-DH-SPORT-GATE-01B — absent: the common DH texts are not validated, so no drill's gate can open.
export const DH_SPORT_COMMON_SIGNOFF_V2: DhSportCommonSignoffV2 | null = null;

/** A well-formed attribution: a stated unit and a non-empty provenance. */
export function isValidDhRepetitionUnitAttributionV2(value: unknown): value is DhRepetitionUnitAttributionV2 {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (DH_STATED_REPETITION_UNITS_V2 as readonly unknown[]).includes(v.unit) && typeof v.provenance === "string" && v.provenance.trim().length > 0 && Object.keys(v).length === 2;
}
