/**
 * V2-DH-SPORT-GATE-01 (HPM 2026-10-26) — the lock of the four sports validations on every V2 DH count.
 *
 * A drill's unit (dhRepetitionUnitAttributionV2) is the ONLY way a V2 path states a DH count: generation, the daily
 * KEEP / MODIFY / REPLACE / manual session, the LIGHT regression, the validator and the stored-measure reader all read
 * it here. It comes only from a COMPLETE sign-off (catalog/dhRepetitionUnitCatalogV2.ts): the four decisions U (unit),
 * C (cue and criterion), D (dose) and S (safety), each signed with its own reference, and each binding the exact content
 * it signs. The sign-off opens only while the content served for the drill is identical to the content signed:
 * - C: the displayed drill name, the cue and success-criterion texts (fr-CH);
 * - D: the DH dose terms (dhDoseTermsV2), every value a DH count is drawn from;
 * - S: the vigilance texts in order, the light-week regression and the drill's terrains.
 * A partial sign-off (a unit alone, three decisions of four), a malformed one or a stale one (a text, a dose, a
 * vigilance changed since) gives no unit: in V2 ON (unit required), no quantitative DH prescription.
 *
 * V2-DH-SPORT-GATE-01B — every gate also requires the ONE common validation of the texts all DH sessions share (the
 * frame instructions and the session objectives, dhServedCommonContentV2), signed once for all drills. The gate binds
 * the CURRENT catalogue content; the validator (validatePrescriptionV2) makes sure a document stating a unit serves
 * exactly that content (dh_content_not_signed).
 */
import { CANONICAL_COACHING_LOCALE, COACHING_TEXT_CATALOG } from "../catalog/coachingTextCatalog.js";
import {
  DH_SPORT_COMMON_SIGNOFF_V2,
  DH_SPORT_DECISIONS_V2,
  DH_SPORT_SIGNOFFS_V2,
  DH_STATED_REPETITION_UNITS_V2,
  type DhRepetitionUnitAttributionV2,
  type DhSportCommonSignoffV2,
  type DhSportDecisionV2,
  type DhSportSignoffV2,
} from "../catalog/dhRepetitionUnitCatalogV2.js";
import { INTENT_CATALOG_V2_ENTRIES } from "../catalog/intentCatalogV2.js";
import { PLAN_DH_DURATION_STEPS_V2, PLAN_PROGRESSION_CAPS_V2, PLAN_ROLE_DOSES_V2 } from "../catalog/planDosePolicyV2.js";
import { DH_DRILL_PASSES_RANGE_V2, SESSION_DRILL_CATALOG_V2, SESSION_DRILL_NAMES_V2 } from "../catalog/sessionDrillCatalogV2.js";
import { DH_SESSION_FRAME_V2 } from "../catalog/sessionFrameV2.js";

/** What a sign-off binds: the content the engine serves for a drill. */
export interface DhServedSportContentV2 {
  drillName: string;
  cueText: string;
  criterionText: string;
  doseTerms: string;
  vigilanceTexts: readonly string[];
  regressesTo: string | null;
  terrains: readonly string[];
}

/** V2-DH-SPORT-GATE-01B — what the common validation binds: the texts every DH session shares. */
export interface DhServedCommonContentV2 {
  frame: readonly { role: string; text: string }[];
  objectives: Readonly<Record<string, string>>;
}

export type DhSportGateReasonV2 =
  | `${DhSportDecisionV2}_not_signed`
  | "malformed_signoff"
  | "unknown_drill"
  | "drill_name_differs"
  | "cue_text_differs"
  | "criterion_text_differs"
  | "dose_terms_differ"
  | "vigilances_differ"
  | "regression_differs"
  | "terrains_differ"
  | "common_not_signed"
  | "frame_differs"
  | "objectives_differ";

export type DhSportGateV2 = { open: true; attribution: DhRepetitionUnitAttributionV2 } | { open: false; reasons: readonly DhSportGateReasonV2[] };

const own = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined => (Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined);
const textOf = (id: string): string | undefined => own(COACHING_TEXT_CATALOG, id)?.text[CANONICAL_COACHING_LOCALE];

/**
 * D — every value a DH count is drawn from, as one exact text: the drill range, the progression cap, each week role's
 * load, duration, passes and per-cycle step (the daily LIGHT / REPLACE counts are role values), the availability steps.
 * Any change to one of them changes the text, so a dose signature no longer matches what is served.
 */
export function dhDoseTermsV2(): string {
  const roles = Object.entries(PLAN_ROLE_DOSES_V2).map(([role, d]) => `${role} ${d.dhLoad} ${d.dhDurationMin} min ${d.dhFocusedPasses} +${d.dhPassesPerCycle}/cycle`);
  const steps = PLAN_DH_DURATION_STEPS_V2.map((s) => `${s.durationMin} min max ${s.maxPasses}`);
  return [`range ${DH_DRILL_PASSES_RANGE_V2.min}-${DH_DRILL_PASSES_RANGE_V2.max}`, `cap ${PLAN_PROGRESSION_CAPS_V2.dhPassesMax}`, ...roles, ...steps].join("; ");
}

/** The content the engine serves for a drill (null: unknown drill, or a missing name or text). */
export function dhServedSportContentV2(drillId: string): DhServedSportContentV2 | null {
  const drill = own(SESSION_DRILL_CATALOG_V2, drillId);
  if (drill === undefined) return null;
  const drillName = own(SESSION_DRILL_NAMES_V2, drillId);
  const cueText = textOf(drill.cueId);
  const criterionText = textOf(drill.criterionId);
  const vigilanceTexts = drill.vigilanceIds.map(textOf);
  if (drillName === undefined || cueText === undefined || criterionText === undefined || vigilanceTexts.some((t) => t === undefined)) return null;
  return { drillName, cueText, criterionText, doseTerms: dhDoseTermsV2(), vigilanceTexts: vigilanceTexts as string[], regressesTo: drill.regressesTo ?? null, terrains: [...drill.compatibleTerrains] };
}

/**
 * V2-DH-SPORT-GATE-01B — the texts every DH session shares: each frame instruction with its block role, in frame
 * order, and the text of every DH session objective (null: a missing text).
 */
export function dhServedCommonContentV2(): DhServedCommonContentV2 | null {
  const frame = DH_SESSION_FRAME_V2.flatMap((block) => block.instructionIds.map((id) => ({ role: block.role, text: textOf(id) })));
  const objectives = INTENT_CATALOG_V2_ENTRIES.filter((i) => i.family === "dh_technical").map((i) => [i.intentId, textOf(`intent.${i.intentId}`)] as const);
  if (frame.some((f) => f.text === undefined) || objectives.some(([, text]) => text === undefined)) return null;
  return { frame: frame as { role: string; text: string }[], objectives: Object.fromEntries(objectives) as Record<string, string> };
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isStringList = (v: unknown): v is readonly string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const hasReference = (v: Record<string, unknown>) => typeof v.decision === "string" && v.decision.trim().length > 0;

/** The fields of each decision besides its reference, with their check: a decision is signed only when exactly well formed. */
const DECISION_FIELDS: Readonly<Record<DhSportDecisionV2, Readonly<Record<string, (v: unknown) => boolean>>>> = {
  unit: { unit: (v) => (DH_STATED_REPETITION_UNITS_V2 as readonly unknown[]).includes(v) },
  cue: { drillName: (v) => typeof v === "string", cueText: (v) => typeof v === "string", criterionText: (v) => typeof v === "string" },
  dose: { doseTerms: (v) => typeof v === "string" },
  safety: { vigilanceTexts: isStringList, regressesTo: (v) => v === null || typeof v === "string", terrains: isStringList },
};

function isSigned(part: unknown, decision: DhSportDecisionV2): boolean {
  if (!isRecord(part) || !hasReference(part)) return false;
  const fields = DECISION_FIELDS[decision];
  return Object.keys(part).length === Object.keys(fields).length + 1 && Object.entries(fields).every(([k, check]) => k in part && check(part[k]));
}

const isFrameLine = (v: unknown) => isRecord(v) && Object.keys(v).length === 2 && typeof v.role === "string" && typeof v.text === "string";

/** A common validation is signed only when exactly well formed: its reference, the frame lines and the objective texts. */
function isCommonSigned(common: unknown): common is DhSportCommonSignoffV2 {
  if (!isRecord(common) || !hasReference(common) || Object.keys(common).length !== 3) return false;
  return Array.isArray(common.frame) && common.frame.every(isFrameLine) && isRecord(common.objectives) && Object.values(common.objectives).every((t) => typeof t === "string");
}

/** V2-DH-SPORT-GATE-01B — why the common validation does not cover what every DH session serves (empty: it does). */
function commonReasons(common: unknown): DhSportGateReasonV2[] {
  const served = dhServedCommonContentV2();
  if (!isCommonSigned(common) || served === null) return ["common_not_signed"];
  const reasons: DhSportGateReasonV2[] = [];
  const frameMatches = common.frame.length === served.frame.length && common.frame.every((line, i) => line.role === served.frame[i]!.role && line.text === served.frame[i]!.text);
  if (!frameMatches) reasons.push("frame_differs");
  const signed = Object.entries(common.objectives);
  if (signed.length !== Object.keys(served.objectives).length || signed.some(([id, text]) => own(served.objectives, id) !== text)) reasons.push("objectives_differ");
  return reasons;
}

/**
 * The gate of a drill's sign-off: open (with the attribution) only when the four decisions are signed, every signed
 * content is the content served, and the common validation covers the shared DH texts; otherwise closed, with every reason.
 */
export function dhSportGateV2(drillId: string, signoff: unknown, common: unknown): DhSportGateV2 {
  const parts = isRecord(signoff) ? signoff : {};
  const reasons: DhSportGateReasonV2[] = DH_SPORT_DECISIONS_V2.filter((d) => !isSigned(parts[d], d)).map((d) => `${d}_not_signed` as const);
  if (Object.keys(parts).some((k) => !(DH_SPORT_DECISIONS_V2 as readonly string[]).includes(k))) reasons.push("malformed_signoff");
  const served = dhServedSportContentV2(drillId);
  if (served === null) return { open: false, reasons: [...reasons, "unknown_drill"] };
  const s = parts as unknown as DhSportSignoffV2;
  if (isSigned(s.cue, "cue")) {
    if (s.cue.drillName !== served.drillName) reasons.push("drill_name_differs");
    if (s.cue.cueText !== served.cueText) reasons.push("cue_text_differs");
    if (s.cue.criterionText !== served.criterionText) reasons.push("criterion_text_differs");
  }
  if (isSigned(s.dose, "dose") && s.dose.doseTerms !== served.doseTerms) reasons.push("dose_terms_differ");
  if (isSigned(s.safety, "safety")) {
    if (!sameList(s.safety.vigilanceTexts, served.vigilanceTexts)) reasons.push("vigilances_differ");
    if (s.safety.regressesTo !== served.regressesTo) reasons.push("regression_differs");
    if (!sameList(s.safety.terrains, served.terrains)) reasons.push("terrains_differ");
  }
  reasons.push(...commonReasons(common));
  if (reasons.length > 0) return { open: false, reasons };
  const references = [...DH_SPORT_DECISIONS_V2.map((d) => `${d}: ${s[d].decision}`), `common: ${(common as DhSportCommonSignoffV2).decision}`];
  return { open: true, attribution: { unit: s.unit.unit, provenance: references.join("; ") } };
}

/** The signed unit of a drill from its sign-off and the common validation, or null (missing, partial, stale or malformed: never trusted). */
export function dhRepetitionUnitAttributionFromSignoffV2(drillId: string, signoff: unknown, common: unknown): DhRepetitionUnitAttributionV2 | null {
  if (signoff === undefined) return null;
  const gate = dhSportGateV2(drillId, signoff, common);
  return gate.open ? gate.attribution : null;
}

/** The signed unit of a drill, or null (no complete, current sign-off and common validation in the real tables). */
export function dhRepetitionUnitAttributionV2(drillId: string): DhRepetitionUnitAttributionV2 | null {
  return dhRepetitionUnitAttributionFromSignoffV2(drillId, own(DH_SPORT_SIGNOFFS_V2, drillId), DH_SPORT_COMMON_SIGNOFF_V2);
}
