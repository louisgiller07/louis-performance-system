/**
 * UX-11A.5c.1 — invariants of a KEEP final prescription V2 (ADR UX-11A.5c.0).
 *
 * Checked against the planned prescription it copies:
 * - schema v2, structure valid at the "final" stage;
 * - catalog_version = manifest aggregate; manifest identical to the planned one;
 * - reconciliation keep, origin generated, plannedPrescriptionId present, no adaptation rule;
 * - no derivedFromItemId; same blockIds and prescriptionItemIds, in the same order;
 * - same sport fingerprint; same kind / family / intent / template / protocol.
 * Pure: returns the list of violated invariants (empty = valid).
 */
import type { PrescriptionV2 } from "../prescriptionV2.js";
import { sportFingerprint } from "../sportFingerprint.js";
import { validatePrescriptionV2 } from "../validatePrescriptionV2.js";
import type { FinalPrescriptionV2 } from "./finalPrescriptionV2.js";

export type KeepFinalPrescriptionV2Check = { ok: true } | { ok: false; issues: string[] };

const blockIds = (p: PrescriptionV2) => p.blocks.map((b) => b.blockId);
const itemIds = (p: PrescriptionV2) => p.blocks.flatMap((b) => b.items.map((i) => i.prescriptionItemId));

export function validateKeepFinalPrescriptionV2(final: FinalPrescriptionV2, planned: { id: string; structure: PrescriptionV2 }): KeepFinalPrescriptionV2Check {
  const issues: string[] = [];
  const s = final.structure;

  if (final.schemaVersion !== "v2" || s.schemaVersion !== "v2") issues.push("schema_not_v2");
  const validation = validatePrescriptionV2(s, { stage: "final" });
  if (!validation.ok) issues.push(...validation.issues.map((i) => `structure_invalid:${i.path}:${i.code}`));
  if (final.catalogVersion !== s.catalog.aggregate) issues.push("catalog_version_not_manifest_aggregate");
  if (JSON.stringify(s.catalog) !== JSON.stringify(planned.structure.catalog)) issues.push("manifest_differs_from_planned");

  if (final.reconciliationAction !== "keep") issues.push("action_not_keep");
  if (final.activeSessionOrigin !== "generated") issues.push("origin_not_generated");
  if (final.plannedPrescriptionId !== planned.id) issues.push("planned_prescription_id_mismatch");
  if (final.planVersionId === undefined) issues.push("plan_version_id_missing");
  if (final.adaptationRuleIds.length !== 0) issues.push("keep_has_adaptation_rules");

  if (s.blocks.some((b) => b.items.some((i) => i.derivedFromItemId !== undefined))) issues.push("derived_from_item_id_on_keep");
  if (JSON.stringify(blockIds(s)) !== JSON.stringify(blockIds(planned.structure))) issues.push("block_ids_differ");
  if (JSON.stringify(itemIds(s)) !== JSON.stringify(itemIds(planned.structure))) issues.push("item_ids_differ");
  if (sportFingerprint(s) !== sportFingerprint(planned.structure)) issues.push("sport_fingerprint_differs");

  for (const key of ["sessionKind", "family", "intentId", "templateId", "protocolId"] as const) {
    if (s[key] !== planned.structure[key]) issues.push(`${key}_differs`);
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
