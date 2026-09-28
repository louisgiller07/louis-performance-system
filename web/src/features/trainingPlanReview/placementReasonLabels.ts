// V06-04 — athlete-facing wording for a plan version's relaxedConstraints
// (training_plan_versions.relaxed_constraints). Presentation only: the
// engine's values are never changed, and no raw constraintId/reason/domain
// string is ever returned — an unrecognized value falls back to a generic
// sentence instead.
//
// Values mirrored from planning-engine (never imported, no shared build
// boundary — same discipline as trainingPlanReviewTypes.ts):
// - constraintId "placement_shortfall" (constraintResolver.ts), whose
//   `reason` is a WeekSegmenter UnplaceableReason (weekSegmenter.ts):
//   insufficient_available_dates / terrain_incompatible /
//   insufficient_available_time (planner v2, V06-03);
// - constraintId "recovery_spacing" (constraintResolver.ts), whose `reason`
//   is a fixed English sentence, never shown as such.
import type { TrainingPlanReviewRelaxedConstraint } from "./trainingPlanReviewTypes";

const SHORTFALL_REASON_TEXT: Record<string, string> = {
  insufficient_available_time: "pas assez de temps disponible dans tes créneaux",
  insufficient_available_dates: "pas assez de jours disponibles",
  terrain_incompatible: "aucun jour disponible compatible avec ton terrain",
};

const DOMAIN_TEXT: Record<string, string> = {
  strength: "de force",
  dh_technical: "DH",
  aerobic: "aérobie",
};

const UNKNOWN_CONSTRAINT_TEXT = "Le plan a été ajusté pour rester réalisable.";

/** Own keys only — an inherited name ("toString", "constructor") must never match a label table. */
function labelFor(table: Record<string, string>, key: string | undefined): string | undefined {
  return key !== undefined && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

function sessions(count: number, domain: string | undefined, singularSuffix: string, pluralSuffix: string): string {
  const label = labelFor(DOMAIN_TEXT, domain);
  const domainText = label !== undefined ? ` ${label}` : "";
  return count > 1 ? `${count} séances${domainText} ${pluralSuffix}` : `1 séance${domainText} ${singularSuffix}`;
}

interface Group {
  kind: "shortfall_known" | "shortfall_unknown" | "recovery_spacing" | "unknown";
  reason?: string;
  domain?: string;
  count: number;
}

function describeGroup(group: Group): string {
  switch (group.kind) {
    case "shortfall_known":
      return `${sessions(group.count, group.domain, "non placée", "non placées")} : ${labelFor(SHORTFALL_REASON_TEXT, group.reason)}.`;
    case "shortfall_unknown":
      return `${sessions(group.count, group.domain, "n'a pas pu être placée", "n'ont pas pu être placées")}.`;
    case "recovery_spacing":
      return `${sessions(group.count, "strength", "allégée", "allégées")} pour éviter deux séances lourdes d'affilée.`;
    case "unknown":
      return UNKNOWN_CONSTRAINT_TEXT;
  }
}

/**
 * One French sentence per distinct (constraint, reason, domain), counted —
 * e.g. four weekly DH shortfalls for lack of time become
 * "4 séances DH non placées : pas assez de temps disponible dans tes
 * créneaux." — in first-occurrence order. An entry with no usable `reason`
 * (missing, not a string, blank) or that is not an object is skipped:
 * nothing is shown for it.
 */
export function describeRelaxedConstraints(constraints: readonly unknown[]): string[] {
  const groups = new Map<string, Group>();

  for (const raw of constraints) {
    if (typeof raw !== "object" || raw === null) continue;
    const constraint = raw as Partial<Record<keyof TrainingPlanReviewRelaxedConstraint, unknown>>;
    if (typeof constraint.reason !== "string" || constraint.reason.trim() === "") continue;
    // Unknown domains are dropped here (never displayed), so they also group together.
    const domain = typeof constraint.domain === "string" && labelFor(DOMAIN_TEXT, constraint.domain) !== undefined ? constraint.domain : undefined;

    let key: string;
    let group: Omit<Group, "count">;
    if (constraint.constraintId === "placement_shortfall" && labelFor(SHORTFALL_REASON_TEXT, constraint.reason) !== undefined) {
      key = `shortfall|${constraint.reason}|${domain ?? ""}`;
      group = { kind: "shortfall_known", reason: constraint.reason, domain };
    } else if (constraint.constraintId === "placement_shortfall") {
      key = `shortfall|?|${domain ?? ""}`;
      group = { kind: "shortfall_unknown", domain };
    } else if (constraint.constraintId === "recovery_spacing") {
      key = "recovery_spacing";
      group = { kind: "recovery_spacing" };
    } else {
      key = "unknown";
      group = { kind: "unknown" };
    }

    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { ...group, count: 1 });
  }

  return [...groups.values()].map(describeGroup);
}
