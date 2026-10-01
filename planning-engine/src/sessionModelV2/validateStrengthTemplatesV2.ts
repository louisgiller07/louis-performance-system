/**
 * UX-11A.5a.4 — pure integrity check of the strength template catalogue.
 *
 * Checks the locked structure and the catalogue consistency of every
 * candidate (exists, allowed for the template tier under the cumulative V2
 * rule, family of the session kind or transversal, role held). It does NOT
 * treat "no candidate compatible with some equipment set" as an error: that
 * is a runtime builder block (`no_compatible_strength_exercise`).
 */
import { SESSION_EXERCISE_CATALOG_V2 } from "../catalog/sessionExerciseCatalogV2.js";
import { PROTOCOL_CATALOG_V2 } from "../catalog/protocolCatalogV2.js";
import {
  STRENGTH_EXCLUDED_FAMILIES_V2,
  STRENGTH_FAMILIES_V2,
  STRENGTH_TEMPLATE_SESSION_KINDS_V2,
  STRENGTH_TRANSVERSAL_FAMILIES_V2,
  type StrengthTemplateV2,
} from "../catalog/strengthTemplateCatalogV2.js";
import { isExerciseAllowedForTierV2, STRENGTH_TIER_ORDER_V2 } from "./strengthTiers.js";

export type StrengthTemplateIssueCode =
  | "missing_template"
  | "duplicate_template"
  | "invalid_warm_up"
  | "warm_up_not_in_protocol"
  | "invalid_work_slots"
  | "empty_candidates"
  | "unknown_exercise"
  | "tier_not_allowed"
  | "family_not_allowed"
  | "role_not_held"
  | "duplicate_exercise";

export interface StrengthTemplateIssue {
  templateId: string;
  code: StrengthTemplateIssueCode;
  detail: string;
}

export function validateStrengthTemplatesV2(templates: readonly StrengthTemplateV2[]): StrengthTemplateIssue[] {
  const issues: StrengthTemplateIssue[] = [];
  const add = (templateId: string, code: StrengthTemplateIssueCode, detail: string) => issues.push({ templateId, code, detail });

  // One template per session kind × athlete tier.
  for (const kind of STRENGTH_TEMPLATE_SESSION_KINDS_V2) {
    for (const tier of STRENGTH_TIER_ORDER_V2) {
      const n = templates.filter((t) => t.sessionKind === kind && t.athleteTier === tier).length;
      if (n === 0) add(`${kind}/${tier}`, "missing_template", `${kind} × ${tier}`);
      if (n > 1) add(`${kind}/${tier}`, "duplicate_template", `${n} templates`);
    }
  }

  const warmUpProtocol = PROTOCOL_CATALOG_V2["strength_warm_up_v1"];
  const choice = (focus: string) => warmUpProtocol?.blocks.find((b) => b.focus === focus)?.items.find((i) => i.kind === "exercise_choice");

  for (const t of templates) {
    const seen = new Set<string>();
    const note = (id: string, where: string) => {
      if (seen.has(id)) add(t.templateId, "duplicate_exercise", `${id} (${where})`);
      seen.add(id);
    };

    // Warm-up: strength_warm_up_v1 counts and candidates.
    const mobility = choice("mobility");
    const activation = choice("activation");
    const total = t.warmUp.mobility.length + t.warmUp.activation.length;
    const count = warmUpProtocol?.exerciseCount;
    if (
      !mobility ||
      !activation ||
      mobility.kind !== "exercise_choice" ||
      activation.kind !== "exercise_choice" ||
      !count ||
      t.warmUp.mobility.length < mobility.count.min ||
      t.warmUp.mobility.length > mobility.count.max ||
      t.warmUp.activation.length < activation.count.min ||
      t.warmUp.activation.length > activation.count.max ||
      total < count.min ||
      total > count.max
    ) {
      add(t.templateId, "invalid_warm_up", `mobility ${t.warmUp.mobility.length} + activation ${t.warmUp.activation.length}`);
    } else {
      for (const id of t.warmUp.mobility) if (!mobility.candidates.includes(id)) add(t.templateId, "warm_up_not_in_protocol", `${id} (mobility)`);
      for (const id of t.warmUp.activation) if (!activation.candidates.includes(id)) add(t.templateId, "warm_up_not_in_protocol", `${id} (activation)`);
    }
    for (const id of [...t.warmUp.mobility, ...t.warmUp.activation]) {
      const e = SESSION_EXERCISE_CATALOG_V2[id];
      if (!e) add(t.templateId, "unknown_exercise", id);
      else if (!isExerciseAllowedForTierV2(e, t.athleteTier)) add(t.templateId, "tier_not_allowed", `${id} (warm-up)`);
      note(id, "warm-up");
    }

    // Exactly three work slots, principal first in `main`.
    if (t.workSlots.length !== 3 || t.workSlots[0]?.role !== "principal" || t.workSlots[0]?.blockRole !== "main" || t.workSlots.slice(1).some((s) => s.blockRole !== "complementary" || s.role === "principal")) {
      add(t.templateId, "invalid_work_slots", t.workSlots.map((s) => `${s.blockRole}:${s.role}`).join(", "));
    }
    const allowedFamilies = [...STRENGTH_FAMILIES_V2[t.sessionKind], ...STRENGTH_TRANSVERSAL_FAMILIES_V2];
    t.workSlots.forEach((slot, s) => {
      if (slot.candidates.length === 0) add(t.templateId, "empty_candidates", `slot ${s} (${slot.role})`);
      for (const id of slot.candidates) {
        const e = SESSION_EXERCISE_CATALOG_V2[id];
        if (!e) {
          add(t.templateId, "unknown_exercise", id);
          continue;
        }
        if (!isExerciseAllowedForTierV2(e, t.athleteTier)) add(t.templateId, "tier_not_allowed", `${id} (slot ${s})`);
        if (!allowedFamilies.includes(e.family) || STRENGTH_EXCLUDED_FAMILIES_V2.includes(e.family)) add(t.templateId, "family_not_allowed", `${id} (${e.family})`);
        if (!e.roles.includes(slot.role)) add(t.templateId, "role_not_held", `${id} has no role ${slot.role} (slot ${s})`);
        note(id, `slot ${s}`);
      }
    });
  }
  return issues;
}
