/**
 * SPORT-PLAN-03 V2 contracts (HPM 2026-10-25) — three RPEs, never used for one another (docs/05 « Ne jamais
 * assimiler »). NON-PRESCRIPTIVE: a reference table and a check over a prescription's content; the validator
 * (validatePrescriptionV2, ranges 1–10) is unchanged. Plan generation and the daily final prescription refuse a
 * content that breaks it (sessionContractChecksV2, V2-CONTRACTS-INTEGRATION-01).
 *
 * - set RPE: the effort of one Force set, read as repetitions in reserve; prescribed on a Force exercise item
 *   (`rpeTarget`), recorded in `exercise_set_results.rpe_actual` (1–10); the only RPE a Force progression may read;
 * - activity RPE: the effort of an endurance or recovery activity, with the talk test where the protocol gives one;
 *   prescribed on a block (`rpeTarget`), recorded in `session_activity_results.rpe_actual` (1–10); the only RPE an
 *   endurance progression may read;
 * - session RPE: the V1 debrief (`completed_sessions.rpe`, 0–10, basis of `session_load`); not collected in V2;
 *   load monitoring only, never a progression gate on its own.
 * Power and DH prescriptions carry no RPE (speed and quality, not effort).
 */
import type { SessionFamilyV2 } from "../../catalog/intentCatalogV2.js";
import type { PrescriptionV2Content } from "../prescriptionV2.js";

export const RPE_KINDS_V2 = ["set", "activity", "session"] as const;
export type RpeKindV2 = (typeof RPE_KINDS_V2)[number];

export const RPE_SEMANTICS_V2: Readonly<
  Record<RpeKindV2, { scale: { min: number; max: number }; prescribedOn: string | null; recordedIn: string; collectedInV2: boolean; progressionUse: "force" | "endurance" | "none" }>
> = {
  set: { scale: { min: 1, max: 10 }, prescribedOn: "exercise item rpeTarget (strength)", recordedIn: "exercise_set_results.rpe_actual", collectedInV2: true, progressionUse: "force" },
  activity: { scale: { min: 1, max: 10 }, prescribedOn: "block rpeTarget (endurance, recovery)", recordedIn: "session_activity_results.rpe_actual", collectedInV2: true, progressionUse: "endurance" },
  session: { scale: { min: 0, max: 10 }, prescribedOn: null, recordedIn: "completed_sessions.rpe", collectedInV2: false, progressionUse: "none" },
};

const ACTIVITY_RPE_FAMILIES: readonly SessionFamilyV2[] = ["endurance", "recovery"];

export type RpeSemanticsIssueCodeV2 = "set_rpe_outside_strength" | "set_rpe_on_non_work_item" | "activity_rpe_outside_endurance_or_recovery";

export interface RpeTargetUseV2 {
  path: string;
  kind: Exclude<RpeKindV2, "session">;
}

/** Every RPE target of a content, classified by kind, and every use that contradicts the semantics above. */
export function checkRpeSemanticsV2(content: Pick<PrescriptionV2Content, "family" | "blocks">): { targets: RpeTargetUseV2[]; issues: { path: string; code: RpeSemanticsIssueCodeV2 }[] } {
  const targets: RpeTargetUseV2[] = [];
  const issues: { path: string; code: RpeSemanticsIssueCodeV2 }[] = [];
  content.blocks.forEach((block, b) => {
    if (block.rpeTarget !== undefined) {
      targets.push({ path: `blocks[${b}].rpeTarget`, kind: "activity" });
      if (!ACTIVITY_RPE_FAMILIES.includes(content.family)) issues.push({ path: `blocks[${b}].rpeTarget`, code: "activity_rpe_outside_endurance_or_recovery" });
    }
    block.items.forEach((item, i) => {
      if (item.kind !== "exercise" || item.rpeTarget === undefined) return;
      const path = `blocks[${b}].items[${i}].rpeTarget`;
      targets.push({ path, kind: "set" });
      if (content.family !== "strength") issues.push({ path, code: "set_rpe_outside_strength" });
      else if (block.role === "warm_up" || block.role === "cool_down") issues.push({ path, code: "set_rpe_on_non_work_item" });
    });
  });
  return { targets, issues };
}
