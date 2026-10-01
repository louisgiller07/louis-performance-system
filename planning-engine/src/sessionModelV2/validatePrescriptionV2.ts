/**
 * UX-11A.5b.2 — pure structural validator of a Prescription V2 document
 * (ADR UX-11A.5b.0.1 / 5b.2).
 *
 * Checks the locked contract and referential integrity against the V2
 * catalogues (ids exist, text ids have the right kind). It does NOT check
 * coaching compatibility (level, equipment, family composition, template):
 * that belongs to the future generator and templates.
 *
 * Returns every issue found (never throws), each with a JSON path and a
 * stable code.
 */
import { SESSION_EXERCISE_CATALOG_V2, SESSION_EXERCISE_ROLES_V2 } from "../catalog/sessionExerciseCatalogV2.js";
import { SESSION_DRILL_CATALOG_V2, DH_DRILL_PASSES_RANGE_V2 } from "../catalog/sessionDrillCatalogV2.js";
import { INTENT_CATALOG_V2, INTENT_SESSION_KINDS_V2, SESSION_FAMILIES_V2 } from "../catalog/intentCatalogV2.js";
import { PROTOCOL_CATALOG_V2, ENDURANCE_ACTIVITIES_V2, PROTOCOL_BLOCK_FOCUS_V2 } from "../catalog/protocolCatalogV2.js";
import { COACHING_TEXT_CATALOG, type CoachingTextKind } from "../catalog/coachingTextCatalog.js";
import { SESSION_BLOCK_ROLES_V2 } from "../catalog/sessionFrameV2.js";
import { SESSION_MODEL_V2_MANIFEST_KEYS } from "./catalogManifest.js";
import { PRESCRIPTION_V2_ITEM_KINDS, PRESCRIPTION_V2_SCHEMA_VERSION, type PrescriptionV2 } from "./prescriptionV2.js";

export type PrescriptionV2IssueCode =
  | "not_an_object"
  | "invalid_schema_version"
  | "invalid_family"
  | "invalid_session_kind"
  | "unknown_intent"
  | "intent_family_mismatch"
  | "unknown_protocol"
  | "invalid_manifest"
  | "empty_id"
  | "duplicate_block_id"
  | "duplicate_prescription_item_id"
  | "derived_from_not_allowed"
  | "invalid_block"
  | "invalid_block_role"
  | "invalid_block_focus"
  | "invalid_item_kind"
  | "invalid_exercise_role"
  | "unknown_exercise"
  | "unknown_drill"
  | "unknown_text"
  | "invalid_sets"
  | "invalid_measure_type"
  | "invalid_measure"
  | "invalid_range"
  | "pass_count_out_of_range"
  | "drill_with_role"
  | "empty_activity_selection"
  | "invalid_activity_selection"
  | "activity_selection_not_allowed"
  | "ramp_up_not_allowed"
  | "invalid_ramp_up"
  | "forbidden_load_field";

export interface PrescriptionV2Issue {
  path: string;
  code: PrescriptionV2IssueCode;
}

export type PrescriptionV2ValidationResult = { ok: true; prescription: PrescriptionV2 } | { ok: false; issues: PrescriptionV2Issue[] };

export interface ValidatePrescriptionV2Options {
  /** "planned" (default): a plan prescription, `derivedFromItemId` forbidden. "final": a daily final prescription (UX-11A.5c). */
  stage?: "planned" | "final";
}

/** Load / intensity prescriptions NALYNT never makes (kg, %1RM, FTP, watts, heart-rate zones), at any depth. */
const FORBIDDEN_KEY = /kg|load|1rm|percent|ftp|watt|heart|bpm|zone/i;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const includes = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

export function validatePrescriptionV2(value: unknown, options: ValidatePrescriptionV2Options = {}): PrescriptionV2ValidationResult {
  const stage = options.stage ?? "planned";
  const issues: PrescriptionV2Issue[] = [];
  const add = (path: string, code: PrescriptionV2IssueCode) => issues.push({ path, code });

  if (!isObj(value)) return { ok: false, issues: [{ path: "$", code: "not_an_object" }] };

  scanForbiddenKeys(value, "$", add);

  if (value.schemaVersion !== PRESCRIPTION_V2_SCHEMA_VERSION) add("$.schemaVersion", "invalid_schema_version");
  if (!includes(SESSION_FAMILIES_V2, value.family)) add("$.family", "invalid_family");
  if (!includes(INTENT_SESSION_KINDS_V2, value.sessionKind)) add("$.sessionKind", "invalid_session_kind");
  const intent = isNonEmptyString(value.intentId) ? INTENT_CATALOG_V2[value.intentId] : undefined;
  if (!intent) add("$.intentId", "unknown_intent");
  else if (intent.family !== value.family) add("$.intentId", "intent_family_mismatch");
  if (value.protocolId !== undefined && !(isNonEmptyString(value.protocolId) && PROTOCOL_CATALOG_V2[value.protocolId])) add("$.protocolId", "unknown_protocol");
  validateManifest(value.catalog, add);
  if (value.activitySelection !== undefined) {
    if (value.family !== "endurance") add("$.activitySelection", "activity_selection_not_allowed");
    checkActivitySelection(value.activitySelection, "$.activitySelection", add);
  }

  const blockIds = new Set<string>();
  const itemIds = new Set<string>();
  if (!Array.isArray(value.blocks) || value.blocks.length === 0) {
    add("$.blocks", "invalid_block");
  } else {
    value.blocks.forEach((block, b) => {
      const path = `$.blocks[${b}]`;
      if (!isObj(block)) return add(path, "invalid_block");
      if (!isNonEmptyString(block.blockId)) add(`${path}.blockId`, "empty_id");
      else if (blockIds.has(block.blockId)) add(`${path}.blockId`, "duplicate_block_id");
      else blockIds.add(block.blockId);
      if (!includes(SESSION_BLOCK_ROLES_V2, block.role)) add(`${path}.role`, "invalid_block_role");
      if (block.focus !== undefined && !includes(PROTOCOL_BLOCK_FOCUS_V2, block.focus)) add(`${path}.focus`, "invalid_block_focus");
      if (block.durationMinutes !== undefined) checkRange(block.durationMinutes, `${path}.durationMinutes`, 1, add);
      if (block.rpeTarget !== undefined) checkRpe(block.rpeTarget, `${path}.rpeTarget`, add);
      if (block.talkTestId !== undefined) checkText(block.talkTestId, "instruction", `${path}.talkTestId`, add);
      if (!Array.isArray(block.instructionIds)) add(`${path}.instructionIds`, "invalid_block");
      else block.instructionIds.forEach((id, i) => checkText(id, "instruction", `${path}.instructionIds[${i}]`, add));
      if (!Array.isArray(block.items)) return add(`${path}.items`, "invalid_block");
      block.items.forEach((item, i) => validateItem(item, `${path}.items[${i}]`, value.family, stage, itemIds, add));
    });
  }

  return issues.length === 0 ? { ok: true, prescription: value as unknown as PrescriptionV2 } : { ok: false, issues };
}

function validateManifest(manifest: unknown, add: (path: string, code: PrescriptionV2IssueCode) => void) {
  const keys = SESSION_MODEL_V2_MANIFEST_KEYS as readonly string[];
  if (!isObj(manifest) || Object.keys(manifest).length !== keys.length || !keys.every((k) => k in manifest)) return add("$.catalog", "invalid_manifest");
  for (const key of keys) {
    const v = manifest[key];
    const ok = key === "templates" ? v === null || isNonEmptyString(v) : isNonEmptyString(v);
    if (!ok) add(`$.catalog.${key}`, "invalid_manifest");
  }
}

function validateItem(
  item: unknown,
  path: string,
  family: unknown,
  stage: "planned" | "final",
  itemIds: Set<string>,
  add: (path: string, code: PrescriptionV2IssueCode) => void
) {
  if (!isObj(item)) return add(path, "invalid_item_kind");
  if (!isNonEmptyString(item.prescriptionItemId)) add(`${path}.prescriptionItemId`, "empty_id");
  else if (itemIds.has(item.prescriptionItemId)) add(`${path}.prescriptionItemId`, "duplicate_prescription_item_id");
  else itemIds.add(item.prescriptionItemId);
  if (item.derivedFromItemId !== undefined) {
    if (stage === "planned") add(`${path}.derivedFromItemId`, "derived_from_not_allowed");
    else if (!isNonEmptyString(item.derivedFromItemId)) add(`${path}.derivedFromItemId`, "empty_id");
  }
  if (!includes(PRESCRIPTION_V2_ITEM_KINDS, item.kind)) return add(`${path}.kind`, "invalid_item_kind");

  if (item.kind !== "exercise" && item.rampUp !== undefined) add(`${path}.rampUp`, "ramp_up_not_allowed");
  // The modality choice is session-level (endurance), never on an item.
  if ("activitySelection" in item) add(`${path}.activitySelection`, "activity_selection_not_allowed");
  if (item.vigilanceIds !== undefined) {
    if (!Array.isArray(item.vigilanceIds)) add(`${path}.vigilanceIds`, "unknown_text");
    else item.vigilanceIds.forEach((id, i) => checkText(id, "vigilance", `${path}.vigilanceIds[${i}]`, add));
  }

  switch (item.kind) {
    case "exercise": {
      if (!isNonEmptyString(item.exerciseId)) add(`${path}.exerciseId`, "empty_id");
      else if (!SESSION_EXERCISE_CATALOG_V2[item.exerciseId]) add(`${path}.exerciseId`, "unknown_exercise");
      if (!includes(SESSION_EXERCISE_ROLES_V2, item.role)) add(`${path}.role`, "invalid_exercise_role");
      if (!isInt(item.sets) || item.sets < 1) add(`${path}.sets`, "invalid_sets");
      checkExerciseMeasure(item.measure, `${path}.measure`, add);
      if (item.restSeconds !== undefined) checkRange(item.restSeconds, `${path}.restSeconds`, 0, add);
      if (item.rpeTarget !== undefined) checkRpe(item.rpeTarget, `${path}.rpeTarget`, add);
      checkText(item.cueId, "cue", `${path}.cueId`, add);
      if (!Array.isArray(item.vigilanceIds)) add(`${path}.vigilanceIds`, "unknown_text");
      if (item.rampUp !== undefined) {
        if (item.role !== "principal" || family !== "strength") add(`${path}.rampUp`, "ramp_up_not_allowed");
        checkRampUp(item.rampUp, `${path}.rampUp`, add);
      }
      return;
    }
    case "drill": {
      if (!isNonEmptyString(item.drillId)) add(`${path}.drillId`, "empty_id");
      else if (!SESSION_DRILL_CATALOG_V2[item.drillId]) add(`${path}.drillId`, "unknown_drill");
      if ("role" in item) add(`${path}.role`, "drill_with_role");
      if ("sets" in item) add(`${path}.sets`, "invalid_sets");
      const m = item.measure;
      if (!isObj(m)) add(`${path}.measure`, "invalid_measure");
      else if (m.type !== "pass") add(`${path}.measure.type`, "invalid_measure_type");
      else if (!isInt(m.count) || m.count < DH_DRILL_PASSES_RANGE_V2.min || m.count > DH_DRILL_PASSES_RANGE_V2.max) add(`${path}.measure.count`, "pass_count_out_of_range");
      checkText(item.cueId, "cue", `${path}.cueId`, add);
      checkText(item.successCriterionId, "success_criterion", `${path}.successCriterionId`, add);
      if (!Array.isArray(item.vigilanceIds)) add(`${path}.vigilanceIds`, "unknown_text");
      return;
    }
  }
}

function checkActivitySelection(sel: unknown, path: string, add: (path: string, code: PrescriptionV2IssueCode) => void) {
  if (!isObj(sel) || sel.mode !== "restricted" || !Array.isArray(sel.activityIds) || Object.keys(sel).length !== 2) {
    return add(path, "invalid_activity_selection");
  }
  if (sel.activityIds.length === 0) return add(`${path}.activityIds`, "empty_activity_selection");
  if (new Set(sel.activityIds).size !== sel.activityIds.length || !sel.activityIds.every((a) => includes(ENDURANCE_ACTIVITIES_V2, a))) {
    add(`${path}.activityIds`, "invalid_activity_selection");
  }
}

function checkExerciseMeasure(m: unknown, path: string, add: (path: string, code: PrescriptionV2IssueCode) => void) {
  if (!isObj(m)) return add(path, "invalid_measure");
  switch (m.type) {
    case "reps":
      checkPair(m.min, m.max, path, 1, add);
      if (typeof m.perSide !== "boolean") add(`${path}.perSide`, "invalid_measure");
      return;
    case "duration":
      checkPair(m.minSeconds, m.maxSeconds, path, 1, add);
      if (typeof m.perSide !== "boolean") add(`${path}.perSide`, "invalid_measure");
      return;
    case "distance":
      checkPair(m.minMeters, m.maxMeters, path, 1, add);
      return;
    default:
      // "pass" is the drill measure; anything else (e.g. "passes") is not a measure type.
      return add(`${path}.type`, "invalid_measure_type");
  }
}

function checkPair(min: unknown, max: unknown, path: string, floor: number, add: (path: string, code: PrescriptionV2IssueCode) => void) {
  if (!isInt(min) || !isInt(max) || min < floor || max < floor) return add(path, "invalid_measure");
  if (min > max) add(path, "invalid_range");
}

function checkRange(r: unknown, path: string, floor: number, add: (path: string, code: PrescriptionV2IssueCode) => void) {
  if (!isObj(r)) return add(path, "invalid_range");
  checkPair(r.min, r.max, path, floor, add);
}

function checkRpe(r: unknown, path: string, add: (path: string, code: PrescriptionV2IssueCode) => void) {
  if (!isObj(r) || !isInt(r.min) || !isInt(r.max) || r.min < 1 || r.max > 10) return add(path, "invalid_range");
  if (r.min > r.max) add(path, "invalid_range");
}

function checkText(id: unknown, kind: CoachingTextKind, path: string, add: (path: string, code: PrescriptionV2IssueCode) => void) {
  if (!isNonEmptyString(id) || COACHING_TEXT_CATALOG[id]?.kind !== kind) add(path, "unknown_text");
}

function checkRampUp(r: unknown, path: string, add: (path: string, code: PrescriptionV2IssueCode) => void) {
  if (!isObj(r) || Object.keys(r).some((k) => k !== "instructionId" && k !== "sets")) return add(path, "invalid_ramp_up");
  checkText(r.instructionId, "instruction", `${path}.instructionId`, add);
  const s = r.sets;
  if (!isObj(s) || s.min !== 1 || s.max !== 2 || Object.keys(s).length !== 2) add(`${path}.sets`, "invalid_ramp_up");
}

function scanForbiddenKeys(value: unknown, path: string, add: (path: string, code: PrescriptionV2IssueCode) => void) {
  if (Array.isArray(value)) return value.forEach((v, i) => scanForbiddenKeys(v, `${path}[${i}]`, add));
  if (!isObj(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) add(`${path}.${key}`, "forbidden_load_field");
    scanForbiddenKeys(child, `${path}.${key}`, add);
  }
}
