// UX-11A.5c.4 — strict decoder of a daily final prescription V2 (live
// daily-run response or decision_final_prescriptions row).
//
// Order matters: schema and catalogue version are checked BEFORE any id is
// looked up, so a prescription of another Session Model version is reported
// unsupported without resolving a single id with the current tables. Then
// every id must resolve (exercise / drill names, cue, criterion, vigilance,
// instruction, intent, activity); one unresolved id makes the whole document
// invalid — never a partial rendering.
import type { BlockView, DrillItemView, EnduranceGuidanceView, ExerciseItemView, ExerciseMeasureView, FinalPrescriptionV2View, LoadGuidanceView, LoadReferenceView, RangeView, RepsGuidanceView, RepsReferenceView } from "./finalPrescriptionV2Types";
import {
  BLOCK_ROLE_LABELS_V2,
  drillNameV2,
  ENDURANCE_ACTIVITY_LABELS_V2,
  EXERCISE_ROLES_V2,
  exerciseNameV2,
  resolveCoachingText,
  SESSION_FAMILIES_V2,
  SUPPORTED_SESSION_MODEL_V2_MANIFESTS,
} from "./sessionModelV2Support";

export interface FinalPrescriptionV2Record {
  id: unknown;
  decisionId: unknown;
  schemaVersion: unknown;
  catalogVersion: unknown;
  structure: unknown;
}

export type DecodeFinalPrescriptionV2Result =
  | { ok: true; view: FinalPrescriptionV2View }
  | { ok: false; kind: "unsupported_schema_or_catalog" | "invalid"; reason: string };

class Invalid extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

function fail(reason: string): never {
  throw new Invalid(reason);
}

function range(v: unknown, path: string): RangeView {
  if (!isObject(v) || typeof v.min !== "number" || typeof v.max !== "number" || v.min > v.max || v.min < 0) fail(`${path}: invalid range`);
  return { min: v.min, max: v.max };
}
const optionalRange = (v: unknown, path: string): RangeView | undefined => (v === undefined ? undefined : range(v, path));

function text(id: unknown, kind: "cue" | "success_criterion" | "vigilance" | "instruction" | "intent", path: string): string {
  const resolved = resolveCoachingText(id, kind);
  if (resolved === null) fail(`${path}: unknown ${kind} id`);
  return resolved;
}
function texts(ids: unknown, kind: "vigilance" | "instruction", path: string): string[] {
  if (!Array.isArray(ids)) fail(`${path}: not an array`);
  return ids.map((id, i) => text(id, kind, `${path}[${i}]`));
}

function measure(v: unknown, path: string): ExerciseMeasureView {
  if (!isObject(v)) fail(`${path}: missing measure`);
  if (v.type === "reps" && typeof v.min === "number" && typeof v.max === "number" && typeof v.perSide === "boolean" && v.min > 0 && v.min <= v.max) {
    return { type: "reps", min: v.min, max: v.max, perSide: v.perSide };
  }
  if (v.type === "duration" && typeof v.minSeconds === "number" && typeof v.maxSeconds === "number" && typeof v.perSide === "boolean" && v.minSeconds > 0 && v.minSeconds <= v.maxSeconds) {
    return { type: "duration", minSeconds: v.minSeconds, maxSeconds: v.maxSeconds, perSide: v.perSide };
  }
  if (v.type === "distance" && typeof v.minMeters === "number" && typeof v.maxMeters === "number" && v.minMeters > 0 && v.minMeters <= v.maxMeters) {
    return { type: "distance", minMeters: v.minMeters, maxMeters: v.maxMeters };
  }
  return fail(`${path}: invalid exercise measure`);
}

const isRir = (r: unknown): r is RangeView | null =>
  r === null || (isObject(r) && Number.isInteger(r.min) && Number.isInteger(r.max) && (r.min as number) >= 0 && (r.min as number) <= (r.max as number) && (r.max as number) <= 10);
const isKg = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1000;

function loadReference(r: unknown): LoadReferenceView | null {
  if (!isObject(r) || typeof r.sessionDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.sessionDate) || !isKg(r.loadKg)) return null;
  if (!Array.isArray(r.reps) || r.reps.length === 0 || !r.reps.every((n) => Number.isInteger(n) && n > 0)) return null;
  const range = r.repsRange === null ? null : isObject(r.repsRange) && Number.isInteger(r.repsRange.min) && Number.isInteger(r.repsRange.max) ? { min: r.repsRange.min as number, max: r.repsRange.max as number } : undefined;
  if (range === undefined) return null;
  const rpeMax = r.rpeMax === null ? null : typeof r.rpeMax === "number" && r.rpeMax >= 1 && r.rpeMax <= 10 ? r.rpeMax : undefined;
  if (rpeMax === undefined) return null;
  const setsPrescribed = r.setsPrescribed === null ? null : isCount(r.setsPrescribed) ? r.setsPrescribed : undefined;
  if (setsPrescribed === undefined) return null;
  return { sessionDate: r.sessionDate, loadKg: r.loadKg, reps: r.reps as number[], setsPrescribed, repsRange: range, rpeMax };
}

/**
 * PHYS-01 — the load guidance of a work exercise, decoded leniently: it is
 * advice, so a malformed or unknown guidance is dropped (never shown as a
 * guess) while the session itself stays readable.
 */
function loadGuidance(g: unknown): LoadGuidanceView | undefined {
  if (!isObject(g) || g.ruleVersion !== "strength-load-guidance-v1") return undefined;
  if (g.loadBasis !== "per_dumbbell" && g.loadBasis !== "total") return undefined;
  const loadBasis = g.loadBasis;
  if (g.mode === "calibrate" && (g.reason === "no_history" || g.reason === "history_without_load") && isRir(g.repsInReserve)) {
    return { mode: "calibrate", reason: g.reason, loadBasis, repsInReserve: g.repsInReserve };
  }
  if (g.mode === "reference" && (g.reason === "different_dose" || g.reason === "history_too_old") && isRir(g.repsInReserve)) {
    const reference = loadReference(g.reference);
    return reference ? { mode: "reference", reason: g.reason, loadBasis, reference, repsInReserve: g.repsInReserve } : undefined;
  }
  const hold = g.hold === undefined ? undefined : g.hold === "dose_up" || g.hold === "pain" || g.hold === "fatigue" ? g.hold : null;
  if (
    g.mode === "target" &&
    (g.reason === "top_of_range_reached" || g.reason === "within_range" || g.reason === "below_range" || g.reason === "effort_too_high") &&
    (g.change === "increase" || g.change === "keep" || g.change === "decrease") &&
    hold !== null &&
    (hold === undefined || (g.change === "keep" && g.reason === "top_of_range_reached")) &&
    isKg(g.targetKg) &&
    isKg(g.stepKg)
  ) {
    const reference = loadReference(g.reference);
    return reference ? { mode: "target", reason: g.reason, change: g.change, ...(hold ? { hold } : {}), targetKg: g.targetKg, stepKg: g.stepKg, loadBasis, reference } : undefined;
  }
  return undefined;
}

/**
 * PHYS-02 — the endurance guidance, decoded leniently: advisory, so an
 * unreadable one is dropped (undefined), never a failure of the document.
 */
function enduranceGuidance(g: unknown): EnduranceGuidanceView | undefined {
  if (!isObject(g) || g.ruleVersion !== "endurance-guidance-v1" || !isObject(g.reference)) return undefined;
  const r = g.reference;
  const rpe = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 10;
  if (typeof r.sessionDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.sessionDate)) return undefined;
  if (typeof r.activityId !== "string" || !Object.prototype.hasOwnProperty.call(ENDURANCE_ACTIVITY_LABELS_V2, r.activityId)) return undefined;
  if (!isCount(r.durationSeconds)) return undefined;
  if (r.distanceM !== null && !(typeof r.distanceM === "number" && Number.isInteger(r.distanceM) && r.distanceM >= 0)) return undefined;
  if (r.rpeActual !== null && !rpe(r.rpeActual)) return undefined;
  const reference = { sessionDate: r.sessionDate, activityLabel: ENDURANCE_ACTIVITY_LABELS_V2[r.activityId]!, durationSeconds: r.durationSeconds, distanceM: r.distanceM, rpeActual: r.rpeActual };
  const e = g.effortAboveTarget;
  if (e === undefined) return { reference };
  if (!isObject(e) || !rpe(e.rpeActual) || !rpe(e.rpeTargetMax) || e.rpeActual <= e.rpeTargetMax) return { reference };
  return { reference, effortAboveTarget: { rpeActual: e.rpeActual, rpeTargetMax: e.rpeTargetMax } };
}

/** PHYS-04 — the bodyweight repetitions guidance, decoded leniently (advisory: unreadable → dropped, never a failure). */
function repsGuidance(g: unknown): RepsGuidanceView | undefined {
  if (!isObject(g) || g.ruleVersion !== "bodyweight-reps-guidance-v1") return undefined;
  const reference = (r: unknown): RepsReferenceView | undefined =>
    isObject(r) && typeof r.sessionDate === "string" && Array.isArray(r.reps) && r.reps.length > 0 && r.reps.every(isCount) && (r.rpeMax === null || (typeof r.rpeMax === "number" && r.rpeMax >= 1 && r.rpeMax <= 10))
      ? { sessionDate: r.sessionDate, reps: r.reps as number[], rpeMax: r.rpeMax as number | null }
      : undefined;
  if (g.mode === "calibrate") return { mode: "calibrate", repsInReserve: isRir(g.repsInReserve) ? (g.repsInReserve as RangeView | null) : null };
  if (g.mode === "reference" && (g.reason === "different_dose" || g.reason === "history_too_old")) {
    const ref = reference(g.reference);
    return ref ? { mode: "reference", reason: g.reason, reference: ref } : undefined;
  }
  if (
    g.mode === "target" &&
    (g.reason === "effort_too_high" || g.reason === "below_range" || g.reason === "within_range" || g.reason === "top_of_range_reached") &&
    (g.change === "increase" || g.change === "keep" || g.change === "decrease") &&
    isCount(g.targetReps)
  ) {
    const ref = reference(g.reference);
    const hold = g.hold === "dose_up" || g.hold === "pain" || g.hold === "fatigue" ? g.hold : undefined;
    const nextStep = g.nextStep === "no_bodyweight_variant" || g.nextStep === "variant_not_validated" ? g.nextStep : undefined;
    return ref ? { mode: "target", reason: g.reason, change: g.change, targetReps: g.targetReps, ...(hold ? { hold } : {}), ...(nextStep ? { nextStep } : {}), reference: ref } : undefined;
  }
  return undefined;
}

function item(v: unknown, path: string): ExerciseItemView | DrillItemView {
  if (!isObject(v) || !isNonEmptyString(v.prescriptionItemId)) fail(`${path}: invalid item`);
  if (v.kind === "exercise") {
    const name = exerciseNameV2(v.exerciseId);
    if (name === null) fail(`${path}: unknown exercise`);
    if (typeof v.role !== "string" || !(EXERCISE_ROLES_V2 as readonly string[]).includes(v.role)) fail(`${path}: invalid role`);
    if (!isCount(v.sets)) fail(`${path}: invalid sets`);
    let rampUp: ExerciseItemView["rampUp"];
    if (v.rampUp !== undefined) {
      if (!isObject(v.rampUp)) fail(`${path}.rampUp: invalid`);
      rampUp = { instruction: text(v.rampUp.instructionId, "instruction", `${path}.rampUp.instructionId`), sets: range(v.rampUp.sets, `${path}.rampUp.sets`) };
    }
    const restSeconds = optionalRange(v.restSeconds, `${path}.restSeconds`);
    const rpeTarget = optionalRange(v.rpeTarget, `${path}.rpeTarget`);
    const guidance = loadGuidance(v.loadGuidance);
    const reps = repsGuidance(v.repsGuidance);
    return {
      kind: "exercise",
      prescriptionItemId: v.prescriptionItemId,
      exerciseId: v.exerciseId as string,
      name,
      role: v.role,
      sets: v.sets,
      measure: measure(v.measure, `${path}.measure`),
      ...(restSeconds ? { restSeconds } : {}),
      ...(rpeTarget ? { rpeTarget } : {}),
      cue: text(v.cueId, "cue", `${path}.cueId`),
      vigilances: texts(v.vigilanceIds, "vigilance", `${path}.vigilanceIds`),
      ...(rampUp ? { rampUp } : {}),
      ...(guidance ? { loadGuidance: guidance } : {}),
      ...(reps ? { repsGuidance: reps } : {}),
    };
  }
  if (v.kind === "drill") {
    const name = drillNameV2(v.drillId);
    if (name === null) fail(`${path}: unknown drill`);
    if (!isObject(v.measure) || v.measure.type !== "pass" || !isCount(v.measure.count)) fail(`${path}: invalid pass measure`);
    return {
      kind: "drill",
      prescriptionItemId: v.prescriptionItemId,
      drillId: v.drillId as string,
      name,
      passes: v.measure.count,
      cue: text(v.cueId, "cue", `${path}.cueId`),
      successCriterion: text(v.successCriterionId, "success_criterion", `${path}.successCriterionId`),
      vigilances: texts(v.vigilanceIds, "vigilance", `${path}.vigilanceIds`),
    };
  }
  return fail(`${path}: unknown item kind`);
}

function block(v: unknown, path: string): BlockView {
  if (!isObject(v) || !isNonEmptyString(v.blockId) || typeof v.role !== "string") fail(`${path}: invalid block`);
  const roleLabel = Object.prototype.hasOwnProperty.call(BLOCK_ROLE_LABELS_V2, v.role) ? BLOCK_ROLE_LABELS_V2[v.role]! : fail(`${path}: unknown role`);
  if (!Array.isArray(v.items)) fail(`${path}.items: not an array`);
  const durationMinutes = optionalRange(v.durationMinutes, `${path}.durationMinutes`);
  const rpeTarget = optionalRange(v.rpeTarget, `${path}.rpeTarget`);
  return {
    blockId: v.blockId,
    role: v.role,
    roleLabel,
    ...(durationMinutes ? { durationMinutes } : {}),
    ...(rpeTarget ? { rpeTarget } : {}),
    ...(v.talkTestId !== undefined ? { talkTest: text(v.talkTestId, "instruction", `${path}.talkTestId`) } : {}),
    instructions: texts(v.instructionIds, "instruction", `${path}.instructionIds`),
    items: v.items.map((it, i) => item(it, `${path}.items[${i}]`)),
  };
}

function sameManifest(catalog: Record<string, unknown>, expected: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(catalog);
  return keys.length === Object.keys(expected).length && keys.every((k) => catalog[k] === expected[k]);
}

/** A supported manifest, exactly (aggregate and every component). */
function supportedManifest(catalog: Record<string, unknown>): boolean {
  return SUPPORTED_SESSION_MODEL_V2_MANIFESTS.some((expected) => catalog.aggregate === expected.aggregate && sameManifest(catalog, expected));
}

/**
 * A02 — a PLANNED prescription v2 (training_plan_planned_prescriptions) has the
 * same structure as a final one: decoded by the same function, same manifest
 * gate, same fail-closed states. Its owner is the generated plan session, put
 * in the view's `decisionId` slot (a plan prescription has no decision).
 */
export function decodePlannedPrescriptionV2(row: { id: unknown; generatedPlanSessionId: unknown; schemaVersion: unknown; catalogVersion: unknown; structure: unknown }): DecodeFinalPrescriptionV2Result {
  return decodeFinalPrescriptionV2({ id: row.id, decisionId: row.generatedPlanSessionId, schemaVersion: row.schemaVersion, catalogVersion: row.catalogVersion, structure: row.structure });
}

export function decodeFinalPrescriptionV2(record: FinalPrescriptionV2Record): DecodeFinalPrescriptionV2Result {
  const s = record.structure;
  if (record.schemaVersion !== "v2") return { ok: false, kind: "unsupported_schema_or_catalog", reason: "schema_version is not v2" };
  if (!isObject(s) || s.schemaVersion !== "v2") return { ok: false, kind: "unsupported_schema_or_catalog", reason: "structure.schemaVersion is not v2" };
  if (!isObject(s.catalog) || !isNonEmptyString(s.catalog.aggregate)) return { ok: false, kind: "invalid", reason: "missing catalogue manifest" };
  if (record.catalogVersion !== s.catalog.aggregate) return { ok: false, kind: "invalid", reason: "catalog_version differs from structure.catalog.aggregate" };
  // Version gate BEFORE any id resolution.
  if (!supportedManifest(s.catalog)) {
    return { ok: false, kind: "unsupported_schema_or_catalog", reason: `catalogue ${String(s.catalog.aggregate)} is not supported by this version` };
  }
  try {
    if (!isNonEmptyString(record.id) || !isNonEmptyString(record.decisionId)) fail("missing ids");
    if (typeof s.family !== "string" || !(SESSION_FAMILIES_V2 as readonly string[]).includes(s.family)) fail("unknown family");
    if (!isNonEmptyString(s.sessionKind)) fail("missing sessionKind");
    if (!Array.isArray(s.blocks) || s.blocks.length === 0) fail("no blocks");
    let activityOptions: { id: string; label: string }[] | undefined;
    if (s.activitySelection !== undefined) {
      const sel = s.activitySelection;
      if (!isObject(sel) || sel.mode !== "restricted" || !Array.isArray(sel.activityIds) || sel.activityIds.length === 0) fail("invalid activitySelection");
      activityOptions = sel.activityIds.map((id) =>
        typeof id === "string" && Object.prototype.hasOwnProperty.call(ENDURANCE_ACTIVITY_LABELS_V2, id) ? { id, label: ENDURANCE_ACTIVITY_LABELS_V2[id]! } : fail("unknown activity")
      );
    }
    const view: FinalPrescriptionV2View = {
      id: record.id,
      decisionId: record.decisionId,
      aggregate: s.catalog.aggregate,
      sessionKind: s.sessionKind,
      family: s.family,
      intent: text(`intent.${String(s.intentId)}`, "intent", "intentId"),
      ...(isNonEmptyString(s.templateId) ? { templateId: s.templateId } : {}),
      ...(isNonEmptyString(s.protocolId) ? { protocolId: s.protocolId } : {}),
      ...(activityOptions ? { activities: activityOptions.map((a) => a.label), activityOptions } : {}),
      blocks: s.blocks.map((b, i) => block(b, `blocks[${i}]`)),
    };
    // PHYS-02 — advisory, endurance only, never a reason to refuse the document.
    const guidance = s.family === "endurance" ? enduranceGuidance(s.enduranceGuidance) : undefined;
    if (guidance) view.enduranceGuidance = guidance;
    return { ok: true, view };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, kind: "invalid", reason: e.message };
    throw e;
  }
}
